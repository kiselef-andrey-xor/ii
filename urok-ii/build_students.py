# -*- coding: utf-8 -*-
"""Сборка ученических файлов курса.

Из urok-N/_source.html (урок без слайда «Методическая памятка») делает:
  • urok-N/index-bez-zametok.html — ученикам: без заметок преподавателя,
    с режимом обязательного последовательного прохождения и обязательным тестом;
  • urok-N/index.html — преподавателю на одно занятие: с заметками, без блокировок.

Режим прохождения:
  1. Слайды открываются строго по порядку, вперёд не перемотать.
  2. Теория: нужно дочитать до конца (прокрутка вниз) и провести на слайде минимум N секунд,
     причём время засчитывается только когда вкладка в фокусе.
  3. Практика: нужно отметить все пункты чек-листа.
  4. Тест: объяснения и следующий слайд открываются только когда ВСЕ ответы верны.
  5. Прогресс сохраняется между перезапусками (localStorage), цифры скрыты и с контрольной суммой.
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LESSONS = {
    0: ('final', os.path.join(HERE, 'final', 'index.html')),
    1: ('urok-1', os.path.join(HERE, '_source.html')),
    2: ('urok-2', os.path.join(HERE, 'urok-2', '_source.html')),
    3: ('urok-3', os.path.join(HERE, 'urok-3', '_source.html')),
    4: ('urok-4', os.path.join(HERE, 'urok-4', '_source.html')),
}
KEYWORD = {0: 'final', 1: 'speak', 2: 'tools', 3: 'rag', 4: 'tune'}

# ---------------------------------------------------------------- CSS
CSS = """
/* ===== режим обязательного прохождения ===== */
.lockbar{position:sticky;top:0;z-index:25;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  font-size:13.5px;color:#fcd34d;background:#2a2210;border:1px solid #5c4a1a;border-radius:12px;
  padding:8px 12px;margin:0 0 16px;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.lockbar.done{color:#6ee7b7;background:rgba(52,211,153,.08);border-color:#1f5b46}
.lockbar b{color:#fff;font-weight:600}
.botbar .btn:disabled{opacity:.4;cursor:not-allowed;border-color:var(--line);background:var(--card2)}
.botbar .btn:disabled:hover{border-color:var(--line);background:var(--card2)}
.ovlink.locked{opacity:.4;cursor:not-allowed}
.ovlink.locked:hover{border-color:var(--line);background:#141127}
.q .exp{display:none!important}
body.quizok .q .exp{display:block!important}
.q .opt{pointer-events:none}
body.quizdone .q .opt{pointer-events:auto}
.resultbox{border-radius:14px;padding:14px 16px;margin:12px 0;border:1px solid var(--line);background:var(--card)}
.resultbox.ok{border-color:#1f5b46;background:rgba(52,211,153,.09);color:#a7f3d0}
.resultbox.bad{border-color:#7f2b3d;background:rgba(251,113,133,.08);color:#fecdd3}
.studyhint{font-size:13px;color:var(--dim2)}
.progress.locked i{background:linear-gradient(90deg,#7c5a1a,#fcd34d)}
"""

# ---------------------------------------------------------------- JS
# Шаблон режима прохождения лежит отдельным файлом — так его проще править и читать.
JS = io.open(os.path.join(HERE, '_study_mode.js'), encoding='utf-8').read()


TAG_RE = re.compile(r'<div\b[^>]*>|</div>', re.I)


def cut_balanced_div(s, start):
    """Вырезает <div ...> ... </div> с учётом вложенности. start — позиция '<'."""
    depth = 0
    for m in TAG_RE.finditer(s, start):
        if m.group(0).lower().startswith('</'):
            depth -= 1
            if depth == 0:
                return s[:start] + s[m.end():]
        else:
            depth += 1
    return s


def strip_notes(s):
    """Удаляет все блоки заметок преподавателю вместе с предшествующими пробелами."""
    removed = 0
    while True:
        i = s.find('<div class="notes">')
        if i < 0:
            break
        j = i
        while j > 0 and s[j - 1] in ' \t\r\n':
            j -= 1
        s = cut_balanced_div(s, i)
        # подчищаем хвостовые пробелы, оставшиеся на месте блока
        s = s[:j] + s[j:].lstrip(' \t\r\n')
        removed += 1
    return s, removed


def student_transforms(s, num, tag_version=True):
    """Убирает заметки и всё, что с ними связано."""
    s, n_notes = strip_notes(s)
    print('    вырезано блоков заметок: %d' % n_notes)
    s = s.replace('body.teacher .notes{display:block}', '.notes{display:none!important}')
    s = s.replace('  .notes{display:block!important}', '  .notes{display:none!important}')
    s = re.sub(r'\s*<button class="btn" id="btnTeacher"[^>]*>[^<]*</button>', '', s)
    s = re.sub(r'\s*<button class="btn" id="btnPractice"[^>]*>[^<]*</button>', '', s)
    s = re.sub(r' · <kbd>F</kbd>[^<·]*', '', s)
    s = re.sub(r'<kbd>F</kbd> — только практика, ?', '', s)
    s = re.sub(r'<kbd>F</kbd> — режим «только практика»[^<]*', '', s)
    s = re.sub(r'Кнопка <b>«🛠 Только практика»</b>[^<]*<kbd>F</kbd>[^<]*', '', s)
    s = re.sub(r'\s*<li>Клавиша <kbd>F</kbd>[^<]*</li>', '', s)
    s = re.sub(r"\s*case 't': case 'T': case 'е': case 'Е': toggleTeacher\(\); break;", '', s)
    s = re.sub(r"\s*document\.getElementById\('btnTeacher'\)\.onclick = toggleTeacher;", '', s)
    s = re.sub(r'  function toggleTeacher\(\)\{.*?\n  \}\n', '', s, flags=re.S)
    s = s.replace('var i = 0, teacher = false, practiceOnly = false;', 'var i = 0, practiceOnly = false;')
    s = re.sub(r' · <kbd>T</kbd>[^<·]*', '', s)
    s = re.sub(r'<kbd>T</kbd>[^<·]*· ', '', s)
    s = re.sub(r'Нажать <kbd>T</kbd>[^<]*', 'Проверить, что сервер отвечает', s)
    s = re.sub(r'Кнопка «🖨 Печать» сохраняет (?:урок|курс) в PDF[^<]*?заметк[^<]*?\.',
               lambda m: m.group(0).split('в PDF')[0] + 'в PDF.', s)
    s = re.sub(r'Клавиша <kbd>T</kbd>[^<]*?заметки[^<]*?\.',
               'Клавиша <kbd>F</kbd> — режим «только практика»: скрывает теорию и оставляет слайды, '
               'где класс работает руками.', s)
    s = re.sub(r'<kbd>F</kbd> — только практика, <kbd>T</kbd>[^<]*?, <kbd>🖨</kbd>',
               '<kbd>F</kbd> — только практика, <kbd>🖨</kbd>', s)
    if tag_version:
        s = re.sub(r'(<div class="pbadge t">)([^<]*?)( · версия для учеников)?(</div>)',
                   lambda mm: mm.group(1) + mm.group(2) + ' · версия для учеников' + mm.group(4), s, count=1)
    return s


def apply_patches(s, num):
    """Отключает свободную навигацию в исходном скрипте урока."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        '_study_patches', os.path.join(HERE, '_study_patches.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    applied = 0
    for rx, repl, required in mod.PAIRS:
        s, n = rx.subn(lambda m: repl, s, count=1)
        if n:
            applied += 1
        elif required:
            sys.exit('урок %d: не сработал патч навигации: %s' % (num, rx.pattern[:70]))
    if mod.BRIDGE_AFTER in s:
        s = s.replace(mod.BRIDGE_AFTER, mod.BRIDGE_AFTER + mod.STUDY_BRIDGE, 1)
    print('    патчей навигации применено: %d из %d' % (applied, len(mod.PAIRS)))
    return s


def gating(s, num):
    """Вставляет CSS и скрипт режима обязательного прохождения (без ожидания по времени)."""
    s = apply_patches(s, num)
    if '</style>' not in s:
        sys.exit('не найден </style> в уроке %d' % num)
    s = s.replace('</style>', CSS + '</style>', 1)
    js = JS.replace('__KEYWORD__', KEYWORD[num])
    if '</body>' not in s:
        sys.exit('не найден </body> в уроке %d' % num)
    s = s.replace('</body>', js + '</body>', 1)
    # подпись в шапке
    s = s.replace('<small>· практический курс</small>', '<small>· изучение по шагам</small>')
    s = re.sub(r'(<span>[^<]*<small>)· урок (\d)(</small></span>)', r'\1· урок \2 · по шагам\3', s)
    return s


def main():
    for num, (folder, path) in LESSONS.items():
        if not os.path.exists(path):
            print('пропуск урока %d: нет _source.html (сначала запустите build_teacher.py)' % num)
            continue
        src = io.open(path, encoding='utf-8').read()
        if num != 0 and 'Методическая памятка' in src:
            sys.exit('в источнике урока %d осталась методичка' % num)

        d = os.path.dirname(path)

        # преподавателю на одно занятие: файл как есть (для уроков источник уже без методички)
        if num != 0:
            io.open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(src)

        # ученикам: без заметок + режим прохождения
        st = student_transforms(src, num)
        st = gating(st, num)
        out = os.path.join(d, 'index-bez-zametok.html')
        io.open(out, 'w', encoding='utf-8').write(st)

        n_slides = len(re.findall(r'class="slide"', st))
        print('урок %d → %s: слайдов %d, заметок %d, btnTeacher %d, %.1f КБ'
              % (num, os.path.relpath(out, HERE), n_slides,
                 st.count('class="notes"'), st.count('btnTeacher'),
                 len(st.encode()) / 1024))


if __name__ == '__main__':
    main()
