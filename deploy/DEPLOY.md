# Deploying DeformitySim

This package puts the single-file simulator behind named PHP accounts on an
Apache/PHP host such as DreamHost. It is an internal research deployment, not a
medical device, diagnostic service, or validated clinical decision system.

## Security boundary

The browser must receive the HTML, JavaScript, algorithms, and anatomy assets in
order to run the simulator. A legitimate user can therefore copy them from
DevTools, the browser cache, or a proxy. Obfuscation and disabled context menus
do not change that.

The package provides:

- named accounts, hardened sessions, and immediate account-state revalidation;
- per-account and per-IP login throttling;
- a private, locked audit trail;
- optional visible or hidden per-user traceability;
- canonical HTTPS redirects and response security headers;
- raw HTML and private configuration denial at the web server.

It provides accountability and access control, not copy prevention.

This package is also **not, by itself, a HIPAA-compliant patient-data system**.
It has no BAA, encrypted clinical datastore, retention policy, access-review
workflow, breach process, or validated de-identification pipeline. Do not upload
or encode PHI in this build.

## File size and PHP memory (2026-08-23 build)

The application file now embeds the TensorFlow.js runtime, a DICOM decoder and a
base64 neural model and is ~67 MB. `app.php` reads it, applies the CSP/nonce/launch
transforms (several whole-string copies) and echoes it, so it raises `memory_limit` to
512M when the host default is lower; make sure the host permits that override (or set
it in `.user.ini` / the vhost). Enable gzip or brotli for `text/html` — the base64
payload compresses to roughly half. Expect first-open of ~5-10 s on a laptop and longer
on tablets; the neural model itself loads on first use (another ~2-13 s, then cached
in the page session). A DICOM-only build without the model (~4 MB) can be produced with
`node ai-tools/embed_ai_assets.js spine_simulator.html --no-model`.

## Required layout

Preferred layout:

```text
~/spine-private/                 # above the web root; never reachable by URL
    config.php
    spine_simulator.html
    state/                       # created automatically

~/yourdomain.example/            # web root
    .htaccess
    index.php
    app.php
    admin.php
    logout.php
    manifest.webmanifest
    icon-*.png
    lib/auth.php
```

`auth.php` searches in this order:

1. `SPINE_PRIVATE_DIR/config.php`, when that environment variable is set;
2. the documented `spine-private/config.php` sibling of the web root;
3. the legacy `private/config.php` sibling layout;
4. `private/config.php` inside the web root.

Above-web-root storage is strongly preferred. If it is impossible, copy
`private/.htaccess` with the files; it denies every request to that directory.

## Install

### 1. Requirements

- PHP 8.1 or later.
- Apache 2.4 with `mod_rewrite`; `mod_headers`, `mod_deflate`, and `mod_mime`
  are recommended.
- A valid TLS certificate before the first production visit.
- A private directory writable by the PHP user so state and locked account
  updates can be persisted.

### 2. Copy files

Copy `deploy/htdocs/*` to the domain web root and `deploy/private/*` to
`~/spine-private/`.

Build the private HTML from source (`node tools/build.js --out deploy/private/spine_simulator.html`,
or `--sync-deploy`), keep the configured filename and rerun the tests before deployment.

**Launch-code gate.** From v0.23.0 the open-source build ships with the client-side launch
gate switched off (`LAUNCH_GATE_ENABLED = false` and an empty `CODE_DIGEST` in
`src/js/00-launch-gate.js`). Server authentication is the real boundary here, so the served
copy does not need it. If you also want the standalone file to prompt for a code (for
example when the private HTML is shared outside the server), set `LAUNCH_GATE_ENABLED = true`
and `CODE_DIGEST` to the SHA-256 hex digest of the lower-cased, trimmed code in that file
before building. Never commit a real code or its digest to a public repository.

### 3. Configure

```bash
cd ~/spine-private
cp config.sample.php config.php
php ~/path/to/deploy/tools/make-hash.php
```

Edit `config.php`:

- replace the placeholder hash with the generated bcrypt hash;
- set `canonical_origin` to the exact public HTTPS origin, without a path or
  trailing slash;
