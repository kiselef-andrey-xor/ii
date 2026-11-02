// Полный тест режима прохождения: чек-листы, обязательный тест, сохранение прогресса.
const fs = require('fs');
/* jsdom: ищем рядом с проектом (cd ../tools && npm i jsdom) */
const __jsdomPaths = ['jsdom', require('path').join(__dirname, '..', 'tools', 'node_modules', 'jsdom')];
let __jsdom = null;
for (const p of __jsdomPaths) { try { __jsdom = require(p); break; } catch (e) {} }
if (!__jsdom) { console.error('\u041d\u0443\u0436\u0435\u043d jsdom:  cd ../tools && npm i jsdom'); process.exit(3); }
const { JSDOM, VirtualConsole } = __jsdom;

const FILE = process.argv[2] || (__dirname + '/index-bez-zametok.html');
const MT = 1, MP = 1;                       // укороченные тайминги для скорости теста
const URL = 'http://localhost/lesson-test';  // общий origin — чтобы localStorage пережил перезагрузку

function boot(clearStorage) {
  let html = fs.readFileSync(FILE, 'utf8')
    .replace(/var MIN_THEORY   = \d+;/, 'var MIN_THEORY   = ' + MT + ';')
    .replace(/var MIN_PRACTICE = \d+;/, 'var MIN_PRACTICE = ' + MP + ';');
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: URL, virtualConsole: vc });
  if (clearStorage) { try { dom.window.localStorage.clear(); } catch (e) {} }
  return { dom, w: dom.window, d: dom.window.document, errs };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

const out = [];
const log = s => out.push(s);

async function advance(env, to) {
  const { w, d } = env;
  const next = d.getElementById('next');
  for (let guard = 0; guard < 400; guard++) {
    const idx = parseInt(d.getElementById('counter').textContent, 10) - 1;
    if (idx >= to) return idx;
    await wait((MP + 1) * 1000 + 120);
    const slide = d.querySelectorAll('.slide')[idx];
    slide.querySelectorAll('[data-task] input[type=checkbox]').forEach(cb => {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true })); }
    });
    await wait(60);
    if (next.disabled) { log('  ! застряли на слайде ' + (idx + 1) + ': ' + d.querySelector('.lockbar').textContent.replace(/\s+/g, ' ').slice(0, 70)); return idx; }
    next.click();
    await wait(60);
  }
  return -1;
}

