# -*- coding: utf-8 -*-
"""Сборка преподавательского файла курса (4 урока в одном) + подготовка источников для ученических версий.

Что делает:
  1. Собирает prepod.html — все слайды уроков 1–4, заметки преподавателю включены,
     уникальные id слайдов, этапы с префиксом урока, разделители между уроками.
  2. Кладёт в urok-N/_source.html «чистый» файл урока: без слайда «Методическая памятка»
     (он уходит только в преподавательский файл). Из него потом генерируется ученическая версия.
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LESSONS = [
    (1, os.path.join(HERE, 'index.html')),
    (2, os.path.join(HERE, 'urok-2', 'index.html')),
    (3, os.path.join(HERE, 'urok-3', 'index.html')),
    (4, os.path.join(HERE, 'urok-4', 'index.html')),
]
TITLES = {
    1: 'Урок 1 · Локальный ИИ своими руками',
    2: 'Урок 2 · Агенты и инструменты (MCP)',
    3: 'Урок 3 · Память и знания: RAG и эмбеддинги',
    4: 'Урок 4 · Дообучение своей модели: LoRA и Unsloth',
}
SUBTITLE = {
    1: 'Модель <b>говорит</b>: установка, квантование, настройки, галлюцинации, API-сервер',
    2: 'Модель <b>действует</b>: tool calling, MCP, свой сервер, свой агент, безопасность',
    3: 'Модель <b>знает</b>: эмбеддинги, нарезка, RAG на чистом Python, долгая память',
    4: 'Модель <b>становится своей</b>: LoRA/QLoRA, датасеты, тренировка, экспорт в GGUF',
}


COURSE_NAV = """
<section class="slide" id="l0nav" data-stage="Курс" data-keep="1">
  <div class="pbadge t">Преподавательский файл · всё в одном</div>
  <h1>Курс «Локальный ИИ своими руками»</h1>
  <p class="lead">Четыре урока, 102 слайда, 48 практик и финальный проект на зачёт. Всё железо — обычный учебный класс: 16 ГБ ОЗУ и RTX 3060 с 8 ГБ видеопамяти. Домашних заданий нет: каждая практика делается в классе.</p>

  <table>
    <tr><th>Урок</th><th>Тема</th><th>Слайдов</th><th>Практик</th><th>Главный результат</th></tr>
    <tr><td><b>1</b></td><td>Модель <b>говорит</b></td><td>36</td><td>15</td><td>Запустили Gemma 4 E4B, подняли API-сервер, написали бота, сайт и Telegram-бота</td></tr>
    <tr><td><b>2</b></td><td>Модель <b>действует</b></td><td>27</td><td>14</td><td>Инструменты, свой MCP-сервер, свой агент, защита от инъекций</td></tr>
    <tr><td><b>3</b></td><td>Модель <b>знает</b></td><td>19</td><td>10</td><td>Эмбеддинги, RAG на чистом Python, своя база знаний, долгая память</td></tr>
    <tr><td><b>4</b></td><td>Модель <b>своя</b></td><td>20</td><td>9</td><td>Датасет, QLoRA-тренировка в Unsloth, экспорт в GGUF, замеры «до/после»</td></tr>
    <tr><td><b>Финал</b></td><td>Проект на зачёт</td><td>13</td><td>3 чек-листа</td><td>6 команд по 4 человека: своя локальная ИИ-система, защита, рубрика на 100 баллов</td></tr>
  </table>

  <div class="grid g2">
    <div class="card acc"><h4>Как пользоваться этим файлом</h4>
      <ul class="small">
        <li><kbd>T</kbd> — заметки преподавателю: что показывать, где класс застревает, что сократить</li>
        <li><kbd>O</kbd> — содержание всех четырёх уроков с переходом по слайдам</li>
        <li><kbd>F</kbd> — режим «только практика»: остаются 44 практических слайда с чек-листами</li>
        <li><kbd>🖨</kbd> — печать в PDF (вместе с заметками, если они включены)</li>
        <li>Между уроками стоят слайды-разделители с номером урока</li>
      </ul></div>
    <div class="card grn"><h4>Что раздавать ученикам</h4>
      <ul class="small">
        <li><code>urok-N/index-bez-zametok.html</code> — по одному файлу на урок</li>
        <li><code>final/index-bez-zametok.html</code> — задание финального проекта</li>
        <li>В них нет ни заметок, ни методичек</li>
        <li>Включён <b>режим обязательного прохождения</b>: слайды открываются по порядку, тест сдаётся только на все верные ответы</li>
        <li>Прогресс сохраняется в браузере: можно закрыть файл и продолжить</li>
      </ul></div>
  </div>

  <div class="note amber"><b>Порядок прохождения курса.</b> Уроки 1 и 2 обязательны и идут подряд. Урок 3 (RAG) нужен для финального проекта — без него команды не соберут базу знаний. Урок 4 (fine-tuning) самый тяжёлый технически: его можно дать обзорно, а в проекте засчитать как бонус. Финальный проект рассчитан на три занятия.</div>

  <div class="note cyn"><b>Сквозная линия курса:</b> на уроке 1 дети ловят модель на выдумке про цвета iPhone 17 Pro Max. На уроке 2 дают ей поиск в интернете — и она отвечает верно. На уроке 3 строят базу знаний, чтобы отвечать по своим документам. На уроке 4 обучают собственную модель. В финальном проекте всё это собирается в одну систему, которая на защите работает <b>с выключенным интернетом</b>.</div>

  <div class="notes">
    <h5>Преподавателю</h5>
    <ul>
      <li>Этот файл — ваш рабочий инструмент на весь курс. Ученикам выдаются отдельные файлы из папок уроков.</li>
      <li>Пересобрать всё после правок: <code>python3 build_teacher.py</code> (этот файл) и <code>python3 build_students.py</code> (ученические).</li>
      <li>Проверка сборки: <code>node test_any.js prepod.html</code> и <code>python3 urok-N/validate.py</code>.</li>
      <li>Если ученики работают за общими машинами, напоминайте им про кнопку <b>«↺ Прогресс»</b> внизу: она сбрасывает пройденное перед следующим учеником.</li>
    </ul>
  </div>
