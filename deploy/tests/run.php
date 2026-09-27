<?php
declare(strict_types=1);

/**
 * Deterministic deployment/auth smoke tests.
 *
 * The suite creates an isolated private directory under the OS temp directory,
 * never alters the shipped application HTML, and exits non-zero on any failure.
 */

// The shipped HTML carries embedded imaging assets (~67 MB); the served-page
// transforms under test copy it several times. Mirror app.php's headroom.
if ((int) ini_get('memory_limit') > 0 && (int) ini_get('memory_limit') < 512) {
    @ini_set('memory_limit', '512M');
}

$deployRoot = dirname(__DIR__);
$tempRoot = rtrim(sys_get_temp_dir(), '/\\')
    . DIRECTORY_SEPARATOR . 'spine-deploy-tests-' . bin2hex(random_bytes(6));
$privateDir = $tempRoot . DIRECTORY_SEPARATOR . 'private';
$sessionDir = $tempRoot . DIRECTORY_SEPARATOR . 'sessions';

if (!mkdir($privateDir, 0700, true) || !mkdir($sessionDir, 0700, true)) {
    fwrite(STDERR, "Could not create the isolated test directory.\n");
    exit(2);
}
ini_set('log_errors', '1');
ini_set('error_log', $tempRoot . DIRECTORY_SEPARATOR . 'php-error.log');

$adminPassword = 'Correct Horse 2026!';
$testerPassword = 'Testing Account 2026!';
$adminHash = password_hash($adminPassword, PASSWORD_BCRYPT, ['cost' => 4]);
$testerHash = password_hash($testerPassword, PASSWORD_BCRYPT, ['cost' => 4]);
if (!is_string($adminHash) || !is_string($testerHash)) {
    fwrite(STDERR, "Could not create test password hashes.\n");
    exit(2);
}

$fixtureHtml = <<<'HTML'
<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
</head><body><script>var CODE_DIGEST='fixture';var unlocked = readStored() === CODE_DIGEST;</script>
<script src="fixture.js"></script></body></html>
HTML;
file_put_contents($privateDir . DIRECTORY_SEPARATOR . 'fixture.html', $fixtureHtml);

$baseConfig = [
    'site_title' => 'Spine deployment test',
    'build_label' => 'test-build',
    'canonical_origin' => 'https://example.test',
    'trusted_proxy_ips' => ['127.0.0.1', '10.0.0.0/8'],
    'hsts_include_subdomains' => false,
    'app_file' => 'fixture.html',
    'watermark' => 'visible',
    'watermark_include_email' => false,
    'client_launch_gate' => false,
    'audit_log' => true,
    'users' => [
        [
            'id' => 'admin',
            'name' => 'Test Admin',
            'email' => 'admin@example.test',
            'hash' => $adminHash,
            'admin' => true,
            'disabled' => false,
            'session_version' => 1,
        ],
        [
            'id' => 'tester',
            'name' => 'Test Operator',
            'email' => 'tester@example.test',
            'hash' => $testerHash,
            'admin' => true,
            'disabled' => false,
            'session_version' => 1,
        ],
    ],
];

$writeConfig = static function (array $config) use ($privateDir): void {
    $php = "<?php\ndeclare(strict_types=1);\nreturn "
        . var_export($config, true) . ";\n";
    $result = file_put_contents(
        $privateDir . DIRECTORY_SEPARATOR . 'config.php',
        $php,
        LOCK_EX
    );
    if ($result !== strlen($php)) {
        throw new RuntimeException('Could not write test config.php.');
    }
};
$writeConfig($baseConfig);

putenv('SPINE_PRIVATE_DIR=' . $privateDir);
$_SERVER['HTTPS'] = 'on';
$_SERVER['SERVER_PORT'] = '443';
$_SERVER['HTTP_HOST'] = 'example.test';
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
$_SERVER['REQUEST_URI'] = '/app.php';
$_SERVER['REQUEST_METHOD'] = 'GET';
session_save_path($sessionDir);

