<?php
/**
 * admin/install.php — первичная установка портала.
 *
 * Проверяет окружение Web Station, создаёт каталог данных и базу, задаёт пароль
 * преподавателя (сразу хэшируется) и создаёт первый класс.
 * После завершения installation флаг installed=1 и страница refuses повторный запуск
 * без входа преподавателем.
 *
 * ВАЖНО: после установки переименуйте или удалите этот файл (см. README-DEPLOY.md).
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

$installed = false;
$dbOk = false;
$dbError = '';
try {
    kurs_db();
    $dbOk = true;
    $installed = kurs_setting_int('installed', 0, 0, 1) === 1;
} catch (Throwable $e) {
    $dbError = $e->getMessage();
}

$me = kurs_current_user();
if ($installed && (!$me || $me['role'] !== 'teacher')) {
    http_response_code(403);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="ru"><meta charset="utf-8">'
        . '<body style="background:#0b0a14;color:#ece9f8;font:17px system-ui;padding:40px;max-width:760px;margin:0 auto">'
        . '<h2>Портал уже установлен</h2>'
        . '<p>Повторная установка доступна только преподавателю после входа.</p>'
        . '<p><a href="' . kurs_html_escape(kurs_url('login.php')) . '" style="color:#a78bfa">Страница входа</a></p>'
        . '<p class="small" style="color:#a39dbf">Совет: переименуйте файл admin/install.php, '
        . 'чтобы к нему нельзя было обратиться случайно.</p></body></html>';
    exit;
}

/* --- обработка формы --- */
$error = '';
$done = false;
if (kurs_method() === 'POST') {
    $login = strtolower(trim((string) ($_POST['login'] ?? '')));
    $name = trim((string) ($_POST['name'] ?? ''));
    $pass = (string) ($_POST['password'] ?? '');
    $pass2 = (string) ($_POST['password2'] ?? '');
    $className = trim((string) ($_POST['class_name'] ?? ''));
    $min = kurs_min_password('teacher');

    if (!$dbOk) {
        $error = $dbError !== '' ? $dbError : 'База данных недоступна';
    } elseif (!kurs_valid_login($login)) {
        $error = 'Логин преподавателя: 3–24 символа, латиница, цифры, точка, подчёркивание или дефис';
    } elseif (mb_strlen($name) < 3) {
        $error = 'Введите фамилию и имя преподавателя';
    } elseif (strlen($pass) < $min) {
        $error = 'Пароль должен быть не короче ' . $min . ' символов';
    } elseif ($pass !== $pass2) {
        $error = 'Пароли не совпадают';
    } elseif ($pass === $login) {
        $error = 'Пароль не должен совпадать с логином';
    } elseif (!$installed && kurs_find_user_by_login($login)) {
        $error = 'Такой логин уже есть';
    } else {
        try {
            $pdo = kurs_db();
            if ($installed && $me) {
                /* повторная установка: просто меняем пароль текущего преподавателя */
                kurs_change_password((int) $me['id'], $pass, 'teacher');
            } else {
                $classId = null;
                if ($className !== '') {
                    $st = $pdo->prepare('SELECT id FROM classes WHERE name = ?');
                    $st->execute([$className]);
                    $row = $st->fetch();
                    if ($row) {
                        $classId = (int) $row['id'];
                    } else {
                        $pdo->prepare('INSERT INTO classes(name, active, created_ts) VALUES(?, 1, ?)')
                            ->execute([$className, kurs_now()]);
                        $classId = (int) $pdo->lastInsertId();
                    }
                }
                $existing = kurs_find_user_by_login($login);
                if ($existing) {
                    $pdo->prepare('UPDATE users SET pass_hash = ?, role = ?, name = ?, active = 1 WHERE id = ?')
                        ->execute([kurs_hash_password($pass), 'teacher', kurs_norm_name($name), (int) $existing['id']]);
                } else {
                    kurs_create_user($login, $name, $pass, 'teacher', $classId);
                }
            }
            kurs_set_setting('installed', '1');
            kurs_set_setting('threshold_default', (string) max(1, min(100, (int) ($_POST['threshold'] ?? 60))));
            if ($className !== '') {
                kurs_set_setting('school_name', trim((string) ($_POST['school'] ?? '')));
            }
            kurs_audit('install', 'установка завершена, преподаватель ' . $login);
            $done = true;
        } catch (Throwable $e) {
            $error = 'Не удалось сохранить: ' . $e->getMessage();
        }
    }
}

