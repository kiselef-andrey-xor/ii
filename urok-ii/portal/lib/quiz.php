<?php
/**
 * lib/quiz.php — движок теста: банк вопросов, случайный вариант, проверка,
 * оценка и код результата.
 *
 * Код результата совместим с автономным test-urok-1.html:
 *   U1|ИМЯ|КЛАСС|ГГММДДЧЧММ|ВАРИАНТ|ВЕРНО|ВСЕГО|СЕК|МАСКА_ТЕМ|NONCE|CRC
 * CRC считается так же, как в JS (djb2 по base36-представлению строки).
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/portal.php';

/* --- утилиты, повторяющие JS из test-urok-1.html --------------------------- */

/**
 * Список кодов символов строки. ВАЖНО: считаем именно символы Unicode,
 * а не байты — ровно как charCodeAt() в JavaScript. Иначе контрольная сумма
 * кода с кириллическим именем не сойдётся с той, что выдал браузер.
 */
function kurs_char_codes(string $s): array
{
    if (function_exists('mb_str_split')) {
        $chars = mb_str_split($s, 1, 'UTF-8');
    } else {
        preg_match_all('/./us', $s, $m);
        $chars = $m[0];
    }
    $out = [];
    foreach ($chars as $ch) {
        $cp = 0;
        if (function_exists('mb_ord')) {
            $cp = mb_ord($ch, 'UTF-8');
        }
        if (!$cp) {
            /* запасной путь для сборки PHP без mbstring */
            $b = unpack('C*', $ch);
            $b = array_values($b);
            $n = count($b);
            if ($n === 1) {
                $cp = $b[0];
            } elseif ($n === 2) {
                $cp = (($b[0] & 0x1F) << 6) | ($b[1] & 0x3F);
            } elseif ($n === 3) {
                $cp = (($b[0] & 0x0F) << 12) | (($b[1] & 0x3F) << 6) | ($b[2] & 0x3F);
            } else {
                $cp = (($b[0] & 0x07) << 18) | (($b[1] & 0x3F) << 12) | (($b[2] & 0x3F) << 6) | ($b[3] & 0x3F);
            }
        }
        $out[] = (int) $cp;
    }
    return $out;
}

/** Полный аналог b36() из test-urok-1.html: код каждого символа в base36, без дополнения. */
function kurs_b36(string $s): string
{
    $out = '';
    foreach (kurs_char_codes($s) as $code) {
        $out .= kurs_base36($code);
    }
    return $out;
}

function kurs_ub36(string $s): string
{
    $out = '';
    $len = strlen($s);
    for ($i = 0; $i + 1 < $len; $i += 2) {
        $cp = (int) base_convert(substr($s, $i, 2), 36, 10);
        $out .= function_exists('mb_chr') ? mb_chr($cp, 'UTF-8') : kurs_utf8_chr($cp);
    }
    return $out;
}

/** Тот же djb2, что и в браузере: h = ((h << 5) + h + code) >>> 0, затем h % 1296 в base36. */
function kurs_crc(string $str): string
{
    $h = 5381;
    foreach (kurs_char_codes($str) as $code) {
        $h = (($h * 33) + $code) & 0xFFFFFFFF;
    }
    $h = $h % 1296;
    return str_pad(kurs_base36($h), 2, '0', STR_PAD_LEFT);
}

/** Код символа -> UTF-8 (запасной путь, если mbstring выключен). */
function kurs_utf8_chr(int $cp): string
{
    if ($cp < 0x80) {
        return chr($cp);
    }
    if ($cp < 0x800) {
        return chr(0xC0 | ($cp >> 6)) . chr(0x80 | ($cp & 0x3F));
    }
    if ($cp < 0x10000) {
        return chr(0xE0 | ($cp >> 12)) . chr(0x80 | (($cp >> 6) & 0x3F)) . chr(0x80 | ($cp & 0x3F));
    }
    return chr(0xF0 | ($cp >> 18)) . chr(0x80 | (($cp >> 12) & 0x3F))
        . chr(0x80 | (($cp >> 6) & 0x3F)) . chr(0x80 | ($cp & 0x3F));
}

