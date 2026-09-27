#!/usr/bin/env node
'use strict';
// Regression checks for the deskew-before-neural-inference path
// (NEURAL_DESKEW in src/js/radiograph/05-analyze.js, neuralDeskewInput in
// 06-results-ui.js, frontalNeuralPasses in 07-run-init.js).
//
//   node audit-tools/deskew_tests.js <build.html> [--headed]
//
// Part A runs on any build (the detector is stubbed): the axis estimate, the
// exact model-px <-> analysis-px mapping through a rotation and re-framing,
// and the pass selection (deskewed pass kept only when it meets the same gates).
// Part B needs a build with the model weights and samples/1.jpg (a film the
// network accepts upright; 2-1.jpg is rejected even upright): the real
// network on the sample film rotated in-page by -12 deg, directly and through
// the staging UI (status line, notes and provenance name the deskew).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, fileUrl, sleep } = require('./cdp.js');

const ROOT = path.join(__dirname, '..');
const build = process.argv[2];
if (!build || !fs.existsSync(build)) {
  console.error('usage: node audit-tools/deskew_tests.js <build.html> [--headed]');
  process.exit(2);
}
let passed = 0, failed = 0;
const failures = [], notes = [];
function check(cond, msg, detail) {
  if (cond) { passed++; return true; }
  failed++; failures.push(msg); console.log('  FAIL: ' + msg + (detail ? `  ${String(detail).slice(0, 600)}` : ''));
  return false;
}

async function openApp(browser) {
  const page = await browser.open(fileUrl(build), { width: 1440, height: 900 });
  await page.unlock();
  await page.waitFor('!!(window.__SPINE_AUTOCAL__ && window.__SPINE_AUTOCAL__.frontalNeuralPasses)', { timeout: 120000 });
  return page;
}

