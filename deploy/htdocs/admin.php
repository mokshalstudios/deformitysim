<?php
declare(strict_types=1);
require __DIR__ . '/lib/auth.php';

spine_require_https();
spine_start_session();
spine_require_admin();
spine_security_headers(false);
header('Cache-Control: no-store, private');

$config  = spine_config();
$users   = array_values($config['users']);
$usersRevision = spine_users_revision($users);
$me      = spine_current_user()['id'] ?? '';
$error   = null;
$success = null;

/** Keeps at least one enabled admin so the deployment can never lock itself out. */
function spine_has_active_admin(array $users): bool
{
    foreach ($users as $user) {
        if (!empty($user['admin']) && empty($user['disabled'])) {
            return true;
        }
    }
    return false;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!spine_csrf_valid($_POST['csrf'] ?? null)) {
        $error = 'Your form session expired. Please try again.';
    } elseif (!preg_match('/^[a-f0-9]{64}$/', spine_post_string('users_revision'))) {
        $error = 'This form is stale or invalid. Reload the page and try again.';
    } else {
        $action = spine_post_string('action');
        $target = trim(spine_post_string('id'));
        $next   = $users;
        $expectedRevision = spine_post_string('users_revision');

        if ($action === 'add') {
            $id       = trim(spine_post_string('new_id'));
            $name     = trim(spine_post_string('new_name'));
            $email    = trim(spine_post_string('new_email'));
            $password = spine_post_string('new_password');
            $admin    = !empty($_POST['new_admin']);

            if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $id)) {
                $error = 'Username must be 3–40 characters: letters, numbers, dot, underscore or hyphen.';
            } elseif (strlen($password) < SPINE_PASSWORD_MIN_BYTES
                || strlen($password) > SPINE_PASSWORD_MAX_BYTES) {
                $error = 'Password must be 12–72 bytes.';
            } elseif ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $error = 'That email address is not valid.';
            } else {
                foreach ($users as $user) {
                    if (strcasecmp((string) $user['id'], $id) === 0) {
                        $error = 'That username already exists.';
                    }
                }
                if ($error === null) {
                    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
                    if (!is_string($hash)) {
                        $error = 'Password hashing failed. No account was created.';
                    }
                }
                if ($error === null) {
                    $next[] = [
                        'id' => $id, 'name' => $name !== '' ? $name : $id, 'email' => $email,
                        'hash' => $hash,
                        'admin' => $admin, 'disabled' => false,
                        'session_version' => 1,
                    ];
                    $success = "Added {$id}.";
                }
            }
        } elseif (in_array($action, ['disable', 'enable', 'delete', 'reset', 'promote', 'demote'], true)) {
            if ($action === 'delete'
                && !hash_equals($target, trim(spine_post_string('delete_confirmation')))) {
                $error = "Type {$target} exactly to confirm deletion.";
            }
            $found = false;
            $rebuilt = [];
            foreach ($next as $user) {
                if ((string) $user['id'] !== $target) { $rebuilt[] = $user; continue; }
                $found = true;
                if ($error !== null) {
                    $rebuilt[] = $user;
                    continue;
                }
                switch ($action) {
                    case 'delete':
                        $success = "Deleted {$target}.";
                        continue 2; // drop it
                    case 'disable': $user['disabled'] = true;  $success = "Disabled {$target}."; break;
                    case 'enable':  $user['disabled'] = false; $success = "Enabled {$target}.";  break;
                    case 'promote': $user['admin']    = true;  $success = "{$target} is now an admin."; break;
                    case 'demote':  $user['admin']    = false; $success = "{$target} is no longer an admin."; break;
                    case 'reset':
                        $password = spine_post_string('reset_password');
                        if (strlen($password) < SPINE_PASSWORD_MIN_BYTES
                            || strlen($password) > SPINE_PASSWORD_MAX_BYTES) {
                            $error = 'Password must be 12–72 bytes.';
                            $success = null;
                            break;
                        }
                        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
                        if (!is_string($hash)) {
                            $error = 'Password hashing failed. The password was not changed.';
                            $success = null;
                            break;
                        }
                        $user['hash'] = $hash;
                        $success = "Password reset for {$target}.";
                        break;
                }
                if ($error === null && $action !== 'delete') {
                    $user['session_version'] = max(1, (int) ($user['session_version'] ?? 1)) + 1;
                }
                $rebuilt[] = $user;
            }
            if (!$found) { $error = 'That account no longer exists.'; }
            $next = $rebuilt;
        } else {
            $error = 'Unknown action.';
        }

        if ($error === null) {
            if (!spine_has_active_admin($next)) {
                $error = 'Refused: that would leave no enabled admin account.';
                $success = null;
            } elseif (!spine_save_users($next, $expectedRevision)) {
                $storeError = spine_last_user_store_error();
                $error = match ($storeError) {
                    'conflict' => 'Another administrator changed the account list. Reload and apply your change again.',
                    'cache_refresh_failed' => 'The account file changed, but PHP did not expose the new revision. Contact the site owner and check OPcache before making another change.',
                    default => 'Could not safely write private/config.php. Check its permissions and the server error log.',
                };
                $success = null;
            } else {
                spine_audit('admin_' . $action, 'target=' . ($action === 'add' ? spine_post_string('new_id') : $target));
                $config = spine_config();
                $users  = array_values($config['users']);
                $usersRevision = spine_users_revision($users);
                if (!spine_is_authenticated()) {
                    header('Location: index.php?expired=1', true, 302);
                    exit;
                }
                if (!spine_is_admin()) {
                    header('Location: app.php', true, 302);
                    exit;
                }
            }
        }
    }
}