function kurs_pad2(int $n): string
{
    return str_pad((string) $n, 2, '0', STR_PAD_LEFT);
}

/* --- банк ------------------------------------------------------------------ */

function kurs_lesson_ids(): array
{
    return ['u1', 'u2', 'u3', 'u4'];
}

function kurs_lesson_valid(string $lesson): bool
{
    return in_array($lesson, kurs_lesson_ids(), true);
}

function kurs_bank_path(string $lesson): string
{
    return KURS_BANKS . '/' . $lesson . '.json';
}

/** Банк целиком (вопросы с правильными ответами — только для сервера). */
function kurs_bank(string $lesson): array
{
    static $cache = [];
    if (isset($cache[$lesson])) {
        return $cache[$lesson];
    }
    if (!kurs_lesson_valid($lesson)) {
        throw new RuntimeException('Неизвестный урок: ' . $lesson);
    }
    $path = kurs_bank_path($lesson);
    if (!is_file($path)) {
        throw new RuntimeException('Нет файла банка: ' . $path);
    }
    $raw = file_get_contents($path);
    $bank = json_decode((string) $raw, true);
    if (!is_array($bank) || empty($bank['questions'])) {
        throw new RuntimeException('Банк повреждён: ' . $path);
    }
    $cache[$lesson] = $bank;
    return $bank;
}

/** Банк без правильных ответов — его можно отдавать в браузер (офлайн-режим теста). */
function kurs_bank_public(string $lesson): array
{
    $bank = kurs_bank($lesson);
    $out = [
        'lesson' => $bank['lesson'] ?? $lesson,
        'title' => $bank['title'] ?? $lesson,
        'subtitle' => $bank['subtitle'] ?? '',
        'prefix' => $bank['prefix'] ?? strtoupper($lesson),
        'topics' => $bank['topics'] ?? [],
        'colors' => $bank['colors'] ?? [],
        'count' => count($bank['questions']),
        'questions' => [],
    ];
    foreach ($bank['questions'] as $i => $q) {
        $out['questions'][] = [
            'i' => $i,
            't' => $q['t'],
            'q' => $q['q'],
            'o' => $q['o'],
            'e' => $q['e'],
        ];
    }
    return $out;
}

/* --- вариант --------------------------------------------------------------- */

/**
 * Собирает вариант: по одному вопросу из каждой темы, затем добор случайными.
 * $rnd — функция-генератор для тестируемости (по умолчанию random_int).
 */
function kurs_build_variant(array $bank, int $count, ?callable $rnd = null): array
{
    $qs = $bank['questions'];
    $n = count($qs);
    $count = max(1, min($count, $n));
    if ($rnd === null) {
        $rnd = static function (int $hi): int {
            return $hi <= 0 ? 0 : random_int(0, $hi);
        };
    }
    $shuffle = static function (array $a) use ($rnd): array {
        for ($i = count($a) - 1; $i > 0; $i--) {
            $j = $rnd($i);
            $t = $a[$i];
            $a[$i] = $a[$j];
            $a[$j] = $t;
        }
        return $a;
    };

    $byTopic = [];
    foreach ($qs as $i => $q) {
        $byTopic[$q['t']][] = $i;
    }
    $picked = [];
    foreach (($bank['topics'] ?? array_keys($byTopic)) as $topic) {
        if (count($picked) >= $count) {
            break;
        }
        if (empty($byTopic[$topic])) {
            continue;
        }
        $pool = $shuffle($byTopic[$topic]);
        $picked[] = $pool[0];
    }
    $rest = $shuffle(array_values(array_diff(range(0, $n - 1), $picked)));
    while (count($picked) < $count && $rest) {
        $picked[] = array_shift($rest);
    }
    $idx = array_slice($shuffle($picked), 0, $count);

    /* порядок вариантов ответа перемешивается отдельно для каждого вопроса */
    $order = [];
    foreach ($idx as $bi) {
        $order[] = $shuffle(range(0, count($qs[$bi]['o']) - 1));
    }
    return ['idx' => $idx, 'order' => $order];
}

/**
 * Что видит ученик: вопросы без правильных ответов, варианты уже перемешаны.
 * Вариант сохраняется в сессии, чтобы ответ нельзя было подобрать повторной отправкой.
 */