(async () => {
  // ---------- запуск 1 ----------
  let env = boot(true);
  await wait(400);
  const { w, d } = env;
  log('errors: ' + (env.errs.length ? JSON.stringify(env.errs.slice(0, 2)) : 'none'));

  const slides = d.querySelectorAll('.slide');
  const next = d.getElementById('next');
  const counter = () => d.getElementById('counter').textContent;
  const lock = () => d.querySelector('.lockbar').textContent.replace(/\s+/g, ' ').trim();

  // --- чек-лист как условие ---
  let practiceIdx = -1;
  slides.forEach((s, i) => { if (practiceIdx < 0 && s.querySelector('[data-task]')) practiceIdx = i; });
  const reached = await advance(env, practiceIdx);
  log('дошли до слайда с чек-листом: ' + (reached + 1) + ' (нужен ' + (practiceIdx + 1) + ') | ' + counter());

  next.click(); await wait(80);
  log('после клика Next на слайде практики: ' + counter());
  log('  статус: ' + lock().slice(0, 100));
  log('  Next заблокирован (чек-лист не заполнен): ' + next.disabled);

  const boxes = slides[practiceIdx].querySelectorAll('[data-task] input[type=checkbox]');
  for (let i = 0; i < boxes.length - 1; i++) {
    boxes[i].checked = true; boxes[i].dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  await wait(100);
  log('  отметили ' + (boxes.length - 1) + ' из ' + boxes.length + ' → Next.disabled=' + next.disabled);
  boxes[boxes.length - 1].checked = true;
  boxes[boxes.length - 1].dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(1500);
  log('  отметили все → Next.disabled=' + next.disabled + ' | ' + lock().slice(0, 60));
  next.click(); await wait(80);
  log('  переход дальше: ' + counter());

  // --- доходим до теста ---
  let quizIdx = -1;
  slides.forEach((s, i) => { if (quizIdx < 0 && s.querySelector('.q')) quizIdx = i; });
  const r2 = await advance(env, quizIdx);
  log('дошли до теста: слайд ' + (r2 + 1) + ' (нужен ' + (quizIdx + 1) + ') | ' + counter());

  const qs = slides[quizIdx].querySelectorAll('.q');
  log('вопросов в тесте: ' + qs.length);
  log('объяснения скрыты до сдачи: ' + (d.body.classList.contains('quizok') === false));
  log('кнопка «Показать результат» скрыта: ' + (d.getElementById('btnScore').style.display === 'none'));

  // отвечаем на все, но один — неправильно
  qs.forEach((q, i) => {
    const right = parseInt(q.dataset.right, 10);
    const pick = (i === 0) ? ((right + 1) % 3) : right;
    q.querySelectorAll('.opt')[pick].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await wait(300);
  log('после ответов (1 неверный): ' + d.querySelector('.resultbox').textContent.replace(/\s+/g, ' ').trim().slice(0, 110));
  log('  quizok (объяснения открыты): ' + d.body.classList.contains('quizok'));
  log('  Next.disabled: ' + next.disabled);
  log('  exp скрыт CSS: ' + (getComputedStyleSafe(d, qs[0].querySelector('.exp')) ));

  // сброс и все верно
  d.getElementById('btnQuizReset').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(200);
  log('после сброса: quizok=' + d.body.classList.contains('quizok') + ' | ' + d.querySelector('.resultbox').textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
  qs.forEach(q => {
    q.querySelectorAll('.opt')[q.dataset.right].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await wait(300);
  log('все ответы верны → ' + d.querySelector('.resultbox').textContent.replace(/\s+/g, ' ').trim().slice(0, 90));
  log('  quizok (объяснения открыты): ' + d.body.classList.contains('quizok'));
  await wait((MP + 1) * 1000 + 200);
  log('  Next.disabled: ' + next.disabled);
  next.click(); await wait(100);
  log('  перешли дальше: ' + counter());

  const afterReloadIdx = parseInt(counter(), 10) - 1;
  log('прогресс в localStorage: ' + JSON.stringify(Object.keys(w.localStorage)).slice(0, 60));
  env.dom.window.close();

  // ---------- запуск 2: прогресс должен восстановиться ----------
  // jsdom не хранит localStorage между экземплярами, поэтому сейм его вручную
  // тем же алгоритмом, которым пользуется страница. В браузере это работает само.
  function mix(str){
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < str.length; i++){
      h1 = (h1 ^ str.charCodeAt(i)) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + str.charCodeAt(i) * (i + 7)) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
  }
  const KEYWORD = 'speak';
  const N = slides.length;
  const SKEY = 'x' + mix(KEYWORD + '|' + N);
  const seededV = {}; for (let i = 0; i <= afterReloadIdx; i++) seededV[i] = 1;
  const seededU = afterReloadIdx;
  const seeded = { u: seededU, v: seededV, c: mix(KEYWORD + ':' + seededU + ':' + JSON.stringify(seededV)) };

  let html2 = fs.readFileSync(FILE, 'utf8')
    .replace(/var MIN_THEORY   = \d+;/, 'var MIN_THEORY   = ' + MT + ';')
    .replace(/var MIN_PRACTICE = \d+;/, 'var MIN_PRACTICE = ' + MP + ';');
  const vc2 = new VirtualConsole();
  const dom2 = new JSDOM(html2, { runScripts: 'dangerously', pretendToBeVisual: true, url: URL, virtualConsole: vc2 });
  dom2.window.localStorage.setItem(SKEY, JSON.stringify(seeded));
  await wait(600);
  const c2 = dom2.window.document.getElementById('counter').textContent;
  log('\nпосле «перезагрузки» с сохранённым прогрессом: ' + c2 + ' (ожидали ' + (afterReloadIdx + 1) + ')');
  log('  заблокировано в оглавлении: ' + dom2.window.document.querySelectorAll('.ovlink.locked').length + ' из ' + dom2.window.document.querySelectorAll('.ovlink').length);
  // с испорченной контрольной суммой прогресс должен откатиться
  dom2.window.localStorage.setItem(SKEY, JSON.stringify({ u: seededU, v: seededV, c: 'подделано' }));
  const dom2b = new JSDOM(html2, { runScripts: 'dangerously', pretendToBeVisual: true, url: URL, virtualConsole: new VirtualConsole() });
  dom2b.window.localStorage.setItem(SKEY, JSON.stringify({ u: seededU, v: seededV, c: 'подделано' }));
  await wait(600);
  log('  с подделанной контрольной суммой: ' + dom2b.window.document.getElementById('counter').textContent + ' (ожидали откат к 1)');
  dom2b.window.close();
  const env2 = { dom: dom2, w: dom2.window, d: dom2.window.document };

  // ---------- запуск 3: попытка войти по хешу на закрытый слайд ----------
  let html3 = fs.readFileSync(FILE, 'utf8')
    .replace(/var MIN_THEORY   = \d+;/, 'var MIN_THEORY   = ' + MT + ';')
    .replace(/var MIN_PRACTICE = \d+;/, 'var MIN_PRACTICE = ' + MP + ';');
  const vc3 = new VirtualConsole();
  const dom3 = new JSDOM(html3, { runScripts: 'dangerously', pretendToBeVisual: true, url: URL + '#s999', virtualConsole: vc3 });
  await wait(500);
  log('вход по #s999 → ' + dom3.window.document.getElementById('counter').textContent);
  dom3.window.close();
  env2.dom.window.close();

  console.log(out.join('\n'));
  process.exit(0);
})();

function getComputedStyleSafe(d, el) {
  try { return d.defaultView.getComputedStyle(el).display; } catch (e) { return 'n/a'; }
}
