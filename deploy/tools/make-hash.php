<?php
declare(strict_types=1);

/**
 * Password hash generator.
 *
 * Run it from the shell so the password never travels over the network:
 *
 *     php make-hash.php
 *
 * DELETE THIS FILE (or keep it outside the web root) once your hashes exist.
 * It refuses to run over HTTP for exactly that reason.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("This tool only runs from the command line.\n");
}

fwrite(STDOUT, "Password (input is echoed — run this somewhere private): ");
$password = rtrim((string) fgets(STDIN), "\r\n");

if (strlen($password) < 12 || strlen($password) > 72) {
    fwrite(STDERR, "Refusing: use 12–72 bytes (bcrypt ignores bytes after 72).\n");
    exit(1);
}

// cost 12 is a sensible 2020s default and comfortable on shared hosting.
$hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
if (!is_string($hash)) {
    fwrite(STDERR, "Hashing failed.\n");
    exit(1);
}

fwrite(STDOUT, "\nPaste this into the user's 'hash' field in private/config.php:\n\n");
fwrite(STDOUT, $hash . "\n\n");
fwrite(STDOUT, "Verification: " . (password_verify($password, $hash) ? "OK\n" : "FAILED\n"));
