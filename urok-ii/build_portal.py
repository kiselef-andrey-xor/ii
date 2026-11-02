# -*- coding: utf-8 -*-
"""Сборка портала для Synology Web Station.

Запуск:  python3 build_portal.py
Результат:
  dist/kurs-web/    — папка портала (в архиве она называется kurs/)
  dist/kurs-data/   — заготовка каталога данных (для локальных проверок;
                      на NAS установщик создаёт эти файлы сам)
  dist/kurs-portal.zip — ЕДИНЫЙ архив для установки: внутри kurs/ (портал целиком)
                      и ИНСТРУКЦИЯ-УСТАНОВКА.html (только GUI, без SSH)

Что делает:
  1. копирует portal/ (PHP, JS, CSS, банки вопросов) в dist/kurs-web;
  2. копирует готовые файлы курса в dist/kurs-web/kursy и встраивает в ученические
     файлы небольшой мост: восстановление прогресса с сервера и отчёт о прогрессе
     (сами файлы при этом по-прежнему работают офлайн двойным щелчком);
  3. генерирует публичные банки вопросов без правильных ответов — для страницы теста,
     открытой без входа (тренировочный режим);
  4. кладёт заготовку каталога данных с .htaccess и памяткой;
  5. собирает dist/kurs-portal.zip: папка kurs/ + инструкция по установке (GUI-only).
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL = os.path.join(HERE, 'portal')
DIST = os.path.join(HERE, 'dist')
WEB = os.path.join(DIST, 'kurs-web')
DATA = os.path.join(DIST, 'kurs-data')
INSTR_NAME = 'ИНСТРУКЦИЯ-УСТАНОВКА.html'

MARK_BEGIN = '/* === KURS BRIDGE (вставлено build_portal.py) === */'
MARK_END = '/* === /KURS BRIDGE === */'

BRIDGE = r"""
  /* Мост портала: восстановление прогресса с сервера и отчёт о прогрессе.
     Встроен сборщиком, работает только внутри портала (в iframe той же origin).
     Файл по-прежнему можно открыть двойным щелчком — тогда мост просто молчит. */
  (function(){
    try {
      var KEY = '__KEYWORD__';
      var SLIDES = document.querySelectorAll('.slide').length;
      if (!KEY || !SLIDES) { return; }
      var BASE = 'x' + mix(KEY + '|' + SLIDES);
      var uid = 0;
      var lastSent = 0;
      var lastJson = '';

      function skey(id){ return 'k' + id + '|' + BASE; }

      function readState(key){
        if (!store) { return null; }
        try {
          var raw = store.getItem(key);
          if (!raw) { return null; }
          var st = JSON.parse(raw);
          if (!st || typeof st.u !== 'number') { return null; }
          st.v = st.v || {};
          return st;
        } catch(e){ return null; }
      }

      function taskStats(){
        var boxes = document.querySelectorAll('[data-task] input[type=checkbox]');
        var done = 0;
        for (var i = 0; i < boxes.length; i++) { if (boxes[i].checked) { done++; } }
        return { done: done, all: boxes.length };
      }

      function report(force){
        if (!uid || !store) { return; }
        var now = Date.now();
        if (!force && now - lastSent < 2500) { return; }
        var st = readState(skey(uid));
        if (!st) { return; }
        var t = taskStats();
        var keys = [];
        for (var k in st.v) { if (st.v.hasOwnProperty(k)) { keys.push(k); } }
        var payload = {
          t: 'kurs-progress', lesson: LESSON, uid: uid,
          unlocked: st.u | 0, position: st.p | 0, visited: keys,
          tasks_done: t.done, tasks_all: t.all
        };
        var json = JSON.stringify(payload);
        if (!force && json === lastJson) { return; }
        lastJson = json;
        lastSent = now;
        try { window.parent.postMessage(payload, window.location.origin); } catch(e){}
      }

      function restore(uidNew, st){
        if (!st) { return; }
        uid = uidNew;
        var key = skey(uid);
        var v = {};
        var keys = Object.keys(st.v || {}).map(Number).sort(function(a,b){ return a - b; });
        for (var i = 0; i < keys.length; i++) { v[keys[i]] = 1; }
        var u = Math.max(0, Math.min(st.u | 0, SLIDES - 1));
        var p = Math.max(0, Math.min(st.p | 0, u));

        /* 1) записываем состояние в хранилище под ключом этого ученика */
        if (store) {
          try { store.setItem(key, JSON.stringify({ u: u, v: v, p: p, c: sign(u, v, p) })); } catch(e){}
        }
        /* 2) применяем его же в памяти: без перезагрузки страницы ученик сразу
              оказывается на том слайде, где закончил в прошлый раз */
        try {
          unlocked = u;
          visited = v;
          seen = {};
          for (var k2 in v) { if (v.hasOwnProperty(k2)) { seen[k2] = 1; } }
          window.__studyMax = u;
          SKEY = key;
          show(p);
          markOv();
          refresh();
        } catch(e){
          /* не получилось применить на месте — перечитаем страницу:
             штатный код режима прохождения подхватит состояние из хранилища */
          try { history.replaceState(null, '', location.pathname + location.search + '#s' + (p + 1)); } catch(e2){}
          setTimeout(function(){ location.reload(); }, 30);
        }
        report(true);
      }

      /* Портал открывает файл с параметром ?uid=<id ученика>. Без него файл открыт
         сам по себе (двойным щелчком или в отдельной вкладке) — мост не работает,
         и прогресс остаётся в общем ключе, как раньше. */
      var qs = {};
      (location.search || '').replace(/^\?/, '').split('&').forEach(function(pair){
        var kv = pair.split('=');
        if (kv[0]) { qs[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); }
      });
      uid = parseInt(qs.uid, 10) || 0;
      if (!uid) { return; }
      /* У каждого ученика свой ключ: за одним компьютером прогресс не смешивается.
         Общий ключ (без uid) очищаем — иначе на машине останется чужой прогресс
         и следующий ученик сможет его увидеть. Восстановление с сервера идёт ниже. */
      SKEY = skey(uid);
      try { store.removeItem(BASE); } catch(e){}

      /* Портал передаёт сохранённое состояние параметром ?restore=<json>.
         Именно параметром, а не якорем: скрипт навигации урока сам перезаписывает
         location.hash в #s<номер слайда> ещё до того, как дойдёт дело до моста. */
      var restored = false;
      if (qs.restore) {
        try {
          var obj = JSON.parse(qs.restore);
          if (obj && obj.uid && (obj.uid | 0) === uid && obj.state) {
            restore(uid, obj.state);
            restored = true;
          }
        } catch(e){}
      }
      if (!restored) { report(true); }
      setInterval(function(){ report(false); }, 3000);
      document.addEventListener('visibilitychange', function(){ if (document.hidden) { report(true); } });
      window.addEventListener('pagehide', function(){ report(true); });
    } catch(e){ /* мост не должен мешать уроку */ }
  })();
