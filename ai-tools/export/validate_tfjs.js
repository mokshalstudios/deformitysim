/* Validate the converted TF.js GraphModel against the PyTorch reference outputs.
 * Usage: node validate_tfjs.js [tfjs_dir=out/tfjs_uint8] [image=1]
 * Loads model.json + shards via a custom IOHandler (fs based), feeds the exact preprocessed
 * tensor PyTorch used (ref_<img>_input.npy, NCHW -> NHWC), compares hm/reg/wh, then runs the
 * plain-JS decoder and compares against reference_landmarks.json. */
const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs');
const dec = require('./out/decode_reference.js');

const M = __dirname;
const tfjsDir = path.resolve(M, process.argv[2] || 'out/tfjs_uint8');
const img = process.argv[3] || '1';
const OUT = path.join(M, 'out');

function readNpy(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 6) !== '\x93NUMPY') throw new Error('not npy: ' + file);
  const major = buf[6];
  let headerLen, off;
  if (major === 1) { headerLen = buf.readUInt16LE(8); off = 10; }
  else { headerLen = buf.readUInt32LE(8); off = 12; }
  const header = buf.toString('latin1', off, off + headerLen);
  const shape = header.match(/'shape':\s*\(([^)]*)\)/)[1].split(',').map(s => s.trim()).filter(s => s.length).map(Number);
  const descr = header.match(/'descr':\s*'([^']*)'/)[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  if (fortran) throw new Error('fortran order unsupported');
  const dataOff = off + headerLen;
  let data;
  if (descr === '<f4') {
    const n = shape.reduce((a, b) => a * b, 1);
    data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = buf.readFloatLE(dataOff + i * 4);
  } else throw new Error('dtype ' + descr);
  return { shape, data };
}

function nchwToNhwc(arr) { // arr: {shape:[1,C,H,W], data}
  const [n, C, H, W] = arr.shape;
  const out = new Float32Array(n * C * H * W);
  for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    out[(y * W + x) * C + c] = arr.data[c * H * W + y * W + x];
  return { shape: [n, H, W, C], data: out };
}

function fsIOHandler(dir) {
  return {
    load: async () => {
      const mj = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
      const manifest = mj.weightsManifest;
      const weightSpecs = [];
      const bufs = [];
      for (const group of manifest) {
        for (const w of group.weights) weightSpecs.push(w);
        for (const p of group.paths) bufs.push(fs.readFileSync(path.join(dir, p)));
      }
      const total = bufs.reduce((a, b) => a + b.length, 0);
      const weightData = new ArrayBuffer(total);
      const view = new Uint8Array(weightData);
      let o = 0;
      for (const b of bufs) { view.set(b, o); o += b.length; }
      return {
        modelTopology: mj.modelTopology,
        weightSpecs,
        weightData,
        format: mj.format,
        generatedBy: mj.generatedBy,
        convertedBy: mj.convertedBy,
        signature: mj.signature,
        userDefinedMetadata: mj.userDefinedMetadata,
      };
    }
  };
}

function maxAbsDiff(a, b) {
  let m = 0, am = 0, bm = 0, ai = -1, bi = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]); if (d > m) m = d;
    if (a[i] > am) { am = a[i]; ai = i; } if (b[i] > bm) { bm = b[i]; bi = i; }
  }
  return { maxAbsDiff: m, argmaxA: ai, argmaxB: bi };
}

function compareDets(jsDets, refDets, label) {
  // both in decoder (score-desc) order; compare center + 4 corners in input-pixel coords
  let maxErr = 0, maxScoreErr = 0, worst = null;
  for (let k = 0; k < refDets.length; k++) {
    const r = refDets[k], j = jsDets[k];
    const pairs = [[j.cx, r.center_input[0]], [j.cy, r.center_input[1]],
      [j.tl[0], r.corners_input.tl[0]], [j.tl[1], r.corners_input.tl[1]],
      [j.tr[0], r.corners_input.tr[0]], [j.tr[1], r.corners_input.tr[1]],
      [j.bl[0], r.corners_input.bl[0]], [j.bl[1], r.corners_input.bl[1]],
      [j.br[0], r.corners_input.br[0]], [j.br[1], r.corners_input.br[1]]];
    for (const [a, b] of pairs) { const e = Math.abs(a - b); if (e > maxErr) { maxErr = e; worst = k; } }
    const se = Math.abs(j.score - r.score); if (se > maxScoreErr) maxScoreErr = se;
  }
  console.log(`${label}: max |coord err| = ${maxErr.toFixed(4)} px (input space, worst det #${worst}), max |score err| = ${maxScoreErr.toExponential(3)}`);
  return { maxCoordErrPx: maxErr, maxScoreErr };
}