// ---- Part A: stubbed detector ---------------------------------------------
async function partA(browser) {
  const page = await openApp(browser);
  const r = await page.eval(`(async () => {
    const AC = window.__SPINE_AUTOCAL__, out = {};
    const realAi = window.__SPINE_AI__;
    const inputSize = realAi && realAi.inputSize ? realAi.inputSize : { width: 512, height: 1024 };
    if (!realAi) window.__SPINE_AI__ = { inputSize };
    try {
      const deg = Math.PI / 180;
      // spineAxisTilt: straight lines, a symmetric and an asymmetric curve, an outlier.
      const line = (tilt, n = 17) => Array.from({ length: n }, (_, i) => ({ x: 200 + Math.tan(tilt * deg) * i * 30, y: 100 + i * 30 }));
      out.p8 = AC.spineAxisTilt(line(8)).tiltDeg;
      out.m15 = AC.spineAxisTilt(line(-15)).tiltDeg;
      out.cCurve = AC.spineAxisTilt(Array.from({ length: 17 }, (_, i) => ({ x: 200 + 40 * Math.sin(Math.PI * i / 16), y: 100 + i * 30 })));
      out.asym = AC.spineAxisTilt(Array.from({ length: 17 }, (_, i) => ({ x: 200 + 30 * Math.exp(-((((i / 16) - .3) / .15) ** 2)), y: 100 + i * 30 })));
      const withOutlier = line(8); withOutlier[6] = { x: withOutlier[6].x + 200, y: withOutlier[6].y };
      out.outlier = AC.spineAxisTilt(withOutlier).tiltDeg;
      out.tooFew = AC.spineAxisTilt(line(8, 5));
      out.limits = { ...AC.NEURAL_DESKEW };

      // A synthetic analysis frame (260x600) with a 2x isotropic model source.
      const aw = 260, ah = 600, k = 2;
      const src = document.createElement('canvas'); src.width = aw * k; src.height = ah * k;
      const sg = src.getContext('2d'); sg.fillStyle = 'rgb(110,110,110)'; sg.fillRect(0, 0, src.width, src.height);
      for (let y = 0; y < src.height; y += 40) { sg.fillStyle = 'rgb(125,125,125)'; sg.fillRect(0, y, src.width, 12); }
      const small = document.createElement('canvas'); small.width = aw; small.height = ah;
      small.getContext('2d').drawImage(src, 0, 0, aw, ah);
      const raster = { canvas: small, width: aw, height: ah, imageData: small.getContext('2d').getImageData(0, 0, aw, ah) };
      const makeA = source => { const A = AC.buildAnalysis(raster); A.modelSource = { canvas: source, width: source.width, height: source.height, perAnalysisX: source.width / aw, perAnalysisY: source.height / ah }; return A; };

      // Pixel-level round trip: a white block at a known place must come back there.
      const dot = src; const dg = dot.getContext('2d'); dg.fillStyle = '#fff'; dg.fillRect(296, 396, 8, 8);
      const A0 = makeA(dot);
      const inp = AC.neuralDeskewInput(A0, 12);
      const d = inp.modelInput.imageData.data; let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < inp.modelInput.height; y++) for (let x = 0; x < inp.modelInput.width; x++) { const v = d[(y * inp.modelInput.width + x) * 4]; if (v > 200) { sx += (x + .5) * v; sy += (y + .5) * v; n += v; } }
      const centroid = { x: sx / n, y: sy / n }, back = inp.toAnalysis(centroid), fwd = inp.toModel({ x: 150, y: 200 });
      out.roundTrip = { back, fwd, centroid, frame: inp.frame, size: [inp.modelInput.width, inp.modelInput.height] };
      const pts = [{ x: 10, y: 20 }, { x: 250, y: 580 }, { x: 131.7, y: 299.2 }];
      out.ownCorners = [5, -20].map(t => AC.neuralDeskewInput(A0, t).frame.reframed).concat(inp.frame.reframed);
      out.inverseErr = Math.max(...pts.map(p => { const q = inp.toAnalysis(inp.toModel(p)); return Math.hypot(q.x - p.x, q.y - p.y); }));

      // A film scanned askew (content rotated -12 deg inside a black canvas) is
      // re-framed to its own upright field by the deskew.
      const askew = document.createElement('canvas'); askew.width = aw * k; askew.height = ah * k;
      const ag = askew.getContext('2d'); ag.fillStyle = '#000'; ag.fillRect(0, 0, askew.width, askew.height);
      ag.translate(askew.width / 2, askew.height / 2); ag.rotate(-12 * deg);
      const fw = askew.width * .62, fh = askew.height * .8;
      for (let y = -fh / 2; y < fh / 2; y += 20) { ag.fillStyle = (Math.floor(y / 20) % 2) ? 'rgb(150,150,150)' : 'rgb(95,95,95)'; ag.fillRect(-fw / 2, y, fw, 20); }
      const inpAskew = AC.neuralDeskewInput(makeA(askew), 12);
      const ad = inpAskew.modelInput.imageData.data; let black = 0;
      for (let i = 0; i < ad.length; i += 4) if (ad[i] < 20) black++;
      out.askew = { frame: inpAskew.frame, blackFraction: black / (ad.length / 4) };

      // Synthetic spine: 17 vertebrae on a straight axis tilted by 'tilt' deg,
      // endplate tilts running linearly over +-cobb/2 relative to that axis.
      const spine = (tilt, cobb, score, count = 17) => Array.from({ length: count }, (_, i) => {
        const s = (i - (count - 1) / 2) * 30, c = { x: 130 + Math.sin(tilt * deg) * s, y: 300 + Math.cos(tilt * deg) * s };
        const b = (cobb / 2 - cobb * i / (count - 1) - tilt) * deg, cs = Math.cos(b), sn = Math.sin(b);
        const at = (dx, dy) => ({ x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs });
        return { score, center: c, corners: [at(-14, -10), at(14, -10), at(-14, 10), at(14, 10)] };
      });
      const neuralOf = v => ({ vertebrae: v, inputWidth: inputSize.width, inputHeight: inputSize.height, modelVersion: 'stub', backend: 'stub', inferenceMs: 1 });
      const A = makeA(src);
      const runCase = async (tilt, deskewReturns, opts = {}) => {
        const first = neuralOf(spine(tilt, 30, .8));
        const axis = AC.frontalSpineAxis(A, first, null);
        let calls = 0, truth = null;
        const ai = { detectFrontal: async (modelInput, mapping) => {
          calls++;
          const deskewed = AC.neuralDeskewInput(A, axis.tiltDeg);
          if (deskewReturns === 'good') truth = spine(tilt, 33, .9);
          else if (deskewReturns === 'weak') truth = spine(tilt, 33, .7);
          else truth = spine(tilt, 33, .9, 4);
          return neuralOf(truth.map(v => ({ score: v.score, center: deskewed.toModel(v.center), corners: v.corners.map(deskewed.toModel) })));
        } };
        const p = await AC.frontalNeuralPasses(A, first, { ai, scale: '', guides: null, deskew: opts.deskew !== false });
        const res = p.result;
        let cornerErr = null;
        if (res.neural && res.neural.retry === 'deskew') cornerErr = Math.max(...res.lines.flatMap((l, i) => l.corners.map((c, j) => Math.hypot(c.x - truth[i].corners[j].x, c.y - truth[i].corners[j].y))));
        return { calls, axisTilt: axis.tiltDeg, engine: res.engine, cobb: res.values.coronalMagnitude, pass: res.neural && res.neural.pass, retry: res.neural && res.neural.retry || null,
          deskew: res.neural && res.neural.deskew, cornerErr, firstRejection: p.firstRejection, confidence: res.confidence,
          maxRating: Math.max(...Object.values(res.confidences || {}).filter(Number.isFinite)) };
      };
      out.kept = await runCase(10, 'good');
      out.keptNeg = await runCase(-15, 'good');
      out.rejected = await runCase(10, 'bad');
      out.weak = await runCase(10, 'weak');
      out.small = await runCase(2, 'good');
      out.huge = await runCase(30, 'good');
      out.off = await runCase(10, 'good', { deskew: false });
      // The axis falls back to the classical corridor when the first pass has
      // too few confident centres.
      const corridor = { points: Array.from({ length: 30 }, (_, i) => ({ x: 120 + Math.tan(7 * deg) * i * 15, y: 60 + i * 15 })) };
      out.corridorAxis = AC.frontalSpineAxis(A, neuralOf(spine(0, 20, .8, 6)), corridor);
      out.noAxis = AC.frontalSpineAxis(A, neuralOf(spine(0, 20, .8, 6)), null);
    } finally {
      if (!realAi) delete window.__SPINE_AI__;
    }
    return out;
  })()`, { timeout: 120000 });

  const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
  check(near(r.p8, 8, .01) && near(r.m15, -15, .01), 'spineAxisTilt recovers a straight +8 / -15 deg axis', JSON.stringify([r.p8, r.m15]));
  check(r.cCurve && near(r.cCurve.tiltDeg, 0, .01), 'a symmetric C-curve on a vertical axis reads 0 deg (a curve is not film tilt)', JSON.stringify(r.cCurve));
  check(r.asym && Math.abs(r.asym.tiltDeg) < 1 && Math.abs(r.asym.regressionTiltDeg) > Math.abs(r.asym.tiltDeg),
    'an asymmetric single curve biases the regression slope but not the end-to-end chord', JSON.stringify(r.asym));
  check(near(r.outlier, 8, .3), 'one detection far off the spine does not move the axis', r.outlier);
  check(r.tooFew === null, 'fewer than the minimum centres gives no axis (no deskew)', JSON.stringify(r.tooFew));
  check(r.limits.minTiltDeg === 3 && r.limits.maxTiltDeg === 25 && r.limits.minCenters === 8, 'deskew limits are 3-25 deg with >= 8 centres', JSON.stringify(r.limits));
  const rt = r.roundTrip;
  check(rt.size[0] > 0 && near(rt.back.x, 150, 1) && near(rt.back.y, 200, 1), 'a mark in the deskewed model input maps back to its analysis position (within 1 px)', JSON.stringify(rt));
  check(near(rt.fwd.x, rt.centroid.x, 1.5) && near(rt.fwd.y, rt.centroid.y, 1.5), 'the forward map predicts where the canvas drew the mark', JSON.stringify(rt));
  check(r.ownCorners.every(x => x === false), 'the black corners the deskew itself adds never re-frame a full-field film (same scale and aspect as the first pass)', JSON.stringify(r.ownCorners));
  check(r.inverseErr < 1e-6, 'toAnalysis inverts toModel exactly', r.inverseErr);
  check(r.askew.frame.reframed && r.askew.blackFraction < .1, 'a film scanned askew is re-framed to its own upright field after deskew', JSON.stringify(r.askew));

  const k = r.kept;
  check(k.calls === 1 && k.engine === 'neural_ap_corner_v1' && k.retry === 'deskew' && k.pass === 2, 'a tilted first pass triggers one deskewed pass, which is kept when it meets the gates', JSON.stringify(k));
  check(k.deskew && k.deskew.applied && near(k.deskew.appliedDeg, 10, .15) && k.deskew.axisSource === 'neural', 'provenance records the applied rotation and its source', JSON.stringify(k.deskew));
  check(near(k.cobb, 33, .05) && k.cornerErr != null && k.cornerErr < .01, 'deskewed corners land exactly on the original film (Cobb from the deskewed pass)', JSON.stringify({ cobb: k.cobb, cornerErr: k.cornerErr }));
  check(r.keptNeg.retry === 'deskew' && near(r.keptNeg.deskew.appliedDeg, -15, .15) && near(r.keptNeg.cobb, 33, .05) && r.keptNeg.cornerErr < .01, 'a -15 deg tilt is deskewed the other way, exactly', JSON.stringify(r.keptNeg));
  check(r.rejected.calls === 1 && r.rejected.retry === null && near(r.rejected.cobb, 30, .05) && /^rejected/.test(r.rejected.deskew.outcome) && !r.rejected.deskew.applied,
    'a deskewed pass that fails the gates is discarded and the first pass kept, with the outcome recorded', JSON.stringify(r.rejected));
  check(r.rejected.confidence <= .4 && r.rejected.maxRating <= .4 && k.confidence > .4 && r.small.confidence > .4,
    'a tilted pass kept only because its deskewed retry failed has its ratings capped at 0.4 (kept deskewed and untilted passes are not)', JSON.stringify([r.rejected.confidence, r.rejected.maxRating, k.confidence, r.small.confidence]));
  check(r.huge.confidence <= .4, 'a pass beyond the deskew range is capped at 0.4', r.huge.confidence);
  check(r.weak.calls === 1 && r.weak.retry === null && near(r.weak.cobb, 30, .05) && /^not preferred/.test(r.weak.deskew.outcome) && !r.weak.deskew.applied && r.weak.confidence > .4,
    'a deskewed pass the network is less confident in is not preferred over a passing first pass (and the first pass is not capped)', JSON.stringify(r.weak));
  check(r.small.calls === 0 && r.small.deskew && r.small.deskew.outcome === 'not needed' && r.small.deskew.appliedDeg === 0, 'a tilt under 3 deg runs no second pass', JSON.stringify(r.small));
  check(r.huge.calls === 0 && r.huge.deskew && r.huge.deskew.outcome === 'tilt beyond the deskew range', 'a tilt beyond 25 deg is not deskewed (fail closed)', JSON.stringify(r.huge));
  check(r.off.calls === 0 && r.off.deskew === null && near(r.off.cobb, 30, .05), '{deskew:false} reproduces the single-pass behaviour', JSON.stringify(r.off));
  check(r.corridorAxis && r.corridorAxis.source === 'corridor' && near(r.corridorAxis.tiltDeg, 7, .05), 'with too few confident centres the classical corridor gives the axis', JSON.stringify(r.corridorAxis));
  check(r.noAxis === null, 'no axis without enough centres or a corridor', JSON.stringify(r.noAxis));
  check(page.errors.length === 0, 'no page errors in the stubbed deskew checks', page.errors.join(' | '));
  await page.close();
}

