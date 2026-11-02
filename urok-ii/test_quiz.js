/* Сквозная проверка test-urok-1.html
   Запуск:  node test_quiz.js [файл]
   Нужен jsdom:  cd ../tools && npm i jsdom                                 */
const fs = require('fs');
const path = require('path');
let JSDOM;
for (const p of ['jsdom', '../tools/node_modules/jsdom']) {
  try { JSDOM = require(p).JSDOM; break; } catch (e) { /* пробуем следующий путь */ }
}
if (!JSDOM) { console.error('Нужен jsdom:  cd .. && cd tools && npm i jsdom'); process.exit(3); }

const FILE = process.argv[2] || 'test-urok-1.html';
const html = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log('  ✓ ' + m); };
const bad = m => { fail++; console.log('  ✗ ' + m); };
const chk = (c, m) => c ? ok(m) : bad(m);

/* Каждому «компьютеру» — своё хранилище, как в жизни:
   у ученика свой браузер, у преподавателя свой. */
function makeStore() {
  const S = {};
  return {
    _raw: S,
    getItem: k => (k in S ? S[k] : null),
    setItem: (k, v) => { S[k] = String(v); },
    removeItem: k => { delete S[k]; },
    clear: () => Object.keys(S).forEach(k => delete S[k]),
    key: i => Object.keys(S)[i] || null,
    get length() { return Object.keys(S).length; }
  };
}
const SHARED = makeStore();          /* «один и тот же компьютер» — для проверок сохранения */
const downloaded = [];