function kurs_variant_for_client(string $lesson, int $count, ?callable $rnd = null): array
{
    $bank = kurs_bank($lesson);
    $v = kurs_build_variant($bank, $count, $rnd);
    $questions = [];
    foreach ($v['idx'] as $pos => $bi) {
        $q = $bank['questions'][$bi];
        $opts = [];
        foreach ($v['order'][$pos] as $k) {
            $opts[] = ['k' => $k, 'text' => $q['o'][$k]];
        }
        $questions[] = ['n' => $pos, 'id' => $bi, 't' => $q['t'], 'q' => $q['q'], 'o' => $opts];
    }
    return [
        'lesson' => $lesson,
        'count' => count($questions),
        'bank_size' => count($bank['questions']),
        'questions' => $questions,
        'variant_no' => random_int(10000, 99999),
        'nonce' => substr(kurs_random_token(4), 0, 4),
        'started' => kurs_now(),
    ];
}

/* --- проверка и оценка ----------------------------------------------------- */

function kurs_threshold(string $lesson): int
{
    $own = kurs_setting_int('threshold_' . $lesson, 0, 1, 100);
    if ($own > 0) {
        return $own;
    }
    return kurs_setting_int('threshold_default', 60, 1, 100);
}

function kurs_variant_count(string $lesson): int
{
    $bank = kurs_bank($lesson);
    $def = (int) ($bank['default_count'] ?? 15);
    return kurs_setting_int('count_' . $lesson, $def, 5, max(5, count($bank['questions'])));
}

function kurs_grade(int $pct, int $threshold): int
{
    if ($pct >= 90) {
        return 5;
    }
    if ($pct >= 75) {
        return 4;
    }
    if ($pct >= $threshold) {
        return 3;
    }
    return 2;
}

/**
 * Проверяет ответы.
 * $answers — список ['id'=>индекс вопроса в банке, 'a'=>индекс ИСХОДНОГО варианта ответа]
 * (клиент шлёт k из перемешанного списка — это и есть исходный индекс).
 */
function kurs_grade_attempt(string $lesson, array $variant, array $answers, int $sec): array
{
    $bank = kurs_bank($lesson);
    $qs = $bank['questions'];
    $topics = $bank['topics'] ?? [];
    $right = 0;
    $perTopic = [];
    $detail = [];
    $total = count($variant['questions']);

    $byId = [];
    foreach ($answers as $a) {
        if (!is_array($a)) {
            continue;
        }
        $id = isset($a['id']) ? (int) $a['id'] : -1;
        $byId[$id] = isset($a['a']) ? (int) $a['a'] : -1;
    }

    foreach ($variant['questions'] as $pos => $item) {
        $bi = (int) $item['id'];
        $q = $qs[$bi] ?? null;
        if (!$q) {
            continue;
        }
        $given = $byId[$bi] ?? -1;
        $ok = ($given === (int) $q['a']);
        if ($ok) {
            $right++;
        }
        $topic = (string) $q['t'];
        if (!isset($perTopic[$topic])) {
            $perTopic[$topic] = ['ok' => 0, 'all' => 0];
        }
        $perTopic[$topic]['all']++;
        if ($ok) {
            $perTopic[$topic]['ok']++;
        }
        $detail[] = [
            'n' => $pos,
            'id' => $bi,
            't' => $topic,
            'q' => $q['q'],
            'right' => (int) $q['a'],
            'given' => $given,
            'ok' => $ok,
            'e' => $q['e'],
        ];
    }
    /* темы в порядке банка; отсутствующие не показываем */
    $ordered = [];
    foreach ($topics as $t) {
        if (isset($perTopic[$t])) {
            $ordered[$t] = $perTopic[$t];
        }
    }
    foreach ($perTopic as $t => $v) {
        if (!isset($ordered[$t])) {
            $ordered[$t] = $v;
        }
    }

    $pct = $total > 0 ? (int) round($right * 100 / $total) : 0;
    $threshold = kurs_threshold($lesson);
    return [
        'right' => $right,
        'total' => $total,
        'pct' => $pct,
        'grade' => kurs_grade($pct, $threshold),
        'threshold' => $threshold,
        'per_topic' => $ordered,
        'detail' => $detail,
        'sec' => max(0, $sec),
        'weak' => kurs_weak_topics($ordered, $topics),
    ];
}