"""


def copy_tree(src, dst, ignore=None):
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=ignore)


def copy_if_exists(src, dst):
    if not os.path.isfile(src):
        print('  ! нет файла: %s' % src)
        return False
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    return True


def inject_bridge(html, lesson_id):
    """Вставляет мост в конец IIFE режима обязательного прохождения."""
    if 'function studyBar(' not in html:
        return html, False, 'нет режима прохождения'
    m = re.search(r'var\s+KEYWORD\s*=\s*"([a-zA-Z0-9_\-]+)"', html)
    if not m:
        return html, False, 'не найдено KEYWORD'
    keyword = m.group(1)
    end = html.rfind('})();')
    if end < 0:
        return html, False, 'не найден конец скрипта'
    code = (MARK_BEGIN + '\n  var LESSON = ' + json.dumps(lesson_id) + ';\n'
            + BRIDGE.replace('__KEYWORD__', keyword) + MARK_END + '\n')
    return html[:end] + code + html[end:], True, keyword


def build_public_banks():
    src = os.path.join(WEB, 'banks')
    dst = os.path.join(WEB, 'banks', 'public')
    os.makedirs(dst, exist_ok=True)
    made = []
    for name in sorted(os.listdir(src)):
        if not name.endswith('.json'):
            continue
        with io.open(os.path.join(src, name), encoding='utf-8') as fh:
            bank = json.load(fh)
        public = {
            'lesson': bank['lesson'],
            'title': bank['title'],
            'subtitle': bank.get('subtitle', ''),
            'prefix': bank.get('prefix', bank['lesson'].upper()),
            'topics': bank['topics'],
            'colors': bank.get('colors', {}),
            'default_count': bank.get('default_count', 15),
            'questions': [{'i': i, 't': q['t'], 'q': q['q'], 'o': q['o'], 'e': q['e']}
                          for i, q in enumerate(bank['questions'])],
        }
        with io.open(os.path.join(dst, name), 'w', encoding='utf-8') as fh:
            json.dump(public, fh, ensure_ascii=False, indent=1)
        made.append((name, len(public['questions'])))
    return made


COURSE_FILES = [
    ('kurs-uchenik.html', 'kursy/kurs-uchenik.html', 'course'),
    ('urok-2/index-bez-zametok.html', 'kursy/urok-2/index-bez-zametok.html', 'u2'),
    ('urok-3/index-bez-zametok.html', 'kursy/urok-3/index-bez-zametok.html', 'u3'),
    ('urok-4/index-bez-zametok.html', 'kursy/urok-4/index-bez-zametok.html', 'u4'),
    ('final/index-bez-zametok.html', 'kursy/final/index-bez-zametok.html', 'final'),
]
PLAIN_FILES = [
    ('prepod.html', 'kursy/prepod.html'),
    ('test-urok-1.html', 'kursy/test-urok-1.html'),
    ('urok-2/index.html', 'kursy/urok-2/index.html'),
    ('urok-3/index.html', 'kursy/urok-3/index.html'),
    ('urok-4/index.html', 'kursy/urok-4/index.html'),
    ('final/index.html', 'kursy/final/index.html'),
]

HTACCESS_DATA = """# Каталог данных портала. Здесь лежит база SQLite и журнал попыток входа.
# Доступ по HTTP закрыт полностью.
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
"""

HTACCESS_KURSY = """# Файлы курса выдаёт course.php после проверки входа.
# Прямой доступ закрыт: иначе ученик сможет открыть версию с заметками преподавателя.
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
"""

HTACCESS_LIB = """# Служебные файлы PHP и банки вопросов с ответами — наружу не отдаём.
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
"""

HTACCESS_ROOT = """# Портал курса «Локальный ИИ своими руками»
DirectoryIndex index.php login.php

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "same-origin"
</IfModule>

