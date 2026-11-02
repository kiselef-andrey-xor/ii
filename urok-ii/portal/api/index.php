<?php
/**
 * api/index.php — единая точка входа API портала.
 *
 * Все вызовы: api/index.php?a=<действие>
 * POST-запросы обязательно содержат заголовок X-CSRF-Token (токен выдаёт ?a=bootstrap).
 *
 * Действия:
 *   bootstrap          — состояние портала: кто вошёл, csrf, уроки, настройки
 *   register           — самостоятельная регистрация ученика
 *   login / logout     — вход и выход
 *   session            — профиль + прогресс + попытки
 *   change_password    — смена своего пароля
 *   lessons            — список разделов с состоянием «открыт / закрыт»
 *   progress (GET/POST)— прочитать / сохранить прогресс прохождения
 *   test (GET)         — выдать вариант (без правильных ответов!)
 *   test (POST)        — проверить ответы, сохранить попытку, вернуть разбор и код
 *   results            — журнал (преподаватель)
 *   stats              — сводка по темам (преподаватель)
 *   teacher            — действия кабинета (преподаватель)
 *   export             — CSV / JSON журнала (преподаватель)
 *   health             — диагностика установки
 */

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$action = (string) ($_GET['a'] ?? $_POST['a'] ?? '');
$method = kurs_method();

try {
    switch ($action) {
        case 'bootstrap':       api_bootstrap(); break;
        case 'register':        require_post(); api_register(); break;
        case 'login':           require_post(); api_login(); break;
        case 'logout':          require_post(); api_logout(); break;
        case 'session':         api_session(); break;
        case 'change_password': require_post(); api_change_password(); break;
        case 'lessons':         api_lessons(); break;
        case 'progress':        api_progress($method); break;
        case 'test':            api_test($method); break;
        case 'results':         api_results(); break;
        case 'stats':           api_stats(); break;
        case 'teacher':         require_post(); api_teacher(); break;
        case 'export':          api_export(); break;
        case 'health':          api_health(); break;
        default:
            kurs_fail('Неизвестное действие: ' . $action, 404);
    }
} catch (Throwable $e) {
    kurs_audit('error', $action . ': ' . $e->getMessage());
    $public = strpos($e->getMessage(), 'Каталог данных') === 0;
    kurs_fail($public ? $e->getMessage() : 'Внутренняя ошибка сервера (' . $action . ')', 500,
        ['hint' => $public ? '' : 'Смотрите api/index.php?a=health и error_log']);
}

function require_post(): void
{
    if (kurs_method() !== 'POST') {
        kurs_fail('Нужен POST-запрос', 405);
    }
}

/* ------------------------------------------------------------------ bootstrap */

function api_bootstrap(): void
{
    $u = kurs_current_user();
    $lessons = [];
    foreach (kurs_course_lessons() as $id) {
        $bank = kurs_bank($id);
        $lessons[] = [
            'id' => $id,
            'title' => (string) $bank['title'],
            'subtitle' => (string) ($bank['subtitle'] ?? ''),
            'bank' => count($bank['questions']),
            'topics' => count($bank['topics'] ?? []),
            'count' => kurs_variant_count($id),
            'threshold' => kurs_threshold($id),
        ];
    }
    kurs_ok([
        'user' => kurs_public_user($u),
        'csrf' => kurs_csrf_token(),
        'https' => kurs_is_https(),
        'installed' => kurs_setting_int('installed', 0, 0, 1) === 1,
        'school' => kurs_setting('school_name', ''),
        'self_register' => kurs_setting_int('allow_self_register', 1, 0, 1) === 1,
        'min_pass' => $u && $u['role'] === 'teacher' ? kurs_min_password('teacher') : kurs_min_password('student'),
        'lessons' => $lessons,
        'require_test_for_next' => kurs_setting_int('require_test_for_next', 1, 0, 1) === 1,
        'open_final' => kurs_setting_int('open_final', 0, 0, 1) === 1,
        'base' => kurs_base_url(),
        'algo' => kurs_password_algo_name(),
    ]);
}

/* ------------------------------------------------------------------- register */

function api_register(): void
{
    if (kurs_setting_int('installed', 0, 0, 1) !== 1) {
        kurs_fail('Портал ещё не установлен: откройте admin/install.php', 409);
    }
    if (kurs_setting_int('allow_self_register', 1, 0, 1) !== 1) {
        kurs_fail('Самостоятельная регистрация отключена. Аккаунт создаст преподаватель.', 403);
    }
    if (!kurs_rate_limit('register', 20, 3600)) {
        kurs_fail('Слишком много попыток регистрации с этого компьютера. Повторите позже.', 429);
    }

    $name = kurs_in_str('name', '', 60);
    $login = strtolower(kurs_in_str('login', '', 24));
    $pass = (string) (kurs_input()['password'] ?? '');
    $className = kurs_in_str('class_name', '', 24);
    $min = kurs_min_password('student');

    if (mb_strlen($name) < 3) {
        kurs_fail('Введите фамилию и имя полностью', 400);
    }
    if (!kurs_valid_login($login)) {
        kurs_fail('Логин: 3–24 символа, латинские буквы, цифры, точка, подчёркивание или дефис', 400);
    }
    if (strlen($pass) < $min) {
        kurs_fail('Пароль должен быть не короче ' . $min . ' символов', 400);
    }
    if ($pass === $login || $pass === $name) {
        kurs_fail('Пароль не должен совпадать с логином или именем', 400);
    }
    if ($className === '') {
        kurs_fail('Укажите класс (например, 10Б)', 400);
    }

    $pdo = kurs_db();
    if (kurs_find_user_by_login($login)) {
        kurs_fail('Такой логин уже занят. Придумайте другой или войдите.', 409);
    }
    /* класс создаётся при первой регистрации ученика из этого класса */
    $st = $pdo->prepare('SELECT id FROM classes WHERE name = ? LIMIT 1');
    $st->execute([$className]);
    $row = $st->fetch();
    if ($row) {
        $classId = (int) $row['id'];
    } else {
        $pdo->prepare('INSERT INTO classes(name, active, created_ts) VALUES(?, 1, ?)')
            ->execute([$className, kurs_now()]);
        $classId = (int) $pdo->lastInsertId();
    }
    $user = kurs_create_user($login, $name, $pass, 'student', $classId);
    kurs_login_session($user);
    kurs_audit('register', $login . ' / ' . $className);
    kurs_ok(['user' => kurs_public_user(kurs_find_user_by_id((int) $user['id'])), 'csrf' => kurs_csrf_token()]);
}

