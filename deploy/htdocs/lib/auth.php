<?php
declare(strict_types=1);

/**
 * Shared authentication, authorization, session hardening, rate limiting,
 * audit logging, secure app delivery helpers, and account-store persistence.
 *
 * Every public PHP entry point must require this file before producing output.
 */

const SPINE_SESSION_NAME          = '__Host-spine_sid';
const SPINE_IDLE_TIMEOUT          = 3600;
const SPINE_ABSOLUTE_LIMIT        = 43200;
const SPINE_ACCOUNT_MAX_ATTEMPTS  = 8;
const SPINE_IP_MAX_ATTEMPTS       = 30;
const SPINE_LOCKOUT_WINDOW        = 900;
const SPINE_PASSWORD_MIN_BYTES    = 12;
const SPINE_PASSWORD_MAX_BYTES    = 72; // bcrypt ignores bytes beyond this point
const SPINE_AUDIT_MAX_BYTES       = 5_242_880;

/* ---------------------------------------------------------- configuration */

function spine_fail(string $message): never
{
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store, private');
    echo "Server configuration error.\n";
    error_log('[spine] ' . $message);
    exit;
}

/** @return array<int,array<string,mixed>> */
function spine_validate_users(mixed $candidate): array
{
    if (!is_array($candidate) || $candidate === []) {
        spine_fail('Configuration contains no users.');
    }

    $seen = [];
    $users = [];
    $hasActiveAdmin = false;

    foreach ($candidate as $index => $raw) {
        if (!is_array($raw)) {
            spine_fail("User record {$index} is not an array.");
        }
        $id = trim((string) ($raw['id'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $id)) {
            spine_fail("User record {$index} has an invalid id.");
        }
        $folded = strtolower($id);
        if (isset($seen[$folded])) {
            spine_fail("Duplicate user id: {$id}.");
        }
        $seen[$folded] = true;

        $hash = (string) ($raw['hash'] ?? '');
        $hashInfo = password_get_info($hash);
        if ($hash === '' || $hash === 'REPLACE_WITH_HASH_FROM_make-hash.php'
            || (($hashInfo['algoName'] ?? 'unknown') === 'unknown')) {
            spine_fail("User {$id} does not have a usable password hash.");
        }

        $sessionVersion = max(1, (int) ($raw['session_version'] ?? 1));
        $normalized = [
            'id'              => $id,
            'name'            => trim((string) ($raw['name'] ?? $id)) ?: $id,
            'email'           => trim((string) ($raw['email'] ?? '')),
            'hash'            => $hash,
            'admin'           => !empty($raw['admin']),
            'disabled'        => !empty($raw['disabled']),
            'session_version' => $sessionVersion,
        ];
        if ($normalized['email'] !== '' && !filter_var($normalized['email'], FILTER_VALIDATE_EMAIL)) {
            spine_fail("User {$id} has an invalid email address.");
        }
        if ($normalized['admin'] && !$normalized['disabled']) {
            $hasActiveAdmin = true;
        }
        $users[] = $normalized;
    }

    if (!$hasActiveAdmin) {
        spine_fail('Configuration contains no enabled administrator.');
    }
    return $users;
}

function spine_validate_config(array $loaded, string $path): array
{
    $loaded['users'] = spine_validate_users($loaded['users'] ?? null);

    $origin = trim((string) ($loaded['canonical_origin'] ?? ''));
    $originPort = parse_url($origin, PHP_URL_PORT);
    if (!preg_match('~^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$~', $origin)
        || filter_var($origin, FILTER_VALIDATE_URL) === false
        || (is_int($originPort) && ($originPort < 1 || $originPort > 65535))) {
        spine_fail('canonical_origin must be an HTTPS origin without a path: ' . $path);
    }
    $loaded['canonical_origin'] = rtrim($origin, '/');

    $trusted = $loaded['trusted_proxy_ips'] ?? [];
    if (!is_array($trusted)) {
        spine_fail('trusted_proxy_ips must be an array.');
    }
    $loaded['trusted_proxy_ips'] = array_values(array_filter(
        array_map(static fn (mixed $item): string => trim((string) $item), $trusted),
        static fn (string $item): bool => $item !== ''
    ));
    foreach ($loaded['trusted_proxy_ips'] as $rule) {
        [$address, $prefixText] = array_pad(explode('/', (string) $rule, 2), 2, null);
        $packed = @inet_pton($address);
        $valid = $packed !== false;
        if ($prefixText !== null) {
            $valid = $valid && $prefixText !== '' && ctype_digit($prefixText)
                && (int) $prefixText <= strlen($packed) * 8;
        }
        if (!$valid) {
            spine_fail('trusted_proxy_ips contains an invalid IP address or CIDR: ' . $rule);
        }
    }

    $mode = (string) ($loaded['watermark'] ?? 'visible');
    if (!in_array($mode, ['visible', 'hidden', 'off'], true)) {
        spine_fail('watermark must be visible, hidden, or off.');
    }
    $loaded['watermark'] = $mode;
    return $loaded;
}

function spine_invalidate_php_file_cache(string $path): void
{
    clearstatcache(true, $path);
    if (function_exists('opcache_invalidate')) {
        // False also means "not cached", which is safe; the following require
        // will read the file from disk in that case.
        @opcache_invalidate($path, true);
    }
}

function spine_config(bool $reload = false): array
{
    static $config = null;
    if ($config !== null && !$reload) {
        return $config;
    }
    $config = null;

    $candidates = [];
    $environmentDir = getenv('SPINE_PRIVATE_DIR');
    if (is_string($environmentDir) && trim($environmentDir) !== '') {
        $candidates[] = rtrim(trim($environmentDir), '/\\') . '/config.php';
    }
    $candidates[] = __DIR__ . '/../../spine-private/config.php'; // documented preferred layout
    $candidates[] = __DIR__ . '/../../private/config.php';       // legacy sibling layout
    $candidates[] = __DIR__ . '/../private/config.php';          // web-root fallback

    foreach (array_unique($candidates) as $candidate) {
        $resolved = realpath($candidate);
        if ($resolved === false || !is_file($resolved) || !is_readable($resolved)) {
            continue;
        }
        spine_invalidate_php_file_cache($resolved);
        /** @var mixed $loaded */
        $loaded = require $resolved;
        if (!is_array($loaded)) {
            spine_fail('Configuration did not return an array: ' . $resolved);
        }
        $loaded = spine_validate_config($loaded, $resolved);
        $loaded['private_dir'] = dirname($resolved);
        $loaded['config_path'] = $resolved;
        $config = $loaded;
        return $config;
    }

    spine_fail(
        'Configuration not found. Set SPINE_PRIVATE_DIR or place config.php in '
        . '~/spine-private as documented.'
    );
}

function spine_canonical_origin(): string
{
    return (string) spine_config()['canonical_origin'];
}

function spine_ip_matches_rule(string $ip, string $rule): bool
{
    if (!str_contains($rule, '/')) {
        $addressBytes = @inet_pton($ip);
        $ruleBytes = @inet_pton($rule);
        return is_string($addressBytes) && is_string($ruleBytes)
            && strlen($addressBytes) === strlen($ruleBytes)
            && hash_equals($ruleBytes, $addressBytes);
    }
    [$network, $prefixText] = array_pad(explode('/', $rule, 2), 2, '');
    $addressBytes = @inet_pton($ip);
    $networkBytes = @inet_pton($network);
    if ($addressBytes === false || $networkBytes === false
        || strlen($addressBytes) !== strlen($networkBytes)
        || !ctype_digit($prefixText)) {
        return false;
    }
    $prefix = (int) $prefixText;
    $maxBits = strlen($addressBytes) * 8;
    if ($prefix < 0 || $prefix > $maxBits) {
        return false;
    }
    $wholeBytes = intdiv($prefix, 8);
    $remainingBits = $prefix % 8;
    if ($wholeBytes > 0
        && substr($addressBytes, 0, $wholeBytes) !== substr($networkBytes, 0, $wholeBytes)) {
        return false;
    }
    if ($remainingBits === 0) {
        return true;
    }
    $mask = (0xFF << (8 - $remainingBits)) & 0xFF;
    return (ord($addressBytes[$wholeBytes]) & $mask) === (ord($networkBytes[$wholeBytes]) & $mask);
}

function spine_ip_is_trusted_proxy(string $ip): bool
{
    foreach (spine_config()['trusted_proxy_ips'] as $rule) {
        if (spine_ip_matches_rule($ip, (string) $rule)) {
            return true;
        }
    }
    return false;
}

function spine_remote_is_trusted_proxy(): bool
{
    return spine_ip_is_trusted_proxy((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
}

function spine_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443) {
        return true;
    }
    if (!spine_remote_is_trusted_proxy()) {
        return false;
    }
    $forwarded = array_map(
        static fn (string $value): string => strtolower(trim($value)),
        explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))
    );
    // The allowlisted edge must overwrite/sanitize this header. A list is
    // ambiguous and may contain a client-supplied leftmost value, so reject it.
    return count($forwarded) === 1 && $forwarded[0] === 'https';
}