# Банки вопросов с ответами (banks/u1..u4.json) наружу не отдаём.
# Публичные банки лежат в banks/public/ и называются так же, поэтому
# закрываем только файлы вне каталога public.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{REQUEST_URI} !/banks/public/
  RewriteRule (^|/)banks/u[1-4]\.json$ - [F,L]
</IfModule>

# Файлы курса отдаёт course.php после проверки входа.
<IfModule mod_rewrite.c>
  RewriteRule ^kursy/ - [F,L]
</IfModule>

<IfModule mod_php.c>
  php_flag display_errors off
</IfModule>
"""

DATA_README = """# Каталог данных портала

Сюда PHP кладёт:

* `kurs.db` — база SQLite: аккаунты (пароли в виде хэшей), прогресс, результаты тестов, журнал аудита;
* `kurs.db-wal`, `kurs.db-shm` — рабочие файлы режима WAL (появляются при работе);
* `ratelimit.json` — счётчик неудачных попыток входа.

## Права (настраиваются мышкой, SSH не нужен)

Папка создаётся через Панель управления → Общая папка → Создать (имя `kurs-data`, том Volume 1).
Права выдаются через File Station → правый клик на папке → Свойства → Права → Создать:
пользователь `everyone` (или группа `http`), права «Чтение» и «Запись»,
применить к этой папке, подпапкам и файлам.

## Резервная копия

Достаточно копировать весь этот каталог (Hyper Backup или просто копия в другое место).
Перед копированием желательно, чтобы портал никто не использовал.

## Перенос на другой NAS