- set the first administrator's id, name, and email;
- leave `trusted_proxy_ips` empty unless the hosting provider confirms the
  exact proxy IP addresses or CIDR ranges seen by PHP;
- leave `hsts_include_subdomains` false unless every current and future
  subdomain is permanently HTTPS.

The proxy allowlist is security-sensitive. `X-Forwarded-Proto` is ignored unless
the direct transport peer matches that list. Dynamic routes also reject a
non-canonical `Host` and redirect to `canonical_origin`; redirects are never
constructed from an untrusted request host. The allowlisted edge proxy must
overwrite/sanitize `X-Forwarded-Proto` to one value; ambiguous comma-separated
lists are rejected. For audit and IP throttling, `X-Forwarded-For` is walked
from the trusted edge toward the first untrusted hop, so user-supplied entries
farther left cannot choose their identity.

`client_launch_gate` should normally remain false. Server authentication then
supersedes the standalone file's shared launch-code prompt in the served copy.
The private HTML file itself is not modified and retains its standalone gate.

`watermark` accepts:

- `visible`: name and stable session issue time are shown;
- `hidden`: the trace is embedded but not displayed;
- `off`: no user-identifying trace or client session identity is injected.

Email is excluded unless `watermark_include_email` is explicitly true.

### 4. Permissions

Typical DreamHost permissions:

```bash
chmod 700 ~/spine-private
chmod 600 ~/spine-private/config.php
chmod 644 ~/yourdomain.example/*.php ~/yourdomain.example/lib/auth.php
chmod 644 ~/yourdomain.example/.htaccess
```

PHP must be able to create `~/spine-private/state`, lock
`~/spine-private/config.lock`, and atomically replace `config.php`. Account
writes validate the generated PHP before replacing the live file. A revision
check prevents two administrators from silently overwriting each other.
Configuration loads forcibly invalidate the specific PHP OPcache entry, and a
post-replace read verifies that the installed account revision is visible.

### 5. Create other accounts

Sign in as the first administrator and open `/admin.php`. Give each tester a
separate account. Passwords must be 12–72 bytes; bcrypt silently ignores data
after byte 72, so longer input is rejected.

Disabling, enabling, changing a password, or changing an administrator role
increments that account's session version. Existing sessions are rejected on
their next authenticated request. Deleting an account requires typing its exact
id and also revokes its sessions. The last enabled administrator cannot be
removed or disabled.

Delete `tools/make-hash.php` from any uploaded location after setup. It already
refuses HTTP execution, but it is not needed in production.

## Runtime behavior

### Sessions

- Secure, HttpOnly, `SameSite=Strict`, host-only `__Host-` cookie.
- Strict session ids, cookies only, URL session ids disabled.
- Id regenerated on login.
- One-hour idle and twelve-hour absolute limit.
- Live fingerprint includes password hash, disabled state, administrator role,
  and session version.
- Sign-out is a CSRF-protected POST; a cross-site link cannot log a user out.

### Login throttling

The state is held in one lock-protected JSON file. Reservations are atomic
across PHP workers. The defaults are:

- 8 failures per account in 15 minutes;
- 30 failures per source IP in 15 minutes.

A successful login clears only that account's failures and its own IP
reservation. It cannot erase failures against other users or the aggregate IP
history. Missing, unreadable, unwritable, or corrupt limiter state fails closed.

**Known trade-off: account lockout can be triggered by anyone.** The
per-account limit is checked before the password, so an anonymous visitor who
knows a username (for example `admin`) can post eight wrong passwords every 15
minutes and keep that account locked out, even for its real owner. This is
deliberate for a small internal deployment: it caps online guessing per account
no matter how many source IPs an attacker uses. Mitigations:

- do not use guessable usernames such as `admin`; account names are not shown
  anywhere in the app;
- keep a second administrator account, so a locked account can be worked
  around; the locked user can sign in again once the 15-minute window has
  passed without new failures;
- watch `access.log` for repeated `login_locked`/`login_failed` events against
  one account and block the source at the host or proxy.

