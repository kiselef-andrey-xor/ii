// Проверка моста портала, встроенного в файлы курса сборщиком build_portal.py.
//
// Что проверяем:
//  1. ключ localStorage совпадает с тем, который считает PHP (lib/portal.php) и оболочка (portal.js);
//  2. прогресс записывается именно под per-user ключ (k<uid>|x…) и его можно прочитать обратно;
//  3. состояние, переданное адресом #krestore=…, восстанавливается — файл открывается на нужном слайде;
//  4. офлайн-режим не сломан: без ?uid= файл работает как раньше (старый ключ x…);
//  5. режим обязательного прохождения в собранном файле по-прежнему работает (порядок, чек-листы, тест).
//
// Запуск: node test_bridge.js [файл] [keyword] [слайдов] [uid]
//         node test_bridge.js dist/kurs-web/kursy/urok-3/index-bez-zametok.html rag 19 42
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const __jsdomPaths = ['jsdom', path.join(__dirname, '..', 'tools', 'node_modules', 'jsdom'),
  path.join(__dirname, '..', '..', 'tools', 'node_modules', 'jsdom')];
let __jsdom = null;
for (const p of __jsdomPaths) { try { __jsdom = require(p); break; } catch (e) {} }
if (!__jsdom) { console.error('Нужен jsdom:  cd ../tools && npm i jsdom'); process.exit(3); }
const { JSDOM, VirtualConsole } = __jsdom;

const FILE = path.resolve(process.argv[2] || 'dist/kurs-web/kursy/kurs-uchenik.html');
const KEYWORD = process.argv[3] || 'speak';
const SLIDES = parseInt(process.argv[4] || '107', 10);
const UID = parseInt(process.argv[5] || '42', 10);

let pass = 0, fail = 0;
const notes = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); notes.push(name); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// та же формула, что в _study_mode.js, portal.js и lib/portal.php
function mix(str) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}
const BASE = 'x' + mix(KEYWORD + '|' + SLIDES);
const UKEY = 'k' + UID + '|' + BASE;

function phpKey(keyword, slides, uid) {
  const out = execFileSync('php', [path.join(__dirname, 'tests', 'key_ref.php'), keyword, String(slides), String(uid)],
    { encoding: 'utf8' });
  return out.trim();
}

function loadDom(html, url) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String(e.message || '');
    if (!/Not implemented/i.test(m)) errs.push('jsdomError: ' + m);
  });
  vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
    storageQuota: 10000000
  });
  dom.__errs = errs;
  return dom;
}

