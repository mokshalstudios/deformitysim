#!/usr/bin/env node
'use strict';
// Assembles spine_simulator.html from src/.
//
// src/manifest.json lists the fragments in document order. Each fragment is a
// verbatim slice of the single-file application; concatenating them yields the
// stripped HTML (no imaging asset block). Lines of the form
//   /*@@INCLUDE data/<name>@@*/
// are replaced by the named file (the large quantized atlas payloads, kept out
// of the editable sources). The imaging assets (DICOM decoder, TF.js runtime,
// neural model) are then embedded by ai-tools/embed_ai_assets.js.
//
// Usage:
//   node tools/build.js                      # full build -> spine_simulator.html
//   node tools/build.js --no-model           # DICOM decoder only, no neural weights (~3.9 MB)
//   node tools/build.js --strip              # no imaging assets at all
//   node tools/build.js --out path/file.html # write somewhere else
//   node tools/build.js --sync-deploy        # also copy to deploy/private/spine_simulator.html

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const outIndex = args.indexOf('--out');
const outPath = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(root, 'spine_simulator.html'));
const mode = flag('--strip') ? '--strip' : flag('--no-model') ? '--no-model' : null;

const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
const INCLUDE = /^[ \t]*\/\*@@INCLUDE ([\w./-]+)@@\*\/[ \t]*$/;

let html = '';
for (const fragment of manifest.fragments) {
  const text = fs.readFileSync(path.join(srcDir, fragment), 'utf8');
  if (!text.endsWith('\n')) throw new Error(`${fragment} must end with a newline.`);
  const lines = text.slice(0, -1).split('\n').map(line => {
    const match = INCLUDE.exec(line);
    if (!match) return line;
    const data = fs.readFileSync(path.join(srcDir, match[1]), 'utf8');
    if (data.includes('\n')) throw new Error(`${match[1]} must be a single line.`);
    return data;
  });
  html += lines.join('\n') + '\n';
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
const embedArgs = [path.join(root, 'ai-tools', 'embed_ai_assets.js'), outPath];
if (mode) embedArgs.push(mode);
execFileSync(process.execPath, embedArgs, { stdio: ['ignore', 'ignore', 'inherit'] });

const built = fs.readFileSync(outPath);
const sha256 = crypto.createHash('sha256').update(built).digest('hex');
if (flag('--sync-deploy')) {
  fs.copyFileSync(outPath, path.join(root, 'deploy', 'private', 'spine_simulator.html'));
  fs.writeFileSync(path.join(root, 'deploy', 'private', 'spine_simulator.html.sha256'), `${sha256}\n`);
}
console.log(JSON.stringify({
  out: outPath,
  mode: mode ? mode.slice(2) : 'full',
  bytes: built.length,
  megabytes: Number((built.length / 1048576).toFixed(2)),
  sha256,
  syncedDeploy: flag('--sync-deploy')
}, null, 2));
