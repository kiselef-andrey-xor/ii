<?php
/**
 * lib/resp.php — JSON-ответы API и разбор входящего запроса.
 *
 * Все ответы одинаковые: {"ok":true,...} или {"ok":false,"error":"сообщение"}.
 * Сообщения об ошибках — на русском, их читает школьник.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

function kurs_json_out(array $data, int $status = 200): void
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    exit;
}

function kurs_ok(array $data = []): void
{
    kurs_json_out(array_merge(['ok' => true], $data));
}

function kurs_fail(string $message, int $status = 400, array $extra = []): void
{
    kurs_json_out(array_merge(['ok' => false, 'error' => $message], $extra), $status);
}

/** Тело запроса: JSON предпочтительнее, form-data — как запасной вариант. */
function kurs_input(): array
{
    static $data = null;
    if ($data !== null) {
        return $data;
    }
    $data = [];
    $raw = file_get_contents('php://input');
    if (is_string($raw) && trim($raw) !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $data = $decoded;
        } else {
            parse_str($raw, $data);
        }
    }
    if (!$data && $_POST) {
        $data = $_POST;
    }
    return $data;
}

function kurs_in_str(string $key, string $default = '', int $max = 400): string
{
    $v = kurs_input()[$key] ?? $default;
    if (is_array($v)) {
        return $default;
    }
    return kurs_trim((string) $v, $max);
}

function kurs_in_int(string $key, ?int $default = null): ?int
{
    $v = kurs_input()[$key] ?? null;
    if ($v === null || $v === '') {
        return $default;
    }
    if (is_array($v) || !preg_match('/^-?\d+$/', trim((string) $v))) {
        return $default;
    }
    return (int) $v;
}

function kurs_method(): string
{
    return strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

/** Заголовки безопасности для всех страниц и ответов портала. */
function kurs_security_headers(): void
{
    if (headers_sent()) {
        return;
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; "
        . "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
        . "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    if (kurs_is_https()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}
