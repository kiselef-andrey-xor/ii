# -*- coding: utf-8 -*-
"""Проверка совместимости кода результата между тремя реализациями.

Один и тот же код считается:
  • в JavaScript — тем самым кодом, который лежит в test-urok-1.html и portal/test.js
    (функции извлекаются из файла и выполняются в node);
  • в PHP — portal/lib/quiz.php (сервер разбирает коды учеников в кабинете);
  • в Python — эталонная реализация внутри этого файла.

Если хоть один символ не совпадёт, преподаватель не сможет внести коды,
присланные учениками из автономного теста.

Запуск:  python3 tests/test_code_compat.py
Нужны: node и php в PATH.
"""
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CASES = [
    ('U1', 'СИДОРОВ IVAN', '10Б', '2611011104', 50291, 15, 15, 187, 'z' * 10, 'lg22'),
    ('U1', 'ИВАНОВА ANNA', '10Б', '2611011104', 50291, 15, 15, 187, 'e7e7e7l777', 'lg22'),
    ('U2', 'ПЕТРОВ OLEG', '11А', '2611011104', 12345, 13, 15, 600, 'abcdefghijkl', 'ab12'),
    ('U3', 'ЁЛКИНА ANNA', '9В', '2611011104', 99999, 15, 15, 60, 'z' * 8, 'zz99'),
    ('U4', 'A', 'B', '2611011104', 1, 0, 1, 0, 'z' * 9, '0000'),
    ('U1', 'ФЕДОРОВА-ПЕТРОВСКАЯ МАРИЯ АЛЕКСАНДРОВНА', '10 БУКВА «Б»', '2611011104',
     99999, 7, 15, 1234, 'z5z5z5z5z5', 'x1y2'),
]

PASS = 0
FAIL = 0


def check(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  ✓ %s' % name)
    else:
        FAIL += 1
        print('  ✗ %s %s' % (name, extra))


# --- Python-эталон ----------------------------------------------------------

def py_b36(s):
    def base36(n):
        d = '0123456789abcdefghijklmnopqrstuvwxyz'
        if n == 0:
            return '0'
        out = ''
        while n:
            out = d[n % 36] + out
            n //= 36
        return out
    return ''.join(base36(ord(c)) for c in s)


def py_crc(s):
    def base36(n):
        d = '0123456789abcdefghijklmnopqrstuvwxyz'
        if n == 0:
            return '0'
        out = ''
        while n:
            out = d[n % 36] + out
            n //= 36
        return out
    h = 5381
    for ch in s:
        h = ((h * 33) + ord(ch)) & 0xFFFFFFFF
    return base36(h % 1296).rjust(2, '0')


def py_code(case):
    body = '|'.join([case[0], case[1], case[2], case[3], str(case[4]), str(case[5]),
                     str(case[6]), str(case[7]), case[8], case[9]])
    return body + '|' + py_crc(py_b36(body))


# --- JavaScript: берём настоящие функции из test-urok-1.html ----------------

def js_codes():
    src = io.open(os.path.join(ROOT, 'test-urok-1.html'), encoding='utf-8').read()
    funcs = {}
    for name in ('b36', 'crc'):
        m = re.search(r'function %s\([^)]*\)\{.*?\n\}' % name, src, re.S)
        if not m:
            m = re.search(r'function %s\([^)]*\)\s*\{.*?\n\}' % name, src, re.S)
        if not m:
            raise SystemExit('Не удалось извлечь функцию %s из test-urok-1.html' % name)
        funcs[name] = m.group(0)
    script = '\n'.join(funcs.values()) + '\n' + """
const cases = %s;
const out = cases.map(c => {
  const body = [c[0], c[1], c[2], c[3], String(c[4]), String(c[5]), String(c[6]),
                String(c[7]), c[8], c[9]].join('|');
  return { body: body, b36: b36(body), crc: crc(b36(body)), code: body + '|' + crc(b36(body)) };
});
process.stdout.write(JSON.stringify(out));
""" % json.dumps([[c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9]] for c in CASES],
                 ensure_ascii=False)
    tmp = os.path.join(HERE, '_crc_case.js')
    with io.open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(script)
    res = subprocess.run(['node', tmp], stdout=subprocess.PIPE, check=True)
    os.remove(tmp)
    return json.loads(res.stdout.decode('utf-8'))


