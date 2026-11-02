# -*- coding: utf-8 -*-
"""Сверка формулы mix() / ключа хранилища между PHP и JavaScript.

Ключ прогресса ('k<uid>|x' + mix('<keyword>|<slides>')) считают три стороны:
  • _study_mode.js внутри файла урока (пишет прогресс);
  • мост портала, встроенный сборщиком (читает/восстанавливает);
  • portal/lib/portal.php на сервере (для диагностики и совместимости).

Если хоть одна реализация разойдётся — портал перестанет видеть прогресс ученика.
Особенность: JavaScript умножает в double и теряет точность выше 2^53,
поэтому PHP обязан повторять именно это поведение (см. kurs_mix).

Запуск: python3 tests/test_mix_compat.py   (нужны node и php)
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CASES = [
    ('speak', 107, 42),
    ('speak', 107, 1),
    ('tools', 27, 7),
    ('rag', 19, 3),
    ('tune', 20, 25),
    ('final', 13, 99),
    ('course', 107, 12345),
    ('x', 1, 1),
    ('longkeywordvalue', 999, 4294967295 % 100000),
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
        print('  ✗ %s  %s' % (name, extra))


def js_mix_all():
    script = """
function mix(str){
  var h1 = 0x811c9dc5, h2 = 0x1000193;
  for (var i = 0; i < str.length; i++){
    h1 = (h1 ^ str.charCodeAt(i)) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + str.charCodeAt(i) * (i + 7)) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}
const cases = %s;
const out = cases.map(c => ({ key: 'k' + c[2] + '|x' + mix(c[0] + '|' + c[1]),
                              mix: 'x' + mix(c[0] + '|' + c[1]) }));
process.stdout.write(JSON.stringify(out));
""" % json.dumps([[c[0], c[1], c[2]] for c in CASES])
    tmp = os.path.join(HERE, '_mix.js')
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(script)
    try:
        out = subprocess.run(['node', tmp], stdout=subprocess.PIPE, check=True).stdout.decode()
    finally:
        os.remove(tmp)
    return json.loads(out)


def php_mix_all():
    out = []
    for kw, slides, uid in CASES:
        res = subprocess.run(['php', os.path.join(HERE, 'key_ref.php'), kw, str(slides), str(uid)],
                             stdout=subprocess.PIPE, check=True).stdout.decode().strip()
        out.append({'key': res})
    return out


def php_mix_from_file(dist_file):
    """Достаём keyword из собранного файла курса и сверяем ключ для него."""
    with open(dist_file, encoding='utf-8') as fh:
        html = fh.read()
    import re
    m = re.search(r"var KEY = '([a-zA-Z0-9_\-]+)'", html)
    n = html.count('<section class="slide"')
    if not m:
        return None
    res = subprocess.run(['php', os.path.join(HERE, 'key_ref.php'), m.group(1), str(n), '1'],
                         stdout=subprocess.PIPE, check=True).stdout.decode().strip()
    return m.group(1), n, res


def main():
    print('Совместимость ключа хранилища: PHP ↔ JavaScript')
    js = js_mix_all()
    php = php_mix_all()
    check('JavaScript отработал', len(js) == len(CASES))
    check('PHP отработал', len(php) == len(CASES))
    for i, (kw, slides, uid) in enumerate(CASES):
        check('ключ совпадает: %s|%s uid=%s' % (kw, slides, uid),
              js[i]['key'] == php[i]['key'], '%s != %s' % (js[i]['key'], php[i]['key']))

    dist = os.path.join(ROOT, 'dist', 'kurs-web', 'kursy')
    if os.path.isdir(dist):
        print('\nКлючи для собранных файлов курса:')
        for root, dirs, files in os.walk(dist):
            for f in sorted(files):
                if not f.endswith('.html'):
                    continue
                path = os.path.join(root, f)
                got = php_mix_from_file(path)
                if not got:
                    continue
                kw, n, key = got
                rel = os.path.relpath(path, dist)
                check('%s (%s, %d слайдов) -> %s' % (rel, kw, n, key), key.startswith('k1|x'))
    else:
        print('\n~ dist не собран — проверка файлов курса пропущена (python3 build_portal.py)')

    print('\n' + '=' * 58)
    print('Пройдено: %d, ошибок: %d' % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