1. Скопировать папку портала (`web/kurs`) и этот каталог.
2. На новом NAS повторить настройку прав через File Station (Свойства → Права).
3. Открыть `api/index.php?a=health` — все проверки должны быть зелёными.
"""


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(WEB)
    os.makedirs(DATA)

    print('1. Копируем портал')
    copy_tree(PORTAL, WEB, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'admin/README-DEPLOY.md'))
    shutil.copytree(os.path.join(HERE, 'banks'), os.path.join(WEB, 'banks'), dirs_exist_ok=True)
    # служебный каталог PHP-библиотек закрыт целиком;
    # банки с ответами закрывает корневой .htaccess по имени файла —
    # иначе закрылся бы и каталог banks/public, который нужен странице теста
    with io.open(os.path.join(WEB, 'lib', '.htaccess'), 'w', encoding='utf-8') as fh:
        fh.write(HTACCESS_LIB)

    print('2. Файлы курса -> kursy/')
    for src, dst, lesson in COURSE_FILES:
        path = os.path.join(HERE, src)
        if not os.path.isfile(path):
            print('  ! нет %s — сначала пересоберите курс' % src)
            continue
        html = io.open(path, encoding='utf-8').read()
        out, ok, info = inject_bridge(html, lesson)
        target = os.path.join(WEB, dst)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with io.open(target, 'w', encoding='utf-8') as fh:
            fh.write(out)
        print('  %-42s %7.1f КБ  мост: %s (%s)' % (dst, len(out.encode('utf-8')) / 1024.0,
                                                   'встроен' if ok else 'не встроен', info))
    for src, dst in PLAIN_FILES:
        ok = copy_if_exists(os.path.join(HERE, src), os.path.join(WEB, dst))
        if ok:
            print('  %-42s копия' % dst)
    with io.open(os.path.join(WEB, 'kursy', '.htaccess'), 'w', encoding='utf-8') as fh:
        fh.write(HTACCESS_KURSY)
    with io.open(os.path.join(WEB, '.htaccess'), 'w', encoding='utf-8') as fh:
        fh.write(HTACCESS_ROOT)

    print('3. Публичные банки вопросов (без ответов)')
    for name, count in build_public_banks():
        print('  banks/public/%-10s %d вопросов' % (name, count))

    print('4. Каталог данных')
    with io.open(os.path.join(DATA, '.htaccess'), 'w', encoding='utf-8') as fh:
        fh.write(HTACCESS_DATA)
    with io.open(os.path.join(DATA, 'README.md'), 'w', encoding='utf-8') as fh:
        fh.write(DATA_README)

    readme = os.path.join(HERE, 'admin-README-DEPLOY.md')
    if os.path.isfile(readme):
        shutil.copy2(readme, os.path.join(WEB, 'admin', 'README-DEPLOY.md'))
        print('5. README-DEPLOY.md скопирован')
    instr = os.path.join(HERE, INSTR_NAME)
    if os.path.isfile(instr):
        shutil.copy2(instr, os.path.join(WEB, 'admin', INSTR_NAME))
        print('   %s скопирована в admin/' % INSTR_NAME)
    else:
        print('   ! нет %s — архив будет без инструкции' % INSTR_NAME)

    total = 0
    files = 0
    for root, dirs, names in os.walk(WEB):
        for n in names:
            files += 1
            total += os.path.getsize(os.path.join(root, n))
    print('\nГотово: %s — %d файлов, %.1f МБ' % (WEB, files, total / 1048576.0))
    print('Каталог данных: %s' % DATA)

    # ЕДИНЫЙ архив для установки: внутри папка kurs/ (портал) и инструкция в корне.
    # Папка в архиве называется kurs, чтобы «Извлечь сюда» в File Station сразу дала
    # /volume1/web/kurs — без переименований. kurs-data в архив не кладём:
    # на NAS её создаёт установщик (admin/install.php) после шага «Общая папка».
    archive = os.path.join(DIST, 'kurs-portal.zip')
    import zipfile
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, names in os.walk(WEB):
            for n in sorted(names):
                full = os.path.join(root, n)
                rel = os.path.relpath(full, WEB).replace(os.sep, '/')
                zf.write(full, 'kurs/' + rel)
        instr_path = os.path.join(HERE, INSTR_NAME)
        if os.path.isfile(instr_path):
            zf.write(instr_path, INSTR_NAME)
    if os.path.isfile(archive):
        with zipfile.ZipFile(archive) as zf:
            n_files = len(zf.namelist())
        print('Архив: %s — %d файлов, %.1f МБ' % (
            archive, n_files, os.path.getsize(archive) / 1048576.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
