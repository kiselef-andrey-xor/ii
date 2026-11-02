/* test.js — промежуточный тест после урока.
   Работает в двух режимах: серверном (ученик вошёл — вариант и проверка на сервере)
   и тренировочном (без входа — вариант собирается в браузере, результат выдаётся кодом).
   Формат кода и формула контрольной суммы — те же, что в автономном test-urok-1.html. */
(function () {
  'use strict';

  var K = window.K;
  var $ = K.$, esc = K.esc, toast = K.toast;

  var LESSON = window.KURS_LESSON || 'u1';
  var PREFIX = window.KURS_PREFIX || 'U1';
  var TOPICS = window.KURS_TOPICS || [];
  var COLORS = window.KURS_COLORS || {};
  var THRESHOLD = window.KURS_THRESHOLD || 60;
  var DEF_COUNT = window.KURS_DEFAULT_COUNT || 15;
  var LOGGED_IN = !!window.KURS_LOGGED_IN;
  var BANK_URL = window.KURS_BANK_URL || '';

  var BANK = [];          /* [{i,t,q,o,e,a?}] — a только в тренировочном режиме */
  var T = null;           /* текущая попытка */
  var onlyBad = true;

  /* --- утилиты, повторяющие автономный тест ------------------------------- */
  function shuffle(a) {
    var r = a.slice();
    for (var i = r.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = r[i]; r[i] = r[j]; r[j] = t;
    }
    return r;
  }
  function b36(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) { out += s.charCodeAt(i).toString(36); }
    return out;
  }
  function crc(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; }
    return (h % 1296).toString(36).padStart(2, '0');
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function normName(s) {
    return String(s || '').toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim();
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ' мин ' + pad2(sec % 60) + ' с';
  }
  function topicMask(perTopic) {
    return TOPICS.map(function (t) {
      var s = perTopic && perTopic[t];
      if (!s || !s.all) { return 'z'; }
      return (Math.min(5, s.ok) * 6 + Math.min(5, s.all)).toString(36);
    }).join('');
  }
  function weakList(perTopic) {
    if (!perTopic) { return []; }
    return TOPICS.filter(function (t) { return perTopic[t] && perTopic[t].ok < perTopic[t].all; });
  }
  function makeCode(rec) {
    var d = new Date(rec.ts);
    var stamp = String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate())
      + pad2(d.getHours()) + pad2(d.getMinutes());
    var body = [PREFIX, normName(rec.name).slice(0, 40), normName(rec.group).slice(0, 16), stamp,
      String(rec.variant), String(rec.right), String(rec.total), String(rec.sec),
      topicMask(rec.perTopic), String(rec.nonce || '0000')].join('|');
    return body + '|' + crc(b36(body));
  }
  function gradeOf(pct) {
    return pct >= 90 ? 5 : pct >= 75 ? 4 : pct >= THRESHOLD ? 3 : 2;
  }

  /* --- старт -------------------------------------------------------------- */
  function show(id) {
    ['scr-start', 'scr-test', 'scr-res'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function fillCounts(max) {
    var sel = $('regN');
    sel.innerHTML = '';
    var opts = [5, 8, 10, 12, 15, 20, 25, max];
    var seen = {};
    opts.forEach(function (n) {
      if (n > max || seen[n]) { return; }
      seen[n] = 1;
      var o = document.createElement('option');
      o.value = n;
      o.textContent = n + (n === max ? ' (все вопросы банка)' : '');
      if (n === DEF_COUNT) { o.selected = true; }
      sel.appendChild(o);
    });
    if (LOGGED_IN) {
      sel.disabled = true;
      var note = document.createElement('option');
      sel.innerHTML = '';
      note.value = DEF_COUNT;
      note.textContent = DEF_COUNT + ' (задаёт преподаватель в кабинете)';
      note.selected = true;
      sel.appendChild(note);
    }
    $('regCount').textContent = DEF_COUNT;
  }

  function loadBank() {
    if (LOGGED_IN) {
      /* в серверном режиме банк не нужен: вопросы придут с сервера без ответов */
      BANK = [];
      fillCounts(DEF_COUNT);
      return Promise.resolve();
    }
    return fetch(K.base + '/' + BANK_URL, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) { throw new Error('Не удалось загрузить банк вопросов (код ' + r.status + ')'); }
        return r.json();
      })
      .then(function (j) {
        BANK = j.questions || [];
        if (j.topics && j.topics.length) { TOPICS = j.topics; }
        if (j.colors) { COLORS = j.colors; }
        if (j.threshold) { THRESHOLD = j.threshold; $('regPass').textContent = THRESHOLD + '%'; }
        fillCounts(BANK.length);
        $('regBank').textContent = BANK.length;
      });
  }

  function startErr(msg) {
    var e = $('startErr');
    e.textContent = msg || '';
    e.classList.toggle('hidden', !msg);
  }

  function start() {
    startErr('');
    var name = $('regName').value.trim();
    var group = $('regGroup').value.trim();
    if (name.length < 3) { startErr('Введите фамилию и имя'); return; }
    if (!LOGGED_IN && group.length < 1) { startErr('Введите класс'); return; }
    $('btnStart').disabled = true;
    $('btnStart').textContent = 'Готовим вариант…';

    if (LOGGED_IN) {
      K.request('test', { u: LESSON }).then(function (v) {
        T = {
          mode: 'server',
          name: name, group: group,
          variant: v.variant_no,
          questions: v.questions,
          answers: {},
          started: Date.now(),
          submitted: false,
          count: v.count
        };
        renderTest();
        show('scr-test');
      }).catch(function (e) {
        startErr(e.message);
      }).then(function () {
        $('btnStart').disabled = false;
        $('btnStart').textContent = 'Начать тест';
      });
      return;
    }

    var count = Math.min(parseInt($('regN').value, 10) || DEF_COUNT, BANK.length);
    var v = buildLocalVariant(count);
    T = {
      mode: 'local',
      name: name, group: group,
      variant: Math.floor(Math.random() * 90000) + 10000,
      nonce: Math.random().toString(36).slice(2, 6),
      questions: v.questions,
      answers: {},
      started: Date.now(),
      submitted: false,
      count: v.questions.length
    };
    $('btnStart').disabled = false;
    $('btnStart').textContent = 'Начать тест';
    renderTest();
    show('scr-test');
  }

  function buildLocalVariant(count) {
    var byTopic = {};
    BANK.forEach(function (q) { (byTopic[q.t] = byTopic[q.t] || []).push(q); });
    var picked = [];
    TOPICS.forEach(function (t) {
      if (picked.length >= count) { return; }
      var pool = shuffle(byTopic[t] || []);
      if (pool.length) { picked.push(pool[0]); }
    });
    var pickedIds = {};
    picked.forEach(function (q) { pickedIds[q.i] = 1; });
    var rest = shuffle(BANK.filter(function (q) { return !pickedIds[q.i]; }));
    while (picked.length < count && rest.length) { picked.push(rest.shift()); }
    picked = shuffle(picked).slice(0, count);
    return {
      questions: picked.map(function (q, pos) {
        var order = shuffle(q.o.map(function (_, k) { return k; }));
        return {
          n: pos, id: q.i, t: q.t, q: q.q, e: q.e, a: q.a,
          o: order.map(function (k) { return { k: k, text: q.o[k] }; })
        };
      })
    };
  }

  /* --- отрисовка вопросов ------------------------------------------------- */
  function renderTest() {
    $('tWho').textContent = T.name + (T.group ? ' · ' + T.group : '');
    $('tVar').textContent = 'вариант ' + T.variant;
    var list = $('tList');
    list.innerHTML = '';
    T.questions.forEach(function (item, n) {
      var box = document.createElement('div');
      box.className = 'q';
      box.id = 'q' + n;
      box.innerHTML = '<div class="row" style="margin-bottom:8px"><span class="tag '
        + (COLORS[item.t] || '') + '">' + esc(item.t) + '</span></div>'
        + '<p class="qt"><span class="qn">' + (n + 1) + '.</span>' + esc(item.q) + '</p>';
      item.o.forEach(function (opt) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'opt';
        b.dataset.q = n;
        b.dataset.k = opt.k;
        b.innerHTML = '<b class="ltr">' + esc(String(opt.text.charAt(0)).toUpperCase()) + '</b>' + esc(opt.text);
        b.addEventListener('click', function () { pick(n, opt.k); });
        box.appendChild(b);
      });
      var exp = document.createElement('div');
      exp.className = 'exp hidden';
      exp.id = 'e' + n;
      box.appendChild(exp);
      list.appendChild(box);
    });
    updateProgress();
  }

  function pick(n, k) {
    if (!T || T.submitted) { return; }
    T.answers[n] = k;
    var box = $('q' + n);
    Array.prototype.forEach.call(box.querySelectorAll('.opt'), function (b) {
      b.classList.toggle('sel', parseInt(b.dataset.k, 10) === k);
    });
    updateProgress();
    var nxt = $('q' + (n + 1));
    if (nxt) {
      var r = nxt.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.8) { nxt.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
  }

  function updateProgress() {
    if (!T) { return; }
    var done = Object.keys(T.answers).length;
    var all = T.questions.length;
    $('tCount').textContent = 'отвечено ' + done + ' из ' + all;
    $('tBar').style.width = Math.round(done / all * 100) + '%';
    $('tLeft').textContent = done < all ? ('осталось ответить: ' + (all - done)) : 'всё отвечено — можно сдавать';
    $('btnSubmit').disabled = done < all;
    $('submitHint').textContent = done < all ? 'Ответьте на все вопросы — кнопка разблокируется' : '';
  }

  /* --- проверка ----------------------------------------------------------- */
  function submit() {
    if (!T || T.submitted) { return; }
    if (Object.keys(T.answers).length < T.questions.length) { toast('Ответьте на все вопросы', true); return; }
    T.submitted = true;
    var sec = Math.round((Date.now() - T.started) / 1000);
    $('btnSubmit').disabled = true;
    $('btnSubmit').textContent = 'Проверяем…';

    if (T.mode === 'server') {
      var answers = T.questions.map(function (item) {
        return { id: item.id, a: T.answers[item.n] };
      });
      K.request('test', { u: LESSON }, { u: LESSON, answers: answers, sec: sec })
        .then(function (r) {
          paintServerResult(r, sec);
        })
        .catch(function (e) {
          T.submitted = false;
          $('btnSubmit').disabled = false;
          $('btnSubmit').textContent = 'Проверить ответы';
          toast(e.message, true);
        });
      return;
    }

    var res = gradeLocal(sec);
    paintLocalResult(res, sec);
  }

  function gradeLocal(sec) {
    var right = 0;
    var perTopic = {};
    var detail = [];
    T.questions.forEach(function (item) {
      var given = T.answers[item.n];
      var ok = given === item.a;
      if (ok) { right++; }
      perTopic[item.t] = perTopic[item.t] || { ok: 0, all: 0 };
      perTopic[item.t].all++;
      if (ok) { perTopic[item.t].ok++; }
      detail.push({ n: item.n, t: item.t, q: item.q, right: item.a, given: given, ok: ok, e: item.e });
    });
    var total = T.questions.length;
    var pct = total ? Math.round(right * 100 / total) : 0;
    var ordered = {};
    TOPICS.forEach(function (t) { if (perTopic[t]) { ordered[t] = perTopic[t]; } });
    Object.keys(perTopic).forEach(function (t) { if (!ordered[t]) { ordered[t] = perTopic[t]; } });
    return {
      right: right, total: total, pct: pct, grade: gradeOf(pct), threshold: THRESHOLD,
      passed: pct >= THRESHOLD, sec: sec, per_topic: ordered, weak: weakList(ordered), detail: detail,
      code: makeCode({
        name: T.name, group: T.group, variant: T.variant, nonce: T.nonce,
        right: right, total: total, sec: sec, ts: Date.now(), perTopic: ordered
      })
    };
  }

  function paintServerResult(r, sec) {
    var detail = (r.detail || []).map(function (d) {
      var item = T.questions[d.n] || {};
      return {
        n: d.n, t: d.t, q: d.q || item.q, right: d.right, given: d.given, ok: d.ok,
        e: d.e || item.e, opts: item.o || []
      };
    });
    finish({
      right: r.right, total: r.total, pct: r.pct, grade: r.grade, threshold: r.threshold,
      passed: r.passed, sec: r.sec || sec, per_topic: r.per_topic, weak: r.weak,
      detail: detail, code: r.code, server: true
    });
  }

  function paintLocalResult(r, sec) {
    var detail = r.detail.map(function (d) {
      var item = T.questions[d.n] || {};
      return Object.assign({}, d, { opts: item.o || [] });
    });
    finish(Object.assign({}, r, { detail: detail, server: false }));
  }

  function finish(res) {
    window.__lastDetail = res.detail;
    /* подсветка в списке вопросов */
    res.detail.forEach(function (d) {
      var box = $('q' + d.n);
      if (!box) { return; }
      Array.prototype.forEach.call(box.querySelectorAll('.opt'), function (b) {
        var k = parseInt(b.dataset.k, 10);
        b.disabled = true;
        b.style.cursor = 'default';
        if (k === d.right) { b.classList.add('right'); }
        else if (k === d.given) { b.classList.add('wrong'); }
        b.classList.remove('sel');
      });
      var exp = $('e' + d.n);
      if (exp) {
        exp.classList.remove('hidden');
        exp.innerHTML = (d.ok ? '<b class="ok">✓ Верно.</b> ' : '<b class="no">✗ Неверно.</b> ') + esc(d.e);
      }
    });

    $('rScore').textContent = res.right + ' / ' + res.total;
    var g = $('rGrade');
    g.textContent = res.grade;
    g.className = 'grade ' + (res.grade >= 4 ? 'g' : (res.grade === 3 ? 'a' : 'r'));
    $('rVerdict').innerHTML = res.passed
      ? '<b class="ok">Зачёт.</b> ' + res.pct + '% верных ответов.'
      : '<b class="no">Порог не пройден</b> (' + res.pct + '% при норме ' + res.threshold + '%). Прочитайте объяснения и пройдите ещё раз.';
    $('rMeta').textContent = 'вариант ' + T.variant + ' · время ' + fmtDur(res.sec)
      + (res.server ? ' · результат отправлен преподавателю' : ' · передайте код преподавателю');

    $('rCode').textContent = res.code || '';
    $('copyHint').textContent = res.server
      ? 'Код сохранён в журнале автоматически — он нужен только если преподаватель собирает результаты вручную.'
      : 'Тренировочный режим: результат не попал в журнал сам. Скопируйте код и передайте преподавателю.';

    renderTopics(res.per_topic);
    renderDetail(res.detail);
    $('btnBack').href = K.base + '/index.php#' + LESSON;
    show('scr-res');
  }

  function renderTopics(per) {
    var box = $('rTopics');
    var rows = '';
    TOPICS.forEach(function (t) {
      var v = per && per[t];
      if (!v || !v.all) { return; }
      var pct = Math.round(v.ok * 100 / v.all);
      var cls = v.ok === v.all ? 'ok' : (pct >= 60 ? 'wr' : 'no');
      rows += '<tr><td><span class="tag ' + (COLORS[t] || '') + '">' + esc(t) + '</span></td>'
        + '<td class="num ' + cls + '">' + v.ok + ' из ' + v.all + '</td>'
        + '<td style="width:40%"><div class="bar"><i style="width:' + pct + '%"></i></div></td></tr>';
    });
    box.innerHTML = '<table><tr><th>Тема</th><th class="num">Верно</th><th>Доля</th></tr>' + rows + '</table>';
  }

  function renderDetail(detail) {
    var box = $('rDetail');
    var html = '';
    detail.forEach(function (d) {
      if (onlyBad && d.ok) { return; }
      html += '<div class="q"><div class="row" style="margin-bottom:6px"><span class="tag '
        + (COLORS[d.t] || '') + '">' + esc(d.t) + '</span>'
        + (d.ok ? '<span class="badge g">верно</span>' : '<span class="badge r">ошибка</span>') + '</div>'
        + '<p class="qt">' + esc(d.q) + '</p>';
      (d.opts || []).forEach(function (o) {
        var cls = 'opt static';
        if (o.k === d.right) { cls += ' right'; }
        else if (o.k === d.given) { cls += ' wrong'; }
        html += '<div class="' + cls + '">' + esc(o.text) + '</div>';
      });
      html += '<div class="exp">' + (d.ok ? '<b class="ok">✓ Верно.</b> ' : '<b class="no">✗ Неверно.</b> ')
        + esc(d.e) + '</div></div>';
    });
    box.innerHTML = html || '<p class="muted">Ошибок нет — все ответы верны.</p>';
  }

  /* --- привязка кнопок ---------------------------------------------------- */
  function bind() {
    $('btnStart').addEventListener('click', start);
    $('btnSubmit').addEventListener('click', submit);
    $('btnRestart').addEventListener('click', function () { T = null; show('scr-start'); });
    $('btnAgain').addEventListener('click', function () { T = null; show('scr-start'); });
    $('btnCopy').addEventListener('click', function () {
      var text = $('rCode').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Код скопирован'); },
          function () { fallbackCopy(text); });
      } else { fallbackCopy(text); }
    });
    $('btnOnlyBad').addEventListener('click', function () {
      onlyBad = true;
      if (window.__lastDetail) { renderDetail(window.__lastDetail); }
    });
    $('btnAll').addEventListener('click', function () {
      onlyBad = false;
      if (window.__lastDetail) { renderDetail(window.__lastDetail); }
    });
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Код скопирован');
    } catch (e) {
      toast('Скопируйте код вручную', true);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    loadBank().catch(function (e) {
      startErr(e.message);
    });
  });
})();
