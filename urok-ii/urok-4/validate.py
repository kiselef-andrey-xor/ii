# -*- coding: utf-8 -*-
"""Валидация урока 4 (fine-tuning: LoRA, датасеты, Unsloth): структура, теги, тест, автономность."""
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
nprac = 0
for st in stages:
    ids = [sid for sid, s2, r in slides if s2 == st]
    prac = [sid for sid, s2, r in slides if s2 == st and 'data-practice="1"' in r]
    nprac += len(prac)
    print('  %-26s %2d слайдов (%s–%s), практических: %d' % (st, len(ids), ids[0], ids[-1], len(prac)))

# 3. таймингов и домашки быть не должно
if 'data-plan' in src: errors.append('найден data-plan (тайминг)')
if 'tbadge' in src: errors.append('найден класс tbadge')
if re.search(r'id="(timer|btnTimer|btnReset)"', src): errors.append('найден таймер')
if '⏱' in src: errors.append('найден значок тайминга')
for word in ['Домашнее задание', 'домашнее задание', 'задать на дом', 'Уровень 1 · базовый']:
    if word in src: errors.append('упоминание домашнего задания: %r' % word)

# 4. обязательные элементы для JS
for need in ['stage', 'stagechip', 'btnPractice', 'btnTeacher', 'btnOv', 'prog', 'prev', 'next',
             'counter', 'btnPrint', 'modal', 'modalClose', 'ovlist', 'codeModal', 'codeView',
             'codeSel', 'codeClose', 'score', 'btnScore', 'btnQuizReset']:
    if 'id="%s"' % need not in src:
        errors.append('нет элемента id=%s' % need)

# 5. тест
qblocks = re.findall(r'<div class="q" data-right="(\d+)">(.*?)(?=\n  <div class="q" |\n  <div class="card center)', src, re.S)
print('вопросов в тесте: %d' % len(qblocks))
for right, block in qblocks:
    opts = re.findall(r'<button class="opt">', block)
    if len(opts) != 3: errors.append('тест: %d вариантов вместо 3' % len(opts))
    if not (0 <= int(right) < len(opts)): errors.append('тест: data-right=%s вне диапазона' % right)

print('чек-листов практик: %d' % len(re.findall(r'<div class="task" data-task>', src)))
print('кнопок «копировать»: %d' % len(re.findall(r'class="copy"', src)))
print('заметок преподавателю: %d' % len(re.findall(r'class="notes"', src)))
print('практических слайдов: %d' % nprac)

# 6. посторонние иероглифы
cjk = re.findall(r'[\u4e00-\u9fff\u3040-\u30ff]+', src)
if cjk: errors.append('иероглифы: %s' % cjk[:8])

# 7. автономность
ext = re.findall(r'(?:src|href)\s*=\s*"(?:https?:)?//[^"]+"', src)
if ext: errors.append('внешние ресурсы: %s' % ext[:5])

# 8. ключевые факты урока 2
for must in ['QLoRA', 'LoRA', 'lora_alpha', 'learning_rate', '2e-4', 'dataset.jsonl',
             'instruction', 'output', 'alpaca', 'sharegpt', 'GGUF', 'q4_k_m',
             'save_pretrained_gguf', 'Unsloth', 'rank', 'Epochs', 'Batch Size',
             'переобучение', 'забывание', 'chat template', 'EOS', 'RTX 3060',
             '3,5 ГБ', 'Apache 2.0', 'AGPL', 'Python', '3.11', 'Colab', 'eval loss',
             'maximum_memory_usage', 'print_trainable_parameters', 'SFTTrainer']:
    if must.lower() not in src.lower():
        errors.append('не найдено ожидаемое упоминание: %r' % must)

print()
if errors:
    print('ПРОБЛЕМЫ:')
    for e in errors: print(' -', e)
    sys.exit(1)
print('✓ Всё в порядке: %d слайдов, %d практических, %d вопросов теста. Таймингов и домашки нет, файл автономный.'
      % (len(slides), nprac, len(qblocks)))
