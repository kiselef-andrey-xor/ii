// Проверка общего ученического файла: без ожидания, с чек-листами и обязательным тестом.
const fs = require('fs');
const path = require('path');
/* jsdom: ищем рядом с проектом (cd ../tools && npm i jsdom) */
const __jsdomPaths = ['jsdom', require('path').join(__dirname, '..', 'tools', 'node_modules', 'jsdom')];
let __jsdom = null;
for (const p of __jsdomPaths) { try { __jsdom = require(p); break; } catch (e) {} }
if (!__jsdom) { console.error('\u041d\u0443\u0436\u0435\u043d jsdom:  cd ../tools && npm i jsdom'); process.exit(3); }
const { JSDOM, VirtualConsole } = __jsdom;

const FILE = path.resolve(process.argv[2] || 'kurs-uchenik.html');
let html = fs.readFileSync(FILE, 'utf8');
// для быстрой проверки снимаем пятисекундный порог: он проверен отдельным прогоном
if (process.argv[3] === 'fast') html = html.replace(/if \(secs < 5\) return/g, 'if (secs < 0) return');
const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/kurs', virtualConsole: vc });
const w = dom.window, d = w.document;
const out = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await wait(450);
  const slides = d.querySelectorAll('.slide');
  const next = d.getElementById('next');
  const counter = () => d.getElementById('counter').textContent.trim();
  const lock = () => d.querySelector('.lockbar').textContent.replace(/\s+/g, ' ').trim();

  out.push('ошибки JS: ' + (errs.length ? JSON.stringify(errs.slice(0, 2)) : 'нет'));
  out.push('слайдов: ' + slides.length + ' | практика-меток: ' + d.querySelectorAll('.ovlink .pr').length);
  out.push('заметок преподавателю: ' + d.querySelectorAll('.notes').length +
           ' | кнопок заметок/практики: ' + (d.getElementById('btnTeacher') ? 1 : 0) + '/' + (d.getElementById('btnPractice') ? 1 : 0));
  out.push('ожидание по времени: ' + (/Осталось изучить/.test(html) ? 'ЕСТЬ (ошибка)' : 'отключено'));
  out.push('требование прокрутки: ' + (/Дочитайте слайд до конца/.test(html) ? 'ЕСТЬ (ошибка)' : 'отключено'));

  // 1. теоретический слайд открывается сразу, без ожидания
  out.push('\n— теория без ожидания —');
  out.push('старт: ' + counter() + ' | ' + lock().slice(0, 70));
  await wait(150);
  out.push('через 0.15 с Next.disabled = ' + next.disabled);
  next.click(); await wait(80);
  out.push('после «Далее»: ' + counter());
  next.click(); await wait(80);
  out.push('ещё раз: ' + counter() + ' | ' + lock().slice(0, 60));

  // 2. попытка обойти фильтром практики
  out.push('\n— обходные пути —');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
  await wait(60);
  out.push('клавиша F: body.class="' + d.body.className + '" (должно быть пусто)');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  await wait(60);
  out.push('клавиша End: ' + counter());
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: '9', bubbles: true }));
  await wait(60);
  out.push('клавиша 9: ' + counter());
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'o', bubbles: true }));
  await wait(60);
  const links = d.querySelectorAll('.ovlink');
  out.push('в оглавлении закрыто: ' + d.querySelectorAll('.ovlink.locked').length + ' из ' + links.length);
  links[60].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(80);
  out.push('клик по 61-му слайду: ' + counter() + ' | модал закрыт: ' + !d.getElementById('modal').classList.contains('open'));

  // 3. слайд с чек-листом
  out.push('\n— чек-лист как условие —');
  let pIdx = -1;
  slides.forEach((s, i) => { if (pIdx < 0 && s.querySelector('[data-task]')) pIdx = i; });
  for (let k = 0; k < pIdx + 3; k++) {
    await wait(120);
    const idxNow = parseInt(counter(), 10) - 1;
    if (idxNow >= pIdx) break;
    const sl = d.querySelectorAll('.slide')[idxNow];
    if (!sl) { out.push('  ! нет слайда ' + (idxNow + 1)); break; }
    sl.querySelectorAll('[data-task] input[type=checkbox]').forEach(cb => {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true })); }
    });
    await wait(60);
    if (!next.disabled) next.click();
    await wait(60);
  }
  out.push('дошли до слайда с практикой: ' + counter() + ' (нужен ' + (pIdx + 1) + ')');
  const cur = parseInt(counter(), 10) - 1;
  const boxes = slides[cur] ? slides[cur].querySelectorAll('[data-task] input[type=checkbox]') : [];
  if (!boxes.length) { out.push('  ! на текущем слайде нет чек-листа — проверяем вручную слайд ' + (pIdx + 1)); }
  out.push('пунктов в чек-листе: ' + boxes.length + ' | Next.disabled: ' + next.disabled + ' | ' + lock().slice(0, 60));
  for (let i = 0; i < boxes.length - 1; i++) {
    boxes[i].checked = true; boxes[i].dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  await wait(120);
  out.push('отметили ' + (boxes.length - 1) + ' из ' + boxes.length + ' → Next.disabled=' + next.disabled);
  if (boxes.length) {
    boxes[boxes.length - 1].checked = true;
    boxes[boxes.length - 1].dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  await wait(150);
  out.push('отметили все → Next.disabled=' + next.disabled + ' | ' + lock().slice(0, 50));
  next.click(); await wait(80);
  out.push('перешли дальше: ' + counter());

  // 4. обязательный тест
  out.push('\n— обязательный тест —');
  let qIdx = -1;
  slides.forEach((s, i) => { if (qIdx < 0 && s.querySelector('.q')) qIdx = i; });
  for (let k = 0; k < 60; k++) {
    const idx = parseInt(counter(), 10) - 1;
    if (idx >= qIdx) break;
    await wait(120);
    const sl = d.querySelectorAll('.slide')[idx];
    sl.querySelectorAll('[data-task] input[type=checkbox]').forEach(cb => {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true })); }
    });
    await wait(60);
    if (next.disabled) { out.push('  ! застряли на ' + (idx + 1) + ': ' + lock().slice(0, 60)); break; }
    next.click(); await wait(60);
  }
  out.push('дошли до теста: ' + counter() + ' (нужен ' + (qIdx + 1) + ')');
  const qi = parseInt(counter(), 10) - 1;
  const qs = slides[qi] ? slides[qi].querySelectorAll('.q') : [];
  if (!qs.length) { console.log(out.join('\n')); console.log('нет теста на слайде ' + (qi + 1)); process.exit(0); }
  out.push('вопросов: ' + qs.length);
  qs.forEach((q, i) => {
    const right = parseInt(q.dataset.right, 10);
    q.querySelectorAll('.opt')[(i === 0) ? ((right + 1) % 3) : right].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await wait(250);
  out.push('один неверный → ' + d.querySelector('.resultbox').textContent.replace(/\s+/g, ' ').trim().slice(0, 95));
  out.push('  объяснения открыты: ' + d.body.classList.contains('quizok') + ' | Next.disabled: ' + next.disabled);
  d.getElementById('btnQuizReset').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(150);
  qs.forEach(q => q.querySelectorAll('.opt')[q.dataset.right].dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
  await wait(250);
  out.push('все верные → ' + d.querySelector('.resultbox').textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
  out.push('  объяснения открыты: ' + d.body.classList.contains('quizok') + ' | Next.disabled: ' + next.disabled);
  next.click(); await wait(100);
  out.push('  после теста перешли на: ' + counter());

  console.log(out.join('\n'));
  process.exit(0);
})();