function kurs_weak_topics(array $perTopic, array $order = []): array
{
    $weak = [];
    foreach ($perTopic as $t => $v) {
        if ((int) $v['ok'] < (int) $v['all']) {
            $weak[] = $t;
        }
    }
    if ($order) {
        usort($weak, static function ($a, $b) use ($order) {
            $ia = array_search($a, $order, true);
            $ib = array_search($b, $order, true);
            return ($ia === false ? 99 : $ia) <=> ($ib === false ? 99 : $ib);
        });
    }
    return $weak;
}

/* --- маска тем (как в автономном тесте) ------------------------------------ */

/** По одному символу base36 на тему: ok*6 + all; 'z' — темы не было в варианте. */
function kurs_topic_mask(array $perTopic, array $topics): string
{
    $out = '';
    foreach ($topics as $t) {
        if (!isset($perTopic[$t]) || (int) $perTopic[$t]['all'] === 0) {
            $out .= 'z';
            continue;
        }
        $ok = min(5, (int) $perTopic[$t]['ok']);
        $all = min(5, (int) $perTopic[$t]['all']);
        $out .= base_convert((string) ($ok * 6 + $all), 10, 36);
    }
    return $out;
}

function kurs_topics_from_mask(string $mask, array $topics): array
{
    $out = [];
    foreach ($topics as $i => $t) {
        $ch = $mask[$i] ?? 'z';
        if ($ch === 'z' || $ch === '') {
            continue;
        }
        $v = (int) base_convert($ch, 36, 10);
        $out[$t] = ['ok' => intdiv($v, 6), 'all' => $v % 6];
    }
    return $out;
}

/* --- код результата -------------------------------------------------------- */

function kurs_make_code(string $prefix, string $name, string $group, int $ts, int $variant,
                        int $right, int $total, int $sec, string $mask, string $nonce): array
{
    $d = getdate($ts);
    $stamp = substr((string) $d['year'], 2) . kurs_pad2($d['mon']) . kurs_pad2($d['mday'])
        . kurs_pad2($d['hours']) . kurs_pad2($d['minutes']);
    $body = implode('|', [
        $prefix,
        substr(kurs_norm_name($name), 0, 40),
        substr(kurs_norm_name($group), 0, 16),
        $stamp,
        (string) $variant,
        (string) $right,
        (string) $total,
        (string) $sec,
        $mask,
        $nonce,
    ]);
    $crc = kurs_crc(kurs_b36($body));
    return ['code' => $body . '|' . $crc, 'crc' => $crc, 'body' => $body];
}

/** Разбор кода (в том числе «поехавшего» при копировании из чата). */
function kurs_parse_code(string $raw, string $prefix = ''): array
{
    $s = trim($raw);
    if ($s === '') {
        return ['bad' => true, 'reason' => 'пустая строка', 'raw' => $raw];
    }
    $r = kurs_parse_parts(explode('|', $s), $s, $prefix);
    if (!empty($r['bad'])) {
        $t = array_map('trim', explode('|', $s));
        $r = kurs_parse_parts($t, $s, $prefix);
    }
    if (!empty($r['bad'])) {
        $nl = preg_replace('/[\n\r\t]+/u', '', $s);
        if ($nl !== $s) {
            $r = kurs_parse_parts(explode('|', (string) $nl), $s, $prefix);
        }
    }
    if (!empty($r['bad'])) {
        $sq = preg_replace('/[\s\x{00a0}]+/u', '', $s);
        if ($sq !== $s) {
            $r = kurs_parse_parts(explode('|', (string) $sq), $s, $prefix);
        }
    }
    return $r;
}

