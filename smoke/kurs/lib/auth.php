<?php
/**
 * lib/auth.php — сессии, пароли, роли, CSRF, лимит подбора.
 *
 * ПАРОЛИ ХРАНЯТСЯ ТОЛЬКО В ВИДЕ ХЭША (Argon2id, запасной вариант — bcrypt).
 * Проверка — password_verify() на сервере. Клиент никогда не получает хэш
 * и не знает, как он устроен.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/resp.php';

function kurs_hash_password(string $password): string
{
    $algo = PASSWORD_BCRYPT;
    $options = ['cost' => 12];
    if (defined('PASSWORD_ARGON2ID')) {
        $algo = PASSWORD_ARGON2ID;
        /* скромные параметры: DS223 — это 2 ядра ARM и 2 ГБ ОЗУ на весь класс */
        $options = ['memory_cost' => 8192, 'time_cost' => 3, 'threads' => 1];
    }
    $hash = password_hash($password, $algo, $options);
    if (!is_string($hash)) {
        throw new RuntimeException('Не удалось создать хэш пароля');
    }
    return $hash;
}

function kurs_password_algo_name(): string
{
    if (defined('PASSWORD_ARGON2ID')) {
        return 'argon2id';
    }
    return 'bcrypt';
}

function kurs_password_needs_rehash(string $hash): bool
{
    try {
        if (defined('PASSWORD_ARGON2ID')) {
            return password_needs_rehash($hash, PASSWORD_ARGON2ID, ['memory_cost' => 8192, 'time_cost' => 3, 'threads' => 1]);
        }
        return password_needs_rehash($hash, PASSWORD_BCRYPT, ['cost' => 12]);
    } catch (Throwable $e) {
        return false;
    }
}

function kurs_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = kurs_is_https();
    session_name('kursid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) (KURS_SESSION_HOURS * 3600));
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Lax');
    if ($secure) {
        ini_set('session.cookie_secure', '1');
    }
    session_start();
}

function kurs_current_user(): ?array
{
    kurs_start_session();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) {
        return null;
    }
    static $cache = [];
    $key = (int) $id;
    if (isset($cache[$key])) {
        return $cache[$key];
    }
    $st = kurs_db()->prepare('SELECT u.*, c.name AS class_name FROM users u
                              LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = ?');
    $st->execute([$key]);
    $row = $st->fetch();
    if (!$row || (int) $row['active'] !== 1) {
        unset($_SESSION['uid']);
        return null;
    }
    $cache[$key] = $row;
    return $row;
}

/** Требуется вход; иначе — 401. Возвращает запись пользователя. */
function kurs_require_user(): array
{
    $u = kurs_current_user();
    if (!$u) {
        kurs_fail('Нужно войти в портал', 401);
    }
    return $u;
}

function kurs_require_teacher(): array
{
    $u = kurs_require_user();
    if ($u['role'] !== 'teacher') {
        kurs_fail('Раздел только для преподавателя', 403);
    }
    return $u;
}

function kurs_is_teacher(): bool
{
    $u = kurs_current_user();
    return (bool) $u && $u['role'] === 'teacher';
}

/* --- CSRF ------------------------------------------------------------------ */

function kurs_csrf_token(): string
{
    kurs_start_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = kurs_random_token(16);
    }
    return (string) $_SESSION['csrf'];
}

function kurs_check_csrf(): void
{
    kurs_start_session();
    $sent = '';
    foreach (['HTTP_X_CSRF_TOKEN', 'HTTP_X_XSRF_TOKEN'] as $h) {
        if (!empty($_SERVER[$h])) {
            $sent = (string) $_SERVER[$h];
            break;
        }
    }
    if ($sent === '') {
        $in = kurs_input();
        $sent = is_string($in['csrf'] ?? null) ? $in['csrf'] : '';
    }
    $want = (string) ($_SESSION['csrf'] ?? '');
    if ($want === '' || !hash_equals($want, $sent)) {
        kurs_fail('Сессия устарела или запрос подделан. Обновите страницу и войдите заново.', 403);
    }
}

/* --- лимит подбора --------------------------------------------------------- */

function kurs_rate_limit_file(): string
{
    return kurs_data_dir() . '/ratelimit.json';
}

/** Простой лимит по IP: N попыток входа за окно времени. */
function kurs_rate_limit(string $bucket, int $max, int $window): bool
{
    $file = kurs_rate_limit_file();
    $now = kurs_now();
    $data = [];
    if (is_file($file)) {
        $raw = @file_get_contents($file);
        $decoded = json_decode((string) $raw, true);
        if (is_array($decoded)) {
            $data = $decoded;
        }
    }
    $key = $bucket . '|' . kurs_client_ip();
    $entry = $data[$key] ?? ['n' => 0, 'ts' => $now];
    if ($now - (int) $entry['ts'] > $window) {
        $entry = ['n' => 0, 'ts' => $now];
    }
    $entry['n'] = (int) $entry['n'] + 1;
    $data[$key] = $entry;
    /* не даём файлу расти бесконечно */
    if (count($data) > 5000) {
        foreach ($data as $k => $v) {
            if ($now - (int) $v['ts'] > $window * 4) {
                unset($data[$k]);
            }
        }
    }
    @file_put_contents($file, json_encode($data), LOCK_EX);
    return (int) $entry['n'] <= $max;
}