function spine_require_https(): void
{
    $origin = spine_canonical_origin();
    $expectedAuthority = strtolower((string) parse_url($origin, PHP_URL_HOST));
    $originPort = parse_url($origin, PHP_URL_PORT);
    if (is_int($originPort) && $originPort !== 443) {
        $expectedAuthority .= ':' . $originPort;
    }
    $requestAuthority = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    if (preg_match('/^([a-z0-9.-]+):443$/', $requestAuthority, $defaultPortMatch)) {
        $requestAuthority = $defaultPortMatch[1];
    }
    if (spine_is_https() && $requestAuthority !== ''
        && hash_equals($expectedAuthority, $requestAuthority)) {
        return;
    }
    $uri = str_replace(["\r", "\n"], '', (string) ($_SERVER['REQUEST_URI'] ?? '/'));
    if ($uri === '' || $uri[0] !== '/') {
        $uri = '/';
    }
    header('Location: ' . $origin . $uri, true, 308);
    exit;
}

function spine_security_headers(bool $isAppPage = false, ?string $scriptNonce = null): void
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Frame-Options: DENY');
    header('X-Permitted-Cross-Domain-Policies: none');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    if (spine_is_https()) {
        $hsts = 'max-age=31536000';
        if (!empty(spine_config()['hsts_include_subdomains'])) {
            $hsts .= '; includeSubDomains';
        }
        header('Strict-Transport-Security: ' . $hsts);
    }

    if ($isAppPage) {
        if (!is_string($scriptNonce) || !preg_match('/^[A-Za-z0-9+\/=]+$/', $scriptNonce)) {
            spine_fail('An app response requires a valid CSP nonce.');
        }
        $csp = "default-src 'self'; script-src 'nonce-{$scriptNonce}'; script-src-attr 'none'; "
             . "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
             . "connect-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; "
             . "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
    } else {
        $csp = "default-src 'self'; script-src 'none'; script-src-attr 'none'; "
             . "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; "
             . "media-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; "
             . "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
    }
    header('Content-Security-Policy: ' . $csp);
}

