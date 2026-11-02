<?php
/**
 * tests/mix_ref.php — пошаговый расчёт mix() для сверки с JavaScript.
 * Запуск: php tests/mix_ref.php "speak|107"
 */
require dirname(__DIR__) . '/portal/lib/portal.php';

$s = (string) ($argv[1] ?? 'speak|107');
$h1 = 0x811c9dc5;
$h2 = 0x1000193;
$trace = [];
$len = strlen($s);
for ($i = 0; $i < $len; $i++) {
    $c = ord($s[$i]);
    $h1 = ($h1 ^ $c) & 0xFFFFFFFF;
    $h1 = ($h1 * 0x01000193) & 0xFFFFFFFF;
    $h2 = ($h2 + $c * ($i + 7)) & 0xFFFFFFFF;
    $trace[] = [$i, $c, $h1, $h2];
}
echo json_encode([
    'input' => $s,
    'h1' => $h1,
    'h2' => $h2,
    'h1_36' => kurs_base36($h1),
    'h2_36' => kurs_base36($h2),
    'mix' => kurs_mix($s),
    'php_int_size' => PHP_INT_SIZE,
    'trace' => $trace,
], JSON_PRETTY_PRINT), "\n";
