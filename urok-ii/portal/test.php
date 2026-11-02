<?php
/**
 * test.php — промежуточный тест после урока.
 *
 * Два режима:
 *  • ученик вошёл в портал  → вариант выдаёт сервер (без правильных ответов),
 *    проверка серверная, результат сразу попадает в журнал преподавателю;
 *  • портал открыт как обычный сайт (файл с NAS без входа) → вариант собирается
 *    в браузере из публичного банка, результат выдаётся кодом, который ученик
 *    передаёт преподавателю. Это тренировочный режим: он не защищён от подглядывания,
 *    зачётный результат — только из первого режима.
 */

declare(strict_types=1);

require_once __DIR__ . '/api/bootstrap.php';

kurs_security_headers();
kurs_start_session();

$lesson = (string) ($_GET['u'] ?? 'u1');
if (!preg_match('/^u[1-4]$/', $lesson)) {
    $lesson = 'u1';
}
$bank = kurs_bank($lesson);
$me = kurs_current_user();
$publicBank = kurs_bank_public($lesson);

echo kurs_head('Тест · ' . kurs_html_escape((string) $bank['title']), 'test.css');
echo kurs_topbar($me, 'portal');
?>
<div class="wrap">

<!-- 1 · старт -->
<section id="scr-start">
  <h1>Тест · <?php echo kurs_html_escape((string) $bank['title']); ?></h1>
  <p class="lead"><?php echo kurs_html_escape((string) ($bank['subtitle'] ?? '')); ?></p>

  <?php if (!$me): ?>
  <div class="note a"><b>Вы не вошли в портал.</b> Тест пройдёт в тренировочном режиме:
  вариант соберётся в браузере, а результат выдастся кодом — его нужно передать преподавателю.
  Чтобы результат попал в журнал автоматически, <a href="<?php echo kurs_html_escape(kurs_url('login.php')); ?>">войдите</a>.</div>
  <?php else: ?>
  <div class="note g"><b>Вы вошли как <?php echo kurs_html_escape((string) $me['name']); ?>.</b>
  Результат сразу попадёт в журнал преподавателю.</div>
  <?php endif; ?>

  <div class="card">
    <div class="row" style="gap:22px">
      <div><div class="kv"><span class="muted">Вопросов в банке</span> <b id="regBank"><?php echo count($bank['questions']); ?></b></div>
      <div class="kv"><span class="muted">В варианте</span> <b id="regCount"><?php echo kurs_variant_count($lesson); ?></b></div></div>
      <div><div class="kv"><span class="muted">Тем</span> <b><?php echo count($bank['topics']); ?></b></div>
      <div class="kv"><span class="muted">Порог зачёта</span> <b id="regPass"><?php echo kurs_threshold($lesson); ?>%</b></div></div>
      <div><div class="kv"><span class="muted">Оценки</span> <b>5 ≥ 90% · 4 ≥ 75% · 3 ≥ порога</b></div>
      <div class="kv"><span class="muted">Время</span> <b>не ограничено</b></div></div>
    </div>

    <div id="whoBox">
      <label class="f" for="regName">Фамилия и имя</label>
      <input type="text" id="regName" maxlength="40" value="<?php echo $me ? kurs_html_escape((string) $me['name']) : ''; ?>"
        <?php echo $me ? 'readonly' : ''; ?> placeholder="Иванова Анна">
      <label class="f" for="regGroup">Класс</label>
      <input type="text" id="regGroup" maxlength="16" value="<?php echo $me && !empty($me['class_name']) ? kurs_html_escape((string) $me['class_name']) : ''; ?>"
        <?php echo $me ? 'readonly' : ''; ?> placeholder="10Б">
    </div>

    <label class="f" for="regN">Сколько вопросов в варианте</label>
    <select id="regN"></select>

    <div class="err hidden" id="startErr"></div>
    <p class="small muted">Вариант собирается случайно: по одному вопросу из каждой темы урока,
    остальные добираются из банка. Порядок вариантов ответа тоже перемешивается.</p>
    <button class="btn pri big" id="btnStart" type="button">Начать тест</button>
  </div>

  <div class="note c small"><b>Как отвечать.</b> Один верный вариант в каждом вопросе.
  Кнопка «Проверить ответы» разблокируется, когда отвечены все вопросы.
  После проверки откроются объяснения и разбор по темам — читайте их, даже если всё верно.</div>
