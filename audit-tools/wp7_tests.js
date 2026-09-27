#!/usr/bin/env node
'use strict';
// WP7 -- DICOM decoder coverage, exercised in a real browser (Chrome via CDP).
//
//   node audit-tools/wp7_tests.js <build.html> [--headed]
//
// 1. Runs the Node suite (ai-tools/dicom-tests/test.js --quick) first.
// 2. In the built page, under the app's own CSP:
//    - window.__SPINE_DICOM__ decodes every fixture with decodeRadiographAsync and
//      the result matches fixtures/expected.json (the async expectation where one
//      exists); lossy JPEG goes through the browser's real decoder here
//      (createImageBitmap) and Deflate through the real DecompressionStream;
//    - a real-world JPEG (samples/1.jpg) wrapped as JPEG Baseline DICOM decodes to
//      exactly the luminance the browser gives for the bare JPEG;
//    - no CSP violation and no page error.
// 3. The unchanged app intake (which still calls the synchronous decoder) accepts
//    JPEG Lossless and RLE files: the staged status notes report both planes as
//    decoded DICOM.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch, fileUrl, sleep } = require('./cdp.js');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(ROOT, 'ai-tools', 'dicom-tests', 'fixtures');
const build = process.argv[2];
if (!build || !fs.existsSync(build)) {
  console.error('usage: node audit-tools/wp7_tests.js <build.html> [--headed]');
  process.exit(2);
}

let passed = 0, failed = 0;
const failures = [];
function check(cond, msg) {
  if (cond) { passed++; return true; }
  failed++; failures.push(msg); console.log('  FAIL: ' + msg);
  return false;
}

// Minimal Explicit VR Little Endian writer for the real-world JPEG wrapper.
function el(g, e, vr, val) {
  let v = Buffer.isBuffer(val) ? val : Buffer.from(val, 'latin1');
  if (v.length % 2) v = Buffer.concat([v, Buffer.from([vr === 'UI' || vr === 'OB' ? 0 : 0x20])]);
  const long = ['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr);
  const h = Buffer.alloc(long ? 12 : 8);
  h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.write(vr, 4, 'latin1');
  if (long) h.writeUInt32LE(v.length, 8); else h.writeUInt16LE(v.length, 6);
  return Buffer.concat([h, v]);
}
const us = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
function jpegSize(jpg) {
  for (let p = 2; p + 9 < jpg.length;) {
    if (jpg[p] !== 0xFF) throw new Error('bad JPEG');
    const m = jpg[p + 1], len = jpg.readUInt16BE(p + 2);
    if (m >= 0xC0 && m <= 0xC3) return { rows: jpg.readUInt16BE(p + 5), cols: jpg.readUInt16BE(p + 7), comps: jpg[p + 9] };
    p += 2 + len;
  }
  throw new Error('no SOF');
}
function wrapJpegBaseline(jpg) {
  const { rows, cols, comps } = jpegSize(jpg);
  const metaBody = Buffer.concat([el(2, 1, 'OB', Buffer.from([0, 1])), el(2, 2, 'UI', '1.2.840.10008.5.1.4.1.1.7'),
    el(2, 3, 'UI', '2.25.7777'), el(2, 0x10, 'UI', '1.2.840.10008.1.2.4.50')]);
  const ds = Buffer.concat([el(8, 0x16, 'UI', '1.2.840.10008.5.1.4.1.1.7'), el(8, 0x60, 'CS', 'OT'),
    el(0x28, 2, 'US', us(comps)), el(0x28, 4, 'CS', comps === 3 ? 'YBR_FULL_422' : 'MONOCHROME2'),
    ...(comps === 3 ? [el(0x28, 6, 'US', us(0))] : []),
    el(0x28, 0x10, 'US', us(rows)), el(0x28, 0x11, 'US', us(cols)), el(0x28, 0x100, 'US', us(8)), el(0x28, 0x101, 'US', us(8)),
    el(0x28, 0x102, 'US', us(7)), el(0x28, 0x103, 'US', us(0))]);
  const frag = jpg.length % 2 ? Buffer.concat([jpg, Buffer.from([0])]) : jpg;
  const item = (tag2, len) => { const b = Buffer.alloc(8); b.writeUInt16LE(0xFFFE, 0); b.writeUInt16LE(tag2, 2); b.writeUInt32LE(len, 4); return b; };
  const px = Buffer.concat([Buffer.from([0xE0, 0x7F, 0x10, 0x00, 0x4F, 0x42, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF]), item(0xE000, 0), item(0xE000, frag.length), frag, item(0xE0DD, 0)]);
  const gl = Buffer.alloc(4); gl.writeUInt32LE(metaBody.length);
  return { bytes: Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), el(2, 0, 'UL', gl), metaBody, ds, px]), rows, cols, comps };
}

