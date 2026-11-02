<?php
/**
 * index.php — одна страница со всем курсом.
 *
 * Слева — уроки и тесты с прогрессом, справа — файл урока в iframe.
 * Файлы курса не переписываются: портал читает их прогресс из localStorage
 * (same-origin) и синхронизирует его с сервером, а при входе на новом компьютере
 * возвращает сохранённое состояние обратно в файл.
 */

declare(strict_types=1);

require_once __DIR__ . '/api/bootstrap.php';

kurs_security_headers();
kurs_start_session();

$me = kurs_current_user();
if (!$me) {
    header('Location: ' . kurs_url('login.php'));
    exit;
}
if (kurs_setting_int('installed', 0, 0, 1) !== 1) {
    header('Location: ' . kurs_url('admin/install.php'));
    exit;
}

echo kurs_head('Курс · ' . kurs_html_escape((string) $me['name']));
echo kurs_topbar($me, 'portal');
?>
<div class="shell">
  <aside class="side">
    <div class="sidehead">Уроки</div>
    <div id="lessons"><div class="empty"><span class="spin"></span> загружаем курс…</div></div>
    <div class="sidehead">Прочее</div>
    <button class="litem" id="btnFinalInfo" type="button">
      <span class="t">🏁 Финальный проект</span>
      <span class="s">Задание, роли и рубрика зачёта</span>
    </button>
    <button class="litem" id="btnOffline" type="button">
      <span class="t">💾 Автономный тест урока 1</span>
      <span class="s">Открывается без портала, выдаёт код результата</span>
    </button>
    <div style="margin:16px 2px" class="row">
      <button class="btn sm" id="btnPass" type="button">Сменить пароль</button>
      <div class="spacer"></div>
      <button class="btn sm dgr" id="btnLogout" type="button">Выйти</button>
    </div>
    <p class="small muted" id="syncState" style="margin:0 2px"></p>
  </aside>

  <section class="stage">
    <div class="stagehead">
      <span class="nm" id="stageName">Выберите урок слева</span>
      <div class="spacer"></div>
      <button class="btn sm" id="btnNewTab" type="button" title="Открыть файл урока в отдельной вкладке">↗ Новая вкладка</button>
      <button class="btn sm" id="btnPrint" type="button" title="Печать / сохранить в PDF">🖨 Печать</button>
      <button class="btn sm" id="btnReload" type="button" title="Перечитать файл урока">⟳ Обновить</button>
    </div>
    <iframe id="frame" title="Материал урока" src="about:blank" referrerpolicy="no-referrer"></iframe>
    <div class="empty" id="stageEmpty">
      <h2>Добро пожаловать!</h2>
      <p class="lead">Выберите урок в списке слева. Прогресс сохраняется на сервере:
      можно закрыть браузер, сесть за другой компьютер и продолжить с того же места.</p>
      <p class="small muted">Слайды открываются по порядку: теорию нужно прочитать и нажать «Далее»,
      в практиках — отметить все пункты чек-листа, тест в конце урока открывается только когда все ответы верны.</p>
    </div>
  </section>
</div>

<!-- смена пароля -->
<div class="modal" id="mPass">
  <div class="mbox">
    <h3>Смена пароля</h3>
    <label class="f" for="pOld">Текущий пароль</label>
    <input type="password" id="pOld" autocomplete="current-password">
    <label class="f" for="pNew">Новый пароль</label>
    <input type="password" id="pNew" autocomplete="new-password">
    <label class="f" for="pNew2">Повторите новый пароль</label>
    <input type="password" id="pNew2" autocomplete="new-password">
    <div class="err hidden" id="pErr"></div>
    <div class="row" style="margin-top:14px">
      <button class="btn pri" id="pSave" type="button">Сохранить</button>
      <button class="btn" id="pCancel" type="button">Отмена</button>
    </div>
  </div>
</div>
<?php
echo kurs_foot('window.KURS_PAGE = "portal";', 'portal.js');
