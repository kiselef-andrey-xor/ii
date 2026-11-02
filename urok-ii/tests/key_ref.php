<?php
/**
 * tests/key_ref.php — эталонный ключ хранилища прогресса.
 *
 * Ключ считается по той же формуле, что в _study_mode.js, portal.js и во встроенном
 * в файлы курса мосте: 'k<uid>|x' + mix('<keyword>|<slides>').
 * Скрипт нужен, чтобы автоматическая проверка сверяла PHP и JavaScript.
 *
 * Запуск: php tests/key_ref.php <keyword> <slides> <uid>
 */
if ($argc < 4) {
    fwrite(STDERR, "Использование: php tests/key_ref.php <keyword> <slides> <uid>\n");
    exit(2);
}
require dirname(__DIR__) . '/portal/lib/portal.php';
echo kurs_storage_key((int) $argv[3], (string) $argv[1], (int) $argv[2]);
