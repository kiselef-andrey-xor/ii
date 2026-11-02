<?php
/**
 * lib/db.php — подключение к SQLite и схема базы.
 *
 * Один файл БД, режим WAL (важно: в классе одновременно пишут 20-30 учеников).
 * Все запросы — только подготовленные выражения.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

function kurs_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $path = KURS_DB;
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0770, true);
    }
    if (!is_dir($dir) || (!is_file($path) && !is_writable($dir))) {
        throw new RuntimeException(
            'Каталог данных недоступен для записи: ' . $dir .
            ' — File Station → правый клик на папке kurs-data → Свойства → Права →' .
            ' Создать → пользователь «everyone», права «Чтение» и «Запись»,' .
            ' применить к этой папке, подпапкам и файлам'
        );
    }
    $fresh = !is_file($path) || filesize($path) === 0;
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA synchronous=NORMAL');
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec('PRAGMA busy_timeout=5000');
    if (function_exists('mb_internal_encoding')) {
        mb_internal_encoding('UTF-8');
    }
    kurs_migrate($pdo);
    if ($fresh) {
        kurs_seed($pdo);
    }
    return $pdo;
}

function kurs_migrate(PDO $pdo): void
{
    $ddl = [
        'CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT \'\'
        )',
        'CREATE TABLE IF NOT EXISTS classes (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT NOT NULL UNIQUE,
            active    INTEGER NOT NULL DEFAULT 1,
            created_ts INTEGER NOT NULL DEFAULT 0
        )',
        'CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name          TEXT NOT NULL DEFAULT \'\',
            class_id      INTEGER REFERENCES classes(id) ON DELETE SET NULL,
            pass_hash     TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT \'student\' CHECK (role IN (\'student\',\'teacher\')),
            created_ts    INTEGER NOT NULL DEFAULT 0,
            last_login_ts INTEGER NOT NULL DEFAULT 0,
            failed_logins INTEGER NOT NULL DEFAULT 0,
            locked_until  INTEGER NOT NULL DEFAULT 0,
            must_change   INTEGER NOT NULL DEFAULT 0,
            active        INTEGER NOT NULL DEFAULT 1
        )',
        'CREATE TABLE IF NOT EXISTS progress (
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            lesson     TEXT NOT NULL,
            unlocked   INTEGER NOT NULL DEFAULT 0,
            visited    TEXT NOT NULL DEFAULT \'{}\',
            position   INTEGER NOT NULL DEFAULT 0,
            tasks_done INTEGER NOT NULL DEFAULT 0,
            tasks_all  INTEGER NOT NULL DEFAULT 0,
            updated_ts INTEGER NOT NULL DEFAULT 0,
            sig        TEXT NOT NULL DEFAULT \'\',
            PRIMARY KEY (user_id, lesson)
        )',
        'CREATE TABLE IF NOT EXISTS attempts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name         TEXT NOT NULL DEFAULT \'\',
            group_name   TEXT NOT NULL DEFAULT \'\',
            lesson       TEXT NOT NULL,
            variant_no   INTEGER NOT NULL DEFAULT 0,
            question_ids TEXT NOT NULL DEFAULT \'[]\',
            answers      TEXT NOT NULL DEFAULT \'[]\',
            right_cnt    INTEGER NOT NULL DEFAULT 0,
            total        INTEGER NOT NULL DEFAULT 0,
            sec          INTEGER NOT NULL DEFAULT 0,
            pct          INTEGER NOT NULL DEFAULT 0,
            grade        INTEGER NOT NULL DEFAULT 2,
            per_topic    TEXT NOT NULL DEFAULT \'{}\',
            code         TEXT NOT NULL DEFAULT \'\',
            crc          TEXT NOT NULL DEFAULT \'\',
            ts           INTEGER NOT NULL DEFAULT 0,
            source       TEXT NOT NULL DEFAULT \'web\',
            nonce        TEXT NOT NULL DEFAULT \'\'
        )',
        'CREATE TABLE IF NOT EXISTS final_groups (
            group_no    INTEGER NOT NULL,
            theme       TEXT NOT NULL DEFAULT \'\',
            user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
            member_name TEXT NOT NULL DEFAULT \'\',
            role        TEXT NOT NULL DEFAULT \'\',
            min_items   TEXT NOT NULL DEFAULT \'{}\',
            jury_score  INTEGER NOT NULL DEFAULT 0,
            peer_score  INTEGER NOT NULL DEFAULT 0,
            bonus       INTEGER NOT NULL DEFAULT 0,
            total       INTEGER NOT NULL DEFAULT 0,
            passed      INTEGER NOT NULL DEFAULT 0,
            note        TEXT NOT NULL DEFAULT \'\',
            updated_ts  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (group_no, member_name)
        )',
        'CREATE TABLE IF NOT EXISTS audit (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            ts       INTEGER NOT NULL DEFAULT 0,
            actor    TEXT NOT NULL DEFAULT \'\',
            ip       TEXT NOT NULL DEFAULT \'\',
            action   TEXT NOT NULL DEFAULT \'\',
            details  TEXT NOT NULL DEFAULT \'\'
        )',
        'CREATE INDEX IF NOT EXISTS idx_att_user    ON attempts(user_id, lesson)',
        'CREATE INDEX IF NOT EXISTS idx_att_ts      ON attempts(ts)',
        'CREATE INDEX IF NOT EXISTS idx_att_code    ON attempts(code)',
        'CREATE INDEX IF NOT EXISTS idx_prog_user   ON progress(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_id)',
    ];
    foreach ($ddl as $sql) {
        $pdo->exec($sql);
    }
}

function kurs_seed(PDO $pdo): void
{
    $now = kurs_now();
    $secret = kurs_random_token(32);
    $rows = [
        ['installed', '0'],
        ['secret_key', $secret],
        ['threshold_default', '60'],
        ['threshold_u1', ''],
        ['threshold_u2', ''],
        ['threshold_u3', ''],
        ['threshold_u4', ''],
        ['count_u1', '15'],
        ['count_u2', '15'],
        ['count_u3', '14'],
        ['count_u4', '15'],
        ['require_test_for_next', '1'],
        ['open_final', '0'],
        ['allow_self_register', '1'],
        ['min_pass_student', (string) KURS_MIN_PASS_STUDENT],
        ['min_pass_teacher', (string) KURS_MIN_PASS_TEACHER],
        ['school_name', ''],
        ['two_factor_teacher', '0'],
    ];
    $st = $pdo->prepare('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)');
    foreach ($rows as $r) {
        $st->execute($r);
    }
    $pdo->prepare('INSERT OR IGNORE INTO classes(name, active, created_ts) VALUES(?, 1, ?)')
        ->execute(['Без класса', $now]);
}

/** Настройки портала: значение или значение по умолчанию. */
function kurs_setting(string $key, string $default = ''): string
{
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        try {
            foreach (kurs_db()->query('SELECT key, value FROM settings') as $row) {
                $cache[$row['key']] = (string) $row['value'];
            }
        } catch (Throwable $e) {
            $cache = [];
        }
    }
    if ($key === '__reset__') {
        $cache = null;
        return $default;
    }
    $v = $cache[$key] ?? '';
    return $v === '' ? $default : $v;
}