/* ---------------------------------------------------------------------- login */

function api_login(): void
{
    if (!kurs_rate_limit('login', 30, 900)) {
        kurs_fail('Слишком много попыток входа с этого компьютера. Подождите 15 минут.', 429);
    }
    $login = strtolower(kurs_in_str('login', '', 24));
    $pass = (string) (kurs_input()['password'] ?? '');
    if ($login === '' || $pass === '') {
        kurs_fail('Введите логин и пароль', 400);
    }
    $res = kurs_try_login($login, $pass);
    if (!$res['ok']) {
        kurs_fail((string) $res['error'], 401);
    }
    kurs_login_session($res['user']);
    $u = kurs_find_user_by_id((int) $res['user']['id']);
    kurs_ok(['user' => kurs_public_user($u), 'csrf' => kurs_csrf_token()]);
}

function api_logout(): void
{
    kurs_check_csrf();
    kurs_logout_session();
    kurs_ok();
}

/* -------------------------------------------------------------------- session */

function api_session(): void
{
    $u = kurs_require_user();
    $state = kurs_user_state($u);
    kurs_ok([
        'user' => kurs_public_user($u),
        'csrf' => kurs_csrf_token(),
        'progress' => $state['progress'],
        'attempts' => $state['attempts'],
    ]);
}

function api_change_password(): void
{
    kurs_check_csrf();
    $u = kurs_require_user();
    $old = (string) (kurs_input()['old_password'] ?? '');
    $new = (string) (kurs_input()['new_password'] ?? '');
    if (!password_verify($old, (string) $u['pass_hash'])) {
        usleep(300000);
        kurs_fail('Текущий пароль неверный', 403);
    }
    kurs_change_password((int) $u['id'], $new, (string) $u['role']);
    kurs_ok(['min_pass' => kurs_min_password((string) $u['role'])]);
}

/* -------------------------------------------------------------------- lessons */

function api_lessons(): void
{
    $u = kurs_current_user();
    if (!$u) {
        kurs_fail('Нужно войти в портал', 401);
    }
    $teacher = $u['role'] === 'teacher';
    $state = $teacher ? ['progress' => [], 'attempts' => []] : kurs_user_state($u);
    $items = [];
    foreach (kurs_course_lessons() as $id) {
        $bank = kurs_bank($id);
        $open = kurs_lesson_open_for($u, $id);
        $meta = kurs_lesson_meta(kurs_lesson_file($id, $teacher));
        $best = null;
        foreach ($state['attempts'] as $a) {
            if ($a['lesson'] !== $id) {
                continue;
            }
            if ($best === null || $a['pct'] > $best['pct']) {
                $best = $a;
            }
        }
        $items[] = [
            'id' => $id,
            'title' => (string) $bank['title'],
            'subtitle' => (string) ($bank['subtitle'] ?? ''),
            'open' => $open,
            'file' => kurs_lesson_file($id, $teacher),
            'progress' => $state['progress'][$id] ?? null,
            'best' => $best,
            'count' => kurs_variant_count($id),
            'threshold' => kurs_threshold($id),
            'test_file' => $id === 'u1' ? 'kursy/test-urok-1.html' : null,
            'keyword' => (string) $meta['keyword'],
            'slides' => (int) $meta['slides'],
            'url' => 'course.php?f=' . rawurlencode(kurs_lesson_file($id, $teacher)),
            'test_url' => 'test.php?u=' . $id,
        ];
    }
    $items[] = [
        'id' => 'final',
        'title' => 'Финальный проект · зачёт',
        'subtitle' => '6 команд по 4 человека, защита без интернета',
        'open' => kurs_lesson_open_for($u, 'final'),
        'file' => kurs_lesson_file('final', $teacher),
        'progress' => null,
        'best' => null,
        'count' => 0,
        'threshold' => 60,
        'test_file' => null,
        'keyword' => (string) kurs_lesson_meta(kurs_lesson_file('final', $teacher))['keyword'],
        'slides' => (int) kurs_lesson_meta(kurs_lesson_file('final', $teacher))['slides'],
        'url' => 'course.php?f=' . rawurlencode(kurs_lesson_file('final', $teacher)),
        'test_url' => null,
    ];
    if ($teacher) {
        $items[] = [
            'id' => 'prepod',
            'title' => 'Весь курс с заметками преподавателю',
            'subtitle' => '107 слайдов, заметки и методические памятки',
            'open' => true,
            'file' => 'kursy/prepod.html',
            'progress' => null,
            'best' => null,
            'count' => 0,
            'threshold' => 0,
            'test_file' => null,
            'keyword' => (string) kurs_lesson_meta('kursy/prepod.html')['keyword'],
            'slides' => (int) kurs_lesson_meta('kursy/prepod.html')['slides'],
            'url' => 'course.php?f=' . rawurlencode('kursy/prepod.html'),
            'test_url' => null,
        ];
    }
    kurs_ok(['lessons' => $items, 'require_test_for_next' => kurs_setting_int('require_test_for_next', 1, 0, 1) === 1]);
}

