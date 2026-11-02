#!/usr/bin/env bash
# Полный прогон проверок портала и курса.
#
#   bash run_tests.sh            — всё
#   bash run_tests.sh quick      — без долгих jsdom-прогонов
#
# Нужно: python3, node, php-cli 8.1+ (pdo_sqlite, mbstring), jsdom в ../tools/node_modules.
set -u
cd "$(dirname "$0")"

QUICK="${1:-full}"
FAILED=0
HAVE_PHP=1
HAVE_NODE=1
HAVE_JSDOM=1

command -v php  >/dev/null 2>&1 || HAVE_PHP=0
command -v node >/dev/null 2>&1 || HAVE_NODE=0
[ -d ../tools/node_modules/jsdom ] || [ -d tools/node_modules/jsdom ] || HAVE_JSDOM=0

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
run()  { if "$@"; then :; else FAILED=$((FAILED+1)); printf '\033[31m  ^ не прошло\033[0m\n'; fi }

step "1. Синтаксис PHP"
if [ "$HAVE_PHP" = 1 ]; then
  for f in $(find portal dist/kurs-web -name '*.php' 2>/dev/null | sort); do
    out=$(php -l "$f" 2>&1)
    case "$out" in
      *"No syntax errors"*) : ;;
      *) echo "$out"; FAILED=$((FAILED+1)) ;;
    esac
  done
  echo "  php -l: ошибок нет"
else
  echo "  ~ php не найден — пропущено"
fi

step "2. Синтаксис JavaScript"
if [ "$HAVE_NODE" = 1 ]; then
  for f in portal/app.js portal/portal.js portal/test.js portal/cabinet.js; do
    run node --check "$f"
  done
  echo "  node --check: ошибок нет"
else
  echo "  ~ node не найден — пропущено"
fi

step "3. Банки вопросов"
run python3 extract_u1_bank.py
run python3 make_banks.py
run python3 - <<'PY'
import io, json, os, sys
bad = 0
for n in ('u1', 'u2', 'u3', 'u4'):
    b = json.load(io.open('banks/%s.json' % n, encoding='utf-8'))
    qs = b['questions']
    seen = set()
    for i, q in enumerate(qs):
        if q['t'] not in b['topics']:
            print('  ✗ %s: тема вне списка: %s' % (n, q['t'])); bad += 1
        if not (2 <= len(q['o']) <= 6):
            print('  ✗ %s #%d: вариантов %d' % (n, i, len(q['o']))); bad += 1
        if not (0 <= q['a'] < len(q['o'])):
            print('  ✗ %s #%d: индекс ответа вне диапазона' % (n, i)); bad += 1
        if q['q'] in seen:
            print('  ✗ %s: дубль вопроса: %s' % (n, q['q'][:50])); bad += 1
        seen.add(q['q'])
        for k in ('q', 'e'):
            if len(q[k]) < 10:
                print('  ✗ %s #%d: короткое поле %s' % (n, i, k)); bad += 1
    for t in b['topics']:
        if not any(q['t'] == t for q in qs):
            print('  ✗ %s: нет вопросов по теме %s' % (n, t)); bad += 1
    print('  ✓ %s: %d вопросов, %d тем' % (n, len(qs), len(b['topics'])))
sys.exit(1 if bad else 0)
PY

step "4. Совместимость кода результата (JS ↔ PHP ↔ Python)"
if [ "$HAVE_PHP" = 1 ] && [ "$HAVE_NODE" = 1 ]; then
  run python3 tests/test_code_compat.py
else
  echo "  ~ нужны php и node — пропущено"
fi

step "5. Совместимость ключа хранилища (PHP ↔ JS)"
if [ "$HAVE_PHP" = 1 ] && [ "$HAVE_NODE" = 1 ]; then
  run python3 tests/test_mix_compat.py
else
  echo "  ~ нужны php и node — пропущено"
fi

step "6. Сборка портала"
run python3 build_portal.py

step "7. Сквозной прогон портала (установка → вход → урок → тест → кабинет)"
if [ "$HAVE_PHP" = 1 ]; then
  run python3 smoke_portal.py
else
  echo "  ~ php не найден — пропущено"
fi

if [ "$QUICK" = quick ]; then
  printf '\n\033[1mБыстрый режим: долгие jsdom-прогоны пропущены\033[0m\n'
else
  step "8. Мост прогресса в собранном файле курса"
  if [ "$HAVE_NODE" = 1 ] && [ "$HAVE_JSDOM" = 1 ]; then
    run node test_bridge.js dist/kurs-web/kursy/kurs-uchenik.html speak 107 42
    run node test_bridge.js dist/kurs-web/kursy/urok-3/index-bez-zametok.html rag 19 7
  else
    echo "  ~ нужны node и jsdom — пропущено"
  fi

  step "9. Режим прохождения после встраивания моста"
  if [ "$HAVE_NODE" = 1 ] && [ "$HAVE_JSDOM" = 1 ]; then
    run node test_course.js dist/kurs-web/kursy/kurs-uchenik.html fast
    run node test_any.js dist/kurs-web/kursy/prepod.html 50
  else
    echo "  ~ нужны node и jsdom — пропущено"
  fi

  step "10. Автономный тест урока 1 (не должен был измениться)"
  if [ "$HAVE_NODE" = 1 ] && [ "$HAVE_JSDOM" = 1 ]; then
    run node test_quiz.js test-urok-1.html
  else
    echo "  ~ нужны node и jsdom — пропущено"
  fi
fi

printf '\n\033[1m============================================\033[0m\n'
if [ "$FAILED" = 0 ]; then
  printf '\033[32mВсе проверки пройдены\033[0m\n'
else
  printf '\033[31mНе прошло блоков: %d\033[0m\n' "$FAILED"
fi
exit "$FAILED"