/* --------------------------------------------------------------- storage */

function spine_private_state_dir(): ?string
{
    $private = (string) spine_config()['private_dir'];
    $dir = $private . DIRECTORY_SEPARATOR . 'state';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        error_log('[spine] could not create private state directory: ' . $dir);
        return null;
    }
    @chmod($dir, 0700);
    if (!is_dir($dir) || !is_readable($dir) || !is_writable($dir)) {
        error_log('[spine] private state directory is not readable and writable: ' . $dir);
        return null;
    }
    return $dir;
}

/* -------------------------------------------------------------- sessions */

function spine_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_secure', '1');
    session_name(SPINE_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    if (!session_start()) {
        spine_fail('Could not start the PHP session.');
    }

    $now = time();
    $issued = $_SESSION['issued_at'] ?? null;
    $seen = $_SESSION['last_seen'] ?? null;
    if ($issued !== null && ($now - (int) $issued) >= SPINE_ABSOLUTE_LIMIT) {
        spine_restart_anonymous_session($now);
        return;
    }
    if ($seen !== null && ($now - (int) $seen) >= SPINE_IDLE_TIMEOUT) {
        spine_restart_anonymous_session($now);
        return;
    }
    $_SESSION['last_seen'] = $now;
}

function spine_find_user(string $id): ?array
{
    foreach (spine_config()['users'] as $user) {
        if (hash_equals((string) $user['id'], $id)) {
            return $user;
        }
    }
    return null;
}

function spine_account_auth_fingerprint(array $user): string
{
    return hash('sha256', implode("\0", [
        (string) ($user['id'] ?? ''),
        (string) ($user['hash'] ?? ''),
        !empty($user['admin']) ? '1' : '0',
        !empty($user['disabled']) ? '1' : '0',
        (string) max(1, (int) ($user['session_version'] ?? 1)),
    ]));
}

function spine_refresh_session_user(): bool
{
    $sessionUser = $_SESSION['user'] ?? null;
    if (!is_array($sessionUser) || empty($_SESSION['issued_at'])) {
        return false;
    }
    $id = (string) ($sessionUser['id'] ?? '');
    $record = $id !== '' ? spine_find_user($id) : null;
    $expected = is_array($record) ? spine_account_auth_fingerprint($record) : '';
    $actual = (string) ($_SESSION['auth_fingerprint'] ?? '');
    if ($record === null || !empty($record['disabled']) || $actual === ''
        || !hash_equals($expected, $actual)) {
        spine_audit('session_revoked', 'account state changed');
        spine_logout();
        return false;
    }
    $_SESSION['user'] = [
        'id'    => (string) $record['id'],
        'name'  => (string) $record['name'],
        'email' => (string) $record['email'],
        'admin' => !empty($record['admin']),
    ];
    return true;
}

