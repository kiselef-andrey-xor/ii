<?php
/**
 * tests/crc_ref.php — эталонный расчёт контрольной суммы на PHP.
 *
 * Читает из stdin JSON-массив тел кодов, для каждого возвращает b36, crc и полный код.
 * Используется test_code_compat.py: один и тот же код должен получиться в JavaScript
 * (test-urok-1.html / portal/test.js), в PHP (portal/lib/quiz.php) и в Python.
 *
 * Запуск: echo '["U1|ИМЯ|..."]' | php tests/crc_ref.php
 */
require dirname(__DIR__) . '/portal/lib/quiz.php';

$raw = file_get_contents('php://stdin');
$bodies = json_decode((string) $raw, true);
if (!is_array($bodies)) {
    fwrite(STDERR, "Нужен JSON-массив строк в stdin\n");
    exit(2);
}
$out = [];
foreach ($bodies as $body) {
    $body = (string) $body;
    $b36 = kurs_b36($body);
    $crc = kurs_crc($b36);
    $out[] = [
        'body' => $body,
        'b36' => $b36,
        'crc' => $crc,
        'code' => $body . '|' . $crc,
    ];
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
