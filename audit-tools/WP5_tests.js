/* eslint-disable no-console */
'use strict';
// WP5 regression tests: app shell, 3D view, case history and case files,
// validation cues, layout and legibility, and the open-source alpha versioning.
//
//   node audit-tools/WP5_tests.js <build.html>
//
// Drives a built spine_simulator.html in real Chrome through audit-tools/cdp.js,
// with real key and mouse input where the finding was about input handling.
// Exit code 0 only when every check passes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, fileUrl, sleep } = require('./cdp.js');

const build = path.resolve(process.argv[2] || path.join(__dirname, '..', 'spine_simulator.html'));
const results = [];
const notes = [];
const check = (ok, label, detail = '') => results.push({ ok: Boolean(ok), label, detail: ok ? '' : String(detail) });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp5-'));

const addProcedureSource = (levelId, procedureId, angle) => `(() => {
  const lv = document.getElementById('levelSelect'); lv.value = ${JSON.stringify(levelId)}; lv.dispatchEvent(new Event('change', { bubbles: true }));
  const pr = document.getElementById('procedureSelect'); pr.value = ${JSON.stringify(procedureId)}; pr.dispatchEvent(new Event('change', { bubbles: true }));
  const ci = document.getElementById('correctionInput');
  if (${JSON.stringify(angle)} !== null) { ci.value = ${JSON.stringify(String(angle))}; ci.dispatchEvent(new Event('input', { bubbles: true })); }
  document.getElementById('procedureForm').requestSubmit();
  return { error: document.getElementById('procedureError').textContent, count: window.__SPINE_TEST__.getState().itinerary.length };
})()`;

async function openApp(browser, { width = 1440, height = 900, mobile = false } = {}) {
  const page = await browser.open(fileUrl(build), { width, height });
  if (mobile) await page.setViewport(width, height, { mobile: true });
  await page.unlock();
  await sleep(500);
  try { await page.clickSelector('#introExplore'); } catch (_) { /* intro already dismissed */ }
  await sleep(700);
  return page;
}

// Ctrl/Cmd-free select-all + replace for a focused field, with real key input.
async function retype(page, selector, text) {
  await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); el.focus(); return true; })()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await page.key('Backspace', 'Backspace', 8);
  for (const character of text) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: character, text: character, unmodifiedText: character });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: character });
  }
  await sleep(60);
}

async function versionAndGateFlow(browser) {
  const page = await openApp(browser);
  const info = await page.eval(`(() => {
    const T = window.__SPINE_TEST__;
    return {
      version: T.MODEL_MANIFEST.modelVersion, buildId: T.MODEL_MANIFEST.buildId,
      selfTest: T.MODEL_SELF_TEST && (T.MODEL_SELF_TEST.passed ?? T.MODEL_SELF_TEST.status),
      gate: window.__SPINE_GATE__ ? { enabled: window.__SPINE_GATE__.enabled, unlocked: window.__SPINE_GATE__.isUnlocked() } : null,
      gateDialog: Boolean(document.getElementById('launchGate')),
      locked: document.body.dataset.locked || null,
      introVersion: document.getElementById('introVersion')?.textContent,
      introBuild: document.getElementById('introBuild')?.textContent,
      introBadge: document.querySelector('.intro-version .build-badge')?.textContent.trim(),
      headerBadge: document.getElementById('buildBadge')?.textContent.trim(),
      modelCard: document.getElementById('modelCardVersion')?.textContent
    };
  })()`);
  check(info.version === '0.23.0' && info.buildId === 'alpha-2026-09-27.1', 'model version 0.23.0 and build alpha-2026-09-27.1', JSON.stringify(info));
  check(info.introVersion === 'v0.23.0' && info.introBuild === 'alpha-2026-09-27.1' && info.introBadge === 'Alpha' && info.headerBadge === 'Alpha' && info.modelCard === 'v0.23.0',
    'intro, header and model card show the Alpha build label', JSON.stringify(info));
  check(info.gate && info.gate.enabled === false && info.gate.unlocked === true && !info.gateDialog && !info.locked,
    'the launch-code gate is disabled by default and its dialog is removed', JSON.stringify(info));
  const html = fs.readFileSync(build, 'utf8');
  check(/var LAUNCH_GATE_ENABLED = false;/.test(html) && html.includes('var unlocked = readStored() === CODE_DIGEST;'),
    'the gate code path stays behind the LAUNCH_GATE_ENABLED const, with the server binding line unchanged');
  check(!html.includes('CL shortfall') && html.includes('CL below T1S-based target'), 'construct evaluation says "CL below T1S-based target"');
  check(page.errors.length === 0, 'no page errors on load', page.errors.join(' | '));
  await page.close();
}

