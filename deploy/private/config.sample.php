<?php
declare(strict_types=1);

/**
 * Copy this file to config.php and edit it. Never commit config.php anywhere
 * public, and never put a plaintext password in it.
 *
 * Generate each hash with tools/make-hash.php, then DELETE that tool.
 */

return [
    'site_title' => 'DeformitySim',
    'build_label' => 'v0.21.1 audited internal test',

    // REQUIRED: the exact public HTTPS origin, with no trailing slash or path.
    // Redirects never trust the request Host header.
    'canonical_origin' => 'https://yourdomain.example',

    // Only these transport peers may supply X-Forwarded-Proto. Use exact IPs
    // or CIDR ranges published/confirmed by your hosting provider. An empty
    // list is safest when PHP sees HTTPS directly.
    'trusted_proxy_ips' => [],

    // Leave false unless every subdomain is HTTPS and will remain so.
    'hsts_include_subdomains' => false,

    // Filename of the simulator, resolved inside this same private directory.
    'app_file' => 'spine_simulator.html',

    // 'visible'  subtle on-screen name + timestamp (recommended for testers)
    // 'hidden'   HTML comment and JS global only
    // 'off'      no user-identifying watermark or session trace
    'watermark' => 'visible',
    'watermark_include_email' => false,

    // The standalone/offline HTML keeps its client launch-code gate. Named
    // server authentication supersedes that shared code in this deployment.
    'client_launch_gate' => false,

    // Writes private/state/access.log: sign-ins, failures, and each app load.
    'audit_log' => true,

    // You only need to hand-create the FIRST admin. After that, sign in and use
    // admin.php to add, disable, delete and reset everyone else — it rewrites
    // this file for you, so it must stay writable by the web user.
    //
    // Individual accounts are what make the audit log and the watermark
    // meaningful; a shared login destroys both.
    'users' => [
        [
            'id'       => 'admin',
            'name'     => 'Site Owner',
            'email'    => 'you@example.com',
            // bcrypt hash from tools/make-hash.php — this placeholder is NOT a
            // usable password and must be replaced before going live.
            'hash'     => 'REPLACE_WITH_HASH_FROM_make-hash.php',
            'admin'    => true,   // may manage access
            'disabled' => false,
            // Incremented automatically on access/password/role changes.
            'session_version' => 1,
        ],
    ],
];
