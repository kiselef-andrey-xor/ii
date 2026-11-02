# -*- coding: utf-8 -*-
"""Извлечение банка вопросов урока 1 из test-urok-1.html в banks/u1.json.

Запуск:  python3 extract_u1_bank.py
Формат источника: const BANK = [ {t:"…", q:"…", o:["…"], a:0, e:"…"}, … ];
"""
import io
import json
import os
import re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'test-urok-1.html')
OUT = os.path.join(HERE, 'banks', 'u1.json')

STR = re.compile(r'"((?:[^"\\]|\\.)*)"')

TOPICS = ['Установка', 'Модели', 'Квантование', 'Память', 'Лицензии',
          'Галлюцинации', 'Настройки', 'API', 'Код', 'Безопасность']
COLORS = {'Установка': 'b', 'Модели': 'b', 'Квантование': 'a', 'Память': 'a', 'Лицензии': '',
          'Галлюцинации': 'r', 'Настройки': 'g', 'API': 'g', 'Код': 'g', 'Безопасность': ''}


def unescape(value):
    return (value.replace('\\n', '\n').replace('\\t', '\t')
                 .replace('\\"', '"').replace("\\'", "'").replace('\\\\', '\\'))


def parse(src):
    start = src.index('const BANK = [')
    end = src.index('\n];', start)
    block = src[start + len('const BANK = ['):end]
    chunks = re.findall(r'^\{t:(.*?)(?=^\{t:|\Z)', block, re.S | re.M)
    questions = []
    for chunk in chunks:
        fields = []
        rest = chunk
        for _ in range(2):                       # t и q
            m = STR.search(rest)
            fields.append(unescape(m.group(1)))
            rest = rest[m.end():]
        m = re.search(r'o:\[(.*?)\]', rest, re.S)
        opts = [unescape(x) for x in STR.findall(m.group(1))]
        tail = rest[m.end():]
        answer = int(re.search(r'a:(\d+)', tail).group(1))
        expl = unescape(STR.search(tail[tail.index('e:'):]).group(1))
        questions.append({'t': fields[0], 'q': fields[1], 'o': opts, 'a': answer, 'e': expl})
    return questions


def main():
    src = io.open(SRC, encoding='utf-8').read()
    questions = parse(src)
    for item in questions:
        assert item['t'] in TOPICS, item['t']
        assert 2 <= len(item['o']) <= 6, item['q']
        assert 0 <= item['a'] < len(item['o']), item['q']
        assert item['q'] and item['e'], item
    bank = {
        'lesson': 'u1',
        'title': 'Урок 1 · модель говорит',
        'subtitle': 'Запуск, API и первый бот',
        'prefix': 'U1',
        'default_count': 15,
        'topics': TOPICS,
        'colors': COLORS,
        'questions': questions,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(bank, fh, ensure_ascii=False, indent=1)
    counts = Counter(item['t'] for item in questions)
    print('u1: %d вопросов, %d тем -> %s' % (len(questions), len(TOPICS), OUT))
    print('   ', ', '.join('%s=%d' % (t, counts[t]) for t in TOPICS))


if __name__ == '__main__':
    main()