def php_codes():
    bodies = ['|'.join([c[0], c[1], c[2], c[3], str(c[4]), str(c[5]), str(c[6]), str(c[7]),
                        c[8], c[9]]) for c in CASES]
    out = subprocess.run(['php', os.path.join(HERE, 'crc_ref.php')],
                         input=json.dumps(bodies, ensure_ascii=False).encode('utf-8'),
                         stdout=subprocess.PIPE, check=True).stdout.decode('utf-8')
    return json.loads(out)


def main():
    print('Совместимость кода результата: JavaScript ↔ PHP ↔ Python')
    js = js_codes()
    php = php_codes()
    check('JavaScript-реализация найдена и отработала', len(js) == len(CASES), str(len(js)))
    check('PHP-реализация отработала', len(php) == len(CASES), str(len(php)))

    for i, case in enumerate(CASES):
        py = py_code(case)
        j = js[i]['code']
        p = php[i]['code']
        name = '%s %s' % (case[0], case[1][:18])
        check('JS == Python  (%s)' % name, j == py, '%s != %s' % (j, py))
        check('PHP == Python (%s)' % name, p == py, '%s != %s' % (p, py))
        check('тело кода совпадает (%s)' % name, php[i]['body'] == '|'.join(
            [case[0], case[1], case[2], case[3], str(case[4]), str(case[5]),
             str(case[6]), str(case[7]), case[8], case[9]]))
        check('b36 совпадает (%s)' % name, js[i]['b36'] == php[i]['b36'],
              '%s... != %s...' % (js[i]['b36'][:30], php[i]['b36'][:30]))

    # PHP должен принимать код, который выдал JS
    print('\nPHP разбирает код, собранный в JavaScript:')
    src = '''<?php
require dirname(__DIR__) . '/portal/lib/quiz.php';
$codes = json_decode(file_get_contents('php://stdin'), true);
$out = [];
foreach ($codes as $c) {
  $r = kurs_parse_code($c);
  $out[] = ['bad' => !empty($r['bad']), 'reason' => $r['reason'] ?? '',
            'name' => $r['name'] ?? '', 'right' => $r['right'] ?? -1,
            'total' => $r['total'] ?? -1, 'lesson' => $r['lesson'] ?? '',
            'weak' => $r['weak'] ?? [], 'topics' => count($r['per_topic'] ?? [])];
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
'''
    tmp = os.path.join(HERE, '_parse_case.php')
    with io.open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(src)
    res = subprocess.run(['php', tmp], input=json.dumps([x['code'] for x in js]).encode('utf-8'),
                         stdout=subprocess.PIPE, check=True)
    os.remove(tmp)
    parsed = json.loads(res.stdout.decode('utf-8'))
    for i, case in enumerate(CASES):
        r = parsed[i]
        check('код %s принят сервером' % case[0], r['bad'] is False, str(r))
        if r['bad']:
            continue
        # parse_code возвращает имя как в коде (Ё сохраняется), нормализация делается при создании кода
        want = case[1].upper()
        check('  имя прочитано', r['name'] == want, '%s != %s' % (r['name'], want))
        check('  баллы прочитаны', r['right'] == case[5] and r['total'] == case[6],
              '%s/%s' % (r['right'], r['total']))
        check('  урок определён', r['lesson'] == case[0].lower(), r['lesson'])

    # подделка должна отклоняться
    print('\nПодделка балла отклоняется:')
    fake = js[0]['code'].split('|')
    fake[5] = str(int(fake[5]) + 1)
    fake = '|'.join(fake)
    tmp = os.path.join(HERE, '_fake_case.php')
    with io.open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(src)
    res = subprocess.run(['php', tmp], input=json.dumps([fake]).encode('utf-8'),
                         stdout=subprocess.PIPE, check=True)
    os.remove(tmp)
    r = json.loads(res.stdout.decode('utf-8'))[0]
    check('изменённый балл не прошёл', r['bad'] is True, str(r))
    check('причина указана', 'повреждён' in r['reason'] or 'изменён' in r['reason'], r['reason'])

    print('\n' + '=' * 58)
    print('Пройдено: %d, ошибок: %d' % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