/* --- регистрация и вход ---------------------------------------------------- */

function kurs_min_password(string $role): int
{
    $key = $role === 'teacher' ? 'min_pass_teacher' : 'min_pass_student';
    $def = $role === 'teacher' ? KURS_MIN_PASS_TEACHER : KURS_MIN_PASS_STUDENT;
    return kurs_setting_int($key, $def, 4, 64);
}

function kurs_find_user_by_login(string $login): ?array
{
    $st = kurs_db()->prepare('SELECT * FROM users WHERE login = ? COLLATE NOCASE LIMIT 1');
    $st->execute([$login]);
    $row = $st->fetch();
    return $row ?: null;
}

function kurs_find_user_by_id(int $id): ?array
{
    $st = kurs_db()->prepare('SELECT u.*, c.name AS class_name FROM users u
                              LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    return $row ?: null;
}

function kurs_create_user(string $login, string $name, string $password, string $role, ?int $classId): array
{
    $hash = kurs_hash_password($password);
    $st = kurs_db()->prepare('INSERT INTO users(login, name, class_id, pass_hash, role, created_ts, active)
                              VALUES(?,?,?,?,?,?,1)');
    $st->execute([$login, kurs_norm_name($name), $classId, $hash, $role, kurs_now()]);
    $id = (int) kurs_db()->lastInsertId();
    kurs_audit('user.create', $role . ' ' . $login);
    return kurs_find_user_by_id($id) ?? ['id' => $id, 'login' => $login, 'role' => $role];
}

function kurs_login_session(array $user): void
{
    kurs_start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $user['id'];
    $_SESSION['role'] = (string) $user['role'];
    $_SESSION['login_ts'] = kurs_now();
    kurs_csrf_token();
    kurs_db()->prepare('UPDATE users SET last_login_ts = ?, failed_logins = 0, locked_until = 0 WHERE id = ?')
        ->execute([kurs_now(), (int) $user['id']]);
    kurs_audit('login.ok', (string) $user['login']);
}

function kurs_logout_session(): void
{
    kurs_start_session();
    kurs_audit('logout', (string) ($_SESSION['login'] ?? ''));
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

/**
 * Проверка пароля с учётом блокировки после нескольких неудач.
 * Возвращает ['ok'=>bool,'error'=>string,'user'=>?array]
 */
function kurs_try_login(string $login, string $password): array
{
    $pdo = kurs_db();
    $user = kurs_find_user_by_login($login);
    if (!$user) {
        /* одинаковая задержка: по времени ответа нельзя узнать, есть ли такой логин */
        password_verify($password, '$2y$12$usesomesillystringforpaddingpaddingpaddingpaddingpad');
        usleep(350000);
        return ['ok' => false, 'error' => 'Неверный логин или пароль', 'user' => null];
    }
    if ((int) $user['active'] !== 1) {
        return ['ok' => false, 'error' => 'Учётная запись отключена. Обратитесь к преподавателю.', 'user' => null];
    }
    $now = kurs_now();
    if ((int) $user['locked_until'] > $now) {
        $left = (int) ceil(((int) $user['locked_until'] - $now) / 60);
        return ['ok' => false, 'error' => 'Слишком много неудачных попыток. Повторите через ' . $left . ' мин.', 'user' => null];
    }
    if (!password_verify($password, (string) $user['pass_hash'])) {
        $failed = (int) $user['failed_logins'] + 1;
        $lock = $failed >= KURS_MAX_FAILED ? $now + KURS_LOCK_SECONDS : 0;
        $pdo->prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
            ->execute([$failed, $lock, (int) $user['id']]);
        kurs_audit('login.fail', $login . ' (' . $failed . ')');
        usleep(350000);
        $left = max(1, KURS_MAX_FAILED - $failed);
        return [
            'ok' => false,
            'error' => $lock ? 'Слишком много неудачных попыток. Вход закрыт на 10 минут.'
                             : 'Неверный логин или пароль. Осталось попыток: ' . $left,
            'user' => null,
        ];
    }
    if (kurs_password_needs_rehash((string) $user['pass_hash'])) {
        $pdo->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')
            ->execute([kurs_hash_password($password), (int) $user['id']]);
    }
    return ['ok' => true, 'error' => '', 'user' => $user];
}

function kurs_change_password(int $userId, string $newPassword, string $role): void
{
    $min = kurs_min_password($role);
    if (strlen($newPassword) < $min) {
        kurs_fail('Пароль короче ' . $min . ' символов', 400);
    }
    kurs_db()->prepare('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?')
        ->execute([kurs_hash_password($newPassword), $userId]);
    kurs_audit('password.change', 'user#' . $userId);
}
