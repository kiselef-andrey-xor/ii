# -*- coding: utf-8 -*-
"""Дымовой прогон портала на встроенном сервере PHP.

Запуск:  python3 smoke_portal.py
Нужен php-cli (8.1+) с pdo_sqlite и mbstring. Скрипт сам поднимает сервер,
проходит весь путь «установка → регистрация → урок → тест → кабинет» и гасит сервер.
"""
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, 'dist', 'kurs-web')
PORT = int(os.environ.get('KURS_PORT', '8123'))
BASE = 'http://127.0.0.1:%d' % PORT

PASS = 0
FAIL = 0
NOTES = []
INFO = []


def check(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  ✓ %s' % name)
    else:
        FAIL += 1
        NOTES.append('%s %s' % (name, extra))
        print('  ✗ %s %s' % (name, extra))


def info(text):
    INFO.append(text)


class Client(object):
    def __init__(self):
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ''

    def _req(self, method, url, data=None, headers=None, raw=False):
        body = None
        h = {'Accept': 'application/json'}
        if headers:
            h.update(headers)
        if data is not None:
            body = json.dumps(data).encode('utf-8')
            h['Content-Type'] = 'application/json; charset=utf-8'
            if self.csrf:
                h['X-CSRF-Token'] = self.csrf
        req = urllib.request.Request(url, data=body, headers=h, method=method)
        try:
            with self.opener.open(req, timeout=25) as resp:
                text = resp.read().decode('utf-8', 'replace')
                code = resp.getcode()
        except urllib.error.HTTPError as e:
            text = e.read().decode('utf-8', 'replace')
            code = e.code
        if raw:
            return code, text
        try:
            return code, json.loads(text)
        except ValueError:
            return code, {'ok': False, 'error': 'не JSON: %s...' % text[:160]}

    def get(self, action=None, params=None, raw=False, url=None):
        if url is None:
            q = dict(params or {})
            if action:
                q['a'] = action
            url = BASE + '/api/index.php' + ('?' + urllib.parse.urlencode(q) if q else '')
        return self._req('GET', url, raw=raw)

    def post(self, action, data=None, params=None, raw=False):
        q = dict(params or {})
        q['a'] = action
        url = BASE + '/api/index.php?' + urllib.parse.urlencode(q)
        return self._req('POST', url, data=data if data is not None else {}, raw=raw)

    def page(self, path, raw=True):
        return self._req('GET', BASE + path, raw=raw)

    def bootstrap(self):
        code, j = self.get('bootstrap')
        if isinstance(j, dict) and j.get('csrf'):
            self.csrf = j['csrf']
        return code, j


def wait_server(timeout=25):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            urllib.request.urlopen(BASE + '/api/index.php?a=health', timeout=3).read()
            return True
        except Exception:
            time.sleep(0.4)
    return False


def main():
    if not os.path.isdir(DIST):
        print('Нет %s — сначала запустите build_portal.py' % DIST)
        return 1
    if shutil.which('php') is None:
        print('Нет php в PATH')
        return 1

    tmp = tempfile.mkdtemp(prefix='kurs-smoke-')
    data = os.path.join(tmp, 'kurs-data')
    os.makedirs(data)
    env = dict(os.environ)
    env['KURS_DATA_DIR'] = data
    proc = subprocess.Popen(['php', '-S', '127.0.0.1:%d' % PORT], cwd=DIST, env=env,
                            stdout=open(os.path.join(tmp, 'php.log'), 'wb'),
                            stderr=subprocess.STDOUT, preexec_fn=os.setsid)
    try:
        if not wait_server():
            print('Сервер не поднялся. Лог:')
            print(io.open(os.path.join(tmp, 'php.log'), encoding='utf-8', errors='replace').read()[-3000:])
            return 1

        print('\n== 1. Диагностика до установки ==')
        t = Client()
        code, j = t.bootstrap()
        check('bootstrap отвечает', j.get('ok') is True, str(j)[:200])
        check('installed = 0', j.get('installed') is False)
        check('4 урока в списке', len(j.get('lessons', [])) == 4, str(j.get('lessons')))
        check('банки: 32/43/36/44', [l['bank'] for l in j['lessons']] == [32, 43, 36, 44],
              str([l['bank'] for l in j['lessons']]))
        code, j = t.get('health')
        names = {c['name']: c for c in j['checks']}
        check('pdo_sqlite есть', names['pdo_sqlite']['ok'])
        check('каталог данных доступен', names['Каталог данных']['ok'], names['Каталог данных']['value'])
        check('БД открывается', names['База данных']['ok'], names['База данных']['value'])
        check('файлы курса на месте', all(is_file(os.path.join(DIST, p)) for p in [
            'kursy/kurs-uchenik.html', 'kursy/prepod.html', 'kursy/urok-2/index-bez-zametok.html']))

        print('\n== 2. Установка: создаём преподавателя ==')
        html = post_form(BASE + '/admin/install.php', {
            'name': 'Петрова Мария Ивановна', 'login': 'teach', 'password': 'Sch00lAI!2026',
            'password2': 'Sch00lAI!2026', 'class_name': '10Б', 'threshold': '60', 'school': 'Школа №1'})
        check('установка прошла', 'Готово' in html, html[-300:])
        code, j = t.bootstrap()
        check('installed = 1', j.get('installed') is True)
        check('название школы видно', j.get('school') == 'Школа №1', str(j.get('school')))

        code, j = t.post('login', {'login': 'teach', 'password': 'wrong-pass'})
        check('неверный пароль отклонён', code == 401 and j.get('ok') is False, str(j))
        code, j = t.post('login', {'login': 'teach', 'password': 'Sch00lAI!2026'})
        check('преподаватель вошёл', j.get('ok') is True and j['user']['role'] == 'teacher', str(j)[:200])
        t.csrf = j.get('csrf', t.csrf)

        code, j = t.get('session')
        check('сессия отдаёт профиль', j['user']['login'] == 'teach')
        code, j = t.get('lessons')
        check('преподавателю открыты все уроки', all(l['open'] for l in j['lessons']))
        check('преподавателю виден prepod.html',
              any(l['id'] == 'prepod' for l in j['lessons']))
        check('ученические файлы не подсовываются преподу',
              'prepod.html' in [l['file'] for l in j['lessons'] if l['id'] == 'u1'][0])

        print('\n== 3. Хэш пароля в базе ==')
        db = os.path.join(data, 'kurs.db')
        check('файл БД создан', os.path.isfile(db))
        out = subprocess.run(['php', '-r', '''
            $p = new PDO("sqlite:" . $argv[1]);
            $r = $p->query("SELECT login, pass_hash, role FROM users")->fetchAll(PDO::FETCH_ASSOC);
            echo json_encode($r, JSON_UNESCAPED_UNICODE);
        ''', db], stdout=subprocess.PIPE, check=True).stdout.decode('utf-8')
        users = json.loads(out)
        teacher = [u for u in users if u['role'] == 'teacher'][0]
        check('в базе лежит хэш, а не пароль', teacher['pass_hash'] != 'Sch00lAI!2026')
        check('хэш — argon2id или bcrypt',
              teacher['pass_hash'].startswith('$argon2id$') or teacher['pass_hash'].startswith('$2y$'),
              teacher['pass_hash'][:20])
        check('password_verify подтверждает пароль', subprocess.run(
            ['php', '-r', 'var_export(password_verify($argv[1], $argv[2]));',
             'Sch00lAI!2026', teacher['pass_hash']],
            stdout=subprocess.PIPE, check=True).stdout.decode() == 'true')

        print('\n== 4. Регистрация ученика ==')
        s = Client()
        code, j = s.bootstrap()
        s.csrf = j['csrf']
        code, j = s.post('register', {'name': 'иванова анна', 'login': 'ivanova.a',
                                      'password': 'пароль123', 'class_name': '10Б'})
        check('ученик зарегистрировался', j.get('ok') is True, str(j)[:200])
        check('имя нормализовано (Ё→Е, верхний регистр)', j['user']['name'] == 'ИВАНОВА АННА', j['user']['name'])
        check('класс подхватился', j['user']['class_name'] == '10Б', str(j['user']))
        code, j = s.post('register', {'name': 'Другой Ученик', 'login': 'ivanova.a',
                                      'password': 'пароль123', 'class_name': '10Б'})
        check('дубль логина отклонён', code == 409, str(j))
        code, j = s.post('register', {'name': 'Корот Имя', 'login': 'short', 'password': '123',
                                      'class_name': '10Б'})
        check('короткий пароль отклонён', code == 400, str(j))
        code, j = s.post('register', {'name': 'Без Класса', 'login': 'noclass', 'password': 'пароль123',
                                      'class_name': ''})
        check('регистрация без класса отклонена', code == 400, str(j))
        code, j = s.post('register', {'name': 'Хакер', 'login': 'ivanova.a<script>',
                                      'password': 'пароль123', 'class_name': '10Б'})
        check('логин с мусором отклонён', code == 400, str(j))

        print('\n== 5. Доступ ученика к контенту ==')
        code, body = s.page('/course.php?f=kursy%2Fkurs-uchenik.html', raw=True)
        check('урок 1 отдаётся ученику', code == 200 and 'KURS BRIDGE' in body, 'code=%s' % code)
        check('в файл встроен мост портала', 'kurs-progress' in body)
        code, body = s.page('/course.php?f=kursy%2Fprepod.html', raw=True)
        check('заметки преподавателя ученику закрыты', code == 403, 'code=%s' % code)
        code, body = s.page('/course.php?f=kursy%2Furok-2%2Findex-bez-zametok.html', raw=True)
        check('урок 2 закрыт до зачёта по уроку 1', code == 403, 'code=%s' % code)
        code, body = s.page('/course.php?f=../../lib/config.php', raw=True)
        check('выход за каталог заблокирован', code in (403, 404), 'code=%s' % code)
        root_ht = io.open(os.path.join(DIST, '.htaccess'), encoding='utf-8').read()
        check('банки с ответами закрыты правилом rewrite',
              'banks/u[1-4]' in root_ht and 'banks/public' in root_ht)
        check('публичные банки остались доступны (нужны тесту без входа)',
              os.path.isfile(os.path.join(DIST, 'banks', 'public', 'u1.json')))
        check('каталог kursy закрыт .htaccess',
              'Require all denied' in io.open(os.path.join(DIST, 'kursy', '.htaccess'), encoding='utf-8').read())
        info('Встроенный сервер PHP не читает .htaccess: после установки на NAS '
             'откройте в браузере http://АДРЕС_ПОРТАЛА/banks/u1.json — должно быть 403')

        print('\n== 6. Тест: серверный режим ==')
        code, j = s.get('test', {'u': 'u1'})
        check('вариант выдан', j.get('ok') is True, str(j)[:200])
        check('вопросов 15', len(j['questions']) == 15, str(len(j['questions'])))
        check('правильных ответов в выдаче нет',
              all('a' not in q and 'right' not in q for q in j['questions']))
        check('объяснений в выдаче нет', all('e' not in q for q in j['questions']))
        check('темы покрыты', len(set(q['t'] for q in j['questions'])) >= 10,
              str(len(set(q['t'] for q in j['questions']))))
        check('варианты ответа перемешаны', any(o['k'] != i for q in j['questions']
                                                for i, o in enumerate(q['o'])))
        variant = j['questions']

        # отвечаем специально с двумя ошибками
        bank = json.load(io.open(os.path.join(DIST, 'banks', 'u1.json'), encoding='utf-8'))
        answers = []
        wrong_at = [0, 1]
        for n, q in enumerate(variant):
            right = bank['questions'][q['id']]['a']
            given = right
            if n in wrong_at:
                given = (right + 1) % len(bank['questions'][q['id']]['o'])
            answers.append({'id': q['id'], 'a': given})
        code, j = s.post('test', {'u': 'u1', 'answers': answers, 'sec': 300}, {'u': 'u1'})
        check('тест проверен', j.get('ok') is True, str(j)[:200])
        check('верно 13 из 15', j['right'] == 13 and j['total'] == 15, '%s/%s' % (j['right'], j['total']))
        check('процент 87', j['pct'] == 87, str(j['pct']))
        check('оценка 4', j['grade'] == 4, str(j['grade']))
        check('зачёт при пороге 60', j['passed'] is True)
        check('код результата выдан', j['code'].startswith('U1|'), j['code'])
        check('в коде 11 полей', len(j['code'].split('|')) == 11, j['code'])
        check('в разборе 15 вопросов', len(j['detail']) == 15)
        check('объяснения пришли', all(d['e'] for d in j['detail']))
        check('слабые темы посчитаны', len(j['weak']) >= 1, str(j['weak']))
        code2, j2 = s.post('test', {'u': 'u1', 'answers': answers, 'sec': 300}, {'u': 'u1'})
        check('повторная отправка того же варианта отклонена', code2 == 409, str(j2)[:120])

        print('\n== 7. Прогресс открытия уроков ==')
        code, j = s.get('lessons')
        byid = {l['id']: l for l in j['lessons']}
        check('урок 2 открыт после 87%', byid['u2']['open'] is True)
        check('финал закрыт', byid['final']['open'] is False)
        code, body = s.page('/course.php?f=kursy%2Furok-2%2Findex-bez-zametok.html', raw=True)
        check('файл урока 2 теперь отдаётся', code == 200, 'code=%s' % code)

        print('\n== 8. Прогресс прохождения ==')
        code, j = s.post('progress', {'lesson': 'u1', 'unlocked': 12, 'position': 12,
                                            'visited': {str(i): 1 for i in range(13)},
                                            'tasks_done': 5, 'tasks_all': 20})
        check('прогресс сохранён', j.get('ok') is True, str(j)[:160])
        sig = j.get('sig', '')
        check('подпись прогресса выдана', len(sig) == 64, sig[:16])
        code, j = s.get('progress', {'lesson': 'u1'})
        check('прогресс читается', j['found'] is True and j['unlocked'] == 12, str(j)[:160])
        code, j = s.post('progress', {'lesson': 'zz', 'unlocked': 1})
        check('чужой урок отклонён', code == 400, str(j))
        # CSRF
        good = s.csrf
        s.csrf = 'wrong-token'
        code, j = s.post('progress', {'lesson': 'u1', 'unlocked': 3})
        check('запрос с чужим CSRF отклонён', code == 403, str(j)[:120])
        s.csrf = good

        print('\n== 9. Кабинет: журнал, коды, статистика ==')
        code, j = t.get('results')
        check('журнал виден преподавателю', j.get('ok') is True and j['count'] == 1, str(j)[:160])
        row = j['rows'][0]
        check('в журнале имя ученика', row['name'] == 'ИВАНОВА АННА', row['name'])
        check('в журнале класс', row['class'] == '10Б', row['class'])
        check('слабые темы в журнале', len(row['weak']) >= 1, str(row['weak']))
        code, j = s.get('results')
        check('ученик не видит журнал', code == 403, str(j)[:120])

        code, csv = t.get('export', {'f': 'csv'}, raw=True)
        check('CSV выгружается', code == 200 and csv.startswith('\ufeff'), repr(csv[:20]))
        check('CSV с разделителем ;', ';' in csv.split('\r\n')[0])
        check('в CSV есть кириллица', 'ИВАНОВА' in csv)
        code, j = t.get('export', {'f': 'json'})
        check('JSON выгружается', code == 200 and isinstance(j, dict) and j['rows'][0]['right_cnt'] == 13,
              str(j)[:160])
        code, txt = t.get('export', {'f': 'codes'}, raw=True)
        check('коды списком', code == 200 and txt.startswith('U1|'), txt[:40])

        code, j = t.get('stats')
        check('статистика отдаётся', j.get('ok') is True, str(j)[:120])
        check('сводка по темам есть', len(j['topics']) >= 8, str(len(j['topics'])))
        check('ученик в списке', any(p['name'] == 'ИВАНОВА АННА' for p in j['people']))
        person = [p for p in j['people'] if p['name'] == 'ИВАНОВА АННА'][0]
        check('у ученика виден прогресс u1', person['lessons'].get('u1', {}).get('unlocked') == 12,
              str(person['lessons']))
        check('у ученика видна оценка', person['grades'].get('u1', {}).get('grade') == 4,
              str(person['grades']))

        print('\n== 10. Импорт кодов из автономного теста ==')
        # код из настоящего автономного теста урока 1 (формат проверяется)
        code_raw = make_code('U1', 'СИДОРОВ IVAN', '10Б', '2611011104', 50291, 15, 15, 187,
                             topic_mask(10), 'lg22')
        broken = 'U1|ПОДДЕЛКА|10Б|2611011104|50291|15|15|187|zzzzzzzzzz|lg22|xx'
        payload = '\n'.join([code_raw, broken, code_raw])
        code, j = t.post('teacher', {'op': 'import_codes', 'text': payload, 'lesson': ''})
        check('код внесён', j.get('ok') is True and j['added'] == 1, str(j)[:200])
        check('дубликат отброшен', j['duplicates'] == 1, str(j))
        check('подделка помечена', len(j['invalid']) == 1 and 'повреждён' in j['invalid'][0]['reason'],
              str(j['invalid']))
        code, j = t.get('results', {'best': 1})
        check('в журнале две записи (ученики разные)', j['count'] == 2, str(j['count']))

        print('\n== 11. Ручной ввод и удаление ==')
        code, j = t.post('teacher', {
            'op': 'manual_result', 'name': 'кузнецова мария', 'group': '10Б',
            'lesson': 'u1', 'right': 9, 'total': 15, 'sec': 420})
        check('ручной ввод сохранён', j.get('ok') is True and j['pct'] == 60 and j['grade'] == 3, str(j)[:160])
        code, j = t.get('results')
        target = [r for r in j['rows'] if r['name'] == 'КУЗНЕЦОВА МАРИЯ'][0]
        code, j2 = t.post('teacher', {'op': 'delete_attempt', 'id': target['id']})
        check('запись удалена', j2.get('ok') is True, str(j2)[:120])
        code, j = t.get('results')
        check('после удаления записи нет', not any(r['name'] == 'КУЗНЕЦОВА МАРИЯ' for r in j['rows']))

        print('\n== 12. Настройки и роли ==')
        code, j = t.post('teacher', {'op': 'set_settings', 'threshold_u1': 95, 'count_u1': 8,
                                     'open_final': 1, 'school_name': 'Гимназия №2'})
        check('настройки сохранены', j.get('ok') is True, str(j)[:120])
        code, j = t.bootstrap()
        l1 = [l for l in j['lessons'] if l['id'] == 'u1'][0]
        check('новый порог применён', l1['threshold'] == 95, str(l1['threshold']))
        check('новая длина варианта', l1['count'] == 8, str(l1['count']))
        check('финал открыт всем', j['open_final'] is True)
        code, j = s.get('lessons')
        check('ученик видит открытый финал', [l for l in j['lessons'] if l['id'] == 'final'][0]['open'] is True)
        code, j = s.post('teacher', {'op': 'set_settings', 'open_final': 0})
        check('ученик не может менять настройки', code == 403, str(j)[:120])
        # вернём как было
        t.post('teacher', {'op': 'set_settings', 'threshold_u1': 60, 'count_u1': 15, 'open_final': 0})

        code, j = t.post('teacher', {'op': 'create_user', 'name': 'Петров Олег', 'login': 'petrov.o',
                                     'password': 'temp12345', 'role': 'student', 'class_id': 1})
        check('преподаватель создал ученика', j.get('ok') is True, str(j)[:200])
        code, j = t.post('teacher', {'op': 'reset_password', 'user_id': j['created']['id'],
                                     'password': 'новый12345'})
        check('сброс пароля работает', j.get('ok') is True, str(j)[:120])
        code, j = t.post('teacher', {'op': 'toggle_user', 'user_id': 3})
        check('отключение ученика', j.get('ok') is True and j['active'] == 0, str(j)[:120])

        print('\n== 13. Вариант для печати ==')
        code, j = t.post('teacher', {'op': 'paper', 'lesson': 'u2', 'count': 12})
        check('пустой вариант собран', j.get('ok') is True and len(j['items']) == 12, str(j)[:160])
        check('в пустом варианте нет ответов', all('a' not in i for i in j['items']))

        print('\n== 14. Страницы портала ==')
        anon = Client()
        code, body = anon.page('/index.php', raw=True)
        check('без входа редирект на login', code == 200 and 'logincard' in body, 'code=%s' % code)
        code, body = anon.page('/cabinet.php', raw=True)
        check('кабинет без входа закрыт', code in (302, 403) or 'logincard' in body, 'code=%s' % code)
        code, body = anon.page('/test.php?u=u2', raw=True)
        check('тест без входа работает (тренировка)', code == 200 and 'KURS_LESSON' in body, 'code=%s' % code)
        check('тест берёт публичный банк (без ответов)', 'banks/public/u2.json' in body)
        code, body = anon.page('/banks/public/u2.json', raw=True)
        pub = json.loads(body)
        check('публичный банк без поля a', all('a' not in q for q in pub['questions']))
        check('публичный банк с объяснениями', all(q['e'] for q in pub['questions']))
        anon2 = Client()
        code, body = anon2.page('/admin/install.php', raw=True)
        check('повторная установка закрыта для анонима (редирект на вход)',
              'logincard' in body or 'уже установлен' in body, body[:120])
        code, body = t.page('/admin/install.php', raw=True)
        check('преподаватель видит страницу установки', 'Установка портала' in body, body[:120])
        ht = io.open(os.path.join(DIST, 'kursy', '.htaccess'), encoding='utf-8').read()
        check('kursy закрыт правилом Require all denied', 'Require all denied' in ht)
        check('в .htaccess есть и правило для старого Apache', 'Deny from all' in ht)
        code, body = anon.page('/kursy/kurs-uchenik.html', raw=True)
        check('встроенный сервер PHP отдаёт статику (на NAS будет 403)', code in (200, 403, 404),
              'code=%s' % code)

        print('\n== 15. Тренировочный тест без входа ==')
        code, j = anon.get('bootstrap')
        check('bootstrap для анонима', j.get('ok') is True and j['user'] is None)
        code, j = anon.get('test', {'u': 'u2'})
        check('серверный тест без входа закрыт', code == 401, str(j)[:120])

        print('\n== 16. Блокировка подбора пароля ==')
        brute = Client()
        brute.bootstrap()
        last = None
        for i in range(6):
            code, last = brute.post('login', {'login': 'teach', 'password': 'неверно%d' % i})
        check('после 5 неудач вход заблокирован',
              last is not None and ('10 мин' in last.get('error', '') or code == 429),
              str(last)[:160])

        print('\n== 17. Аудит ==')
        out = subprocess.run(['php', '-r', '''
            $p = new PDO("sqlite:" . $argv[1]);
            $n = $p->query("SELECT COUNT(*) FROM audit")->fetchColumn();
            $acts = $p->query("SELECT DISTINCT action FROM audit ORDER BY action")->fetchAll(PDO::FETCH_COLUMN);
            echo json_encode(["n"=>(int)$n,"acts"=>$acts]);
        ''', db], stdout=subprocess.PIPE, check=True).stdout.decode('utf-8')
        audit = json.loads(out)
        check('журнал аудита ведётся', audit['n'] > 8, str(audit['n']))
        for need in ('login.ok', 'login.fail', 'register', 'test.submit', 'codes.import',
                     'settings.update', 'password.reset', 'install'):
            check('в аудите есть %s' % need, need in audit['acts'], str(audit['acts']))

    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            proc.terminate()
        time.sleep(0.3)
        log = io.open(os.path.join(tmp, 'php.log'), encoding='utf-8', errors='replace').read()
        warns = [l for l in log.splitlines()
                 if re.search(r'(Warning|Fatal|Deprecated|Notice|Uncaught)', l)]
        if warns:
            print('\n!! Предупреждения PHP (%d):' % len(warns))
            for l in warns[:25]:
                print('   ', l[:220])
        else:
            print('\nЛог PHP чистый: предупреждений и фатальных ошибок нет')
        check('в логе PHP нет ошибок', not warns, str(warns[:3]))
        shutil.rmtree(tmp, ignore_errors=True)

    print('\n' + '=' * 60)
    print('Пройдено проверок: %d, ошибок: %d' % (PASS, FAIL))
    if NOTES:
        print('\nОшибки:')
        for n in NOTES:
            print(' -', n)
    if INFO:
        print('\nНа заметку:')
        for n in INFO:
            print(' -', n)
    return 1 if FAIL else 0


def is_file(p):
    return os.path.isfile(p)


# --- функции, повторяющие формулы кода результата (для проверки импорта) -----

def b36(s):
    return ''.join(base36(ord(c)) for c in s)


def base36(n):
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    if n == 0:
        return '0'
    out = ''
    while n:
        out = digits[n % 36] + out
        n //= 36
    return out


def crc(s):
    h = 5381
    for ch in s:
        h = ((h * 33) + ord(ch)) & 0xFFFFFFFF
    return base36(h % 1296).rjust(2, '0')


def topic_mask(n_topics):
    return ''.join(base36(5 * 6 + 5) for _ in range(n_topics))


def make_code(prefix, name, group, stamp, variant, right, total, sec, mask, nonce):
    body = '|'.join([prefix, name, group, stamp, str(variant), str(right), str(total),
                     str(sec), mask, nonce])
    return body + '|' + crc(b36(body))


def post_form(url, fields):
    data = urllib.parse.urlencode(fields).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST',
                                headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.read().decode('utf-8', 'replace')


if __name__ == '__main__':
    sys.exit(main())