function spine_is_authenticated(): bool
{
    return session_status() === PHP_SESSION_ACTIVE && spine_refresh_session_user();
}

function spine_current_user(): ?array
{
    return spine_is_authenticated() ? (array) $_SESSION['user'] : null;
}

function spine_logout(): void
{
    $cookieName = session_name();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie($cookieName, '', [
            'expires'  => time() - 42000,
            'path'     => (string) ($params['path'] ?? '/'),
            'secure'   => true,
            'httponly' => true,
            'samesite' => (string) ($params['samesite'] ?? 'Strict'),
        ]);
    }
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    unset($_COOKIE[$cookieName]);
    if (session_status() === PHP_SESSION_NONE) {
        session_id('');
    }
}

function spine_restart_anonymous_session(?int $now = null): void
{
    spine_logout();
    if (!session_start()) {
        spine_fail('Could not restart an anonymous session after expiry.');
    }
    $_SESSION['last_seen'] = $now ?? time();
}

function spine_csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['csrf'];
}

function spine_csrf_valid(mixed $token): bool
{
    return is_string($token)
        && !empty($_SESSION['csrf'])
        && hash_equals((string) $_SESSION['csrf'], $token);
}

function spine_post_string(string $key): string
{
    $value = $_POST[$key] ?? null;
    return is_string($value) ? $value : '';
}

/* ---------------------------------------------------------- rate limiting */

