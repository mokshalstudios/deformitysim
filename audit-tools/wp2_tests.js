#!/usr/bin/env node
'use strict';
// WP2 -- radiograph editor, raster and viewing tools.
//
//   node audit-tools/wp2_tests.js <build.html> [--node-only] [--headed]
//
// Part 1 (Node, source extracted from the build like interaction_harness.js):
//   - JPEG EXIF orientation 5-8 reports the displayed (swapped) size;
//   - exposed-field detection keeps the whole of a tightly collimated long film
//     (low-variance mid-grey soft-tissue bands, a narrow stitch band) while
//     still cropping a viewer screenshot and choosing one of two viewports;
//   - rotate/flip frame maps round-trip, and the pointer map inverts the
//     object-fit: contain letterbox and the display-resolution scale.
// Part 2 (Chrome through audit-tools/cdp.js, real GPU, the app's own CSP):
//   - focus-mode Undo/Redo/Skip/Done sit in the modal's top layer (hit-tested)
//     and work by real clicks; closing the dialog ends focus mode;
//   - letterboxed previews map a click to the painted pixel; zoomed focus mode too;
//   - EXIF-rotated JPEG and PNG decode upright (same frame as the plain file);
//   - a collimated long DICOM decodes once, keeps its full height and is shown
//     at full resolution (up to 2048 px) with exact click mapping;
//   - manual landmarks: place on release, drag-to-adjust, drag after completion,
//     undo/redo, jump-to-step, resume without wiping, undoable reset, keyboard;
//   - focus mode draws no automatic overlay and cannot edit hidden handles;
//   - apex handle wins over the centreline dot; a centreline re-fit keeps an
//     edited endplate; overlay undo/redo/reset; window/level and invert are
//     display-only; rotate/flip carry landmarks and withdraw the stale result.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const build = process.argv[2];
const nodeOnly = process.argv.includes('--node-only');
if (!build || !fs.existsSync(build)) {
  console.error('usage: node audit-tools/wp2_tests.js <build.html> [--node-only] [--headed]');
  process.exit(2);
}

let passed = 0, failed = 0;
const failures = [];
function check(cond, msg, detail) {
  if (cond) { passed++; return true; }
  failed++; failures.push(detail === undefined ? msg : `${msg} (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`);
  console.log('  FAIL: ' + failures[failures.length - 1]);
  return false;
}
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- Part 1 ----
const html = fs.readFileSync(build, 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1])
  .find(script => script.includes('window.__SPINE_AUTOCAL__') && script.includes('function analyzeLateral'));
if (!source) throw new Error('Automatic-landmark module was not found in the build.');
const between = (start, end) => {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`source block not found: ${start}`);
  return source.slice(first, last);
};
const clampValue = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const raster = new Function('clampValue',
  `${between('const RASTER_LIMITS = Object.freeze({', 'async function rasterFromFile(file, options){')}
   return { readRasterDimensions, orientTransform, applyAffine, invertAffine, mapRasterPoint, setRasterOptions, rasterOptionsFor };`)(clampValue);
const field = new Function('clampValue',
  `${between('function percentile(values, q){', 'const RASTER_LIMITS')}
   ${between('function axisContentSpan(', '// Contrast-limited adaptive')}
   return { detectExposedField };`)(clampValue);
const canvasFrames = new WeakMap();
const pickCanvasPoint = new Function('canvasFrames', `${between('function pickCanvasPoint(event, canvas){', 'function drawGuideDots')} return pickCanvasPoint;`)(canvasFrames);

function jpegWithOrientation(width, height, orientation, bigEndian) {
  const u16 = v => bigEndian ? [(v >> 8) & 255, v & 255] : [v & 255, (v >> 8) & 255];
  const u32 = v => bigEndian ? [0, 0, 0, v] : [v, 0, 0, 0];
  const tiff = [...(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(8), ...u16(1),
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const app1 = [...Buffer.from('Exif\0\0', 'binary'), ...tiff];
  const len = app1.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9]);
}

// Deterministic noise so synthetic films are reproducible.
let seed = 12345;
const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - .5; };
// A tightly collimated long AP film: black shutters top and bottom only (the
// field fills the width, so no black side bars inflate the row variance), a
// textured thorax, and an abdomen whose rows are low-variance mid-grey soft
// tissue with a faint spine -- the pattern that used to cut the film in two.
function collimatedFilm(w, h, stitch) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v;
    if (y < 18 || y >= h - 14) v = 0;
    else if (y < h * .45) v = 70 + 90 * (((x >> 3) + (y >> 4)) & 1) + 12 * noise();
    else v = 118 + 20 * noise() + (Math.abs(x - w / 2) < w * .07 ? 10 : 0);
    if (stitch && y >= stitch[0] && y < stitch[1]) v = 0;
    g[y * w + x] = clampValue(Math.round(v), 0, 255);
  }
  return g;
}
function viewerShot(w, h, strips, toolbar) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    strips.forEach(([x0, x1]) => { if (x >= x0 && x < x1) v = 60 + 120 * (((x >> 2) + (y >> 3)) & 1) + 10 * noise(); });
    if (toolbar && y >= h - toolbar) v = 230;
    g[y * w + x] = clampValue(Math.round(v), 0, 255);
  }
  return g;
}

