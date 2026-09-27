const fs = require('fs');
const vm = require('vm');

const htmlPath = process.argv[2] || 'spine_simulator.html';
const html = fs.readFileSync(htmlPath, 'utf8');
// Executable blocks are parsed as JavaScript. Typed data blocks (embedded
// model topology/weights) are validated as strict JSON or strict base64 so an
// accidental "</script>" or stray text inside them still fails the check.
const JS_TYPE = /^(?:|module|text\/javascript|application\/javascript|text\/ecmascript)$/i;
const scriptBlocks = [...html.matchAll(/<script((?:\s[^>]*)?)>([\s\S]*?)<\/script>/g)].map(match => {
  const typeMatch = /\btype\s*=\s*(["'])(.*?)\1/i.exec(match[1] || '');
  const type = typeMatch ? typeMatch[2].trim() : '';
  return { attrs: match[1] || '', type, body: match[2], executable: JS_TYPE.test(type) };
});
const scripts = scriptBlocks.filter(block => block.executable).map(block => block.body);
// Third-party runtimes (three.js, TensorFlow.js) are parsed but not scanned for
// DOM bindings: minified library code uses `$(...)` as an ordinary identifier.
const THIRD_PARTY_RUNTIME = /\sid="spine-(three|tfjs)-runtime"/;
const applicationScripts = scriptBlocks.filter(block => block.executable && !THIRD_PARTY_RUNTIME.test(block.attrs)).map(block => block.body);
const dataBlocks = scriptBlocks.filter(block => !block.executable);
dataBlocks.forEach((block, index) => {
  if (/^application\/json$/i.test(block.type)) {
    JSON.parse(block.body);
    console.log(`data block ${index + 1} json ok ${block.body.length}`);
  } else if (/^application\/octet-stream$/i.test(block.type)) {
    if (!/^[\sA-Za-z0-9+/=]*$/.test(block.body)) throw new Error(`Data block ${index + 1} is not strict base64.`);
    console.log(`data block ${index + 1} base64 ok ${block.body.length}`);
  } else {
    throw new Error(`Unexpected non-executable script type "${block.type}".`);
  }
});

function countDocumentTags(source, tag) {
  const rawTextRanges = [];
  const rawTextPattern = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
  for (const match of source.matchAll(rawTextPattern)) {
    const openEnd = match.index + match[0].indexOf('>') + 1;
    const closeStart = match.index + match[0].lastIndexOf('</');
    rawTextRanges.push([openEnd, closeStart]);
  }
  const commentRanges = [...source.matchAll(/<!--[\s\S]*?-->/g)]
    .map(match => [match.index, match.index + match[0].length]);
  const ignored = [...rawTextRanges, ...commentRanges];
  const outsideIgnoredRange = index => !ignored.some(([start, end]) => index >= start && index < end);
  const openingPattern = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
  const closingPattern = new RegExp(`</${tag}>`, 'gi');
  return {
    opening: [...source.matchAll(openingPattern)].filter(match => outsideIgnoredRange(match.index)).length,
    closing: [...source.matchAll(closingPattern)].filter(match => outsideIgnoredRange(match.index)).length
  };
}

const documentRequirements = [
  ['doctype', /^\s*<!doctype html>/i],
  ['html root', /<html\b/i],
  ['head', /<head\b/i],
  ['head close', /<\/head>/i],
  ['style block', /<style\b/i],
  ['style close', /<\/style>/i],
  ['body', /<body\b/i],
  ['body close', /<\/body>/i],
  ['3D canvas', /\bid=(["'])threeCanvas\1/i],
  ['procedure form', /\bid=(["'])procedureForm\1/i],
  ['model self-test status', /\bid=(["'])modelSelfTestStatus\1/i]
];
const missingDocumentParts = documentRequirements
  .filter(([, pattern]) => !pattern.test(html))
  .map(([label]) => label);
if (missingDocumentParts.length) {
  throw new Error(`HTML document shell is incomplete: ${missingDocumentParts.join(', ')}.`);
}
for (const tag of ['html', 'head', 'style', 'body']) {
  const { opening, closing } = countDocumentTags(html, tag);
  if (opening !== closing || opening !== 1) {
    throw new Error(`HTML document has unbalanced <${tag}> tags (${opening} opening / ${closing} closing).`);
  }
}
if (scripts.length < 3) throw new Error(`Expected at least 3 script blocks; found ${scripts.length}.`);

const runtimeMatch = html.match(/<script\b(?=[^>]*\bid="spine-three-runtime")[^>]*>([\s\S]*?)<\/script>/);
if (!runtimeMatch) throw new Error('Embedded Three.js runtime block was not found.');
const runtime = runtimeMatch[1];
if (/tokens truncated/i.test(runtime) || runtime.includes('\u2026')) {
  throw new Error('Embedded Three.js runtime contains a truncation marker.');
}
if (runtime.length < 500_000) {
  throw new Error(`Embedded Three.js runtime is incomplete (${runtime.length} code units).`);
}

const orbitControlsRequirements = [
  ['OrbitControls class', /class\s+OrbitControls\s+extends\s+EventDispatcher/],
  ['OrbitControls global export', /THREE\.OrbitControls\s*=\s*OrbitControls/],
  ['context-menu handler', /function\s+onContextMenu\s*\(\s*event\s*\)/],
  ['pointer-down handler', /function\s+onPointerDown\s*\(\s*event\s*\)/],
  ['pointer-up handler', /function\s+onPointerUp\s*\(\s*event\s*\)/],
  ['pointer-removal handler', /function\s+removePointer\s*\(\s*event\s*\)/]
];
const missingOrbitControlsParts = orbitControlsRequirements
  .filter(([, pattern]) => !pattern.test(runtime))
  .map(([label]) => label);
if (missingOrbitControlsParts.length) {
  throw new Error(`Embedded OrbitControls is incomplete: ${missingOrbitControlsParts.join(', ')}.`);
}

const runtimeContext = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout,
  clearTimeout
};
runtimeContext.window = runtimeContext;
runtimeContext.self = runtimeContext;
runtimeContext.globalThis = runtimeContext;
vm.createContext(runtimeContext);
try {
  vm.runInContext(runtime, runtimeContext, { filename: 'spine-three-runtime.js', timeout: 15_000 });
  if (runtimeContext.THREE?.REVISION !== '160') {
    throw new Error(`expected Three.js r160, received ${runtimeContext.THREE?.REVISION || 'no revision'}`);
  }
  if (typeof runtimeContext.THREE.OrbitControls !== 'function') {
    throw new Error('THREE.OrbitControls was not exported');
  }

  const listeners = new Map();
  const rootNode = { addEventListener() {}, removeEventListener() {} };
  const domElement = {
    style: {},
    clientWidth: 1280,
    clientHeight: 800,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    getRootNode() { return rootNode; },
    setPointerCapture() {},
    releasePointerCapture() {}
  };
  const camera = new runtimeContext.THREE.PerspectiveCamera(45, 1.6, 0.03, 3000);
  const controls = new runtimeContext.THREE.OrbitControls(camera, domElement);
  if (!listeners.has('contextmenu') || !listeners.has('pointerdown')
      || !listeners.has('pointercancel') || !listeners.has('wheel')) {
    throw new Error('OrbitControls did not register its required pointer and wheel listeners');
  }
  controls.dispose();
} catch (error) {
  throw new Error(`Embedded 3D runtime smoke test failed: ${error.message}`);
}
console.log(`runtime Three.js r${runtimeContext.THREE.REVISION} + OrbitControls smoke test ok ${runtime.length}`);

console.log(`scripts ${scripts.length}`);
scripts.forEach((script, index) => {
  new Function(script);
  console.log(`parse ${index + 1} ok ${script.length}`);
});

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
console.log(`ids ${ids.length} duplicate ${duplicates.length}`);
if (duplicates.length) throw new Error(`Duplicate ids: ${duplicates.join(', ')}`);
const idSet = new Set(ids);
const literalBindingIds = new Set();
[
  /\$\(\s*(['"])([^'"]+)\1\s*\)/g,
  /document\.getElementById\(\s*(['"])([^'"]+)\1\s*\)/g
].forEach(pattern => {
  applicationScripts.forEach(script => {
    for (const match of script.matchAll(pattern)) literalBindingIds.add(match[2]);
  });
});
const missingBindingIds = [...literalBindingIds].filter(id => !idSet.has(id)).sort();
if (missingBindingIds.length) {
  throw new Error(`Application script references missing DOM elements: ${missingBindingIds.join(', ')}.`);
}
console.log(`literal DOM bindings ${literalBindingIds.size} missing 0`);

const atlasMatch = html.match(/\/\*__REFERENCE_ATLAS_START__\*\/\s*const REFERENCE_ATLAS_DATA = Object\.freeze\((\{.*?\})\);\s*\/\*__REFERENCE_ATLAS_END__\*\//s);
if (!atlasMatch) throw new Error('Embedded atlas block was not found.');
const atlas = JSON.parse(atlasMatch[1]);
const spineKeys = ['C0','C1','C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5'];
if (!spineKeys.every(key => atlas.bones[key])) throw new Error('Embedded atlas is missing a rendered spine bone.');
if (atlas.manifest.coverage?.all_requested_nonempty !== true || Object.keys(atlas.bones).length !== 31) throw new Error('Embedded atlas coverage failed.');
console.log(`atlas ${atlas.manifest.source.subject} bones ${Object.keys(atlas.bones).length} vertices ${atlas.manifest.totals.vertices} triangles ${atlas.manifest.totals.triangles}`);

const lowerMatch = html.match(/\/\*__LOWER_LIMB_ATLAS_START__\*\/\s*const LOWER_LIMB_ATLAS_DATA = Object\.freeze\((\{.*?\})\);\s*\/\*__LOWER_LIMB_ATLAS_END__\*\//s);
if (!lowerMatch) throw new Error('Embedded lower-limb atlas block was not found.');
const lower = JSON.parse(lowerMatch[1]);
if (lower.manifest.coverage?.complete !== true || Object.keys(lower.bones).length !== 32) throw new Error('Embedded lower-limb atlas coverage failed.');
if (lower.manifest.source?.distributionLegalReview?.requiredBeforeAppStoreOrPlayStoreDistribution !== true) throw new Error('Lower-limb store legal-review gate is missing.');
console.log(`lower-limb atlas objects ${Object.keys(lower.bones).length} vertices ${lower.manifest.totals.vertices} triangles ${lower.manifest.totals.triangles}`);