require $deployRoot . DIRECTORY_SEPARATOR . 'htdocs'
    . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'auth.php';

$passes = 0;
$failures = [];
$check = static function (bool $condition, string $message) use (&$passes, &$failures): void {
    if ($condition) {
        $passes++;
        return;
    }
    $failures[] = $message;
};

try {
    $config = spine_config();
    $check(
        realpath((string) $config['config_path'])
            === realpath($privateDir . DIRECTORY_SEPARATOR . 'config.php'),
        'SPINE_PRIVATE_DIR did not select the isolated config.'
    );
    $check(spine_canonical_origin() === 'https://example.test', 'Canonical origin changed.');
    $check(spine_ip_matches_rule('10.2.3.4', '10.0.0.0/8'), 'IPv4 CIDR match failed.');
    $check(!spine_ip_matches_rule('11.2.3.4', '10.0.0.0/8'), 'IPv4 CIDR overmatched.');
    $check(spine_ip_matches_rule('2001:db8::1', '2001:db8::/32'), 'IPv6 CIDR match failed.');
    $check(
        spine_ip_matches_rule('2001:0db8:0:0::1', '2001:db8::1'),
        'Equivalent exact IPv6 spellings did not match.'
    );

    $_SERVER['HTTPS'] = 'off';
    $_SERVER['SERVER_PORT'] = '80';
    $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    $_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https';
    $check(spine_is_https(), 'Trusted proxy HTTPS signal was ignored.');
    $_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https, http';
    $check(!spine_is_https(), 'Ambiguous/spoofable forwarded HTTPS chain was accepted.');
    $_SERVER['HTTP_X_FORWARDED_PROTO'] = 'http, https';
    $check(!spine_is_https(), 'Ambiguous forwarded protocol list was accepted.');
    $_SERVER['HTTP_X_FORWARDED_PROTO'] = 'https';
    $_SERVER['REMOTE_ADDR'] = '198.51.100.8';
    $check(!spine_is_https(), 'Untrusted proxy HTTPS signal was accepted.');
    $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    $_SERVER['HTTP_X_FORWARDED_FOR'] = '192.0.2.99, 198.51.100.25';
    $check(
        spine_client_ip() === '198.51.100.25',
        'Trusted proxy chain accepted a spoofed leftmost client address.'
    );
    $_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.25, 10.2.3.4';
    $check(
        spine_client_ip() === '198.51.100.25',
        'Trusted multi-proxy chain did not resolve the client.'
    );
    $_SERVER['REMOTE_ADDR'] = '203.0.113.9';
    $_SERVER['HTTP_X_FORWARDED_FOR'] = '192.0.2.99';
    $check(
        spine_client_ip() === '203.0.113.9',
        'Untrusted transport peer supplied the client IP.'
    );
    $_SERVER['HTTPS'] = 'on';
    $_SERVER['SERVER_PORT'] = '443';
    $_SERVER['REMOTE_ADDR'] = '203.0.113.9';
    unset($_SERVER['HTTP_X_FORWARDED_PROTO'], $_SERVER['HTTP_X_FORWARDED_FOR']);

    $resolved = spine_resolve_private_app_file('fixture.html');
    $check(
        is_string($resolved) && realpath($resolved)
            === realpath($privateDir . DIRECTORY_SEPARATOR . 'fixture.html'),
        'Private application file was not resolved.'
    );
    $check(
        spine_resolve_private_app_file('../fixture.html') === null,
        'Traversal was accepted as a private application filename.'
    );
    $check(
        spine_resolve_private_app_file('config.php') === null,
        'A non-HTML private file was accepted.'
    );

    $transformed = spine_strip_embedded_csp($fixtureHtml);
    $check(
        stripos($transformed, 'http-equiv="Content-Security-Policy"') === false,
        'Embedded fixture CSP was not removed.'
    );
    $transformed = spine_enable_server_authenticated_launch($transformed);
    $check(
        substr_count($transformed, '__SPINE_SERVER_AUTHENTICATED__') === 2,
        'Authenticated launch bootstrap/replacement was incomplete.'
    );
    // S3: a "<body>" mentioned inside head raw text (a CSS comment, a script
    // string, an HTML comment) must not receive the bootstrap; the real body
    // start tag must.
    $decoyHtml = "<!doctype html><html><head>\n<!-- <body> in a comment -->\n"
        . "<style>/* appended to <body class=\"x\">, so */ .a{}</style>\n"
        . "<script>var s = '<body>';</script>\n"
        . "</head><body data-real=\"1\"><script>var CODE_DIGEST='fixture';var unlocked = readStored() === CODE_DIGEST;</script></body></html>";
    $decoyOut = spine_enable_server_authenticated_launch($decoyHtml);
    $check(
        str_contains($decoyOut, '<body data-real="1"><script>window.__SPINE_SERVER_AUTHENTICATED__=true;</script>')
            && substr_count($decoyOut, 'window.__SPINE_SERVER_AUTHENTICATED__=true;') === 1
            && str_contains($decoyOut, "/* appended to <body class=\"x\">, so */ .a{}</style>"),
        'The authenticated bootstrap was not placed as the first child of the real <body>.'
    );
    $nonce = base64_encode(random_bytes(32));
    $transformed = spine_apply_script_nonce($transformed, $nonce);
    $check(
        preg_match_all('~<script\b(?![^>]*\bnonce=)~i', $transformed) === 0,
        'At least one fixture script lacks a nonce.'
    );
    $testEtag = '"' . str_repeat('a', 64) . '"';
    $check(spine_if_none_match_matches($testEtag, $testEtag), 'Strong ETag did not match.');
    $check(spine_if_none_match_matches('W/' . $testEtag, $testEtag), 'Weak ETag did not match.');
    $check(
        spine_if_none_match_matches('"' . str_repeat('a', 64) . '-gzip"', $testEtag),
        'Apache gzip-suffixed ETag did not match.'
    );
    $check(
        !spine_if_none_match_matches('"' . str_repeat('b', 64) . '"', $testEtag),
        'Unrelated ETag matched.'
    );

    $shippedHtmlPath = $deployRoot . DIRECTORY_SEPARATOR . 'private'
        . DIRECTORY_SEPARATOR . 'spine_simulator.html';
    // The private build is produced from source (node tools/build.js --sync-deploy writes it
    // and a .sha256 beside it); a fresh clone of the public repository has none, so the
    // shipped-HTML checks are skipped rather than failed there.
    $shippedHtml = is_file($shippedHtmlPath) ? file_get_contents($shippedHtmlPath) : null;
    if ($shippedHtml === null) {
        fwrite(STDOUT, "note: deploy/private/spine_simulator.html is not staged; shipped-HTML checks skipped.\n");
    }
    $expectedHashFile = $shippedHtmlPath . '.sha256';
    if (is_string($shippedHtml) && is_file($expectedHashFile)) {
        $check(
            hash_file('sha256', $shippedHtmlPath) === trim((string) file_get_contents($expectedHashFile)),
            'The staged private simulator HTML does not match its recorded SHA-256.'
        );
    }
    if (is_string($shippedHtml)) {
        $check(strlen($shippedHtml) > 3_000_000, 'Shipped HTML is missing/truncated.');
    }
    $shippedHtml = is_string($shippedHtml) ? $shippedHtml : false;
    if (is_string($shippedHtml)) {
        $servedCopy = spine_strip_embedded_csp($shippedHtml);
        $servedCopy = spine_enable_server_authenticated_launch($servedCopy);
        // S3: in the real build the head <style> mentions "<body>" in a comment;
        // the bootstrap must still be the first child of the real body.
        $servedBody = spine_document_body_tag_offset($servedCopy);
        $servedBootstrap = '<script>window.__SPINE_SERVER_AUTHENTICATED__=true;</script>';
        $check(
            $servedBody !== null
                && substr($servedCopy, $servedBody[0] + $servedBody[1], strlen($servedBootstrap)) === $servedBootstrap
                && substr_count($servedCopy, $servedBootstrap) === 1,
            'The shipped app bootstrap is not the first child of the real <body>.'
        );
        $servedCopy = spine_apply_script_nonce($servedCopy, $nonce);
        $check(
            preg_match_all('~<script\b(?![^>]*\bnonce=)~i', $servedCopy) === 0,
            'At least one shipped app script lacks a response nonce.'
        );
        $check(
            stripos($servedCopy, 'http-equiv="Content-Security-Policy"') === false,
            'The shipped app retained a conflicting meta CSP in its served copy.'
        );
    }
    unset($shippedHtml, $servedCopy);

    // Seven failures against admin, then a successful reservation for another
    // account. That success must not erase the admin account bucket.
    for ($attempt = 1; $attempt <= 7; $attempt++) {
        $reservation = spine_reserve_login_attempt('admin');
        $check(
            $reservation['storage_ok'] && $reservation['allowed']
                && is_string($reservation['token']),
            "Admin failure reservation {$attempt} was refused too early."
        );
        if (is_string($reservation['token'])) {
            $check(
                spine_resolve_login_attempt('admin', $reservation['token'], false),
                "Admin failure reservation {$attempt} could not be recorded."
            );
        }
    }
    $other = spine_reserve_login_attempt('tester');
    $check(
        $other['storage_ok'] && $other['allowed'] && is_string($other['token']),
        'A different account could not reserve a login attempt.'
    );
    if (is_string($other['token'])) {
        $check(
            spine_resolve_login_attempt('tester', $other['token'], true),
            'Successful reservation cleanup failed.'
        );
    }
    $eighth = spine_reserve_login_attempt('admin');
    $check($eighth['allowed'] && is_string($eighth['token']), 'Eighth account attempt was not allowed.');
    if (is_string($eighth['token'])) {
        spine_resolve_login_attempt('admin', $eighth['token'], false);
    }
    $ninth = spine_reserve_login_attempt('admin');
    $check(
        $ninth['storage_ok'] && !$ninth['allowed'],
        'Ninth account attempt was not locked.'
    );
    $check(spine_attempts_remaining('admin') === 0, 'Locked account reported attempts remaining.');

    $rateFile = spine_rate_state_file();
    $check(is_string($rateFile) && is_file($rateFile), 'Rate-limit state file was not created.');
    if (is_string($rateFile)) {
        file_put_contents($rateFile, '{broken-json', LOCK_EX);
        $corrupt = spine_reserve_login_attempt('corruption-check');
        $check(
            !$corrupt['storage_ok'] && !$corrupt['allowed'],
            'Corrupt rate-limit JSON did not fail closed.'
        );
        foreach ([
            '{}',
            '[]',
            '{"schema":1,"ip":[],"accounts":{"bad-key":[{"t":1,"id":"bad"}]}}',
            '{"schema":2,"ip":[],"accounts":[]}',
        ] as $invalidState) {
            file_put_contents($rateFile, $invalidState, LOCK_EX);
            $corrupt = spine_reserve_login_attempt('semantic-corruption-check');
            $check(
                !$corrupt['storage_ok'] && !$corrupt['allowed'],
                "Semantically invalid rate state was accepted: {$invalidState}"
            );
        }
        file_put_contents($rateFile, '', LOCK_EX);
    }

    $originalUsers = spine_config()['users'];
    $originalRevision = spine_users_revision($originalUsers);
    $expandedUsers = $originalUsers;
    $expandedUsers[] = [
        'id' => 'third',
        'name' => 'Third User',
        'email' => '',
        'hash' => $testerHash,
        'admin' => false,
        'disabled' => false,
        'session_version' => 1,
    ];
    $check(
        spine_save_users($expandedUsers, $originalRevision),
        'Revision-matched account update failed: ' . spine_last_user_store_error()
    );
    $check(
        !spine_save_users($originalUsers, $originalRevision)
            && spine_last_user_store_error() === 'conflict',
        'A stale account revision overwrote a newer update.'
    );

    spine_start_session();
    $_SESSION['issued_at'] = time() - SPINE_ABSOLUTE_LIMIT - 1;
    $_SESSION['last_seen'] = time() - SPINE_IDLE_TIMEOUT - 1;
    $expiredSessionId = session_id();
    session_write_close();
    $_COOKIE[SPINE_SESSION_NAME] = $expiredSessionId;
    spine_start_session();
    $check(session_status() === PHP_SESSION_ACTIVE, 'Expiry did not restart an anonymous session.');
    $check(
        session_id() !== '' && !hash_equals($expiredSessionId, session_id()),
        'Expired session id was reused.'
    );
    $check(
        !isset($_COOKIE[SPINE_SESSION_NAME]),
        'Expired session cookie remained available inside the request.'
    );
    $freshCsrf = spine_csrf_token();
    $check(spine_csrf_valid($freshCsrf), 'Fresh anonymous session did not retain its CSRF token.');
    $check(!spine_csrf_valid(['malformed']), 'Array-shaped CSRF input was not safely rejected.');
    $_POST['malformed'] = ['value'];
    $check(spine_post_string('malformed') === '', 'Array-shaped form value was not safely rejected.');
    unset($_POST['malformed']);
    $check(strlen(spine_csrf_token()) === 64, 'CSRF token has an unexpected length.');
    $check(spine_attempt_login('admin', $adminPassword), 'Valid test administrator login failed.');
    $check(spine_is_admin(), 'Logged-in administrator lacks administrator status.');
    $liveUsers = spine_config()['users'];
    $liveRevision = spine_users_revision($liveUsers);
    foreach ($liveUsers as &$liveUser) {
        if ((string) $liveUser['id'] === 'admin') {
            $liveUser['disabled'] = true;
            $liveUser['session_version'] = (int) $liveUser['session_version'] + 1;
        }
    }
    unset($liveUser);
    $check(
        spine_save_users($liveUsers, $liveRevision),
        'Could not persist the session-revocation fixture.'
    );
    $check(!spine_is_authenticated(), 'Disabled account session was not revoked immediately.');

    $auditPath = $privateDir . DIRECTORY_SEPARATOR . 'state'
        . DIRECTORY_SEPARATOR . 'access.log';
    $audit = is_file($auditPath) ? file_get_contents($auditPath) : false;
    $check(is_string($audit) && str_contains($audit, 'session_revoked'), 'Session revocation was not audited.');

    $manifestPath = $deployRoot . DIRECTORY_SEPARATOR . 'htdocs'
        . DIRECTORY_SEPARATOR . 'manifest.webmanifest';
    $manifest = json_decode((string) file_get_contents($manifestPath), true);
    $check(is_array($manifest) && ($manifest['start_url'] ?? '') === './app.php', 'Manifest start URL is not gated.');
    $check(is_array($manifest) && ($manifest['scope'] ?? '') === './', 'Manifest scope changed.');
    foreach (['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'] as $icon) {
        $path = $deployRoot . DIRECTORY_SEPARATOR . 'htdocs' . DIRECTORY_SEPARATOR . $icon;
        $info = @getimagesize($path);
        $check(is_array($info) && ($info[2] ?? null) === IMAGETYPE_PNG, "{$icon} is not a readable PNG.");
    }

    $adminSource = (string) file_get_contents(
        $deployRoot . DIRECTORY_SEPARATOR . 'htdocs' . DIRECTORY_SEPARATOR . 'admin.php'
    );
    $logoutSource = (string) file_get_contents(
        $deployRoot . DIRECTORY_SEPARATOR . 'htdocs' . DIRECTORY_SEPARATOR . 'logout.php'
    );
    $appSource = (string) file_get_contents(
        $deployRoot . DIRECTORY_SEPARATOR . 'htdocs' . DIRECTORY_SEPARATOR . 'app.php'
    );
    $authSource = (string) file_get_contents(
        $deployRoot . DIRECTORY_SEPARATOR . 'htdocs' . DIRECTORY_SEPARATOR . 'lib'
            . DIRECTORY_SEPARATOR . 'auth.php'
    );
    $apacheSource = (string) file_get_contents(
        $deployRoot . DIRECTORY_SEPARATOR . 'htdocs' . DIRECTORY_SEPARATOR . '.htaccess'
    );
    $check(!str_contains($adminSource, 'onsubmit='), 'Admin page still depends on inline confirmation JavaScript.');
    $check(str_contains($adminSource, 'users_revision'), 'Admin forms lack optimistic revision binding.');
    $check(
        str_contains($logoutSource, "REQUEST_METHOD'] !== 'POST'")
            && str_contains($logoutSource, 'spine_csrf_valid'),
        'Logout is not POST-and-CSRF constrained.'
    );
    $check(
        str_contains($appSource, 'spine_resolve_private_app_file')
            && str_contains($appSource, 'spine_apply_script_nonce')
            && str_contains($appSource, 'app_revalidated'),
        'App delivery confinement, nonce, or 304 audit hook is missing.'
    );
    $check(
        str_contains($authSource, 'clearstatcache(true, $path)')
            && str_contains($authSource, 'opcache_invalidate($path, true)')
            && str_contains($authSource, "'cache_refresh_failed'"),
        'Account-store OPcache invalidation/verification is missing.'
    );
    $check(!str_contains($apacheSource, '%{HTTP_HOST}'), 'Apache still constructs redirects from HTTP_HOST.');
    $check(
        str_contains($apacheSource, 'RewriteRule \\.(html|htm)$ - [F,L,NC]')
            && str_contains($apacheSource, '<FilesMatch "(?i:'),
        'Apache sensitive-extension rules are not case-insensitive.'
    );
    $check(
        str_contains($apacheSource, '(auth|config)\\.php(?:[.~_-].*)?'),
        'Apache does not deny sensitive PHP backup/temp names.'
    );
    $check(
        str_contains($apacheSource, 'RewriteRule ^private(?:/|$)')
            && str_contains($apacheSource, '\\.log(?:\\.[0-9]+)?'),
        'Apache does not deny the fallback private tree and rotated audit logs.'
    );
    $check(
        str_contains($apacheSource, 'manifest.webmanifest')
            && str_contains($apacheSource, 'public, no-cache, must-revalidate')
            && !str_contains($apacheSource, 'immutable'),
        'Manifest/icon revalidation policy is missing or stale-prone.'
    );
} catch (Throwable $error) {
    $failures[] = 'Uncaught ' . get_class($error) . ': ' . $error->getMessage();
}

$removeTree = static function (string $path) use (&$removeTree): void {
    if (!is_dir($path)) {
        @unlink($path);
        return;
    }
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $removeTree($path . DIRECTORY_SEPARATOR . $entry);
    }
    @rmdir($path);
};
$removeTree($tempRoot);
putenv('SPINE_PRIVATE_DIR');

if ($failures !== []) {
    fwrite(STDERR, "Deployment smoke tests FAILED ({$passes} passed, "
        . count($failures) . " failed):\n");
    foreach ($failures as $failure) {
        fwrite(STDERR, " - {$failure}\n");
    }
    exit(1);
}

fwrite(STDOUT, "Deployment smoke tests passed: {$passes} assertions.\n");
