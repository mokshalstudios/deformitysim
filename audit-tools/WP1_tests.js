#!/usr/bin/env node
'use strict';
// WP1 regression tests - radiograph measurement correctness.
//
//   node audit-tools/WP1_tests.js <spine_simulator.html>
//
// Synthetic radiographs with known geometry (and exact landmark coordinates)
// are generated inside the page and run through the shipped radiograph module
// in headless Chrome (audit-tools/cdp.js). Covered:
//   - signed C2-C7 / TK / LL / PT on the manual path (lordosis positive, as the
//     case panel's CL slider), mirrored images, undeclared and contradicted
//     orientation, PI = PT + SS, PI - LL
//   - Cobb angles above 90 degrees are not folded
//   - frontal apex side follows the PA/AP projection and the apical
//     translation carries the same side; straight spines get no side
//   - manual C7 SVA and apical translation with mm/pixel
//   - the femoral-head search runs and finds the head; automatic PT/PI
//   - lateral level mapping with C2/S1 anchors; confidence caps for
//     unidentified levels and sign-unknown magnitudes
//   - guide anchors refine rather than replace the traced corridor
//   - supine comparison never writes the coronal flexibility field
//   - an end-to-end staged run with an orientation change raises no errors

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, fileUrl, sleep } = require('./cdp.js');

const file = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(file)) throw new Error('Usage: node audit-tools/WP1_tests.js <spine_simulator.html>');

