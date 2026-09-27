/* Read-only static probe for a single-file DeformitySim build. */
'use strict';

const fs = require('fs');
const vm = require('vm');

const htmlPath = process.argv[2];
if (!htmlPath) throw new Error('Usage: node tools/v2_static_probe.js <html>');
const html = fs.readFileSync(htmlPath, 'utf8');
const lineAt = offset => html.slice(0, offset).split(/\r?\n/).length;

const allScriptMatches = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
const JS_TYPE = /^(?:|module|text\/javascript|application\/javascript|text\/ecmascript)$/i;
const scriptTypeOf = attrs => { const m = /\btype\s*=\s*(["'])(.*?)\1/i.exec(attrs || ''); return m ? m[2].trim() : ''; };
const dataScriptMatches = allScriptMatches.filter(match => !JS_TYPE.test(scriptTypeOf(match[1])));
const scriptMatches = allScriptMatches.filter(match => JS_TYPE.test(scriptTypeOf(match[1])));
console.log(`html chars=${html.length} lines=${lineAt(html.length)} scripts=${scriptMatches.length} data-blocks=${dataScriptMatches.length}`);
const failures = [];
dataScriptMatches.forEach((match, index) => {
  const type = scriptTypeOf(match[1]);
  const ok = /^application\/json$/i.test(type) ? (() => { try { JSON.parse(match[2]); return true; } catch { return false; } })()
    : /^application\/octet-stream$/i.test(type) ? /^[\sA-Za-z0-9+/=]*$/.test(match[2]) : false;
  console.log(`data block ${index + 1}: line=${lineAt(match.index)} chars=${match[2].length} type=${type} ${ok ? 'ok' : 'FAIL'}`);
  if (!ok) failures.push(`data block ${index + 1} (${type}) is not valid JSON/base64`);
});
scriptMatches.forEach((match, index) => {
  try {
    new vm.Script(match[2], { filename: `inline-${index + 1}.js` });
    console.log(`script ${index + 1}: line=${lineAt(match.index)} chars=${match[2].length} parse=ok attrs=${match[1].trim() || '-'}`);
  } catch (error) {
    console.log(`script ${index + 1}: line=${lineAt(match.index)} parse=FAIL ${error.message}`);
    failures.push(`inline script ${index + 1} does not parse: ${error.message}`);
  }
});

const markupOnly = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
for (const tag of ['html', 'head', 'body', 'dialog', 'form', 'main']) {
  const open = (markupOnly.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) || []).length;
  const close = (markupOnly.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
  console.log(`tag ${tag}: ${open}/${close}`);
  if (open !== close) failures.push(`<${tag}> is unbalanced (${open} open, ${close} close)`);
}

const idMatches = [...markupOnly.matchAll(/\sid=(["'])(.*?)\1/g)];
const ids = idMatches.map(match => match[2]);
const idSet = new Set(ids);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
console.log(`ids=${ids.length} unique=${idSet.size} duplicates=${duplicateIds.length} ${duplicateIds.join(',')}`);
if (duplicateIds.length) failures.push(`duplicate static ids: ${duplicateIds.join(', ')}`);

// A handful of responsive controls are intentionally constructed by script.
// Include only literal dynamic assignments/templates so truly missing bindings
// still fail the probe.
const dynamicIdSet = new Set();
for (const scriptMatch of scriptMatches) {
  for (const match of scriptMatch[2].matchAll(/\bid\s*=\s*(['"])([^'"]+)\1/g)) {
    dynamicIdSet.add(match[2]);
  }
  for (const match of scriptMatch[2].matchAll(/\bid=(["'])([^"'<>]+)\1/g)) {
    dynamicIdSet.add(match[2]);
  }
}

const refs = new Map();
const refPatterns = [
  ['getElementById', /document\.getElementById\(\s*(['"])([^'"]+)\1\s*\)/g],
  ['byId', /\bbyId\(\s*(['"])([^'"]+)\1\s*\)/g],
  ['$', /\$\(\s*(['"])([^'"]+)\1\s*\)/g]
];
// Third-party runtimes (three.js, TensorFlow.js) use `$(...)` as an ordinary
// minified identifier; they are parsed above but not scanned for DOM bindings.
const THIRD_PARTY_RUNTIME = /\sid="spine-(three|tfjs)-runtime"/;
scriptMatches.forEach((scriptMatch, scriptIndex) => {
  if (THIRD_PARTY_RUNTIME.test(scriptMatch[1] || '')) return;
  for (const [kind, pattern] of refPatterns) {
    for (const match of scriptMatch[2].matchAll(pattern)) {
      const id = match[2];
      if (!refs.has(id)) refs.set(id, []);
      refs.get(id).push({ kind, script: scriptIndex + 1, line: lineAt(scriptMatch.index + match.index) });
    }
  }
});
const missingRefs = [...refs.entries()].filter(([id]) => !idSet.has(id) && !dynamicIdSet.has(id));
console.log(`literal-id-refs=${refs.size} missing=${missingRefs.length}`);
missingRefs.forEach(([id, locations]) => console.log(`  MISSING ${id}: ${locations.map(item => `${item.kind}@${item.line}`).join(', ')}`));
if (missingRefs.length) failures.push(`missing literal id bindings: ${missingRefs.map(([id]) => id).join(', ')}`);

const mojibakeTokens = ['â€', 'â€“', 'â€”', 'âˆ', 'Â°', 'Â·', 'Â', 'ï¿½', '\uFFFD'];
for (const token of mojibakeTokens) {
  let count = 0;
  let start = 0;
  while ((start = html.indexOf(token, start)) >= 0) {
    count += 1;
    start += token.length;
  }
  if (count) {
    console.log(`mojibake ${JSON.stringify(token)}=${count}`);
    failures.push(`mojibake token ${JSON.stringify(token)} appears ${count} time(s)`);
  }
}

const dangerousPatterns = [
  ['innerHTML', /\.innerHTML\s*=/g],
  ['insertAdjacentHTML', /\.insertAdjacentHTML\s*\(/g],
  ['eval', /\beval\s*\(/g],
  ['Function ctor', /\bnew\s+Function\s*\(/g],
  ['document.write', /\bdocument\.write\s*\(/g],
  ['localStorage', /\blocalStorage\b/g],
  ['sessionStorage', /\bsessionStorage\b/g],
  ['fetch', /\bfetch\s*\(/g],
  ['XHR', /\bXMLHttpRequest\b/g],
  ['WebSocket', /\bWebSocket\b/g],
  ['postMessage', /\bpostMessage\s*\(/g],
  ['objectURL', /\bURL\.createObjectURL\s*\(/g]
];
for (const [label, pattern] of dangerousPatterns) {
  const hits = [...html.matchAll(pattern)];
  if (hits.length) console.log(`${label}=${hits.length} lines=${hits.slice(0, 30).map(hit => lineAt(hit.index)).join(',')}`);
}

const inlineHandlers = [...markupOnly.matchAll(/\son[a-z]+\s*=/gi)];
console.log(`inline-event-handlers=${inlineHandlers.length}`);
if (inlineHandlers.length) failures.push(`${inlineHandlers.length} inline event handler(s) violate the nonce-only CSP`);

const labelsFor = [...markupOnly.matchAll(/<label\b[^>]*\bfor=(["'])(.*?)\1[^>]*>/gi)].map(match => match[2]);
const missingLabelTargets = [...new Set(labelsFor.filter(id => !idSet.has(id)))];
console.log(`labels=${labelsFor.length} missing-targets=${missingLabelTargets.length} ${missingLabelTargets.join(',')}`);
if (missingLabelTargets.length) failures.push(`labels target missing ids: ${missingLabelTargets.join(', ')}`);

const attrsToCheck = ['aria-labelledby', 'aria-describedby', 'aria-controls'];
for (const attr of attrsToCheck) {
  const targets = [];
  const pattern = new RegExp(`\\s${attr}=(["'])(.*?)\\1`, 'gi');
  for (const match of markupOnly.matchAll(pattern)) {
    for (const id of match[2].trim().split(/\s+/)) if (id) targets.push(id);
  }
  const missing = [...new Set(targets.filter(id => !idSet.has(id)))];
  console.log(`${attr}=${targets.length} missing=${missing.length} ${missing.join(',')}`);
  if (missing.length) failures.push(`${attr} targets missing ids: ${missing.join(', ')}`);
}

if (failures.length) {
  throw new Error(`Static probe failed:\n- ${failures.join('\n- ')}`);
}
