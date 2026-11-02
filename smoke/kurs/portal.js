/* portal.js — оболочка курса: список уроков, просмотр в iframe, синхронизация
   прогресса с сервером, смена пароля.

   Прогресс читается из localStorage файла урока (тот же источник, поэтому доступ есть)
   и сохраняется на сервере. При входе с другого компьютера серверное состояние
   возвращается обратно в файл — для этого в сборки курса встроен небольшой мост
   (см. build_portal.py, блок KURS BRIDGE). */
(function () {
  'use strict';

  var K = window.K;
  var $ = K.$, esc = K.esc, toast = K.toast;

  var state = {
    boot: null,
    lessons: [],
    progress: {},
    attempts: [],
    user: null,
    current: null,
    lastSent: 0,
    dirty: false
  };

  /* --- те же формулы, что в _study_mode.js (см. lib/portal.php) ----------- */
  function mix(str) {
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + c * (i + 7)) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
  }
  function skey(lesson) {
    if (!lesson.keyword || !lesson.slides) { return null; }
    return 'k' + state.user.id + '|x' + mix(lesson.keyword + '|' + lesson.slides);
  }

  function setSync(text, bad) {
    var el = $('syncState');
    if (!el) { return; }
    el.innerHTML = text;
    el.style.color = bad ? '#fda4af' : '';
  }

  /* --- загрузка ---------------------------------------------------------- */
  function load() {
    return K.requireUser().then(function (boot) {
      state.boot = boot;
      state.user = boot.user;
      return K.request('session');
    }).then(function (s) {
      state.progress = s.progress || {};
      state.attempts = s.attempts || [];
      return K.request('lessons');
    }).then(function (l) {
      state.lessons = l.lessons || [];
      render();
      maybeForcePassword();
      var hash = (location.hash || '').replace(/^#/, '');
      var wanted = null;
      for (var i = 0; i < state.lessons.length; i++) {
        if (state.lessons[i].id === hash) { wanted = state.lessons[i]; break; }
      }
      open(wanted || firstOpenLesson() || state.lessons[0]);
    }).catch(function (e) {
      $('lessons').innerHTML = '<div class="err">' + esc(e.message) + '</div>';
    });
  }

  function firstOpenLesson() {
    for (var i = 0; i < state.lessons.length; i++) {
      if (state.lessons[i].open && state.lessons[i].id !== 'prepod') { return state.lessons[i]; }
    }
    return null;
  }

  /* --- список слева ------------------------------------------------------ */
  function render() {
    var box = $('lessons');
    box.innerHTML = '';
    state.lessons.forEach(function (L) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'litem' + (L.open ? '' : ' locked');
      b.dataset.id = L.id;

      var marks = [];
      var p = state.progress[L.id];
      if (p && L.slides) {
        var pctDone = Math.round((p.unlocked + 1) / L.slides * 100);
        marks.push('<span class="badge b">слайд ' + (p.unlocked + 1) + ' из ' + L.slides + '</span>');
        if (pctDone >= 100) { marks.push('<span class="badge g">прочитано</span>'); }
      }
      var best = bestFor(L.id);
      if (best) {
        var cls = best.grade >= 4 ? 'g' : (best.pct >= L.threshold ? 'a' : 'r');
        marks.push('<span class="badge ' + cls + '">тест ' + best.right + '/' + best.total + ' · оценка ' + best.grade + '</span>');
      } else if (L.count) {
        marks.push('<span class="badge">тест не сдан</span>');
      }
      if (!L.open) { marks.push('<span class="badge r">закрыт</span>'); }

      b.innerHTML = '<span class="t">' + esc(L.title) + '</span>'
        + '<span class="s">' + esc(L.subtitle || '') + '</span>'
        + '<span class="m">' + marks.join('') + '</span>';
      b.addEventListener('click', function () {
        if (!L.open) {
          toast('Сначала сдайте тест предыдущего урока (порог ' + L.threshold + '%)', true);
          return;
        }
        open(L);
      });
      box.appendChild(b);
    });
  }

  function bestFor(lesson) {
    var best = null;
    state.attempts.forEach(function (a) {
      if (a.lesson !== lesson) { return; }
      if (!best || a.pct > best.pct) { best = a; }
    });
    return best;
  }

  function markCurrent() {
    var items = document.querySelectorAll('.litem');
    Array.prototype.forEach.call(items, function (el) {
      el.classList.toggle('on', !!state.current && el.dataset.id === state.current.id);
    });
  }

  /* --- открытие урока ---------------------------------------------------- */
  function open(L) {
    if (!L) { return; }
    flush();
    state.current = L;
    markCurrent();
    $('stageName').textContent = L.title;
    var frame = $('frame');
    if (L.id === 'prepod') {
      frame.src = K.base + '/' + L.url;
      $('stageEmpty').classList.add('hidden');
      return;
    }
    var url = K.base + '/' + L.url + '&uid=' + state.user.id;
    var local = readLocal(skey(L));
    var server = state.progress[L.id] || null;
    var restore = null;
    if (server && (!local || (server.updated_ts || 0) > (local.updated || 0))) {
      restore = { u: server.unlocked | 0, p: server.position | 0, v: {} };
      Object.keys(server.visited || {}).map(Number).sort(function (a, b) { return a - b; })
        .forEach(function (n) { restore.v[n] = 1; });
    }
    if (restore && (restore.u > 0 || Object.keys(restore.v).length)) {
      url += '#krestore=' + encodeURIComponent(JSON.stringify({ uid: state.user.id, state: restore }));
      setSync('⟳ восстанавливаем прогресс с сервера…');
    } else {
      setSync('');
    }
    frame.src = url;
    $('stageEmpty').classList.add('hidden');
    setSync(restore ? '⟳ восстанавливаем прогресс с сервера…' : '');
  }

  function readLocal(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) { return null; }
      var st = JSON.parse(raw);
      if (!st || typeof st.u !== 'number') { return null; }
      st.v = st.v || {};
      return { u: st.u | 0, p: st.p | 0, v: st.v, updated: st.updated | 0 };
    } catch (e) { return null; }
  }

  /* --- приём сообщений из файла урока ------------------------------------ */
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin) { return; }
    var d = e.data;
    if (!d || typeof d !== 'object') { return; }
    if (!state.current) { return; }
    if (d.t === 'kurs-progress' && d.uid === state.user.id) {
      var L = state.current;
      if (L.id !== d.lesson) { return; }
      state.progress[d.lesson] = {
        unlocked: d.unlocked | 0,
        position: d.position | 0,
        visited: d.visited || {},
        tasks_done: d.tasks_done | 0,
        tasks_all: d.tasks_all | 0,
        updated_ts: d.updated | 0
      };
      state.dirty = true;
      scheduleSync();
      refreshMarks();
    }
  });

  function refreshMarks() {
    if (!state.current) { return; }
    var item = document.querySelector('.litem[data-id="' + state.current.id + '"]');
    if (item) {
      var p = state.progress[state.current.id];
      var badges = item.querySelectorAll('.badge');
      if (p && state.current.slides && badges.length) {
        badges[0].textContent = 'слайд ' + (p.unlocked + 1) + ' из ' + state.current.slides;
      }
    }
  }

  /* --- отправка прогресса на сервер -------------------------------------- */
  var timer = null;
  function scheduleSync() {
    if (timer) { return; }
    timer = setTimeout(function () { timer = null; flush(); }, 4000);
  }

  function flush() {
    if (!state.dirty || !state.current || !state.user) { return; }
    var L = state.current;
    var p = state.progress[L.id];
    if (!p) { return; }
    var keys = [];
    try {
      var local = readLocal(skey(L));
      if (local) { keys = Object.keys(local.v); }
    } catch (e) { keys = []; }
    if (!keys.length) { keys = Object.keys(p.visited || {}); }
    var visitedMap = {};
    keys.forEach(function (k) { visitedMap[k] = 1; });
    var body = {
      lesson: L.id,
      unlocked: p.unlocked | 0,
      position: p.position | 0,
      visited: visitedMap,
      tasks_done: p.tasks_done | 0,
      tasks_all: p.tasks_all | 0
    };
    state.dirty = false;
    var payload = JSON.stringify(Object.assign({ a: 'progress', csrf: K.csrf() }, body));
    if (navigator.sendBeacon && document.hidden) {
      navigator.sendBeacon(K.api, new Blob([payload], { type: 'application/json' }));
      return;
    }
    K.request('progress', null, body).then(function () {
      setSync('✓ прогресс сохранён на сервере · ' + timeNow());
    }).catch(function (e) {
      state.dirty = true;
      setSync('⚠ не удалось сохранить прогресс: ' + e.message, true);
    });
    state.lastSent = Date.now();
  }

  function timeNow() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { flush(); }
  });
  window.addEventListener('pagehide', function () { flush(); });

  /* --- кнопки ------------------------------------------------------------ */
  function bind() {
    $('btnReload').addEventListener('click', function () { if (state.current) { open(state.current); } });
    $('btnNewTab').addEventListener('click', function () {
      if (state.current) { window.open(K.base + '/' + state.current.url, '_blank'); }
    });
    $('btnPrint').addEventListener('click', function () {
      var f = $('frame');
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch (e) { toast('Печать доступна в отдельной вкладке', true); }
    });
    $('btnOffline').addEventListener('click', function () {
      window.open(K.base + '/course.php?f=kursy%2Ftest-urok-1.html', '_blank');
    });
    $('btnFinalInfo').addEventListener('click', function () {
      var L = null;
      state.lessons.forEach(function (x) { if (x.id === 'final') { L = x; } });
      if (!L) { return; }
      if (!L.open) { toast('Финальный проект открывает преподаватель', true); return; }
      open(L);
    });

    /* смена пароля */
    var m = $('mPass');
    $('btnPass').addEventListener('click', function () { m.classList.add('open'); $('pOld').focus(); });
    $('pCancel').addEventListener('click', function () { m.classList.remove('open'); });
    m.addEventListener('click', function (e) { if (e.target === m) { m.classList.remove('open'); } });
    $('pSave').addEventListener('click', function () {
      var err = $('pErr');
      err.classList.add('hidden');
      if ($('pNew').value !== $('pNew2').value) {
        err.textContent = 'Пароли не совпадают'; err.classList.remove('hidden'); return;
      }
      $('pSave').disabled = true;
      K.request('change_password', null, { old_password: $('pOld').value, new_password: $('pNew').value })
        .then(function () {
          m.classList.remove('open');
          $('pOld').value = $('pNew').value = $('pNew2').value = '';
          $('pSave').disabled = false;
          toast('Пароль изменён');
        })
        .catch(function (e) {
          err.textContent = e.message; err.classList.remove('hidden');
          $('pSave').disabled = false;
        });
    });
  }

  /* преподаватель создал аккаунт с временным паролем — просим сменить */
  function maybeForcePassword() {
    if (!state.user || state.user.must_change !== 1) { return; }
    var m = $('mPass');
    m.classList.add('open');
    $('pCancel').style.display = 'none';
    toast('Смените временный пароль, который дал преподаватель');
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    load();
    setInterval(function () { if (state.dirty) { flush(); } }, 15000);
  });
})();