</section>
"""

SLIDE_RE = re.compile(r'<section class="slide"[^>]*>.*?</section>', re.S)


def read(path):
    return io.open(path, encoding='utf-8').read()


def slide_title(block):
    m = re.search(r'<h[12][^>]*>(.*?)</h[12]>', block, re.S)
    if not m:
        return 'Слайд'
    return re.sub(r'<[^>]+>', '', m.group(1)).strip()


def is_metodichka(block):
    return 'Методическая памятка' in block


def divider(num):
    """Слайд-разделитель между уроками (в начало урока — заголовок)."""
    return (
        '<section class="slide" id="l%dd" data-stage="Урок %d" data-keep="1">\n'
        '  <div class="divider-slide">\n'
        '    <div class="num">0%d</div>\n'
        '    <div class="kicker">Курс «Локальный ИИ своими руками»</div>\n'
        '    <h2>%s</h2>\n'
        '    <p class="lead">%s</p>\n'
        '    <div class="note amb"><b>Это преподавательский файл всего курса.</b> '
        'Заметки включаются клавишей <kbd>T</kbd>, содержание — <kbd>O</kbd>, '
        'режим «только практика» — <kbd>F</kbd>. Ученикам выдаются отдельные файлы '
        '<code>urok-N/index-bez-zametok.html</code>: в них нет ни заметок, ни методички, '
        'и включён режим обязательного прохождения.</div>\n'
        '  </div>\n'
        '</section>\n'
    ) % (num, num, num, TITLES[num], SUBTITLE[num])


def main():
    heads, tails, slides_by_lesson, sources = {}, {}, {}, {}

    for num, path in LESSONS:
        if not os.path.exists(path):
            sys.exit('нет файла урока %d: %s' % (num, path))
        s = read(path)
        m = re.search(r'<main class="stage" id="stage">(.*?)</main>', s, re.S)
        if not m:
            sys.exit('не найден <main> в уроке %d' % num)
        blocks = SLIDE_RE.findall(m.group(1))
        kept = [b for b in blocks if not is_metodichka(b)]
        removed = len(blocks) - len(kept)
        slides_by_lesson[num] = kept
        sources[num] = (s, m, blocks, kept, removed)
        if num == 1:
            heads[num] = s[:m.start(1)]
            tails[num] = s[m.end(1):]
        print('урок %d: слайдов %d, методичек удалено %d' % (num, len(blocks), removed))

    # ---- 1. чистые источники для ученических файлов (без методички) ----
    for num, (s, m, blocks, kept, removed) in sources.items():
        body = '\n\n'.join(kept)
        out = s[:m.start(1)] + '\n\n' + body + '\n\n' + s[m.end(1):]
        d = os.path.dirname(LESSONS[num - 1][1])
        io.open(os.path.join(d, '_source.html'), 'w', encoding='utf-8').write(out)
        print('  → %s' % os.path.join(os.path.relpath(d, HERE), '_source.html'))

    # ---- 2. общий преподавательский файл ----
    head = heads[1]
    tail = tails[1]

    head = head.replace(
        '<title>Локальный ИИ своими руками — практический курс (Gemma 4 E4B + LM Studio)</title>',
        '<title>Курс «Локальный ИИ своими руками» — преподавательский файл (4 урока)</title>')
    head = head.replace('<span>Локальный ИИ <small>· практический курс</small></span>',
                        '<span>Курс локального ИИ <small>· 4 урока · преподавателю</small></span>')
    head = head.replace('<div class="stagechip" id="stagechip">Введение</div>',
                        '<div class="stagechip" id="stagechip">Курс</div>')
    head = head.replace('body{background:var(--bg);', 'body{background:var(--bg);', 1)

    parts = [COURSE_NAV.strip()]
    total = 0
    for num, _ in LESSONS:
        parts.append(divider(num))
        for i, b in enumerate(slides_by_lesson[num], 1):
            b = b.replace('id="s%d"' % i, 'id="l%ds%d"' % (num, i), 1)
            b = re.sub(r'data-stage="([^"]+)"',
                       lambda mm: 'data-stage="Урок %d · %s"' % (num, mm.group(1)), b, count=1)
            parts.append(b)
            total += 1
        parts.append('')

    merged = head + '\n\n' + '\n\n'.join(parts) + tail
    merged = merged.replace('<div class="counter" id="counter">1 / 37</div>',
                            '<div class="counter" id="counter">1 / %d</div>' % (total + len(LESSONS)))

    # курсовая навигация в содержании: подписи уроков уже в data-stage, дополнительно — подсказка
    merged = merged.replace(
        '<h2 style="margin:0;font-size:26px">Содержание курса</h2>',
        '<h2 style="margin:0;font-size:26px">Содержание курса · 4 урока</h2>')

    io.open(os.path.join(HERE, 'prepod.html'), 'w', encoding='utf-8').write(merged)
    print('\nprepod.html: слайдов %d (1 навигация + %d разделителя + %d слайдов уроков), %.1f КБ'
          % (total + len(LESSONS) + 1, len(LESSONS), total, len(merged.encode()) / 1024))


if __name__ == '__main__':
    main()