function kurs_parse_parts(array $p, string $raw, string $prefix = ''): array
{
    $bad = ['bad' => true, 'raw' => $raw];
    if (count($p) < 11) {
        return $bad + ['reason' => 'не похож на код теста (полей меньше 11)'];
    }
    $pref = strtoupper(trim($p[0]));
    if (!preg_match('/^U[1-4]$/', $pref)) {
        return $bad + ['reason' => 'неизвестный префикс урока: ' . $p[0]];
    }
    if ($prefix !== '' && strtoupper($prefix) !== $pref) {
        return $bad + ['reason' => 'ожидался код урока ' . $prefix . ', получен ' . $pref];
    }
    $body = implode('|', array_slice($p, 0, 10));
    $crc = strtolower(trim($p[10]));
    if (!hash_equals(kurs_crc(kurs_b36($body)), $crc)) {
        return $bad + ['reason' => 'код повреждён или изменён'];
    }
    $stamp = trim($p[3]);
    if (!preg_match('/^\d{10}$/', $stamp)) {
        return $bad + ['reason' => 'нечитаемая дата в коде'];
    }
    $ts = mktime(
        (int) substr($stamp, 6, 2),
        (int) substr($stamp, 8, 2),
        0,
        (int) substr($stamp, 2, 2),
        (int) substr($stamp, 4, 2),
        2000 + (int) substr($stamp, 0, 2)
    );
    $right = (int) $p[5];
    $total = (int) $p[6];
    if ($total <= 0 || $right < 0 || $right > $total) {
        return $bad + ['reason' => 'нечитаемые числа в коде'];
    }
    $lesson = 'u' . substr($pref, 1);
    $topics = [];
    try {
        $topics = kurs_bank($lesson)['topics'] ?? [];
    } catch (Throwable $e) {
        $topics = [];
    }
    $perTopic = kurs_topics_from_mask(trim($p[8]), $topics);
    return [
        'bad' => false,
        'lesson' => $lesson,
        'prefix' => $pref,
        'code' => implode('|', $p),
        'name' => trim($p[1]),
        'group' => trim($p[2]),
        'ts' => (int) $ts,
        'variant' => (int) $p[4],
        'right' => $right,
        'total' => $total,
        'sec' => (int) $p[7],
        'pct' => (int) round($right * 100 / $total),
        'per_topic' => $perTopic,
        'weak' => kurs_weak_topics($perTopic, $topics),
        'nonce' => trim($p[9]),
        'crc' => $crc,
    ];
}

/** Разбивает вставленный учителем текст на отдельные коды. */
function kurs_split_codes(string $text): array
{
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    /* код = 11 полей через вертикальную черту */
    if (preg_match_all('/[A-Za-z0-9]{1,3}(?:\|[^\n|]*){10}/u', $text, $m)) {
        $out = [];
        foreach ($m[0] as $code) {
            $code = trim($code);
            if ($code !== '') {
                $out[] = $code;
            }
        }
        if ($out) {
            return $out;
        }
    }
    $out = [];
    foreach (preg_split('/[\n,;\t]+/u', $text) as $line) {
        $line = trim((string) $line);
        if ($line !== '') {
            $out[] = $line;
        }
    }
    return $out;
}

/* --- запись попытки -------------------------------------------------------- */

function kurs_save_attempt(array $rec): int
{
    $st = kurs_db()->prepare(
        'INSERT INTO attempts(user_id, name, group_name, lesson, variant_no, question_ids, answers,
                              right_cnt, total, sec, pct, grade, per_topic, code, crc, ts, source, nonce)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    $st->execute([
        $rec['user_id'] ?? null,
        (string) ($rec['name'] ?? ''),
        (string) ($rec['group'] ?? ''),
        (string) $rec['lesson'],
        (int) ($rec['variant'] ?? 0),
        json_encode($rec['question_ids'] ?? [], JSON_UNESCAPED_UNICODE),
        json_encode($rec['answers'] ?? [], JSON_UNESCAPED_UNICODE),
        (int) $rec['right'],
        (int) $rec['total'],
        (int) $rec['sec'],
        (int) $rec['pct'],
        (int) $rec['grade'],
        json_encode($rec['per_topic'] ?? [], JSON_UNESCAPED_UNICODE),
        (string) ($rec['code'] ?? ''),
        (string) ($rec['crc'] ?? ''),
        (int) ($rec['ts'] ?? kurs_now()),
        (string) ($rec['source'] ?? 'web'),
        (string) ($rec['nonce'] ?? ''),
    ]);
    return (int) kurs_db()->lastInsertId();
}