async function historyAndConfirmFlow(browser) {
  const page = await openApp(browser);
  const T = 'window.__SPINE_TEST__';
  await page.eval(`(() => { const s = document.getElementById('measuredSvaInput'); s.value = '4.2'; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const add1 = await page.eval(addProcedureSource('L4-L5', 'alif', 12));
  const add2 = await page.eval(addProcedureSource('L3-L4', 'xlif', null));
  check(add1.count === 1 && add2.count === 2, 'two procedures added for the history checks', JSON.stringify([add1, add2]));
  const before = await page.eval(`${T}.getCaseHistory()`);
  // Reset asks first when there is something to lose (F094).
  await page.eval(`(() => { document.querySelector('.panel-tab[data-tab="library"]')?.click(); return true; })()`);
  await page.clickSelector('#resetScenario');
  await sleep(200);
  const dialog = await page.eval(`(() => { const d = document.getElementById('confirmCaseDialog'); return { open: d.open, heading: document.getElementById('confirmCaseHeading').textContent, message: document.getElementById('confirmCaseMessage').textContent }; })()`);
  check(dialog.open && /2 procedures/.test(dialog.message), 'Reset with procedures opens a confirmation naming what will be cleared', JSON.stringify(dialog));
  await page.clickSelector('#confirmCaseCancel');
  await sleep(200);
  const kept = await page.eval(`${T}.getState()`);
  check(kept.itinerary.length === 2 && kept.params.measuredSva === 4.2, 'cancelling keeps the case unchanged', JSON.stringify({ n: kept.itinerary.length, sva: kept.params.measuredSva }));
  await page.clickSelector('#resetScenario');
  await sleep(200);
  await page.clickSelector('#confirmCaseAccept');
  await sleep(300);
  const reset = await page.eval(`${T}.getState()`);
  const toast = await page.eval(`(() => ({ text: document.getElementById('toast').textContent, action: Boolean(document.querySelector('#toast .toast-action')) }))()`);
  check(reset.itinerary.length === 0 && reset.params.measuredSva === null && toast.action, 'confirming resets, and the toast offers Undo', JSON.stringify({ n: reset.itinerary.length, toast }));
  // Undo with the keyboard shortcut (focus outside text fields).
  await page.eval(`(() => { document.activeElement?.blur(); return true; })()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(300);
  const undone = await page.eval(`${T}.getState()`);
  check(undone.itinerary.length === 2 && undone.params.measuredSva === 4.2
      && undone.itinerary[0].plannedAngle === 12 && undone.itinerary[0].implantPlan?.schemaVersion,
    'Ctrl+Z restores the replaced case with its procedures and implant snapshots', JSON.stringify({ n: undone.itinerary.length, sva: undone.params.measuredSva }));
  const itemsRendered = await page.eval(`document.querySelectorAll('#itineraryList .procedure-card').length`);
  check(itemsRendered === 2, 'the restored itinerary is rendered', itemsRendered);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 10 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 10 });
  await sleep(300);
  const redone = await page.eval(`${T}.getState()`);
  check(redone.itinerary.length === 0, 'Ctrl+Shift+Z redoes the reset', redone.itinerary.length);
  // Removing a procedure is undoable from the toast.
  await page.eval(`${T}.undoCaseEdit()`);
  await sleep(200);
  await page.eval(`document.querySelector('#itineraryList .remove-button').click()`);
  await sleep(200);
  const removed = await page.eval(`${T}.getState().itinerary.length`);
  await page.eval(`document.querySelector('#toast .toast-action').click()`);
  await sleep(250);
  const restored = await page.eval(`${T}.getState().itinerary.length`);
  check(removed === 1 && restored === 2, 'a removed procedure comes back with the toast Undo', JSON.stringify({ removed, restored }));
  // A slider drag is one undo step.
  await page.eval(`(() => { const s = document.getElementById('llSlider'); for (const v of [50, 52, 54, 56]) { s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); } return true; })()`);
  await sleep(900);
  const afterDrag = await page.eval(`${T}.getCaseHistory()`);
  await page.eval(`${T}.undoCaseEdit()`);
  await sleep(200);
  const llBack = await page.eval(`${T}.getState().params.ll`);
  check(llBack === 48 && afterDrag.undo >= 1, 'a slider drag is coalesced into a single undo step', JSON.stringify({ llBack, afterDrag, before }));
  const buttons = await page.eval(`({ undo: document.getElementById('undoCase').disabled, redo: document.getElementById('redoCase').disabled, undoTitle: document.getElementById('undoCase').title })`);
  check(buttons.undo === false && buttons.redo === false && /Ctrl\+Z/.test(buttons.undoTitle), 'header undo/redo buttons reflect the history', JSON.stringify(buttons));
  check(page.errors.length === 0, 'no page errors in the history flow', page.errors.join(' | '));
  await page.close();
}