(async () => {
  await tf.setBackend('cpu');
  const ref = JSON.parse(fs.readFileSync(path.join(OUT, 'reference_landmarks.json'), 'utf8'));
  const refDets = ref[img].detections_decoder_order;
  const report = { tfjsDir, image: img };

  // --- Stage A: decoder-only check on the exact PyTorch head outputs (NCHW npy) ---
  const hmT = readNpy(path.join(OUT, `ref_${img}_hm.npy`));
  const regT = readNpy(path.join(OUT, `ref_${img}_reg.npy`));
  const whT = readNpy(path.join(OUT, `ref_${img}_wh.npy`));
  const detsA = dec.decodeSpineLandmarks(hmT.data, regT.data, whT.data, { layout: 'NCHW' });
  report.decoderOnPytorchOutputs = compareDets(detsA, refDets, 'JS decoder on PyTorch outputs');

  // --- Stage B: TF.js model ---
  const t0 = Date.now();
  const model = await tf.loadGraphModel(fsIOHandler(tfjsDir));
  console.log('model loaded in', Date.now() - t0, 'ms');
  console.log('inputs:', model.inputs.map(i => `${i.name} ${JSON.stringify(i.shape)} ${i.dtype}`));
  console.log('outputs:', model.outputs.map(o => `${o.name} ${JSON.stringify(o.shape)} ${o.dtype}`));
  report.inputs = model.inputs.map(i => ({ name: i.name, shape: i.shape, dtype: i.dtype }));
  report.outputs = model.outputs.map(o => ({ name: o.name, shape: o.shape, dtype: o.dtype }));

  const inp = nchwToNhwc(readNpy(path.join(OUT, `ref_${img}_input.npy`)));
  const x = tf.tensor4d(inp.data, inp.shape, 'float32');
  const t1 = Date.now();
  const outs = await model.executeAsync(x);
  const runMs = Date.now() - t1;
  console.log('tfjs cpu run ms:', runMs);
  report.tfjsCpuRunMs = runMs;
  const outArr = Array.isArray(outs) ? outs : [outs];
  const byName = {};
  model.outputs.forEach((o, i) => { byName[o.name] = outArr[i]; });

  // find which output is which by channel count (last dim)
  const heads = {};
  for (const t of outArr) {
    const c = t.shape[t.shape.length - 1];
    if (c === 1) heads.hm = t; else if (c === 2) heads.reg = t; else if (c === 8) heads.wh = t;
  }
  report.outputNameMap = {};
  model.outputs.forEach((o, i) => { const c = outArr[i].shape[outArr[i].shape.length - 1]; report.outputNameMap[o.name] = c === 1 ? 'hm' : c === 2 ? 'reg' : 'wh'; });
  console.log('output name map:', report.outputNameMap);

  const hmJ = await heads.hm.data(), regJ = await heads.reg.data(), whJ = await heads.wh.data();
  const hmR = nchwToNhwc(hmT), regR = nchwToNhwc(regT), whR = nchwToNhwc(whT);
  report.headDiffs = {
    hm: maxAbsDiff(hmJ, hmR.data), reg: maxAbsDiff(regJ, regR.data), wh: maxAbsDiff(whJ, whR.data),
  };
  for (const h of ['hm', 'reg', 'wh']) {
    const d = report.headDiffs[h];
    console.log(`${h}: shape ${JSON.stringify(heads[h].shape)} max|diff| vs torch = ${d.maxAbsDiff.toExponential(3)}  argmax tfjs=${d.argmaxA} torch=${d.argmaxB} ${d.argmaxA === d.argmaxB ? '(match)' : '(DIFFERENT)'}`);
  }

  const detsB = dec.decodeSpineLandmarks(hmJ, regJ, whJ, { layout: 'NHWC' });
  report.decoderOnTfjsOutputs = compareDets(detsB, refDets, 'JS decoder on TF.js outputs vs PyTorch reference');
  // per-det index match
  let idxMatch = 0;
  for (let k = 0; k < refDets.length; k++) {
    const r = refDets[k];
    const rix = Math.floor(r.center_hm[0] + 1e-6) ; // not exact; use peaks instead
  }
  const refPeaks = ref[img].heatmap_peaks_nms_top17.map(p => p.index);
  const jsPeaks = detsB.map(d => d.iy * 128 + d.ix);
  const sameSet = refPeaks.slice().sort((a, b) => a - b).join(',') === jsPeaks.slice().sort((a, b) => a - b).join(',');
  console.log('top-17 peak cell set identical to PyTorch:', sameSet, '| same order:', refPeaks.join(',') === jsPeaks.join(','));
  report.peakSetIdentical = sameSet;
  report.peakOrderIdentical = refPeaks.join(',') === jsPeaks.join(',');
  report.detections = detsB;
  fs.writeFileSync(path.join(OUT, `tfjs_validation_${path.basename(tfjsDir)}_${img}.json`), JSON.stringify(report, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
