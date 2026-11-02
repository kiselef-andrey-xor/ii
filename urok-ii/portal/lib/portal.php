<?php
/**
 * lib/portal.php — мост между порталом и файлами курса.
 *
 * Файлы уроков остаются самодостаточными (их по-прежнему можно открыть двойным щелчком),
 * а портал читает их прогресс из localStorage и восстанавливает его при входе.
 * Для этого нужно уметь повторить на сервере две формулы из _study_mode.js:
 *   mix(str)  — FNV-подобная смесь двух 32-битных хэшей, результат в base36
 *   SKEY      — 'x' + mix(KEYWORD + '|' + N), где N — число слайдов
 * Ключ дополняется префиксом пользователя ('k<uid>|'), чтобы за одним компьютером
 * прогресс разных учеников не перемешивался.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * Точный порт mix() из _study_mode.js.
 *
 * ВНИМАНИЕ: в JavaScript произведение (h1 * 0x01000193) выполняется в double,
 * а h1 * 16777619 легко превышает 2^53 — поэтому браузер считает его с потерей
 * точности, и >>> 0 берёт уже округлённое значение. Если считать то же самое
 * в целых числах PHP, ключ хранилища получится ДРУГОЙ и портал не найдёт
 * прогресс ученика. Поэтому повторяем поведение double буквально:
 * переводим в float, умножаем, затем ToUint32 через fmod.
 */
function kurs_mix(string $str): string
{
    $h1 = (float) 0x811c9dc5;
    $h2 = (float) 0x1000193;
    $len = strlen($str);
    for ($i = 0; $i < $len; $i++) {
        $c = (float) ord($str[$i]);
        /* (h1 ^ c) >>> 0 — оба операнда младше 2^32, результат точный */
        $x = (float) (((int) $h1) ^ ((int) $c));
        /* h1 = (x * 0x01000193) >>> 0 — как в браузере: double, затем ToUint32 */
        $h1 = kurs_to_uint32($x * 16777619.0);
        /* h2 = (h2 + c * (i + 7)) >>> 0 — произведения маленькие, всё точно */
        $h2 = kurs_to_uint32($h2 + $c * (float) ($i + 7));
    }
    return kurs_base36((int) $h1) . kurs_base36((int) $h2);
}

/** ToUint32 для значения, полученного в арифметике double (как в JavaScript). */
function kurs_to_uint32(float $v): float
{
    if (!is_finite($v)) {
        return 0.0;
    }
    $v = (float) ((int) $v);           /* ToInteger: отбрасываем дробную часть */
    $m = fmod($v, 4294967296.0);
    if ($m < 0) {
        $m += 4294967296.0;
    }
    return $m;
}

/** toString(36) как в JavaScript: без дополнения нулями, 0 -> "0". */
function kurs_base36(int $n): string
{
    $n = max(0, $n);
    $digits = '0123456789abcdefghijklmnopqrstuvwxyz';
    if ($n === 0) {
        return '0';
    }
    $out = '';
    while ($n > 0) {
        $out = $digits[$n % 36] . $out;
        $n = intdiv($n, 36);
    }
    return $out;
}

function kurs_storage_key(int $userId, string $keyword, int $slides): string
{
    return 'k' . $userId . '|' . 'x' . kurs_mix($keyword . '|' . $slides);
}

/** Метаданные файла урока: ключевое слово режима прохождения и число слайдов. */
function kurs_lesson_meta(string $file): array
{
    static $cache = [];
    $rel = ltrim($file, '/');
    if (isset($cache[$rel])) {
        return $cache[$rel];
    }
    $path = KURS_ROOT . '/' . $rel;
    $meta = ['keyword' => '', 'slides' => 0, 'exists' => false, 'bytes' => 0];
    if (is_file($path)) {
        $meta['exists'] = true;
        $meta['bytes'] = (int) filesize($path);
        $html = (string) file_get_contents($path);
        if (preg_match('/var\s+KEYWORD\s*=\s*"([a-zA-Z0-9_\-]+)"/', $html, $m)) {
            $meta['keyword'] = $m[1];
        }
        $meta['slides'] = preg_match_all('/<section\s+class="slide"/', $html);
        /* файл может быть большим — освобождаем память */
        unset($html);
    }
    $cache[$rel] = $meta;
    return $meta;
}

/** Полный путь к файлу урока внутри портала (проверяет, что файл не выходит за корень). */
function kurs_course_path(string $rel): ?string
{
    $rel = str_replace('\\', '/', trim($rel));
    if ($rel === '' || strpos($rel, '..') !== false || $rel[0] === '/') {
        return null;
    }
    if (!preg_match('#^kursy/[A-Za-z0-9_./\-]+$#', $rel)) {
        return null;
    }
    $path = KURS_ROOT . '/' . $rel;
    return is_file($path) ? $path : null;
}

/** Отдаёт файл урока: с защитой от выхода за каталог и с кэшированием в браузере. */
function kurs_serve_course(string $rel): void
{
    $path = kurs_course_path($rel);
    if (!$path) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Файл не найден';
        exit;
    }
    $mtime = (int) filemtime($path);
    $etag = '"' . md5($path . '|' . $mtime) . '"';
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    header('Cache-Control: private, max-age=300');
    $inm = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    if (is_string($inm) && trim($inm) === $etag) {
        http_response_code(304);
        exit;
    }
    readfile($path);
    exit;
}
