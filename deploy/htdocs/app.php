<?php
declare(strict_types=1);
require __DIR__ . '/lib/auth.php';

// The application file carries embedded imaging assets (TensorFlow.js runtime,
// DICOM decoder, base64 model weights) and can exceed 30 MB. The transforms
// below make several whole-string copies, so reserve headroom explicitly
// instead of relying on the host default (often 128M).
$currentLimit = spine_ini_bytes((string) ini_get('memory_limit'));
if ($currentLimit > 0 && $currentLimit < 512 * 1024 * 1024) {
    @ini_set('memory_limit', '512M');
}

spine_require_https();
spine_start_session();
spine_require_login();

$config = spine_config();
$user = spine_current_user() ?? ['id' => 'unknown', 'name' => 'unknown', 'email' => ''];
$appFile = spine_resolve_private_app_file((string) ($config['app_file'] ?? 'spine_simulator.html'));
if ($appFile === null) {
    spine_fail('Configured application file is missing or outside the private directory.');
}

$fileDigest = hash_file('sha256', $appFile);
if (!is_string($fileDigest)) {
    spine_fail('Could not hash the configured application file.');
}

$mode = (string) ($config['watermark'] ?? 'visible');
$includeEmail = !empty($config['watermark_include_email']);
$buildLabel = (string) ($config['build_label'] ?? '');
$sessionKey = hash('sha256', session_id());
$stamp = implode("\0", [
    $fileDigest,
    (string) $user['id'],
    (string) $user['name'],
    (string) $user['email'],
    $mode,
    $includeEmail ? 'email' : 'no-email',
    $buildLabel,
    empty($config['client_launch_gate']) ? 'server-gate' : 'client-gate',
    $sessionKey,
]);
$etag = '"' . hash('sha256', $stamp) . '"';
$nonce = base64_encode(hash('sha256', session_id() . "\0" . $etag . "\0csp", true));

spine_security_headers(true, $nonce);
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: private, no-cache, must-revalidate');
header('ETag: ' . $etag);

$ifNoneMatch = trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
if ($ifNoneMatch !== '' && spine_if_none_match_matches($ifNoneMatch, $etag)) {
    spine_audit('app_revalidated', 'etag=' . substr($etag, 1, 12));
    http_response_code(304);
    exit;
}

$html = file_get_contents($appFile);
if (!is_string($html) || $html === '') {
    spine_fail('Application file is empty or unreadable.');
}

// The standalone file keeps its own restrictive meta policy. Authenticated
// delivery removes it and supplies one nonce-bound response policy instead.
$html = spine_strip_embedded_csp($html);
if (empty($config['client_launch_gate'])) {
    $html = spine_enable_server_authenticated_launch($html);
}

$who = (string) ($user['name'] !== '' ? $user['name'] : $user['id']);
$label = $who;
if ($includeEmail && $user['email'] !== '') {
    $label .= ' <' . (string) $user['email'] . '>';
}
$issuedAt = (int) ($_SESSION['issued_at'] ?? time());
$when = gmdate('Y-m-d H:i', $issuedAt) . ' UTC';
$escape = static fn (string $value): string => htmlspecialchars(
    $value,
    ENT_QUOTES | ENT_SUBSTITUTE,
    'UTF-8'
);

$trace = '';
if ($mode !== 'off') {
    $trace .= "\n<!-- Confidential research build. Session issued to: "
        . $escape($label . ' at ' . $when) . " -->\n";
}
if ($mode === 'visible') {
    $trace .= '<div id="spineWatermark" aria-hidden="true" style="position:fixed;right:8px;bottom:4px;z-index:2147483647;'
        . 'pointer-events:none;font:600 9px/1.3 ui-sans-serif,system-ui,sans-serif;color:rgba(148,163,184,.42);'
        . 'letter-spacing:.04em;text-align:right;text-shadow:0 1px 2px rgba(0,0,0,.6)">'
        . $escape($label) . ' &middot; ' . $escape($when)
        . '</div>' . "\n";
}

$sessionPayload = [
    'servedAt' => $when,
    'build'    => $buildLabel,
];
if ($mode !== 'off') {
    $sessionPayload['user'] = (string) $user['id'];
    $sessionPayload['name'] = (string) $user['name'];
}
$sessionJson = json_encode(
    $sessionPayload,
    JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS
        | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE
);
if (!is_string($sessionJson)) {
    spine_fail('Could not serialize authenticated session metadata.');
}
$trace .= '<script>window.__SPINE_SESSION__=Object.freeze(' . $sessionJson . ");</script>\n";

$corner = 'position:fixed;bottom:4px;z-index:2147483647;font:600 9px/1.3 ui-sans-serif,system-ui,sans-serif;'
    . 'color:rgba(148,163,184,.5);text-decoration:none;letter-spacing:.04em';
$csrf = $escape(spine_csrf_token());
$trace .= '<form method="post" action="logout.php" style="'
    . $corner . ';left:8px;margin:0">'
    . '<input type="hidden" name="csrf" value="' . $csrf . '">'
    . '<button type="submit" style="all:unset;color:inherit;cursor:pointer">Sign out</button>'
    . "</form>\n";
if (spine_is_admin()) {
    $trace .= '<a href="admin.php" style="' . $corner . ';left:64px">Access</a>' . "\n";
}

$position = strripos($html, '</body>');
$html = $position === false
    ? $html . $trace
    : substr($html, 0, $position) . $trace . substr($html, $position);
$html = spine_apply_script_nonce($html, $nonce);

spine_audit('app_served', 'bytes=' . strlen($html) . ' digest=' . substr($fileDigest, 0, 12));
header('Content-Length: ' . strlen($html));
echo $html;
