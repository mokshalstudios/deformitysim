<?php
declare(strict_types=1);
require __DIR__ . '/lib/auth.php';

spine_require_https();
spine_start_session();
spine_security_headers(false);
header('Cache-Control: no-store, private');

if (spine_is_authenticated()) {
    header('Location: app.php', true, 302);
    exit;
}

$error = null;
$notice = isset($_GET['expired']) ? 'Your session ended. Please sign in again.' : null;
if (isset($_GET['bye'])) {
    $notice = 'You have been signed out.';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!spine_csrf_valid($_POST['csrf'] ?? null)) {
        $error = 'Your form session expired. Please try again.';
    } else {
        $username = spine_post_string('username');
        $password = spine_post_string('password');
        $gate = spine_reserve_login_attempt($username);
        if (!$gate['storage_ok']) {
            $error = 'Sign-in is temporarily unavailable. Please contact the site owner.';
        } elseif (!$gate['allowed'] || !is_string($gate['token'])) {
            $error = 'Too many failed attempts. Try again in 15 minutes.';
        } elseif (spine_attempt_login($username, $password)) {
            if (!spine_resolve_login_attempt($username, $gate['token'], true)) {
                error_log('[spine] authenticated login could not clear its rate-limit reservation.');
            }
            spine_audit('login_ok');
            header('Location: app.php', true, 302);
            exit;
        } else {
            spine_resolve_login_attempt($username, $gate['token'], false);
            spine_audit('login_failed', 'user=' . substr($username, 0, 40));
            $left = spine_attempts_remaining($username);
            if ($left === 0) {
                spine_audit('login_locked', 'account or IP threshold reached');
            }
            $error = 'Incorrect credentials.'
                . ($left <= 3 && $left > 0 ? " {$left} attempt(s) remaining." : '');
        }
    }
}

$token = spine_csrf_token();
$config = spine_config();
$title = (string) ($config['site_title'] ?? 'DeformitySim');
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title><?= htmlspecialchars($title, ENT_QUOTES) ?> — Sign in</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
    background:radial-gradient(ellipse at 50% -10%,rgba(37,99,235,.22),transparent 55%),linear-gradient(180deg,#07111f,#050b14);
    color:#f1f5f9;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .card{width:min(430px,100%);padding:30px 28px;border:1px solid rgba(96,165,250,.28);border-radius:18px;
    background:rgba(11,22,39,.94);box-shadow:0 30px 80px rgba(0,0,0,.55)}
  .mark{width:50px;height:50px;display:grid;place-items:center;margin-bottom:16px;border-radius:14px;
    border:1px solid rgba(96,165,250,.38);background:linear-gradient(145deg,rgba(37,99,235,.42),rgba(9,20,35,.9));
    color:#bfdbfe;font-size:22px}
  h1{margin:0;font-size:21px;letter-spacing:-.02em}
  .sub{margin:6px 0 0;color:#93a8c0;font-size:12.5px;line-height:1.5}
  form{margin-top:22px;display:grid;gap:13px}
  label{display:block;margin-bottom:6px;color:#cbd5e1;font-size:12px;font-weight:700}
  input{width:100%;min-height:46px;padding:0 12px;border:1px solid #24364d;border-radius:10px;
    color:#e2e8f0;background:#0a1424;font:inherit;font-size:16px}
  input:focus{outline:none;border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,.25)}
  button{min-height:48px;border:1px solid #3b82f6;border-radius:10px;color:#fff;background:#2563eb;
    font:inherit;font-size:15px;font-weight:750;cursor:pointer}
  button:hover{background:#3b82f6}
  .msg{margin:0;padding:10px 12px;border-radius:9px;font-size:12.5px;line-height:1.45}
  .err{border:1px solid rgba(251,113,133,.4);background:rgba(159,18,57,.18);color:#fecdd3}
  .note{border:1px solid rgba(96,165,250,.32);background:rgba(37,99,235,.14);color:#bfdbfe}
  .legal{margin:20px 0 0;padding-top:16px;border-top:1px solid rgba(52,73,99,.6);
    color:#7f94ab;font-size:10.5px;line-height:1.55}
  .legal strong{color:#fde68a}
</style>
</head>
<body>
  <main class="card">
    <div class="mark" aria-hidden="true">&#9670;</div>
    <h1><?= htmlspecialchars($title, ENT_QUOTES) ?></h1>
    <p class="sub">Private research build. Access is restricted to named testers.</p>

    <?php if ($notice): ?><p class="msg note"><?= htmlspecialchars($notice, ENT_QUOTES) ?></p><?php endif; ?>
    <?php if ($error): ?><p class="msg err" role="alert"><?= htmlspecialchars($error, ENT_QUOTES) ?></p><?php endif; ?>

    <form method="post" autocomplete="off">
      <input type="hidden" name="csrf" value="<?= htmlspecialchars($token, ENT_QUOTES) ?>">
      <div>
        <label for="username">Username</label>
        <input id="username" name="username" type="text" required maxlength="40" autocapitalize="none"
               autocorrect="off" spellcheck="false" autocomplete="username">
      </div>
      <div>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required minlength="12" maxlength="72"
               autocomplete="current-password">
      </div>
      <button type="submit">Sign in</button>
    </form>

    <p class="legal">
      <strong>Research and education prototype — not a medical device.</strong>
      It does not diagnose, recommend treatment, or predict patient-specific outcomes.
      Do not enter identifiable patient information. Access is logged against your
      account. This software and its contents are confidential; by signing in you
      agree not to copy, redistribute, or publish any part of it.
    </p>
  </main>
</body>
</html>