</section>

<!-- 2 · вопросы -->
<section id="scr-test" class="hidden">
  <div class="row">
    <h1 style="margin:0">Тест</h1>
    <div class="spacer"></div>
    <span class="tag" id="tWho"></span>
    <span class="tag b" id="tVar"></span>
    <span class="tag" id="tCount"></span>
  </div>
  <div class="bar"><i id="tBar"></i></div>
  <p class="small muted" id="tLeft"></p>
  <div id="tList"></div>
  <div class="row" style="margin-top:18px">
    <button class="btn pri big" id="btnSubmit" type="button" disabled>Проверить ответы</button>
    <button class="btn" id="btnRestart" type="button">⟲ Начать заново</button>
    <div class="spacer"></div>
    <span class="small muted" id="submitHint"></span>
  </div>
</section>

<!-- 3 · результат -->
<section id="scr-res" class="hidden">
  <div class="card center">
    <div class="score" id="rScore">0 / 0</div>
    <div id="rGrade" class="grade"></div>
    <p class="lead" id="rVerdict"></p>
    <p class="small muted" id="rMeta"></p>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Код результата</h2>
    <p class="small muted">Внутри — имя, класс, дата и время, вариант, баллы, время решения,
    отметки по темам и контрольная сумма. Изменить баллы в коде нельзя: не сойдётся контрольная сумма.</p>
    <div class="code" id="rCode" style="font-size:14px;padding:10px 12px;display:block"></div>
    <div class="row" style="margin-top:10px">
      <button class="btn" id="btnCopy" type="button">📋 Скопировать код</button>
      <span class="small muted" id="copyHint"></span>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Разбор по темам</h2>
    <div id="rTopics"></div>
    <div id="rWeak"></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Объяснения</h2>
    <div class="row" style="margin-bottom:10px">
      <button class="btn sm" id="btnOnlyBad" type="button">Только ошибки</button>
      <button class="btn sm" id="btnAll" type="button">Все вопросы</button>
    </div>
    <div id="rDetail"></div>
  </div>

  <div class="row">
    <button class="btn pri big" id="btnAgain" type="button">Пройти ещё раз</button>
    <a class="btn big" id="btnBack" href="#">← Вернуться к курсу</a>
  </div>
</section>

</div>
<?php
echo kurs_foot(
    'window.KURS_PAGE = "test";'
    . 'window.KURS_LESSON = ' . json_encode($lesson) . ';'
    . 'window.KURS_PREFIX = ' . json_encode((string) $bank['prefix']) . ';'
    . 'window.KURS_TOPICS = ' . json_encode($bank['topics'], JSON_UNESCAPED_UNICODE) . ';'
    . 'window.KURS_COLORS = ' . json_encode((object) ($bank['colors'] ?? []), JSON_UNESCAPED_UNICODE) . ';'
    . 'window.KURS_TITLE = ' . json_encode((string) $bank['title'], JSON_UNESCAPED_UNICODE) . ';'
    . 'window.KURS_THRESHOLD = ' . (int) kurs_threshold($lesson) . ';'
    . 'window.KURS_DEFAULT_COUNT = ' . (int) kurs_variant_count($lesson) . ';'
    . 'window.KURS_LOGGED_IN = ' . ($me ? 'true' : 'false') . ';'
    . 'window.KURS_BANK_URL = ' . json_encode('banks/public/' . $lesson . '.json', JSON_UNESCAPED_SLASHES) . ';',
    'test.js'
);
