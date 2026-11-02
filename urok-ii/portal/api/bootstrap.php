<?php
/**
 * api/bootstrap.php — общий вход для всех обработчиков API.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/config.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/resp.php';
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/quiz.php';
require_once dirname(__DIR__) . '/lib/export.php';
require_once dirname(__DIR__) . '/lib/portal.php';
require_once dirname(__DIR__) . '/lib/common.php';

kurs_security_headers();
kurs_start_session();

/** Короткий публичный профиль пользователя. */
function kurs_public_user(?array $u): ?array
{
    if (!$u) {
        return null;
    }
    return [
        'id' => (int) $u['id'],
        'login' => (string) $u['login'],
        'name' => (string) $u['name'],
        'role' => (string) $u['role'],
        'class_id' => $u['class_id'] === null ? null : (int) $u['class_id'],
        'class_name' => (string) ($u['class_name'] ?? ''),
        'must_change' => (int) ($u['must_change'] ?? 0),
    ];
}

/** Список уроков курса без финального проекта. */
function kurs_course_lessons(): array
{
    return ['u1', 'u2', 'u3', 'u4'];
}

/** Файл урока для показа: ученику — без заметок, преподавателю — с заметками. */
function kurs_lesson_file(string $lesson, bool $teacher): string
{
    if ($lesson === 'final') {
        return $teacher ? 'kursy/final/index.html' : 'kursy/final/index-bez-zametok.html';
    }
    if ($lesson === 'u1') {
        /* урок 1 входит в общий файл курса; отдельного ученического файла для него нет */
        return $teacher ? 'kursy/prepod.html' : 'kursy/kurs-uchenik.html';
    }
    if (!preg_match('/^u[2-4]$/', $lesson)) {
        return 'kursy/kurs-uchenik.html';
    }
    return $teacher
        ? 'kursy/' . str_replace('u', 'urok-', $lesson) . '/index.html'
        : 'kursy/' . str_replace('u', 'urok-', $lesson) . '/index-bez-zametok.html';
}

/** Разрешён ли ученику этот урок (после теста предыдущего / после зачёта). */
function kurs_lesson_open_for(array $user, string $lesson): bool
{
    if ($user['role'] === 'teacher') {
        return true;
    }
    if (!in_array($lesson, kurs_course_lessons(), true) && $lesson !== 'final') {
        return false;
    }
    if ($lesson === 'final') {
        if (kurs_setting_int('open_final', 0, 0, 1) === 1) {
            return true;
        }
        $st = kurs_db()->prepare('SELECT passed FROM final_groups WHERE user_id = ? AND passed = 1 LIMIT 1');
        $st->execute([(int) $user['id']]);
        return (bool) $st->fetch();
    }
    if ($lesson === 'u1') {
        return true;
    }
    if (kurs_setting_int('require_test_for_next', 1, 0, 1) !== 1) {
        return true;
    }
    $order = kurs_course_lessons();
    $pos = array_search($lesson, $order, true);
    if ($pos === false || $pos === 0) {
        return true;
    }
    $prev = $order[$pos - 1];
    $threshold = kurs_threshold($prev);
    $st = kurs_db()->prepare('SELECT pct FROM attempts WHERE user_id = ? AND lesson = ? AND pct >= ? LIMIT 1');
    $st->execute([(int) $user['id'], $prev, $threshold]);
    return (bool) $st->fetch();
}

/** Прогресс и попытки пользователя — одним запросом, для оболочки портала. */
function kurs_user_state(array $user): array
{
    $pdo = kurs_db();
    $st = $pdo->prepare('SELECT lesson, unlocked, visited, position, tasks_done, tasks_all, updated_ts
                         FROM progress WHERE user_id = ?');
    $st->execute([(int) $user['id']]);
    $progress = [];
    foreach ($st->fetchAll() as $r) {
        $progress[$r['lesson']] = [
            'unlocked' => (int) $r['unlocked'],
            'position' => (int) $r['position'],
            'tasks_done' => (int) $r['tasks_done'],
            'tasks_all' => (int) $r['tasks_all'],
            'visited' => json_decode((string) $r['visited'], true) ?: [],
            'updated_ts' => (int) $r['updated_ts'],
        ];
    }
    $st = $pdo->prepare('SELECT lesson, right_cnt, total, pct, grade, ts, code, variant_no, sec, source
                         FROM attempts WHERE user_id = ? ORDER BY ts DESC LIMIT 400');
    $st->execute([(int) $user['id']]);
    $attempts = [];
    foreach ($st->fetchAll() as $r) {
        $attempts[] = [
            'lesson' => $r['lesson'],
            'right' => (int) $r['right_cnt'],
            'total' => (int) $r['total'],
            'pct' => (int) $r['pct'],
            'grade' => (int) $r['grade'],
            'ts' => (int) $r['ts'],
            'date' => kurs_date_ru((int) $r['ts']) . ' ' . kurs_time_ru((int) $r['ts']),
            'variant' => (int) $r['variant_no'],
            'sec' => (int) $r['sec'],
            'code' => (string) $r['code'],
            'source' => (string) $r['source'],
        ];
    }
    return ['progress' => $progress, 'attempts' => $attempts];
}
