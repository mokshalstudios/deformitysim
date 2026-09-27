  /* Launch gate for the internal test build.

     LAUNCH_GATE_ENABLED is the build-time switch. The open-source alpha ships
     with it false, so the workspace opens directly and the gate dialog is
     removed at DOMContentLoaded. The internal deploy re-enables the prompt by
     setting it to true and setting CODE_DIGEST (see below) before building. The server-side
     binding in deploy/htdocs/lib/auth.php rewrites the "var unlocked = ..."
     line below by exact text, so that line must stay byte-for-byte as is.

     Be clear about what this is: an access gate, not a security boundary. The
     entire application is delivered to the browser in order to run, so anyone
     who gets past this — or who opens the file in an editor — has the source.
     What it does buy is that the build does not open for whoever happens to
     receive the link, and the code is stored as a SHA-256 digest so it is not
     sitting in the file as greppable plaintext.

     Deliberately self-contained and dependency-free so it runs before the main
     application script, and pure-JS SHA-256 rather than crypto.subtle, which is
     unavailable on file:// because that is not a secure context. */
  (function () {
    'use strict';
    var LAUNCH_GATE_ENABLED = false;
    // The public source carries no digest: a published digest of a short code
    // is as good as the code. An internal gated build sets LAUNCH_GATE_ENABLED
    // to true AND a SHA-256 digest of a new, unpublished code here before
    // building; with the gate on and no valid digest the gate never opens by
    // code (fail closed), only through the authenticated server binding.
    var CODE_DIGEST = '';
    var STORE_KEY = 'deformitysim.launch.v1';

    // Compact SHA-256 over ASCII. Returns undefined for any character above
    // U+00FF, which simply fails the comparison rather than throwing.
    function sha256Hex(ascii) {
      function rr(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
      var mathPow = Math.pow, maxWord = mathPow(2, 32), result = '';
      var words = [], asciiBitLength = ascii.length * 8;
      var hash = sha256Hex.h = sha256Hex.h || [], k = sha256Hex.k = sha256Hex.k || [];
      var primeCounter = k.length, isComposite = {}, i, j;
      for (var candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
      }
      ascii += '\x80';
      while (ascii.length % 64 - 56) ascii += '\x00';
      for (i = 0; i < ascii.length; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return;
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words.length] = (asciiBitLength / maxWord) | 0;
      words[words.length] = asciiBitLength;
      for (j = 0; j < words.length;) {
        var w = words.slice(j, j += 16), oldHash = hash;
        hash = hash.slice(0, 8);
        for (i = 0; i < 64; i++) {
          var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
          var temp1 = hash[7]
            + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
            + ((e & hash[5]) ^ (~e & hash[6]))
            + k[i]
            + (w[i] = i < 16 ? w[i] : (
                w[i - 16]
                + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3))
                + w[i - 7]
                + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))
              ) | 0);
          var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1 + temp2) | 0].concat(hash);
          hash[4] = (hash[4] + temp1) | 0;
        }
        for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
      }
      for (i = 0; i < 8; i++) {
        for (j = 3; j + 1; j--) {
          var b = (hash[i] >> (j * 8)) & 255;
          result += ((b < 16) ? 0 : '') + b.toString(16);
        }
      }
      return result;
    }

    function normalise(value) { return String(value == null ? '' : value).trim().toLowerCase(); }

    // sessionStorage throws in some file:// and private-mode configurations, so
    // every access is guarded; the fallback is simply to ask again next load.
    function readStored() { try { return window.sessionStorage.getItem(STORE_KEY); } catch (e) { return null; } }
    function remember() { try { window.sessionStorage.setItem(STORE_KEY, CODE_DIGEST); } catch (e) { /* re-prompt next load */ } }

    var unlocked = readStored() === CODE_DIGEST;
    if (!/^[0-9a-f]{64}$/.test(CODE_DIGEST) && window.__SPINE_SERVER_AUTHENTICATED__ !== true) unlocked = false;
    if (!LAUNCH_GATE_ENABLED) unlocked = true;
    var waiting = [];

    function release() {
      unlocked = true;
      delete document.body.dataset.locked;
      var gate = document.getElementById('launchGate');
      if (gate) {
        try { if (gate.open) gate.close(); } catch (e) { /* not supported */ }
        gate.remove();
      }
      var queue = waiting.slice();
      waiting.length = 0;
      queue.forEach(function (fn) { try { fn(); } catch (e) { /* one callback must not block the rest */ } });
    }

    window.__SPINE_GATE__ = {
      enabled: LAUNCH_GATE_ENABLED,
      isUnlocked: function () { return unlocked; },
      onUnlock: function (fn) {
        if (typeof fn !== 'function') return;
        if (unlocked) fn(); else waiting.push(fn);
      }
    };

    function boot() {
      var gate = document.getElementById('launchGate');
      if (!gate) return;
      if (unlocked) { gate.remove(); return; }
      document.body.dataset.locked = 'true';
      try { gate.showModal(); } catch (e) { gate.setAttribute('open', ''); }
      // A modal dialog closes on Escape by default; this one must not. The
      // cancel event is not cancelable without a prior user gesture in
      // Chromium, so a close is also undone here as a second line of defence.
      gate.addEventListener('cancel', function (event) { event.preventDefault(); });
      gate.addEventListener('close', function () {
        if (unlocked) return;
        try { gate.showModal(); } catch (e) { gate.setAttribute('open', ''); }
        var field = document.getElementById('launchCodeInput');
        if (field) { try { field.focus(); } catch (e) { /* ignore */ } }
      });

      var form = document.getElementById('launchGateForm');
      var input = document.getElementById('launchCodeInput');
      var error = document.getElementById('launchGateError');
      if (input) window.setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 60);

      if (form) form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (/^[0-9a-f]{64}$/.test(CODE_DIGEST) && sha256Hex(normalise(input && input.value)) === CODE_DIGEST) { remember(); release(); return; }
        if (error) { error.hidden = false; error.textContent = 'That launch code was not recognised.'; }
        if (input) { input.value = ''; try { input.focus(); } catch (e) { /* ignore */ } }
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  })();