function spine_client_ip(): string
{
    $remote = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    if (filter_var($remote, FILTER_VALIDATE_IP) === false) {
        return 'unknown';
    }
    if (!spine_ip_is_trusted_proxy($remote)) {
        return $remote;
    }

    // Walk the X-Forwarded-For chain from the trusted transport peer toward
    // the client. Stop at the first untrusted hop, so user-supplied entries to
    // its left cannot choose their own rate-limit/audit identity.
    $raw = trim((string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    if ($raw === '') {
        return $remote;
    }
    $chain = array_map('trim', explode(',', $raw));
    if (count($chain) > 32) {
        return $remote;
    }
    foreach ($chain as $address) {
        if (filter_var($address, FILTER_VALIDATE_IP) === false) {
            return $remote;
        }
    }
    $current = $remote;
    for ($index = count($chain) - 1; $index >= 0; $index--) {
        if (!spine_ip_is_trusted_proxy($current)) {
            break;
        }
        $current = $chain[$index];
    }
    return $current;
}

function spine_rate_state_file(): ?string
{
    $dir = spine_private_state_dir();
    return $dir === null ? null : $dir . DIRECTORY_SEPARATOR . 'login-attempts.json';
}

/** @return array{schema:int,ip:array<string,array<int,array{t:int,id:string}>>,accounts:array<string,array<int,array{t:int,id:string}>>}|null */
function spine_normalize_rate_state(mixed $raw): ?array
{
    if ($raw === null || $raw === '') {
        return ['schema' => 1, 'ip' => [], 'accounts' => []];
    }
    if (!is_array($raw) || ($raw['schema'] ?? null) !== 1
        || !is_array($raw['ip'] ?? null) || !is_array($raw['accounts'] ?? null)) {
        return null;
    }
    $windowStart = time() - SPINE_LOCKOUT_WINDOW;
    $normalized = ['schema' => 1, 'ip' => [], 'accounts' => []];
    foreach (['ip', 'accounts'] as $section) {
        $buckets = is_array($raw[$section] ?? null) ? $raw[$section] : [];
        foreach ($buckets as $key => $entries) {
            if (!is_string($key) || !preg_match('/^[a-f0-9]{64}$/', $key)
                || !is_array($entries)) {
                return null;
            }
            $clean = [];
            foreach ($entries as $entry) {
                if (!is_array($entry) || !is_int($entry['t'] ?? null)
                    || (int) $entry['t'] <= 0
                    || !is_string($entry['id'] ?? null)
                    || !preg_match('/^[a-f0-9]{32}$/', (string) $entry['id'])) {
                    return null;
                }
                $timestamp = (int) ($entry['t'] ?? 0);
                $id = (string) ($entry['id'] ?? '');
                if ($timestamp >= $windowStart && $id !== '') {
                    $clean[] = ['t' => $timestamp, 'id' => $id];
                }
            }
            if ($clean !== []) {
                $normalized[$section][$key] = $clean;
            }
        }
    }
    return $normalized;
}

/**
 * Runs a mutation while holding the only login-attempt state lock.
 * Returning null means storage was unavailable or corrupt; callers fail closed.
 */
function spine_mutate_rate_state(callable $mutation): mixed
{
    $path = spine_rate_state_file();
    if ($path === null) {
        return null;
    }
    $handle = @fopen($path, 'c+b');
    if ($handle === false) {
        error_log('[spine] could not open login-attempt state.');
        return null;
    }
    @chmod($path, 0600);
    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        error_log('[spine] could not lock login-attempt state.');
        return null;
    }

    rewind($handle);
    $bytes = stream_get_contents($handle);
    if ($bytes === false) {
        flock($handle, LOCK_UN);
        fclose($handle);
        error_log('[spine] could not read login-attempt state.');
        return null;
    }
    $decoded = $bytes === '' ? null : json_decode($bytes, true);
    if ($bytes !== '' && json_last_error() !== JSON_ERROR_NONE) {
        flock($handle, LOCK_UN);
        fclose($handle);
        error_log('[spine] login-attempt state contains invalid JSON; refusing open access.');
        return null;
    }
    $state = spine_normalize_rate_state($decoded);
    if ($state === null) {
        flock($handle, LOCK_UN);
        fclose($handle);
        error_log('[spine] login-attempt state is corrupt; refusing open access.');
        return null;
    }

    $result = $mutation($state);
    $encoded = json_encode($state, JSON_UNESCAPED_SLASHES);
    $written = false;
    if (is_string($encoded) && rewind($handle) && ftruncate($handle, 0)) {
        $written = fwrite($handle, $encoded) === strlen($encoded) && fflush($handle);
    }
    flock($handle, LOCK_UN);
    fclose($handle);
    if (!$written) {
        error_log('[spine] could not persist login-attempt state.');
        return null;
    }
    return $result;
}

function spine_rate_keys(string $username): array
{
    return [
        'ip'      => hash('sha256', spine_client_ip()),
        'account' => hash('sha256', strtolower(trim($username))),
    ];
}

/** @return array{allowed:bool,storage_ok:bool,token:?string,remaining:int} */
function spine_reserve_login_attempt(string $username): array
{
    $keys = spine_rate_keys($username);
    $result = spine_mutate_rate_state(
        static function (array &$state) use ($keys): array {
            $ipEntries = $state['ip'][$keys['ip']] ?? [];
            $accountEntries = $state['accounts'][$keys['account']] ?? [];
            $ipRemaining = SPINE_IP_MAX_ATTEMPTS - count($ipEntries);
            $accountRemaining = SPINE_ACCOUNT_MAX_ATTEMPTS - count($accountEntries);
            if ($ipRemaining <= 0 || $accountRemaining <= 0) {
                return ['allowed' => false, 'token' => null, 'remaining' => 0];
            }
            $token = bin2hex(random_bytes(16));
            $entry = ['t' => time(), 'id' => $token];
            $state['ip'][$keys['ip']][] = $entry;
            $state['accounts'][$keys['account']][] = $entry;
            return [
                'allowed'   => true,
                'token'     => $token,
                'remaining' => max(0, min($ipRemaining, $accountRemaining) - 1),
            ];
        }
    );
    if (!is_array($result)) {
        return ['allowed' => false, 'storage_ok' => false, 'token' => null, 'remaining' => 0];
    }
    return ['storage_ok' => true] + $result;
}

function spine_resolve_login_attempt(string $username, string $token, bool $succeeded): bool
{
    $keys = spine_rate_keys($username);
    $result = spine_mutate_rate_state(
        static function (array &$state) use ($keys, $token, $succeeded): bool {
            if (!$succeeded) {
                return true; // the reservation becomes the recorded failure
            }
            $state['ip'][$keys['ip']] = array_values(array_filter(
                $state['ip'][$keys['ip']] ?? [],
                static fn (array $entry): bool => !hash_equals((string) $entry['id'], $token)
            ));
            if ($state['ip'][$keys['ip']] === []) {
                unset($state['ip'][$keys['ip']]);
            }
            // A valid login clears failures only for that account. It cannot
            // clear guesses against another account or the aggregate IP bucket.
            unset($state['accounts'][$keys['account']]);
            return true;
        }
    );
    return $result === true;
}

function spine_attempts_remaining(string $username): int
{
    $keys = spine_rate_keys($username);
    $result = spine_mutate_rate_state(
        static function (array &$state) use ($keys): int {
            return max(0, min(
                SPINE_IP_MAX_ATTEMPTS - count($state['ip'][$keys['ip']] ?? []),
                SPINE_ACCOUNT_MAX_ATTEMPTS - count($state['accounts'][$keys['account']] ?? [])
            ));
        }
    );
    return is_int($result) ? $result : 0;
}

/* -------------------------------------------------------------- auditing */

function spine_audit_value(string $value, int $maxLength = 500): string
{
    $value = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) ?? '';
    return substr(trim($value), 0, $maxLength);
}

