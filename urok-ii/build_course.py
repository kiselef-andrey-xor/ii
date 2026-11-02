# -*- coding: utf-8 -*-
"""Сборка общего ученического файла курса: уроки 1–4 в одном файле.

Отличия от prepod.html:
  • без заметок преподавателю и без методических памяток;
  • без финального проекта (он лежит отдельно в final/);
  • режим обязательного прохождения БЕЗ ожидания: слайды открываются сразу,
    как только дочитал и отметил чек-лист; тест — по-прежнему только на все верные.

Запуск:  python3 build_course.py
Результат: kurs-uchenik.html
"""
import importlib.util
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


bt = load('build_teacher', os.path.join(HERE, 'build_teacher.py'))
bs = load('build_students', os.path.join(HERE, 'build_students.py'))

OUT = os.path.join(HERE, 'kurs-uchenik.html')

COURSE_NAV = """
<section class="slide" id="l0nav" data-stage="Курс" data-keep="1">
  <div class="pbadge t">Ученический файл · 4 урока в одном · 48 практик</div>
  <h1>Курс «Локальный ИИ<br>своими руками»</h1>
  <p class="lead">Четыре урока и 48 практик. Всё делается в классе на вашем компьютере:
  16 ГБ памяти и видеокарта RTX 3060. Домашних заданий нет.</p>

  <table>
    <tr><th>Урок</th><th>Тема</th><th>Слайдов</th><th>Практик</th><th>Что соберёте своими руками</th></tr>
    <tr><td><b>1</b></td><td>Модель <b>говорит</b></td><td>36</td><td>15</td>
        <td>Запустите Gemma 4 E4B на видеокарте, поднимете API-сервер, напишете бота, сайт и Telegram-бота</td></tr>
    <tr><td><b>2</b></td><td>Модель <b>действует</b></td><td>27</td><td>14</td>
        <td>Дадите модели инструменты, напишете свой MCP-сервер, соберёте агента и попробуете его взломать</td></tr>
    <tr><td><b>3</b></td><td>Модель <b>знает</b></td><td>19</td><td>10</td>
        <td>Соберёте базу знаний по своим документам: эмбеддинги, поиск по смыслу, бот с долгой памятью</td></tr>
    <tr><td><b>4</b></td><td>Модель <b>своя</b></td><td>20</td><td>9</td>
        <td>Сделаете датасет, обучите собственную модель в Unsloth и запустите её в LM Studio</td></tr>
  </table>

  <div class="grid g2">
    <div class="card acc"><h4>Как устроено прохождение</h4>
      <ul class="small">
        <li>Слайды открываются <b>строго по порядку</b>: вперёд не перемотать ни клавишами, ни мышью, ни по оглавлению</li>
        <li>На слайде с практикой нужно отметить <b>все пункты чек-листа</b> — только тогда откроется следующий</li>
        <li><b>Тест в конце каждого урока обязателен:</b> объяснения и следующий слайд откроются, когда все 8 ответов верны</li>
        <li>Ожидания по времени нет: дочитали, отметили — идёте дальше</li>
        <li>Прогресс сохраняется: файл можно закрыть и продолжить с того же места</li>
        <li>Кнопка <b>«↺ Прогресс»</b> внизу сбрасывает пройденное — нажимайте, если за компьютер садится другой ученик</li>
      </ul></div>
    <div class="card grn"><h4>Управление</h4>
      <ul class="small">
        <li><kbd>←</kbd> <kbd>→</kbd>, пробел или кнопки внизу — листать</li>
        <li><kbd>O</kbd> или <kbd>☰</kbd> — содержание: закрытые слайды помечены 🔒</li>
        <li><kbd>F</kbd> — режим «только практика»: остаются слайды с чек-листами</li>
        <li><kbd>🖨</kbd> — печать или сохранение в PDF</li>
        <li>Двойной клик по блоку кода — открыть его крупно, удобно переписывать с проектора</li>
        <li>Кнопка «копировать» в углу блока кода — скопировать фрагмент</li>
      </ul></div>
  </div>

  <div class="note cyn"><b>Сквозная линия курса.</b> На первом уроке вы поймаете модель на выдумке: она confidently расскажет про то, чего не знает. На втором — дадите ей поиск в интернете, и она начнёт отвечать верно. На третьем — построите базу знаний, чтобы она отвечала по вашим документам. На четвёртом — обучите собственную модель. А потом всё это соберётся в финальный проект, который на защите работает <b>с выключенным интернетом</b>.</div>

  <div class="note amber"><b>Что понадобится на первом уроке:</b> установленный LM Studio, скачанная модель <b>Gemma 4 E4B Q4_K_M</b> (5,34 ГБ) и файл <code>mmproj</code> для работы с картинками (992 МБ), 25 ГБ свободного места на диске. Python и VS Code — к третьему и четвёртому урокам. Подробный чек-лист — на втором слайде.</div>
</section>
"""


