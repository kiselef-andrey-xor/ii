<?php
/**
 * login.php — вход и самостоятельная регистрация ученика.
 * Пароль проверяется только на сервере (password_verify), хэш наружу не отдаётся.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/common.php';

kurs_security_headers();
kurs_start_session();

$me = kurs_current_user();
if ($me) {
    header('Location: ' . kurs_url('index.php'));
    exit;
}

$installed = kurs_setting_int('installed', 0, 0, 1) === 1;
$selfReg = kurs_setting_int('allow_self_register', 1, 0, 1) === 1;
$minPass = kurs_min_password('student');

if (!$installed) {
    header('Location: ' . kurs_url('admin/install.php'));
    exit;
}

echo kurs_head('Вход · курс «Локальный ИИ своими руками»');
echo '<main class="loginwrap">';
echo '<div class="logincard">';
echo '<div class="logo big"><span class="dot"></span> Локальный ИИ <small>своими руками</small></div>';
echo '<p class="lead small muted">Четыре урока, 48 практик и четыре теста. Всё делается в классе на вашем компьютере: '
    . '16 ГБ памяти и видеокарта RTX 3060. Домашних заданий нет.</p>';

if (!kurs_is_https()) {
    echo '<div class="note a small"><b>Соединение не защищено.</b> Портал открыт по HTTP — пароль виден '
        . 'всем, кто находится в этой сети. Попросите администратора включить HTTPS, '
        . 'или используйте портал только в изолированной школьной сети.</div>';
}

echo '<div class="tabs" id="tabs">
  <button class="tab on" data-t="in" type="button">Вход</button>'
  . ($selfReg ? '<button class="tab" data-t="reg" type="button">Регистрация</button>' : '') . '
</div>';

/* --- вход --- */
echo '<form id="fIn" class="pane" autocomplete="on">
  <label class="f" for="inLogin">Логин</label>
  <input type="text" id="inLogin" name="login" autocomplete="username" maxlength="24" required>
  <label class="f" for="inPass">Пароль</label>
  <input type="password" id="inPass" name="password" autocomplete="current-password" required>
  <div class="err hidden" id="inErr"></div>
  <button class="btn pri big w100" type="submit" id="inBtn">Войти</button>
  <p class="small muted">Забыли пароль? Его сбрасывает преподаватель в кабинете — подойдите к нему.</p>
</form>';

/* --- регистрация --- */
if ($selfReg) {
    echo '<form id="fReg" class="pane hidden" autocomplete="off">
  <label class="f" for="rgName">Фамилия и имя</label>
  <input type="text" id="rgName" name="name" maxlength="60" placeholder="Иванова Анна" required>
  <div class="row2">
    <div>
      <label class="f" for="rgLogin">Логин (латиницей)</label>
      <input type="text" id="rgLogin" name="login" maxlength="24" placeholder="ivanova.a" required>
    </div>
    <div>
      <label class="f" for="rgClass">Класс</label>
      <input type="text" id="rgClass" name="class_name" maxlength="24" placeholder="10Б" required>
    </div>
  </div>
  <label class="f" for="rgPass">Пароль (не короче ' . (int) $minPass . ' символов)</label>
  <input type="password" id="rgPass" name="password" autocomplete="new-password" minlength="' . (int) $minPass . '" required>
  <label class="f" for="rgPass2">Повторите пароль</label>
  <input type="password" id="rgPass2" name="password2" autocomplete="new-password" required>
  <div class="err hidden" id="rgErr"></div>
  <button class="btn pri big w100" type="submit" id="rgBtn">Зарегистрироваться и войти</button>
  <p class="small muted">Пароль хранится на сервере в виде необратимого хэша — прочитать его нельзя,
  в том числе преподавателю. Не используйте пароль от почты или от других сайтов.</p>
</form>';
}

echo '</div>';
echo '<p class="center small muted" style="margin-top:14px">Портал работает на школьном сервере. '
    . 'Результаты тестов видит только преподаватель.</p>';
echo '</main>';
echo kurs_foot('window.KURS_SELF_REG = ' . ($selfReg ? 'true' : 'false') . ';window.KURS_PAGE = "login";');