If the deployment becomes reachable by untrusted networks, replace the hard
per-account lock with a progressive delay keyed on (account, source IP) before
widening access.

### Audit log

`~/spine-private/state/access.log` is tab-separated:

```text
timestamp    event    ip    user    detail
```

Events include login success/failure/lockout, session revocation, app delivery,
ETag revalidation (`304`), administration, and logout. Values are control-byte
sanitized and writes are locked. At 5 MiB, the previous file is moved to
`access.log.1`; ship both to protected archival storage if longer retention is
required. File-log auditing is useful but is not an immutable compliance log.

### App delivery and CSP

`app.php` resolves `app_file` by real path and refuses traversal or a file
outside the private directory. Each response:

- removes the private HTML's embedded meta CSP from the served copy only;
- applies a nonce to every script tag;
- sends one nonce-bound response CSP;
- injects authenticated launch state, traceability mode, and POST sign-out;
- emits an ETag bound to file content, display mode, account, and session.

Never work around a CSP error by adding `unsafe-eval` without identifying the
exact dependency. The current audited single-file build runs under the supplied
nonce policy.

The ETag and nonce are stable only for the same authenticated session and exact
response body. The nonce is derived from the unguessable session id; it is not a
global or build-wide nonce. `private, no-cache, must-revalidate` permits a
browser to retain its own authenticated copy for conditional revalidation.
That improves repeat-load performance but does not pretend to prevent a valid
tester from copying data already delivered to that browser. Use a managed
browser/profile policy if local cache retention is unacceptable.

### PWA behavior

The manifest and icons are intentionally anonymous static assets and contain no
clinical content. The manifest and non-fingerprinted icon names are revalidated.
`start_url` points to `app.php`, so launching an installed icon still requires a
valid server session.

There is no service worker and no offline clinical application cache. This is
intentional: an offline cache would retain the simulator outside the server
session boundary. “Installable” here means home-screen/standalone presentation,
not offline access. Native App Store or Play Store distribution requires a
separate reviewed mobile architecture, privacy disclosures, signing, store
compliance, and—if any patient data is introduced—a formal regulated security
program.

## Verification

Run the deterministic bundle checks before upload:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/run.ps1
```

or:

```bash
find htdocs tools -name '*.php' -print0 | xargs -0 -n1 php -l
php tests/run.php
```

Then verify against the deployed host:

1. HTTP and a wrong HTTPS host redirect to `canonical_origin`.
2. `/` shows the sign-in page; eight bad account attempts lock it for 15 minutes.
3. Sign-in loads the simulator without the standalone shared-code prompt.
4. `spine_simulator.html`, `lib/auth.php`, configuration backups, dotfiles, and
   the private directory return 403/404.
5. Sign-out cannot be completed with GET.
6. Disable a test account in a second browser and confirm its next request ends.
7. Repeat-load `app.php` returns 304 and records `app_revalidated`.
8. `state/access.log`, the rate state, and account file remain private and
   writable only by the deployment user.

## Troubleshooting

| Symptom | Check |
|---|---|
| Server configuration error | Read the PHP error log; verify the config path, canonical origin, usable bcrypt hashes, and at least one enabled admin. |
| Redirect loop | Verify the public origin and direct TLS. If TLS terminates upstream, allowlist the actual proxy address/CIDR and confirm it sends `X-Forwarded-Proto: https`. |
| Sign-in temporarily unavailable | The private state directory or lock file is not safely readable/writable, or the limiter JSON is corrupt. Repair it; do not bypass the fail-closed check. |
| Account update conflict | Another administrator saved first. Reload `/admin.php` and reapply the intended change. |
| App file missing/outside private directory | `app_file` must be a plain `.html` filename in the same private directory as `config.php`. |
| CSP failure | Confirm the audited HTML build was deployed and rerun `tests/run.php`. Investigate the cited script; do not broadly weaken CSP. |
| 500 before PHP runs | Check the Apache error log for a disallowed hosting directive. Preserve the deny rules even if an optional header/compression block must be adapted. |
