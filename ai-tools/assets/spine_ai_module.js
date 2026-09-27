(function(){
  'use strict';
  // Embedded neural AP vertebra-corner model runtime.
  //
  // Model: "Vertebra-Focused Landmark Detection" (Yi et al., ISBI 2020),
  // ResNet34 encoder + upsampling decoder with centre heatmap, centre offset,
  // and 8-channel corner-offset heads, trained on AP whole-spine scoliosis
  // radiographs (AASCE 2019 / SpineWeb 16). Code MIT. Converted to a
  // TensorFlow.js graph model; weights are embedded as base64 and never fetched.
  //
  // Everything here runs in this page. Nothing leaves the browser.
  const SPEC = /*__SPINE_AI_SPEC_START__*/null/*__SPINE_AI_SPEC_END__*/;
  const TOPOLOGY_ID = 'spineAiTopology';
  const WEIGHTS_ID = 'spineAiWeights';

  const state = { model: null, loading: null, backend: null, error: null, weightBytes: 0, loadMs: null,
    bytes: null, manifest: null, packed: null, mode: null, selfTest: null, contextLost: false, attempts: [] };

  const hasTf = () => typeof window.tf !== 'undefined' && window.tf && typeof window.tf.loadGraphModel === 'function';
  const hasAssets = () => Boolean(SPEC && document.getElementById(TOPOLOGY_ID) && document.getElementById(WEIGHTS_ID));
  const webglAvailable = () => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch (error) { return false; }
  };

  // The pure-JS CPU backend needs minutes for a 1024x512 ResNet34 pass, so
  // the model is only offered where WebGL is available.
  function supported(){ return hasTf() && hasAssets() && webglAvailable(); }
  function unavailableReason(){
    if (!SPEC) return 'model specification is missing from this build';
    if (!hasTf()) return 'the TensorFlow.js runtime did not initialise';
    if (!hasAssets()) return 'model weights are not embedded in this build';
    if (!webglAvailable()) return 'WebGL is unavailable in this browser';
    return null;
  }

  function base64ToBytes(text){
    const clean = text.replace(/\s+/g, '');
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(clean);
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesPerElement(spec){
    if (spec.quantization && spec.quantization.dtype) {
      return spec.quantization.dtype === 'uint8' || spec.quantization.dtype === 'int8' ? 1
        : spec.quantization.dtype === 'uint16' || spec.quantization.dtype === 'float16' ? 2 : 4;
    }
    return spec.dtype === 'int32' || spec.dtype === 'float32' ? 4 : spec.dtype === 'bool' ? 1 : 4;
  }

  async function chooseBackend(progress){
    const tf = window.tf;
    const order = ['webgl'];
    for (const name of order) {
      try {
        const ok = await tf.setBackend(name);
        if (ok) { await tf.ready(); return name; }
      } catch (error) {
        if (progress) progress(`backend ${name} unavailable (${error.message}); trying the next one`);
      }
    }
    throw new Error('WebGL backend could not be initialised');
  }

  // A lost WebGL context leaves a model whose textures are gone. Flag it so the
  // next ensureLoaded() rebuilds from the retained weight bytes instead of
  // failing every later run.
  function watchContextLoss(){
    try {
      const backend = window.tf.backend();
      const gl = backend && backend.gpgpu && backend.gpgpu.gl;
      const canvas = gl && gl.canvas;
      if (!canvas || canvas.spineAiWatched) return;
      canvas.spineAiWatched = true;
      canvas.addEventListener('webglcontextlost', () => { state.contextLost = true; state.model = null; }, false);
    } catch (error) { /* ignore */ }
  }
  const contextError = error => /context\s*lost|webgl|texture|shader|framebuffer/i.test(String(error && error.message || ''));

  // Fresh engine: disposes every tensor, texture and backend instance while
  // keeping the registered backend factories, so a changed WEBGL_PACK flag
  // takes effect on the next setBackend().
  async function resetEngine(){
    try { if (state.model && state.model.dispose) state.model.dispose(); } catch (error) { /* ignore */ }
    state.model = null;
    try { window.tf.engine().reset(); } catch (error) { /* ignore */ }
  }

  function readEmbeddedWeights(){
    if (state.bytes && state.manifest) return;
    const topologyNode = document.getElementById(TOPOLOGY_ID);
    const weightsNode = document.getElementById(WEIGHTS_ID);
    const manifest = JSON.parse(topologyNode.textContent);
    const bytes = base64ToBytes(weightsNode.textContent);
    const expected = (manifest.weightsManifest || []).reduce((sum, group) =>
      sum + group.weights.reduce((inner, w) => inner + w.shape.reduce((a, b) => a * b, 1) * bytesPerElement(w), 0), 0);
    if (expected && expected !== bytes.byteLength) throw new Error(`embedded weight payload is ${bytes.byteLength} bytes but the manifest expects ${expected}`);
    state.bytes = bytes; state.manifest = manifest; state.weightBytes = bytes.byteLength;
    // The base64 text is only needed once: the decoded bytes are retained so a
    // rebuild (context loss, texture-mode fallback) never needs the DOM copy.
    try { weightsNode.textContent = ''; } catch (error) { /* ignore */ }
  }

  function ioHandler(){
    const manifest = state.manifest, bytes = state.bytes;
    const weightSpecs = (manifest.weightsManifest || []).flatMap(group => group.weights);
    return {
      load: async () => ({
        modelTopology: manifest.modelTopology,
        format: manifest.format,
        generatedBy: manifest.generatedBy,
        convertedBy: manifest.convertedBy,
        signature: manifest.signature,
        userDefinedMetadata: manifest.userDefinedMetadata,
        weightSpecs,
        weightData: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      })
    };
  }

  async function runModel(model, input){
    const names = SPEC.outputs.map(o => o.name);
    const feeds = { [SPEC.input.name]: input };
    try { return model.execute(feeds, names); }
    catch (error) {
      if (/executeAsync/i.test(error.message || '')) return model.executeAsync(feeds, names);
      throw error;
    }
  }
  function disposeOutputs(out){ (Array.isArray(out) ? out : [out]).forEach(t => t && t.dispose && t.dispose()); }

  // Builds the normalised input tensor from an ImageData of the model size.
  function tensorFromImageData(imageData){
    const tf = window.tf;
    const { width, height, data } = imageData;
    const pre = SPEC.preprocess;
    const channels = SPEC.input.shape[3];
    const out = new Float32Array(width * height * channels);
    const bgr = pre.colorOrder === 'BGR';
    const mean = pre.mean, std = pre.std, scale = pre.scale;
    for (let i = 0, p = 0, o = 0; i < width * height; i++, p += 4, o += channels) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const c0 = bgr ? b : r, c2 = bgr ? r : b;
      out[o] = ((c0 * scale) - mean[0]) / std[0];
      out[o + 1] = ((g * scale) - mean[1]) / std[1];
      out[o + 2] = ((c2 * scale) - mean[2]) / std[2];
    }
    return tf.tensor4d(out, [1, height, width, channels], 'float32');
  }

  // Reads an output tensor into a row-major [h][w][c] Float32Array regardless
  // of whether the converted graph emits NHWC or NCHW.
  async function readHWC(tensor, layout){
    const data = await tensor.data();
    const shape = tensor.shape;
    if (layout === 'NHWC') return { data, h: shape[1], w: shape[2], c: shape[3] };
    const c = shape[1], h = shape[2], w = shape[3];
    const out = new Float32Array(h * w * c);
    for (let ch = 0; ch < c; ch++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      out[(y * w + x) * c + ch] = data[ch * h * w + y * w + x];
    }
    return { data: out, h, w, c };
  }

  async function readHeads(outputs){
    const byRole = {};
    SPEC.outputs.forEach((spec, index) => { byRole[spec.role] = { tensor: outputs[index], layout: spec.layout }; });
    return {
      hm: await readHWC(byRole.hm.tensor, byRole.hm.layout),
      reg: await readHWC(byRole.reg.tensor, byRole.reg.layout),
      wh: await readHWC(byRole.wh.tensor, byRole.wh.layout)
    };
  }

  /*__SPINE_AI_PATTERN_START__*/
  // selftest_pattern.js is injected here at build time; it defines
  // spineSelfTestPattern(width, height).
  /*__SPINE_AI_PATTERN_END__*/
  /*__SPINE_AI_DECODE_START__*/
  // decode_reference.js (validated against the authors' PyTorch decoder) is
  // injected here at build time and defines decodeSpineLandmarks().
  /*__SPINE_AI_DECODE_END__*/
  function decodeHeads(hm, reg, wh, downRatio, topK){
    if (typeof decodeSpineLandmarks !== 'function') throw new Error('decoder not embedded');
    const dets = decodeSpineLandmarks(hm.data, reg.data, wh.data, { height: hm.h, width: hm.w, topK, downRatio, layout: 'NHWC' });
    return dets.map(d => ({
      score: d.score,
      center: { x: d.cx, y: d.cy },
      corners: [{ x: d.tl[0], y: d.tl[1] }, { x: d.tr[0], y: d.tr[1] }, { x: d.bl[0], y: d.bl[1] }, { x: d.br[0], y: d.br[1] }]
    }));
  }

  // Numeric self-test. A fixed synthetic radiograph is pushed through the
  // network and the heat map plus BOTH regression heads are compared with the
  // CPU reference computed at build time (SPEC.selfTest).
  //
  // This exists because a real GPU defect was measured during development:
  // on Chrome/ANGLE-D3D11 with an Intel Arc GPU, TensorFlow.js packed-texture
  // kernels return a plausible-looking heat map while the corner-offset head
  // collapses, so every vertebra decodes with zero width and an identical
  // tilt - silently turning the Cobb angle into a fabricated number. Checking
  // the heat map alone would not catch it.
  async function runSelfTest(model){
    const ref = SPEC.selfTest;
    if (!ref || typeof spineSelfTestPattern !== 'function') return { ok: true, skipped: true };
    const W = SPEC.input.shape[2], H = SPEC.input.shape[1];
    const rgba = spineSelfTestPattern(W, H);
    const input = tensorFromImageData({ data: rgba, width: W, height: H });
    let outputs = null;
    try {
      outputs = await runModel(model, input);
      const heads = await readHeads(outputs);
      const tol = ref.tolerance;
      let maxScore = 0, maxReg = 0, maxWh = 0;
      const cells = ref.peaks.concat(ref.grid);
      cells.forEach(cell => {
        const i = cell.i;
        if (cell.s != null) maxScore = Math.max(maxScore, Math.abs(heads.hm.data[i] - cell.s));
        for (let c = 0; c < 2; c++) maxReg = Math.max(maxReg, Math.abs(heads.reg.data[i * 2 + c] - cell.reg[c]));
        for (let c = 0; c < 8; c++) maxWh = Math.max(maxWh, Math.abs(heads.wh.data[i * 8 + c] - cell.wh[c]));
      });
      // The strongest reference peaks must still be local maxima here.
      let peakMatches = 0;
      const wanted = Math.min(tol.peakMatch, ref.peaks.length);
      ref.peaks.slice(0, wanted).forEach(peak => {
        const y = Math.floor(peak.i / heads.hm.w), x = peak.i - y * heads.hm.w;
        let best = -Infinity, bestI = -1;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(heads.hm.h - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(heads.hm.w - 1, x + 1); xx++) {
            const v = heads.hm.data[yy * heads.hm.w + xx];
            if (v > best) { best = v; bestI = yy * heads.hm.w + xx; }
          }
        }
        if (Math.abs(bestI - peak.i) <= heads.hm.w + 1) peakMatches++;
      });
      const ok = maxScore <= tol.score && maxReg <= tol.reg && maxWh <= tol.wh && peakMatches >= wanted - 1;
      return { ok, maxScore: +maxScore.toFixed(4), maxReg: +maxReg.toFixed(3), maxWh: +maxWh.toFixed(3), peakMatches, of: wanted };
    } finally {
      input.dispose();
      if (outputs) disposeOutputs(outputs);
    }
  }

  // Execution modes, fastest first. Every mode must pass the numeric self-test.
  //
  // Plain packed mode (the TF.js default) is deliberately not offered: for the
  // final 7x7 convolution of the corner-offset head its im2col path requests a
  // single texture larger than some GPUs will allocate, and that failure does
  // not surface as an exception. WEBGL_EXP_CONV avoids the oversized texture and
  // is several times faster than unpacked. Whatever the mode, the numeric
  // self-test below decides whether the model is used.
  const MODES = Object.freeze([
    Object.freeze({ id: 'packed-expconv', packed: true, flags: Object.freeze({ WEBGL_EXP_CONV: true }), label: 'packed textures, direct convolution' }),
    Object.freeze({ id: 'unpacked', packed: false, flags: Object.freeze({}), label: 'unpacked textures' })
  ]);

  async function buildModel(mode, progress){
    const tf = window.tf;
    // Order matters: engine().reset() also resets the environment, so the flags
    // have to be set after the reset or the retry silently repeats the mode
    // that just failed.
    await resetEngine();
    try { tf.env().set('WEBGL_PACK', mode.packed); } catch (error) { /* flag unsupported */ }
    Object.keys(mode.flags).forEach(name => { try { tf.env().set(name, mode.flags[name]); } catch (error) { /* flag unsupported in this TF.js build; the self-test still decides */ } });
    const packed = mode.packed;
    state.backend = await chooseBackend(progress);
    watchContextLoss();
    if (progress) progress(`building the network graph (${mode.label})…`);
    const model = await tf.loadGraphModel(ioHandler());
    try {
      if (progress) progress('warming up shaders (first run only)…');
      await new Promise(resolve => setTimeout(resolve, 0));
      const warm = tf.zeros([1, SPEC.input.shape[1], SPEC.input.shape[2], SPEC.input.shape[3]]);
      try { disposeOutputs(await runModel(model, warm)); } finally { warm.dispose(); }
      if (progress) progress('checking GPU numerics against the build-time reference…');
      const test = await runSelfTest(model);
      state.attempts.push(Object.assign({ mode: mode.id, packed }, test));
      if (!test.ok) {
        try { model.dispose(); } catch (error) { /* ignore */ }
        return null;
      }
      state.selfTest = test; state.packed = packed; state.mode = mode.id;
      return model;
    } catch (error) {
      try { model.dispose(); } catch (inner) { /* ignore */ }
      throw error;
    }
  }

  async function ensureLoaded(progress){
    if (state.model && !state.contextLost) return state.model;
    if (state.loading) return state.loading;
    state.loading = (async () => {
      const started = performance.now();
      if (!supported()) throw new Error(unavailableReason() || 'neural model unavailable');
      if (progress) progress('decoding embedded weights…');
      await new Promise(resolve => setTimeout(resolve, 0));
      readEmbeddedWeights();
      state.contextLost = false;
      state.attempts = [];
      // After a context loss, resume from the mode that last passed.
      const start = Math.max(0, MODES.findIndex(mode => mode.id === state.mode));
      const order = MODES.slice(start);
      let model = null;
      for (let i = 0; i < order.length; i++) {
        model = await buildModel(order[i], progress);
        if (model) break;
        if (progress) progress(i + 1 < order.length
          ? `${order[i].label} failed the numeric self-test; retrying with ${order[i + 1].label}…`
          : `${order[i].label} failed the numeric self-test`);
      }
      if (!model) {
        await resetEngine();
        const last = state.attempts[state.attempts.length - 1] || {};
        throw new Error(`this GPU failed the numeric self-test (corner-offset error ${last.maxWh != null ? last.maxWh : '?'} cells, heat-map error ${last.maxScore != null ? last.maxScore : '?'})`);
      }
      state.loadMs = performance.now() - started;
      state.model = model;
      state.error = null;
      return model;
    })();
    try { return await state.loading; }
    catch (error) { state.error = error; throw error; }
    finally { state.loading = null; }
  }

  // modelInput: { imageData, width, height } at SPEC.input size.
  // mapping: { scaleX, scaleY, offsetX, offsetY } model-input px -> analysis px.
  async function detectFrontal(modelInput, mapping){
    const model = await ensureLoaded();
    if (!modelInput || !modelInput.imageData) throw new Error('no model input raster');
    if (modelInput.width !== SPEC.input.shape[2] || modelInput.height !== SPEC.input.shape[1]) {
      throw new Error(`model input must be ${SPEC.input.shape[2]}x${SPEC.input.shape[1]}`);
    }
    const started = performance.now();
    if (state.contextLost) throw new Error('the WebGL context was lost; run again to rebuild the model');
    const input = tensorFromImageData(modelInput.imageData);
    let outputs = null;
    try {
      try {
        outputs = await runModel(model, input);
      } catch (error) {
        if (contextError(error)) { state.contextLost = true; state.model = null; }
        throw error;
      }
      const heads = await readHeads(outputs);
      const decoded = decodeHeads(heads.hm, heads.reg, heads.wh, SPEC.downRatio, SPEC.decode.topK);
      const sx = mapping && Number.isFinite(mapping.scaleX) ? mapping.scaleX : 1;
      const sy = mapping && Number.isFinite(mapping.scaleY) ? mapping.scaleY : 1;
      const ox = mapping && Number.isFinite(mapping.offsetX) ? mapping.offsetX : 0;
      const oy = mapping && Number.isFinite(mapping.offsetY) ? mapping.offsetY : 0;
      const map = point => ({ x: point.x * sx + ox, y: point.y * sy + oy });
      const vertebrae = decoded.map(v => ({
        score: v.score,
        center: map(v.center),
        corners: v.corners.map(map),
        label: v.label || null
      }));
      return {
        vertebrae,
        backend: state.backend,
        inferenceMs: performance.now() - started,
        inputWidth: modelInput.width,
        inputHeight: modelInput.height,
        modelVersion: SPEC.modelVersion,
        loadMs: state.loadMs,
        packed: state.packed,
        mode: state.mode,
        selfTest: state.selfTest
      };
    } finally {
      input.dispose();
      if (outputs) disposeOutputs(outputs);
    }
  }

  function status(){
    return {
      supported: supported(), loaded: Boolean(state.model), loading: Boolean(state.loading),
      backend: state.backend, error: state.error ? state.error.message : null,
      weightBytes: state.weightBytes, loadMs: state.loadMs, modelVersion: SPEC ? SPEC.modelVersion : null,
      packed: state.packed, mode: state.mode, selfTest: state.selfTest, attempts: state.attempts.slice(), contextLost: state.contextLost
    };
  }

  window.__SPINE_AI__ = Object.freeze({
    supported, unavailableReason, ensureLoaded, detectFrontal, status,
    inputSize: SPEC ? { width: SPEC.input.shape[2], height: SPEC.input.shape[1] } : null,
    spec: SPEC
  });
})();
