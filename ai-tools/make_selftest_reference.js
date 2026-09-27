#!/usr/bin/env node
'use strict';
// Computes the numeric self-test reference for the embedded model with the
// TensorFlow.js CPU backend and writes it into assets/spec.json (selfTest key).
// Requires @tensorflow/tfjs in a node_modules reachable from this directory
// (e.g. `npm i @tensorflow/tfjs@4.22.0` here or in a parent).
//
// The browser runtime feeds the same synthetic pattern through the same
// preprocessing, then compares the heatmap peaks and the regression heads at
// the reference cells. A GPU path that corrupts the packed regression textures
// (seen on Chrome/ANGLE-D3D11 with Intel Arc) fails this check.
const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const { spineSelfTestPattern } = require('./assets/selftest_pattern.js');

const assets = path.join(__dirname, 'assets');
const spec = JSON.parse(fs.readFileSync(path.join(assets, 'spec.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(assets, 'model_topology.json'), 'utf8'));
const b64 = fs.readFileSync(path.join(assets, 'weights.b64'), 'utf8').replace(/\s+/g, '');
const bytes = Buffer.from(b64, 'base64');

(async () => {
  await tf.setBackend('cpu');
  const weightSpecs = manifest.weightsManifest.flatMap(g => g.weights);
  const model = await tf.loadGraphModel({ load: async () => ({ modelTopology: manifest.modelTopology, format: manifest.format, generatedBy: manifest.generatedBy, convertedBy: manifest.convertedBy, signature: manifest.signature, weightSpecs, weightData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) });
  const [, H, W, C] = spec.input.shape;
  const rgba = spineSelfTestPattern(W, H);
  const pre = spec.preprocess;
  const inp = new Float32Array(W * H * C);
  const bgr = pre.colorOrder === 'BGR';
  for (let i = 0, p = 0, o = 0; i < W * H; i++, p += 4, o += C) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    inp[o] = ((bgr ? b : r) * pre.scale - pre.mean[0]) / pre.std[0];
    inp[o + 1] = (g * pre.scale - pre.mean[1]) / pre.std[1];
    inp[o + 2] = ((bgr ? r : b) * pre.scale - pre.mean[2]) / pre.std[2];
  }
  const x = tf.tensor4d(inp, [1, H, W, C]);
  console.log('running CPU reference (this takes a few minutes)...');
  const t0 = Date.now();
  const outs = model.execute({ [spec.input.name]: x }, spec.outputs.map(o => o.name));
  const data = {};
  for (let k = 0; k < outs.length; k++) data[spec.outputs[k].role] = { d: await outs[k].data(), shape: outs[k].shape };
  console.log('done in', Math.round((Date.now() - t0) / 1000), 's');
  const hm = data.hm, reg = data.reg, wh = data.wh;
  const h = hm.shape[1], w = hm.shape[2];
  // Top-8 heatmap peaks after 3x3 NMS, exactly like the decoder.
  const cand = [];
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const i = y * w + xx; const v = hm.d[i]; let m = -Infinity;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let x2 = Math.max(0, xx - 1); x2 <= Math.min(w - 1, xx + 1); x2++) m = Math.max(m, hm.d[yy * w + x2]);
    if (m === v) cand.push({ i, s: v });
  }
  cand.sort((a, b) => b.s - a.s || a.i - b.i);
  const peaks = cand.slice(0, 8).map(c => ({ i: c.i, s: +c.s.toFixed(4), reg: [reg.d[c.i * 2], reg.d[c.i * 2 + 1]].map(v => +v.toFixed(3)), wh: Array.from(wh.d.slice(c.i * 8, c.i * 8 + 8)).map(v => +v.toFixed(3)) }));
  // Fixed grid cells along the column for the regression maps.
  const grid = [];
  for (let gy = 16; gy < h; gy += 32) for (let gx = 48; gx <= 80; gx += 16) { const i = gy * w + gx; grid.push({ i, reg: [reg.d[i * 2], reg.d[i * 2 + 1]].map(v => +v.toFixed(3)), wh: Array.from(wh.d.slice(i * 8, i * 8 + 8)).map(v => +v.toFixed(3)) }); }
  const whAbs = Array.from(wh.d).reduce((s, v) => s + Math.abs(v), 0) / wh.d.length;
  spec.selfTest = {
    pattern: 'spineSelfTestPattern',
    heatmap: { h, w },
    peaks, grid,
    tolerance: { score: 0.06, reg: 0.3, wh: 0.6, peakMatch: 5 },
    stats: { hmMax: +Math.max(...hm.d).toFixed(4), whMeanAbs: +whAbs.toFixed(4) },
    generatedBy: 'tfjs cpu ' + tf.version_core,
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(assets, 'spec.json'), JSON.stringify(spec, null, 1));
  console.log(JSON.stringify({ peaks: peaks.slice(0, 4), stats: spec.selfTest.stats }, null, 1));
  x.dispose(); outs.forEach(t => t.dispose());
})().catch(e => { console.error(e); process.exit(1); });