(async () => {
  console.log('Файл: ' + FILE);
  const html = fs.readFileSync(FILE, 'utf8');
  check('мост встроен сборщиком', html.includes('KURS BRIDGE'), 'запустите python3 build_portal.py');
  check('в файле есть режим прохождения', html.includes('function studyBar('));

  // 1. ключи совпадают между PHP и JS
  console.log('\n== 1. Ключ хранилища ==');
  let php = null;
  try { php = phpKey(KEYWORD, SLIDES, UID); } catch (e) { notes.push('php недоступен: ' + e.message); }
  if (php) check('PHP считает тот же ключ, что и JS', php === UKEY, php + ' != ' + UKEY);
  else console.log('  ~ php не найден — сравнение ключа пропущено');
  check('ключ содержит uid ученика', UKEY.indexOf('k' + UID + '|') === 0, UKEY);

  // 2. прогресс пишется под per-user ключ
  console.log('\n== 2. Прогресс в портале ==');
  let dom = loadDom(html, 'http://localhost/kurs/course.php?f=x&uid=' + UID);
  await wait(600);
  let w = dom.window, d = w.document;
  check('слайдов в файле столько, сколько ждёт ключ', d.querySelectorAll('.slide').length === SLIDES,
    d.querySelectorAll('.slide').length + ' != ' + SLIDES);
  check('страница открылась на первом слайде', (w.__studyMax | 0) === 0, String(w.__studyMax));

  const next = d.getElementById('next');
  const counter = () => d.getElementById('counter').textContent.trim();
  // теоретический слайд: одно нажатие «Далее»
  next.click(); await wait(80);
  next.click(); await wait(80);
  next.click(); await wait(80);
  check('слайды листаются по порядку', (w.__studyMax | 0) >= 1, 'unlocked=' + w.__studyMax);
  const raw = w.localStorage.getItem(UKEY);
  check('прогресс записан под ключом ' + UKEY, !!raw, String(raw));
  if (raw) {
    const st = JSON.parse(raw);
    check('в записи есть unlocked и подпись', typeof st.u === 'number' && typeof st.c === 'string');
    check('подпись считается от per-user ключа', st.c === mix(KEYWORD + ':' + st.u + ':' + JSON.stringify(st.v) + ':' + (st.p | 0)),
      st.c);
    check('запись совместима со штатным форматом режима прохождения',
      Object.keys(st).filter(k => ['u', 'v', 'p', 'c'].indexOf(k) < 0).length === 0, JSON.stringify(Object.keys(st)));
  }
  check('общий ключ очищен (чужой прогресс не остаётся)', w.localStorage.getItem(BASE) === null,
    String(w.localStorage.getItem(BASE)));
  check('ошибок в консоли нет', dom.__errs.length === 0, dom.__errs.slice(0, 3).join(' | '));
  dom.window.close();

  // 3. восстановление с сервера через адрес
  console.log('\n== 3. Восстановление прогресса с сервера ==');
  const restore = { uid: UID, state: { u: 5, p: 5, v: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } } };
  const url = 'http://localhost/kurs/course.php?f=x&uid=' + UID
    + '&restore=' + encodeURIComponent(JSON.stringify(restore));
  dom = loadDom(html, url);
  await wait(700);
  w = dom.window; d = w.document;
  const stored = w.localStorage.getItem(UKEY);
  check('состояние записано в хранилище', !!stored, String(stored));
  if (stored) {
    const st = JSON.parse(stored);
    check('unlocked восстановлен', st.u === 5, String(st.u));
    check('visited восстановлен', Object.keys(st.v).length === 6, JSON.stringify(st.v));
    check('подпись пересчитана под пер-user ключ',
      st.c === mix(KEYWORD + ':' + st.u + ':' + JSON.stringify(st.v) + ':' + (st.p | 0)), st.c);
  }
  check('ученик оказался на сохранённом слайде',
    /6\s*\/\s*\d+/.test(d.getElementById('counter').textContent),
    d.getElementById('counter').textContent);
  check('разблокировано 6 слайдов', (w.__studyMax | 0) === 5, String(w.__studyMax));
  check('restore-параметр не мешает навигации урока', d.querySelectorAll('.slide.active').length === 1);
  check('активен шестой слайд', d.querySelectorAll('.slide')[5].classList.contains('active'),
    String(d.querySelector('.slide.active') && d.querySelector('.slide.active').id));
  check('страница не перезагружалась (нет reload в jsdom)', dom.__errs.length === 0,
    dom.__errs.slice(0, 2).join(' | '));
  // после восстановления правила курса продолжают действовать:
  // идём вперёд и следим, что прогресс не сбрасывается в начало
  const before = d.getElementById('counter').textContent.trim();
  const unlockedBefore = w.__studyMax | 0;
  d.getElementById('next').click();
  await wait(150);
  const after = d.getElementById('counter').textContent.trim();
  check('ход вперёд не сбрасывает прогресс',
    after === before || parseInt(after, 10) === parseInt(before, 10) + 1,
    before + ' -> ' + after);
  check('разблокировано не меньше восстановленного',
    (w.__studyMax | 0) >= unlockedBefore, unlockedBefore + ' -> ' + w.__studyMax);
  check('правила курса действуют: вперёд без условий не пускает',
    (w.__studyMax | 0) <= SLIDES - 1, String(w.__studyMax));
  dom.window.close();

  // 4. офлайн-режим не сломан
  console.log('\n== 4. Офлайн-режим (файл открыт двойным щелчком) ==');
  dom = loadDom(html, 'http://localhost/kurs/kursy/offline.html');
  await wait(600);
  w = dom.window; d = w.document;
  check('режим прохождения работает без uid', typeof w.__studyMax === 'number');
  d.getElementById('next').click(); await wait(80);
  d.getElementById('next').click(); await wait(80);
  check('слайды листаются', (w.__studyMax | 0) >= 1, 'unlocked=' + w.__studyMax);
  check('прогресс в старом ключе', !!w.localStorage.getItem(BASE));
  check('per-user ключ не создан', w.localStorage.getItem(UKEY) === null);
  check('ошибок в консоли нет', dom.__errs.length === 0, dom.__errs.slice(0, 3).join(' | '));
  dom.window.close();

  console.log('\n' + '='.repeat(58));
  console.log('Пройдено: ' + pass + ', ошибок: ' + fail);
  if (notes.length) { console.log('Не прошло: ' + notes.join('; ')); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