/* ------------------------------------------------------------------- progress */

function api_progress(string $method): void
{
    $u = kurs_require_user();
    $pdo = kurs_db();

    if ($method === 'GET') {
        $lesson = (string) ($_GET['lesson'] ?? '');
        if (!isset(KURS_LESSONS[$lesson])) {
            kurs_fail('Неизвестный урок', 400);
        }
        $st = $pdo->prepare('SELECT * FROM progress WHERE user_id = ? AND lesson = ?');
        $st->execute([(int) $u['id'], $lesson]);
        $row = $st->fetch();
        if (!$row) {
            kurs_ok(['found' => false, 'lesson' => $lesson]);
        }
        $visited = json_decode((string) $row['visited'], true) ?: [];
        ksort($visited, SORT_NUMERIC);
        kurs_ok([
            'found' => true,
            'lesson' => $lesson,
            'unlocked' => (int) $row['unlocked'],
            'visited' => $visited,
            'position' => (int) $row['position'],
            'updated_ts' => (int) $row['updated_ts'],
        ]);
        return;
    }

    kurs_check_csrf();
    $in = kurs_input();
    $lesson = (string) ($in['lesson'] ?? '');
    if (!isset(KURS_LESSONS[$lesson])) {
        kurs_fail('Неизвестный урок', 400);
    }
    $unlocked = max(0, (int) ($in['unlocked'] ?? 0));
    $position = max(0, (int) ($in['position'] ?? 0));
    $visited = (isset($in['visited']) && is_array($in['visited'])) ? $in['visited'] : [];
    /* ключи — номера слайдов, значения — 1; приводим к целым и сортируем */
    $clean = [];
    foreach ($visited as $k => $v) {
        $ki = (int) $k;
        if ($ki >= 0 && $ki < 10000) {
            $clean[(string) $ki] = 1;
        }
    }
    ksort($clean, SORT_NUMERIC);
    if (count($clean) > 2000) {
        kurs_fail('Слишком большое состояние прогресса', 400);
    }
    $tasksDone = max(0, (int) ($in['tasks_done'] ?? 0));
    $tasksAll = max(0, (int) ($in['tasks_all'] ?? 0));

    $state = ['unlocked' => $unlocked, 'visited' => $clean, 'position' => $position];
    $sig = kurs_sign_progress($state);
    $pdo->prepare('INSERT INTO progress(user_id, lesson, unlocked, visited, position, tasks_done, tasks_all, updated_ts, sig)
                   VALUES(?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(user_id, lesson) DO UPDATE SET
                     unlocked = excluded.unlocked, visited = excluded.visited, position = excluded.position,
                     tasks_done = excluded.tasks_done, tasks_all = excluded.tasks_all,
                     updated_ts = excluded.updated_ts, sig = excluded.sig')
        ->execute([(int) $u['id'], $lesson, $unlocked, json_encode($clean, JSON_UNESCAPED_UNICODE),
                   $position, $tasksDone, $tasksAll, kurs_now(), $sig]);
    kurs_ok(['saved' => true, 'unlocked' => $unlocked, 'sig' => $sig]);
}

/* ----------------------------------------------------------------------- test */

function api_test(string $method): void
{
    $u = kurs_require_user();
    $lesson = (string) ($_GET['u'] ?? kurs_in_str('u', ''));
    if (!kurs_lesson_valid($lesson)) {
        kurs_fail('Неизвестный урок', 400);
    }
    if (!kurs_lesson_open_for($u, $lesson)) {
        kurs_fail('Сначала сдайте тест предыдущего урока', 403);
    }

    if ($method === 'GET') {
        if (!kurs_rate_limit('test-get', 60, 900)) {
            kurs_fail('Слишком много вариантов запрошено. Подождите несколько минут.', 429);
        }
        $count = kurs_variant_count($lesson);
        kurs_start_session();
        $variant = kurs_variant_for_client($lesson, $count);
        $_SESSION['variant_' . $lesson] = [
            'ids' => array_map(static function ($q) {
                return (int) $q['id'];
            }, $variant['questions']),
            'variant_no' => $variant['variant_no'],
            'nonce' => $variant['nonce'],
            'started' => $variant['started'],
        ];
        kurs_ok([
            'lesson' => $lesson,
            'title' => kurs_bank($lesson)['title'],
            'colors' => kurs_bank($lesson)['colors'] ?? [],
            'questions' => $variant['questions'],
            'count' => $variant['count'],
            'bank_size' => $variant['bank_size'],
            'variant_no' => $variant['variant_no'],
            'threshold' => kurs_threshold($lesson),
            'csrf' => kurs_csrf_token(),
        ]);
        return;
    }

    kurs_check_csrf();
    kurs_start_session();
    $key = 'variant_' . $lesson;
    if (empty($_SESSION[$key]) || !is_array($_SESSION[$key])) {
        kurs_fail('Вариант не найден или истёк. Нажмите «Начать тест» заново.', 409);
    }
    $variant = $_SESSION[$key];
    if (!kurs_rate_limit('test-post', 40, 900)) {
        kurs_fail('Слишком много попыток сдачи. Подождите несколько минут.', 429);
    }

    $in = kurs_input();
    $answers = (isset($in['answers']) && is_array($in['answers'])) ? $in['answers'] : [];
    $sec = max(0, (int) ($in['sec'] ?? 0));
    if ($sec > 6 * 3600) {
        $sec = 6 * 3600;
    }
    $started = (int) ($variant['started'] ?? kurs_now());
    if ($sec === 0) {
        $sec = max(1, kurs_now() - $started);
    }
    $expected = $variant['ids'];
    if (count($answers) !== count($expected)) {
        kurs_fail('Ответов должно быть ' . count($expected) . ', получено ' . count($answers), 400);
    }
    $sentIds = [];
    foreach ($answers as $a) {
        $sentIds[] = is_array($a) ? (int) ($a['id'] ?? -1) : -1;
    }
    sort($sentIds);
    $want = $expected;
    sort($want);
    if ($sentIds !== $want) {
        kurs_fail('Ответы не соответствуют выданному варианту. Обновите тест.', 400);
    }

    $result = kurs_grade_attempt($lesson, ['questions' => array_map(static function ($id) {
        return ['id' => $id];
    }, $expected)], $answers, $sec);

    $bank = kurs_bank($lesson);
    $mask = kurs_topic_mask($result['per_topic'], $bank['topics'] ?? []);
    $code = kurs_make_code(
        (string) $bank['prefix'],
        (string) $u['name'],
        (string) ($u['class_name'] ?? ''),
        kurs_now(),
        (int) $variant['variant_no'],
        (int) $result['right'],
        (int) $result['total'],
        (int) $result['sec'],
        $mask,
        (string) $variant['nonce']
    );

    kurs_save_attempt([
        'user_id' => (int) $u['id'],
        'name' => (string) $u['name'],
        'group' => (string) ($u['class_name'] ?? ''),
        'lesson' => $lesson,
        'variant' => (int) $variant['variant_no'],
        'question_ids' => $expected,
        'answers' => $answers,
        'right' => $result['right'],
        'total' => $result['total'],
        'sec' => $result['sec'],
        'pct' => $result['pct'],
        'grade' => $result['grade'],
        'per_topic' => $result['per_topic'],
        'code' => $code['code'],
        'crc' => $code['crc'],
        'nonce' => (string) $variant['nonce'],
        'source' => 'web',
    ]);
    unset($_SESSION[$key]);
    kurs_audit('test.submit', $lesson . ' ' . $result['right'] . '/' . $result['total']);

    kurs_ok([
        'lesson' => $lesson,
        'right' => $result['right'],
        'total' => $result['total'],
        'pct' => $result['pct'],
        'grade' => $result['grade'],
        'threshold' => $result['threshold'],
        'passed' => $result['pct'] >= $result['threshold'],
        'sec' => $result['sec'],
        'per_topic' => $result['per_topic'],
        'weak' => $result['weak'],
        'detail' => $result['detail'],
        'code' => $code['code'],
    ]);
}

/* -------------------------------------------------------------------- results */

function api_results(): void
{
    $u = kurs_require_teacher();
    $rows = kurs_journal(kurs_db(), [
        'lesson' => (string) ($_GET['lesson'] ?? ''),
        'class_id' => (int) ($_GET['class_id'] ?? 0) ?: null,
        'best' => !empty($_GET['best']),
        'q' => kurs_trim((string) ($_GET['q'] ?? ''), 60),
    ]);
    kurs_ok([
        'rows' => array_map(static function ($r) {
            return [
                'id' => (int) $r['id'],
                'name' => (string) $r['name'],
                'login' => (string) ($r['login'] ?? ''),
                'class' => (string) ($r['class_name'] ?? $r['group_name'] ?? ''),
                'lesson' => (string) $r['lesson'],
                'variant' => (int) $r['variant_no'],
                'right' => (int) $r['right_cnt'],
                'total' => (int) $r['total'],
                'pct' => (int) $r['pct'],
                'grade' => (int) $r['grade'],
                'sec' => (int) $r['sec'],
                'ts' => (int) $r['ts'],
                'date' => kurs_date_ru((int) $r['ts']) . ' ' . kurs_time_ru((int) $r['ts']),
                'weak' => array_keys(array_filter(
                    json_decode((string) $r['per_topic'], true) ?: [],
                    static function ($v) {
                        return (int) $v['ok'] < (int) $v['all'];
                    }
                )),
                'code' => (string) $r['code'],
                'source' => (string) $r['source'],
            ];
        }, $rows),
        'count' => count($rows),
    ]);
}

function api_stats(): void
{
    kurs_require_teacher();
    $pdo = kurs_db();
    $classId = (int) ($_GET['class_id'] ?? 0) ?: null;
    $lesson = (string) ($_GET['lesson'] ?? '') ?: null;
    $topics = kurs_topic_stats($pdo, $lesson, $classId);

    /* кто где застрял */
    $st = $pdo->prepare('SELECT u.id, u.name, u.login, c.name AS class_name, p.lesson, p.unlocked, p.position, p.tasks_done, p.tasks_all, p.updated_ts
                         FROM users u
                         LEFT JOIN classes c ON c.id = u.class_id
                         LEFT JOIN progress p ON p.user_id = u.id
                         WHERE u.role = \'student\' AND u.active = 1
                         ORDER BY c.name, u.name');
    $st->execute();
    $people = [];
    foreach ($st->fetchAll() as $r) {
        $key = (int) $r['id'];
        if (!isset($people[$key])) {
            $people[$key] = [
                'id' => $key,
                'name' => (string) $r['name'],
                'login' => (string) $r['login'],
                'class' => (string) ($r['class_name'] ?? ''),
                'lessons' => [],
            ];
        }
        if ($r['lesson']) {
            $people[$key]['lessons'][$r['lesson']] = [
                'unlocked' => (int) $r['unlocked'],
                'position' => (int) $r['position'],
                'tasks_done' => (int) $r['tasks_done'],
                'tasks_all' => (int) $r['tasks_all'],
                'updated' => kurs_date_ru((int) $r['updated_ts']) . ' ' . kurs_time_ru((int) $r['updated_ts']),
            ];
        }
    }

    /* оценки: лучший результат по каждому уроку */
    $st = $pdo->prepare('SELECT user_id, lesson, MAX(pct) AS best_pct, COUNT(*) AS tries
                         FROM attempts WHERE user_id IS NOT NULL GROUP BY user_id, lesson');
    $st->execute();
    $grades = [];
    foreach ($st->fetchAll() as $r) {
        $grades[(int) $r['user_id']][(string) $r['lesson']] = [
            'pct' => (int) $r['best_pct'],
            'grade' => kurs_grade((int) $r['best_pct'], kurs_threshold((string) $r['lesson'])),
            'tries' => (int) $r['tries'],
        ];
    }
    foreach ($people as $id => &$p) {
        $p['grades'] = $grades[$id] ?? [];
    }
    unset($p);

    $st = $pdo->query('SELECT id, name, active FROM classes ORDER BY name');
    kurs_ok([
        'topics' => $topics,
        'people' => array_values($people),
        'classes' => $st->fetchAll(),
        'attempts_total' => (int) $pdo->query('SELECT COUNT(*) FROM attempts')->fetchColumn(),
    ]);
}

/* -------------------------------------------------------------------- teacher */

function api_teacher(): void
{
    $u = kurs_require_teacher();
    kurs_check_csrf();
    $op = (string) ($_GET['op'] ?? kurs_in_str('op', ''));
    $pdo = kurs_db();
    $in = kurs_input();

    switch ($op) {
        case 'set_settings': {
            $map = [
                'threshold_default' => [1, 100],
                'threshold_u1' => [0, 100],
                'threshold_u2' => [0, 100],
                'threshold_u3' => [0, 100],
                'threshold_u4' => [0, 100],
                'count_u1' => [5, 200],
                'count_u2' => [5, 200],
                'count_u3' => [5, 200],
                'count_u4' => [5, 200],
                'require_test_for_next' => [0, 1],
                'open_final' => [0, 1],
                'allow_self_register' => [0, 1],
                'two_factor_teacher' => [0, 1],
                'min_pass_student' => [4, 32],
                'min_pass_teacher' => [6, 64],
            ];
            foreach ($map as $key => $range) {
                if (array_key_exists($key, $in)) {
                    $v = (int) $in[$key];
                    kurs_set_setting($key, (string) max($range[0], min($range[1], $v)));
                }
            }
            if (array_key_exists('school_name', $in)) {
                kurs_set_setting('school_name', kurs_in_str('school_name', '', 80));
            }
            kurs_settings_reset();
            kurs_audit('settings.update', implode(',', array_keys($in)));
            kurs_ok(['saved' => true]);
            break;
        }

        case 'import_codes': {
            $text = (string) ($in['text'] ?? '');
            $lessonFilter = (string) ($in['lesson'] ?? '');
            $codes = kurs_split_codes($text);
            $added = 0;
            $dup = 0;
            $bad = [];
            foreach ($codes as $code) {
                $r = kurs_parse_code($code, $lessonFilter);
                if (!empty($r['bad'])) {
                    $bad[] = ['code' => mb_substr($code, 0, 80), 'reason' => (string) $r['reason']];
                    continue;
                }
                $st = $pdo->prepare('SELECT id FROM attempts WHERE code = ? AND source <> ? LIMIT 1');
                $st->execute([$r['code'], 'invalid']);
                if ($st->fetch()) {
                    $dup++;
                    continue;
                }
                /* ищем ученика по имени и классу, чтобы привязать попытку к аккаунту */
                $userId = null;
                $st = $pdo->prepare('SELECT id FROM users WHERE role = \'student\' AND UPPER(name) = ? LIMIT 1');
                $st->execute([kurs_norm_name($r['name'])]);
                $row = $st->fetch();
                if ($row) {
                    $userId = (int) $row['id'];
                }
                kurs_save_attempt([
                    'user_id' => $userId,
                    'name' => $r['name'],
                    'group' => $r['group'],
                    'lesson' => $r['lesson'],
                    'variant' => $r['variant'],
                    'question_ids' => [],
                    'answers' => [],
                    'right' => $r['right'],
                    'total' => $r['total'],
                    'sec' => $r['sec'],
                    'pct' => $r['pct'],
                    'grade' => kurs_grade($r['pct'], kurs_threshold($r['lesson'])),
                    'per_topic' => $r['per_topic'],
                    'code' => $r['code'],
                    'crc' => (string) $r['crc'],
                    'ts' => (int) $r['ts'],
                    'nonce' => (string) $r['nonce'],
                    'source' => 'paste',
                ]);
                $added++;
            }
            kurs_audit('codes.import', '+' . $added . ' dup:' . $dup . ' bad:' . count($bad));
            kurs_ok(['added' => $added, 'duplicates' => $dup, 'invalid' => $bad, 'parsed' => count($codes)]);
            break;
        }

        case 'manual_result': {
            $name = kurs_norm_name(kurs_in_str('name', '', 40));
            $group = kurs_in_str('group', '', 16);
            $lesson = (string) ($in['lesson'] ?? '');
            $right = (int) ($in['right'] ?? -1);
            $total = (int) ($in['total'] ?? -1);
            if ($name === '' || !kurs_lesson_valid($lesson) || $right < 0 || $total <= 0 || $right > $total) {
                kurs_fail('Проверьте поля: имя, урок, «верно» и «всего»', 400);
            }
            $pct = (int) round($right * 100 / $total);
            $ts = kurs_now();
            $bank = kurs_bank($lesson);
            $code = kurs_make_code((string) $bank['prefix'], $name, $group, $ts, 0, $right, $total,
                (int) ($in['sec'] ?? 0), str_repeat('z', count($bank['topics'])), 'man0');
            kurs_save_attempt([
                'user_id' => null, 'name' => $name, 'group' => $group, 'lesson' => $lesson,
                'variant' => 0, 'question_ids' => [], 'answers' => [],
                'right' => $right, 'total' => $total, 'sec' => (int) ($in['sec'] ?? 0),
                'pct' => $pct, 'grade' => kurs_grade($pct, kurs_threshold($lesson)),
                'per_topic' => [], 'code' => $code['code'], 'crc' => $code['crc'],
                'ts' => $ts, 'nonce' => 'man0', 'source' => 'manual',
            ]);
            kurs_audit('manual.result', $lesson . ' ' . $name . ' ' . $right . '/' . $total);
            kurs_ok(['saved' => true, 'pct' => $pct, 'grade' => kurs_grade($pct, kurs_threshold($lesson)), 'code' => $code['code']]);
            break;
        }

        case 'delete_attempt': {
            $id = (int) ($in['id'] ?? 0);
            if ($id <= 0) {
                kurs_fail('Не указан номер записи', 400);
            }
            $pdo->prepare('DELETE FROM attempts WHERE id = ?')->execute([$id]);
            kurs_audit('attempt.delete', 'id=' . $id);
            kurs_ok(['deleted' => $id]);
            break;
        }

        case 'users': {
            $st = $pdo->query('SELECT u.id, u.login, u.name, u.role, u.active, u.last_login_ts, u.must_change,
                                      c.id AS class_id, c.name AS class_name
                               FROM users u LEFT JOIN classes c ON c.id = u.class_id
                               ORDER BY u.role DESC, c.name, u.name');
            kurs_ok(['users' => $st->fetchAll()]);
            break;
        }

        case 'create_user': {
            $login = strtolower(kurs_in_str('login', '', 24));
            $name = kurs_in_str('name', '', 60);
            $pass = (string) ($in['password'] ?? '');
            $role = ($in['role'] ?? 'student') === 'teacher' ? 'teacher' : 'student';
            $classId = (int) ($in['class_id'] ?? 0) ?: null;
            if (!kurs_valid_login($login)) {
                kurs_fail('Логин: 3–24 символа, латиница, цифры, . _ -', 400);
            }
            if (mb_strlen($name) < 3) {
                kurs_fail('Введите фамилию и имя', 400);
            }
            if (strlen($pass) < kurs_min_password($role)) {
                kurs_fail('Пароль короче ' . kurs_min_password($role) . ' символов', 400);
            }
            if (kurs_find_user_by_login($login)) {
                kurs_fail('Логин уже занят', 409);
            }
            $user = kurs_create_user($login, $name, $pass, $role, $classId);
            $pdo->prepare('UPDATE users SET must_change = 1 WHERE id = ?')->execute([(int) $user['id']]);
            kurs_ok(['created' => kurs_public_user(kurs_find_user_by_id((int) $user['id']))]);
            break;
        }

        case 'reset_password': {
            $id = (int) ($in['user_id'] ?? 0);
            $pass = (string) ($in['password'] ?? '');
            $target = kurs_find_user_by_id($id);
            if (!$target) {
                kurs_fail('Пользователь не найден', 404);
            }
            if ($target['role'] === 'teacher' && (int) $target['id'] !== (int) $u['id']) {
                kurs_fail('Пароль другого преподавателя может сбросить только он сам', 403);
            }
            if (strlen($pass) < kurs_min_password((string) $target['role'])) {
                kurs_fail('Пароль короче ' . kurs_min_password((string) $target['role']) . ' символов', 400);
            }
            $pdo->prepare('UPDATE users SET pass_hash = ?, failed_logins = 0, locked_until = 0, must_change = 1 WHERE id = ?')
                ->execute([kurs_hash_password($pass), $id]);
            kurs_audit('password.reset', 'user#' . $id);
            kurs_ok(['reset' => $id]);
            break;
        }

        case 'toggle_user': {
            $id = (int) ($in['user_id'] ?? 0);
            $target = kurs_find_user_by_id($id);
            if (!$target) {
                kurs_fail('Пользователь не найден', 404);
            }
            if ($target['role'] === 'teacher') {
                kurs_fail('Преподавателя отключить нельзя', 403);
            }
            $new = (int) $target['active'] === 1 ? 0 : 1;
            $pdo->prepare('UPDATE users SET active = ? WHERE id = ?')->execute([$new, $id]);
            kurs_audit('user.toggle', 'user#' . $id . ' -> ' . $new);
            kurs_ok(['active' => $new]);
            break;
        }

        case 'classes': {
            $st = $pdo->query('SELECT c.id, c.name, c.active,
                                      (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = \'student\') AS students
                               FROM classes c ORDER BY c.name');
            kurs_ok(['classes' => $st->fetchAll()]);
            break;
        }

        case 'create_class': {
            $name = kurs_in_str('name', '', 24);
            if ($name === '') {
                kurs_fail('Введите название класса', 400);
            }
            $pdo->prepare('INSERT OR IGNORE INTO classes(name, active, created_ts) VALUES(?, 1, ?)')
                ->execute([$name, kurs_now()]);
            kurs_audit('class.create', $name);
            kurs_ok(['created' => $name]);
            break;
        }

        case 'final': {
            $groupNo = (int) ($in['group_no'] ?? 0);
            $member = kurs_in_str('member_name', '', 40);
            if ($groupNo < 1 || $groupNo > 12 || $member === '') {
                kurs_fail('Нужны номер группы (1–12) и имя участника', 400);
            }
            $minItems = (isset($in['min_items']) && is_array($in['min_items'])) ? $in['min_items'] : [];
            $jury = max(0, min(100, (int) ($in['jury_score'] ?? 0)));
            $peer = max(0, min(20, (int) ($in['peer_score'] ?? 0)));
            $bonus = max(0, min(20, (int) ($in['bonus'] ?? 0)));
            $total = $jury + $bonus;
            $minClosed = 0;
            foreach ($minItems as $k => $v) {
                if ($v) {
                    $minClosed++;
                }
            }
            $threshold = kurs_setting_int('final_threshold', 60, 1, 100);
            $passed = ($total >= $threshold && $minClosed >= 7) ? 1 : 0;
            $userId = null;
            $st = $pdo->prepare('SELECT id FROM users WHERE role = \'student\' AND UPPER(name) = ? LIMIT 1');
            $st->execute([kurs_norm_name($member)]);
            $row = $st->fetch();
            if ($row) {
                $userId = (int) $row['id'];
            }
            $pdo->prepare('INSERT INTO final_groups(group_no, theme, user_id, member_name, role, min_items,
                                                    jury_score, peer_score, bonus, total, passed, note, updated_ts)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                           ON CONFLICT(group_no, member_name) DO UPDATE SET
                             theme = excluded.theme, user_id = COALESCE(excluded.user_id, final_groups.user_id),
                             role = excluded.role, min_items = excluded.min_items, jury_score = excluded.jury_score,
                             peer_score = excluded.peer_score, bonus = excluded.bonus, total = excluded.total,
                             passed = excluded.passed, note = excluded.note, updated_ts = excluded.updated_ts')
                ->execute([$groupNo, kurs_in_str('theme', '', 60), $userId, kurs_norm_name($member),
                           kurs_in_str('role', '', 30), json_encode($minItems, JSON_UNESCAPED_UNICODE),
                           $jury, $peer, $bonus, $total, $passed, kurs_in_str('note', '', 300), kurs_now()]);
            kurs_audit('final.save', 'группа ' . $groupNo . ' ' . $member . ' = ' . $total);
            kurs_ok(['saved' => true, 'total' => $total, 'passed' => $passed, 'min_closed' => $minClosed]);
            break;
        }

        case 'final_list': {
            $st = $pdo->query('SELECT * FROM final_groups ORDER BY group_no, member_name');
            kurs_ok(['groups' => $st->fetchAll()]);
            break;
        }

        case 'paper': {
            /* пустой вариант для печати: вопросы и варианты ответа, без правильных ответов */
            $lesson = (string) ($in['lesson'] ?? 'u1');
            if (!kurs_lesson_valid($lesson)) {
                kurs_fail('Неизвестный урок', 400);
            }
            $count = max(5, min(60, (int) ($in['count'] ?? kurs_variant_count($lesson))));
            $bank = kurs_bank($lesson);
            $v = kurs_build_variant($bank, $count);
            $items = [];
            foreach ($v['idx'] as $pos => $bi) {
                $q = $bank['questions'][$bi];
                $opts = [];
                foreach ($v['order'][$pos] as $k) {
                    $opts[] = $q['o'][$k];
                }
                $items[] = ['n' => $pos + 1, 't' => (string) $q['t'], 'q' => (string) $q['q'], 'o' => $opts];
            }
            kurs_audit('paper.build', $lesson . ' x' . $count);
            kurs_ok([
                'lesson' => $lesson,
                'title' => (string) $bank['title'],
                'variant_no' => $v['variant_no'] ?? random_int(10000, 99999),
                'items' => $items,
                'threshold' => kurs_threshold($lesson),
            ]);
            break;
        }

        case 'clear_results': {
            $lesson = (string) ($in['lesson'] ?? '');
            if ($lesson !== '' && kurs_lesson_valid($lesson)) {
                $pdo->prepare('DELETE FROM attempts WHERE lesson = ?')->execute([$lesson]);
                kurs_audit('results.clear', $lesson);
            } else {
                $pdo->exec('DELETE FROM attempts');
                kurs_audit('results.clear', 'все');
            }
            kurs_ok(['cleared' => true]);
            break;
        }

        default:
            kurs_fail('Неизвестное действие кабинета: ' . $op, 404);
    }
}

/* --------------------------------------------------------------------- export */

function api_export(): void
{
    kurs_require_teacher();
    $pdo = kurs_db();
    $format = (string) ($_GET['f'] ?? 'csv');
    $rows = kurs_journal($pdo, [
        'lesson' => (string) ($_GET['lesson'] ?? ''),
        'class_id' => (int) ($_GET['class_id'] ?? 0) ?: null,
        'best' => !empty($_GET['best']),
        'q' => kurs_trim((string) ($_GET['q'] ?? ''), 60),
    ]);
    $stamp = date('Ymd-His');
    if ($format === 'json') {
        kurs_send_json_file('zhurnal-' . $stamp . '.json', ['exported' => kurs_now(), 'rows' => $rows]);
    }
    if ($format === 'codes') {
        $codes = [];
        foreach ($rows as $r) {
            if (!empty($r['code'])) {
                $codes[] = $r['code'];
            }
        }
        if (!headers_sent()) {
            header('Content-Type: text/plain; charset=utf-8');
            header('Content-Disposition: attachment; filename="kody-' . $stamp . '.txt"');
        }
        echo implode("\n", $codes);
        exit;
    }
    kurs_send_csv('zhurnal-' . $stamp . '.csv', kurs_journal_csv($rows));
}

/* --------------------------------------------------------------------- health */

function api_health(): void
{
    $checks = [];
    $checks[] = ['name' => 'Версия PHP', 'ok' => version_compare(PHP_VERSION, '8.1.0', '>='),
                 'value' => PHP_VERSION, 'hint' => 'Нужна 8.1 или 8.2: Web Station → PHP-профиль'];
    $checks[] = ['name' => 'pdo_sqlite', 'ok' => extension_loaded('pdo_sqlite'),
                 'value' => extension_loaded('pdo_sqlite') ? 'есть' : 'нет',
                 'hint' => 'Включите расширение в профиле PHP (Web Station → Настройки сценария)'];
    $checks[] = ['name' => 'mbstring', 'ok' => extension_loaded('mbstring'),
                 'value' => extension_loaded('mbstring') ? 'есть' : 'нет', 'hint' => 'Включите расширение mbstring'];
    $checks[] = ['name' => 'Хэширование паролей', 'ok' => true,
                 'value' => kurs_password_algo_name(),
                 'hint' => defined('PASSWORD_ARGON2ID') ? '' : 'Argon2id недоступен — используется bcrypt (это нормально)'];
    $dir = kurs_data_dir();
    $dirOk = is_dir($dir) && is_writable($dir);
    $checks[] = ['name' => 'Каталог данных', 'ok' => $dirOk, 'value' => $dir,
                 'hint' => $dirOk ? '' : 'File Station → правый клик на папке kurs-data → Свойства → Права →'
                     . ' Создать: пользователь «everyone», Чтение + Запись, применить ко всем вложенным.'
                     . ' Если папки нет — создайте: Панель управления → Общая папка → Создать → kurs-data'];
    $dbOk = false;
    $dbMsg = '';
    try {
        $dbOk = kurs_db() instanceof PDO;
        $dbMsg = KURS_DB . (is_file(KURS_DB) ? ' (' . round(filesize(KURS_DB) / 1024, 1) . ' КБ)' : ' — будет создан');
    } catch (Throwable $e) {
        $dbMsg = $e->getMessage();
    }
    $checks[] = ['name' => 'База данных', 'ok' => $dbOk, 'value' => $dbMsg,
                 'hint' => $dbOk ? '' : 'Проверьте права на каталог и open_basedir профиля PHP'];
    $banks = [];
    foreach (kurs_lesson_ids() as $l) {
        try {
            $banks[$l] = count(kurs_bank($l)['questions']);
        } catch (Throwable $e) {
            $banks[$l] = 0;
        }
    }
    $checks[] = ['name' => 'Банки вопросов', 'ok' => !in_array(0, $banks, true),
                 'value' => implode(', ', array_map(static function ($k, $v) {
                     return strtoupper($k) . '=' . $v;
                 }, array_keys($banks), $banks)),
                 'hint' => 'Файлы banks/u1..u4.json должны лежать в папке портала'];
    $checks[] = ['name' => 'HTTPS', 'ok' => kurs_is_https(), 'value' => kurs_is_https() ? 'да' : 'нет',
                 'hint' => kurs_is_https() ? '' : 'Пароли идут открытым текстом. Включите HTTPS в DSM и обратном прокси.'];
    $srv = (string) ($_SERVER['SERVER_SOFTWARE'] ?? 'неизвестно');
    $isApache = stripos($srv, 'Apache') !== false;
    $checks[] = ['name' => 'Веб-сервер', 'ok' => true, 'value' => $srv,
                 'hint' => $isApache
                     ? 'Файлы .htaccess работают: каталоги kursy/, banks/ и lib/ закрыты'
                     : 'Это не Apache: .htaccess не сработает. Закройте каталоги kursy/, banks/ и lib/ '
                       . 'правилами nginx (см. admin/README-DEPLOY.md, раздел 6)'];
    $checks[] = ['name' => 'Установка завершена', 'ok' => kurs_setting_int('installed', 0, 0, 1) === 1,
                 'value' => kurs_setting_int('installed', 0, 0, 1) === 1 ? 'да' : 'нет',
                 'hint' => 'Откройте admin/install.php и задайте пароль преподавателя'];
    $teachers = 0;
    try {
        $teachers = (int) kurs_db()->query("SELECT COUNT(*) FROM users WHERE role = 'teacher'")->fetchColumn();
    } catch (Throwable $e) {
        $teachers = 0;
    }
    $checks[] = ['name' => 'Преподавателей в базе', 'ok' => $teachers > 0, 'value' => (string) $teachers,
                 'hint' => $teachers > 0 ? '' : 'Создайте преподавателя в admin/install.php'];

    $allOk = true;
    foreach ($checks as $c) {
        if (!$c['ok']) {
            $allOk = false;
        }
    }
    kurs_ok(['all_ok' => $allOk, 'checks' => $checks, 'time' => kurs_now()]);
}
