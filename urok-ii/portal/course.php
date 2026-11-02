<?php
/**
 * course.php — отдаёт файл урока только тому, кому он положен.
 *
 * Почему не прямой доступ к файлам: папка kursy/ закрыта правилом веб-сервера
 * (см. admin/README-DEPLOY.md), а выдача идёт через этот скрипт, который проверяет
 * вход и право на урок. Так преподаватель видит версии с заметками, а ученик — нет.
 */

declare(strict_types=1);

require_once __DIR__ . '/api/bootstrap.php';

kurs_security_headers();
kurs_start_session();

$u = kurs_current_user();
if (!$u) {
    header('Location: ' . kurs_url('login.php'));
    exit;
}

$file = (string) ($_GET['f'] ?? '');
$path = kurs_course_path($file);
if (!$path) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Файл не найден';
    exit;
}

/* преподавателю — всё; ученику — только открытые уроки и только ученические файлы */
if ($u['role'] !== 'teacher') {
    $allowed = [];
    foreach (kurs_course_lessons() as $id) {
        if (kurs_lesson_open_for($u, $id)) {
            $allowed[] = kurs_lesson_file($id, false);
        }
    }
    if (kurs_lesson_open_for($u, 'final')) {
        $allowed[] = kurs_lesson_file('final', false);
    }
    $allowed[] = 'kursy/kurs-uchenik.html';
    $allowed[] = 'kursy/test-urok-1.html';
    if (!in_array($file, $allowed, true)) {
        http_response_code(403);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!DOCTYPE html><html lang="ru"><meta charset="utf-8">'
            . '<body style="background:#0b0a14;color:#ece9f8;font:17px system-ui;padding:40px">'
            . '<h2>Этот раздел пока закрыт</h2>'
            . '<p>Сдайте тест предыдущего урока — и следующий откроется.</p>'
            . '<p><a href="' . kurs_html_escape(kurs_url('index.php')) . '" style="color:#a78bfa">Вернуться к курсу</a></p>';
        exit;
    }
    if (strpos($file, 'prepod') !== false || strpos($file, 'final/index.html') !== false) {
        http_response_code(403);
        echo 'Доступ запрещён';
        exit;
    }
}

kurs_serve_course($file);
