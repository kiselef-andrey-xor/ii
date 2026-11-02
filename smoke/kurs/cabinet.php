<?php
/**
 * cabinet.php — кабинет преподавателя.
 * Журнал, прогресс класса, слабые темы, ученики, финальный проект, настройки, диагностика.
 * Доступ только с ролью teacher; все действия пишутся в журнал audit.
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
if ($me['role'] !== 'teacher') {
    http_response_code(403);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="ru"><meta charset="utf-8"><body style="background:#0b0a14;color:#ece9f8;'
        . 'font:17px system-ui;padding:40px"><h2>Раздел только для преподавателя</h2>'
        . '<p><a href="' . kurs_html_escape(kurs_url('index.php')) . '" style="color:#a78bfa">Вернуться к курсу</a></p>';
    exit;
}

echo kurs_head('Кабинет преподавателя');
echo kurs_topbar($me, 'cabinet');
?>
<div class="wrap">
<h1>Кабинет преподавателя</h1>
<p class="lead muted">Результаты тестов, прогресс класса и настройки портала.
Все действия кабинета пишутся в журнал аудита <span class="code">audit</span> в базе данных.</p>

<div class="tabs" id="cabTabs">
  <button class="tab on" data-p="journal" type="button">Журнал</button>
  <button class="tab" data-p="progress" type="button">Прогресс</button>
  <button class="tab" data-p="topics" type="button">Темы</button>
  <button class="tab" data-p="people" type="button">Ученики</button>
  <button class="tab" data-p="final" type="button">Финальный проект</button>
  <button class="tab" data-p="paper" type="button">Тест на бумаге</button>
  <button class="tab" data-p="settings" type="button">Настройки</button>
  <button class="tab" data-p="health" type="button">Диагностика</button>
</div>

<!-- ЖУРНАЛ -->
<section class="pane" id="p-journal">
  <div class="card">
    <div class="row">
      <div style="min-width:170px">
        <label class="f" for="fLesson">Урок</label>
        <select id="fLesson"><option value="">все уроки</option></select>
      </div>
      <div style="min-width:170px">
        <label class="f" for="fClass">Класс</label>
        <select id="fClass"><option value="">все классы</option></select>
      </div>
      <div style="min-width:200px">
        <label class="f" for="fQ">Поиск по фамилии или логину</label>
        <input type="text" id="fQ" placeholder="Иванова">
      </div>
      <div style="min-width:180px">
        <label class="f">&nbsp;</label>
        <label class="row" style="gap:8px;font-size:14.5px;text-transform:none;letter-spacing:0">
          <input type="checkbox" id="fBest" style="width:auto"> только лучший результат
        </label>
      </div>
      <div class="spacer"></div>
      <div>
        <label class="f">&nbsp;</label>
        <button class="btn pri" id="btnApply" type="button">Показать</button>
      </div>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="btnCsv" type="button">⬇ CSV для Excel</button>
      <button class="btn" id="btnJson" type="button">⬇ JSON</button>
      <button class="btn" id="btnCodes" type="button">⬇ Коды списком</button>
      <button class="btn" id="btnPrintJournal" type="button">🖨 Печать</button>
      <div class="spacer"></div>
      <button class="btn" id="btnImport" type="button">📥 Внести коды</button>
      <button class="btn" id="btnManual" type="button">✍️ Ручной ввод</button>
      <button class="btn dgr" id="btnClear" type="button">🗑 Очистить</button>
    </div>
  </div>

  <div class="card">
    <div class="row"><h2 style="margin:0">Результаты</h2><div class="spacer"></div>
      <span class="muted small" id="jCount"></span></div>
    <div id="jTable"><p class="muted">Нажмите «Показать».</p></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Сводка по журналу</h2>
    <div id="jSummary" class="grid g3"></div>
  </div>
</section>

<!-- ПРОГРЕСС -->
<section class="pane hidden" id="p-progress">
  <div class="card">
    <h2 style="margin-top:0">Кто где застрял</h2>
    <p class="small muted">Прогресс приходит из браузера ученика, пока он читает слайды:
    видно, до какого слайда дошёл каждый и сколько чек-листов закрыто.</p>
    <div id="progTable"></div>
  </div>
</section>

<!-- ТЕМЫ -->
<section class="pane hidden" id="p-topics">
  <div class="card">
    <h2 style="margin-top:0">Что классу не удалось</h2>
    <p class="small muted">Процент верных ответов по каждой теме всех собранных работ.
    Темы внизу списка — то, что стоит разобрать перед следующим занятием.</p>
    <div class="row" style="margin-bottom:8px">
      <select id="tLesson" style="max-width:220px"><option value="">все уроки</option></select>
      <select id="tClass" style="max-width:220px"><option value="">все классы</option></select>
      <button class="btn sm" id="btnTopics" type="button">Пересчитать</button>
    </div>
    <div id="topicTable"></div>
  </div>
</section>

<!-- УЧЕНИКИ -->
<section class="pane hidden" id="p-people">
  <div class="card">
    <div class="row">
      <h2 style="margin:0">Ученики и классы</h2>
      <div class="spacer"></div>
      <button class="btn" id="btnNewUser" type="button">+ Создать аккаунт</button>
      <button class="btn" id="btnNewClass" type="button">+ Создать класс</button>
    </div>
    <div id="usersTable"></div>
  </div>
  <div class="note c small"><b>Пароль ученика прочитать нельзя</b> — в базе лежит необратимый хэш.
  Если ученик забыл пароль, задайте новый через «сбросить»: при следующем входе портал попросит его сменить.</div>
</section>

<!-- ФИНАЛЬНЫЙ ПРОЕКТ -->
<section class="pane hidden" id="p-final">
  <div class="card">
    <div class="row">
      <h2 style="margin:0">Финальный проект · зачёт</h2>
      <div class="spacer"></div>
      <button class="btn" id="btnOpenFinal" type="button">Открыть проект всем</button>
    </div>
    <p class="small muted">Шесть команд по четыре человека. 100 баллов: 52 за обязательный минимум,
    30 за качество продукта, 18 за защиту; плюс до 20 бонусных. Порог зачёта — 60 баллов при закрытом минимуме.</p>
    <div id="finalTable"></div>
  </div>
</section>

<!-- ТЕСТ НА БУМАГЕ -->
<section class="pane hidden" id="p-paper">
  <div class="card noprint">
    <h2 style="margin-top:0">Пустой вариант на лист А4</h2>
    <p class="small muted">Если компьютеров на всех не хватает: печатаете вопросы с клеточками,
    ученики отвечают на бумаге, потом вы вносите результат через «Ручной ввод»
    или ученик отдаёт вам код из автономного теста.</p>
    <div class="row">
      <select id="pLesson" style="max-width:280px"></select>
      <div style="min-width:130px"><label class="f" for="pCount">Вопросов</label><input type="number" id="pCount" min="5" max="60" value="15"></div>
      <div><label class="f">&nbsp;</label><button class="btn pri" id="btnMakePaper" type="button">Собрать вариант</button></div>
      <button class="btn" id="btnPrintPaper" type="button">🖨 Печать</button>
    </div>
    <div class="err hidden" id="paperErr"></div>
  </div>
  <div class="card" id="paperBox"><p class="muted">Нажмите «Собрать вариант».</p></div>
</section>

<!-- НАСТРОЙКИ -->
<section class="pane hidden" id="p-settings">
  <div class="card">
    <h2 style="margin-top:0">Порог зачёта и длина варианта</h2>
    <div class="grid g2" id="setGrid"></div>
  </div>
  <div class="card">
    <h2 style="margin-top:0">Правила портала</h2>
    <div id="setRules"></div>
  </div>
  <div class="card">
    <h2 style="margin-top:0">Мой пароль</h2>
    <div class="row2" style="max-width:520px">
      <div><label class="f" for="myOld">Текущий пароль</label><input type="password" id="myOld" autocomplete="current-password"></div>
      <div><label class="f" for="myNew">Новый пароль</label><input type="password" id="myNew" autocomplete="new-password"></div>
    </div>
    <p class="small muted">Пароль хранится в базе как хэш <b id="algoName"></b>. Восстановить его по хэшу нельзя,
    поэтому «подсмотреть пароль ученика» не получится ни у кого, включая администратора NAS.</p>
    <button class="btn pri" id="btnMyPass" type="button">Сменить пароль</button>
    <div class="err hidden" id="myPassErr"></div>
  </div>
  <div class="row">
    <button class="btn pri big" id="btnSaveSettings" type="button">Сохранить настройки</button>
    <button class="btn" id="btnLogout" type="button">Выйти</button>
  </div>
</section>

<!-- ДИАГНОСТИКА -->
<section class="pane hidden" id="p-health">
  <div class="card">
    <h2 style="margin-top:0">Проверка установки</h2>
    <p class="small muted">То же самое, что <span class="code">api/index.php?a=health</span>.
    Покажите этот экран администратору NAS, если что-то не работает.</p>
    <div id="healthTable"></div>
  </div>
</section>

</div>

<!-- модалки -->
<div class="modal" id="mImport">
  <div class="mbox">
    <h3>Внести коды результатов</h3>
    <p class="small muted">Вставьте коды пачкой: по одному в строке, через запятую или через пробел.
    Коды, разбитые переносами, тоже распознаются. Дубликаты отбрасываются, битые помечаются.</p>
    <textarea id="impText" rows="9" placeholder="U1|ИВАНОВА ANNA|10Б|2611011104|50291|15|15|187|e7e7e7l777|lg22|kx"></textarea>
    <div class="row" style="margin-top:8px">
      <select id="impLesson" style="max-width:220px"><option value="">любой урок (по префиксу)</option></select>
    </div>
    <div id="impResult"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn pri" id="impGo" type="button">Внести</button>
      <button class="btn" data-close="mImport" type="button">Закрыть</button>
    </div>
  </div>
</div>

<div class="modal" id="mManual">
  <div class="mbox">
    <h3>Ручной ввод результата</h3>
    <p class="small muted">Если ученик писал на бумаге или код потерялся.</p>
    <label class="f" for="mnName">Фамилия и имя</label><input type="text" id="mnName" maxlength="40">
    <label class="f" for="mnGroup">Класс</label><input type="text" id="mnGroup" maxlength="16">
    <div class="row2">
      <div><label class="f" for="mnLesson">Урок</label><select id="mnLesson"></select></div>
      <div><label class="f" for="mnRight">Верно</label><input type="number" id="mnRight" min="0" max="60" value="0"></div>
    </div>
    <div class="row2">
      <div><label class="f" for="mnTotal">Всего вопросов</label><input type="number" id="mnTotal" min="1" max="60" value="15"></div>
      <div><label class="f" for="mnSec">Время решения, мин</label><input type="number" id="mnSec" min="0" max="600" value="0"></div>
    </div>
    <div class="err hidden" id="mnErr"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn pri" id="mnGo" type="button">Сохранить</button>
      <button class="btn" data-close="mManual" type="button">Отмена</button>
    </div>
  </div>
</div>

<div class="modal" id="mUser">
  <div class="mbox">
    <h3 id="uTitle">Новый аккаунт</h3>
    <label class="f" for="uName">Фамилия и имя</label><input type="text" id="uName" maxlength="60">
    <div class="row2">
      <div><label class="f" for="uLogin">Логин (латиницей)</label><input type="text" id="uLogin" maxlength="24"></div>
      <div><label class="f" for="uClass">Класс</label><select id="uClass"></select></div>
    </div>
    <div class="row2">
      <div><label class="f" for="uRole">Роль</label>
        <select id="uRole"><option value="student">ученик</option><option value="teacher">преподаватель</option></select></div>
      <div><label class="f" for="uPass">Временный пароль</label><input type="text" id="uPass" maxlength="64"></div>
    </div>
    <p class="small muted">Ученик сменит временный пароль при первом входе.</p>
    <div class="err hidden" id="uErr"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn pri" id="uGo" type="button">Создать</button>
      <button class="btn" data-close="mUser" type="button">Отмена</button>
    </div>
  </div>
</div>

<div class="modal" id="mReset">
  <div class="mbox">
    <h3>Сброс пароля</h3>
    <p class="small muted" id="rsWho"></p>
    <label class="f" for="rsPass">Новый пароль</label>
    <input type="text" id="rsPass" maxlength="64">
    <div class="row" style="margin-top:6px">
      <button class="btn sm" id="rsGen" type="button">🎲 Придумать</button>
      <span class="small muted">ученик сменит его при следующем входе</span>
    </div>
    <div class="err hidden" id="rsErr"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn pri" id="rsGo" type="button">Сбросить</button>
      <button class="btn" data-close="mReset" type="button">Отмена</button>
    </div>
  </div>
</div>

<div class="modal" id="mFinal">
  <div class="mbox">
    <h3 id="fnTitle">Оценка участника</h3>
    <div class="row2">
      <div><label class="f" for="fnGroup">Группа</label><input type="number" id="fnGroup" min="1" max="12" value="1"></div>
      <div><label class="f" for="fnName">Участник</label><input type="text" id="fnName" maxlength="40"></div>
    </div>
    <label class="f" for="fnTheme">Тема проекта</label><input type="text" id="fnTheme" maxlength="60">
    <label class="f" for="fnRole">Роль в команде</label><input type="text" id="fnRole" maxlength="30" placeholder="разработчик / данные / защита">
    <label class="f">Обязательный минимум (7 пунктов)</label>
    <div id="fnMin" class="grid" style="grid-template-columns:1fr;gap:4px"></div>
    <div class="row2" style="margin-top:8px">
      <div><label class="f" for="fnJury">Баллы жюри (0–100)</label><input type="number" id="fnJury" min="0" max="100" value="0"></div>
      <div><label class="f" for="fnBonus">Бонус (0–20)</label><input type="number" id="fnBonus" min="0" max="20" value="0"></div>
    </div>
    <label class="f" for="fnNote">Комментарий</label><input type="text" id="fnNote" maxlength="300">
    <div class="err hidden" id="fnErr"></div>
    <div class="row" style="margin-top:12px">
      <button class="btn pri" id="fnGo" type="button">Сохранить</button>
      <button class="btn" data-close="mFinal" type="button">Отмена</button>
    </div>
  </div>
</div>
<?php
echo kurs_foot('window.KURS_PAGE = "cabinet";', 'cabinet.js');
