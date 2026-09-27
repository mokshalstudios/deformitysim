#!/usr/bin/env node
'use strict';
// Embeds (or refreshes) the offline imaging assets in spine_simulator.html:
//   - TensorFlow.js runtime (Apache-2.0)
//   - pure-JS DICOM radiograph decoder
//   - neural AP vertebra-corner model (topology JSON + base64 weights) and its runtime
// Everything is placed between <!--__SPINE_AI_ASSETS_START__--> and
// <!--__SPINE_AI_ASSETS_END__--> immediately before the radiograph module, so
// window.__SPINE_DICOM__ and window.__SPINE_AI__ exist when that module runs.
//
// Usage:
//   node ai-tools/embed_ai_assets.js spine_simulator.html            # full build (DICOM + neural model)
//   node ai-tools/embed_ai_assets.js spine_simulator.html --no-model  # DICOM decoder only
//   node ai-tools/embed_ai_assets.js spine_simulator.html --strip     # remove the asset block entirely

const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(process.argv[2] || 'spine_simulator.html');
const flags = new Set(process.argv.slice(3));
const assetsDir = path.join(__dirname, 'assets');
const START = '<!--__SPINE_AI_ASSETS_START__-->';
const END = '<!--__SPINE_AI_ASSETS_END__-->';
const ANCHOR = "<script>\n(function(){\n  'use strict';\n  const VERSION = '";

const read = name => fs.readFileSync(path.join(assetsDir, name), 'utf8');
const exists = name => fs.existsSync(path.join(assetsDir, name));
const assertInlineSafe = (label, text) => {
  if (/<\/script/i.test(text)) throw new Error(`${label} contains "</script" and cannot be inlined.`);
  if (/<!--/.test(text)) throw new Error(`${label} contains "<!--" which the HTML parser treats specially inside scripts.`);
};
const stripSourceMap = text => text.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/m, '\n');

let html = fs.readFileSync(htmlPath, 'utf8');
const startIndex = html.indexOf(START);
const endIndex = html.indexOf(END);
if ((startIndex >= 0) !== (endIndex >= 0)) throw new Error('Asset markers are unbalanced in the HTML.');

let block = '';
const parts = [];
if (!flags.has('--strip')) {
  const dicom = read('dicom_radiograph.js');
  assertInlineSafe('dicom_radiograph.js', dicom);
  parts.push(`<script id="spine-dicom-decoder">\n${dicom.trim()}\n</script>`);

  if (!flags.has('--no-model')) {
    for (const name of ['tf.min.js', 'spine_ai_module.js', 'spec.json', 'model_topology.json', 'weights.b64', 'decode_reference.js', 'selftest_pattern.js']) {
      if (!exists(name)) throw new Error(`Missing asset ${name}; run the export pipeline or use --no-model.`);
    }
    const tf = stripSourceMap(read('tf.min.js'));
    assertInlineSafe('tf.min.js', tf);
    const spec = JSON.parse(read('spec.json'));
    const topology = read('model_topology.json').trim();
    JSON.parse(topology);
    assertInlineSafe('model_topology.json', topology);
    const weights = read('weights.b64').replace(/\s+/g, '');
    for (let offset = 0; offset < weights.length; offset += 4194304) {
      if (!/^[A-Za-z0-9+/=]+$/.test(weights.slice(offset, offset + 4194304))) throw new Error('weights.b64 is not strict base64.');
    }
    const decoder = read('decode_reference.js').trim();
    assertInlineSafe('decode_reference.js', decoder);
    const pattern = read('selftest_pattern.js').trim();
    assertInlineSafe('selftest_pattern.js', pattern);
    if (!spec.selfTest) throw new Error('spec.json has no selfTest reference; run ai-tools/make_selftest_reference.js.');
    let module = read('spine_ai_module.js');
    const specStart = module.indexOf('/*__SPINE_AI_SPEC_START__*/');
    const specEnd = module.indexOf('/*__SPINE_AI_SPEC_END__*/');
    const decStart = module.indexOf('/*__SPINE_AI_DECODE_START__*/');
    const decEnd = module.indexOf('/*__SPINE_AI_DECODE_END__*/');
    const patStart = module.indexOf('/*__SPINE_AI_PATTERN_START__*/');
    const patEnd = module.indexOf('/*__SPINE_AI_PATTERN_END__*/');
    if (specStart < 0 || specEnd < 0 || decStart < 0 || decEnd < 0 || patStart < 0 || patEnd < 0) throw new Error('spine_ai_module.js markers are missing.');
    module = module.slice(0, decStart) + '/*__SPINE_AI_DECODE_START__*/\n' + decoder + '\n  ' + module.slice(decEnd);
    const patStart2 = module.indexOf('/*__SPINE_AI_PATTERN_START__*/');
    const patEnd2 = module.indexOf('/*__SPINE_AI_PATTERN_END__*/');
    module = module.slice(0, patStart2) + '/*__SPINE_AI_PATTERN_START__*/\n' + pattern + '\n  ' + module.slice(patEnd2);
    module = module.slice(0, specStart) + '/*__SPINE_AI_SPEC_START__*/' + JSON.stringify(spec) + module.slice(specEnd);
    assertInlineSafe('spine_ai_module.js', module);
    // Wrap base64 at 1 MB lines: keeps editors responsive without changing content.
    // (A `.{1048576}` regex is pathological in V8 at this size; slice instead.)
    const lines = [];
    for (let offset = 0; offset < weights.length; offset += 1048576) lines.push(weights.slice(offset, offset + 1048576));
    const wrapped = lines.join('\n');
    parts.push(`<script id="spine-tfjs-runtime">\n${tf.trim()}\n</script>`);
    parts.push(`<script type="application/json" id="spineAiTopology">\n${topology}\n</script>`);
    parts.push(`<script type="application/octet-stream" id="spineAiWeights">\n${wrapped}\n</script>`);
    parts.push(`<script id="spine-ai-runtime">\n${module.trim()}\n</script>`);
  }
  block = `${START}\n${parts.join('\n')}\n${END}\n`;
}

if (startIndex >= 0) {
  html = html.slice(0, startIndex) + block + html.slice(endIndex + END.length).replace(/^\n/, '');
} else if (block) {
  const anchor = html.indexOf(ANCHOR);
  if (anchor < 0) throw new Error('Radiograph module anchor not found; cannot place the asset block.');
  html = html.slice(0, anchor) + block + html.slice(anchor);
}

fs.writeFileSync(htmlPath, html);
const size = fs.statSync(htmlPath).size;
console.log(JSON.stringify({
  file: htmlPath,
  mode: flags.has('--strip') ? 'stripped' : flags.has('--no-model') ? 'dicom-only' : 'full',
  parts: parts.map(part => part.slice(0, part.indexOf('>') + 1)),
  bytes: size,
  megabytes: Number((size / 1048576).toFixed(2))
}, null, 2));