function spine_audit(string $event, string $detail = ''): bool
{
    if (empty(spine_config()['audit_log'])) {
        return true;
    }
    $dir = spine_private_state_dir();
    if ($dir === null) {
        return false;
    }
    $lockPath = $dir . DIRECTORY_SEPARATOR . 'audit.lock';
    $lock = @fopen($lockPath, 'c+b');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        error_log('[spine] could not lock the audit log.');
        return false;
    }
    @chmod($lockPath, 0600);

    $path = $dir . DIRECTORY_SEPARATOR . 'access.log';
    if (is_file($path) && (int) @filesize($path) >= SPINE_AUDIT_MAX_BYTES) {
        $rotated = $path . '.1';
        @unlink($rotated);
        if (!@rename($path, $rotated)) {
            error_log('[spine] could not rotate the audit log.');
        } else {
            @chmod($rotated, 0600);
        }
    }

    $line = sprintf(
        "%s\t%s\t%s\t%s\t%s\n",
        gmdate('c'),
        spine_audit_value($event, 80),
        spine_audit_value(spine_client_ip(), 80),
        spine_audit_value((string) ($_SESSION['user']['id'] ?? '-'), 80),
        spine_audit_value($detail)
    );
    $handle = @fopen($path, 'ab');
    $ok = false;
    if ($handle !== false) {
        @chmod($path, 0600);
        $ok = fwrite($handle, $line) === strlen($line) && fflush($handle);
        fclose($handle);
    }
    flock($lock, LOCK_UN);
    fclose($lock);
    if (!$ok) {
        error_log('[spine] could not append to the audit log.');
    }
    return $ok;
}

/* --------------------------------------------------------------- login */

function spine_attempt_login(string $username, string $password): bool
{
    $username = trim($username);
    $record = spine_find_user($username);

    // Always verify one supported hash so missing and disabled users have the
    // same dominant cost as a valid username with a wrong password.
    $usable = $record !== null && empty($record['disabled']);
    $hash = $usable
        ? (string) $record['hash']
        : '$2y$12$C6UzMDM.H6dfI/f/IKcEe.5tE6bmS0d5tqW1IBz1J0Aq1Br1sO0Aq';
    $lengthOk = strlen($password) >= SPINE_PASSWORD_MIN_BYTES
        && strlen($password) <= SPINE_PASSWORD_MAX_BYTES;
    $ok = password_verify($password, $hash) && $usable && $lengthOk;
    if (!$ok || $record === null) {
        return false;
    }

    if (!session_regenerate_id(true)) {
        spine_fail('Could not rotate the authenticated session id.');
    }
    $_SESSION['user'] = [
        'id'    => (string) $record['id'],
        'name'  => (string) $record['name'],
        'email' => (string) $record['email'],
        'admin' => !empty($record['admin']),
    ];
    $_SESSION['auth_fingerprint'] = spine_account_auth_fingerprint($record);
    $_SESSION['issued_at'] = time();
    $_SESSION['last_seen'] = time();
    unset($_SESSION['csrf']);
    spine_csrf_token();
    return true;
}

function spine_require_login(): void
{
    if (spine_is_authenticated()) {
        return;
    }
    header('Cache-Control: no-store, private');
    header('Location: index.php?expired=1', true, 302);
    exit;
}

function spine_is_admin(): bool
{
    return spine_is_authenticated() && !empty($_SESSION['user']['admin']);
}

function spine_require_admin(): void
{
    spine_require_login();
    if (spine_is_admin()) {
        return;
    }
    spine_audit('admin_denied');
    http_response_code(403);
    header('Cache-Control: no-store, private');
    header('Content-Type: text/plain; charset=utf-8');
    exit("Not authorised.\n");
}

/* ------------------------------------------------------ private app files */

function spine_resolve_private_app_file(string $configuredName): ?string
{
    $name = trim(str_replace('\\', '/', $configuredName));
    if ($name === '' || basename($name) !== $name || !str_ends_with(strtolower($name), '.html')) {
        return null;
    }
    $private = realpath((string) spine_config()['private_dir']);
    $candidate = $private === false ? false : realpath($private . DIRECTORY_SEPARATOR . $name);
    if ($private === false || $candidate === false || !is_file($candidate) || !is_readable($candidate)) {
        return null;
    }
    $prefix = rtrim($private, '/\\') . DIRECTORY_SEPARATOR;
    return str_starts_with($candidate, $prefix) ? $candidate : null;
}

