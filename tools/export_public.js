#!/usr/bin/env node
'use strict';
// Exports the public open-source repository from this working tree.
//
// ALLOWLIST ONLY: a file is copied only if it matches an entry below, so internal material
// (model weights, sample radiographs, docs/ decision documents and abstracts, archive/,
// research data, deploy/private builds) can never leak by omission. The public single-file
// build is produced WITHOUT the neural weights (tools/build.js --no-model).
//
//   node tools/export_public.js <target-dir>
//
// The target directory must be empty or absent. Afterwards: cd <target-dir>, review,
// `git init`, commit, and push to the public remote.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: node tools/export_public.js <target-dir>'); process.exit(2); }
if (fs.existsSync(target) && fs.readdirSync(target).length) { console.error(`${target} is not empty`); process.exit(2); }

const ALLOW = [
  /^media\/[^/]+\.png$/,
  'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'CITATION.cff', 'SECURITY.md', 'TESTING_README.md',
  /^src\//,
  'tools/build.js', 'tools/export_public.js', 'tools/readme_screenshots.js',
  'ai-tools/README.md', 'ai-tools/embed_ai_assets.js', 'ai-tools/make_selftest_reference.js',
  /^ai-tools\/assets\/(dicom_radiograph|spine_ai_module|decode_reference|selftest_pattern)\.js$/,
  'ai-tools/assets/spec.json', 'ai-tools/assets/model_topology.json', 'ai-tools/assets/tf.min.js',
  /^ai-tools\/export\/(REPORT\.md|export_onnx\.py|run_reference\.py|validate_tfjs\.js|export_spec\.json)$/,
  /^ai-tools\/dicom-tests\/(test\.js|make_fixtures\.py|preview\.js)$/, /^ai-tools\/dicom-tests\/fixtures\/[^/]+\.(dcm|json|bin|rgb)$/,
  /^audit-tools\/[^/]+\.js$/, /^audit-tools\/fixtures\/[^/]+\.json$/,
  'deploy/DEPLOY.md', /^deploy\/htdocs\//, /^deploy\/tests\//, /^deploy\/tools\//,
  'deploy/private/.htaccess', 'deploy/private/config.sample.php',
];
const DENY = [/weights\.b64$/, /^samples\//, /^docs\//, /^archive\//, /spine_simulator\.html(\.sha256)?$/, /config\.php$/, /\.jpe?g$/i];

const rel = p => path.relative(root, p).split(path.sep).join('/');
const allowed = r => !DENY.some(d => d.test(r)) && ALLOW.some(a => (typeof a === 'string' ? a === r : a.test(r)));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return ['.git', 'node_modules'].includes(e.name) ? [] : walk(p);
  return [p];
});

const copied = [];
for (const file of walk(root)) {
  const r = rel(file);
  if (!allowed(r)) continue;
  const dest = path.join(target, r);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  copied.push(r);
}

// Development notes become public docs.
const notes = path.join(root, 'GUIDED_AUTO_LANDMARK_NOTES.md');
if (fs.existsSync(notes)) {
  fs.mkdirSync(path.join(target, 'docs'), { recursive: true });
  fs.copyFileSync(notes, path.join(target, 'docs', 'DEVELOPMENT_NOTES.md'));
  copied.push('docs/DEVELOPMENT_NOTES.md');
}

// Synthetic stand-ins for the internal sample films, under the file names the test suites
// use. They contain no patient data: two digital AP phantoms rendered from the CC BY 4.0
// TotalSegmentator-derived atlas and one schematic lateral drawn on a canvas.
const SYNTHETIC = { '1.jpg': 'synthetic_ap_a.jpg', '2.jpg': 'synthetic_lateral.jpg', '2-1.jpg': 'synthetic_ap_b.jpg' };
fs.mkdirSync(path.join(target, 'samples'), { recursive: true });
for (const [name, src] of Object.entries(SYNTHETIC)) {
  fs.copyFileSync(path.join(root, 'samples', 'synthetic', src), path.join(target, 'samples', name));
  copied.push(`samples/${name}`);
}
fs.writeFileSync(path.join(target, 'samples', 'README.md'), `# Sample films (synthetic)

These are **synthetic** images, not radiographs of any person. They exist so the test suites
and the imaging workflow can be exercised from a fresh clone.

| File | Content |
|---|---|
| \`1.jpg\` | Digital AP phantom rendered from the CT-derived reference atlas (TotalSegmentator, CC BY 4.0) posed into a scoliotic curve, with synthetic ribs and soft tissue |
| \`2.jpg\` | Schematic synthetic lateral (drawn vertebral blocks, sacrum and femoral head) |
| \`2-1.jpg\` | A second digital AP phantom |

Licence: CC BY 4.0 (derived from TotalSegmentator; see NOTICE). Measurements on these images say
nothing about performance on real radiographs.
`);
copied.push('samples/README.md');

// Public build without the neural weights.
fs.mkdirSync(path.join(target, 'dist'), { recursive: true });
const dist = path.join(target, 'dist', 'deformitysim.html');
execFileSync(process.execPath, [path.join(root, 'tools', 'build.js'), '--no-model', '--out', dist], { stdio: ['ignore', 'ignore', 'inherit'] });
const html = fs.readFileSync(dist);
const sha = crypto.createHash('sha256').update(html).digest('hex');
fs.writeFileSync(path.join(target, 'dist', 'SHA256SUMS.txt'), `${sha}  deformitysim.html\n`);
if (/spineAiWeights/.test(html.toString('utf8'))) throw new Error('public build unexpectedly contains model weights');

// The page links manifest.webmanifest and icon-180.png relative to itself when served over
// http(s). The PHP deploy has its own copies; give the GitHub Pages copy in dist/ a manifest
// whose start_url is the single file, plus the app icons.
for (const icon of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png']) {
  fs.copyFileSync(path.join(root, 'deploy', 'htdocs', icon), path.join(target, 'dist', icon));
}
const deployManifest = JSON.parse(fs.readFileSync(path.join(root, 'deploy', 'htdocs', 'manifest.webmanifest'), 'utf8'));
fs.writeFileSync(path.join(target, 'dist', 'manifest.webmanifest'), JSON.stringify({
  ...deployManifest, start_url: './deformitysim.html', scope: './', id: 'deformitysim'
}, null, 2) + '\n');

// GitHub Pages entry point.
fs.writeFileSync(path.join(target, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0; url=dist/deformitysim.html">
<title>DeformitySim</title></head>
<body><p><a href="dist/deformitysim.html">Open DeformitySim</a> (research and education use only).</p></body></html>
`);

fs.writeFileSync(path.join(target, '.gitattributes'), `# Sources are assembled byte-for-byte by tools/build.js: keep LF everywhere.
* text=auto eol=lf
*.dcm binary
*.bin binary
*.rgb binary
*.png binary
*.jpg binary
*.jpeg binary
*.tif binary
*.docx binary
*.pdf binary
`);
fs.writeFileSync(path.join(target, '.gitignore'), `# Neural model weights are not redistributable (see NOTICE)
ai-tools/assets/weights.b64
# Local full builds (may contain weights); the public build lives in dist/
/spine_simulator.html
deploy/private/spine_simulator.html
deploy/private/config.php
# Internal sample radiographs (unrecorded provenance) must never be committed
samples/
node_modules/
`);

console.log(JSON.stringify({ target, files: copied.length + 3, distBytes: html.length, distSha256: sha }, null, 2));