(async () => {
  console.log('Part 1: Node');
  // EXIF orientation.
  for (const [o, be] of [[6, false], [8, true], [5, false], [7, true], [3, false], [1, false]]) {
    const dims = await raster.readRasterDimensions(new Blob([jpegWithOrientation(840, 420, o, be)], { type: 'image/jpeg' }));
    const transposed = o >= 5;
    check(dims.width === (transposed ? 420 : 840) && dims.height === (transposed ? 840 : 420) && dims.orientation === o,
      `JPEG EXIF orientation ${o} (${be ? 'big' : 'little'}-endian TIFF) reports the displayed size`, dims);
  }
  // Exposed field.
  {
    const w = 186, h = 840, f = field.detectExposedField(collimatedFilm(w, h), w, h);
    check(f.y0 <= 24 && f.y1 >= h - 20 && f.x0 <= 4 && f.x1 >= w - 5,
      'tightly collimated long film keeps the lumbar spine and pelvis (edge shutters trimmed only)', f);
    const s = field.detectExposedField(collimatedFilm(w, h, [500, 512]), w, h);
    check(s.y0 <= 24 && s.y1 >= h - 20, 'a narrow uniform stitch band does not split the film', s);
    const shot = field.detectExposedField(viewerShot(520, 426, [[200, 320]], 16), 520, 426);
    check(shot.cropped && near(shot.x0, 202, 4) && near(shot.x1, 317, 4) && shot.y1 <= 426 - 16,
      'a viewer screenshot is still cropped to the film strip and loses its toolbar', shot);
    const two = field.detectExposedField(viewerShot(520, 426, [[40, 170], [280, 500]]), 520, 426);
    check(two.cropped && two.x0 >= 270 && two.x1 <= 505, 'a two-viewport screenshot keeps one viewport (the wider)', two);
  }
  // Rotate/flip frame maps.
  {
    const frame = options => {
      const t = raster.orientTransform(options, 100, 200);
      return { frame: { decodedWidth: 100, decodedHeight: 200, matrix: t.matrix, region: { sx: 0, sy: 0, sw: t.width, sh: t.height }, zoomX: 2, zoomY: 2 }, size: [t.width, t.height] };
    };
    const base = frame({ rotate: 0, flip: false });
    const p = { x: 30, y: 50 };                      // analysis units; decoded (15, 25)
    const r90 = frame({ rotate: 90, flip: false });
    const q = raster.mapRasterPoint(p, base, r90);   // clockwise: (H - y, x) = (175, 15) -> x2
    check(near(q.x, 350, 1e-9) && near(q.y, 30, 1e-9) && r90.size[0] === 200 && r90.size[1] === 100, 'rotate 90 maps decoded (x,y) to (H-y, x)', q);
    const flip = frame({ rotate: 0, flip: true });
    const m = raster.mapRasterPoint(p, base, flip);
    check(near(m.x, 170, 1e-9) && near(m.y, 50, 1e-9), 'flip mirrors x about the decoded width', m);
    let cur = base, pt = p;
    for (let i = 1; i <= 4; i++) { const next = frame({ rotate: 90 * i, flip: false }); pt = raster.mapRasterPoint(pt, cur, next); cur = next; }
    check(near(pt.x, p.x, 1e-9) && near(pt.y, p.y, 1e-9), 'four quarter turns return every point exactly', pt);
    // The flip button composes as mirror-of-the-current-display.
    const r90f = frame({ rotate: 270, flip: true });
    const viaDisplay = raster.mapRasterPoint(raster.mapRasterPoint(p, base, r90), r90, r90f);
    const [W] = r90.size;
    const expectMirror = raster.mapRasterPoint(p, base, r90);
    check(near(viaDisplay.x, W * 2 - expectMirror.x, 1e-9) && near(viaDisplay.y, expectMirror.y, 1e-9),
      'rotate-then-flip mirrors the displayed image (rotate 270 + mirror)', viaDisplay);
  }
  // Pointer map through the letterbox and the display-resolution scale.
  {
    const canvas = { width: 384, height: 1680, getBoundingClientRect: () => ({ left: 100, top: 50, width: 474.5, height: 560 }) };
    canvasFrames.set(canvas, { kx: 2, ky: 2 });
    const s = 560 / 1680, ox = 100 + (474.5 - 384 * s) / 2;
    const hit = pickCanvasPoint({ clientX: ox + 60 * s, clientY: 50 + 600 * s }, canvas);
    check(near(hit.x, 30, 1e-9) && near(hit.y, 300, 1e-9) && hit.inside, 'click on a painted pixel maps to its analysis point', hit);
    const bar = pickCanvasPoint({ clientX: 110, clientY: 300 }, canvas);
    check(bar.inside === false, 'a click in the letterbox bar is outside the image', bar);
  }
  if (nodeOnly) return finish();

  // ---------------------------------------------------------------- Part 2 ----
  console.log('Part 2: Chrome');
  const { launch, fileUrl, sleep } = require('./cdp.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp2-'));
  const b = await launch({ headless: !process.argv.includes('--headed') });
  try {
    const open = async (viewport = { width: 1440, height: 900 }, mobile = false) => {
      const page = await b.open(fileUrl(path.resolve(build)), viewport);
      if (mobile) await page.setViewport(viewport.width, viewport.height, { mobile: true });
      await page.unlock();
      await page.eval(`(() => { const b = document.getElementById('introExplore'); if (b) b.click(); return true; })()`);
      await sleep(250);
      if (process.env.WP2_DEBUG) await page.eval(`(() => { window.__wp2Events = []; ['pointerdown','mousedown','click','touchstart'].forEach(t => document.addEventListener(t, e => { window.__wp2Events.push(t + ':' + (e.target.id || e.target.tagName) + ':' + Math.round(e.clientY)); if (window.__wp2Events.length > 12) window.__wp2Events.shift(); }, true)); return true; })()`);
      return page;
    };
    const stage = async (page, { frontal, lateral, autoRun = false }) => {
      await page.eval(`(() => { const d = document.getElementById('patientImagingDialog'); if (!d.open) document.getElementById('openPatientImaging').click(); return true; })()`);
      await sleep(200);
      await page.eval(`(() => {
        for (const id of ['imagingAuthorization','imagingPixelReview']) { const e = document.getElementById(id); e.checked = true; e.dispatchEvent(new Event('change', {bubbles:true})); }
        document.querySelectorAll('.imaging-coverage-input').forEach(i => { i.checked = true; i.dispatchEvent(new Event('change', {bubbles:true})); });
        document.getElementById('autoLandmarkRunOnStage').checked = ${autoRun};
        const n = document.getElementById('autoLandmarkNeural'); if (n) n.checked = false;
        return true; })()`);
      if (frontal) await page.setFiles('#standingPaInput', [frontal]);
      if (lateral) await page.setFiles('#standingLateralInput', [lateral]);
      await sleep(400);
      await page.eval(`document.getElementById('stagePatientImaging').click()`);
      try {
        await page.waitFor(`(() => { const A = window.__SPINE_AUTOCAL__, r = A.resultState; return ${!frontal} === !(r.previewRaster.frontal || r.frontal) && ${!lateral} === !(r.previewRaster.lateral || r.lateral) && A.ui.status.dataset.state !== 'running'; })()`, { timeout: 60000 });
      } catch (error) {
        const why = await page.eval(`JSON.stringify({ status: document.getElementById('autoLandmarkStatus').textContent, preflight: document.getElementById('imagingPreflightStatus').textContent.replace(/\\s+/g, ' ').slice(0, 300), previewError: window.__SPINE_AUTOCAL__.resultState.previewError })`);
        throw new Error(`staging ${path.basename(frontal || '')} + ${path.basename(lateral || '')} did not finish: ${why}`);
      }
      if (autoRun) await page.waitFor(`(() => { const r = window.__SPINE_AUTOCAL__.resultState; return !r.running && !!(r.frontal || r.lateral); })()`, { timeout: 120000 });
      await sleep(250);
    };
    const A = (page, expr) => page.eval(`(() => { const A = window.__SPINE_AUTOCAL__; return ${expr}; })()`);
    // Painted content box of a canvas and the analysis->client map for it.
    const mapper = async (page, plane) => {
      const box = await page.eval(`(() => { const A = window.__SPINE_AUTOCAL__; const c = A.ui.${plane}Canvas; const r = c.getBoundingClientRect();
        const raster = A.resultState.${plane} ? A.resultState.${plane}.analysis : A.resultState.previewRaster.${plane};
        const s = Math.min(r.width / c.width, r.height / c.height);
        return { x: r.left + (r.width - c.width * s) / 2, y: r.top + (r.height - c.height * s) / 2, s, kx: c.width / raster.width, ky: c.height / raster.height }; })()`);
      return (x, y) => [box.x + x * box.kx * box.s, box.y + y * box.ky * box.s];
    };
    // Waits until an element stops moving (smooth scrolling, layout after focus changes).
    const settle = async (page, selector) => {
      let last = '', stable = 0;
      for (let i = 0; i < 50 && stable < 3; i++) {
        await sleep(120);
        const now = await page.eval(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`);
        stable = now === last ? stable + 1 : 0; last = now;
      }
    };
    const press = async (page, selector) => {
      await page.eval(`(() => { document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
      await settle(page, selector);
      const r = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: h && (h.id || h.tagName) }; })()`);
      if (process.env.WP2_DEBUG) console.log('press', selector, JSON.stringify(r));
      await page.click(r.x, r.y); await sleep(150);
      if (process.env.WP2_DEBUG) console.log('after press', await page.eval(`JSON.stringify({ active: window.__SPINE_AUTOCAL__.manual.active, status: document.getElementById('autoLandmarkStatus').textContent.slice(0, 80), focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName), rect: document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().y, scroll: document.querySelector('#patientImagingDialog .dialog-body').scrollTop, events: window.__wp2Events })`));
    };
    const hit = (page, id) => page.eval(`(() => { const e = document.getElementById('${id}'); const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return h ? h.id || h.tagName : null; })()`);
    const clickId = async (page, id) => { const r = await page.eval(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); await page.click(r.x, r.y); await sleep(120); };
    const key = async (page, k, code, vk, modifiers = 0) => {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, text: k.length === 1 && !modifiers ? k : undefined });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await sleep(60);
    };
    const coloured = (page, plane) => page.eval(`(() => { const c = window.__SPINE_AUTOCAL__.ui.${plane}Canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.max(Math.abs(d[i]-d[i+1]), Math.abs(d[i+1]-d[i+2]), Math.abs(d[i]-d[i+2])) > 24) n++; return n; })()`);

    // --- Synthetic EXIF files and a collimated long DICOM, made in the page.
    {
      const page = await open();
      const made = await page.eval(`(async () => {
        const w = 300, h = 600, portrait = document.createElement('canvas'); portrait.width = w; portrait.height = h;
        const p = portrait.getContext('2d'); p.fillStyle = '#111'; p.fillRect(0, 0, w, h);
        for (let i = 0; i < 17; i++) { const y = 30 + i * 32, x = 150 + 60 * Math.sin(i / 3); p.fillStyle = '#ddd'; p.fillRect(x - 22, y, 44, 24); }
        p.fillStyle = '#888'; p.fillRect(20, 40, 30, 520);
        const stored = document.createElement('canvas'); stored.width = h; stored.height = w;
        const s = stored.getContext('2d'); s.translate(0, w); s.rotate(-Math.PI / 2); s.drawImage(portrait, 0, 0);   // 90° CCW: orientation 6 turns it back
        const bytes = async (canvas, type) => new Uint8Array(await (await new Promise(r => canvas.toBlob(r, type, .95))).arrayBuffer());
        const b64 = u => { let t = ''; for (let i = 0; i < u.length; i += 8192) t += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(t); };
        return { plain: b64(await bytes(portrait, 'image/jpeg')), rotatedJpeg: b64(await bytes(stored, 'image/jpeg')), rotatedPng: b64(await bytes(stored, 'image/png')) };
      })()`);
      const exif = Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
      const jpeg = Buffer.from(made.rotatedJpeg, 'base64');
      const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
      fs.writeFileSync(path.join(tmp, 'plain.jpg'), Buffer.from(made.plain, 'base64'));
      fs.writeFileSync(path.join(tmp, 'exif6.jpg'), Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]));
      // PNG eXIf chunk (orientation 6) straight after IHDR; its orientation is
      // not parsed from the header, so this exercises the decoded-aspect check.
      const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
      const crc32 = buf => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const png = Buffer.from(made.rotatedPng, 'base64'), tiff = exif.subarray(6);
      const body = Buffer.concat([Buffer.from('eXIf'), tiff]), chunk = Buffer.alloc(body.length + 8);
      chunk.writeUInt32BE(tiff.length, 0); body.copy(chunk, 4); chunk.writeUInt32BE(crc32(body), body.length + 4);
      fs.writeFileSync(path.join(tmp, 'exif6.png'), Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]));
      // Collimated long DICOM (Explicit VR LE, 8-bit MONOCHROME2), 600 x 2400.
      const W = 600, H = 2400, pixels = Buffer.from(collimatedFilm(W, H));
      const el = (g, e, vr, val) => { const v = Buffer.isBuffer(val) ? val : Buffer.from(val, 'latin1'); const padded = v.length % 2 ? Buffer.concat([v, Buffer.from(vr === 'UI' || vr === 'OB' ? [0] : [0x20])]) : v;
        if (['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr)) { const h = Buffer.alloc(12); h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.write(vr, 4, 'latin1'); h.writeUInt32LE(padded.length, 8); return Buffer.concat([h, padded]); }
        const h = Buffer.alloc(8); h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.write(vr, 4, 'latin1'); h.writeUInt16LE(padded.length, 6); return Buffer.concat([h, padded]); };
      const us = v => { const x = Buffer.alloc(2); x.writeUInt16LE(v); return x; };
      const meta = Buffer.concat([el(2, 1, 'OB', Buffer.from([0, 1])), el(2, 2, 'UI', '1.2.840.10008.5.1.4.1.1.1.1'), el(2, 3, 'UI', '1.2.3.4.5'), el(2, 0x10, 'UI', '1.2.840.10008.1.2.1')]);
      const ul = Buffer.alloc(4); ul.writeUInt32LE(meta.length);
      const data = Buffer.concat([el(8, 0x16, 'UI', '1.2.840.10008.5.1.4.1.1.1.1'), el(8, 0x60, 'CS', 'DX'), el(0x18, 0x1164, 'DS', '0.15\\0.15'),
        el(0x28, 2, 'US', us(1)), el(0x28, 4, 'CS', 'MONOCHROME2'), el(0x28, 0x10, 'US', us(H)), el(0x28, 0x11, 'US', us(W)),
        el(0x28, 0x100, 'US', us(8)), el(0x28, 0x101, 'US', us(8)), el(0x28, 0x102, 'US', us(7)), el(0x28, 0x103, 'US', us(0)), el(0x7fe0, 0x10, 'OB', pixels)]);
      fs.writeFileSync(path.join(tmp, 'collimated.dcm'), Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), el(2, 0, 'UL', ul), meta, data]));
      await page.close();
    }

    // --- EXIF decode: upright, same frame as the plain file.
    {
      const page = await open();
      const shapes = {};
      for (const name of ['plain.jpg', 'exif6.jpg', 'exif6.png']) {
        await page.eval(`(() => { const A = window.__SPINE_AUTOCAL__; A.clearSession && A.clearSession(); return true; })()`);
        await stage(page, { frontal: path.join(tmp, name), lateral: path.join(ROOT, 'samples', '2.jpg') });
        shapes[name] = await A(page, `(() => { const r = A.resultState.previewRaster.frontal; const d = r.canvas.getContext('2d').getImageData(0, 0, r.width, r.height).data; const g = []; for (let i = 0; i < d.length; i += 4 * 7) g.push(d[i]); return { w: r.width, h: r.height, sw: r.sourceWidth, sh: r.sourceHeight, g }; })()`);
      }
      const diff = (a, b) => { let s = 0; const n = Math.min(a.g.length, b.g.length); for (let i = 0; i < n; i++) s += Math.abs(a.g[i] - b.g[i]); return s / Math.max(1, n); };
      for (const name of ['exif6.jpg', 'exif6.png']) {
        const a = shapes['plain.jpg'], x = shapes[name];
        check(x.w === a.w && x.h === a.h && x.sw === 300 && x.sh === 600, `${name}: decoded upright at the displayed aspect, not squashed`, { plain: [a.w, a.h], got: [x.w, x.h, x.sw, x.sh] });
        check(x.w === a.w && diff(a, x) < 12, `${name}: pixels match the upright original`, diff(a, x));
      }
      check(!page.errors.length, 'no page errors while decoding EXIF files', page.errors.slice(0, 3));
      await page.close();
    }

    // --- DICOM: one decode per file, full collimated field, full-resolution view.
    {
      const page = await open();
      const wrapped = await page.eval(`(() => { const d = window.__SPINE_DICOM__; window.__wp2Decodes = 0; if (!d || Object.isFrozen(d)) return false;
        ['decodeRadiograph', 'decodeRadiographAsync'].forEach(k => { const f = d[k]; if (typeof f === 'function') d[k] = function(){ window.__wp2Decodes++; return f.apply(this, arguments); }; }); return true; })()`);
      await stage(page, { frontal: path.join(tmp, 'collimated.dcm'), lateral: path.join(ROOT, 'samples', '2.jpg') });
      const info = await A(page, `(() => { const r = A.resultState.previewRaster.frontal; return { sh: r.sourceHeight, sfh: r.sourceFieldHeight, cropped: r.fieldCropped, h: r.height, contentY1: r.content.y1, cw: A.ui.frontalCanvas.width, ch: A.ui.frontalCanvas.height }; })()`);
      check(info.sfh === 2400 && !info.cropped && info.contentY1 >= info.h - 12, 'collimated long DICOM keeps its full height (no interior split)', info);
      check(info.ch === 2048 && info.cw > 500, 'DICOM is displayed from a 2048 px full-resolution view, not the 840 px analysis raster', info);
      // Click mapping on the full-resolution canvas (guide anchor).
      await page.eval(`(() => { document.getElementById('guideFrontalApex').click(); document.getElementById('autoLandmarkFrontalFigure').scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
      await settle(page, '#autoLandmarkFrontalCanvas');
      const at = await mapper(page, 'frontal');
      const [gx, gy] = at(80.25, 400.5);
      await page.click(gx, gy); await sleep(150);
      const guide = await A(page, `A.getGuides().frontal.apex`);
      check(guide && near(guide.x, 80.25, .6) && near(guide.y, 400.5, .6), 'click on the full-resolution canvas maps back to analysis coordinates', guide || 'no guide placed');
      await page.eval(`window.__SPINE_AUTOCAL__.run()`);
      await sleep(300);
      // The intake's selection-time decode (WP4 F027: decodability, header
      // summary, thumbnail) is handed to the analysis module, so selection,
      // stage and run share one decode.
      if (wrapped) check(await page.eval('window.__wp2Decodes') === 1, 'the DICOM is decoded once for selection, stage and run', await page.eval('window.__wp2Decodes'));
      check(!page.errors.length, 'no page errors on the DICOM path', page.errors.slice(0, 3));
      await page.close();
    }

    // --- Focus mode on desktop and phone: controls reachable, manual editing.
    for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const page = await open(viewport, mobile);
      await stage(page, { frontal: path.join(ROOT, 'samples', '1.jpg'), lateral: path.join(ROOT, 'samples', '2.jpg') });
      await press(page, '#manualStartFrontal'); await settle(page, '#autoLandmarkFrontalCanvas');
      for (const id of ['manualFocusUndo', 'manualFocusRedo', 'manualFocusSkip', 'manualFocusDone']) check(await hit(page, id) === id, `${label}: #${id} is on top while the dialog is modal`, await hit(page, id));
      let at = await mapper(page, 'frontal');
      for (const [x, y] of [[60, 300], [120, 310], [70, 500]]) { const [cx, cy] = at(x, y); await page.click(cx, cy); await sleep(120); }
      let pts = await A(page, `A.manual.points.frontal`);
      check(near(pts.upA.x, 60, .05) && near(pts.upB.y, 310, .05) && near(pts.lowA.y, 500, .05), `${label}: taps land on the painted pixel`, pts);
      await page.drag(at(130, 505), at(140, 520), 6); await sleep(150);
      pts = await A(page, `A.manual.points.frontal`);
      check(pts.lowB && near(pts.lowB.x, 140, .05) && near(pts.lowB.y, 520, .05), `${label}: press-slide-release places at the release point`, pts.lowB);
      await clickId(page, 'manualFocusUndo');
      check(await A(page, `A.manual.index === 3 && !A.manual.points.frontal.lowB`), `${label}: focus-bar Undo removes the last point`);
      await clickId(page, 'manualFocusRedo');
      check(await A(page, `A.manual.index === 4 && !!A.manual.points.frontal.lowB`), `${label}: focus-bar Redo restores it`);
      await clickId(page, 'manualFocusSkip');
      check(await A(page, `A.manual.active && A.manual.index === 5`), `${label}: Skip answers the step and keeps focus mode`);
      at = await mapper(page, 'frontal');   // the prompt changed height, so the image moved
      await page.drag(at(60, 300), at(66, 292), 6); await sleep(150);
      pts = await A(page, `A.manual.points.frontal`);
      check(near(pts.upA.x, 66, .05) && near(pts.upA.y, 292, .05), `${label}: a placed point can be dragged after the sequence`, pts.upA);
      await page.eval(`document.querySelector('#manualPrompt .manual-steps button[data-step="4"]').click()`); await sleep(100);
      check(await A(page, `A.manual.index`) === 4, `${label}: choosing a step in the list re-opens it`);
      // Zoom with the wheel about a point, then place: mapping stays exact.
      { const [cx, cy] = at(96, 420); await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -400 }); await sleep(250); }
      await settle(page, '#autoLandmarkFrontalCanvas');
      const zoomed = await page.eval(`document.getElementById('autoLandmarkFrontalCanvas').style.transform`);
      check(/scale\(/.test(zoomed), `${label}: wheel zooms the focus canvas`, zoomed);
      at = await mapper(page, 'frontal');
      { const [cx, cy] = at(90, 430); await page.click(cx, cy); await sleep(150); }
      pts = await A(page, `A.manual.points.frontal`);
      check(pts.apex && near(pts.apex.x, 90, .05) && near(pts.apex.y, 430, .05), `${label}: a tap on the zoomed image lands on the painted pixel`, pts.apex);
      await clickId(page, 'manualFocusDone');
      check(await page.eval(`!window.__SPINE_AUTOCAL__.manual.active && !document.body.dataset.manualFocus && !document.getElementById('autoLandmarkFrontalCanvas').style.transform`), `${label}: Done exits focus mode and resets the zoom`);
      // Resume keeps the points; reset is undoable.
      await press(page, '#manualStartFrontal'); await settle(page, '#autoLandmarkFrontalCanvas');
      check(await A(page, `A.manual.active && Object.keys(A.manual.points.frontal).length === 5 && A.manual.index === 5`), `${label}: restarting resumes instead of wiping the points`);
      await page.eval(`document.getElementById('patientImagingDialog').close()`);
      // The dialog's close event is queued as a task, so allow for a busy frame.
      await page.waitFor(`!window.__SPINE_AUTOCAL__.manual.active`, { timeout: 3000 }).catch(() => {});
      const closed = await page.eval(`({ active: window.__SPINE_AUTOCAL__.manual.active, flag: document.body.dataset.manualFocus || null, open: document.getElementById('patientImagingDialog').open, status: document.getElementById('autoLandmarkStatus').textContent.slice(0, 90) })`);
      check(!closed.active && !closed.flag, `${label}: closing the dialog ends focus mode`, closed);
      await page.eval(`(() => { document.getElementById('openPatientImaging').click(); return true; })()`); await sleep(300);
      await page.eval(`document.getElementById('manualReset').click()`); await sleep(100);
      check(await A(page, `Object.keys(A.manual.points.frontal).length === 0`), `${label}: Reset clears the landmarks`);
      await page.eval(`document.getElementById('manualUndo').click()`); await sleep(100);
      check(await A(page, `Object.keys(A.manual.points.frontal).length === 5`), `${label}: Undo restores the landmarks after Reset`);
      check(!page.errors.length, `${label}: no page errors`, page.errors.slice(0, 3));
      await page.close();
    }

    // --- Review editor after an automatic run.
    {
      const page = await open();
      await stage(page, { frontal: path.join(ROOT, 'samples', '1.jpg'), lateral: path.join(ROOT, 'samples', '2.jpg'), autoRun: true });
      await page.eval(`(() => { document.getElementById('autoLandmarkFrontalFigure').scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`); await settle(page, '#autoLandmarkFrontalCanvas');
      check(await coloured(page, 'frontal') > 50, 'review mode draws the automatic overlay (sanity)');
      check(await page.eval(`(() => { const t = id => document.querySelector('#autoLandmarkFrontalFigure .rg-view-tools [data-tool="' + id + '"]'); return !t('rotate').disabled && !t('fullFrame').disabled && !t('resetOverlay').disabled && t('zoomOut').disabled; })()`),
        'after a run the orientation and reset-overlay tools are enabled (zoom-out disabled at fit)');
      const f = await A(page, `(() => { const f = A.resultState.frontal; return { apex: f.centers[f.apexIndex], upperB: f.lines[f.primary.i].b, cobb: f.values.coronalMagnitude }; })()`);
      let at = await mapper(page, 'frontal');
      // Apex dot beats the centreline dot underneath it.
      { const [x, y] = at(f.apex.x, f.apex.y); await page.drag([x, y], [x + 7, y], 6); await sleep(250); }
      const apex = await A(page, `({ manual: A.resultState.frontal.manualApex, centreline: !!A.resultState.frontal.corridor.userEdited })`);
      check(apex.manual && apex.manual.x > f.apex.x + 3 && !apex.centreline, 'dragging the apex marker moves the apex, not the centreline', apex);
      // An endpoint edit survives a later centreline re-fit.
      { const [x, y] = at(f.upperB.x, f.upperB.y); await page.drag([x, y], [x, y - 9], 6); await sleep(250); }
      const edited = await A(page, `(() => { const r = A.resultState.frontal; const l = r.lines[r.primary.i]; return { a: l.a, b: l.b, angle: l.angle, pair: [r.primary.i, r.primary.j], flag: !!l.userEdited }; })()`);
      const last = await A(page, `(() => { const r = A.resultState.frontal; return r.centers[r.centers.length - 1]; })()`);
      { const [x, y] = at(last.x, last.y); await page.drag([x, y], [x + 7, y], 6); await sleep(350); }
      // The untouched line of the pair may be re-detected along the new path;
      // the line the user shaped, and the pair's end vertebrae, must not change.
      const kept = await A(page, `(() => { const r = A.resultState.frontal; const l = r.lines[r.primary.i]; return { a: l.a, b: l.b, angle: l.angle, pair: [r.primary.i, r.primary.j], refit: !!r.corridor.userEdited }; })()`);
      check(edited.flag && kept.refit && near(kept.b.x, edited.b.x, 1e-6) && near(kept.b.y, edited.b.y, 1e-6) && near(kept.a.y, edited.a.y, 1e-6)
          && near(kept.angle, edited.angle, 1e-9) && kept.pair.join() === edited.pair.join(),
        'a centreline re-fit keeps an endpoint the user edited and its Cobb pair', { edited, kept });
      // Undo three edits from the keyboard, redo one, then reset the overlay.
      await page.eval(`document.getElementById('autoLandmarkFrontalCanvas').focus()`);
      for (let i = 0; i < 3; i++) await key(page, 'z', 'KeyZ', 90, 2);
      const undone = await A(page, `(() => { const r = A.resultState.frontal; return { apex: r.manualApex, cobb: r.values.coronalMagnitude }; })()`);
      check(!undone.apex && near(undone.cobb, f.cobb, 1e-6), 'Ctrl+Z walks the overlay back to the detection', undone);
      await key(page, 'y', 'KeyY', 89, 2);
      check(!!(await A(page, `A.resultState.frontal.manualApex`)), 'Ctrl+Y re-applies the apex edit');
      await page.eval(`document.querySelector('#autoLandmarkFrontalFigure .rg-view-tools [data-tool="resetOverlay"]').click()`); await sleep(150);
      check(!(await A(page, `A.resultState.frontal.manualApex`)) && near(await A(page, `A.resultState.frontal.values.coronalMagnitude`), f.cobb, 1e-6), 'Reset overlay restores the detected lines');
      // Keyboard: Tab selects a handle, arrows nudge it, the live region says so.
      await page.eval(`document.getElementById('autoLandmarkFrontalCanvas').focus()`);
      await key(page, 'Tab', 'Tab', 9);
      const before = await A(page, `(() => { const h = A.resultState.selectedHandle; return h && { kind: h.kind, p: h.kind === 'line' ? { ...h.line[h.endpoint] } : { ...h.point } }; })()`);
      await key(page, 'ArrowRight', 'ArrowRight', 39);
      const afterNudge = await A(page, `(() => { const h = A.resultState.selectedHandle; return h && (h.kind === 'line' ? { ...h.line[h.endpoint] } : { ...h.point }); })()`);
      check(before && afterNudge && afterNudge.x > before.p.x && /x \d+, y \d+/.test(await page.eval(`document.getElementById('rgEditorLive').textContent`)), 'Tab selects a handle and the arrow keys nudge it (announced)', { before, afterNudge });
      // Window/level and invert are display-only.
      const valuesBefore = JSON.stringify(await A(page, `A.resultState.frontal.values`));
      const centre = `(() => { const c = document.getElementById('autoLandmarkFrontalCanvas'); return Array.from(c.getContext('2d').getImageData(Math.round(c.width / 2), Math.round(c.height * .4), 1, 1).data.slice(0, 3)); })()`;
      const px0 = await page.eval(centre);
      await page.eval(`document.querySelector('#autoLandmarkFrontalFigure .rg-view-tools [data-tool="invert"]').click()`); await sleep(120);
      const px1 = await page.eval(centre);
      check(px1[0] === 255 - px0[0] && JSON.stringify(await A(page, `A.resultState.frontal.values`)) === valuesBefore, 'Invert changes only the displayed pixels', { px0, px1 });
      await page.eval(`document.querySelector('#autoLandmarkFrontalFigure .rg-view-tools [data-tool="resetView"]').click()`); await sleep(120);
      check(JSON.stringify(await page.eval(centre)) === JSON.stringify(px0), 'Reset view restores the display');
      // Clean focus mode: no automatic overlay, and hidden handles cannot be edited.
      await press(page, '#manualStartFrontal'); await settle(page, '#autoLandmarkFrontalCanvas');
      check(await coloured(page, 'frontal') === 0, 'focus mode shows no automatic overlay before any point is placed', await coloured(page, 'frontal'));
      at = await mapper(page, 'frontal');
      for (const [x, y] of [[60, 300], [120, 310], [70, 500], [130, 505], [96, 420]]) { const [cx, cy] = at(x, y); await page.click(cx, cy); await sleep(100); }
      const linesBefore = JSON.stringify(await A(page, `A.resultState.frontal.lines`));
      const ub = await A(page, `(() => { const r = A.resultState.frontal; return r.lines[r.primary.i].b; })()`);
      { const [x, y] = at(ub.x, ub.y); await page.drag([x, y], [x + 12, y + 12], 6); await sleep(200); }
      check(JSON.stringify(await A(page, `A.resultState.frontal.lines`)) === linesBefore, 'a drag in focus mode after the last point cannot move a hidden automatic handle');
      await clickId(page, 'manualFocusDone');
      // Keyboard placement: arrows move a crosshair from the image centre (one
      // display pixel per press, Shift x10), Enter places, S skips, Backspace undoes.
      await page.eval(`window.__SPINE_AUTOCAL__.resetManual()`);
      await press(page, '#manualStartLateral'); await settle(page, '#autoLandmarkLateralCanvas');
      const lr = await A(page, `(() => { const r = A.resultState.lateral ? A.resultState.lateral.analysis : A.resultState.previewRaster.lateral; return { w: r.width, h: r.height, kx: A.ui.lateralCanvas.width / r.width, ky: A.ui.lateralCanvas.height / r.height, focused: document.activeElement === A.ui.lateralCanvas }; })()`);
      for (let i = 0; i < 3; i++) await key(page, 'ArrowRight', 'ArrowRight', 39);
      for (let i = 0; i < 2; i++) await key(page, 'ArrowDown', 'ArrowDown', 40, 8);
      await key(page, 'Enter', 'Enter', 13);
      const kp = await A(page, `({ p: A.manual.points.lateral.c2a, index: A.manual.index })`);
      check(lr.focused && kp.p && near(kp.p.x, lr.w / 2 + 3 / lr.kx, 1e-6) && near(kp.p.y, lr.h / 2 + 20 / lr.kx, 1e-6) && kp.index === 1,
        'keyboard: the image takes focus, arrows move the crosshair and Enter places the landmark', { lr, kp });
      await key(page, 's', 'KeyS', 83);
      const skipped = await A(page, `A.manual.index`);
      await key(page, 'Backspace', 'Backspace', 8);
      check(skipped === 2 && await A(page, `A.manual.index`) === 1, 'keyboard: S skips a landmark and Backspace undoes it', { skipped });
      await clickId(page, 'manualFocusDone');
      await page.eval(`window.__SPINE_AUTOCAL__.resetManual()`);
      // Rotate the lateral: landmarks follow, the stale result is withdrawn, four turns return.
      await page.eval(`(() => { const A = window.__SPINE_AUTOCAL__; A.startManual('lateral'); A.recordManualPoint('lateral', { x: 100, y: 200 }); A.recordManualPoint('lateral', { x: 150, y: 210 }); document.getElementById('manualFocusDone').click(); return true; })()`); await sleep(150);
      // (The lateral result can be absent while the detector is being reworked;
      // the carry test then runs on the preview raster alone.)
      const lat0 = await A(page, `({ result: !!A.resultState.lateral, p: JSON.parse(JSON.stringify(A.manual.points.lateral)) })`);
      const rotate = async turn => { await page.eval(`document.querySelector('#autoLandmarkLateralFigure .rg-view-tools [data-tool="rotate"]').click()`);
        await page.waitFor(`(() => { const r = window.__SPINE_AUTOCAL__.resultState.previewRaster.lateral; return !!r && r.rasterOptions.rotate === ${turn % 360}; })()`, { timeout: 30000 }); await sleep(100); };
      await rotate(90);
      const lat1 = await A(page, `({ result: !!A.resultState.lateral, w: A.resultState.previewRaster.lateral.width, h: A.resultState.previewRaster.lateral.height, p: A.manual.points.lateral })`);
      check(!lat1.result && lat1.p.c2a && (lat1.p.c2a.x !== lat0.p.c2a.x), `rotating carries the landmarks${lat0.result ? ' and withdraws the old-frame result' : ''}`, lat1);
      for (const turn of [180, 270, 360]) await rotate(turn);
      const lat4 = await A(page, `A.manual.points.lateral`);
      check(near(lat4.c2a.x, 100, 1e-6) && near(lat4.c2a.y, 200, 1e-6) && near(lat4.c2p.x, 150, 1e-6), 'four quarter turns bring the landmarks back exactly', lat4);
      await page.eval(`document.querySelector('#autoLandmarkLateralFigure .rg-view-tools [data-tool="fullFrame"]').click()`);
      await page.waitFor(`(() => { const r = window.__SPINE_AUTOCAL__.resultState.previewRaster.lateral; return !!r && r.rasterOptions.fullFrame; })()`, { timeout: 30000 });
      const full = await A(page, `(() => { const r = A.resultState.previewRaster.lateral; return { cropped: r.fieldCropped, sfw: r.sourceFieldWidth, sw: r.sourceWidth }; })()`);
      check(!full.cropped && full.sfw === full.sw, 'Full frame turns the automatic crop off', full);
      check(!page.errors.length, 'no page errors in the review editor', page.errors.slice(0, 3));
      await page.close();
    }
  } finally {
    // Browser.close can go unanswered when Chrome drops the socket first.
    await Promise.race([b.close(), sleep(5000)]);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ }
  }
  finish();
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });

function finish() {
  console.log(JSON.stringify({ file: path.resolve(build), passed, failed, failures }, null, 2));
  process.exit(failed ? 1 : 0);
}