function spine_ini_bytes(string $value): int
{
    $value = trim($value);
    if ($value === '' || $value === '-1') {
        return -1;
    }
    $unit = strtolower(substr($value, -1));
    $number = (int) $value;
    switch ($unit) {
        case 'g':
            return $number * 1024 * 1024 * 1024;
        case 'm':
            return $number * 1024 * 1024;
        case 'k':
            return $number * 1024;
        default:
            return $number;
    }
}

function spine_strip_embedded_csp(string $html): string
{
    $result = preg_replace(
        '~<meta\s+http-equiv=(["\'])Content-Security-Policy\1\s+content=(["\']).*?\2\s*/?>\s*~i',
        '',
        $html,
        1,
        $count
    );
    if (!is_string($result) || $count !== 1) {
        spine_fail('Expected exactly one embedded Content-Security-Policy meta tag.');
    }
    return $result;
}

function spine_enable_server_authenticated_launch(string $html): string
{
    $target = 'var unlocked = readStored() === CODE_DIGEST;';
    $replacement = 'var unlocked = window.__SPINE_SERVER_AUTHENTICATED__ === true || readStored() === CODE_DIGEST;';
    $result = str_replace($target, $replacement, $html, $count);
    if ($count !== 1) {
        spine_fail('Could not bind the client launch gate to the authenticated server session.');
    }
    $bootstrap = '<script>window.__SPINE_SERVER_AUTHENTICATED__=true;</script>';
    // The bootstrap must land in the real <body>, not in a "<body>" that a CSS
    // or script comment in <head> happens to mention, so <style>, <script> and
    // HTML comment raw text is skipped while looking for the tag.
    $bodyOffset = spine_document_body_tag_offset($result);
    if ($bodyOffset === null) {
        spine_fail('Could not insert the authenticated app bootstrap.');
    }
    [$tagStart, $tagLength] = $bodyOffset;
    $insertAt = $tagStart + $tagLength;
    return substr($result, 0, $insertAt) . $bootstrap . substr($result, $insertAt);
}

/**
 * Finds the document's own <body> start tag, ignoring any "<body" text inside
 * <style>, <script> or <!-- --> raw text. Returns [offset, length] or null.
 */
function spine_document_body_tag_offset(string $html): ?array
{
    $position = 0;
    $length = strlen($html);
    while ($position < $length) {
        if (!preg_match('~<!--|<(style|script)\b[^>]*>|<body\b[^>]*>~i', $html, $match, PREG_OFFSET_CAPTURE, $position)) {
            return null;
        }
        $token = $match[0][0];
        $offset = $match[0][1];
        if (strncmp($token, '<!--', 4) === 0) {
            $end = strpos($html, '-->', $offset + 4);
            if ($end === false) {
                return null;
            }
            $position = $end + 3;
            continue;
        }
        if (isset($match[1]) && $match[1][1] >= 0 && $match[1][0] !== '') {
            $element = strtolower($match[1][0]);
            $close = stripos($html, '</' . $element, $offset + strlen($token));
            if ($close === false) {
                return null;
            }
            $position = $close + strlen($element) + 2;
            continue;
        }
        return [$offset, strlen($token)];
    }
    return null;
}

function spine_apply_script_nonce(string $html, string $nonce): string
{
    if (!preg_match('/^[A-Za-z0-9+\/=]+$/', $nonce)) {
        spine_fail('Refused an invalid script nonce.');
    }
    $result = preg_replace(
        '~<script\b(?![^>]*\bnonce=)~i',
        '<script nonce="' . $nonce . '"',
        $html,
        -1,
        $count
    );
    if (!is_string($result) || $count < 1) {
        spine_fail('No script tags were available for CSP nonce binding.');
    }
    return $result;
}

function spine_if_none_match_matches(string $header, string $etag): bool
{
    if (!preg_match('/^"[a-f0-9]{64}"$/', $etag)) {
        return false;
    }
    foreach (explode(',', $header) as $rawValidator) {
        $validator = trim($rawValidator);
        if ($validator === '*') {
            return true;
        }
        if (str_starts_with($validator, 'W/')) {
            $validator = trim(substr($validator, 2));
        }
        // Some Apache compression configurations append a representation
        // suffix to an upstream ETag before returning it to the browser.
        $validator = preg_replace('/-(?:gzip|br)"$/i', '"', $validator) ?? $validator;
        if (hash_equals($etag, $validator)) {
            return true;
        }
    }
    return false;
}