def divider(num):
    """Разделитель между уроками — без преподавательских пояснений."""
    return (
        '<section class="slide" id="l%dd" data-stage="Урок %d" data-keep="1">\n'
        '  <div class="divider-slide">\n'
        '    <div class="num">0%d</div>\n'
        '    <div class="kicker">Курс «Локальный ИИ своими руками»</div>\n'
        '    <h2>%s</h2>\n'
        '    <p class="lead">%s</p>\n'
        '    <div class="note cyan"><b>Слайды открываются по порядку.</b> На слайдах с практикой '
        'нужно отметить все пункты чек-листа, а тест в конце урока сдаётся только на все верные ответы. '
        'Прогресс сохраняется — файл можно закрыть и продолжить.</div>\n'
        '  </div>\n'
        '</section>\n'
    ) % (num, num, num, bt.TITLES[num], bt.SUBTITLE[num])


def main():
    if not all(os.path.exists(p) for _, p in bt.LESSONS):
        sys.exit('нет исходников уроков — сначала запустите build_teacher.py')

    head = tails = None
    parts = [COURSE_NAV.strip()]
    total = 0

    for num, path in bt.LESSONS:
        s = io.open(path, encoding='utf-8').read()
        m = re.search(r'<main class="stage" id="stage">(.*?)</main>', s, re.S)
        if not m:
            sys.exit('не найден <main> в уроке %d' % num)
        blocks = [b for b in bt.SLIDE_RE.findall(m.group(1)) if not bt.is_metodichka(b)]

        if num == 1:
            head = s[:m.start(1)]
            tails = s[m.end(1):]

        parts.append(divider(num))
        for i, b in enumerate(blocks, 1):
            b = b.replace('id="s%d"' % i, 'id="l%ds%d"' % (num, i), 1)
            b = re.sub(r'data-stage="([^"]+)"',
                       lambda mm: 'data-stage="Урок %d · %s"' % (num, mm.group(1)), b, count=1)
            parts.append(b)
            total += 1
        print('урок %d: %d слайдов (без методички)' % (num, len(blocks)))

    merged = head + '\n\n' + '\n\n'.join(parts) + tails

    # ---- шапка под ученический файл курса ----
    merged = merged.replace(
        '<title>Локальный ИИ своими руками — практический курс (Gemma 4 E4B + LM Studio)</title>',
        '<title>Курс «Локальный ИИ своими руками» — уроки 1–4 (ученический файл)</title>')
    merged = merged.replace('<span>Локальный ИИ <small>· практический курс</small></span>',
                            '<span>Курс локального ИИ <small>· уроки 1–4</small></span>')
    merged = merged.replace('<div class="stagechip" id="stagechip">Введение</div>',
                            '<div class="stagechip" id="stagechip">Курс</div>')
    merged = re.sub(r'<div class="counter" id="counter">1 / \d+</div>',
                    '<div class="counter" id="counter">1 / %d</div>' % (total + 5), merged, count=1)
    merged = merged.replace('<h2 style="margin:0;font-size:26px">Содержание курса</h2>',
                            '<h2 style="margin:0;font-size:26px">Содержание · уроки 1–4</h2>')

    # ---- убираем заметки и преподавательские элементы ----
    merged, n_notes = bs.strip_notes(merged)
    print('вырезано блоков заметок: %d' % n_notes)
    merged = bs.student_transforms(merged, 1, tag_version=False)

    # ---- режим прохождения: порядок + чек-листы + обязательный тест, без ожидания ----
    merged = bs.gating(merged, 1)
    merged = merged.replace('var KEYWORD   = "speak";', 'var KEYWORD   = "course";')
    merged = merged.replace('<small>· практический курс</small>', '<small>· уроки 1–4</small>')

    io.open(OUT, 'w', encoding='utf-8').write(merged)
    print('\nkurs-uchenik.html: %d слайдов, %.1f КБ' % (merged.count('class="slide"'), len(merged.encode()) / 1024))
    print('заметок: %d | btnTeacher: %d | методичек: %d'
          % (merged.count('class="notes"'), merged.count('btnTeacher'), merged.count('Методическая памятка')))


if __name__ == '__main__':
    main()
