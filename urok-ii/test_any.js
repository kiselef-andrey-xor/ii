// Универсальная проверка любого файла курса: структура + вся интерактивность.
// Запуск: node test_any.js <путь_к_html> [индекс_ссылки_в_оглавлении]
const fs = require('fs');
const path = require('path');
/* jsdom: ищем рядом с проектом (cd ../tools && npm i jsdom) */
const __jsdomPaths = ['jsdom', require('path').join(__dirname, '..', 'tools', 'node_modules', 'jsdom')];
let __jsdom = null;
for (const p of __jsdomPaths) { try { __jsdom = require(p); break; } catch (e) {} }
if (!__jsdom) { console.error('\u041d\u0443\u0436\u0435\u043d jsdom:  cd ../tools && npm i jsdom'); process.exit(3); }
const { JSDOM, VirtualConsole } = __jsdom;

const FILE = path.resolve(process.argv[2] || 'index.html');
const LINK = parseInt(process.argv[3] || '3', 10);
const html = fs.readFileSync(FILE, 'utf8');

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/x', virtualConsole: vc });
const w = dom.window, d = w.document;
const out = [];

setTimeout(() => {
  const slides = d.querySelectorAll('.slide');
  out.push('файл: ' + path.basename(path.dirname(FILE)) + '/' + path.basename(FILE));
  out.push('  ошибки JS: ' + (errs.length ? JSON.stringify(errs.slice(0, 2)) : 'нет'));
  out.push('  слайдов: ' + slides.length + ' | активных: ' + d.querySelectorAll('.slide.active').length);
  out.push('  оглавление ссылок: ' + d.querySelectorAll('.ovlink').length +
           ' | меток «практика»: ' + d.querySelectorAll('.ovlink .pr').length);
  out.push('  чек-листов: ' + d.querySelectorAll('[data-task]').length +
           ' | вопросов теста: ' + d.querySelectorAll('.q').length +
           ' | кнопок «копировать»: ' + d.querySelectorAll('pre .copy').length);
  out.push('  заметок преподавателю: ' + d.querySelectorAll('.notes').length +
           ' | видны: ' + (d.defaultView.getComputedStyle(d.querySelector('.notes') || d.body).display !== 'none'));
  out.push('  кнопка заметок: ' + (d.getElementById('btnTeacher') ? 'ЕСТЬ' : 'нет') +
           ' | режим прохождения: ' + (d.querySelector('.lockbar') ? 'ВКЛЮЧЁН' : 'выключен'));
  out.push('  методичка в файле: ' + (/Методическая памятка/.test(html) ? 'есть' : 'нет'));
  out.push('  внешних ресурсов: ' + ((html.match(/(?:src|href)\s*=\s*"(?:https?:)?\/\//g) || []).length));

  // навигация
  d.getElementById('next').click(); d.getElementById('next').click();
  out.push('  после 2× «Далее»: ' + d.getElementById('counter').textContent.trim() +
           ' | этап: ' + d.getElementById('stagechip').textContent);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  out.push('  после Home: ' + d.getElementById('counter').textContent.trim());

  // оглавление
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'o', bubbles: true }));
  const links = d.querySelectorAll('.ovlink');
  links[Math.min(LINK, links.length - 1)].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  out.push('  переход по оглавлению: ' + d.getElementById('counter').textContent.trim() +
           ' | модал закрыт: ' + !d.getElementById('modal').classList.contains('open'));

  // тест
  const qs = d.querySelectorAll('.q');
  if (qs.length) {
    qs.forEach(q => q.querySelectorAll('.opt')[q.dataset.right].dispatchEvent(new w.MouseEvent('click', { bubbles: true })));
    const bs = d.getElementById('btnScore');
    if (bs && bs.style.display !== 'none') bs.click();
    out.push('  тест (все верно): ' + d.getElementById('score').textContent.trim());
    d.getElementById('btnQuizReset').click();
    out.push('  после сброса: ' + d.getElementById('score').textContent.trim());
  }

  // чек-лист
  const t = d.querySelector('[data-task]');
  if (t) {
    const cb = t.querySelectorAll('input[type=checkbox]');
    cb[0].checked = true; cb[0].dispatchEvent(new w.Event('change', { bubbles: true }));
    out.push('  чек-лист реагирует: ' + t.querySelector('.bar i').style.width);
  }

  // просмотр кода
  const pre = d.querySelectorAll('pre')[1] || d.querySelector('pre');
  if (pre) {
    pre.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
    out.push('  просмотр кода открывается: ' + d.getElementById('codeModal').classList.contains('open') +
             ' | символов: ' + d.getElementById('codeView').textContent.length);
    d.getElementById('codeClose').click();
  }
  console.log(out.join('\n'));
  process.exit(0);
}, 500);