async function main() {
  console.log('== node suite (ai-tools/dicom-tests/test.js --quick)');
  let nodeOut = '';
  try {
    nodeOut = execFileSync(process.execPath, [path.join(ROOT, 'ai-tools', 'dicom-tests', 'test.js'), '--quick'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    check(true, 'node suite');
  } catch (e) {
    nodeOut = String(e.stdout || '');
    check(false, 'node suite exited non-zero');
  }
  console.log('  ' + (nodeOut.match(/\d+ checks passed, \d+ failed/) || ['(no summary)'])[0]);

  const b = await launch({ headless: !process.argv.includes('--headed') });
  try {
    const page = await b.open(fileUrl(path.resolve(build)), { width: 1440, height: 900 });
    await page.unlock();
    await page.eval(`(window.__csp = [], document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)), true)`);
    const info = await page.eval(`(() => { const a = window.__SPINE_DICOM__; return a ? { version: a.version, async: typeof a.decodeRadiographAsync, csp: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || null } : null; })()`);
    console.log('== in-page decoder ' + JSON.stringify(info));
    check(info && info.async === 'function', 'window.__SPINE_DICOM__.decodeRadiographAsync is present in the build');
    check(info && /connect-src 'none'/.test(info.csp || '') && /worker-src 'none'/.test(info.csp || ''), 'the page runs under the offline CSP');

    // Helper installed once in the page: decode base64 bytes, summarise.
    await page.eval(`(window.__wp7 = async (b64, opts) => {
      const u8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const t0 = performance.now();
      const r = await window.__SPINE_DICOM__.decodeRadiographAsync(u8.buffer, opts || {});
      const ms = performance.now() - t0;
      return { ok: r.ok, reason: r.reason, message: r.message, warnings: r.warnings, rows: r.rows, columns: r.columns, pixelCodec: r.pixelCodec,
        window: r.window, orientation: r.orientation, displayInverted: r.displayInverted, ms,
        gray8: r.gray8 ? Array.from(r.gray8) : null, raw16: r.raw16 ? Array.from(r.raw16) : null };
    }, true)`);

    const cases = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));
    for (const c of cases) {
      const file = path.join(FIX, c.file);
      if (!fs.existsSync(file) || fs.statSync(file).size > 4e6) continue; // f15 (18 MB) is covered by the Node suite
      const want = c.async || c;
      const r = await page.eval(`window.__wp7(${JSON.stringify(fs.readFileSync(file).toString('base64'))})`);
      const lossyBrowser = Boolean(c.jpegReference);
      let note = '';
      check(r.ok === want.ok, `${c.file}: ok ${r.ok} (${r.reason}: ${r.message}) expected ${want.ok}`);
      if (want.reason) check(r.reason === want.reason, `${c.file}: reason ${r.reason} expected ${want.reason}`);
      check(r.reason !== 'parse_error', `${c.file}: no unexpected exception`);
      if (r.ok && want.gray8) {
        const exp = fs.readFileSync(path.join(FIX, want.gray8));
        let max = 0, sum = 0;
        for (let i = 0; i < exp.length; i++) { const d = Math.abs(exp[i] - r.gray8[i]); sum += d; if (d > max) max = d; }
        const mean = sum / exp.length;
        note = `gray8 maxDiff ${max} meanDiff ${mean.toFixed(3)}`;
        // Lossy JPEG: Chrome's decoder vs Pillow's libjpeg may differ by an IDCT rounding step.
        if (lossyBrowser) check(max <= 4 && mean < 0.5, `${c.file}: browser JPEG decode matches the libjpeg reference (${note})`);
        else check(max <= 1, `${c.file}: gray8 within +-1 of the reference (${note})`);
      }
      if (lossyBrowser && r.ok) {
        const ref = fs.readFileSync(path.join(FIX, c.jpegReference));
        let max = 0;
        for (let i = 0; i < r.raw16.length; i++) {
          const R = ref[3 * i], G = ref[3 * i + 1], B = ref[3 * i + 2];
          const y = R === G && G === B ? R : Math.floor((299 * R + 587 * G + 114 * B + 500) / 1000);
          max = Math.max(max, Math.abs(y - r.raw16[i]));
        }
        check(max <= 4, `${c.file}: decoded luminance within 4 of libjpeg (max ${max})`);
        note += `; luminance maxDiff vs libjpeg ${max}; ${r.ms.toFixed(1)} ms`;
      }
      console.log(`  ${c.file.padEnd(44)} ok=${r.ok} ${r.reason || ''} ${note}`);
    }

    // Real-world JPEG from the repository samples, wrapped as JPEG Baseline DICOM.
    // Internal fixtures (not in the public repository): skipped when absent.
    for (const sample of ['1.jpg', '2.jpg'].filter(s => fs.existsSync(path.join(ROOT, 'samples', s)))) {
      const jpg = fs.readFileSync(path.join(ROOT, 'samples', sample));
      const w = wrapJpegBaseline(jpg);
      // Decode both ways and compare inside the page: returning two per-pixel arrays over
      // the DevTools protocol is prohibitively slow for multi-megapixel films.
      const r = await page.eval(`(async () => {
        const wrapped = Uint8Array.from(atob(${JSON.stringify(w.bytes.toString('base64'))}), c => c.charCodeAt(0));
        const t0 = performance.now();
        const dec = await window.__SPINE_DICOM__.decodeRadiographAsync(wrapped.buffer, {});
        const ms = performance.now() - t0;
        if (!dec.ok) return { ok: false, reason: dec.reason, ms, diff: -1 };
        const u8 = Uint8Array.from(atob(${JSON.stringify(jpg.toString('base64'))}), c => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const cv = new OffscreenCanvas(bmp.width, bmp.height), g = cv.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let diff = 0;
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const y = R === G && G === B ? R : Math.floor((299 * R + 587 * G + 114 * B + 500) / 1000);
          if (y !== dec.raw16[p]) diff++;
        }
        return { ok: true, rows: dec.rows, columns: dec.columns, ms, diff };
      })()`, { timeout: 300000 });
      const diff = r.ok ? r.diff : -1;
      check(r.ok && r.rows === w.rows && r.columns === w.cols && diff === 0,
        `samples/${sample} as JPEG Baseline DICOM (${w.cols}x${w.rows}, ${w.comps} comp): ok=${r.ok} ${r.reason || ''}, ${diff} pixels differ from the browser's own decode`);
      console.log(`  samples/${sample} wrapped as 4.50: ok=${r.ok} ${w.cols}x${w.rows} ${w.comps} comp, ${r.ms.toFixed(1)} ms, ${diff} px differ`);
    }

    // The unchanged app intake (synchronous decoder) with JPEG Lossless + RLE files.
    console.log('== app intake with JPEG Lossless (frontal) + RLE (lateral)');
    await page.waitFor(`!!document.getElementById('introExplore') && document.getElementById('introExplore').getBoundingClientRect().width > 0`, { timeout: 30000 });
    await page.clickSelector('#introExplore');
    await sleep(800);
    await page.eval(`(document.getElementById('openPatientImaging').click(), true)`);
    await sleep(500);
    await page.eval(`(() => {
      const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
      const r = document.querySelector('input[name="imagingPath"][value="radiographs"]'); r.checked = true; fire(r, 'change');
      const a = document.getElementById('imagingAuthorization'); a.checked = true; fire(a, 'change');
      const p = document.getElementById('imagingPixelReview'); p.checked = true; fire(p, 'change');
      document.querySelectorAll('.imaging-coverage-input').forEach(i => { i.checked = i.value !== 'lower-limb'; fire(i, 'change'); });
      const n = document.getElementById('autoLandmarkNeural'); if (n) { n.checked = false; fire(n, 'change'); }
      return true; })()`);
    await page.setFiles('#standingPaInput', [path.join(FIX, 'f21_jpeg_lossless_sv1_12bit.dcm')]);
    await page.setFiles('#standingLateralInput', [path.join(FIX, 'f32_rle_16bit_lateral.dcm')]);
    await sleep(300);
    await page.eval(`(document.getElementById('stagePatientImaging').click(), true)`);
    const t0 = Date.now();
    await sleep(500);
    while (Date.now() - t0 < 90000) {
      const s = await page.eval(`(() => ({ st: (document.getElementById('autoLandmarkStatus') || {}).dataset?.state, running: !!(window.__SPINE_AUTOCAL__ && window.__SPINE_AUTOCAL__.resultState && window.__SPINE_AUTOCAL__.resultState.running) }))()`);
      if (s.st !== 'running' && !s.running) break;
      await sleep(250);
    }
    const snap = await page.eval(`(() => ({
      status: (document.getElementById('autoLandmarkStatus') || {}).textContent || '',
      notes: Array.from(document.querySelectorAll('#autoLandmarkStatusNotes li')).map(li => li.textContent),
      pa: (document.getElementById('standingPaStatus') || {}).textContent || '', lat: (document.getElementById('standingLateralStatus') || {}).textContent || '' }))()`);
    const text = [snap.status, snap.pa, snap.lat].concat(snap.notes).join(' | ');
    console.log('  status: ' + snap.status.replace(/\s+/g, ' ').slice(0, 300));
    snap.notes.slice(0, 6).forEach(n => console.log('  note: ' + n.replace(/\s+/g, ' ').slice(0, 260)));
    check(!/could not be decoded|compressed_transfer_syntax_unsupported|DICOM [a-z_]+_unsupported/.test(text), 'app: neither plane is refused by the DICOM decoder');
    check(/Frontal DICOM decoded locally/.test(text), 'app: frontal JPEG Lossless DICOM is decoded locally');
    check(/Lateral DICOM decoded locally/.test(text), 'app: lateral RLE DICOM is decoded locally');

    const csp = await page.eval('window.__csp');
    check(Array.isArray(csp) && csp.length === 0, 'no CSP violations (' + JSON.stringify(csp) + ')');
    check(page.errors.length === 0, 'no page errors (' + JSON.stringify(page.errors.slice(0, 3)) + ')');
  } finally {
    await b.close();
  }
  console.log(`\nwp7: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// If the browser connection drops, a pending CDP call never settles and Node
// would exit 0 with nothing reported: treat an unfinished run as a failure.
process.on('beforeExit', () => {
  console.error(`\nwp7: INCOMPLETE run (browser connection lost?) after ${passed} passed, ${failed} failed`);
  process.exit(3);
});
main().catch(e => { console.error('FATAL', e && e.stack); process.exit(2); });