/* --- диагностика окружения --- */
$dataDir = kurs_data_dir();
$checks = [
    ['Версия PHP ≥ 8.1', version_compare(PHP_VERSION, '8.1.0', '>='), PHP_VERSION,
     'Web Station → Настройки сценария → выберите профиль PHP 8.1 или 8.2'],
    ['Расширение pdo_sqlite', extension_loaded('pdo_sqlite'), extension_loaded('pdo_sqlite') ? 'есть' : 'нет',
     'В профиле PHP включите pdo_sqlite и sqlite3'],
    ['Расширение mbstring', extension_loaded('mbstring'), extension_loaded('mbstring') ? 'есть' : 'нет',
     'В профиле PHP включите mbstring'],
    ['Хэш паролей', true, kurs_password_algo_name(),
     defined('PASSWORD_ARGON2ID') ? 'Argon2id доступен — отлично' : 'Argon2id нет, будет bcrypt (cost 12) — это тоже безопасно'],
    ['Каталог данных', is_dir($dataDir), $dataDir,
     'sudo mkdir -p ' . $dataDir . ' && sudo chown -R http:http ' . $dataDir . ' && sudo chmod 770 ' . $dataDir],
    ['Каталог доступен на запись', is_dir($dataDir) && is_writable($dataDir), is_dir($dataDir) && is_writable($dataDir) ? 'да' : 'нет',
     'Права должен иметь пользователь веб-сервера (в DSM это http)'],
    ['База данных', $dbOk, $dbOk ? (is_file(KURS_DB) ? KURS_DB : 'будет создана') : 'не открывается',
     $dbOk ? '' : $dbError . ' — проверьте open_basedir профиля PHP'],
    ['Банки вопросов', true, implode(', ', array_map(static function ($l) {
        $p = KURS_BANKS . '/' . $l . '.json';
        return strtoupper($l) . (is_file($p) ? ' ✓' : ' ✗');
    }, kurs_lesson_ids())), 'В папке banks должны лежать u1.json … u4.json'],
    ['Файлы курса', true, implode(', ', array_map(static function ($f) {
        return basename($f) . (is_file(KURS_ROOT . '/kursy/' . $f) ? ' ✓' : ' ✗');
    }, ['kurs-uchenik.html', 'prepod.html', 'test-urok-1.html'])), 'Запустите build_portal.py — он сложит файлы курса в kursy/'],
    ['HTTPS', kurs_is_https(), kurs_is_https() ? 'да' : 'нет',
     'Без HTTPS пароли идут открытым текстом. Включите сертификат и обратный прокси в DSM.'],
];

echo kurs_head('Установка портала');
?>
<div class="wrap" style="max-width:880px">
<h1>Установка портала</h1>
<p class="lead">Курс «Локальный ИИ своими руками» · Web Station на Synology</p>

<?php if ($done): ?>
<div class="note g"><b>Готово.</b> Пароль преподавателя сохранён в виде необратимого хэша
(<?php echo kurs_html_escape(kurs_password_algo_name()); ?>). База данных: <span class="code"><?php echo kurs_html_escape(KURS_DB); ?></span></p>
<p class="row">
  <a class="btn pri big" href="<?php echo kurs_html_escape(kurs_url('login.php')); ?>">Перейти к входу</a>
  <a class="btn" href="<?php echo kurs_html_escape(kurs_url('api/index.php?a=health')); ?>">Проверить состояние</a>
</p>
<p class="small muted">Не забудьте переименовать или удалить <span class="code">admin/install.php</span>.</p>
</div>
<?php endif; ?>

