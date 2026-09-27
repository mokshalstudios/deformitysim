#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(file)) {
  throw new Error('Usage: node tools/interaction_harness.js <spine_simulator.html>');
}

const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const source = scripts.find(script =>
  script.includes('window.__SPINE_AUTOCAL__')
  && script.includes('function analyzeLateral')
);
if (!source) throw new Error('Automatic-landmark module was not found.');

const results = [];
const check = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  results.push(label);
};
const between = (start, end, label) => {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`${label} source block was not found.`);
  return source.slice(first, last);
};

// Execute the shipped sign helpers rather than restating their arithmetic in
// the test. Mirrored fixtures must preserve the clinical sign, while an
// undeclared lateral orientation must fail closed.
const angleSource = between(
  'const normalizeAngle = angle => {',
  'const confidenceLevel =',
  'signed-angle'
);
const angles = new Function(
  `${angleSource}\nreturn { normalizeAngle, angleDifference, explicitLateralOrientation, anteriorDownTilt, signedLordosis, signedKyphosis, signedCervicalAngle, signedPelvicTilt, pelvicIncidence };`
)();
// Endplate image angles are derived from geometry, not restated from the
// formula. Endplates lie along radii of the local curvature, so a segment
// bending through `bend` degrees about a centre of curvature on the posterior
// side is lordotic (it bulges anteriorly). Image y grows downward; `anterior`
// is the image side the patient faces. The old assertions here expected
// (c2 -10, c7 +10, anterior-left) to be +20 lordosis, but that configuration
// converges anteriorly - it is kyphosis - so they locked in an inverted sign.
const deg = rad => rad * 180 / Math.PI;
const arcEndplates = (bend, lordotic, anterior) => {
  // Posterior direction in image x, and the side the centre of curvature is on.
  const posterior = anterior === 'left' ? 1 : -1;
  const centreSide = lordotic ? posterior : -posterior;
  // Radius from the centre of curvature toward the spine at polar angle phi.
  const endplate = phi => angles.normalizeAngle(deg(Math.atan2(Math.sin(phi), -centreSide * Math.cos(phi))));
  const half = bend * Math.PI / 360;
  // Upper endplate at -half (higher on the image), lower at +half.
  return { upper: endplate(-half), lower: endplate(half) };
};
const near = (a, b, tol = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= tol;
['left', 'right'].forEach(anterior => {
  const lordotic = arcEndplates(20, true, anterior);
  const kyphotic = arcEndplates(20, false, anterior);
  check(near(angles.signedCervicalAngle(lordotic.upper, lordotic.lower, anterior), 20),
    `anterior-${anterior} lordotic cervical arc gives +20 (positive = lordosis, as the CL slider)`);
  check(near(angles.signedCervicalAngle(kyphotic.upper, kyphotic.lower, anterior), -20),
    `anterior-${anterior} kyphotic cervical arc gives -20`);
  check(near(angles.signedLordosis(kyphotic.upper, kyphotic.lower, anterior), -20)
      && near(angles.signedKyphosis(kyphotic.upper, kyphotic.lower, anterior), 20)
      && near(angles.signedKyphosis(lordotic.upper, lordotic.lower, anterior), -20),
    `anterior-${anterior} lumbar kyphosis and thoracic lordosis keep their negative sign`);
});
check(angles.signedCervicalAngle(10, -10, 'left') === 20
    && angles.signedCervicalAngle(-10, 10, 'right') === 20,
  'left-anterior lordosis (endplates converging posteriorly) remains positive when mirrored');
check(angles.signedCervicalAngle(-10, 10, 'left') === -20
    && angles.signedCervicalAngle(10, -10, 'right') === -20,
  'mirrored kyphosis remains negative');
check(angles.signedCervicalAngle(-10, 10, 'auto') === null
    && angles.signedCervicalAngle(Number.NaN, 10, 'left') === null
    && angles.signedLordosis(-10, 10, 'auto') === null
    && angles.signedKyphosis(-10, 10, undefined) === null,
  'signed sagittal output is withheld without valid orientation/angles');
check(angles.normalizeAngle(100) === -80 && angles.normalizeAngle(-100) === 80,
  'endplate angles normalize into the declared axial range');
check(angles.angleDifference(50, -50) === 100 && angles.angleDifference(-55, 55) === 110
    && angles.angleDifference(179, 1) === 2 && angles.angleDifference(20, 20) === 0,
  'Cobb angles above 90 degrees are not folded and line direction does not matter');
// Pelvic geometry: S1 plate with a 42 degree anterior-down slope and the
// femoral-head axis 15 degrees anterior of vertical below its midpoint.
['left', 'right'].forEach(anterior => {
  const forward = anterior === 'left' ? -1 : 1;
  const mid = { x: 200, y: 300 };
  const ss = 42 * Math.PI / 180;
  const s1Anterior = { x: mid.x + forward * 30 * Math.cos(ss), y: mid.y + 30 * Math.sin(ss) };
  const s1Posterior = { x: mid.x - forward * 30 * Math.cos(ss), y: mid.y - 30 * Math.sin(ss) };
  [15, -8].forEach(pt => {
    const tilt = pt * Math.PI / 180;
    const hip = { x: mid.x + forward * 120 * Math.sin(tilt), y: mid.y + 120 * Math.cos(tilt) };
    const signedPt = angles.signedPelvicTilt(hip, mid, anterior);
    const pi = angles.pelvicIncidence(s1Anterior, s1Posterior, hip);
    const slope = angles.anteriorDownTilt(deg(Math.atan2(s1Posterior.y - s1Anterior.y, s1Posterior.x - s1Anterior.x)), anterior);
    check(near(signedPt, pt, 1e-9) && near(slope, 42, 1e-9) && near(pi, pt + 42, 1e-9),
      `anterior-${anterior} PT ${pt} keeps its sign and PI = PT + SS holds`);
  });
});
check(angles.signedPelvicTilt({ x: 190, y: 400 }, { x: 200, y: 300 }, 'auto') === null
    && angles.signedPelvicTilt({ x: 190, y: 250 }, { x: 200, y: 300 }, 'left') === null,
  'pelvic tilt is withheld without an orientation or with the hip above the sacral plate');

// Exercise the exact metadata parser on bounded synthetic headers. The decoder
// uses these dimensions before allocating a bitmap, which is the protection
// against oversized compressed-image input.
// rasterFromFile gained an options argument (model-input rendering) in the
// 2026-08-23 build; accept either signature as the end anchor.
const rasterFromFileAnchor = source.includes('async function rasterFromFile(file, options){')
  ? 'async function rasterFromFile(file, options){'
  : 'async function rasterFromFile(file){';
const metadataSource = between(
  'const RASTER_LIMITS = Object.freeze({',
  rasterFromFileAnchor,
  'raster-metadata'
);
const metadata = new Function(
  `${metadataSource}\nreturn { RASTER_LIMITS, readRasterDimensions };`
)();
const blob = (bytes, type = 'application/octet-stream') => new Blob([Uint8Array.from(bytes)], { type });
const writeU32BE = (bytes, offset, value) => {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
};
const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
png.set([0x49, 0x48, 0x44, 0x52], 12);
writeU32BE(png, 16, 4096);
writeU32BE(png, 20, 2048);

const jpeg = [
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
  0x01, 0x23, 0x04, 0x56, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9
];
const webp = new Uint8Array(30);
webp.set([...Buffer.from('RIFF')], 0);
webp.set([...Buffer.from('WEBP')], 8);
webp.set([...Buffer.from('VP8X')], 12);
webp.set([10, 0, 0, 0], 16);
const webpWidthMinusOne = 1919;
const webpHeightMinusOne = 1079;
webp.set([
  webpWidthMinusOne & 255,
  (webpWidthMinusOne >>> 8) & 255,
  (webpWidthMinusOne >>> 16) & 255
], 24);
webp.set([
  webpHeightMinusOne & 255,
  (webpHeightMinusOne >>> 8) & 255,
  (webpHeightMinusOne >>> 16) & 255
], 27);

(async () => {
  const pngResult = await metadata.readRasterDimensions(blob(png, 'image/png'));
  const jpegResult = await metadata.readRasterDimensions(blob(jpeg, 'image/jpeg'));
  const webpResult = await metadata.readRasterDimensions(blob(webp, 'image/webp'));
  check(pngResult.width === 4096 && pngResult.height === 2048 && pngResult.format === 'png',
    'PNG metadata dimensions parse correctly');
  check(jpegResult.width === 0x456 && jpegResult.height === 0x123 && jpegResult.format === 'jpeg',
    'JPEG SOF dimensions parse correctly');
  check(webpResult.width === 1920 && webpResult.height === 1080 && webpResult.format === 'webp',
    'WebP extended dimensions parse correctly');

  let rejected = false;
  try {
    await metadata.readRasterDimensions(blob([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  } catch (_) {
    rejected = true;
  }
  check(rejected, 'unrecognized raster metadata is rejected');
  check(metadata.RASTER_LIMITS.maxFileBytes === 64 * 1024 * 1024
      && metadata.RASTER_LIMITS.maxSourcePixels === 80000000
      && metadata.RASTER_LIMITS.maxDecodeWidth <= 2048
      && metadata.RASTER_LIMITS.maxDecodeHeight <= 3072,
    'raster file/source/decode budgets remain bounded');

  const requiredFragments = [
    'imagingGeneration: 0',
    'generation === resultState.imagingGeneration',
    'currentImagingFile(kind) === file',
    'standingFilesMatch(stagedFiles)',
    'activeRunGeneration===generation',
    'createImageBitmap(file, {',
    "resizeQuality: 'high'",
    "typeof bitmap.close === 'function'",
    'resultState.drag.plane !== plane',
    "canvas.addEventListener('pointercancel', onPointerUp);",
    "clearSession:clearImagingCalibrationSession",
    "__SPINE_AUTOCAL__?.clearSession?.('Local files and beta results cleared.')"
  ];
  check(requiredFragments.every(fragment => html.includes(fragment)),
    'imaging ownership, bounded decode, editor cleanup, and programmatic clear guards are present');
  check(!html.includes('Reducing pelvic tilt moves these toward the control cohort.')
      && html.includes('not a causal treatment response or patient-specific prediction'),
    'gait display no longer claims a causal treatment response');
  check(html.includes('Choose orientation — signed LL/TK/CL, PT and SVA withheld')
      && !html.includes('<option value="auto">Auto / standard display</option>'),
    'automatic orientation fails closed in the visible control');

  console.log(JSON.stringify({
    file,
    assertions: results.length,
    passed: true,
    checks: results
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