/** Сбрасывает кэш настроек после записи (в пределах одного запроса). */
function kurs_settings_reset(): void
{
    kurs_setting('__reset__', '');
}

function kurs_setting_int(string $key, int $default, int $lo = PHP_INT_MIN, int $hi = PHP_INT_MAX): int
{
    $v = kurs_setting($key, '');
    if ($v === '' || !preg_match('/^-?\d+$/', $v)) {
        return $default;
    }
    $n = (int) $v;
    return max($lo, min($hi, $n));
}

function kurs_set_setting(string $key, string $value): void
{
    kurs_db()->prepare('INSERT INTO settings(key, value) VALUES(?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        ->execute([$key, $value]);
}

function kurs_secret(): string
{
    $s = kurs_setting('secret_key', '');
    if ($s === '' || strlen($s) < 16) {
        $s = kurs_random_token(32);
        kurs_set_setting('secret_key', $s);
    }
    return $s;
}

/** Подпись данных прогресса: HMAC-SHA256, сервер держит ключ у себя. */
function kurs_sign_progress(array $state): string
{
    $body = json_encode([
        'u' => (int) ($state['unlocked'] ?? 0),
        'v' => (object) ($state['visited'] ?? []),
        'p' => (int) ($state['position'] ?? 0),
    ], JSON_UNESCAPED_UNICODE);
    return hash_hmac('sha256', (string) $body, kurs_secret());
}

function kurs_audit(string $action, string $details = '', ?string $actor = null): void
{
    try {
        $who = $actor;
        if ($who === null && function_exists('kurs_user')) {
            $u = kurs_user();
            $who = $u ? ($u['login'] . '#' . $u['id']) : 'guest';
        }
        kurs_db()->prepare('INSERT INTO audit(ts, actor, ip, action, details) VALUES(?,?,?,?,?)')
            ->execute([kurs_now(), (string) $who, kurs_client_ip(), $action, kurs_trim($details, 500)]);
    } catch (Throwable $e) {
        /* журнал не должен ронять запрос */
    }
}