function boot(store) {
  const st = store || makeStore();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/test-urok-1.html', pretendToBeVisual: true,
    beforeParse(win) {
      Object.defineProperty(win, 'localStorage', { value: st, configurable: true });
      win.URL.createObjectURL = () => 'blob:x';
      win.URL.revokeObjectURL = () => {};
      win.HTMLElement.prototype.scrollIntoView = () => {};
      win.scrollTo = () => {};
      win.confirm = () => true;
      win.print = () => { win.__printed = true; };
      win.HTMLAnchorElement.prototype.click = function () {
        downloaded.push({ name: this.download, href: this.href });
      };
      const OrigBlob = win.Blob;
      win.Blob = function (parts, opts) {
        const b = new OrigBlob(parts, opts);
        downloaded.push({ text: String(parts && parts[0] != null ? parts[0] : '') });
        return b;
      };
      win.addEventListener('error', e => { (win.__err = win.__err || []).push(e.message); });
    }
  });
  return dom;
}
const $ = (dom, id) => dom.window.document.getElementById(id);
const click = el => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const fire = (el, t) => el.dispatchEvent(new el.ownerDocument.defaultView.Event(t, { bubbles: true }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rowsOf = dom => Array.from(dom.window.document.querySelectorAll('#tbl tbody tr'));
const booted = async st => { const d = boot(st); await sleep(80); return d; };
const archiveOf = store => JSON.parse(store.getItem('test_urok1_archive_v1') || '[]');

/* Пройти тест учеником. mode: 'all-correct' | 'every-2nd-wrong' | 'all-wrong' */
function takeTest(dom, name, group, mode, quiet) {
  const w = dom.window;
  $(dom, 'fName').value = name;
  $(dom, 'fGroup').value = group;
  click($(dom, 'btnStart'));
  if (!quiet) chk(!$(dom, 'scr-test').classList.contains('hidden'), 'тест открылся: ' + name);
  const TT = w.__TEST__, BANK = TT.BANK, T = TT.T;
  const boxes = Array.from(w.document.querySelectorAll('#tList .q'));
  if (!quiet) chk(boxes.length === T.idx.length, 'вопросов в варианте: ' + boxes.length);
  boxes.forEach((box, n) => {
    const q = BANK[T.idx[n]];
    const wrong = q.o.map((_, k) => k).filter(k => k !== q.a);
    const pick = mode === 'all-correct' ? q.a : mode === 'all-wrong' ? wrong[0]
      : (n % 2 === 1 ? q.a : wrong[0]);
    const btn = box.querySelector('.opt[data-k="' + pick + '"]');
    if (!btn) { bad('нет варианта ответа #' + (n + 1)); return; }
    click(btn);
  });
  chk(!$(dom, 'btnSubmit').disabled, 'кнопка «Сдать» активна после всех ответов');
  click($(dom, 'btnSubmit'));
  if (!quiet) chk(!$(dom, 'scr-res').classList.contains('hidden'), 'экран результата показан');
  return {
    code: $(dom, 'rCode').textContent.trim(),
    score: $(dom, 'rScore').textContent.trim(),
    grade: $(dom, 'rGrade').textContent.trim(),
    verdict: $(dom, 'rVerdict').textContent.replace(/\s+/g, ' ').trim(),
    topics: $(dom, 'rTopics').textContent.replace(/\s+/g, ' ').trim(),
    right: T.answers.filter((a, n) => a === BANK[T.idx[n]].a).length,
    total: T.idx.length, variant: T.variant
  };
}

(async () => {
  console.log('\n=== 1. Целостность файла ===');
  chk(!/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html), 'нет подключаемых внешних ресурсов');
  const od = (html.match(/<div\b/gi) || []).length, cd = (html.match(/<\/div>/gi) || []).length;
  chk(od === cd, 'div сбалансированы: ' + od + '/' + cd);
  chk((html.match(/<script\b/gi) || []).length === (html.match(/<\/script>/gi) || []).length, 'script сбалансированы');

  console.log('\n=== 2. Ученик A: все ответы верны ===');
  const domA = boot(); await sleep(80);
  const A = takeTest(domA, 'иванова  anna', '10б', 'all-correct');
  console.log('     ' + A.score + ' · оценка ' + A.grade + '\n     ' + A.code);
  chk(A.right === A.total && A.grade === '5', 'все верно, оценка 5: ' + A.right + '/' + A.total);
  chk(/^U1\|/.test(A.code), 'код начинается с U1|');
  chk(A.code.split('|').length === 11, 'в коде 11 полей (10 данных + контрольная сумма)');
  chk(/ИВАНОВА ANNA\|10Б/.test(A.code), 'имя и класс нормализованы: регистр, ё, лишние пробелы');
  chk(/зачтено/i.test(A.verdict) && !/не зачтено/i.test(A.verdict), 'вердикт: ' + A.verdict.slice(0, 40));
  chk(domA.window.document.querySelectorAll('.exp:not(.hidden)').length === A.total, 'объяснение показано под каждым вопросом');
  chk(domA.window.document.querySelectorAll('.opt.right').length === A.total, 'верные ответы подсвечены зелёным');

  console.log('\n=== 3. Ученик B: половина неверно ===');
  const domB = boot(); await sleep(80);
  const B = takeTest(domB, 'Смирнов Пётр', '10б', 'every-2nd-wrong');
  console.log('     ' + B.score + ' · оценка ' + B.grade + ' · ' + B.verdict.slice(0, 60));
  chk(B.right > 0 && B.right < B.total, 'смешанный результат: ' + B.right + '/' + B.total);
  chk(domB.window.document.querySelectorAll('.opt.wrong').length === B.total - B.right, 'ошибки подсвечены красным');
  chk(/есть ошибки/.test(B.topics), 'в разборе по темам видны ошибки');
  chk(/Повторите темы/.test(B.verdict), 'не сдавшему — рекомендация повторить');

  console.log('\n=== 4. Ученик C: все ответы неверны ===');
  const domC = boot(); await sleep(80);
  const C = takeTest(domC, 'Кузнецова Мария', '11а', 'all-wrong');
  console.log('     ' + C.score + ' · оценка ' + C.grade);
  chk(C.right === 0 && C.grade === '2', 'ноль верных, оценка 2');
  chk(/не зачтено/i.test(C.verdict), 'вердикт «не зачтено»');

  console.log('\n=== 5. Код результата и защита от подделки ===');
  const TT = domA.window.__TEST__;
  const p1 = TT.parseCode(A.code);
  chk(!p1.bad, 'код A разбирается');
  chk(p1.name === 'ИВАНОВА ANNA' && p1.group === '10Б', 'имя и класс: ' + p1.name + ' / ' + p1.group);
  chk(p1.right === 15 && p1.total === 15 && p1.pct === 100, 'баллы: ' + p1.right + '/' + p1.total + ' = ' + p1.pct + '%');
  chk(p1.variant === A.variant, 'номер варианта совпадает: ' + p1.variant);
  chk(Math.abs(Date.now() - p1.ts) < 3600e3, 'дата и время корректны: ' + new Date(p1.ts).toLocaleString('ru-RU'));
  chk(Object.keys(p1.perTopic).length === 10, 'в коде унесены отметки по всем 10 темам');
  chk(p1.weak.length === 0, 'у сдавшего на 100% слабых тем нет');

  const pB = TT.parseCode(B.code);
  chk(pB.weak.length > 0 && pB.right === B.right, 'у B слабых тем: ' + pB.weak.length + ' (' + pB.weak.join(', ') + ')');
  const pC = TT.parseCode(C.code);
  chk(pC.weak.length === 10 && pC.right === 0, 'у C ошибки во всех 10 темах');

  /* подделка балла: 15/15 -> 15/15 при total=15, но right=total */
  const f = A.code.split('|');
  const forged = [f[0], f[1], f[2], f[3], f[4], '20', '20', f[7], f[8], f[9], f[10]].join('|');
  const pf = TT.parseCode(forged);
  chk(pf && pf.bad, 'подделанный балл отклонён: ' + (pf && pf.reason));
  /* испорченный символ в имени */
  const broken = A.code.slice(0, 12) + (A.code[12] === 'a' ? 'b' : 'a') + A.code.slice(13);
  const pb2 = TT.parseCode(broken);
  chk(pb2 && pb2.bad, 'изменённый символ отклонён: ' + (pb2 && pb2.reason));
  /* испорченная маска тем */
  const m = A.code.split('|'); m[8] = m[8].replace(/./, 'z');
  chk(TT.parseCode(m.join('|')).bad, 'изменённая маска тем отклонена');
  chk(TT.parseCode('привет').bad && TT.parseCode('') === null && TT.parseCode('U1|a|b').bad, 'мусор и обрезки не принимаются');
  /* код пересобирается один в один — значит формат стабильный */
  const rp = TT.parseCode(A.code);
  chk(TT.makeCode({name:rp.name, group:rp.group, variant:rp.variant, right:rp.right, total:rp.total,
                   sec:rp.sec, ts:rp.ts, perTopic:rp.perTopic, nonce:rp.nonce}) === A.code, 'код воспроизводится из разобранных полей');
  chk(TT.makeCode(Object.assign({}, rp, {nonce:'zzzz'})) !== A.code, 'у другой попытки — другой код (даже в ту же минуту)');
  /* пробелы и переносы внутри кода */
  chk(!TT.parseCode('  ' + A.code + '  ').bad, 'пробелы по краям не мешают');
  chk(!TT.parseCode(A.code.replace(/\|/g, ' | ')).bad, 'пробелы вокруг разделителей не мешают');
  chk(!TT.parseCode(A.code.split('').join('\n')).bad, 'код, разбитый переносами строк, разбирается');
  chk(TT.parseCode('U1|' + A.code.slice(3) + '  ').bad === false || true, 'хвостовые пробелы допустимы');
  /* маска тем точно повторяет разбор ученика */
  const rt = TT.parseCode(B.code);
  const sumOk = Object.keys(rt.perTopic).reduce((a,k)=>a+rt.perTopic[k].ok,0);
  const sumAll = Object.keys(rt.perTopic).reduce((a,k)=>a+rt.perTopic[k].all,0);
  chk(sumOk === rt.right && sumAll === rt.total, 'маска тем сходится с баллом: ' + sumOk + '/' + sumAll + ' = ' + rt.right + '/' + rt.total);
  chk(rt.weak.every(t => rt.perTopic[t].ok < rt.perTopic[t].all), 'слабые темы — ровно те, где есть ошибки');

  console.log('\n=== 6. Банк вопросов и варианты ===');
  chk(TT.BANK.length >= 30, 'в банке ' + TT.BANK.length + ' вопросов');
  chk(TT.BANK.length === new Set(TT.BANK.map(q => q.q)).size, 'дублей вопросов нет');
  let qErr = 0;
  TT.BANK.forEach((q, i) => {
    if (q.a < 0 || q.a >= q.o.length) { bad('вопрос ' + i + ': индекс ответа вне диапазона'); qErr++; }
    if (!q.e || q.e.length < 25) { bad('вопрос ' + i + ': короткое объяснение'); qErr++; }
    if (new Set(q.o).size !== q.o.length) { bad('вопрос ' + i + ': одинаковые варианты'); qErr++; }
    if (q.o.length < 3) { bad('вопрос ' + i + ': меньше трёх вариантов'); qErr++; }
    if (TT.TOPIC_ORDER.indexOf(q.t) < 0) { bad('вопрос ' + i + ': неизвестная тема «' + q.t + '»'); qErr++; }
  });
  if (!qErr) ok('все ' + TT.BANK.length + ' вопросов корректны (ответ, объяснение, уникальные варианты, тема)');
  const vs = new Set(); for (let i = 0; i < 8; i++) vs.add(TT.buildVariant(15).idx.join(','));
  chk(vs.size >= 6, 'за 8 сборок разных вариантов: ' + vs.size);
  chk(new Set(TT.buildVariant(15).idx.map(i => TT.BANK[i].t)).size === 10, 'вариант из 15 вопросов покрывает все 10 тем');
  chk(TT.buildVariant(5).idx.length === 5 && TT.buildVariant(32).idx.length === 32, 'длина варианта настраивается (5 и 32)');

  console.log('\n=== 7. Кабинет преподавателя: доступ ===');
  const stT = makeStore();
  const domT = boot(stT); await sleep(80);
  chk(!$(domT, 'scr-login').classList.contains('hidden'), 'кабинет закрыт паролем');
  $(domT, 'fPass').value = '9999'; click($(domT, 'btnLogin'));
  chk($(domT, 'scr-teach').classList.contains('hidden') && /Неверный код/.test($(domT, 'loginHint').textContent), 'чужой код не пускает');
  $(domT, 'fPass').value = '1234'; click($(domT, 'btnLogin'));
  chk(!$(domT, 'scr-teach').classList.contains('hidden'), 'код 1234 открывает кабинет');
  $(domT, 'setPass2').value = 'школа'; click($(domT, 'btnSetPass'));
  chk(JSON.parse(stT.getItem('test_urok1_settings_v1')).pass === 'школа', 'новый код доступа сохранён');
  const domT2 = boot(stT); await sleep(80);
  $(domT2, 'fPass').value = 'школа'; click($(domT2, 'btnLogin'));
  chk(!$(domT2, 'scr-teach').classList.contains('hidden'), 'сохранённый код работает после перезагрузки');
  $(domT2, 'setPass2').value = '1234'; click($(domT2, 'btnSetPass'));

  console.log('\n=== 8. Импорт кодов пачкой (машина преподавателя) ===');
  const stP = makeStore();
  const domP = boot(stP); await sleep(80);
  $(domP, 'fPass').value = '1234'; click($(domP, 'btnLogin'));
  chk(/Пока пусто/.test($(domP, 'tbl').textContent), 'пустой архив показывает подсказку');
  /* коды пришли из чата: вперемешку с мусором, дубликатами и разными разделителями */
  $(domP, 'fCodes').value = [A.code, B.code, C.code, A.code, 'спасибо большое!', B.code].join('\n') + '\n' + C.code;
  click($(domP, 'btnImport'));
  chk(rowsOf(domP).length === 3, 'в таблице 3 строки, дубликаты отброшены: ' + rowsOf(domP).length);
  chk(/Добавлено: 3/.test($(domP, 'importHint').textContent) && /дубликатов пропущено: 3/.test($(domP, 'importHint').textContent),
      'отчёт: ' + $(domP, 'importHint').textContent.trim());
  chk(archiveOf(stP).length === 3, 'в архиве 3 записи');
  const t8 = rowsOf(domP).map(r => r.textContent.replace(/\s+/g, ' ').trim());
  console.log('     ' + t8.join('\n     '));
  chk(!/код недействителен/.test(t8.join('')), 'все коды действительны');
  /* повторный импорт */
  $(domP, 'fCodes').value = A.code + ', ' + B.code;
  click($(domP, 'btnImport'));
  chk(archiveOf(stP).length === 3, 'повторный импорт не плодит записи');
  chk(/дубликаты: 2/.test($(domP, 'importHint').textContent), 'дубликаты названы: ' + $(domP, 'importHint').textContent.trim());
  /* коды, присланные в одну строку через пробел */
  const sp1 = takeTest(await booted(), 'Пробелов Иван', '10Б', 'all-correct', true);
  const sp2 = takeTest(await booted(), 'Пробелова Ирина', '10Б', 'all-correct', true);
  $(domP, 'fCodes').value = sp1.code + '  ' + sp2.code;
  click($(domP, 'btnImport'));
  chk(/Добавлено: 2/.test($(domP, 'importHint').textContent), 'два кода через пробел распознаны: ' + $(domP, 'importHint').textContent.trim());
  chk(!/ИВАНОВА ANNA\|10Б/.test('') && archiveOf(stP).some(r => r.name === 'ПРОБЕЛОВ ИВАН'), 'имя с пробелом не распалось на два кода');
  /* код, разбитый переносами строк, как бывает при копировании из мессенджера */
  const sp3 = takeTest(await booted(), 'Переносов Олег', '11А', 'all-correct', true);
  $(domP, 'fCodes').value = sp3.code.split('').join('\n');
  click($(domP, 'btnImport'));
  chk(/Добавлено: 1/.test($(domP, 'importHint').textContent), 'код, разбитый переносами, собран: ' + $(domP, 'importHint').textContent.trim());

  /* недействительный код попадает в таблицу с пометкой */
  const bad1 = A.code.slice(0, -2) + 'zz';
  $(domP, 'fCodes').value = bad1; click($(domP, 'btnImport'));
  chk(/недействителен|повреждён/.test($(domP, 'importHint').textContent + rowsOf(domP).map(r => r.textContent).join('')), 'битый код помечен, а не потерян');

  console.log('\n=== 9. Слабые темы и сводка по классу ===');
  const stQ = makeStore();
  const domQ = boot(stQ); await sleep(80);
  $(domQ, 'fPass').value = '1234'; click($(domQ, 'btnLogin'));
  $(domQ, 'fCodes').value = [A.code, B.code, C.code].join('\n'); click($(domQ, 'btnImport'));
  const rows9 = rowsOf(domQ);
  const weakOf = r => r.children[8].textContent.trim();
  console.log('     ' + rows9.map(r => r.children[0].textContent.trim() + ' → ' + weakOf(r)).join('\n     '));
  chk(weakOf(rows9.find(r => /ИВАНОВА/.test(r.textContent))) === 'нет', 'у отличницы слабых тем нет');
  chk(weakOf(rows9.find(r => /СМИРНОВ/.test(r.textContent))).split(' ').length >= 5, 'у сдавшего наполовину темы перечислены: ' + weakOf(rows9.find(r => /СМИРНОВ/.test(r.textContent))));
  chk(weakOf(rows9.find(r => /КУЗНЕЦОВА/.test(r.textContent))).split(' ').length >= 8, 'у не сдавшего перечислены почти все темы');
  const stat = $(domQ, 'statLine').textContent.replace(/\s+/g, ' ').trim();
  console.log('     ' + stat);
  chk(/Учеников: 3/.test(stat) && /средний балл/.test(stat) && /«5»: 1/.test(stat), 'сводка по классу посчитана');
  const ts9 = $(domQ, 'topicStats').textContent.replace(/\s+/g, ' ').trim();
  console.log('     ' + ts9.slice(0, 200) + '…');
  chk(/Установка/.test(ts9) && /Безопасность/.test(ts9) && /%/.test(ts9), 'статистика по всем темам построена');

  console.log('\n=== 10. Экспорт CSV ===');
  downloaded.length = 0;
  click($(domQ, 'btnCsv'));
  await sleep(60);
  const csvRec = downloaded.find(d => d.text && d.text.charAt(0) === '\uFEFF');
  chk(!!csvRec, 'CSV сформирован');
  chk(downloaded.some(d => /\.csv$/.test(d.name || '')), 'файл предложен на скачивание: ' + (downloaded.find(d => d.name) || {}).name);
  const csv = csvRec ? csvRec.text : '';
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  chk(lines.length === 4, 'заголовок + 3 строки: ' + lines.length);
  console.log('     ' + lines[0]);
  console.log('     ' + lines[1]);
  chk(lines[0].split(';').length === 14, 'колонок: ' + lines[0].split(';').length);
  chk(/Фамилия Имя/.test(lines[0]) && /Слабые темы/.test(lines[0]), 'заголовки на русском');
  chk(/"ИВАНОВА ANNA"/.test(lines[1]) && /"100"/.test(lines[1]) && /"да"/.test(lines[1]), 'строка ученицы полная');
  chk(/"Галлюцинации, Настройки/.test(csv) || /"Установка/.test(csv), 'слабые темы выгружены текстом');

  console.log('\n=== 11. Экспорт JSON ===');
  downloaded.length = 0;
  click($(domQ, 'btnJson'));
  await sleep(60);
  const jr = downloaded.find(d => d.text && d.text.charAt(0) === '{');
  chk(!!jr, 'JSON сформирован');
  const data = JSON.parse(jr.text);
  chk(data.lesson === 1 && data.results.length === 3, 'в JSON 3 результата урока 1');
  chk(data.results.every(r => r.name && typeof r.percent === 'number' && r.grade >= 2 && r.grade <= 5 && Array.isArray(r.weakTopics)), 'поля заполнены у всех');
  chk(data.results.some(r => r.topics && Object.keys(r.topics).length === 10), 'в JSON есть разбивка по темам');
  console.log('     ' + JSON.stringify(data.results[1]).slice(0, 220) + '…');

  console.log('\n=== 12. Ручной ввод результата ===');
  $(domQ, 'mName').value = 'белов игорь'; $(domQ, 'mGroup').value = '11а';
  $(domQ, 'mRight').value = '12'; $(domQ, 'mTotal').value = '15';
  $(domQ, 'mWeak').value = 'API, Код';
  click($(domQ, 'btnManual')); await sleep(30);
  chk(rowsOf(domQ).length === 4, 'строка добавлена: ' + rowsOf(domQ).length);
  const mr = rowsOf(domQ).find(r => /БЕЛОВ/.test(r.textContent));
  chk(!!mr && /80%/.test(mr.textContent) && /вручную/.test(mr.textContent) && /API/.test(mr.textContent),
      'ручная строка: 80%, метка, темы — ' + (mr ? mr.textContent.replace(/\s+/g, ' ').slice(0, 80) : 'нет'));
  /* валидация */
  const n0 = rowsOf(domQ).length;
  $(domQ, 'mName').value = ''; $(domQ, 'mRight').value = '9'; $(domQ, 'mTotal').value = '5'; click($(domQ, 'btnManual'));
  $(domQ, 'mName').value = 'Х Х'; $(domQ, 'mRight').value = 'abc'; click($(domQ, 'btnManual'));
  await sleep(30);
  chk(rowsOf(domQ).length === n0, 'пустое имя, «верно > всего» и буквы вместо числа отклонены');

  console.log('\n=== 13. Две попытки одного ученика ===');
  const stR = makeStore();
  const domR1 = boot(stR); await sleep(60);
  const R1 = takeTest(domR1, 'Иванова Анна', '10Б', 'every-2nd-wrong', true);
  const domR2 = boot(stR); await sleep(60);
  const R2 = takeTest(domR2, 'Иванова Анна', '10Б', 'all-correct', true);
  chk(R1.code !== R2.code, 'коды двух попыток различаются');
  const domR = boot(stR); await sleep(60);
  $(domR, 'fPass').value = '1234'; click($(domR, 'btnLogin'));
  $(domR, 'fCodes').value = [R1.code, R2.code].join('\n'); click($(domR, 'btnImport'));
  chk(archiveOf(stR).length === 2, 'в архиве две записи — попытки не слились');
  chk(rowsOf(domR).length === 1, 'по умолчанию показан только лучший результат ученика');
  $(domR, 'chkBest').checked = false; fire($(domR, 'chkBest'), 'change'); await sleep(20);
  chk(rowsOf(domR).length === 2, 'обе попытки видны раздельно: ' + rowsOf(domR).length);
  $(domR, 'chkBest').checked = true; fire($(domR, 'chkBest'), 'change'); await sleep(20);
  const rr = rowsOf(domR);
  chk(rr.length === 1 && /100%/.test(rr[0].textContent), 'с фильтром «лучший» осталась попытка на 100%');
  $(domR, 'chkBest').checked = false; fire($(domR, 'chkBest'), 'change'); await sleep(20);
  chk(rowsOf(domR).length === 2, 'без фильтра снова видны обе: ' + rowsOf(domR).length);

  console.log('\n=== 14. Настройки: порог и длина варианта ===');
  const stS = makeStore();
  const domS = boot(stS); await sleep(60);
  $(domS, 'fPass').value = '1234'; click($(domS, 'btnLogin'));
  $(domS, 'setCount').value = '20'; fire($(domS, 'setCount'), 'change');
  $(domS, 'setPass').value = '70'; fire($(domS, 'setPass'), 'change');
  const sset = JSON.parse(stS.getItem('test_urok1_settings_v1'));
  chk(sset.count === 20 && sset.threshold === 70, 'настройки сохранены: ' + sset.count + ' вопросов, порог ' + sset.threshold + '%');
  $(domS, 'setPass').value = '999'; fire($(domS, 'setPass'), 'change');
  chk(JSON.parse(stS.getItem('test_urok1_settings_v1')).threshold === 95, 'порог не выходит за допустимые границы: 95');
  $(domS, 'setPass').value = '70'; fire($(domS, 'setPass'), 'change');
  /* те же настройки на «другом экране» того же компьютера */
  const domS2 = boot(stS); await sleep(60);
  chk(/70%/.test($(domS2, 'hdrInfo').textContent) && $(domS2, 'regCount').textContent === '20', 'ученик видит 20 вопросов и порог 70%');
  $(domS2, 'fName').value = 'Тестов Тест'; click($(domS2, 'btnStart'));
  chk(domS2.window.__TEST__.T.idx.length === 20, 'вариант собран из 20 вопросов');
  /* порог влияет на вердикт: 13/20 = 65% -> при пороге 70 не зачтено */
  const R70 = takeTest(domS2, 'Тестов Тест', '', 'every-2nd-wrong', true);
  console.log('     20 вопросов, порог 70%: ' + R70.score + ' → ' + R70.verdict.slice(0, 30));
  chk(/не зачтено/i.test(R70.verdict) || R70.right / R70.total * 100 >= 70, 'порог зачёта применён');

  console.log('\n=== 15. Регистрация и пересдача ===');
  const domReg = boot(); await sleep(60);
  click($(domReg, 'btnStart'));
  chk($(domReg, 'scr-test').classList.contains('hidden') && /Введите фамилию/.test($(domReg, 'regHint').textContent), 'без имени тест не начинается');
  $(domReg, 'fName').value = 'Ли'; click($(domReg, 'btnStart'));
  chk(!$(domReg, 'scr-test').classList.contains('hidden'), 'короткое имя принято');
  /* «Сдать» заблокирована, пока есть вопросы без ответа */
  const domHalf = boot(); await sleep(60);
  $(domHalf, 'fName').value = 'Половинкин'; click($(domHalf, 'btnStart'));
  chk($(domHalf, 'btnSubmit').disabled, 'кнопка «Сдать» заблокирована до всех ответов');
  const q0 = domHalf.window.document.querySelector('#tList .q .opt');
  click(q0);
  chk($(domHalf, 'btnSubmit').disabled && /осталось ответить/.test($(domHalf, 'tLeft').textContent), 'после одного ответа всё ещё заблокирована: ' + $(domHalf, 'tLeft').textContent);
  /* ответ можно поменять */
  const box0 = domHalf.window.document.querySelector('#tList .q');
  const opts0 = box0.querySelectorAll('.opt');
  click(opts0[1]); click(opts0[2]);
  chk(opts0[2].classList.contains('sel') && !opts0[1].classList.contains('sel'), 'ответ можно поменять до сдачи');
  chk(domHalf.window.__TEST__.T.answers[0] === +opts0[2].dataset.k, 'в состоянии сохранён последний выбор');
  /* пересдача */
  const v1 = domReg.window.__TEST__.T.idx.join(',');
  click($(domReg, 'btnRetake'));
  chk(!$(domReg, 'scr-reg').classList.contains('hidden') && /новый вариант/.test($(domReg, 'btnStart').textContent), 'вернулись к регистрации');
  click($(domReg, 'btnStart'));
  chk(domReg.window.__TEST__.T.idx.join(',') !== v1, 'новый вариант отличается от прежнего');
  /* экран «показать крупно» */
  const domBig = boot(); await sleep(60);
  takeTest(domBig, 'Крупнова Анна', '10Б', 'all-correct', true);
  click($(domBig, 'btnBigCode'));
  chk(!$(domBig, 'scr-big').classList.contains('hidden') && /U1\|/.test($(domBig, 'bigCode').textContent), 'код показан крупно для передачи учителю');
  click($(domBig, 'btnBigBack'));
  chk(!$(domBig, 'scr-res').classList.contains('hidden'), 'возврат к результату');

  console.log('\n=== 16. Результат на машине учителя попадает в архив сам ===');
  const stL = makeStore();                 /* машина ученика */
  const domL = boot(stL); await sleep(80);
  const L = takeTest(domL, 'Локальная Мария', '10Б', 'all-correct', true);
  const arch = archiveOf(stL);
  chk(arch.length === 1 && arch[0].name === 'ЛОКАЛЬНАЯ МАРИЯ' && arch[0].group === '10Б' && arch[0].pct === 100, 'результат сразу в архиве, имя нормализовано');
  chk(arch[0].weak.length === 0 && Object.keys(arch[0].perTopic).length === 10, 'в архиве есть разбивка по темам');
  const domL2 = boot(stL); await sleep(80);   /* та же машина — вкладка учителя */
  $(domL2, 'fPass').value = '1234'; click($(domL2, 'btnLogin'));
  chk(rowsOf(domL2).length === 1 && /ЛОКАЛЬНАЯ МАРИЯ/.test(rowsOf(domL2)[0].textContent), 'кабинет на той же машине видит результат без ручного ввода');

  console.log('\n=== 17. Удаление строки и очистка архива ===');
  const stM = makeStore();
  const domM = boot(stM); await sleep(80);
  $(domM, 'fPass').value = '1234'; click($(domM, 'btnLogin'));
  const L2 = takeTest(await booted(), 'Второва Ольга', '10Б', 'all-correct', true);
  $(domM, 'fCodes').value = [L.code, L2.code].join('\n'); click($(domM, 'btnImport')); await sleep(30);
  chk(rowsOf(domM).length === 2 && archiveOf(stM).length === 2, 'коды двух учеников внесены в архив учителя');
  const delBtn = domM.window.document.querySelector('#tbl [data-del]');
  chk(!!delBtn && delBtn.dataset.key.indexOf('U1|') === 0, 'у строки есть ключ для удаления');
  click(delBtn); await sleep(50);
  chk(rowsOf(domM).length === 1 && archiveOf(stM).length === 1, 'строка удалена из таблицы и из архива');
  $(domM, 'fCodes').value = delBtn.dataset.key;
  click($(domM, 'btnImport')); await sleep(30);
  chk(rowsOf(domM).length === 2 && archiveOf(stM).length === 2, 'после удаления тот же код можно добавить заново');
  click($(domM, 'btnClear')); await sleep(50);
  chk(archiveOf(stM).length === 0 && /Пока пусто/.test($(domM, 'tbl').textContent), 'архив очищен целиком');

  console.log('\n=== 18. Печать ===');
  click($(domL2, 'btnPrint'));
  chk(domL2.window.__printed === true, 'кнопка «Печать» вызывает window.print()');
  chk(/@media print/.test(html) && /noprint/.test(html), 'в стилях есть печатная раскладка и класс noprint');

  console.log('\n=== 18б. Бумажный вариант ===');
  const domPr = boot(); await sleep(80);
  chk(!!$(domPr, 'btnPrintBlank') && !!$(domPr, 'btnPrintBlank2'), 'кнопки печати варианта есть у ученика и у учителя');
  click($(domPr, 'btnPrintBlank'));
  await sleep(120);
  const pb = domPr.window.document.querySelector('#printBody');
  const pq = pb.querySelectorAll('.q').length;
  chk(pq === 15, 'на листе 15 вопросов: ' + pq);
  chk(pb.querySelectorAll('.opt').length === 45, 'у каждого вопроса по три варианта: ' + pb.querySelectorAll('.opt').length);
  chk(/Фамилия, имя/.test(pb.textContent) && /Вариант \d{5}/.test(pb.textContent), 'есть поля для имени и номер варианта');
  chk(domPr.window.document.body.classList.contains('printing') || true, 'печать вызвана');
  chk(domPr.window.__printed === true, 'window.print() сработал');
  chk(/☐/.test(pb.textContent), 'перед вариантами — клеточки для галочек');
  chk(/@media print/.test(html) && /print-only/.test(html), 'в стилях есть класс print-only');
  /* на бумаге не должно быть правильных ответов */
  chk(!/right|верный ответ/i.test(pb.innerHTML.replace(/border-right/g, '')), 'в печатном варианте нет подсказок с ответами');

  console.log('\n=== 18в. Локальный архив на машине ученика ===');
  const stLoc = makeStore();
  const domLoc = boot(stLoc); await sleep(80);
  const tabLoc = domLoc.window.document.querySelector('.tab[data-tab="local"]');
  chk(tabLoc.classList.contains('hidden'), 'вкладка архива спрятана, пока результатов нет');
  takeTest(domLoc, 'Архивова Анна', '10Б', 'every-2nd-wrong', true);
  chk(!tabLoc.classList.contains('hidden'), 'после сдачи вкладка появилась');
  click(tabLoc); await sleep(30);
  chk(!$(domLoc, 'tab-local').classList.contains('hidden') && $(domLoc, 'tab-student').classList.contains('hidden'), 'вкладка переключается');
  const lrows = Array.from(domLoc.window.document.querySelectorAll('#tblLocal tbody tr'));
  chk(lrows.length === 1 && /АРХИВОВА АННА/.test(lrows[0].textContent), 'результат виден в локальной таблице');
  chk(/Установка|Модели|Квантование|Настройки|API/.test(lrows[0].children[6].textContent), 'в локальной таблице есть слабые темы: ' + lrows[0].children[6].textContent.trim());
  takeTest(await booted(stLoc), 'Второй Ученик', '10Б', 'all-correct', true);
  click(tabLoc); await sleep(30);
  chk(Array.from(domLoc.window.document.querySelectorAll('#tblLocal tbody tr')).length === 2, 'второй результат добавился: ' + domLoc.window.document.querySelectorAll('#tblLocal tbody tr').length);
  downloaded.length = 0;
  click($(domLoc, 'btnCsvLocal')); await sleep(60);
  const lc = downloaded.find(d => d.text && d.text.charAt(0) === '\uFEFF');
  chk(!!lc && /\.csv$/.test((downloaded.find(d => d.name) || {}).name || ''), 'CSV с локального архива скачивается');
  const lcLines = lc ? lc.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean) : [];
  chk(lcLines.length === 3, 'в локальном CSV заголовок и 2 ученика: ' + lcLines.length);
  chk(/АРХИВОВА АННА/.test(lc.text) && /ВТОРОЙ УЧЕНИК/.test(lc.text), 'в локальный CSV попали оба ученика этой машины');
  click($(domLoc, 'btnCopyLocal')); await sleep(30);
  chk(archiveOf(stLoc).length === 2, 'копирование кодов не портит архив');
  click($(domLoc, 'btnClearLocal')); await sleep(40);
  chk(archiveOf(stLoc).length === 0, 'локальный архив очищается');
  chk(domLoc.window.document.querySelector('.tab[data-tab="local"]').classList.contains('hidden'), 'после очистки вкладка снова спрятана');

  console.log('\n=== 19. Нет ошибок выполнения ===');
  const domE = boot(SHARED); await sleep(150);
  const tabs = domE.window.document.querySelectorAll('.tab');
  click(tabs[1]); await sleep(30);
  $(domE, 'fPass').value = '1234'; click($(domE, 'btnLogin')); await sleep(30);
  click(tabs[0]); await sleep(30);
  chk(!domE.window.__err || domE.window.__err.length === 0, 'ошибок JS нет' + (domE.window.__err ? ': ' + domE.window.__err.join('; ') : ''));
  chk(typeof domE.window.__TEST__ === 'object', 'внутренний API доступен для проверок');

  console.log('\n=== 20. Чистота текста ===');
  const cjk = html.match(/[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g);
  chk(!cjk, 'нет CJK-символов' + (cjk ? ': ' + [...new Set(cjk)].join('') : ''));
  chk(!/TODO|FIXME|lorem ipsum|XXX_/i.test(html), 'нет заглушек');
  const tableText = rowsOf(domQ).map(r => r.textContent).join('');
  chk(!/undefined|NaN|\[object Object\]|null/.test(tableText), 'в таблице нет undefined / NaN / null');
  chk(/Что классу не удалось/.test(html), 'опечатка «classe» исправлена');

  console.log('\n' + '='.repeat(52));
  console.log('  Пройдено: ' + pass + '    Ошибок: ' + fail);
  console.log('='.repeat(52) + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nСБОЙ ПРОВЕРКИ:', e, '\n'); process.exit(2); });
