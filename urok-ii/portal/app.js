/* app.js — общий клиентский слой портала.
   Здесь нет ни паролей, ни хэшей: проверка пароля делается только на сервере. */
(function () {
  'use strict';

  var BASE = window.KURS_BASE || '';
  var API = BASE + '/api/index.php';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, bad) {
    var t = $('toast');
    if (!t) { return; }
    t.textContent = msg;
    t.className = 'toast on' + (bad ? ' bad' : '');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  /* --- работа с API ------------------------------------------------------ */
  var CSRF = '';
  var ME = null;

  function qs(obj) {
    var p = [];
    for (var k in obj) {
      if (obj[k] === undefined || obj[k] === null || obj[k] === '') { continue; }
      p.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    }
    return p.length ? '?' + p.join('&') : '';
  }

  function request(action, params, body, method) {
    var url = API + qs(Object.assign({ a: action }, params || {}));
    var opt = {
      method: body ? 'POST' : (method || 'GET'),
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    };
    if (body) {
      opt.method = 'POST';
      opt.headers['Content-Type'] = 'application/json; charset=utf-8';
      if (CSRF) { opt.headers['X-CSRF-Token'] = CSRF; }
      opt.body = JSON.stringify(body);
    }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Сервер вернул не JSON (код ' + r.status + ')' }; })
        .then(function (j) {
          if (j && j.csrf) { CSRF = j.csrf; }
          if (!r.ok || !j || j.ok === false) {
            var e = new Error((j && j.error) || ('Ошибка ' + r.status));
            e.status = r.status;
            e.data = j || {};
            throw e;
          }
          return j;
        });
    });
  }

  function bootstrap() {
    return request('bootstrap').then(function (j) {
      CSRF = j.csrf || '';
      ME = j.user || null;
      return j;
    });
  }

  function goLogin() { window.location.href = BASE + '/login.php'; }

  function requireUser() {
    return bootstrap().then(function (j) {
      if (!j.user) { goLogin(); throw new Error('Нужно войти'); }
      return j;
    });
  }

  /* --- выход и смена пользователя ---------------------------------------- */
  function logout(silent) {
    return request('logout', null, {}).then(function () {
      try {
        /* чистим локальный прогресс, чтобы за этот компьютер мог сесть другой ученик */
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf('k') === 0 && k.indexOf('|') > 0) { localStorage.removeItem(k); }
        });
      } catch (e) { /* приватный режим — не страшно */ }
      if (!silent) { goLogin(); }
    }).catch(function () { if (!silent) { goLogin(); } });
  }

  function bindLogout() {
    var b = $('btnLogout');
    if (b) {
      b.addEventListener('click', function () {
        if (b.dataset.armed) { logout(); return; }
        b.dataset.armed = '1';
        b.textContent = 'Точно выйти?';
        setTimeout(function () { delete b.dataset.armed; b.textContent = 'Выйти'; }, 2500);
      });
    }
  }

  /* --- страница входа ---------------------------------------------------- */
  function initLogin() {
    var tabs = document.querySelectorAll('#tabs .tab');
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        var reg = t.dataset.t === 'reg';
        if ($('fIn')) { $('fIn').classList.toggle('hidden', reg); }
        if ($('fReg')) { $('fReg').classList.toggle('hidden', !reg); }
      });
    });

    function showErr(id, msg) {
      var e = $(id);
      if (!e) { return; }
      e.textContent = msg || '';
      e.classList.toggle('hidden', !msg);
    }

    var fIn = $('fIn');
    if (fIn) {
      fIn.addEventListener('submit', function (ev) {
        ev.preventDefault();
        showErr('inErr', '');
        var btn = $('inBtn');
        btn.disabled = true; btn.textContent = 'Проверяем…';
        bootstrap().then(function () {
          return request('login', null, {
            login: $('inLogin').value.trim(),
            password: $('inPass').value
          });
        }).then(function () {
          window.location.href = BASE + '/index.php';
        }).catch(function (e) {
          showErr('inErr', e.message);
          btn.disabled = false; btn.textContent = 'Войти';
          $('inPass').value = '';
          $('inPass').focus();
        });
      });
    }

    var fReg = $('fReg');
    if (fReg) {
      fReg.addEventListener('submit', function (ev) {
        ev.preventDefault();
        showErr('rgErr', '');
        var p1 = $('rgPass').value, p2 = $('rgPass2').value;
        if (p1 !== p2) { showErr('rgErr', 'Пароли не совпадают'); return; }
        var btn = $('rgBtn');
        btn.disabled = true; btn.textContent = 'Создаём аккаунт…';
        bootstrap().then(function () {
          return request('register', null, {
            name: $('rgName').value.trim(),
            login: $('rgLogin').value.trim().toLowerCase(),
            password: p1,
            class_name: $('rgClass').value.trim()
          });
        }).then(function () {
          window.location.href = BASE + '/index.php';
        }).catch(function (e) {
          showErr('rgErr', e.message);
          btn.disabled = false; btn.textContent = 'Зарегистрироваться и войти';
        });
      });
    }
  }

  /* --- общий экспорт ------------------------------------------------------ */
  window.K = {
    base: BASE, api: API, $: $, esc: esc, toast: toast, qs: qs,
    request: request, bootstrap: bootstrap, requireUser: requireUser,
    logout: logout, bindLogout: bindLogout, initLogin: initLogin,
    me: function () { return ME; }, csrf: function () { return CSRF; }
  };

  document.addEventListener('DOMContentLoaded', function () {
    bindLogout();
    if (window.KURS_PAGE === 'login') { initLogin(); }
  });
})();
