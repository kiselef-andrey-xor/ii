<?php
/**
 * lib/common.php — общий каркас HTML-страниц портала.
 * Стиль и палитра — те же, что в файлах курса и в test-urok-1.html,
 * поэтому портал выглядит продолжением урока, а не чужим сайтом.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/resp.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/quiz.php';
require_once __DIR__ . '/export.php';

function kurs_html_escape(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function kurs_head(string $title, string $cssExtra = ''): string
{
    $school = kurs_setting('school_name', '');
    $h = kurs_html_escape($title);
    $sub = $school !== '' ? ' · ' . kurs_html_escape($school) : '';
    return '<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>' . $h . $sub . '</title>
<link rel="stylesheet" href="' . kurs_url('app.css') . '">
' . ($cssExtra !== '' ? '<style>' . $cssExtra . '</style>' : '') . '
</head>
<body>
';
}

function kurs_topbar(?array $user, string $active = ''): string
{
    $name = $user ? kurs_html_escape((string) $user['name']) : 'Гость';
    $role = $user ? ((string) $user['role'] === 'teacher' ? 'преподаватель' : 'ученик') : '';
    $cls = $user && !empty($user['class_name']) ? ' · ' . kurs_html_escape((string) $user['class_name']) : '';
    $cabinet = ($user && $user['role'] === 'teacher')
        ? '<a class="tb' . ($active === 'cabinet' ? ' on' : '') . '" href="' . kurs_url('cabinet.php') . '">Кабинет</a>'
        : '';
    $portal = $user ? '<a class="tb' . ($active === 'portal' ? ' on' : '') . '" href="' . kurs_url('index.php') . '">Курс</a>' : '';
    return '<header class="topbar">
  <div class="logo"><span class="dot"></span> Локальный ИИ <small>своими руками</small></div>
  <div class="spacer"></div>
  ' . $portal . $cabinet . '
  <span class="who">' . $name . ($role !== '' ? ' <small>' . $role . $cls . '</small>' : '') . '</span>
</header>
';
}

function kurs_foot(string $js = '', string $script = ''): string
{
    $warn = kurs_is_https() ? '' :
        '<div class="httpwarn">⚠️ Портал открыт по <b>HTTP</b>: логин и пароль передаются открытым текстом по сети. '
        . 'Включите HTTPS в DSM (сертификат Let\'s Encrypt) и в обратном прокси.</div>';
    return $warn . '<div class="toast" id="toast"></div>
<script>window.KURS_BASE = ' . json_encode(kurs_base_url()) . ';</script>
<script src="' . kurs_url('app.js') . '"></script>
' . ($script !== '' ? '<script src="' . kurs_url($script) . '"></script>' : '') . '
' . ($js !== '' ? '<script>' . $js . '</script>' : '') . '
</body>
</html>
';
}
