// Тест режима обязательного прохождения (student-версии).
// Тайминги искусственно укорочены, чтобы проверка шла быстро.
const fs = require('fs');
/* jsdom: ищем рядом с проектом (cd ../tools && npm i jsdom) */
const __jsdomPaths = ['jsdom', require('path').join(__dirname, '..', 'tools', 'node_modules', 'jsdom')];
let __jsdom = null;
for (const p of __jsdomPaths) { try { __jsdom = require(p); break; } catch (e) {} }
if (!__jsdom) { console.error('\u041d\u0443\u0436\u0435\u043d jsdom:  cd ../tools && npm i jsdom'); process.exit(3); }
const { JSDOM, VirtualConsole } = __jsdom;

const file = process.argv[2] || (__dirname + '/index-bez-zametok.html');
const minTheory = parseInt(process.argv[3] || '2', 10);
const minPractice = parseInt(process.argv[4] || '3', 10);

let html = fs.readFileSync(file, 'utf8');
html = html.replace(/var MIN_THEORY   = \d+;/, 'var MIN_THEORY   = ' + minTheory + ';')
           .replace(/var MIN_PRACTICE = \d+;/, 'var MIN_PRACTICE = ' + minPractice + ';');
if (!/var MIN_THEORY   = \d+;/.test(html)) { console.log('НЕ НАЙДЕН study-скрипт'); process.exit(1); }

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://localhost/' + file.split('/').slice(-2).join('_'), virtualConsole: vc });
const w = dom.window, d = w.document;
const out = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await wait(400);
  out.push('errors: ' + (errs.length ? JSON.stringify(errs.slice(0, 3)) : 'none'));
  out.push('slides: ' + d.querySelectorAll('.slide').length);
  out.push('lockbar создан: ' + !!d.querySelector('.lockbar'));
  out.push('кнопка сброса: ' + !!d.getElementById('studyReset'));
  out.push('кнопки заметок нет: ' + (d.getElementById('btnTeacher') === null));

  const next = d.getElementById('next');
  const counter = d.getElementById('counter');
  const lockText = () => d.querySelector('.lockbar').textContent.replace(/\s+/g, ' ').trim();

  out.push('старт: ' + counter.textContent + ' | ' + lockText().slice(0, 90));
  out.push('Next заблокирован в начале: ' + next.disabled);

  // попытка перепрыгнуть вперёд клавишей
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  await wait(50);
  out.push('после End (должен остаться на 1): ' + counter.textContent);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: '9', bubbles: true }));
  await wait(50);
  out.push('после клавиши 9 (должен остаться на 1): ' + counter.textContent);

  // клик по заблокированному слайду в содержании
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'o', bubbles: true }));
  await wait(50);
  const links = d.querySelectorAll('.ovlink');
  out.push('в содержании заблокировано слайдов: ' + d.querySelectorAll('.ovlink.locked').length + ' из ' + links.length);
  links[10].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(80);
  out.push('клик по 11-му слайду в содержании → ' + counter.textContent + ' (модал закрыт: ' + !d.getElementById('modal').classList.contains('open') + ')');

  // ждём разблокировки по времени
  await wait((minTheory + 2) * 1000);
  out.push('после ' + (minTheory + 2) + ' c: Next.disabled=' + next.disabled + ' | ' + lockText().slice(0, 80));
  next.click();
  await wait(80);
  out.push('переход на следующий: ' + counter.textContent);

  // слайд с практикой: без галочек не пускает
  let practiceIdx = -1;
  d.querySelectorAll('.slide').forEach((s, i) => {
    if (practiceIdx < 0 && s.querySelector('[data-task]')) practiceIdx = i;
  });
  out.push('первый слайд с чек-листом: №' + (practiceIdx + 1));

  // дойдём до теста и проверим обязательность
  let quizIdx = -1;
  d.querySelectorAll('.slide').forEach((s, i) => { if (quizIdx < 0 && s.querySelector('.q')) quizIdx = i; });
  out.push('слайд с тестом: №' + (quizIdx + 1));

  console.log(out.join('\n'));
  process.exit(0);
})();
