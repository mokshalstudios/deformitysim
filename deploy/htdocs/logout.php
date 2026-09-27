<?php
declare(strict_types=1);
require __DIR__ . '/lib/auth.php';

spine_require_https();
spine_start_session();
spine_security_headers(false);
header('Cache-Control: no-store, private');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    header('Content-Type: text/plain; charset=utf-8');
    exit("Method not allowed.\n");
}
if (!spine_is_authenticated() || !spine_csrf_valid($_POST['csrf'] ?? null)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Invalid sign-out request.\n");
}

spine_audit('logout');
spine_logout();

header('Location: index.php?bye=1', true, 302);
exit;
