<?php
/**
 * lib/export.php — выгрузки журнала: CSV для Excel, JSON, текст для печати.
 * CSV: UTF-8 с BOM и разделителем ';' — Excel открывает как есть (та же договорённость,
 * что и в автономном test-urok-1.html).
 */

declare(strict_types=1);

require_once __DIR__ . '/quiz.php';

function kurs_csv(array $header, array $rows): string
{
    $out = "\xEF\xBB\xBF";
    $lines = [kurs_csv_line($header)];
    foreach ($rows as $row) {
        $lines[] = kurs_csv_line($row);
    }
    return $out . implode("\r\n", $lines) . "\r\n";
}

function kurs_csv_line(array $cells): string
{
    $out = [];
    foreach ($cells as $c) {
        $c = str_replace(["\r\n", "\r", "\n"], ' ', (string) $c);
        if (preg_match('/[;"]/', $c) || preg_match('/^\s|\s$/u', $c)) {
            $c = '"' . str_replace('"', '""', $c) . '"';
        }
        $out[] = $c;
    }
    return implode(';', $out);
}

function kurs_send_csv(string $filename, string $content): void
{
    if (!headers_sent()) {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($content));
        header('Cache-Control: no-store');
    }
    echo $content;
    exit;
}

function kurs_send_json_file(string $filename, $data): void
{
    $content = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen((string) $content));
        header('Cache-Control: no-store');
    }
    echo $content;
    exit;
}

function kurs_date_ru(int $ts): string
{
    $d = getdate($ts);
    return kurs_pad2($d['mday']) . '.' . kurs_pad2($d['mon']) . '.' . $d['year'];
}

function kurs_time_ru(int $ts): string
{
    $d = getdate($ts);
    return kurs_pad2($d['hours']) . ':' . kurs_pad2($d['minutes']);
}

function kurs_dur_ru(int $sec): string
{
    $sec = max(0, (int) $sec);
    return intdiv($sec, 60) . ' мин ' . kurs_pad2($sec % 60) . ' с';
}

/** Журнал попыток с именами и классами; $bestOnly — по одной лучшей попытке на ученика и урок. */
function kurs_journal(PDO $pdo, array $filter = []): array
{
    $sql = 'SELECT a.*, u.login, u.name AS user_name, c.name AS class_name
            FROM attempts a
            LEFT JOIN users u ON u.id = a.user_id
            LEFT JOIN classes c ON c.id = u.class_id
            WHERE 1=1';
    $args = [];
    if (!empty($filter['lesson'])) {
        $sql .= ' AND a.lesson = ?';
        $args[] = $filter['lesson'];
    }
    if (!empty($filter['class_id'])) {
        $sql .= ' AND u.class_id = ?';
        $args[] = (int) $filter['class_id'];
    }
    if (!empty($filter['user_id'])) {
        $sql .= ' AND a.user_id = ?';
        $args[] = (int) $filter['user_id'];
    }
    if (!empty($filter['q'])) {
        $sql .= ' AND (a.name LIKE ? OR u.login LIKE ? OR a.group_name LIKE ?)';
        $like = '%' . $filter['q'] . '%';
        $args[] = $like;
        $args[] = $like;
        $args[] = $like;
    }
    $sql .= ' ORDER BY a.ts DESC LIMIT 5000';
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $rows = $st->fetchAll();

    if (!empty($filter['best'])) {
        $best = [];
        foreach ($rows as $r) {
            $key = ($r['user_id'] ? 'u' . $r['user_id'] : 'n' . $r['name']) . '|' . $r['lesson'];
            if (!isset($best[$key])
                || (int) $r['right'] > (int) $best[$key]['right']
                || ((int) $r['right'] === (int) $best[$key]['right'] && (int) $r['ts'] < (int) $best[$key]['ts'])) {
                $best[$key] = $r;
            }
        }
        $rows = array_values($best);
        usort($rows, static function ($a, $b) {
            return (int) $b['ts'] <=> (int) $a['ts'];
        });
    }
    return $rows;
}

function kurs_journal_csv(array $rows): string
{
    $header = ['Дата', 'Время', 'Ученик', 'Логин', 'Класс', 'Урок', 'Вариант',
               'Верно', 'Всего', 'Процент', 'Оценка', 'Время решения', 'Слабые темы', 'Код результата', 'Источник'];
    $out = [];
    foreach ($rows as $r) {
        $per = json_decode((string) ($r['per_topic'] ?? '{}'), true) ?: [];
        $weak = [];
        foreach ($per as $t => $v) {
            if ((int) $v['ok'] < (int) $v['all']) {
                $weak[] = $t . ' ' . $v['ok'] . '/' . $v['all'];
            }
        }
        $out[] = [
            kurs_date_ru((int) $r['ts']),
            kurs_time_ru((int) $r['ts']),
            $r['name'] !== '' ? $r['name'] : (string) ($r['user_name'] ?? ''),
            (string) ($r['login'] ?? ''),
            (string) ($r['class_name'] ?? $r['group_name'] ?? ''),
            strtoupper((string) $r['lesson']),
            (int) $r['variant_no'],
            (int) $r['right_cnt'],
            (int) $r['total'],
            (int) $r['pct'] . '%',
            (int) $r['grade'],
            kurs_dur_ru((int) $r['sec']),
            implode(', ', $weak),
            (string) $r['code'],
            (string) $r['source'],
        ];
    }
    return kurs_csv($header, $out);
}

/** Сводка по темам: процент верных ответов по всем собранным работам. */
function kurs_topic_stats(PDO $pdo, ?string $lesson = null, ?int $classId = null): array
{
    $sql = 'SELECT a.lesson, a.per_topic, a.right_cnt, a.total FROM attempts a
            LEFT JOIN users u ON u.id = a.user_id WHERE a.per_topic <> \'{}\'';
    $args = [];
    if ($lesson) {
        $sql .= ' AND a.lesson = ?';
        $args[] = $lesson;
    }
    if ($classId) {
        $sql .= ' AND u.class_id = ?';
        $args[] = $classId;
    }
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $stats = [];
    foreach ($st->fetchAll() as $r) {
        $per = json_decode((string) $r['per_topic'], true) ?: [];
        foreach ($per as $t => $v) {
            $key = $r['lesson'] . '|' . $t;
            if (!isset($stats[$key])) {
                $stats[$key] = ['lesson' => $r['lesson'], 'topic' => $t, 'ok' => 0, 'all' => 0, 'works' => 0];
            }
            $stats[$key]['ok'] += (int) $v['ok'];
            $stats[$key]['all'] += (int) $v['all'];
            $stats[$key]['works']++;
        }
    }
    $out = array_values($stats);
    foreach ($out as &$s) {
        $s['pct'] = $s['all'] > 0 ? (int) round($s['ok'] * 100 / $s['all']) : 0;
    }
    unset($s);
    usort($out, static function ($a, $b) {
        return ($a['lesson'] <=> $b['lesson']) ?: ($a['pct'] <=> $b['pct']);
    });
    return $out;
}