<?php if ($error !== ''): ?>
<div class="err"><?php echo kurs_html_escape($error); ?></div>
<?php endif; ?>

<div class="card">
  <h2 style="margin-top:0">1 · Проверка окружения</h2>
  <table>
    <tr><th>Проверка</th><th>Значение</th><th>Статус</th><th>Что делать, если не так</th></tr>
    <?php foreach ($checks as $c): ?>
    <tr>
      <td><b><?php echo kurs_html_escape($c[0]); ?></b></td>
      <td class="small code"><?php echo kurs_html_escape($c[2]); ?></td>
      <td><?php echo $c[1] ? '<span class="badge g">ок</span>' : '<span class="badge r">проблема</span>'; ?></td>
      <td class="small muted"><?php echo kurs_html_escape($c[3]); ?></td>
    </tr>
    <?php endforeach; ?>
  </table>
  <p class="small muted">Каталог данных: <span class="code"><?php echo kurs_html_escape($dataDir); ?></span>
  (вне веб-корня — так файл базы нельзя скачать по ссылке). Файл БД: <span class="code"><?php echo kurs_html_escape(KURS_DB); ?></span></p>
</div>

<?php if (!$done): ?>
<div class="card">
  <h2 style="margin-top:0">2 · Преподаватель</h2>
  <p class="small muted">Пароль будет сразу превращён в хэш и записан в базу. Восстановить его по хэшу
  нельзя ни вам, ни администратору NAS — поэтому не теряйте пароль и не используйте пароль от почты.</p>
  <form method="post" autocomplete="off">
    <div class="row2">
      <div><label class="f" for="name">Фамилия и имя</label>
        <input type="text" id="name" name="name" maxlength="60" required value="<?php echo $me ? kurs_html_escape((string) $me['name']) : ''; ?>"></div>
      <div><label class="f" for="login">Логин (латиницей)</label>
        <input type="text" id="login" name="login" maxlength="24" required value="<?php echo $me ? kurs_html_escape((string) $me['login']) : ''; ?>"></div>
    </div>
    <div class="row2">
      <div><label class="f" for="password">Пароль (не короче <?php echo (int) kurs_min_password('teacher'); ?> символов)</label>
        <input type="password" id="password" name="password" autocomplete="new-password" required></div>
      <div><label class="f" for="password2">Повторите пароль</label>
        <input type="password" id="password2" name="password2" autocomplete="new-password" required></div>
    </div>
    <div class="row2">
      <div><label class="f" for="class_name">Первый класс (например, 10Б)</label>
        <input type="text" id="class_name" name="class_name" maxlength="24" value="10Б"></div>
      <div><label class="f" for="threshold">Порог зачёта теста, %</label>
        <input type="number" id="threshold" name="threshold" min="1" max="100" value="60"></div>
    </div>
    <label class="f" for="school">Название школы (необязательно)</label>
    <input type="text" id="school" name="school" maxlength="80">
    <p><button class="btn pri big" type="submit">Установить и создать преподавателя</button></p>
  </form>
</div>
<?php endif; ?>

<div class="card">
  <h2 style="margin-top:0">3 · Что сделать после установки</h2>
  <ol class="small">
    <li>Переименуйте <span class="code">admin/install.php</span> в <span class="code">admin/install.php.off</span>.</li>
    <li>Закройте прямой доступ к папке <span class="code">kursy/</span> и к каталогу данных
      (правила в <span class="code">admin/README-DEPLOY.md</span>).</li>
    <li>Откройте <span class="code">api/index.php?a=health</span> — все проверки должны быть зелёными.</li>
    <li>Войдите как преподаватель → кабинет → «Ученики»: включите самостоятельную регистрацию
      или создайте аккаунты сами.</li>
    <li>Дайте ученикам адрес портала. Они регистрируются сами: фамилия, логин, пароль, класс.</li>
  </ol>
</div>
</div>
<?php
echo kurs_foot();
