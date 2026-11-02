const fs = require('fs');
/* jsdom: ищем рядом с проектом (cd ../tools && npm i jsdom) */
const __jsdomPaths = ['jsdom', require('path').join(__dirname, '..', 'tools', 'node_modules', 'jsdom')];
let __jsdom = null;
for (const p of __jsdomPaths) { try { __jsdom = require(p); break; } catch (e) {} }
if (!__jsdom) { console.error('\u041d\u0443\u0436\u0435\u043d jsdom:  cd ../tools && npm i jsdom'); process.exit(3); }
const { JSDOM, VirtualConsole } = __jsdom;
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/index.html', virtualConsole: vc });
const w = dom.window, d = w.document;
const out = [];

setTimeout(() => {
  out.push('errors: ' + (errs.length ? JSON.stringify(errs) : 'none'));
  out.push('slides: ' + d.querySelectorAll('.slide').length + ' | active: ' + d.querySelectorAll('.slide.active').length);
  out.push('counter: ' + d.getElementById('counter').textContent + ' | chip: ' + d.getElementById('stagechip').textContent);
  out.push('overview links: ' + d.querySelectorAll('.ovlink').length + ' | practice marks: ' + d.querySelectorAll('.ovlink .pr').length);

  // навигация
  d.getElementById('next').click(); d.getElementById('next').click();
  out.push('2x Next -> ' + d.getElementById('counter').textContent + ' | ' + d.getElementById('stagechip').textContent);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  out.push('End -> ' + d.getElementById('counter').textContent + ' | hash ' + w.location.hash);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: '6', bubbles: true }));
  out.push('key 6 -> ' + d.getElementById('counter').textContent + ' | practice=' + d.querySelector('.slide.active').dataset.practice);

  // режим «только практика»
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
  out.push('practice mode: body.class="' + d.body.className + '" btn="' + d.getElementById('btnPractice').textContent + '"');
  out.push('  active slide is practice/keep: ' + (d.querySelector('.slide.active').dataset.practice === '1' || d.querySelector('.slide.active').dataset.keep === '1'));
  const before = d.getElementById('counter').textContent;
  d.getElementById('next').click();
  out.push('  Next in practice mode: ' + before + ' -> ' + d.getElementById('counter').textContent + ' | practice=' + d.querySelector('.slide.active').dataset.practice);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
  out.push('  practice mode off: "' + d.body.className + '"');

  // заметки преподавателя
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 't', bubbles: true }));
  var bt = d.getElementById('btnTeacher');
  out.push('teacher mode: "' + d.body.className + '" | ' + (bt ? bt.textContent : 'кнопки заметок нет (версия для учеников)'));

  // содержание
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'o', bubbles: true }));
  out.push('modal open: ' + d.getElementById('modal').classList.contains('open'));
  d.querySelectorAll('.ovlink')[29].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  out.push('jump via overview -> ' + d.getElementById('counter').textContent + ' | closed: ' + !d.getElementById('modal').classList.contains('open'));

  // тест
  const qs = d.querySelectorAll('.q');
  qs.forEach(q => q.querySelectorAll('.opt')[q.dataset.right].dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
  d.getElementById('btnScore').click();
  out.push('quiz all-correct: ' + d.getElementById('score').textContent);
  d.getElementById('btnQuizReset').click();
  qs[1].querySelectorAll('.opt')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  out.push('wrong answer marks: ' + qs[1].querySelectorAll('.opt')[0].className + ' / ' + qs[1].querySelectorAll('.opt')[qs[1].dataset.right].className);
  d.getElementById('btnScore').click();
  out.push('score after 1 wrong: ' + d.getElementById('score').textContent);
  d.getElementById('btnQuizReset').click();
  out.push('after reset: ' + d.getElementById('score').textContent + ' | flags cleared: ' + (!qs[0].dataset.done));

  // чек-листы
  const t = d.querySelector('[data-task]');
  const cb = t.querySelectorAll('input[type=checkbox]');
  cb[0].checked = true; cb[0].dispatchEvent(new w.Event('change', { bubbles: true }));
  out.push('checklist bar: ' + t.querySelector('.bar i').style.width + ' of ' + cb.length);

  // копирование + просмотр кода
  out.push('copy buttons: ' + d.querySelectorAll('pre .copy').length + ' / pre: ' + d.querySelectorAll('pre').length);
  const pre = d.querySelectorAll('pre')[5];
  pre.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
  out.push('dblclick opens viewer: ' + d.getElementById('codeModal').classList.contains('open') + ' | chars: ' + d.getElementById('codeView').textContent.length);
  d.getElementById('codeSel').click();
  d.getElementById('codeClose').click();
  out.push('viewer closed: ' + !d.getElementById('codeModal').classList.contains('open'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  console.log(out.join('\n'));
  process.exit(0);
}, 500);
