/* cabinet.js — кабинет преподавателя. */
(function () {
  'use strict';

  var K = window.K;
  var $ = K.$, esc = K.esc, toast = K.toast;

  var D = { boot: null, classes: [], lessons: [], journal: [], stats: null, users: [], finals: [] };
  var MIN_ITEMS = [
    'Работает полностью офлайн',
    'Общение с моделью через API',
    'Три инструмента, один из них свой',
    'RAG по своим документам',
    'Устойчивый стиль ответов',
    'Безопасность: секреты и права',
    'Обработка ошибок и лог действий'
  ];

  /* --- вспомогательное ---------------------------------------------------- */
  function post(op, body) { return K.request('teacher', { op: op }, Object.assign({ op: op }, body || {})); }
  function open(id) { $(id).classList.add('open'); }
  function close(id) { $(id).classList.remove('open'); }
  function errBox(id, msg) {
    var e = $(id);
    if (!e) { return; }
    e.textContent = msg || '';
    e.classList.toggle('hidden', !msg);
  }
  function fmtDate(ts) {
    var d = new Date(ts * 1000);
    return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0')
      + '.' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fmtDur(sec) {
    sec = Math.max(0, sec | 0);
    return Math.floor(sec / 60) + ' мин ' + String(sec % 60).padStart(2, '0') + ' с';
  }
  function gradeCls(g) { return g >= 4 ? 'ok' : (g === 3 ? 'wr' : 'no'); }
  function lessonTitle(id) {
    for (var i = 0; i < D.lessons.length; i++) { if (D.lessons[i].id === id) { return D.lessons[i].title; } }
    return id.toUpperCase();
  }

  /* --- вкладки ------------------------------------------------------------ */
  function tabs() {
    var btns = document.querySelectorAll('#cabTabs .tab');
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(btns, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        document.querySelectorAll('.pane').forEach(function (p) { p.classList.add('hidden'); });
        var id = 'p-' + b.dataset.p;
        $(id).classList.remove('hidden');
        loaders[b.dataset.p] && loaders[b.dataset.p]();
      });
    });
  }

  var loaders = {
    journal: loadJournal,
    progress: loadStats,
    topics: loadStats,
    people: loadPeople,
    final: loadFinal,
    settings: loadSettings,
    health: loadHealth
  };

  /* --- журнал ------------------------------------------------------------- */
  function journalParams() {
    return {
      lesson: $('fLesson').value,
      class_id: $('fClass').value,
      q: $('fQ').value.trim(),
      best: $('fBest').checked ? 1 : ''
    };
  }

  function loadJournal() {
    K.request('results', journalParams()).then(function (r) {
      D.journal = r.rows || [];
      renderJournal();
    }).catch(function (e) { toast(e.message, true); });
  }

  function renderJournal() {
    var rows = D.journal;
    $('jCount').textContent = 'записей: ' + rows.length;
    if (!rows.length) {
      $('jTable').innerHTML = '<p class="muted">Пока пусто. Результаты появляются, когда ученик сдал тест в портале, '
        + 'или когда вы внесли коды вручную.</p>';
      $('jSummary').innerHTML = '';
      return;
    }
    var html = '<table><tr><th>Дата и время</th><th>Ученик</th><th>Класс</th><th>Урок</th>'
      + '<th class="num">Вариант</th><th class="num">Верно</th><th class="num">%</th><th class="num">Оценка</th>'
      + '<th>Время</th><th>Слабые темы</th><th>Источник</th><th></th></tr>';
    rows.forEach(function (r) {
      html += '<tr>'
        + '<td class="small">' + esc(fmtDate(r.ts)) + '</td>'
        + '<td><b>' + esc(r.name || r.login) + '</b>' + (r.login ? '<br><span class="dim2 small">@' + esc(r.login) + '</span>' : '') + '</td>'
        + '<td>' + esc(r['class'] || '') + '</td>'
        + '<td>' + esc(r.lesson.toUpperCase()) + '</td>'
        + '<td class="num">' + (r.variant || '—') + '</td>'
        + '<td class="num">' + r.right + ' / ' + r.total + '</td>'
        + '<td class="num">' + r.pct + '%</td>'
        + '<td class="num ' + gradeCls(r.grade) + '"><b>' + r.grade + '</b></td>'
        + '<td class="small">' + esc(fmtDur(r.sec)) + '</td>'
        + '<td class="small">' + (r.weak || []).map(esc).join(', ') + '</td>'
        + '<td class="small">' + esc(sourceName(r.source)) + '</td>'
        + '<td><button class="btn sm" data-code="' + esc(r.code) + '" title="Показать код">код</button> '
        + '<button class="btn sm dgr" data-del="' + r.id + '" title="Удалить запись">✕</button></td>'
        + '</tr>';
    });
    html += '</table>';
    $('jTable').innerHTML = html;

    Array.prototype.forEach.call($('jTable').querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Удалить запись из журнала?')) { return; }
        post('delete_attempt', { id: parseInt(b.dataset.del, 10) })
          .then(function () { toast('Запись удалена'); loadJournal(); })
          .catch(function (e) { toast(e.message, true); });
      });
    });
    Array.prototype.forEach.call($('jTable').querySelectorAll('[data-code]'), function (b) {
      b.addEventListener('click', function () {
        prompt('Код результата (можно скопировать):', b.dataset.code);
      });
    });
    renderSummary(rows);
  }

  function sourceName(s) {
    return { web: 'портал', paste: 'внесён кодом', manual: 'вручную' }[s] || s;
  }

  function renderSummary(rows) {
    var byLesson = {};
    var grades = { 5: 0, 4: 0, 3: 0, 2: 0 };
    var passed = 0;
    rows.forEach(function (r) {
      byLesson[r.lesson] = byLesson[r.lesson] || { n: 0, sum: 0, best: {} };
      byLesson[r.lesson].n++;
      byLesson[r.lesson].sum += r.pct;
      var key = r.name || r.login;
      var b = byLesson[r.lesson].best[key];
      if (!b || r.pct > b) { byLesson[r.lesson].best[key] = r.pct; }
      grades[r.grade] = (grades[r.grade] || 0) + 1;
      if (r.pct >= 60) { passed++; }
    });
    var html = '';
    html += card('Попыток', String(rows.length), 'всего записей в выборке');
    html += card('Средний процент', rows.length ? Math.round(rows.reduce(function (a, r) { return a + r.pct; }, 0) / rows.length) + '%' : '—',
      'по всем попыткам');
    html += card('Оценки', '5:' + grades[5] + ' · 4:' + grades[4] + ' · 3:' + grades[3] + ' · 2:' + grades[2], 'распределение');
    Object.keys(byLesson).sort().forEach(function (l) {
      var s = byLesson[l];
      var bests = Object.keys(s.best).map(function (k) { return s.best[k]; });
      var avg = bests.length ? Math.round(bests.reduce(function (a, b) { return a + b; }, 0) / bests.length) : 0;
      html += card(lessonTitle(l), bests.length + ' чел. · ' + s.n + ' попыт.', 'средний лучший результат ' + avg + '%');
    });
    $('jSummary').innerHTML = html;
  }

  function card(title, value, sub) {
    return '<div class="card" style="margin:0"><div class="small muted">' + esc(title) + '</div>'
      + '<div style="font-size:22px;font-weight:700;color:#fff;margin:3px 0">' + esc(value) + '</div>'
      + '<div class="small dim2">' + esc(sub) + '</div></div>';
  }

  function exportUrl(f) {
    var p = journalParams();
    p.f = f;
    return K.api + K.qs(Object.assign({ a: 'export' }, p));
  }

  /* --- статистика: прогресс и темы ---------------------------------------- */
  function loadStats() {
    var params = {};
    if ($('tLesson')) { params.lesson = $('tLesson').value; }
    if ($('tClass')) { params.class_id = $('tClass').value; }
    K.request('stats', params).then(function (r) {
      D.stats = r;
      renderProgress(r);
      renderTopics(r);
      fillClassFilter(r.classes || []);
    }).catch(function (e) { toast(e.message, true); });
  }

  function fillClassFilter(classes) {
    D.classes = classes;
    ['fClass', 'tClass', 'uClass'].forEach(function (id) {
      var sel = $(id);
      if (!sel) { return; }
      var keep = sel.value;
      var first = sel.options.length ? sel.options[0].outerHTML : '';
      sel.innerHTML = first;
      classes.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name + (c.students !== undefined ? ' (' + c.students + ')' : '');
        sel.appendChild(o);
      });
      sel.value = keep;
    });
  }

  function renderProgress(r) {
    var people = r.people || [];
    if (!people.length) {
      $('progTable').innerHTML = '<p class="muted">Учеников пока нет.</p>';
      return;
    }
    var lessons = ['u1', 'u2', 'u3', 'u4'];
    var html = '<table><tr><th>Ученик</th><th>Класс</th>';
    lessons.forEach(function (l) { html += '<th>' + l.toUpperCase() + ' · слайды</th><th class="num">тест</th>'; });
    html += '<th>Последняя активность</th></tr>';
    people.forEach(function (p) {
      html += '<tr><td><b>' + esc(p.name) + '</b><br><span class="dim2 small">@' + esc(p.login) + '</span></td>'
        + '<td>' + esc(p['class'] || '') + '</td>';
      var last = '';
      lessons.forEach(function (l) {
        var pr = p.lessons && p.lessons[l];
        var g = p.grades && p.grades[l];
        html += '<td class="small">' + (pr ? (pr.unlocked + 1) + (pr.tasks_all ? ' · ✓' + pr.tasks_done + '/' + pr.tasks_all : '') : '<span class="dim2">—</span>') + '</td>';
        html += '<td class="num ' + (g ? gradeCls(g.grade) : 'dim2') + '">' + (g ? g.grade + ' (' + g.pct + '%)' : '—') + '</td>';
        if (pr && (!last || pr.updated > last)) { last = pr.updated; }
      });
      html += '<td class="small dim2">' + esc(last || 'не открывал') + '</td></tr>';
    });
    html += '</table>';
    $('progTable').innerHTML = html;
  }

  function renderTopics(r) {
    var topics = r.topics || [];
    if (!topics.length) {
      $('topicTable').innerHTML = '<p class="muted">Нет данных: темы считаются по сданным тестам.</p>';
      return;
    }
    var html = '<table><tr><th>Урок</th><th>Тема</th><th class="num">Верно</th><th style="width:34%">Доля</th><th class="num">Работ</th></tr>';
    topics.forEach(function (t) {
      var cls = t.pct >= 80 ? 'ok' : (t.pct >= 60 ? 'wr' : 'no');
      html += '<tr><td class="small">' + esc(t.lesson.toUpperCase()) + '</td>'
        + '<td>' + esc(t.topic) + '</td>'
        + '<td class="num ' + cls + '">' + t.ok + ' / ' + t.all + '</td>'
        + '<td><div class="bar"><i style="width:' + t.pct + '%"></i></div><span class="small ' + cls + '">' + t.pct + '%</span></td>'
        + '<td class="num">' + t.works + '</td></tr>';
    });
    html += '</table>';
    $('topicTable').innerHTML = html;
  }

  /* --- ученики ------------------------------------------------------------ */
  function loadPeople() {
    Promise.all([post('users'), post('classes')]).then(function (res) {
      D.users = res[0].users || [];
      D.classes = res[1].classes || [];
      renderUsers();
      fillClassFilter(D.classes);
    }).catch(function (e) { toast(e.message, true); });
  }

  function renderUsers() {
    var html = '<table><tr><th>Имя</th><th>Логин</th><th>Класс</th><th>Роль</th><th>Последний вход</th><th>Состояние</th><th></th></tr>';
    D.users.forEach(function (u) {
      html += '<tr><td><b>' + esc(u.name) + '</b></td>'
        + '<td class="small">@' + esc(u.login) + (u.must_change === 1 ? ' <span class="badge a">сменит пароль</span>' : '') + '</td>'
        + '<td>' + esc(u.class_name || '—') + '</td>'
        + '<td>' + (u.role === 'teacher' ? '<span class="badge b">преподаватель</span>' : 'ученик') + '</td>'
        + '<td class="small dim2">' + (u.last_login_ts ? esc(fmtDate(u.last_login_ts)) : 'не входил') + '</td>'
        + '<td>' + (u.active === 1 ? '<span class="badge g">активен</span>' : '<span class="badge r">отключён</span>') + '</td>'
        + '<td class="row" style="gap:6px">'
        + '<button class="btn sm" data-reset="' + u.id + '" data-name="' + esc(u.name) + '">🔑 Пароль</button>'
        + (u.role === 'teacher' ? '' : '<button class="btn sm" data-toggle="' + u.id + '">' + (u.active === 1 ? 'Отключить' : 'Включить') + '</button>')
        + '</td></tr>';
    });
    html += '</table>';
    $('usersTable').innerHTML = html;

    Array.prototype.forEach.call($('usersTable').querySelectorAll('[data-reset]'), function (b) {
      b.addEventListener('click', function () {
        window.__resetId = parseInt(b.dataset.reset, 10);
        $('rsWho').textContent = 'Новый пароль для: ' + b.dataset.name;
        $('rsPass').value = '';
        errBox('rsErr', '');
        open('mReset');
      });
    });
    Array.prototype.forEach.call($('usersTable').querySelectorAll('[data-toggle]'), function (b) {
      b.addEventListener('click', function () {
        post('toggle_user', { user_id: parseInt(b.dataset.toggle, 10) })
          .then(function () { loadPeople(); })
          .catch(function (e) { toast(e.message, true); });
      });
    });
  }

  function randomPass() {
    var abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    var out = '';
    for (var i = 0; i < 8; i++) { out += abc[Math.floor(Math.random() * abc.length)]; }
    return out;
  }

  /* --- финальный проект --------------------------------------------------- */
  function loadFinal() {
    post('final_list').then(function (r) {
      D.finals = r.groups || [];
      renderFinal();
    }).catch(function (e) { toast(e.message, true); });
  }

  function renderFinal() {
    var html = '<div class="row" style="margin-bottom:8px"><button class="btn sm" id="fnAdd">+ Добавить участника</button></div>';
    html += '<table><tr><th class="num">Группа</th><th>Тема</th><th>Участник</th><th>Роль</th>'
      + '<th class="num">Минимум</th><th class="num">Жюри</th><th class="num">Бонус</th><th class="num">Итого</th><th>Зачёт</th><th></th></tr>';
    if (!D.finals.length) {
      html += '<tr><td colspan="10" class="muted">Пока никто не внесён. Добавьте участников шести групп.</td></tr>';
    }
    D.finals.forEach(function (g) {
      var min = 0;
      try {
        var m = JSON.parse(g.min_items || '{}');
        Object.keys(m).forEach(function (k) { if (m[k]) { min++; } });
      } catch (e) { min = 0; }
      html += '<tr><td class="num">' + g.group_no + '</td>'
        + '<td class="small">' + esc(g.theme) + '</td>'
        + '<td><b>' + esc(g.member_name) + '</b></td>'
        + '<td class="small">' + esc(g.role) + '</td>'
        + '<td class="num ' + (min >= 7 ? 'ok' : 'wr') + '">' + min + ' / 7</td>'
        + '<td class="num">' + g.jury_score + '</td>'
        + '<td class="num">' + g.bonus + '</td>'
        + '<td class="num"><b>' + g.total + '</b></td>'
        + '<td>' + (g.passed === 1 ? '<span class="badge g">зачёт</span>' : '<span class="badge r">не зачтено</span>') + '</td>'
        + '<td><button class="btn sm" data-edit="' + esc(g.member_name) + '" data-group="' + g.group_no + '">изменить</button></td></tr>';
    });
    html += '</table>';
    $('finalTable').innerHTML = html;

    $('fnAdd').addEventListener('click', function () { showFinalForm(null); });
    Array.prototype.forEach.call($('finalTable').querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        var rec = null;
        D.finals.forEach(function (g) {
          if (g.member_name === b.dataset.edit && String(g.group_no) === b.dataset.group) { rec = g; }
        });
        showFinalForm(rec);
      });
    });
  }

  function showFinalForm(rec) {
    errBox('fnErr', '');
    var box = $('fnMin');
    box.innerHTML = '';
    var saved = {};
    if (rec) {
      try { saved = JSON.parse(rec.min_items || '{}'); } catch (e) { saved = {}; }
    }
    MIN_ITEMS.forEach(function (name, i) {
      var l = document.createElement('label');
      l.className = 'row small';
      l.style.cssText = 'gap:8px;text-transform:none;letter-spacing:0;margin:2px 0';
      l.innerHTML = '<input type="checkbox" style="width:auto" data-min="' + i + '"' + (saved[i] ? ' checked' : '') + '> ' + esc(name);
      box.appendChild(l);
    });
    $('fnGroup').value = rec ? rec.group_no : 1;
    $('fnName').value = rec ? rec.member_name : '';
    $('fnTheme').value = rec ? rec.theme : '';
    $('fnRole').value = rec ? rec.role : '';
    $('fnJury').value = rec ? rec.jury_score : 0;
    $('fnBonus').value = rec ? rec.bonus : 0;
    $('fnNote').value = rec ? rec.note : '';
    open('mFinal');
  }

  function saveFinal() {
    var min = {};
    Array.prototype.forEach.call($('fnMin').querySelectorAll('[data-min]'), function (c) {
      min[c.dataset.min] = c.checked ? 1 : 0;
    });
    post('final', {
      group_no: parseInt($('fnGroup').value, 10) || 0,
      member_name: $('fnName').value.trim(),
      theme: $('fnTheme').value.trim(),
      role: $('fnRole').value.trim(),
      min_items: min,
      jury_score: parseInt($('fnJury').value, 10) || 0,
      bonus: parseInt($('fnBonus').value, 10) || 0,
      note: $('fnNote').value.trim()
    }).then(function (r) {
      close('mFinal');
      toast('Сохранено: ' + r.total + ' баллов · ' + (r.passed ? 'зачёт' : 'не зачтено'));
      loadFinal();
    }).catch(function (e) { errBox('fnErr', e.message); });
  }

  /* --- настройки ---------------------------------------------------------- */
  function loadSettings() {
    var lessons = D.lessons;
    var html = '';
    lessons.forEach(function (L) {
      if (!L.count) { return; }
      html += '<div class="card" style="margin:0"><b>' + esc(L.title) + '</b>'
        + '<div class="row2" style="margin-top:8px">'
        + '<div><label class="f" for="th_' + L.id + '">Порог зачёта, %</label>'
        + '<input type="number" id="th_' + L.id + '" min="1" max="100" value="' + L.threshold + '"></div>'
        + '<div><label class="f" for="cn_' + L.id + '">Вопросов в варианте (банк ' + L.bank + ')</label>'
        + '<input type="number" id="cn_' + L.id + '" min="5" max="' + L.bank + '" value="' + L.count + '"></div>'
        + '</div></div>';
    });
    $('setGrid').innerHTML = html || '<p class="muted">Нет уроков.</p>';

    var rules = [
      ['require_test_for_next', 'Следующий урок открывается только после зачёта по тесту предыдущего'],
      ['open_final', 'Финальный проект открыт всем ученикам (иначе — только зачтённым и преподавателю)'],
      ['allow_self_register', 'Ученики могут зарегистрироваться сами на странице входа'],
      ['two_factor_teacher', 'Требовать одноразовый код при входе преподавателя']
    ];
    var rh = '';
    rules.forEach(function (r) {
      var on = r[0] === 'require_test_for_next' ? D.boot.require_test_for_next
        : (r[0] === 'open_final' ? D.boot.open_final
          : (r[0] === 'allow_self_register' ? D.boot.self_register : false));
      rh += '<label class="row" style="gap:10px;margin:8px 0;text-transform:none;letter-spacing:0">'
        + '<input type="checkbox" id="rl_' + r[0] + '" style="width:auto"' + (on ? ' checked' : '') + '> '
        + '<span>' + esc(r[1]) + '</span></label>';
    });
    rh += '<label class="f" for="school">Название школы (показывается в шапке)</label>'
      + '<input type="text" id="school" maxlength="80" value="' + esc(D.boot.school || '') + '">';
    rh += '<div class="row2" style="margin-top:10px;max-width:460px">'
      + '<div><label class="f" for="mps">Мин. длина пароля ученика</label>'
      + '<input type="number" id="mps" min="4" max="32" value="' + D.boot.min_pass + '"></div>'
      + '<div><label class="f" for="thd">Порог зачёта по умолчанию, %</label>'
      + '<input type="number" id="thd" min="1" max="100" value="'
      + (D.lessons[0] ? D.lessons[0].threshold : 60) + '"></div></div>';
    $('setRules').innerHTML = rh;
    $('algoName').textContent = D.boot.algo || 'bcrypt';
  }

  function saveSettings() {
    var body = {
      require_test_for_next: $('rl_require_test_for_next').checked ? 1 : 0,
      open_final: $('rl_open_final').checked ? 1 : 0,
      allow_self_register: $('rl_allow_self_register').checked ? 1 : 0,
      two_factor_teacher: $('rl_two_factor_teacher').checked ? 1 : 0,
      school_name: $('school').value.trim(),
      min_pass_student: parseInt($('mps').value, 10) || 6,
      threshold_default: parseInt($('thd').value, 10) || 60
    };
    D.lessons.forEach(function (L) {
      var th = $('th_' + L.id), cn = $('cn_' + L.id);
      if (th) { body['threshold_' + L.id] = parseInt(th.value, 10) || 60; }
      if (cn) { body['count_' + L.id] = parseInt(cn.value, 10) || 15; }
    });
    post('set_settings', body).then(function () {
      toast('Настройки сохранены');
      return K.request('bootstrap');
    }).then(function (b) {
      D.boot = b;
      return K.request('lessons');
    }).then(function (l) {
      D.lessons = l.lessons.filter(function (x) { return x.count; });
      loadSettings();
    }).catch(function (e) { toast(e.message, true); });
  }

  /* --- диагностика -------------------------------------------------------- */
  function loadHealth() {
    K.request('health').then(function (r) {
      var html = '<table><tr><th>Проверка</th><th>Значение</th><th>Статус</th><th>Что делать</th></tr>';
      r.checks.forEach(function (c) {
        html += '<tr><td><b>' + esc(c.name) + '</b></td><td class="small code">' + esc(c.value) + '</td>'
          + '<td>' + (c.ok ? '<span class="badge g">ок</span>' : '<span class="badge r">проблема</span>') + '</td>'
          + '<td class="small muted">' + esc(c.hint || '') + '</td></tr>';
      });
      html += '</table>';
      $('healthTable').innerHTML = html;
    }).catch(function (e) { $('healthTable').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
  }

  /* --- тест на бумаге ----------------------------------------------------- */
  function makePaper() {
    errBox('paperErr', '');
    var lesson = $('pLesson').value;
    var count = parseInt($('pCount').value, 10) || 15;
    post('paper', { lesson: lesson, count: count }).then(function (r) {
      var html = '<div class="paperhead"><h2 style="margin:0">' + esc(r.title) + ' — вариант для печати</h2>'
        + '<p class="small">Фамилия, имя: <span class="fill"></span> Класс: <span class="fill short"></span> '
        + 'Вариант: <b>' + r.variant_no + '</b> · вопросов: ' + r.items.length
        + ' · порог зачёта: ' + r.threshold + '%</p></div>';
      r.items.forEach(function (item) {
        html += '<div class="pq"><div class="pqt">' + item.n + '. <span class="ptag">' + esc(item.t) + '</span><br>'
          + esc(item.q) + '</div>';
        item.o.forEach(function (o, i) {
          html += '<div class="po"><span class="pbox"></span> ' + String.fromCharCode(1040 + i) + ') ' + esc(o) + '</div>';
        });
        html += '</div>';
      });
      html += '<div class="papernote small">Оценка: «5» — 90% и выше, «4» — 75%, «3» — от ' + r.threshold + '%.</div>';
      $('paperBox').innerHTML = html;
    }).catch(function (e) { errBox('paperErr', e.message); });
  }

  /* --- привязка кнопок ---------------------------------------------------- */
  function bind() {
    $('btnApply').addEventListener('click', loadJournal);
    $('fQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') { loadJournal(); } });
    $('btnCsv').addEventListener('click', function () { window.location.href = exportUrl('csv'); });
    $('btnJson').addEventListener('click', function () { window.location.href = exportUrl('json'); });
    $('btnCodes').addEventListener('click', function () { window.location.href = exportUrl('codes'); });
    $('btnPrintJournal').addEventListener('click', function () { window.print(); });

    $('btnImport').addEventListener('click', function () { errBox('impResult', ''); open('mImport'); });
    $('impGo').addEventListener('click', function () {
      post('import_codes', { text: $('impText').value, lesson: $('impLesson').value }).then(function (r) {
        var html = '<div class="note g small">Внесено: <b>' + r.added + '</b> · дубликатов отброшено: '
          + r.duplicates + ' · распознано строк: ' + r.parsed + '</div>';
        if (r.invalid && r.invalid.length) {
          html += '<div class="note r small"><b>Не удалось разобрать:</b><ul style="margin:6px 0 0 18px">';
          r.invalid.forEach(function (b) {
            html += '<li><span class="code">' + esc(b.code) + '</span> — ' + esc(b.reason) + '</li>';
          });
          html += '</ul></div>';
        }
        $('impResult').innerHTML = html;
        loadJournal();
      }).catch(function (e) { $('impResult').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
    });

    $('btnManual').addEventListener('click', function () { errBox('mnErr', ''); open('mManual'); });
    $('mnGo').addEventListener('click', function () {
      post('manual_result', {
        name: $('mnName').value.trim(),
        group: $('mnGroup').value.trim(),
        lesson: $('mnLesson').value,
        right: parseInt($('mnRight').value, 10),
        total: parseInt($('mnTotal').value, 10),
        sec: (parseInt($('mnSec').value, 10) || 0) * 60
      }).then(function (r) {
        close('mManual');
        toast('Сохранено: ' + r.right + ' → оценка ' + r.grade);
        loadJournal();
      }).catch(function (e) { errBox('mnErr', e.message); });
    });

    $('btnClear').addEventListener('click', function () {
      var lesson = $('fLesson').value;
      var what = lesson ? 'по уроку ' + lesson.toUpperCase() : 'ВСЕ результаты';
      if (!confirm('Удалить ' + what + ' из журнала? Действие необратимо.')) { return; }
      post('clear_results', { lesson: lesson }).then(function () { toast('Очищено'); loadJournal(); })
        .catch(function (e) { toast(e.message, true); });
    });

    $('btnTopics').addEventListener('click', loadStats);

    $('btnNewUser').addEventListener('click', function () {
      errBox('uErr', '');
      $('uName').value = ''; $('uLogin').value = ''; $('uPass').value = randomPass();
      open('mUser');
    });
    $('uGo').addEventListener('click', function () {
      post('create_user', {
        name: $('uName').value.trim(),
        login: $('uLogin').value.trim().toLowerCase(),
        password: $('uPass').value,
        role: $('uRole').value,
        class_id: parseInt($('uClass').value, 10) || 0
      }).then(function () { close('mUser'); toast('Аккаунт создан'); loadPeople(); })
        .catch(function (e) { errBox('uErr', e.message); });
    });

    $('btnNewClass').addEventListener('click', function () {
      var name = prompt('Название класса (например, 10Б):');
      if (!name) { return; }
      post('create_class', { name: name.trim() }).then(function () { toast('Класс добавлен'); loadPeople(); })
        .catch(function (e) { toast(e.message, true); });
    });

    $('rsGen').addEventListener('click', function () { $('rsPass').value = randomPass(); });
    $('rsGo').addEventListener('click', function () {
      post('reset_password', { user_id: window.__resetId, password: $('rsPass').value }).then(function () {
        close('mReset');
        toast('Пароль сброшен: ' + $('rsPass').value);
        loadPeople();
      }).catch(function (e) { errBox('rsErr', e.message); });
    });

    $('btnMyPass').addEventListener('click', function () {
      errBox('myPassErr', '');
      K.request('change_password', null, { old_password: $('myOld').value, new_password: $('myNew').value })
        .then(function () { toast('Пароль изменён'); $('myOld').value = ''; $('myNew').value = ''; })
        .catch(function (e) { errBox('myPassErr', e.message); });
    });

    $('btnSaveSettings').addEventListener('click', saveSettings);
    $('btnOpenFinal').addEventListener('click', function () {
      var on = D.boot.open_final ? 0 : 1;
      post('set_settings', { open_final: on }).then(function () {
        toast(on ? 'Финальный проект открыт всем' : 'Финальный проект снова закрыт');
        return K.request('bootstrap');
      }).then(function (b) { D.boot = b; }).catch(function (e) { toast(e.message, true); });
    });

    $('fnGo').addEventListener('click', saveFinal);
    $('btnMakePaper').addEventListener('click', makePaper);
    $('btnPrintPaper').addEventListener('click', function () {
      document.querySelectorAll('.pane').forEach(function (p) { p.classList.add('hidden'); });
      $('p-paper').classList.remove('hidden');
      document.body.classList.add('printing-paper');
      window.print();
      setTimeout(function () { document.body.classList.remove('printing-paper'); }, 400);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { close(b.dataset.close); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) { m.classList.remove('open'); } });
    });
  }

  function fillLessonSelects() {
    var opts = D.lessons.map(function (L) {
      return '<option value="' + L.id + '">' + esc(L.title) + '</option>';
    }).join('');
    $('fLesson').insertAdjacentHTML('beforeend', opts);
    $('impLesson').insertAdjacentHTML('beforeend', opts);
    $('mnLesson').innerHTML = opts;
    $('pLesson').innerHTML = opts;
    $('tLesson').insertAdjacentHTML('beforeend', opts);
  }

  document.addEventListener('DOMContentLoaded', function () {
    tabs();
    bind();
    K.requireUser().then(function (boot) {
      if (boot.user.role !== 'teacher') { window.location.href = K.base + '/index.php'; return; }
      D.boot = boot;
      return K.request('lessons');
    }).then(function (l) {
      D.lessons = (l.lessons || []).filter(function (x) { return x.count; });
      fillLessonSelects();
      return K.request('stats');
    }).then(function (s) {
      fillClassFilter(s.classes || []);
      loadJournal();
    }).catch(function (e) { toast(e.message, true); });
  });
})();
