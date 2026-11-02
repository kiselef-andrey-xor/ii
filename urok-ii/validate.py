# -*- coding: utf-8 -*-
"""Валидация курса: структура, теги, тест, отсутствие таймингов и внешних ресурсов."""
import io, os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
src = io.open(os.path.join(here, 'index.html'), encoding='utf-8').read()
errors = []

# 1. баланс тегов
for tag in ['html', 'head', 'body', 'style', 'script', 'main', 'section', 'div', 'pre',
            'code', 'button', 'span', 'p', 'table', 'tr', 'td', 'th', 'ul', 'ol', 'li',
            'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'b', 'i', 'a']:
    o = len(re.findall(r'<%s[\s>]' % tag, src))
    c = len(re.findall(r'</%s>' % tag, src))
    if o != c:
        errors.append('тег <%s>: открыто=%d закрыто=%d' % (tag, o, c))

# 2. слайды и блоки
slides = re.findall(r'<section class="slide" id="(s\d+)" data-stage="([^"]+)"([^>]*)>', src)
print('слайдов: %d' % len(slides))
stages = []
for sid, st, rest in slides:
    if st not in stages:
        stages.append(st)
for st in stages:
    ids = [sid for sid, s2, r in slides if s2 == st]
    prac = [sid for sid, s2, r in slides if s2 == st and 'data-practice="1"' in r]
    print('  %-30s %2d слайдов (%s), практик: %d' % (st, len(ids), ids[0] + '-' + ids[-1], len(prac)))

# 3. тайминги убраны
if 'data-plan' in src: errors.append('остался data-plan')
if 'tbadge' in src: errors.append('остался класс tbadge')
if re.search(r'id="(timer|btnTimer|btnReset)"', src): errors.append('остался таймер')
if re.search(r'⏱', src): errors.append('остался значок тайминга ⏱')
if re.search(r'<span class="t">', src): errors.append('остались тайм-коды в заметках')

# 4. домашки нет
for word in ['Домашнее задание', 'домашнее задание', 'Уровень 1 · базовый', 'в домашку:', 'задать на дом']:
    if word in src:
        errors.append('найдено упоминание домашнего задания: %r' % word)

# 5. обязательные id для JS
for need in ['stage', 'stagechip', 'btnPractice', 'btnTeacher', 'btnOv', 'prog', 'prev', 'next',
             'counter', 'btnPrint', 'modal', 'modalClose', 'ovlist', 'codeModal', 'codeView',
             'codeSel', 'codeClose', 'score', 'btnScore', 'btnQuizReset']:
    if 'id="%s"' % need not in src:
        errors.append('нет элемента id=%s' % need)

# 6. тест
qblocks = re.findall(r'<div class="q" data-right="(\d+)">(.*?)(?=\n  <div class="q" |\n  <div class="card center)', src, re.S)
print('вопросов в тесте: %d' % len(qblocks))
for right, block in qblocks:
    opts = re.findall(r'<button class="opt">', block)
    if len(opts) != 3:
        errors.append('тест: в вопросе %d вариантов вместо 3' % len(opts))
    if not (0 <= int(right) < len(opts)):
        errors.append('тест: data-right=%s вне диапазона' % right)

# 7. чек-листы практик
print('чек-листов практик: %d' % len(re.findall(r'<div class="task" data-task>', src)))
print('кнопок «копировать»: %d' % len(re.findall(r'class="copy"', src)))
print('заметок преподавателю: %d' % len(re.findall(r'class="notes"', src)))
print('слайдов с data-practice: %d' % len([1 for _, _, r in slides if 'data-practice="1"' in r]))

# 8. посторонние иероглифы
cjk = re.findall(r'[\u4e00-\u9fff\u3040-\u30ff]+', src)
if cjk:
    errors.append('встречаются иероглифы: %s' % cjk[:8])

# 9. автономность
ext = re.findall(r'(?:src|href)\s*=\s*"(?:https?:)?//[^"]+"', src)
if ext:
    errors.append('внешние ресурсы: %s' % ext[:5])

# 10. ключевые факты на месте
for must in ['gemma-4-E4B-it-Q4_K_M', '5,34 ГБ', 'mmproj', 'http://localhost:1234/v1',
             'provider: lmstudio', 'RTX 3060', 'Apache 2.0', 'pytelegrambotapi', 'CORS',
             'lms ls', 'infinity_polling', 'Start Server']:
    if must not in src:
        errors.append('не найдено ожидаемое упоминание: %r' % must)

print()
if errors:
    print('ПРОБЛЕМЫ:')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('✓ Структура в порядке: %d слайдов, %d практик, таймингов нет, домашки нет, файл автономный.'
      % (len(slides), len([1 for _, _, r in slides if 'data-practice="1"' in r])))
