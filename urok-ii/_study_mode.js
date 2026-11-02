<script>
/* Режим обязательного прохождения (версия без ожидания).

   Правила:
   • слайды открываются строго по порядку, вперёд не перемотать;
   • теоретический слайд: один раз нажать «Далее» — таймеров и прокрутки нет;
     при возврате назад слайд уже помечен прочитанным и открывается сразу;
   • слайд с практикой: нужно отметить все пункты чек-листа;
   • тест: объяснения и переход дальше — только когда все ответы верны;
   • прогресс хранится в браузере (ключ неочевидный, значение с контрольной суммой).
*/
(function(){
  'use strict';
  var KEYWORD = "__KEYWORD__";
  var slides  = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var stageEl = document.getElementById('stage');
  var N = slides.length;

  var cur = 0, unlocked = 0, visited = {}, seen = {}, ready = false;
  var store = null;
  try { store = window.localStorage; } catch(e){ store = null; }

  /* ---------- хранилище ---------- */
  function mix(str){
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var i = 0; i < str.length; i++){
      h1 = (h1 ^ str.charCodeAt(i)) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + str.charCodeAt(i) * (i + 7)) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
  }
  var SKEY = 'x' + mix(KEYWORD + '|' + N);
  function blank(){ return { u: 0, v: {}, p: 0, c: '' }; }
  function sign(u, v, pos){ return mix(KEYWORD + ':' + u + ':' + JSON.stringify(v) + ':' + (pos | 0)); }
  function load(){
    if (!store) return blank();
    try {
      var raw = store.getItem(SKEY);
      if (!raw) return blank();
      var st = JSON.parse(raw);
      if (!st || typeof st.u !== 'number') return blank();
      st.v = st.v || {}; st.p = st.p | 0;
      if (st.c !== sign(st.u, st.v, st.p)) return blank();
      return st;
    } catch(e){ return blank(); }
  }
  function save(){
    if (!store) return;
    try {
      store.setItem(SKEY, JSON.stringify({ u: unlocked, v: visited, p: cur, c: sign(unlocked, visited, cur) }));
    } catch(e){}
  }

  /* ---------- состояние слайда ---------- */
  function hasTasks(s){ return s.querySelectorAll('[data-task] input[type=checkbox]').length > 0; }
  function tasksDone(s){
    var b = s.querySelectorAll('[data-task] input[type=checkbox]');
    if (!b.length) return true;
    for (var i = 0; i < b.length; i++) if (!b[i].checked) return false;
    return true;
  }
  function hasQuiz(s){ return s.querySelectorAll('.q').length > 0; }
  function quizState(s){
    var qs = s.querySelectorAll('.q'), ok = 0, done = 0;
    for (var i = 0; i < qs.length; i++){
      if (qs[i].dataset.done){ done++; if (qs[i].dataset.ok) ok++; }
    }
    return { total: qs.length, done: done, ok: ok };
  }

  function statusOf(i){
    var s = slides[i];
    if (hasQuiz(s)){
      var q = quizState(s);
      if (q.done < q.total) return { ok:false, text:'Тест обязателен: ответьте на все вопросы (' + q.done + ' из ' + q.total + ')' };
      if (q.ok < q.total)  return { ok:false, text:'Нужны <b>все</b> верные ответы. Сейчас верно ' + q.ok + ' из ' + q.total + ' — нажмите «Пройти заново» и вернитесь к слайдам' };
      return { ok:true, text:'Тест сдан: ' + q.total + ' из ' + q.total + '. Объяснения открыты — прочитайте их' };
    }
    if (hasTasks(s)){
      if (!tasksDone(s)) return { ok:false, text:'Отметьте все пункты чек-листа практики' };
      return { ok:true, text:'Чек-лист практики закрыт — можно идти дальше' };
    }
    if (!seen[i]) return { ok:false, text:'Прочитайте слайд и нажмите «Далее»' };
    return { ok:true, text:'Слайд изучен — можно идти дальше' };
  }

  /* ---------- элементы ---------- */
  var lockbar  = document.createElement('div');
  lockbar.className = 'lockbar';
  var nextBtn  = document.getElementById('next');
  var prevBtn  = document.getElementById('prev');
  var counter  = document.getElementById('counter');
  var progEl   = document.getElementById('prog');
  var progWrap = document.querySelector('.progress');
  var chip     = document.getElementById('stagechip');
  stageEl.insertBefore(lockbar, stageEl.firstChild);

  function blockedByTask(i){
    var s = slides[i];
    if (hasQuiz(s)){
      var q = quizState(s);
      return q.done < q.total || q.ok < q.total;
    }
    return hasTasks(s) && !tasksDone(s);
  }

  function studyBar(i){
    var st = statusOf(i);
    lockbar.innerHTML = st.ok ? '✅ <b>' + st.text + '</b>' : '🔒 <b>Дальше нельзя.</b> ' + st.text;
    lockbar.classList.toggle('done', st.ok);
    /* Кнопку блокируем только когда слайд действительно не сдан (чек-лист или тест):
       на обычном слайде первый же клик помечает его прочитанным и открывает следующий.
       Иначе получилась бы ловушка: кнопка выключена, а включить её можно только кликом. */
    nextBtn.disabled = blockedByTask(i);
    nextBtn.textContent = st.ok ? 'Далее →' : (nextBtn.disabled ? '🔒 Заблокировано' : 'Прочитал, далее →');
    return st.ok;
  }

  function show(i){
    if (i < 0) i = 0;
    if (i > unlocked) i = unlocked;
    if (i > N - 1) i = N - 1;
    for (var k = 0; k < N; k++) slides[k].classList.remove('active');
    cur = i;
    slides[i].classList.add('active');
    visited[i] = 1;
    stageEl.scrollTop = 0;
    chip.textContent = slides[i].dataset.stage || '';
    document.body.classList.remove('quizok');
    if (hasQuiz(slides[i])) document.body.classList.add('quizdone');
    refresh();
    markOv();
    save();
  }

  /* refresh вызывается часто (в том числе из чужого кода), поэтому слайд
     помечается прочитанным только при явном действии — see() */
  function refresh(){
    var ok = studyBar(cur);
    counter.textContent = (cur + 1) + ' / ' + N + '  ·  открыто ' + (unlocked + 1);
    progEl.style.width = ((unlocked + 1) / N * 100) + '%';
    progWrap.classList.toggle('locked', unlocked < N - 1);
    return ok;
  }
  function see(){ seen[cur] = 1; }

  function unlockNext(){
    if (cur === unlocked && unlocked < N - 1){
      unlocked = cur + 1;
      window.__studyMax = unlocked;
      save();
      markOv();
    }
  }
  function next(){
    see();
    if (statusOf(cur).ok){
      unlockNext();
      if (cur < N - 1) show(cur + 1); else refresh();
    } else {
      refresh();
    }
  }
  function prev(){ show(cur - 1); }

  window.__studyMax = 0;
  window.__studyTick = function(){ refresh(); };
  window.__studyCan = function(idx){ return idx <= unlocked; };

  function markOv(){
    var links = document.querySelectorAll('.ovlink');
    for (var k = 0; k < links.length; k++){
      var idx = parseInt(links[k].dataset.idx, 10);
      var locked = idx > unlocked;
      links[k].classList.toggle('locked', locked);
      var on = (idx === cur);
      links[k].style.borderColor = on ? '#a78bfa' : '';
      links[k].style.background  = on ? '#1d1836' : '';
      var label = links[k].querySelector('.n');
      if (label) label.textContent = locked ? '🔒' : String(idx + 1);
    }
  }

  /* ---------- строка состояния в нижней панели ---------- */
  var hint = document.querySelector('.botbar .hint');
  if (hint){
    hint.className = 'studyhint';
    hint.innerHTML = '🔒 слайды открываются по порядку · <kbd>O</kbd> содержание · <kbd>🖨</kbd> печать';
  }
  var resetBtn = document.createElement('button');
  resetBtn.className = 'btn';
  resetBtn.id = 'studyReset';
  resetBtn.title = 'Сбросить прогресс изучения (нужно подтвердить вторым щелчком)';
  resetBtn.textContent = '↺ Прогресс';
  var armed = 0;
  resetBtn.addEventListener('click', function(){
    if (!armed){
      armed = 1; resetBtn.textContent = '↺ Точно сбросить?';
      setTimeout(function(){ armed = 0; resetBtn.textContent = '↺ Прогресс'; }, 2500);
      return;
    }
    armed = 0; resetBtn.textContent = '↺ Прогресс';
    unlocked = 0; visited = {}; seen = {};
    window.__studyMax = 0;
    if (store){ try { store.removeItem(SKEY); } catch(e){} }
    var qs = document.querySelectorAll('.q');
    for (var i = 0; i < qs.length; i++){
      delete qs[i].dataset.done; delete qs[i].dataset.ok; qs[i].classList.remove('answered');
      var op = qs[i].querySelectorAll('.opt');
      for (var j = 0; j < op.length; j++) op[j].classList.remove('right', 'wrong');
    }
    var boxes = document.querySelectorAll('[data-task] input[type=checkbox]');
    for (var b = 0; b < boxes.length; b++) boxes[b].checked = false;
    var bars = document.querySelectorAll('[data-task] .bar i');
    for (var r = 0; r < bars.length; r++) bars[r].style.width = '0%';
    document.body.classList.remove('quizok');
    show(0);
  });
  document.querySelector('.botbar').appendChild(resetBtn);

  /* ---------- перехват управления ---------- */
  nextBtn.onclick = next;
  prevBtn.onclick = prev;

  document.addEventListener('keydown', function(e){
    e.stopImmediatePropagation();
    var t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA'){ return; }
    switch (e.key){
      case 'ArrowRight': case 'PageDown': case ' ': next(); e.preventDefault(); break;
      case 'ArrowLeft':  case 'PageUp':   prev(); e.preventDefault(); break;
      case 'Home': show(0); break;
      case 'End':  show(unlocked); break;
      case 'o': case 'O': case 'щ': case 'Щ': case 'm': case 'M': case 'ь': case 'Ь':
        document.getElementById('modal').classList.toggle('open'); markOv(); break;
      case 'Escape':
        document.getElementById('modal').classList.remove('open');
        document.getElementById('codeModal').classList.remove('open');
        break;
      default:
        if (/^[0-9]$/.test(e.key)){
          var n = parseInt(e.key, 10); if (n === 0) n = 10;
          if (n - 1 <= unlocked) show(n - 1); else refresh();
        }
    }
  }, true);

  var wheelLock = false;
  stageEl.addEventListener('wheel', function(e){
    if (wheelLock || Math.abs(e.deltaY) < 30) return;
    var top = stageEl.scrollTop <= 0;
    var bot = stageEl.scrollTop + stageEl.clientHeight >= stageEl.scrollHeight - 4;
    if (e.deltaY > 0 && bot){ wheelLock = true; next(); setTimeout(function(){ wheelLock = false; }, 500); }
    else if (e.deltaY < 0 && top){ wheelLock = true; prev(); setTimeout(function(){ wheelLock = false; }, 500); }
  }, { passive: true, capture: true });

  var links = document.querySelectorAll('.ovlink');
  for (var k = 0; k < links.length; k++){
    (function(link){
      link.addEventListener('click', function(e){
        var idx = parseInt(link.dataset.idx, 10);
        if (idx > unlocked){
          e.stopImmediatePropagation();
          e.preventDefault();
          document.getElementById('modal').classList.remove('open');
          show(unlocked);
        }
      }, true);
    })(links[k]);
  }

  /* ---------- пересчёт статуса ----------
     нужен после отметки галочки в чек-листе и после ответа в тесте */
  document.addEventListener('change', function(e){
    if (e.target && e.target.type === 'checkbox') setTimeout(refresh, 0);
  });
  stageEl.addEventListener('scroll', function(){ refresh(); }, { passive: true });

  /* ---------- обязательный тест: объяснения только при полном успехе ---------- */
  var resultBox = null;
  function quizRefresh(){
    var s = slides[cur];
    if (!hasQuiz(s)) return;
    var q = quizState(s);
    var sc = document.getElementById('score');
    var bs = document.getElementById('btnScore');
    if (bs) bs.style.display = 'none';
    if (!sc) return;
    if (!resultBox){
      resultBox = document.createElement('div');
      resultBox.className = 'resultbox';
      sc.parentNode.insertBefore(resultBox, sc.nextSibling);
    }
    if (q.done === q.total && q.ok === q.total){
      document.body.classList.add('quizok');
      sc.textContent = q.total + ' / ' + q.total;
      sc.style.color = '#34d399';
      resultBox.className = 'resultbox ok';
      resultBox.innerHTML = '✅ <b>Все ответы верны.</b> Открылись объяснения к вопросам — прочитайте их: '
        + 'там разобрано, почему остальные варианты не подходят. Слайд разблокирован, можно идти дальше.';
    } else {
      document.body.classList.remove('quizok');
      sc.textContent = q.ok + ' / ' + q.total;
      sc.style.color = (q.done === q.total) ? '#fb7185' : '#fcd34d';
      resultBox.className = 'resultbox' + ((q.done === q.total) ? ' bad' : '');
      resultBox.innerHTML = (q.done < q.total)
        ? '⚠️ Тест обязателен. Отвечено ' + q.done + ' из ' + q.total + '. Объяснения появятся, только когда <b>все '
          + q.total + ' ответов будут верными</b>.'
        : '❌ Верно ' + q.ok + ' из ' + q.total + '. Объяснения закрыты. Нажмите <b>«Пройти заново»</b>, '
          + 'вернитесь к слайдам и ответьте правильно на все вопросы.';
    }
    refresh();
  }
  document.addEventListener('click', function(e){
    var o = e.target.closest ? e.target.closest('.q .opt') : null;
    if (o) setTimeout(quizRefresh, 30);
    var r = e.target.closest ? e.target.closest('#btnQuizReset') : null;
    if (r) setTimeout(function(){
      document.body.classList.remove('quizok');
      var qs = slides[cur].querySelectorAll('.q');
      for (var i = 0; i < qs.length; i++){ delete qs[i].dataset.done; delete qs[i].dataset.ok; }
      if (resultBox){ resultBox.remove(); resultBox = null; }
      quizRefresh();
    }, 30);
  });

  /* ---------- свайп ---------- */
  var x0 = null;
  stageEl.addEventListener('touchstart', function(e){ x0 = e.touches[0].clientX; }, { passive: true });
  stageEl.addEventListener('touchend', function(e){
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 70){ dx < 0 ? next() : prev(); }
    x0 = null;
  }, { passive: true });

  /* ---------- старт ---------- */
  var st0 = load();
  unlocked = Math.min(Math.max(st0.u | 0, 0), N - 1);
  visited  = st0.v || {};
  for (var key in visited){ if (visited.hasOwnProperty(key)) seen[key] = 1; }
  window.__studyMax = unlocked;

  var startIdx = unlocked;
  var h = parseInt((location.hash || '').replace('#s', ''), 10);
  if (h >= 1 && h <= N && (h - 1) <= unlocked && visited[h - 1] !== undefined) startIdx = h - 1;
  if (startIdx > 0 && visited[startIdx] === undefined){
    for (var q0 = startIdx - 1; q0 >= 0; q0--){ if (visited[q0] !== undefined){ startIdx = q0; break; } }
  }
  show(startIdx);
  requestAnimationFrame(function(){ ready = true; refresh(); });
  if (!store){
    lockbar.innerHTML += ' <span style="color:#fda4af">(браузер не даёт сохранять прогресс — не закрывайте вкладку)</span>';
  }
})();
</script>