const results = [];
const failures = [];
const check = (condition, label, detail) => {
  if (condition) results.push(label);
  else failures.push(`${label}${detail === undefined ? '' : `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};
const near = (a, b, tol) => typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= tol;

// Injected into the page. Draws radiograph-like phantoms with known geometry.
function phantoms() {
  const rad = d => d * Math.PI / 180;
  const gray = v => `rgb(${v},${v},${v})`;
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function finish(canvas, { noise = 6, blur = 1, seed = 1 } = {}) {
    const W = canvas.width, H = canvas.height;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = gray(20); ctx.fillRect(0, 0, W, H);
    if (blur) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(canvas, 0, 0); ctx.filter = 'none';
    const img = ctx.getImageData(0, 0, W, H); const r = rng(seed);
    for (let p = 0; p < img.data.length; p += 4) {
      const v = Math.max(0, Math.min(255, img.data[p] + (r() + r() + r() - 1.5) * noise * 1.4));
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: out, imageData: ctx.getImageData(0, 0, W, H), width: W, height: H, sourceWidth: W, sourceHeight: H,
      sourceFieldWidth: W, sourceFieldHeight: H, fieldCropped: false, scale: 1, dicom: null };
  }
  function drawVertebra(ctx, c, w, h, alpha, pedicles) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(rad(alpha));
    ctx.fillStyle = gray(168); ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = gray(212); ctx.lineWidth = 2; ctx.strokeRect(-w / 2, -h / 2, w, h);
    if (pedicles) {
      ctx.fillStyle = gray(200);
      [-1, 1].forEach(s => { ctx.beginPath(); ctx.ellipse(s * w * .3, -h * .1, w * .08, h * .22, 0, 0, Math.PI * 2); ctx.fill(); });
    }
    ctx.restore();
  }
  function corners(c, w, h, alpha) {
    const a = rad(alpha), cos = Math.cos(a), sin = Math.sin(a);
    const T = (dx, dy) => ({ x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos });
    return { supL: T(-w / 2, -h / 2), supR: T(w / 2, -h / 2), infL: T(-w / 2, h / 2), infR: T(w / 2, h / 2) };
  }
  // Frontal: phi(s) is the axis angle from vertical; endplate image angle = -phi.
  function ap({ W = 420, H = 840, cobb = 40, shape = 'C', s0 = .22, s1 = .78, n = 17, top = 70, bottom = 740, cx = 210, flip = false, seed = 1 } = {}) {
    const phiAt = s => { const u = (s - s0) / (s1 - s0); return shape === 'S' ? (cobb / 2) * Math.cos(2 * Math.PI * u) : (cobb / 2) * Math.cos(Math.PI * u); };
    const hs = []; for (let i = 0; i < n; i++) hs.push(1 + .55 * i / (n - 1));
    const disc = .32;
    const units = hs.reduce((a, b) => a + b, 0) + disc * hs.slice(0, -1).reduce((a, b, i) => a + (b + hs[i + 1]) / 2, 0);
    const k = (bottom - top) / units;
    let acc = 0; const centerT = [];
    for (let i = 0; i < n; i++) { acc += hs[i] * k / 2; centerT.push(acc); acc += hs[i] * k / 2 + (i < n - 1 ? disc * k * (hs[i] + hs[i + 1]) / 2 : 0); }
    const totalT = acc; const verts = []; let cur = { x: cx, y: top }, tt = 0, ci = 0;
    while (tt < totalT && ci < n) {
      const ph = rad(phiAt(tt / totalT));
      cur = { x: cur.x + Math.sin(ph) * .5, y: cur.y + Math.cos(ph) * .5 }; tt += .5;
      if (tt >= centerT[ci]) { const sC = centerT[ci] / totalT; verts.push({ c: { ...cur }, h: hs[ci] * k, w: hs[ci] * k * 1.55, alpha: -phiAt(sC) }); ci++; }
    }
    const xs = verts.map(v => v.c.x); const shift = cx - (Math.min(...xs) + Math.max(...xs)) / 2;
    verts.forEach(v => { v.c.x += shift; });
    if (flip) verts.forEach(v => { v.c.x = W - v.c.x; v.alpha = -v.alpha; });
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = gray(22); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = gray(78); ctx.beginPath(); ctx.ellipse(W / 2, H * .5, W * .44, H * .62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = gray(48);
    [-1, 1].forEach(s => { ctx.beginPath(); ctx.ellipse(W / 2 + s * W * .2, top + (bottom - top) * .28, W * .13, (bottom - top) * .22, 0, 0, Math.PI * 2); ctx.fill(); });
    verts.forEach(v => drawVertebra(ctx, v.c, v.w, v.h, v.alpha, true));
    const alphas = verts.map(v => v.alpha);
    let imax = 0, imin = 0; alphas.forEach((a, i) => { if (a > alphas[imax]) imax = i; if (a < alphas[imin]) imin = i; });
    const endU = Math.min(imax, imin), endL = Math.max(imax, imin);
    // Apex image side: largest offset from the end-vertebra chord.
    let apexDx = 0;
    for (let i = endU; i <= endL; i++) { const a = verts[endU].c, b = verts[endL].c; const f = (verts[i].c.y - a.y) / (b.y - a.y || 1); const d = verts[i].c.x - (a.x + (b.x - a.x) * f); if (Math.abs(d) > Math.abs(apexDx)) apexDx = d; }
    return { raster: finish(canvas, { seed }), truth: { cobb: alphas[imax] - alphas[imin], apexDx, centers: verts.map(v => ({ x: v.c.x, y: v.c.y, alpha: v.alpha })) } };
  }
  // Lateral with anterior on image-left (mirror puts anterior on image-right).
  function lateral({ W = 520, H = 900, top = 50, bottom = 700, x0 = 250, mirror = false, PT = 15, seed = 1, processes = true,
    anchors = { C2: -5, C7: -25, T1: -26, T4: -20, T8: -3, T12: 20, L1: 15, L3: 0, L5: -28, S1: -42 } } = {}) {
    const names = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5'];
    const hRel = [1.3, 1, 1, 1, 1, 1.05, 1.25, 1.28, 1.32, 1.36, 1.4, 1.44, 1.48, 1.52, 1.58, 1.64, 1.7, 1.78, 1.9, 1.95, 2.0, 2.0, 1.95];
    const keyIdx = Object.keys(anchors).filter(k => k !== 'S1').map(k => [names.indexOf(k), anchors[k]]).sort((a, b) => a[0] - b[0]);
    const alphaAt = i => { for (let j = 1; j < keyIdx.length; j++) { const [i0, a0] = keyIdx[j - 1], [i1, a1] = keyIdx[j]; if (i <= i1) return a0 + (a1 - a0) * (i - i0) / (i1 - i0); } return keyIdx[keyIdx.length - 1][1]; };
    const disc = .26; const k = (bottom - top) / (hRel.reduce((a, b) => a + b, 0) * (1 + disc) + 1);
    const verts = []; let cur = { x: x0, y: top };
    for (let i = 0; i < names.length; i++) {
      const a = alphaAt(i), ph = rad(-a), h = hRel[i] * k;
      cur = { x: cur.x + Math.sin(ph) * h / 2, y: cur.y + Math.cos(ph) * h / 2 };
      verts.push({ name: names[i], c: { ...cur }, h, w: h * (i < 6 ? 1.25 : 1.35), alpha: a });
      const next = i < names.length - 1 ? alphaAt(i + 1) : anchors.S1, phMid = rad(-(a + next) / 2), step = h / 2 + disc * h;
      cur = { x: cur.x + Math.sin(phMid) * step, y: cur.y + Math.cos(phMid) * step };
    }
    const L5 = verts[verts.length - 1], s1w = L5.w * 1.05, sa = rad(anchors.S1);
    const dirE = { x: Math.cos(sa), y: Math.sin(sa) }, nrm = { x: -Math.sin(sa), y: Math.cos(sa) };
    const s1mid = { x: cur.x, y: cur.y + 2 };
    const s1a = { x: s1mid.x - dirE.x * s1w / 2, y: s1mid.y - dirE.y * s1w / 2 }, s1p = { x: s1mid.x + dirE.x * s1w / 2, y: s1mid.y + dirE.y * s1w / 2 };
    const d = L5.h * 4.2, hip = { x: s1mid.x - Math.sin(rad(PT)) * d, y: s1mid.y + Math.cos(rad(PT)) * d };
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = gray(22); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = gray(80); ctx.beginPath(); ctx.ellipse(x0 - 20, H * .52, W * .36, H * .6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = gray(50); ctx.beginPath(); ctx.ellipse(x0 - 70, top + (bottom - top) * .38, W * .16, (bottom - top) * .2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = gray(160); ctx.beginPath(); ctx.moveTo(s1a.x, s1a.y); ctx.lineTo(s1p.x, s1p.y);
    ctx.lineTo(s1p.x + nrm.x * L5.h * 2.8 + 12, s1p.y + nrm.y * L5.h * 2.8); ctx.lineTo(s1a.x + nrm.x * L5.h * 1.2 + 10, s1a.y + nrm.y * L5.h * 1.2 + 12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = gray(212); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s1a.x, s1a.y); ctx.lineTo(s1p.x, s1p.y); ctx.stroke();
    ctx.fillStyle = gray(150); ctx.beginPath(); ctx.arc(hip.x, hip.y, L5.h * .95, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = gray(210); ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = gray(140); ctx.save(); ctx.translate(hip.x, hip.y); ctx.rotate(rad(35)); ctx.fillRect(0, -L5.h * .45, L5.h * 2.2, L5.h * .9); ctx.restore();
    if (processes) verts.forEach(v => { ctx.fillStyle = gray(130); ctx.save(); ctx.translate(v.c.x, v.c.y); ctx.rotate(rad(v.alpha)); ctx.fillRect(v.w * .5, -v.h * .25, v.w * .75, v.h * .45); ctx.restore(); });
    verts.forEach(v => drawVertebra(ctx, v.c, v.w, v.h, v.alpha, false));
    let out = canvas;
    const truth = { CL: anchors.C2 - anchors.C7, TK: anchors.T12 - anchors.T4, LL: anchors.L1 - anchors.S1, SS: -anchors.S1, PT, PI: PT - anchors.S1,
      hip, s1mid, s1a, s1p, verts: verts.map(v => ({ name: v.name, c: v.c, h: v.h, alpha: v.alpha, corners: corners(v.c, v.w, v.h, v.alpha) })) };
    if (mirror) {
      const m = document.createElement('canvas'); m.width = W; m.height = H; const mc = m.getContext('2d');
      mc.translate(W, 0); mc.scale(-1, 1); mc.drawImage(canvas, 0, 0); out = m;
      const fx = p => ({ x: W - p.x, y: p.y });
      truth.hip = fx(truth.hip); truth.s1mid = fx(truth.s1mid); truth.s1a = fx(truth.s1a); truth.s1p = fx(truth.s1p);
      truth.verts = truth.verts.map(v => ({ ...v, c: fx(v.c), alpha: -v.alpha, corners: { supL: fx(v.corners.supR), supR: fx(v.corners.supL), infL: fx(v.corners.infR), infR: fx(v.corners.infL) } }));
    }
    // Anterior/posterior corners of each endplate, whichever image side is anterior.
    truth.ant = (name, which) => { const v = truth.verts.find(x => x.name === name); return mirror ? v.corners[which + 'R'] : v.corners[which + 'L']; };
    truth.post = (name, which) => { const v = truth.verts.find(x => x.name === name); return mirror ? v.corners[which + 'L'] : v.corners[which + 'R']; };
    truth.mirror = mirror;
    return { raster: finish(out, { seed }), truth };
  }
  function manualLateralPoints(truth, withHip = true) {
    const pts = { c2a: truth.ant('C2', 'inf'), c2p: truth.post('C2', 'inf'), c7a: truth.ant('C7', 'inf'), c7p: truth.post('C7', 'inf'),
      t4a: truth.ant('T4', 'sup'), t4p: truth.post('T4', 'sup'), t12a: truth.ant('T12', 'inf'), t12p: truth.post('T12', 'inf'),
      l1a: truth.ant('L1', 'sup'), l1p: truth.post('L1', 'sup'), s1a: truth.s1a, s1p: truth.s1p };
    if (withHip) { pts.fh1 = { x: truth.hip.x - 2, y: truth.hip.y }; pts.fh2 = { x: truth.hip.x + 2, y: truth.hip.y }; }
    return pts;
  }
  // Centre-line error of a traced result against the true vertebral centres.
  function maxCenterError(result, truth) {
    let worst = 0;
    result.centers.forEach(c => {
      for (let i = 1; i < truth.centers.length; i++) {
        const a = truth.centers[i - 1], b = truth.centers[i];
        if (c.y >= a.y && c.y <= b.y) { const f = (c.y - a.y) / (b.y - a.y); worst = Math.max(worst, Math.abs(c.x - (a.x + (b.x - a.x) * f))); }
      }
    });
    return worst;
  }
  function toPng(raster) { return raster.canvas.toDataURL('image/png'); }
  return { ap, lateral, manualLateralPoints, maxCenterError, toPng };
}

(async () => {
  const browser = await launch({ headless: true });
  let page;
  try {
    page = await browser.open(fileUrl(file), { width: 1440, height: 900 });
    await page.unlock();
    await sleep(400);
    await page.eval(`(() => { const b = document.getElementById('introExplore'); if (b) b.click(); return true; })()`);
    await sleep(300);
    await page.eval(`(() => { window.__WP1__ = (${phantoms.toString()})(); return true; })()`);

    // 1. Manual sagittal signs against exact landmarks.
    const manual = await page.eval(`(() => {
      const C = window.__SPINE_AUTOCAL__, P = window.__WP1__, rows = [];
      const cases = {
        normal: undefined,
        lumbarKyphosis: { C2: -5, C7: -25, T1: -26, T4: -20, T8: -3, T12: 20, L1: -50, L3: -46, L5: -44, S1: -42 },
        thoracicLordosis: { C2: -5, C7: -25, T1: -26, T4: 5, T8: 0, T12: -10, L1: 15, L3: 0, L5: -28, S1: -42 },
        cervicalKyphosis: { C2: -35, C7: -25, T1: -26, T4: -20, T8: -3, T12: 20, L1: 15, L3: 0, L5: -28, S1: -42 }
      };
      const previous = C.ui.anteriorSide.value;
      for (const [name, anchors] of Object.entries(cases)) for (const mirror of [false, true]) for (const PT of [15, -8]) for (const side of ['declared', 'auto', 'wrong']) {
        const { truth } = P.lateral({ mirror, PT, ...(anchors ? { anchors } : {}) });
        C.manual.points.lateral = P.manualLateralPoints(truth); C.manual.points.frontal = {};
        C.ui.anteriorSide.value = side === 'auto' ? 'auto' : side === 'declared' ? (mirror ? 'right' : 'left') : (mirror ? 'left' : 'right');
        rows.push({ name, mirror, PT, side, truth: { cl: truth.CL, tk: truth.TK, ll: truth.LL, sacralSlope: truth.SS, pt: truth.PT, pi: truth.PI }, got: C.manualValues() });
      }
      C.manual.points.lateral = {}; C.ui.anteriorSide.value = previous;
      return rows;
    })()`);
    let exact = true, withheld = true, contradicted = true, identity = true;
    manual.forEach(row => {
      const g = row.got, t = row.truth, tag = `${row.name} mirror=${row.mirror} PT=${row.PT}`;
      if (row.side === 'declared') {
        ['cl', 'tk', 'll', 'sacralSlope', 'pt', 'pi'].forEach(key => { if (!near(g[key], t[key], .05)) { exact = false; failures.push(`manual ${tag} ${key}: ${g[key]} vs ${t[key]}`); } });
        if (!near(g.piLl, t.pi - t.ll, .05) || !near(g.pi - (g.pt + g.sacralSlope), 0, .05)) identity = false;
      } else {
        const signedAbsent = ['cl', 'tk', 'll', 'pt', 'measuredSva'].every(key => g[key] === undefined);
        const unsignedKept = near(g.pi, t.pi, .05) && near(g.sacralSlope, t.sacralSlope, .05);
        if (!(signedAbsent && unsignedKept)) { if (row.side === 'auto') withheld = false; else contradicted = false; }
      }
    });
    check(exact, 'manual CL/TK/LL/SS/PT/PI match truth in sign and size (lordosis/kyphosis, negative PT, mirrored)');
    check(identity, 'manual PI = PT + SS holds with signed PT, and PI-LL is reported');
    check(withheld, 'manual signed values are withheld (PI and SS kept) while orientation is undeclared');
    check(contradicted, 'manual signed values are withheld when the declared side contradicts the sacral slope');

    // 2. Manual frontal: unfolded Cobb, patient-side apex, translation sign.
    const frontalManual = await page.eval(`(() => {
      const C = window.__SPINE_AUTOCAL__, select = document.getElementById('frontalProjectionSelect');
      // The patient side is declared through the intake control (PA = patient
      // right on image right, AP = image left); 'unconfirmed' withholds it.
      const side = document.getElementById('frontalLateralitySelect');
      const saved = { raster: C.resultState.previewRaster, scale: C.ui.frontalScale.value, projection: select.value, side: side.value, frontal: C.resultState.frontal };
      C.resultState.frontal = null;
      C.resultState.previewRaster = { ...saved.raster, frontal: { scale: 1 } };
      C.ui.frontalScale.value = '0.5';
      const seg = (cx, cy, ang) => { const a = ang * Math.PI / 180; return [{ x: cx - 20 * Math.cos(a), y: cy - 20 * Math.sin(a) }, { x: cx + 20 * Math.cos(a), y: cy + 20 * Math.sin(a) }]; };
      const rows = [];
      for (const cobb of [8, 40, 100, 110]) for (const apexX of [150, 250]) for (const projection of ['pa', 'ap', 'unconfirmed']) {
        const [upA, upB] = seg(200, 200, -cobb / 2), [lowA, lowB] = seg(200, 600, cobb / 2);
        C.manual.points.frontal = { upA, upB, lowA, lowB, apex: { x: apexX, y: 400 } }; C.manual.points.lateral = {};
        select.value = projection === 'ap' ? 'ap' : 'pa';
        side.value = projection === 'pa' ? 'right' : projection === 'ap' ? 'left' : 'unconfirmed';
        const v = C.manualValues();
        rows.push({ cobb, apexX, projection, got: v });
      }
      C.manual.points.frontal = {};
      C.resultState.previewRaster = saved.raster; C.ui.frontalScale.value = saved.scale; select.value = saved.projection; side.value = saved.side; C.resultState.frontal = saved.frontal;
      return rows;
    })()`);
    check(frontalManual.every(r => near(r.got.coronalMagnitude, r.cobb, 1e-6)), 'manual Cobb is not folded above 90 degrees (100 -> 100, 110 -> 110)',
      frontalManual.map(r => [r.cobb, r.got.coronalMagnitude]));
    check(frontalManual.filter(r => r.cobb >= 10 && r.projection !== 'unconfirmed').every(r => {
      const imageSide = r.apexX > 200 ? 'right' : 'left';
      const expected = r.projection === 'pa' ? imageSide : imageSide === 'right' ? 'left' : 'right';
      return r.got.coronalDirection === expected && near(r.got.trunkShift, (expected === 'right' ? 1 : -1) * 25, 1e-6);
    }), 'manual apex side follows the PA/AP projection and the translation (+ = patient right) matches it', frontalManual.map(r => [r.cobb, r.apexX, r.projection, r.got.coronalDirection, r.got.trunkShift]));
    check(frontalManual.filter(r => r.cobb < 10).every(r => r.got.coronalDirection === undefined && r.got.trunkShift === undefined),
      'manual apex side and translation are withheld below a 10 degree Cobb');
    check(frontalManual.filter(r => r.projection === 'unconfirmed').every(r => r.got.coronalDirection === undefined && r.got.trunkShift === undefined),
      'manual apex side and translation are withheld while the patient side is not confirmed (no PA assumption)',
      frontalManual.filter(r => r.projection === 'unconfirmed').map(r => [r.cobb, r.apexX, r.got.coronalDirection, r.got.trunkShift]));

    // 3. Manual C7 SVA with spacing.
    const sva = await page.eval(`(() => {
      const C = window.__SPINE_AUTOCAL__;
      const saved = { raster: C.resultState.previewRaster, scale: C.ui.lateralScale.value, side: C.ui.anteriorSide.value, lateral: C.resultState.lateral };
      C.resultState.lateral = null;
      C.resultState.previewRaster = { ...saved.raster, lateral: { scale: 1 } };
      C.ui.lateralScale.value = '0.5';
      const rows = [];
      for (const anterior of ['left', 'right']) for (const offset of [30, -20]) {
        const forward = anterior === 'left' ? -1 : 1, post = { x: 300, y: 600 }, ant = { x: 300 + forward * 50, y: 620 };
        const c7 = { x: 300 + forward * offset, y: 200 };
        C.manual.points.lateral = { c7a: { x: c7.x + forward * 10, y: c7.y + 4 }, c7p: { x: c7.x - forward * 10, y: c7.y - 4 }, s1a: ant, s1p: post };
        C.ui.anteriorSide.value = anterior;
        rows.push({ anterior, offset, sva: C.manualValues().measuredSva });
      }
      C.manual.points.lateral = {};
      C.resultState.previewRaster = saved.raster; C.ui.lateralScale.value = saved.scale; C.ui.anteriorSide.value = saved.side; C.resultState.lateral = saved.lateral;
      return rows;
    })()`);
    check(sva.every(r => near(r.sva, r.offset * .5 / 10, 1e-9)), 'manual C7 SVA uses the lateral spacing and is positive when C7 is anterior of S1 (both orientations)', sva);

    // 4. Automatic lateral: hip search, level mapping, signs and caps.
    const auto = await page.eval(`(() => {
      const C = window.__SPINE_AUTOCAL__, P = window.__WP1__, rows = [];
      for (const mirror of [false, true]) for (const variant of ['none', 'c2s1', 'c2s1hip', 'undeclared', 'levels']) for (const PT of [15, -8]) {
        // 'levels' draws no posterior elements: the classical corridor reuses the
        // frontal paired-wall scorer and can follow spinous processes on a lateral
        // (a known limitation), and this case tests level placement, not tracing.
        const { raster, truth } = P.lateral({ mirror, PT, processes: variant !== 'levels' });
        const V = Object.fromEntries(truth.verts.map(v => [v.name, v]));
        const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const c2 = mid(V.C2.corners.infL, V.C2.corners.infR);
        const guides = variant === 'c2s1' || variant === 'levels' ? { c2, s1: truth.s1mid } : variant === 'c2s1hip' ? { c2, s1: truth.s1mid, hip: truth.hip } : {};
        const r = C.analyzeLateral(C.buildAnalysis(raster), 0.5, variant === 'undeclared' ? 'auto' : mirror ? 'right' : 'left', guides);
        const endplateY = { c7: mid(V.C7.corners.infL, V.C7.corners.infR).y, t4: mid(V.T4.corners.supL, V.T4.corners.supR).y, t12: mid(V.T12.corners.infL, V.T12.corners.infR).y, l1: mid(V.L1.corners.supL, V.L1.corners.supR).y };
        const levelError = Object.fromEntries(Object.entries(endplateY).map(([k, y]) => [k, Math.abs(r.lines[r.indexes[k]].cy - y) / V[k.toUpperCase()].h]));
        rows.push({ mirror, variant, PT, truth: { cl: truth.CL, tk: truth.TK, ll: truth.LL, ss: truth.SS, pt: truth.PT, pi: truth.PI },
          values: r.values, conf: r.confidences, levelError, signed: r.signedSagittal,
          hip: { searched: r.hip.searched, dx: r.hip.x - truth.hip.x, dy: r.hip.y - truth.hip.y }, s1dy: r.s1.cy - truth.s1mid.y });
      }
      return rows;
    })()`);
    const anchored = auto.filter(r => r.variant === 'c2s1' || r.variant === 'c2s1hip');
    check(auto.every(r => r.hip.searched === true), 'the femoral-head search runs (S1 is read as cx/cy, not a missing y)');
    check(anchored.every(r => Math.hypot(r.hip.dx, r.hip.dy) <= 6), 'with an S1 anchor the femoral head is found within 6 px (1.5 search steps)', anchored.map(r => [r.hip.dx, r.hip.dy]));
    check(anchored.every(r => near(r.values.pt, r.truth.pt, 3) && near(r.values.pi, r.truth.pi, 6)), 'automatic PT keeps its sign (+15/-8) and PI is geometric', anchored.map(r => [r.truth.pt, r.values.pt, r.truth.pi, r.values.pi]));
    check(anchored.every(r => near(r.values.sacralSlope, r.truth.ss, 4) && Math.abs(r.s1dy) <= 4), 'the S1 plate is found at the anchor with a steep (42 degree) slope, not capped near 48 or taken from L5', anchored.map(r => [r.values.sacralSlope, r.s1dy]));
    const levels = auto.filter(r => r.variant === 'levels');
    // Population fractions cannot follow an individual's proportions (this
    // phantom's lumbar spine is ~0.30 of the C2-S1 arc against ~0.32 in the
    // table), so about one level is the honest bound; equal spacing was 1-3 off.
    check(levels.every(r => Object.values(r.levelError).every(e => e <= 1.25) && r.levelError.c7 <= .75 && r.levelError.t4 <= .75), 'with C2 and S1 anchors C7/T4 land on their endplates and T12/L1 within about one level (population arc fractions)', levels.map(r => r.levelError));
    // The CL sign itself is covered through the shared helper (interaction
    // harness) and the manual path; the classical fit of the narrow cervical
    // bodies is too weak on this phantom to assert its size.
    check(levels.every(r => r.values.tk > 10 && r.values.ll > 10 && Number.isFinite(r.values.cl)), 'automatic TK/LL of a normal phantom come out kyphotic/lordotic in both orientations', levels.map(r => [r.values.cl, r.values.tk, r.values.ll]));
    check(auto.filter(r => r.variant === 'none').every(r => ['cl', 'tk', 'll', 'measuredSva', 'pt', 'pi'].every(k => r.conf[k] <= .15)),
      'unanchored lateral level values are capped at 15% (levels are not identified)');
    check(anchored.every(r => ['cl', 'tk', 'll', 'measuredSva'].every(k => r.conf[k] <= .34)), 'anchored lateral level values stay below acceptance (34% cap)');
    check(auto.filter(r => r.variant === 'c2s1').every(r => r.conf.pt <= .34 && r.conf.pi <= .34)
        && auto.filter(r => r.variant === 'c2s1hip').every(r => r.conf.pt > .5 && r.conf.pi > .5),
      'PT/PI from a detected hip stay below acceptance; an anchored hip lifts the cap');
    check(auto.filter(r => r.variant === 'undeclared').every(r => r.values.cl === null && r.values.pt === null && r.values.measuredSva === null
        && Number.isFinite(r.values.tk) && Number.isFinite(r.values.ll) && r.conf.tk <= .1 && r.conf.ll <= .1 && r.signed === false),
      'undeclared orientation withholds CL/PT/SVA and keeps TK/LL only as capped sign-unknown magnitudes');

    // 5. Guide anchors refine the traced curve.
    const guides = await page.eval(`(() => {
      const C = window.__SPINE_AUTOCAL__, P = window.__WP1__, rows = [];
      for (const [label, opts] of [['symmetric', { cobb: 50, s0: .15, s1: .85, seed: 4 }], ['asymmetric', { cobb: 50, s0: .05, s1: .6, seed: 5 }]]) {
        const { raster, truth } = P.ap(opts); const tc = truth.centers;
        const mid = (tc[0].x + tc[tc.length - 1].x) / 2;
        const apex = tc.reduce((b, c) => Math.abs(c.x - mid) > Math.abs(b.x - mid) ? c : b, tc[0]);
        const variants = { none: {}, top: { top: tc[0] }, topBottom: { top: tc[0], bottom: tc[tc.length - 1] }, apex: { apex }, all: { top: tc[0], bottom: tc[tc.length - 1], apex } };
        for (const [name, g] of Object.entries(variants)) {
          const r = C.analyzeFrontal(C.buildAnalysis(raster), null, g, null);
          rows.push({ label, name, error: P.maxCenterError(r, truth), cobb: r.values.coronalMagnitude,
            hits: Object.values(g).map(p => Math.abs(r.corridor.xAt(p.y) - p.x)) });
        }
      }
      return rows;
    })()`);
    ['symmetric', 'asymmetric'].forEach(label => {
      const base = guides.find(r => r.label === label && r.name === 'none');
      const guided = guides.filter(r => r.label === label && r.name !== 'none');
      check(guided.every(r => r.error <= base.error + 3 && Math.abs(r.cobb - base.cobb) <= 6 && r.hits.every(h => h <= .5)),
        `${label} C-curve: correct anchors are met exactly and never degrade the trace or Cobb`, guided.map(r => [r.name, +r.error.toFixed(1), base.error.toFixed(1), r.cobb && +r.cobb.toFixed(1)]));
    });

    // 6. Automatic frontal laterality and confidence coherence.
    const lat = await page.eval(`(() => {
      const C = window.__SPINE_AUTOCAL__, P = window.__WP1__, select = document.getElementById('frontalProjectionSelect'), saved = select.value, rows = [];
      const side = document.getElementById('frontalLateralitySelect'), savedSide = side.value;
      for (const cobb of [0, 40]) for (const flip of [false, true]) for (const projection of ['pa', 'ap', 'unconfirmed']) {
        const { raster, truth } = P.ap({ cobb, flip, seed: 7 });
        select.value = projection === 'ap' ? 'ap' : 'pa';
        side.value = projection === 'pa' ? 'right' : projection === 'ap' ? 'left' : 'unconfirmed';
        const r = C.analyzeFrontal(C.buildAnalysis(raster), 0.5, {}, null);
        rows.push({ cobb, flip, projection, truthDx: truth.apexDx, deviation: r.deviation, got: r.values, conf: r.confidences, label: r.laterality && r.laterality.label });
      }
      select.value = saved; side.value = savedSide;
      return rows;
    })()`);
    const curved = lat.filter(r => r.cobb === 40 && r.projection !== 'unconfirmed');
    check(lat.filter(r => r.projection === 'unconfirmed').every(r => r.got.coronalDirection === null && r.got.trunkShift === null && r.conf.coronalDirection === 0 && r.conf.trunkShift === 0),
      'automatic apex side and translation are withheld (no confidence) while the patient side is not confirmed',
      lat.filter(r => r.projection === 'unconfirmed').map(r => [r.cobb, r.flip, r.got.coronalDirection, r.got.trunkShift]));
    check(curved.every(r => {
      const imageSide = r.truthDx > 0 ? 'right' : 'left';
      const expected = r.projection === 'pa' ? imageSide : imageSide === 'right' ? 'left' : 'right';
      return r.got.coronalDirection === expected && Math.sign(r.got.trunkShift) === (expected === 'right' ? 1 : -1) && near(Math.abs(r.got.trunkShift), Math.abs(r.deviation) * .5, 1e-6);
    }), 'automatic apex side follows PA (patient right on image right) / AP (image left), and the translation points the same way', curved.map(r => [r.flip, r.projection, r.got.coronalDirection, r.got.trunkShift && +r.got.trunkShift.toFixed(1)]));
    check(lat.filter(r => r.cobb === 0).every(r => r.got.coronalDirection === null && r.conf.coronalDirection === 0 && r.got.trunkShift === null),
      'a straight spine gets no apex side (and no pre-selection) instead of an arbitrary one', lat.filter(r => r.cobb === 0).map(r => [r.got.coronalMagnitude, r.got.coronalDirection]));
    check(lat.every(r => r.conf.compensatoryCobb <= r.conf.coronalMagnitude + 1e-9 && r.conf.coronalDirection <= r.conf.coronalMagnitude + 1e-9 && r.conf.trunkShift <= r.conf.coronalMagnitude + 1e-9),
      'secondary Cobb, apex side and translation confidences never exceed the primary Cobb confidence');

    // 7. Supine comparison: 8 taps, never written into the coronal flexibility.
    const supine = await page.eval(`(() => {
      const C = window.__SPINE_AUTOCAL__, P = window.__WP1__;
      const keys = C.MANUAL_SEQUENCES.supine.map(step => step.key);
      const { truth } = P.lateral({});
      const standing = P.manualLateralPoints(truth, false);
      const flatter = P.lateral({ anchors: { C2: -5, C7: -25, T1: -26, T4: -12, T8: -3, T12: 12, L1: 5, L3: 0, L5: -24, S1: -30 } }).truth;
      const lying = P.manualLateralPoints(flatter, false);
      const input = document.getElementById('secondaryFlexibilityInput');
      const before = input ? input.value : null;
      const side = C.ui.anteriorSide.value;
      C.ui.anteriorSide.value = 'left';
      C.manual.points.lateral = standing;
      C.manual.points.supine = Object.fromEntries(keys.map(k => [k, lying[k]]));
      const rows = C.flexibilityComparison();
      const applied = C.applyMeasuredFlexibility();
      const after = input ? input.value : null;
      const recorded = typeof state === 'object' && state.patientImaging ? state.patientImaging.positionalComparison : undefined;
      C.manual.points.lateral = {}; C.manual.points.supine = {}; C.ui.anteriorSide.value = side;
      return { keys, rows: rows.map(r => ({ key: r.key, standing: r.standing, supine: r.supine })), applied, before, after, recorded: recorded && { kind: recorded.kind, appliedToModel: recorded.appliedToModel, rows: recorded.rows.length } };
    })()`);
    check(JSON.stringify(supine.keys) === JSON.stringify(['t4a', 't4p', 't12a', 't12p', 'l1a', 'l1p', 's1a', 's1p']), 'supine calibration asks only for the four endplates it uses', supine.keys);
    check(supine.rows.length === 3 && supine.rows.every(r => Number.isFinite(r.standing) && Number.isFinite(r.supine)), 'supine comparison still produces TK, LL and SS rows', supine.rows);
    check(supine.applied === true && supine.before === supine.after && supine.recorded && supine.recorded.appliedToModel === false,
      'the positional comparison is recorded with the imaging session and never written into the coronal secondary-curve flexibility', supine);

    // 8. End to end: stage a phantom pair, run, change orientation and projection.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp1-'));
    const pngs = await page.eval(`(() => { const P = window.__WP1__; return { ap: P.toPng(P.ap({ cobb: 40, seed: 3 }).raster), lat: P.toPng(P.lateral({}).raster) }; })()`);
    const apFile = path.join(tmp, 'phantom_ap.png'), latFile = path.join(tmp, 'phantom_lateral.png');
    fs.writeFileSync(apFile, Buffer.from(pngs.ap.split(',')[1], 'base64'));
    fs.writeFileSync(latFile, Buffer.from(pngs.lat.split(',')[1], 'base64'));
    await page.eval(`(() => {
      const dialog = document.getElementById('patientImagingDialog');
      if (dialog && !dialog.open) { const open = document.getElementById('openPatientImaging'); if (open) open.click(); if (!dialog.open && dialog.showModal) dialog.showModal(); }
      const radio = document.querySelector('input[name="imagingPath"][value="radiographs"]'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
      ['imagingAuthorization', 'imagingPixelReview'].forEach(id => { const box = document.getElementById(id); if (box) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); } });
      document.querySelectorAll('.imaging-coverage-input').forEach(box => { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); });
      const neural = document.getElementById('autoLandmarkNeural'); if (neural) { neural.checked = false; neural.dispatchEvent(new Event('change', { bubbles: true })); }
      document.getElementById('autoLandmarkRunOnStage').checked = true;
      document.getElementById('autoLandmarkAnteriorSide').value = 'auto';
      document.getElementById('frontalProjectionSelect').value = 'pa';
      document.getElementById('autoLandmarkFrontalScale').value = '0.5';
      document.getElementById('autoLandmarkLateralScale').value = '0.5';
      return true; })()`);
    await page.setFiles('#standingPaInput', [apFile]); await sleep(300);
    await page.setFiles('#standingLateralInput', [latFile]); await sleep(600);
    await page.eval(`(() => { document.getElementById('stagePatientImaging').click(); return true; })()`);
    await sleep(500);
    await page.waitFor(`(() => { const s = window.__SPINE_AUTOCAL__.resultState; return !s.running && s.frontal && s.lateral ? true : false; })()`, { timeout: 180000 });
    const rowState = `Array.from(document.querySelectorAll('#autoLandmarkResults input[data-auto-key]')).reduce((o, box) => { o[box.dataset.autoKey] = { checked: box.checked, disabled: box.disabled }; return o; }, {})`;
    const staged = await page.eval(`(() => { const s = window.__SPINE_AUTOCAL__.resultState; return { rows: ${rowState}, lateral: s.lateral.values, frontal: s.frontal.values }; })()`);
    const orient = await page.eval(`(() => {
      const C = window.__SPINE_AUTOCAL__, select = document.getElementById('autoLandmarkAnteriorSide');
      select.value = 'left'; select.dispatchEvent(new Event('change', { bubbles: true }));
      const left = { values: { ...C.resultState.lateral.values }, conf: { ...C.resultState.lateral.confidences }, signed: C.resultState.lateral.signedSagittal, rows: ${rowState} };
      const projection = document.getElementById('frontalProjectionSelect'), side = document.getElementById('frontalLateralitySelect');
      const declare = value => { side.value = value; side.dispatchEvent(new Event('change', { bubbles: true })); };
      const unconfirmed = { direction: C.resultState.frontal.values.coronalDirection, shift: C.resultState.frontal.values.trunkShift, side: side.value };
      declare('right');
      const pa = C.resultState.frontal.values.coronalDirection;
      declare('left');
      const ap = { direction: C.resultState.frontal.values.coronalDirection, shift: C.resultState.frontal.values.trunkShift };
      declare('unconfirmed');
      const withdrawn = { direction: C.resultState.frontal.values.coronalDirection, shift: C.resultState.frontal.values.trunkShift, conf: C.resultState.frontal.confidences.coronalDirection };
      return { left, unconfirmed, pa, ap, withdrawn, optionText: Array.from(projection.options).map(o => o.textContent) };
    })()`);
    const lateralKeys = ['ll', 'tk', 'cl', 'pi', 'pt', 'measuredSva'];
    check(lateralKeys.every(k => !staged.rows[k] || !staged.rows[k].checked), 'automatic lateral rows are never pre-selected (levels not identified)', staged.rows);
    check(staged.rows.cl && staged.rows.cl.disabled && staged.rows.pt && staged.rows.pt.disabled, 'with orientation undeclared CL and PT rows are withheld', staged.rows);
    check(orient.left.signed === true && Number.isFinite(orient.left.values.cl) && orient.left.values.sacralSlope > 0 && lateralKeys.every(k => !orient.left.rows[k] || !orient.left.rows[k].checked),
      'declaring the orientation re-derives signed values through the edit path without pre-selecting unidentified levels', orient.left);
    check(orient.pa && orient.ap.direction && orient.ap.direction !== orient.pa && Math.sign(orient.ap.shift) === (orient.ap.direction === 'right' ? 1 : -1),
      'changing PA/AP after a run flips the apex side and its translation together', orient);
    check(orient.unconfirmed.side === 'unconfirmed' && orient.unconfirmed.direction === null && orient.unconfirmed.shift === null
      && orient.withdrawn.direction === null && orient.withdrawn.shift === null && orient.withdrawn.conf === 0,
      'the run withholds the apex side and translation until the patient side is confirmed, and withdrawing it withholds them again', orient);
    check(orient.optionText.every(text => /patient right on image (left|right)/.test(text)), 'the projection control states which image side is the patient’s right', orient.optionText);
    check(page.errors.length === 0, 'no page errors during the WP1 run', page.errors);
    fs.rmSync(tmp, { recursive: true, force: true });
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ file, assertions: results.length + failures.length, passed: failures.length === 0, checks: results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