async function caseFileFlow(browser) {
  const page = await openApp(browser);
  const T = 'window.__SPINE_TEST__';
  await page.eval(`(() => {
    window.__wp5Blobs = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__wp5Blobs.push(blob); return create(blob); };
    window.__wp5Downloads = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__wp5Downloads.push(this.download); return; } return click.call(this); };
    return true;
  })()`);
  await page.eval(`${T}.applyCaseExample('degenerative-scoliosis')`);
  await page.eval(addProcedureSource('L4-L5', 'alif', 10));
  await page.eval(addProcedureSource('L3-L4', 'xlif', null));
  await page.eval(`(() => { const a = document.getElementById('ageInput'); a.value = '67'; a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const saved = await page.eval(`${T}.getState()`);
  await page.clickSelector('#caseFileButton');
  await sleep(150);
  await page.clickSelector('#saveCaseButton');
  await sleep(200);
  const download = await page.eval(`(async () => {
    const blob = window.__wp5Blobs[window.__wp5Blobs.length - 1];
    const text = blob ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(blob); }) : null;
    return { name: window.__wp5Downloads[window.__wp5Downloads.length - 1], type: blob && blob.type, text };
  })()`);
  let file = null;
  try { file = JSON.parse(download.text); } catch (_) { /* reported below */ }
  check(file && download.type === 'application/json' && /^spine-case-\d{8}-\d{4}\.json$/.test(download.name || ''),
    'Save downloads a versioned JSON case file through a Blob link', JSON.stringify({ name: download.name, type: download.type }));
  check(file && file.schema === 'deformitysim.case' && file.schemaVersion === 1 && file.app.modelVersion === '0.23.0'
      && file.app.buildId === 'alpha-2026-09-27.1' && file.case.itinerary.length === 2 && file.case.demographics.ageYears === 67,
    'the case file carries schema, version, model build, procedures and assumptions', download.text && download.text.slice(0, 300));
  check(file && !('patientImaging' in file.case) && !/\.(jpe?g|png|dcm|dicom|webp)\b/i.test(JSON.stringify(file.case)) && !/fileName|pixels|dataUrl|blob:/i.test(JSON.stringify(file.case)),
    'the case file holds no imaging state, pixels or file names');
  fs.writeFileSync(path.join(tmpDir, 'case.json'), download.text || '');
  // Replace the case, then open the saved file through the picker.
  await page.eval(`${T}.applyCaseExample('neutral-reference')`);
  await page.clickSelector('#caseFileButton');
  await page.setFiles('#caseFileInput', [path.join(tmpDir, 'case.json')]);
  await sleep(500);
  const confirmOpen = await page.eval(`document.getElementById('confirmCaseDialog').open`);
  if (confirmOpen) { await page.clickSelector('#confirmCaseAccept'); await sleep(400); }
  const loaded = await page.eval(`${T}.getState()`);
  const same = JSON.stringify([loaded.params, loaded.globalDeformity, loaded.levelFactors, loaded.itinerary.map(i => [i.levelId, i.procedureId, i.plannedAngle, i.plannedCoronal, i.implantPlan?.constructVariant])])
    === JSON.stringify([saved.params, saved.globalDeformity, saved.levelFactors, saved.itinerary.map(i => [i.levelId, i.procedureId, i.plannedAngle, i.plannedCoronal, i.implantPlan?.constructVariant])]);
  check(same && loaded.caseContext.exampleId === 'degenerative-scoliosis',
    'opening the saved file restores parameters, geometry and procedures exactly', JSON.stringify({ loadedN: loaded.itinerary.length, savedN: saved.itinerary.length }));
  const age = await page.eval(`({ value: document.getElementById('ageInput').value, ref: document.getElementById('ageReference').textContent })`);
  check(age.value === '67' && /65–74/.test(age.ref), 'the optional age round-trips and its reference group is shown', JSON.stringify(age));
  // Drag-and-drop onto the workspace.
  await page.eval(`${T}.applyCaseExample('neutral-reference')`);
  const dropped = await page.eval(`(async () => {
    const text = ${JSON.stringify(download.text || '')};
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'dropped-case.json', { type: 'application/json' }));
    const target = document.getElementById('patientParameters');
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    target.dispatchEvent(drop);
    await new Promise(r => setTimeout(r, 400));
    const d = document.getElementById('confirmCaseDialog');
    if (d.open) { document.getElementById('confirmCaseAccept').click(); await new Promise(r => setTimeout(r, 400)); }
    return { prevented: drop.defaultPrevented, n: window.__SPINE_TEST__.getState().itinerary.length };
  })()`);
  check(dropped.prevented && dropped.n === 2, 'dropping a .json case file on the workspace opens it', JSON.stringify(dropped));
  // Validation: schema, version and domain.
  const bad = await page.eval(`(() => {
    const T = window.__SPINE_TEST__;
    const good = JSON.parse(${JSON.stringify(download.text || '{}')});
    const variant = mutate => { const copy = JSON.parse(JSON.stringify(good)); mutate(copy); return JSON.stringify(copy); };
    return {
      notJson: T.parseCaseFile('{oops'),
      schema: T.parseCaseFile(variant(c => { c.schema = 'something-else'; })),
      future: T.parseCaseFile(variant(c => { c.schemaVersion = 99; })),
      pi: T.parseCaseFile(variant(c => { c.case.params.pi = 500; })),
      procedure: T.parseCaseFile(variant(c => { c.case.itinerary[0].procedureId = 'teleport'; })),
      angle: T.parseCaseFile(variant(c => { c.case.itinerary[0].plannedAngle = 90; })),
      duplicate: T.parseCaseFile(variant(c => { c.case.itinerary.push({ ...c.case.itinerary[0], id: 99 }); })),
      implant: T.parseCaseFile(variant(c => { c.case.itinerary[0].implantPlan.components[0].dimensionsMm.ap = 999; })),
      injected: T.parseCaseFile(variant(c => { c.case.caseContext = { exampleId: '<img src=x>', label: '<b>x</b>' }; })),
      oldModel: T.parseCaseFile(variant(c => { c.app.modelVersion = '0.22.0'; }))
    };
  })()`);
  check(!bad.notJson.ok && !bad.schema.ok && !bad.future.ok && /newer build|version 99/.test(bad.future.errors.join(' '))
      && !bad.pi.ok && !bad.procedure.ok && !bad.angle.ok && !bad.duplicate.ok,
    'invalid, foreign, future-version and out-of-domain case files are refused with a reason', JSON.stringify(Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, v.ok ? 'ok' : v.errors[0]]))));
  check(bad.implant.ok && bad.implant.warnings.some(w => /implant sizes could not be verified/.test(w))
      && bad.implant.snapshot.itinerary[0].implantPlan.components.every(c => c.dimensionsMm.ap !== 999),
    'unverifiable implant sizes fall back to the listed default with a warning', JSON.stringify(bad.implant.warnings));
  check(bad.injected.ok && bad.injected.snapshot.caseContext.exampleId === null && bad.injected.snapshot.caseContext.label === null,
    'an unknown example context from a file is dropped, never rendered');
  check(bad.oldModel.ok && bad.oldModel.warnings.some(w => /v0\.22\.0/.test(w)), 'a file from an older model loads with a recompute warning', JSON.stringify(bad.oldModel.warnings));
  // Copy case summary.
  await page.clickSelector('#caseFileButton');
  await sleep(120);
  await page.clickSelector('#copyCaseSummaryButton');
  await sleep(300);
  const summary = await page.eval(`({ open: document.getElementById('caseSummaryDialog').open, text: document.getElementById('caseSummaryText').value })`);
  check(summary.open && /case summary/.test(summary.text) && /Procedures \(2\)/.test(summary.text) && /Not a surgical plan/.test(summary.text)
      && /TK \(T4–T12\)/.test(summary.text) && !/\.(jpe?g|png|dcm)\b/i.test(summary.text),
    'Copy case summary produces plain text with inputs, procedures, modeled output and the research framing', summary.text.slice(0, 400));
  await page.eval(`document.getElementById('closeCaseSummary').click()`);
  check(page.errors.length === 0, 'no page errors in the case-file flow', page.errors.join(' | '));
  await page.close();
}

async function inputValidationFlow(browser) {
  const page = await openApp(browser);
  const T = 'window.__SPINE_TEST__';
  await page.eval(`(() => { const d = document.querySelector('.guided-advanced-inputs'); if (d) d.open = true; return true; })()`);
  // F097: negative values can be typed.
  await retype(page, '#apicalTranslationInput', '-20');
  const translation = await page.eval(`({ field: document.getElementById('apicalTranslationInput').value, state: ${T}.getState().globalDeformity.trunkShift })`);
  check(translation.field === '-20' && translation.state === -20, 'typing -20 into apical translation commits -20 (no "0-20")', JSON.stringify(translation));
  await retype(page, '#primaryAxialRotationInput', '-15');
  const rotation = await page.eval(`({ field: document.getElementById('primaryAxialRotationInput').value, state: ${T}.getState().globalDeformity.axialRotation })`);
  check(rotation.field === '-15' && rotation.state === -15, 'typing -15 into apical rotation commits -15', JSON.stringify(rotation));
  // F098: an out-of-range entry is visibly rejected and the strip shows the committed value.
  await retype(page, '#primaryCobbInput', '20');
  await retype(page, '#primaryCobbInput', '200');
  const cobb = await page.eval(`(() => {
    const input = document.getElementById('primaryCobbInput');
    const error = document.getElementById('primaryCobbInputError');
    return { invalid: input.getAttribute('aria-invalid'), border: getComputedStyle(input).borderTopColor, error: error && !error.hidden ? error.textContent : null,
      context: document.getElementById('contextCobb').textContent, state: window.__SPINE_TEST__.getState().globalDeformity.coronalMagnitude };
  })()`);
  check(cobb.invalid === 'true' && /0 to 120/.test(cobb.error || '') && cobb.border === 'rgb(251, 113, 133)', 'an out-of-range Cobb shows a visible error with the allowed range', JSON.stringify(cobb));
  check(cobb.context === '20°' && cobb.state === 20, 'the context strip shows the committed Cobb, not the rejected text', JSON.stringify(cobb));
  await page.eval(`document.getElementById('primaryCobbInput').blur()`);
  await sleep(80);
  const reverted = await page.eval(`({ value: document.getElementById('primaryCobbInput').value, invalid: document.getElementById('primaryCobbInput').getAttribute('aria-invalid') })`);
  check(reverted.value === '20' && reverted.invalid === null, 'leaving the field restores the committed value', JSON.stringify(reverted));
  // F099/F091: measured SVA domain and unit hint.
  await retype(page, '#measuredSvaInput', '45');
  const sva45 = await page.eval(`({ invalid: document.getElementById('measuredSvaInput').getAttribute('aria-invalid'), error: document.getElementById('measuredSvaInputError')?.textContent, hint: document.getElementById('measuredSvaHint').hidden ? null : document.getElementById('measuredSvaHint').textContent, metric: document.getElementById('metricSva').textContent, grade: document.querySelector('#modifierSva strong').textContent, state: ${T}.getState().params.measuredSva })`);
  check(sva45.invalid === 'true' && /−30 to 30 cm/.test(sva45.error || '') && /4\.5 cm/.test(sva45.hint || '') && sva45.metric === '—' && sva45.grade === '—' && sva45.state === null,
    'SVA 45 (a millimetre value) is refused, not graded, and the hint suggests 4.5 cm', JSON.stringify(sva45));
  await retype(page, '#measuredSvaInput', '1e6');
  const svaHuge = await page.eval(`({ metric: document.getElementById('metricSva').textContent, state: ${T}.getState().params.measuredSva })`);
  check(svaHuge.metric === '—' && svaHuge.state === null, 'SVA 1e6 is refused', JSON.stringify(svaHuge));
  await retype(page, '#measuredSvaInput', '4.5');
  const svaOk = await page.eval(`({ invalid: document.getElementById('measuredSvaInput').getAttribute('aria-invalid'), hint: document.getElementById('measuredSvaHint').hidden, metric: document.getElementById('metricSva').textContent })`);
  check(svaOk.invalid === null && svaOk.hint === true && /4\.5 cm/.test(svaOk.metric), 'SVA 4.5 cm is accepted without a hint', JSON.stringify(svaOk));
  // F081: age reference is display-only.
  const predictionBefore = await page.eval(`JSON.stringify(${T}.getState().prediction.outputs)`);
  await retype(page, '#ageInput', '30');
  const ageRef = await page.eval(`({ text: document.getElementById('ageReference').textContent, prediction: JSON.stringify(${T}.getState().prediction.outputs) })`);
  check(/under 35/.test(ageRef.text) && /10\.9°/.test(ageRef.text) && /PMID 26689395/.test(ageRef.text) && ageRef.prediction === predictionBefore,
    'age 30 shows the Lafage 2016 under-35 reference and changes no modeled output', ageRef.text);
  await retype(page, '#ageInput', '50');
  const ageMid = await page.eval(`document.getElementById('ageReference').textContent`);
  check(/45–54/.test(ageMid) && /within the published range/.test(ageMid), 'a middle age group shows the published range without an invented number', ageMid);
  // F110 + F106: step message and preserved values across the posterior-fixation toggle.
  await page.eval(`(() => { document.querySelector('.workflow-nav a[data-step="3"]').click(); const lv = document.getElementById('levelSelect'); lv.value = 'L4-L5'; lv.dispatchEvent(new Event('change', { bubbles: true })); const pr = document.getElementById('procedureSelect'); pr.value = 'alif'; pr.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await retype(page, '#correctionInput', '12.25');
  await page.eval(`document.getElementById('procedureForm').requestSubmit()`);
  const stepMessage = await page.eval(`document.getElementById('procedureError').textContent`);
  check(/0\.5° increments/.test(stepMessage), 'a 12.25° entry is told about the 0.5° step, not the range', stepMessage);
  await retype(page, '#correctionInput', '22');
  await retype(page, '#coronalCorrectionInput', '0');
  await page.eval(`(() => { const box = document.getElementById('includePosteriorFixation'); box.click(); return box.checked; })()`);
  await sleep(100);
  const kept = await page.eval(`document.getElementById('correctionInput').value`);
  check(kept === '22', 'toggling posterior fixation keeps the typed correction', kept);
  check(page.errors.length === 0, 'no page errors in the validation flow', page.errors.join(' | '));
  await page.close();
}

async function procedureEditFlow(browser) {
  const page = await openApp(browser);
  const T = 'window.__SPINE_TEST__';
  await page.eval(`document.querySelector('.workflow-nav a[data-step="3"]').click()`);
  await sleep(200);
  for (const [level, proc] of [['L5-S1', 'alif'], ['L4-L5', 'tlifPlif'], ['L3-L4', 'xlif'], ['L2-L3', 'xlif']]) await page.eval(addProcedureSource(level, proc, null));
  const listBox = await page.eval(`(() => { const l = document.getElementById('itineraryList'); return { client: l.clientHeight, scroll: l.scrollHeight, overflow: getComputedStyle(l).overflowY, cards: l.querySelectorAll('.procedure-card').length }; })()`);
  check(listBox.cards === 4 && listBox.scroll <= listBox.client + 1 && listBox.overflow === 'visible', 'the active list shows every card without a nested scroll box', JSON.stringify(listBox));
  const firstId = await page.eval(`${T}.getState().itinerary[0].id`);
  await page.eval(`document.querySelector('#itineraryList .procedure-card .edit-button').click()`);
  await sleep(200);
  const editing = await page.eval(`({ label: document.getElementById('addProcedureLabel').textContent, banner: document.getElementById('procedureEditBanner').hidden, level: document.getElementById('levelSelect').value, proc: document.getElementById('procedureSelect').value, value: document.getElementById('correctionInput').value })`);
  check(editing.label === 'Update item' && editing.banner === false && editing.level === 'L5-S1' && editing.proc === 'alif', 'Edit loads the item into the form and switches to Update item', JSON.stringify(editing));
  await retype(page, '#correctionInput', '18');
  await page.eval(`document.getElementById('procedureForm').requestSubmit()`);
  await sleep(200);
  const after = await page.eval(`${T}.getState().itinerary.map(i => ({ id: i.id, level: i.levelId, angle: i.plannedAngle }))`);
  check(after.length === 4 && after[0].id === firstId && after[0].level === 'L5-S1' && after[0].angle === 18, 'Update replaces the item in place, keeping its id and position', JSON.stringify(after));
  const addLabel = await page.eval(`document.getElementById('addProcedureLabel').textContent`);
  check(addLabel === 'Add to itinerary', 'the form returns to Add after an update', addLabel);
  await page.eval(`${T}.undoCaseEdit()`);
  await sleep(150);
  const undone = await page.eval(`${T}.getState().itinerary[0].plannedAngle`);
  check(undone !== 18, 'an edit is undoable', undone);
  // F100: the view switch does not leave the build step.
  await page.eval(`document.querySelector('#surgicalItinerary .panel-tab[data-tab="build"]').click()`);
  await page.clickSelector('#postViewButton');
  await sleep(200);
  const flow = await page.eval(`({ step: document.querySelector('.app-shell').dataset.workflowStep, tab: document.getElementById('surgicalItinerary').dataset.panelTab, form: getComputedStyle(document.getElementById('procedureForm')).display })`);
  check(flow.step === '3' && flow.tab === 'build' && flow.form !== 'none', 'Modeled Post-Op keeps step 3 and the Build tab', JSON.stringify(flow));
  // F111: the legend follows the layers and the itinerary.
  const legend = await page.eval(`(() => { const shown = () => [...document.querySelectorAll('#canvasLegend [data-legend-layer]')].filter(i => !i.hidden).map(i => i.dataset.legendLayer); const a = shown(); const m = document.querySelector('input[data-layer="measurements"]') || document.getElementById('layerMeasurements'); return { withProcedures: a, id: m && m.id }; })()`);
  check(legend.withProcedures.includes('implants') && !legend.withProcedures.includes('measurements') && !legend.withProcedures.includes('ligaments'),
    'the legend lists implants with procedures and omits hidden layers', JSON.stringify(legend));
  await page.clickSelector('#toggleLayers');
  await sleep(100);
  const measurementToggle = await page.eval(`(() => { const box = document.getElementById('layerMeasurements'); box.click(); return box.checked; })()`);
  const legendOn = await page.eval(`[...document.querySelectorAll('#canvasLegend [data-legend-layer="measurements"]')].every(i => !i.hidden)`);
  await page.key('Escape', 'Escape', 27);
  await sleep(100);
  const panelClosed = await page.eval(`document.getElementById('layerPanel').hidden`);
  check(measurementToggle && legendOn && panelClosed, 'showing reference lines adds them to the legend, and Escape closes the layers popover', JSON.stringify({ measurementToggle, legendOn, panelClosed }));
  await page.clickSelector('#toggleLayers');
  await sleep(100);
  await page.click(700, 600);
  await sleep(100);
  check(await page.eval(`document.getElementById('layerPanel').hidden`), 'an outside click closes the layers popover');
  check(page.errors.length === 0, 'no page errors in the edit flow', page.errors.join(' | '));
  await page.close();
}

async function viewAndLayoutFlow(browser) {
  const page = await openApp(browser);
  const T = 'window.__SPINE_TEST__';
  // F108: presets and live orientation labels.
  const lateral = await page.eval(`({ label: document.getElementById('orientationLabel').textContent, axis: document.getElementById('axisHorizontalLabel').textContent, pressed: document.querySelector('[data-view-preset="lateral"]').getAttribute('aria-pressed') })`);
  check(/Left lateral/.test(lateral.label) && /Anterior/.test(lateral.axis) && lateral.pressed === 'true', 'the default view is labelled left lateral', JSON.stringify(lateral));
  await page.eval(`${T}.applyCaseExample('degenerative-scoliosis')`);
  await page.clickSelector('[data-view-preset="ap"]');
  await sleep(700);
  const ap = await page.eval(`(() => {
    const T = window.__SPINE_TEST__; const THREE = window.THREE; const cam = T.getCamera();
    // Apex side is judged against the sacral vertical line (CSVL), as clinically.
    const seg = T.getSegments(); const apex = seg.get('L2-L3').group.getWorldPosition(new THREE.Vector3()); const base = seg.get('L5-S1').group.getWorldPosition(new THREE.Vector3());
    const px = v => v.clone().project(cam).x;
    return { label: document.getElementById('orientationLabel').textContent, axis: document.getElementById('axisHorizontalLabel').textContent,
      apexX: px(apex), lineX: px(base), direction: T.getState().globalDeformity.coronalDirection, pressed: document.querySelector('[data-view-preset="ap"]').getAttribute('aria-pressed') };
  })()`);
  check(/AP/.test(ap.label) && /Patient right ←/.test(ap.axis) && ap.pressed === 'true', 'the AP preset is labelled AP with patient right on screen left', JSON.stringify(ap));
  const apexSide = ap.direction === 'right' ? ap.apexX < ap.lineX : ap.apexX > ap.lineX;
  check(apexSide, `in the AP view an apex-${ap.direction} lumbar curve deviates from the sacral vertical line toward the patient's ${ap.direction} (screen ${ap.direction === 'right' ? 'left' : 'right'})`, JSON.stringify(ap));
  await page.eval(`(() => { document.getElementById('viewport').focus(); return true; })()`);
  await page.key('3', 'Digit3', 51);
  await sleep(700);
  const pa = await page.eval(`({ label: document.getElementById('orientationLabel').textContent, axis: document.getElementById('axisHorizontalLabel').textContent })`);
  check(/PA/.test(pa.label) && /Patient right →/.test(pa.axis), 'key 3 selects the PA view with patient right on screen right', JSON.stringify(pa));
  await page.drag([700, 600], [760, 600]);
  await sleep(300);
  const rotated = await page.eval(`({ label: document.getElementById('orientationLabel').textContent, pressed: [...document.querySelectorAll('[data-view-preset]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.viewPreset) })`);
  notes.push(`after a small orbit from PA: ${rotated.label} (pressed ${rotated.pressed.join(',') || 'none'})`);
  await page.key('1', 'Digit1', 49);
  await sleep(700);
  const back = await page.eval(`document.getElementById('orientationLabel').textContent`);
  check(/Left lateral/.test(back), 'key 1 returns to the left lateral view', back);
  // F101: the Pre-Op/Post-Op switch is clear of the model at desktop sizes.
  for (const [w, h] of [[1440, 900], [1280, 720], [1920, 1080]]) {
    await page.setViewport(w, h);
    await sleep(500);
    await page.eval(`${T}.resetCameraView({ announceChange: false })`);
    await sleep(200);
    const fit = await page.eval(`(() => {
      const T = window.__SPINE_TEST__; const THREE = window.THREE; const cam = T.getCamera(); const vp = document.getElementById('viewport').getBoundingClientRect();
      const box = T.getVisibleAnatomyBounds(); let top = 1e9;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) { const p = new THREE.Vector3(x, y, z).project(cam); top = Math.min(top, vp.top + (1 - p.y) / 2 * vp.height); }
      return { modelTop: Math.round(top), switchBottom: Math.round(document.getElementById('viewSwitch').getBoundingClientRect().bottom) };
    })()`);
    check(fit.modelTop >= fit.switchBottom - 2, `at ${w}x${h} the view switch does not cover the skull`, JSON.stringify(fit));
  }
  // F109: inputs and output together on a wide desktop.
  await page.setViewport(1440, 900);
  await sleep(400);
  const columns = await page.eval(`(() => { const vis = id => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 200; }; const out = {}; for (const step of ['1', '2', '3']) { document.querySelector('.workflow-nav a[data-step="' + step + '"]').click(); out[step] = [vis('patientParameters'), vis('viewport'), vis('surgicalItinerary')]; } return out; })()`);
  check(Object.values(columns).every(row => row.every(Boolean)), 'at 1440px every step shows case inputs, the model and the procedure/output panel', JSON.stringify(columns));
  // F105: chips stay visible, ellipsize and expose the full text.
  await page.setViewport(1280, 720);
  await sleep(400);
  const chip = await page.eval(`(() => { const c = document.getElementById('geometryChip'); const s = getComputedStyle(c); return { display: s.display, ellipsis: s.textOverflow, titled: c.title === c.textContent, role: c.getAttribute('role') }; })()`);
  await page.eval(`document.getElementById('geometryChip').click()`);
  const expanded = await page.eval(`({ attr: document.getElementById('geometryChip').getAttribute('aria-expanded'), wrap: getComputedStyle(document.getElementById('geometryChip')).whiteSpace })`);
  check(chip.display === 'block' && chip.ellipsis === 'ellipsis' && chip.titled && chip.role === 'button' && expanded.attr === 'true' && expanded.wrap === 'normal',
    'the geometry chip stays visible at 1280px, ellipsizes, and expands to the full sentence', JSON.stringify({ chip, expanded }));
  // F104: legibility floor in the workspace chrome (imaging dialogs excluded).
  for (const [w, h, floor] of [[1440, 900, 10.5], [1920, 1080, 11.9]]) {
    await page.setViewport(w, h);
    await sleep(400);
    const tiny = await page.eval(`(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode; const el = node.parentElement;
        if (!node.textContent.trim() || !el || el.closest('dialog, #patientImagingDialog, .sr-only, .visually-hidden, [hidden], .demo-bar')) continue;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
        const size = parseFloat(s.fontSize); if (size < ${floor}) out.push(size + 'px ' + (el.id || el.className || el.tagName) + ': ' + node.textContent.trim().slice(0, 30));
      }
      return out;
    })()`);
    check(tiny.length === 0, `no visible workspace text below ${floor}px at ${w}x${h}`, tiny.slice(0, 12).join(' | '));
  }
  // F112: icons are masks, none empty, icon-only buttons are titled.
  const icons = await page.eval(`(() => {
    const els = [...document.querySelectorAll('.fa-solid, .fa-regular')];
    const noMask = els.filter(e => { const s = getComputedStyle(e); const m = s.maskImage || s.webkitMaskImage; return !m || m === 'none'; }).map(e => e.className);
    const glyph = els.filter(e => getComputedStyle(e, '::before').content !== 'none' && getComputedStyle(e, '::before').content !== 'normal').map(e => e.className);
    const untitled = ['openShowcase', 'openHelp', 'caseFileButton', 'undoCase', 'redoCase'].filter(id => !document.getElementById(id).title);
    return { count: els.length, noMask: [...new Set(noMask)], glyph: [...new Set(glyph)], untitled };
  })()`);
  check(icons.count > 20 && !icons.noMask.length && !icons.glyph.length && !icons.untitled.length, 'every icon is an inline-SVG mask with no font glyph, and icon-only header buttons have titles', JSON.stringify(icons));
  check(page.errors.length === 0, 'no page errors in the view/layout flow', page.errors.join(' | '));
  await page.close();
}

async function a11yAndHelpFlow(browser) {
  const page = await openApp(browser);
  const tabs = await page.eval(`[...document.querySelectorAll('.panel-tab')].map(t => ({ role: t.getAttribute('role'), controls: t.getAttribute('aria-controls'), selected: t.getAttribute('aria-selected'), tabindex: t.getAttribute('tabindex') }))`);
  check(tabs.length === 4 && tabs.every(t => t.role === 'tab' && t.controls), 'panel tabs are role=tab with aria-controls', JSON.stringify(tabs));
  await page.eval(`document.getElementById('patientTabCases').focus()`);
  await page.key('ArrowRight', 'ArrowRight', 39);
  await sleep(100);
  const moved = await page.eval(`({ active: document.activeElement.id, selected: document.getElementById('patientTabLibrary').getAttribute('aria-selected'), tabindex: document.getElementById('patientTabCases').getAttribute('tabindex'), panel: document.getElementById('patientParameters').dataset.panelTab })`);
  check(moved.active === 'patientTabLibrary' && moved.selected === 'true' && moved.tabindex === '-1' && moved.panel === 'library', 'ArrowRight moves to and selects the next tab with a roving tabindex', JSON.stringify(moved));
  await page.key('Home', 'Home', 36);
  await sleep(80);
  check(await page.eval(`document.activeElement.id === 'patientTabCases'`), 'Home returns to the first tab');
  // F113: quick start in help.
  await page.clickSelector('#openHelp');
  await sleep(200);
  const help = await page.eval(`({ heading: document.getElementById('helpHeading').textContent, steps: document.querySelectorAll('#helpDialog .quick-start-steps li').length, rows: document.querySelectorAll('#helpDialog .shortcut-table tr').length, firstH3: document.querySelector('#helpDialog h3').textContent })`);
  check(/Quick start/.test(help.heading) && help.steps === 3 && help.rows >= 6 && /Quick start/.test(help.firstH3), 'Help opens on a three-step quick start and a keyboard/mouse table', JSON.stringify(help));
  await page.key('Escape', 'Escape', 27);
  // F103: Anatomy Lab slider fills follow their values.
  await page.eval(`window.__SPINE_TEST__.applyCaseExample('degenerative-scoliosis')`);
  await page.clickSelector('#openAnatomyLab');
  await sleep(200);
  const fills = await page.eval(`[...document.querySelectorAll('#anatomyLabDialog input[type="range"]')].map(i => { const expected = (Number(i.value) - Number(i.min)) / (Number(i.max) - Number(i.min)) * 100; const actual = parseFloat(i.style.getPropertyValue('--progress')); return { id: i.id, ok: Math.abs(expected - actual) < .6 }; })`);
  check(fills.length >= 15 && fills.every(f => f.ok), 'every Anatomy Lab slider fill matches its value', JSON.stringify(fills.filter(f => !f.ok)));
  await page.key('Escape', 'Escape', 27);
  check(page.errors.length === 0, 'no page errors in the a11y/help flow', page.errors.join(' | '));
  await page.close();
}

async function sceneFollowUpFlow(browser) {
  const page = await openApp(browser);
  const T = 'window.__SPINE_TEST__';
  const dist = await page.eval(`(() => { const d = ${T}.CURVE_DISTRIBUTION.thoracic; const sum = Object.values(d).reduce((a, b) => a + b, 0); return { upper: d['T1-T2'] + d['T2-T3'] + d['T3-T4'], sum, id: ${T}.CURVE_DISTRIBUTION.id, label: document.querySelector('label[for="tkSlider"]').textContent }; })()`);
  check(dist.upper === 0 && Math.abs(dist.sum - 1) < 1e-6 && /TK \(T4–T12\)/.test(dist.label), 'TK is distributed over T4–T12 only and the slider says TK (T4–T12)', JSON.stringify(dist));
  // F083: a measured TK is posed at full magnitude.
  const posed = await page.eval(`(() => {
    const T = window.__SPINE_TEST__;
    const sum = () => { let s = 0; for (const [id, r] of T.getSegments()) if (/^T(\\d+)-T(\\d+)$/.test(id)) s += r.group.userData.alignmentRotationZ * 180 / Math.PI; return s; };
    const s = document.getElementById('tkSlider');
    s.value = '42'; s.dispatchEvent(new Event('input', { bubbles: true })); const a = sum();
    s.value = '62'; s.dispatchEvent(new Event('input', { bubbles: true })); const b = sum();
    s.value = '42'; s.dispatchEvent(new Event('input', { bubbles: true }));
    return b - a;
  })()`);
  check(Math.abs(posed - 20) < 1e-6, 'a 20° TK change is posed as 20° across T4–T12', posed);
  // F078 companion: a T12 body resection is posed once.
  const t12 = await page.eval(`(() => {
    const T = window.__SPINE_TEST__;
    const sum = () => { let s = 0; for (const [id, r] of T.getSegments()) if (/^T\\d+-T\\d+$/.test(id)) s += r.group.userData.alignmentRotationZ * 180 / Math.PI; return s; };
    const lv = document.getElementById('levelSelect'); lv.value = 'BODY-T12'; lv.dispatchEvent(new Event('change', { bubbles: true }));
    const pr = document.getElementById('procedureSelect'); pr.value = 'vcr'; pr.dispatchEvent(new Event('change', { bubbles: true }));
    const ci = document.getElementById('correctionInput'); ci.value = '40'; ci.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('procedureForm').requestSubmit();
    T.setView('pre'); const pre = sum(); T.setView('post'); const post = sum();
    const p = T.getState().prediction; T.setView('pre');
    return { n: T.getState().itinerary.length, posed: post - pre, reported: p.newTK - 42 };
  })()`);
  check(t12.n === 1 && Math.abs(t12.posed - t12.reported) < 1e-6, 'a T12 VCR is posed with the same thoracic change the engine reports (F078)', JSON.stringify(t12));
  // F082: the modeled primary and secondary Cobb are what the post-op scene draws.
  const coronal = await page.eval(`(() => {
    const T = window.__SPINE_TEST__;
    T.applyCaseExample('degenerative-scoliosis');
    const lv = document.getElementById('levelSelect'); lv.value = 'L3-L4'; lv.dispatchEvent(new Event('change', { bubbles: true }));
    const pr = document.getElementById('procedureSelect'); pr.value = 'xlif'; pr.dispatchEvent(new Event('change', { bubbles: true }));
    const cc = document.getElementById('coronalCorrectionInput'); cc.value = '-10'; cc.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('procedureForm').requestSubmit();
    T.setView('post');
    const sp = T.getState().threePlanePrediction; let sumX = 0, wedge = 0;
    // The display-only balancing bend outside the curve windows (coronalBalanceDeg)
    // is excluded: it keeps the head over the pelvis and is not part of either Cobb.
    let balance = 0;
    for (const [id, r] of T.getSegments()) { sumX += r.group.userData.targetRotationX * 180 / Math.PI - (Number(r.group.userData.coronalBalanceDeg) || 0); balance += Math.abs(Number(r.group.userData.coronalBalanceDeg) || 0); wedge += Number(T.getState().levelFactors[id]?.coronalWedge) || 0; }
    const cb = T.getCoronalBalance();
    T.setView('pre');
    // Curvature is right-positive (+X) since the apex-side sign fix, so the
    // drawn curve is the posed sum minus the authored wedges (was -(sumX + wedge)).
    return { n: T.getState().itinerary.length, drawn: sumX - wedge, modeled: sp.outputs.primaryCobb + sp.outputs.secondaryCobb, outside: sp.changes.outsideCurve.coronal, baseline: sp.baseline.primaryCobb + sp.baseline.secondaryCobb, balance, headOffsetMm: cb && cb.headOffsetMm, mode: cb && cb.mode };
  })()`);
  check(coronal.n === 1 && Math.abs(coronal.drawn - (coronal.modeled + coronal.outside)) < 1e-6,
    'the post-op coronal pose sums to the modeled primary + secondary Cobb (F082)', JSON.stringify(coronal));
  // Coronal lean: a curve with no equal opposite secondary used to leave the
  // trunk tilted by the whole Cobb (C7 ~228 mm off S1 in this example).
  check(coronal.mode === 'two-window' && coronal.balance > 1 && Math.abs(coronal.headOffsetMm) < 1,
    'a coronal curve is balanced by a tagged display-only bend that keeps the head over the pelvis', JSON.stringify(coronal));
  // F087 copy.
  const copy = await page.eval(`document.getElementById('canvasDescription').textContent`);
  check(/pelvic balance \(PT\) response is always applied/.test(copy), 'the canvas description states the PT response is always applied', copy.slice(-200));
  check(page.errors.length === 0, 'no page errors in the scene follow-up flow', page.errors.join(' | '));
  await page.close();
}

async function phoneFlow(browser) {
  const page = await openApp(browser, { width: 390, height: 844, mobile: true });
  await page.eval(`document.querySelector('.workflow-nav a[data-step="2"]').click()`);
  await sleep(900);
  const reach = await page.eval(`(() => {
    const out = {};
    for (const id of ['toggleLayers', 'openAnatomyLab']) {
      const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out[id] = Boolean(hit && (hit === el || el.contains(hit)));
    }
    return out;
  })()`);
  check(Object.keys(reach).length === 2 && Object.values(reach).every(Boolean), 'on a phone the step-2 jump leaves the viewport toolbar tappable (F102)', JSON.stringify(reach));
  const fit = await page.eval(`(() => {
    const T = window.__SPINE_TEST__; const THREE = window.THREE; T.resetCameraView({ announceChange: false }); const cam = T.getCamera(); const vp = document.getElementById('viewport').getBoundingClientRect();
    const box = T.getVisibleAnatomyBounds(); let top = 1e9;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) { const p = new THREE.Vector3(x, y, z).project(cam); top = Math.min(top, vp.top + (1 - p.y) / 2 * vp.height); }
    return { modelTop: Math.round(top), switchBottom: Math.round(document.getElementById('viewSwitch').getBoundingClientRect().bottom) };
  })()`);
  check(fit.modelTop >= fit.switchBottom - 2, 'on a phone the view switch does not cover the skull', JSON.stringify(fit));
  check(page.errors.length === 0, 'no page errors on the phone', page.errors.join(' | '));
  await page.close();
}

async function showcaseFlow(browser) {
  const page = await openApp(browser);
  const titles = await page.eval(`window.__SPINE_DEMO__.chapters.length`);
  const seen = [];
  await page.eval(`window.__SPINE_DEMO__.start()`);
  await sleep(300);
  for (let index = 0; index < titles; index += 1) {
    await page.eval(`window.__SPINE_DEMO__.goTo(${index})`);
    await sleep(index === 0 ? 1200 : 700);
    seen.push(await page.eval(`window.__SPINE_DEMO__.state().index`));
  }
  await page.eval(`window.__SPINE_DEMO__.exit()`);
  check(titles === 12 && seen.every((value, index) => value === index), 'the 12-chapter guided demo still steps through every chapter', JSON.stringify({ titles, seen }));
  check(page.errors.length === 0, 'no page errors while the demo runs', page.errors.join(' | '));
  await page.close();
}

(async () => {
  const browser = await launch({ headless: true });
  const flows = [versionAndGateFlow, historyAndConfirmFlow, caseFileFlow, inputValidationFlow, procedureEditFlow, viewAndLayoutFlow, a11yAndHelpFlow, sceneFollowUpFlow, phoneFlow, showcaseFlow];
  try {
    for (const flow of flows) {
      try { await flow(browser); } catch (error) { check(false, `${flow.name} completed`, error && error.stack || String(error)); }
    }
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const failed = results.filter(result => !result.ok);
  console.log(JSON.stringify({ build, summary: { passed: results.length - failed.length, failed: failed.length, total: results.length }, failures: failed, notes }, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
