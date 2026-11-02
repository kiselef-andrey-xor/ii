<?php
/**
 * lib/config.php — единственное место, где задаются пути и поведение портала.
 *
 * Портал рассчитан на Synology DS223 + Web Station (PHP 8.1/8.2, pdo_sqlite).
 * База данных по умолчанию лежит ВНЕ веб-корня: документ-рут /volume1/web/kurs,
 * данные в /volume1/kurs-data. Если так не получается — см. KURS_DB_IN_DOCROOT.
 */

declare(strict_types=1);

if (!defined('KURS_ROOT')) {
    define('KURS_ROOT', dirname(__DIR__));
}

/* --- пути ------------------------------------------------------------------ */
define('KURS_LIB', KURS_ROOT . '/lib');
define('KURS_API', KURS_ROOT . '/api');
define('KURS_BANKS', KURS_ROOT . '/banks');
define('KURS_COURSES', KURS_ROOT . '/kursy');
define('KURS_APP_NAME', 'Локальный ИИ своими руками');

/**
 * Каталог с данными. Разрешается задать переменной окружения или в файле
 * config.local.php (он создаётся установщиком и не перезаписывается при обновлении).
 */
function kurs_data_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $candidates = [];
    if (getenv('KURS_DATA_DIR')) {
        $candidates[] = rtrim((string) getenv('KURS_DATA_DIR'), '/');
    }
    $docroot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/\\') : '';
    if ($docroot !== '') {
        /* обычный случай: /volume1/web/kurs -> /volume1/kurs-data */
        $candidates[] = dirname($docroot, 2) . '/kurs-data';
        $candidates[] = dirname($docroot) . '/kurs-data';
    }
    $candidates[] = dirname(KURS_ROOT) . '/kurs-data';
    foreach ($candidates as $c) {
        if ($c !== '' && is_dir($c)) {
            $dir = $c;
            return $dir;
        }
    }
    /* ничего нет — берём первый кандидат и попробуем создать (установщик это сделает) */
    $dir = $candidates[0] !== '' ? $candidates[0] : (dirname(KURS_ROOT) . '/kurs-data');
    return $dir;
}

function kurs_db_path(): string
{
    return kurs_data_dir() . '/kurs.db';
}

function kurs_config_local(): string
{
    return KURS_LIB . '/config.local.php';
}

/* локальные overrides (создаёт admin/install.php) */
if (is_file(kurs_config_local())) {
    require kurs_config_local();
}

if (!defined('KURS_DB')) {
    define('KURS_DB', kurs_db_path());
}
if (!defined('KURS_TRUST_PROXY_PROTO')) {
    /* true, если перед Web Station стоит обратный прокси Synology и он передаёт
       X-Forwarded-Proto. Нужен для корректного Secure-cookie и редиректов. */
    define('KURS_TRUST_PROXY_PROTO', true);
}
if (!defined('KURS_MIN_PASS_STUDENT')) {
    define('KURS_MIN_PASS_STUDENT', 6);
}
if (!defined('KURS_MIN_PASS_TEACHER')) {
    define('KURS_MIN_PASS_TEACHER', 8);
}
if (!defined('KURS_MAX_FAILED')) {
    define('KURS_MAX_FAILED', 5);
}
if (!defined('KURS_LOCK_SECONDS')) {
    define('KURS_LOCK_SECONDS', 600);
}
if (!defined('KURS_SESSION_HOURS')) {
    define('KURS_SESSION_HOURS', 8);
}
if (!defined('KURS_LESSONS')) {
    /* id => [префикс кода, файл урока, заголовок] */
    define('KURS_LESSONS', [
        'u1' => ['U1', 'kursy/kurs-uchenik.html', 'Урок 1 · модель говорит'],
        'u2' => ['U2', 'kursy/urok-2/index-bez-zametok.html', 'Урок 2 · модель действует'],
        'u3' => ['U3', 'kursy/urok-3/index-bez-zametok.html', 'Урок 3 · модель знает'],
        'u4' => ['U4', 'kursy/urok-4/index-bez-zametok.html', 'Урок 4 · модель своя'],
        'final' => ['FN', 'kursy/final/index-bez-zametok.html', 'Финальный проект'],
    ]);
}

/* --- HTTPS за обратным прокси --------------------------------------------- */
function kurs_is_https(): bool
{
    $https = $_SERVER['HTTPS'] ?? '';
    if (is_string($https) && $https !== '' && strtolower($https) !== 'off') {
        return true;
    }
    if ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443) {
        return true;
    }
    if (KURS_TRUST_PROXY_PROTO) {
        $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
        if (is_string($proto) && strtolower(trim(explode(',', $proto)[0])) === 'https') {
            return true;
        }
        if (!empty($_SERVER['HTTP_X_FORWARDED_SSL']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_SSL']) === 'on') {
            return true;
        }
    }
    return false;
}

/** Абсолютный URL файла внутри портала (учитывает подпапку и обратный прокси). */
function kurs_url(string $rel = ''): string
{
    $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
    $base = rtrim(str_replace('/api/index.php', '', $script), '/');
    if ($base === '' || substr($base, -4) === '.php') {
        $base = rtrim(dirname($base), '/');
    }
    $rel = ltrim($rel, '/');
    return $base . ($rel === '' ? '/' : '/' . $rel);
}

/** Базовый URL портала без завершающего слэша. */
function kurs_base_url(): string
{
    $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
    return rtrim(dirname($script), '/');
}

/* --- общие утилиты --------------------------------------------------------- */
function kurs_now(): int
{
    return time();
}

/** Безопасная обрезка строки по символам, а не по байтам. */
function kurs_trim(string $s, int $max = 200): string
{
    $s = preg_replace('/\s+/u', ' ', trim($s)) ?? '';
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max);
    }
    return substr($s, 0, $max);
}

/** Нормализация имени как в тесте урока 1: верхний регистр, Ё -> Е. */
function kurs_norm_name(string $s): string
{
    $s = kurs_trim($s, 60);
    if (function_exists('mb_strtoupper')) {
        $s = mb_strtoupper($s, 'UTF-8');
    } else {
        $s = strtoupper($s);
    }
    return str_replace(['Ё', 'ё'], ['Е', 'е'], $s);
}

function kurs_client_ip(): string
{
    if (KURS_TRUST_PROXY_PROTO && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = array_map('trim', explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']));
        foreach ($parts as $p) {
            if (filter_var($p, FILTER_VALIDATE_IP)) {
                return $p;
            }
        }
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Логин ученика: латиница/цифры/._- , 3..24 символа. */
function kurs_valid_login(string $login): bool
{
    return (bool) preg_match('/^[A-Za-z0-9._-]{3,24}$/', $login);
}

function kurs_random_token(int $bytes = 16): string
{
    try {
        return bin2hex(random_bytes($bytes));
    } catch (Throwable $e) {
        return bin2hex(openssl_random_pseudo_bytes($bytes));
    }
}