$token = spine_csrf_token();
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Access management — DeformitySim</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;min-height:100dvh;padding:22px 16px calc(28px + env(safe-area-inset-bottom));
    background:radial-gradient(ellipse at 50% -10%,rgba(37,99,235,.18),transparent 55%),linear-gradient(180deg,#07111f,#050b14);
    color:#f1f5f9;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px}
  .wrap{max-width:940px;margin:0 auto}
  header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
  h1{margin:0;font-size:20px;letter-spacing:-.02em}
  h2{margin:0 0 12px;font-size:14px;color:#dbeafe}
  .sub{margin:4px 0 0;color:#93a8c0;font-size:12px}
  a.back{color:#93c5fd;font-size:12.5px;text-decoration:none}
  .card{padding:16px;margin-bottom:16px;border:1px solid #24364d;border-radius:14px;background:rgba(11,22,39,.9)}
  table{width:100%;border-collapse:collapse}
  th,td{padding:9px 8px;text-align:left;border-bottom:1px solid rgba(52,73,99,.55);font-size:12.5px;vertical-align:middle}
  th{color:#93a8c0;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em}
  .tag{display:inline-block;padding:2px 7px;border-radius:999px;font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
  .tag.admin{color:#a7f3d0;background:rgba(6,95,70,.5);border:1px solid rgba(52,211,153,.4)}
  .tag.off{color:#fecdd3;background:rgba(159,18,57,.35);border:1px solid rgba(251,113,133,.4)}
  .tag.you{color:#bfdbfe;background:rgba(37,99,235,.25);border:1px solid rgba(96,165,250,.4)}
  form.inline{display:inline}
  form.delete{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:7px}
  form.delete input[type=text]{width:150px;min-height:38px;font-size:12px}
  input,button{font:inherit}
  input[type=text],input[type=email],input[type=password]{width:100%;min-height:44px;padding:0 11px;
    border:1px solid #24364d;border-radius:9px;color:#e2e8f0;background:#0a1424;font-size:16px}
  input:focus{outline:none;border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,.22)}
  label{display:block;margin-bottom:5px;color:#cbd5e1;font-size:11.5px;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:11px;margin-bottom:12px}
  .check{display:flex;align-items:center;gap:9px;min-height:44px;color:#cbd5e1;font-size:12.5px}
  .check input{width:20px;height:20px;accent-color:#3b82f6}
  button{min-height:38px;padding:0 12px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;
    border:1px solid #34537a;color:#dbeafe;background:#102744}
  button:hover{border-color:#60a5fa;background:#17365e}
  button.primary{min-height:46px;border-color:#3b82f6;background:#2563eb;color:#fff;font-size:14px}
  button.danger{border-color:rgba(251,113,133,.4);color:#fecdd3;background:rgba(159,18,57,.2)}
  .msg{margin:0 0 14px;padding:11px 12px;border-radius:9px;font-size:12.5px;line-height:1.5}
  .err{border:1px solid rgba(251,113,133,.42);background:rgba(159,18,57,.2);color:#fecdd3}
  .ok{border:1px solid rgba(52,211,153,.4);background:rgba(6,95,70,.28);color:#a7f3d0}
  .actions{display:flex;flex-wrap:wrap;gap:6px}
  .note{margin:12px 0 0;color:#7f94ab;font-size:11px;line-height:1.55}
  @media(max-width:640px){
    table,thead,tbody,tr,td,th{display:block}
    thead{display:none}
    tr{padding:10px 0;border-bottom:1px solid rgba(52,73,99,.55)}
    td{border:0;padding:3px 0}
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>Access management</h1>
      <p class="sub">Signed in as <strong><?= htmlspecialchars($me, ENT_QUOTES) ?></strong> · access, role, and password changes revoke affected sessions immediately</p>
    </div>
    <a class="back" href="app.php">&larr; Back to the simulator</a>
  </header>

  <?php if ($error): ?><p class="msg err" role="alert"><?= htmlspecialchars($error, ENT_QUOTES) ?></p><?php endif; ?>
  <?php if ($success): ?><p class="msg ok"><?= htmlspecialchars($success, ENT_QUOTES) ?></p><?php endif; ?>

  <section class="card">
    <h2>Testers (<?= count($users) ?>)</h2>
    <table>
      <thead><tr><th>Account</th><th>Name / email</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
      <?php foreach ($users as $user):
        $id = (string) $user['id'];
        $isMe = $id === $me; ?>
        <tr>
          <td><strong><?= htmlspecialchars($id, ENT_QUOTES) ?></strong></td>
          <td>
            <?= htmlspecialchars((string) ($user['name'] ?? ''), ENT_QUOTES) ?>
            <?php if (!empty($user['email'])): ?><br><span style="color:#7f94ab;font-size:11px"><?= htmlspecialchars((string) $user['email'], ENT_QUOTES) ?></span><?php endif; ?>
          </td>
          <td>
            <?php if (!empty($user['admin'])): ?><span class="tag admin">Admin</span> <?php endif; ?>
            <?php if (!empty($user['disabled'])): ?><span class="tag off">Disabled</span> <?php endif; ?>
            <?php if ($isMe): ?><span class="tag you">You</span><?php endif; ?>
          </td>
          <td>
            <div class="actions">
              <?php foreach ([
                  ['disable', 'Disable', empty($user['disabled'])],
                  ['enable',  'Enable',  !empty($user['disabled'])],
                  ['promote', 'Make admin', empty($user['admin'])],
                  ['demote',  'Remove admin', !empty($user['admin']) && !$isMe],
              ] as [$act, $label, $show]):
                if (!$show) continue; ?>
                <form class="inline" method="post">
                  <input type="hidden" name="csrf" value="<?= htmlspecialchars($token, ENT_QUOTES) ?>">
                  <input type="hidden" name="users_revision" value="<?= htmlspecialchars($usersRevision, ENT_QUOTES) ?>">
                  <input type="hidden" name="action" value="<?= $act ?>">
                  <input type="hidden" name="id" value="<?= htmlspecialchars($id, ENT_QUOTES) ?>">
                  <button type="submit"><?= $label ?></button>
                </form>
              <?php endforeach; ?>
            </div>
            <form class="delete" method="post">
              <input type="hidden" name="csrf" value="<?= htmlspecialchars($token, ENT_QUOTES) ?>">
              <input type="hidden" name="users_revision" value="<?= htmlspecialchars($usersRevision, ENT_QUOTES) ?>">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="id" value="<?= htmlspecialchars($id, ENT_QUOTES) ?>">
              <input type="text" name="delete_confirmation" placeholder="Type <?= htmlspecialchars($id, ENT_QUOTES) ?>"
                     autocomplete="off" aria-label="Type <?= htmlspecialchars($id, ENT_QUOTES) ?> to confirm deletion">
              <button type="submit" class="danger">Delete</button>
            </form>
            <form method="post" style="margin-top:7px;display:flex;gap:6px;max-width:340px">
              <input type="hidden" name="csrf" value="<?= htmlspecialchars($token, ENT_QUOTES) ?>">
              <input type="hidden" name="users_revision" value="<?= htmlspecialchars($usersRevision, ENT_QUOTES) ?>">
              <input type="hidden" name="action" value="reset">
              <input type="hidden" name="id" value="<?= htmlspecialchars($id, ENT_QUOTES) ?>">
              <input type="password" name="reset_password" placeholder="New password (12–72 bytes)"
                     required minlength="12" maxlength="72" autocomplete="new-password">
              <button type="submit">Reset</button>
            </form>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>Add a tester</h2>
    <form method="post">
      <input type="hidden" name="csrf" value="<?= htmlspecialchars($token, ENT_QUOTES) ?>">
      <input type="hidden" name="users_revision" value="<?= htmlspecialchars($usersRevision, ENT_QUOTES) ?>">
      <input type="hidden" name="action" value="add">
      <div class="grid">
        <div><label for="new_id">Username</label><input id="new_id" name="new_id" type="text" required autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9._-]{3,40}"></div>
        <div><label for="new_name">Full name</label><input id="new_name" name="new_name" type="text"></div>
        <div><label for="new_email">Email</label><input id="new_email" name="new_email" type="email"></div>
        <div><label for="new_password">Password (12–72 bytes)</label><input id="new_password" name="new_password" type="password" required minlength="12" maxlength="72" autocomplete="new-password"></div>
      </div>
      <label class="check"><input type="checkbox" name="new_admin" value="1"> Can manage access</label>
      <button type="submit" class="primary">Add tester</button>
    </form>
    <p class="note">Give every tester their own account. The audit log and the per-user watermark are the only things that make a leaked copy traceable, and a shared login destroys both. Passwords are stored only as bcrypt hashes — nobody, including you, can read them back, so a forgotten password is reset rather than recovered.</p>
  </section>
</div>
</body>
</html>