/* ------------------------------------------------------- account storage */

function spine_users_revision(array $users): string
{
    $encoded = json_encode(array_values($users), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return hash('sha256', is_string($encoded) ? $encoded : '');
}

function spine_last_user_store_error(): string
{
    return (string) ($GLOBALS['SPINE_USER_STORE_ERROR'] ?? '');
}

function spine_save_users(array $users, ?string $expectedRevision = null): bool
{
    $GLOBALS['SPINE_USER_STORE_ERROR'] = '';
    $config = spine_config();
    $path = (string) $config['config_path'];
    $dir = (string) $config['private_dir'];
    if (!is_writable($path) || !is_writable($dir)) {
        $GLOBALS['SPINE_USER_STORE_ERROR'] = 'not_writable';
        error_log('[spine] config.php or its private directory is not writable.');
        return false;
    }

    $lockPath = $dir . DIRECTORY_SEPARATOR . 'config.lock';
    $lock = @fopen($lockPath, 'c+b');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        $GLOBALS['SPINE_USER_STORE_ERROR'] = 'lock_failed';
        return false;
    }
    @chmod($lockPath, 0600);

    try {
        spine_invalidate_php_file_cache($path);
        /** @var mixed $current */
        $current = require $path;
        if (!is_array($current)) {
            $GLOBALS['SPINE_USER_STORE_ERROR'] = 'invalid_current_config';
            return false;
        }
        $current = spine_validate_config($current, $path);
        if ($expectedRevision !== null
            && !hash_equals($expectedRevision, spine_users_revision($current['users']))) {
            $GLOBALS['SPINE_USER_STORE_ERROR'] = 'conflict';
            return false;
        }

        $validatedUsers = spine_validate_users($users);
        $settings = $current;
        unset($settings['users'], $settings['private_dir'], $settings['config_path']);

        $export = "<?php\ndeclare(strict_types=1);\n\n"
            . "// Written by admin.php under an exclusive store lock.\n"
            . "return [\n";
        foreach ($settings as $key => $value) {
            $export .= '    ' . var_export((string) $key, true)
                . ' => ' . var_export($value, true) . ",\n";
        }
        $export .= "    'users' => [\n";
        foreach ($validatedUsers as $user) {
            $export .= "        [\n";
            foreach (['id', 'name', 'email', 'hash'] as $field) {
                $export .= '            ' . var_export($field, true)
                    . ' => ' . var_export((string) $user[$field], true) . ",\n";
            }
            $export .= "            'admin' => " . ($user['admin'] ? 'true' : 'false') . ",\n";
            $export .= "            'disabled' => " . ($user['disabled'] ? 'true' : 'false') . ",\n";
            $export .= "            'session_version' => " . (int) $user['session_version'] . ",\n";
            $export .= "        ],\n";
        }
        $export .= "    ],\n];\n";

        $temp = @tempnam($dir, '.config-write-');
        if (!is_string($temp)) {
            $GLOBALS['SPINE_USER_STORE_ERROR'] = 'temp_failed';
            return false;
        }
        @chmod($temp, 0600);
        if (@file_put_contents($temp, $export, LOCK_EX) !== strlen($export)) {
            @unlink($temp);
            $GLOBALS['SPINE_USER_STORE_ERROR'] = 'write_failed';
            return false;
        }
        try {
            /** @var mixed $check */
            $check = include $temp;
            if (!is_array($check)) {
                throw new RuntimeException('Generated config did not return an array.');
            }
            spine_validate_config($check, $temp);
        } catch (Throwable $error) {
            @unlink($temp);
            error_log('[spine] refused generated config: ' . $error->getMessage());
            $GLOBALS['SPINE_USER_STORE_ERROR'] = 'validation_failed';
            return false;
        }
        if (!@rename($temp, $path)) {
            @unlink($temp);
            $GLOBALS['SPINE_USER_STORE_ERROR'] = 'rename_failed';
            return false;
        }
        @chmod($path, 0600);
        spine_invalidate_php_file_cache($path);
        /** @var mixed $installed */
        $installed = require $path;
        if (!is_array($installed)
            || !hash_equals(
                spine_users_revision($validatedUsers),
                spine_users_revision(is_array($installed['users'] ?? null) ? $installed['users'] : [])
            )) {
            $GLOBALS['SPINE_USER_STORE_ERROR'] = 'cache_refresh_failed';
            error_log('[spine] config.php was replaced but PHP did not expose the new account revision.');
            return false;
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }

    spine_config(true);
    return true;
}