// ---- Part B: the real network on a rotated sample film ---------------------
async function partB(browser) {
  const sample = path.join(ROOT, 'samples', '1.jpg');
  if (!fs.existsSync(sample)) { notes.push('samples/1.jpg absent: model-backed deskew checks skipped'); return; }
  const page = await openApp(browser);
  const hasModel = await page.eval(`!!(window.__SPINE_AI__ && window.__SPINE_AI__.detectFrontal && window.__SPINE_AI__.supported && window.__SPINE_AI__.supported())`);
  if (!hasModel) { notes.push('no usable neural model in this build/browser: model-backed deskew checks skipped'); await page.close(); return; }
  const b64 = fs.readFileSync(sample).toString('base64');
  const r = await page.eval(`(async () => {
    const AC = window.__SPINE_AUTOCAL__;
    await window.__SPINE_AI__.ensureLoaded();
    const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const decoded = await createImageBitmap(new Blob([u], { type: 'image/jpeg' }));
    // 1.jpg is a viewer screenshot: take its film strip (non-black columns,
    // above the full-width chrome bar) so the rotation below models a film
    // scanned askew, not a rotated screen (see neuralDeskewInput's known limit).
    const full = document.createElement('canvas'); full.width = decoded.width; full.height = decoded.height;
    const fg = full.getContext('2d', { willReadFrequently: true }); fg.drawImage(decoded, 0, 0);
    const px = fg.getImageData(0, 0, full.width, full.height).data, lum = (x, y) => px[(y * full.width + x) * 4 + 1];
    let yb = full.height - 1;
    const litRow = y => { let n = 0; for (let x = 0; x < full.width; x++) if (lum(x, y) > 30) n++; return n / full.width; };
    while (yb > full.height * .85 && litRow(yb) > .5) yb--;
    const colMean = x => { let t = 0; for (let y = 0; y < yb; y++) t += lum(x, y); return t / yb; };
    let xa = 0, xb = full.width - 1; while (xa < xb && colMean(xa) < 20) xa++; while (xb > xa && colMean(xb) < 20) xb--;
    const strip = document.createElement('canvas'); strip.width = xb - xa + 1; strip.height = yb - 2;
    strip.getContext('2d').drawImage(full, xa, 0, strip.width, strip.height, 0, 0, strip.width, strip.height);
    const stripBlob = await new Promise(res => strip.toBlob(res, 'image/png'));
    const bitmap = strip;
    // Rotate by -12 deg on an expanded black canvas (a film scanned askew).
    const a = -12 * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const cv = document.createElement('canvas'); cv.width = Math.round(bitmap.width * c + bitmap.height * s); cv.height = Math.round(bitmap.height * c + bitmap.width * s);
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    g.translate(cv.width / 2, cv.height / 2); g.rotate(a); g.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const rotBlob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = (blob, name, type) => new File([blob], name, { type });
    const summ = p => ({ engine: p.result.engine || 'classical', cobb: p.result.values.coronalMagnitude, retry: p.result.neural ? p.result.neural.retry || null : null, deskew: p.deskew, note: p.note });
    const upright = summ(await AC.analyzeFrontalFile(file(stripBlob, 'upright.png', 'image/png')));
    upright.strip = [xa, xb, yb];
    const rotOff = summ(await AC.analyzeFrontalFile(file(rotBlob, 'rot.png', 'image/png'), { deskew: false }));
    const rotOn = summ(await AC.analyzeFrontalFile(file(rotBlob, 'rot.png', 'image/png')));
    const dataUrl = cv.toDataURL('image/png');
    return { upright, rotOff, rotOn, dataUrl };
  })()`, { timeout: 600000 });
  const { upright, rotOff, rotOn } = r;
  notes.push(`sample 1.jpg film strip ${JSON.stringify(upright.strip)}: upright Cobb ${upright.cobb} (${upright.engine}, axis ${upright.deskew && upright.deskew.estimatedTiltDeg} deg); rotated -12 deg: ${rotOff.cobb} without deskew, ${rotOn.cobb} with (${rotOn.retry || 'no retry'}, axis ${rotOn.deskew && rotOn.deskew.estimatedTiltDeg} deg)`);
  check(upright.engine === 'neural_ap_corner_v1' && rotOn.engine === 'neural_ap_corner_v1', 'the network result is accepted on the upright and the deskewed rotated sample', JSON.stringify({ upright, rotOn }));
  const expected = (upright.deskew ? upright.deskew.estimatedTiltDeg : 0) + 12;
  check(rotOn.retry === 'deskew' && rotOn.deskew.applied && Math.abs(rotOn.deskew.estimatedTiltDeg - expected) < 3,
    'a film rotated by 12 deg is deskewed by the added rotation (within 3 deg)', JSON.stringify(rotOn.deskew));
  // Cobb is rotation-invariant, so the exact mapping is proven in Part A; on one
  // real film this is only a sanity bound (the network's own spread on a
  // low-confidence film is several degrees).
  check(Number.isFinite(rotOn.cobb) && Math.abs(rotOn.cobb - upright.cobb) <= 10,
    'the deskewed Cobb on the rotated sample stays within 10 deg of the upright reading', JSON.stringify({ upright: upright.cobb, off: rotOff.cobb, on: rotOn.cobb }));
  check(/deskewed by \d+(\.\d)?°/.test(rotOn.note || ''), 'the frontal note names the deskew', rotOn.note);
  if (upright.deskew && upright.deskew.applied) notes.push('the upright sample itself was deskewed (its axis reads over 3 deg)');

  // Through the staging UI: status line, notes and provenance.
  const tmp = path.join(os.tmpdir(), `deskew_rot_${process.pid}.png`);
  fs.writeFileSync(tmp, Buffer.from(r.dataUrl.split(',')[1], 'base64'));
  try {
    await page.eval(`(() => {
      const fire = (el, t) => el && el.dispatchEvent(new Event(t, { bubbles: true }));
      if (!document.getElementById('patientImagingDialog').open) document.getElementById('openPatientImaging').click();
      const r = document.querySelector('input[name="imagingPath"][value="radiographs"]'); if (r) { r.checked = true; fire(r, 'change'); }
      const a = document.getElementById('imagingAuthorization'); if (a && !a.checked) { a.checked = true; fire(a, 'change'); }
      const px = document.getElementById('imagingPixelReview'); if (px && !px.checked) { px.checked = true; fire(px, 'change'); }
      const n = document.getElementById('autoLandmarkNeural'); if (n && !n.checked) { n.checked = true; fire(n, 'change'); }
      document.getElementById('autoLandmarkRunOnStage').checked = true;
      return true; })()`);
    await sleep(200);
    await page.setFiles('#standingPaInput', [tmp]);
    for (let i = 0; i < 120; i += 1) {
      if (!(await page.eval(`typeof imagingChecksPending === 'function' ? imagingChecksPending() : false`))) break;
      await sleep(250);
    }
    await page.eval(`(document.getElementById('stagePatientImaging').click(), true)`);
    const t0 = Date.now();
    await sleep(600);
    while (Date.now() - t0 < 240000) {
      const s = await page.eval(`({ st: document.getElementById('autoLandmarkStatus').dataset.state, running: !!window.__SPINE_AUTOCAL__.resultState.running })`);
      if (s.st !== 'running' && !s.running) break;
      await sleep(300);
    }
    const ui = await page.eval(`(() => { const AC = window.__SPINE_AUTOCAL__, f = AC.resultState.frontal;
      const prov = AC.provenanceRecord({ coronalMagnitude: 'auto-frontal' });
      return { engine: f && f.engine, retry: f && f.neural && f.neural.retry, neuralStatus: (document.getElementById('autoLandmarkNeuralStatus') || {}).textContent || '',
        notes: (AC.ui.statusNotes || {}).textContent || '', provNeural: prov && prov.neural,
        review: AC.buildReviewData ? (() => { try { const d = AC.buildReviewData(); return JSON.stringify(d).match(/"deskewDeg":[^,}]*/)?.[0] || null; } catch (e) { return 'error ' + e.message; } })() : null }; })()`);
    check(ui.retry === 'deskew' && /deskewed by \d+(\.\d)?°/.test(ui.neuralStatus), 'the neural status line says the film was deskewed', JSON.stringify(ui));
    check(/deskewed by \d+(\.\d)?°/.test(ui.notes), 'the run notes say the film was deskewed', ui.notes.slice(0, 400));
    const shot = path.join(os.tmpdir(), `deskew_ui_${process.pid}.png`);
    await page.eval(`(() => { const el = document.getElementById('autoLandmarkStatus'); if (el) el.scrollIntoView({ block: 'center' }); return true; })()`);
    await page.screenshot(shot);
    notes.push(`UI screenshot: ${shot}; provenance neural: ${JSON.stringify(ui.provNeural)}; review record: ${ui.review}`);
  } finally { try { fs.unlinkSync(tmp); } catch (_) { /* gone */ } }
  check(page.errors.length === 0, 'no page errors in the model-backed deskew checks', page.errors.join(' | '));
  await page.close();
}

(async () => {
  const browser = await launch({ headless: !process.argv.includes('--headed') });
  try {
    console.log('Part A: stubbed detector');
    await partA(browser);
    console.log('Part B: real network on a rotated sample film');
    await partB(browser);
  } catch (error) {
    check(false, `harness error: ${error.message}`, error.stack);
  } finally { await browser.close(); }
  notes.forEach(n => console.log('  note: ' + n));
  console.log(`\ndeskew_tests: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
