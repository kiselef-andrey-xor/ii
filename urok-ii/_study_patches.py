# -*- coding: utf-8 -*-
"""Точечные замены в исходном скрипте урока: отключают «свободную» навигацию,
чтобы режим обязательного прохождения нельзя было обойти клавишами, колесом,
свайпом или кликом по оглавлению.

Формат: PAIRS = [(regexp, замена, обязательность), ...] — применяется re.subn(count=1).
"""
import re

STUDY_BRIDGE = (
    "    if (window.__studyTick) window.__studyTick();\n"
    "    if (window.__studyMax !== undefined && n > window.__studyMax) n = window.__studyMax;\n"
)

PAIRS = [
    # 1. Оглавление: клик по заблокированному слайду не должен ничего делать
    (
        re.compile(re.escape("b.onclick = function(){ show(idx); closeModal(); };")),
        "b.onclick = function(){ if (window.__studyCan && !window.__studyCan(idx)) return; show(idx); closeModal(); };",
        True,
    ),
    (
        re.compile(re.escape("if (h && h >= 1 && h <= slides.length) show(h-1); else show(0);")),
        "var _hs = (h && h >= 1 && h <= slides.length) ? h-1 : 0;\n"
        "  if (window.__studyMax !== undefined && _hs > window.__studyMax) _hs = 0;\n"
        "  show(_hs);",
        True,
    ),
    # 3. Клавиатура: стрелки, пробел, Home/End обрабатывает только режим прохождения
    (
        re.compile(
            r"      case 'ArrowRight':[^\n]*\n"
            r"      case 'ArrowLeft':[^\n]*\n"
            r"      case 'Home':[^\n]*\n"
            r"      case 'End':[^\n]*\n"),
        "      /* навигация передана режиму прохождения */\n",
        True,
    ),
    # 4. Быстрый переход цифрами (встречается и в одну строку, и в несколько)
    (
        re.compile(
            r"        if \(/\^\[0-9\]\$/\.test\(e\.key\)\) \{[^\n]*\}\n"
            r"(?:          var n = parseInt\(e\.key,10\);\n"
            r"          if \(n === 0\) n = 10;\n"
            r"          show\(n-1\);\n"
            r"        \}\n)?"),
        "        /* быстрый переход отключён: слайды открываются по порядку */\n",
        True,
    ),
    # 5. Колесо мыши: прокрутка внутри слайда остаётся, переход — только через кнопку
    (
        re.compile(
            r"    if \(e\.deltaY > 40 && atBot\) \{[^\n]*\n"
            r"    else if \(e\.deltaY < -40 && atTop\) \{[^\n]*\n"),
        "    /* прокрутка не переключает слайды */\n",
        True,
    ),
    # 6. Свайп на телефоне
    (
        re.compile(re.escape("    if (Math.abs(dx) > 70) { dx < 0 ? next() : prev(); }")),
        "    /* свайп обрабатывает режим прохождения */",
        True,
    ),
    # 7. Защита для файлов без итогового теста (финальный проект):
    #    обращение к несуществующим кнопкам роняло весь скрипт навигации
    (
        re.compile(re.escape("  document.getElementById('btnScore').onclick = function(){")),
        "  var scoreEl = document.getElementById('score');\n"
        "  var btnScoreEl = document.getElementById('btnScore');\n"
        "  if (btnScoreEl) btnScoreEl.onclick = function(){",
        False,
    ),
    (
        re.compile(re.escape("  document.getElementById('btnQuizReset').onclick = function(){")),
        "  if (document.getElementById('btnQuizReset')) "
        "document.getElementById('btnQuizReset').onclick = function(){",
        False,
    ),
    # 8. Режим «только практика» отключён: он позволял бы листать теорию в обход порядка
    (
        re.compile(re.escape("      case 'f': case 'F': case 'а': case 'А': togglePractice(); break;")),
        "      /* режим «только практика» отключён в ученической версии */",
        True,
    ),
    (
        re.compile(re.escape("  document.getElementById('btnPractice').onclick = togglePractice;")),
        "  var practiceBtnEl = document.getElementById('btnPractice');\n"
        "  if (practiceBtnEl) practiceBtnEl.onclick = function(){ practiceBtnEl.classList.remove('on2'); };",
        True,
    ),
    (
        re.compile(re.escape("    if (practiceOnly) show(i);")),
        "    /* фильтр практики в ученической версии не применяется */",
        True,
    ),
    (
        re.compile(re.escape("  function togglePractice(){")),
        "  function togglePractice(){ practiceOnly = false; return; }\n"
        "  function togglePracticeDisabled(){",
        True,
    ),
]

# мостик вставляется сразу после этой строки внутри функции show()
BRIDGE_AFTER = "    markOv();\n"