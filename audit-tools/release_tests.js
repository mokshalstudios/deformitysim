/* eslint-disable no-console */
'use strict';
// Release-review regression tests (security and QA findings before the public
// release). Drives a built spine_simulator.html in real Chrome.
//
//   node audit-tools/release_tests.js <build.html>
//
//   S1/S2  crafted case files (__proto__ / constructor / toString keys) never
//          reach Object.prototype and every failure is reported to the user
//   S4     no launch-code digest ships in the public build
//   Q14    no manifest request (and no console error) when opened from file://
//   Q5     the gait readout starts collapsed; expanding it hides the geometry chips
//   Q6/Q7  starting the guided demo confirms a dirty case and restores it on exit;
//          demo toasts carry no Undo and sit above the demo bar
//   Q8     the showcase gait section flags PT outside the cohort span
//   Q10    an out-of-range Cobb entry leaves a visible note after blur
//   Q13    a third pasted film says it replaced a staged film
//   Q1/Q3/Q9 (needs samples/2-1.jpg) the zoomed film never covers its toolbar,
//          the primary Cobb is the larger curve, and a rejected neural pass is
//          named in the status line
// Exit code 0 only when every check passes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, fileUrl, sleep } = require('./cdp.js');

const ROOT = path.join(__dirname, '..');
const build = path.resolve(process.argv[2] || path.join(ROOT, 'spine_simulator.html'));
const results = [];
const notes = [];
const check = (ok, label, detail = '') => results.push({ ok: Boolean(ok), label, detail: ok ? '' : String(detail) });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
const T = 'window.__SPINE_TEST__';
// Optional screenshots for review: RELEASE_SHOTS=<dir> node audit-tools/release_tests.js <build>
const SHOTS = process.env.RELEASE_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot(path.join(SHOTS, name)); } };

async function openApp(browser, { width = 1440, height = 900 } = {}) {
  const page = await browser.open(fileUrl(build), { width, height });
  await page.unlock();
  await sleep(500);
  try { await page.clickSelector('#introExplore'); } catch (_) { /* intro already dismissed */ }
  await sleep(600);
  return page;
}

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

const PROTOTYPE_STATE = `(() => {
  const keys = []; for (const key in {}) keys.push(key);
  let text; try { text = String({}); } catch (error) { text = 'THROW ' + error.message; }
  const own = Object.getOwnPropertyNames(Object.prototype).sort().join(',');
  return { keys, text, own, sagittalWedge: ({}).sagittalWedge, discHeightLoss: ({}).discHeightLoss };
})()`;

/* ---- S1 / S2: crafted case files through the real file input ---- */
async function caseFileSecurityFlow(browser) {
  const page = await openApp(browser);
  const cleanPrototype = await page.eval(PROTOTYPE_STATE);
  await page.eval(`${T}.applyCaseExample('neutral-reference')`);
  const base = JSON.parse(await page.eval(`JSON.stringify(${T}.buildCaseFileObject())`));
  const text = value => JSON.stringify(value);
  const withLevels = (extraFirst, mutate = () => {}) => {
    const copy = JSON.parse(JSON.stringify(base));
    mutate(copy);
    // "__proto__" must be written as literal JSON text: an object literal key
    // would set the prototype instead of creating the own property JSON.parse makes.
    return text(copy).replace('"levelFactors":{', `"levelFactors":{${extraFirst},`);
  };
  const cases = [
    { name: 'pollute_valid', body: withLevels('"__proto__":{"sagittalWedge":7}'), expect: 'refused', pattern: /reserved property names/ },
    { name: 'pollute_rejected', body: withLevels('"__proto__":{"discHeightLoss":33}', copy => { copy.case.params.pi = 9999; }), expect: 'refused', pattern: /reserved property names|PI must be/ },
    { name: 'pollute_builtin', body: withLevels('"__proto__":{"toString":1}'), expect: 'refused', pattern: /reserved property names/ },
    { name: 'level_builtin_field', body: text({ ...base, case: { ...base.case, levelFactors: { ...base.case.levelFactors, 'L4-L5': { ...base.case.levelFactors['L4-L5'], toString: 1 } } } }), expect: 'refused', pattern: /unknown anatomy field toString/ },
    { name: 'level_builtin_id', body: withLevels('"hasOwnProperty":{"sagittalWedge":1}'), expect: 'refused', pattern: /Unknown anatomy level/ },
    { name: 'procedure_ctor', body: text({ ...base, case: { ...base.case, itinerary: [{ id: 1, levelId: 'L4-L5', procedureId: 'constructor', plannedAngle: 0 }] } }), expect: 'refused', pattern: /unknown or incompatible level and procedure/ },
    { name: 'constructor_key', body: text(base).replace('"case":{', '"case":{"constructor":{"prototype":{"polluted":1}},'), expect: 'refused', pattern: /reserved property names/ },
    { name: 'example_ctor', body: text({ ...base, case: { ...base.case, caseContext: { ...base.case.caseContext, exampleId: 'constructor' } } }), expect: 'opened' }
  ];
  for (const item of cases) {
    const file = path.join(tmpDir, `${item.name}.json`);
    fs.writeFileSync(file, item.body);
    await page.eval(`${T}.applyCaseExample('neutral-reference')`);
    await page.eval(`(() => { const s = document.getElementById('caseFileStatus'); if (s) { s.hidden = true; s.textContent = ''; } document.getElementById('toast').textContent = ''; return true; })()`);
    await page.setFiles('#caseFileInput', [file]);
    await sleep(600);
    const after = await page.eval(`(() => ({
      status: (document.getElementById('caseFileStatus') || {}).textContent || '',
      statusHidden: (document.getElementById('caseFileStatus') || {}).hidden,
      toast: document.getElementById('toast').textContent,
      exampleId: ${T}.getState().caseContext.exampleId,
      prototype: ${PROTOTYPE_STATE}
    }))()`);
    const prototypeClean = JSON.stringify(after.prototype) === JSON.stringify(cleanPrototype);
    check(prototypeClean, `${item.name}: Object.prototype is unchanged after opening the file`, JSON.stringify(after.prototype));
    if (item.expect === 'refused') {
      check(/Case file not opened/.test(after.toast) && after.statusHidden === false && item.pattern.test(after.status),
        `${item.name}: the file is refused with a visible reason`, JSON.stringify({ toast: after.toast, status: after.status }));
    } else {
      check(/Case file opened/.test(after.toast) && after.exampleId === null,
        `${item.name}: an exampleId naming a built-in property is ignored (opens as a custom case, no crash)`, JSON.stringify(after));
    }
  }
  // Direct parser checks, including the test-surface loader.
  const direct = await page.eval(`(() => {
    const r = ${T}.loadCaseFileText(${JSON.stringify(withLevels('"__proto__":{"sagittalWedge":7}'))});
    return { ok: r.ok, errors: r.errors, polluted: ({}).sagittalWedge !== undefined };
  })()`);
  check(direct.ok === false && !direct.polluted, 'loadCaseFileText refuses a __proto__ level without polluting', JSON.stringify(direct));
  // The reported symptom: after a polluting file, the AP view lost the skeleton
  // and three.js threw on every attribute update.
  await page.eval(`(() => { const b = document.querySelector('[data-view-preset="ap"]'); if (b) b.click(); return true; })()`);
  await sleep(400);
  check(page.errors.length === 0, 'no page errors while opening crafted case files', page.errors.slice(0, 3).join(' | '));
  await page.close();
}

/* ---- S4 / Q14: static build content and file:// console ---- */
async function buildContentFlow(browser) {
  const html = fs.readFileSync(build, 'utf8');
  const digest = /var CODE_DIGEST = '([^']*)';/.exec(html);
  check(digest && digest[1] === '' && /var LAUNCH_GATE_ENABLED = false;/.test(html),
    'the public build ships the gate disabled and with no launch-code digest', digest ? digest[1] : 'no CODE_DIGEST line');
  check(!/antic2026|40fe1d513d76eeba/.test(html), 'the retired launch code and its digest are absent from the build');
  check(!/<link rel="manifest"/.test(html), 'the manifest link is not emitted statically');
  const page = await openApp(browser);
  await sleep(500);
  const state = await page.eval(`({ manifest: !!document.querySelector('link[rel="manifest"]'), gate: window.__SPINE_GATE__ && window.__SPINE_GATE__.isUnlocked() })`);
  const manifestErrors = page.console.filter(entry => /manifest\.webmanifest|ERR_FILE_NOT_FOUND/.test(entry.text));
  check(state.manifest === false && manifestErrors.length === 0 && state.gate === true,
    'opened from file:// the page requests no manifest and logs no missing-file error', JSON.stringify({ state, manifestErrors }));
  await page.close();
}

/* ---- Q5: gait readout ---- */
async function gaitFlow(browser) {
  for (const [width, height] of [[1440, 900], [1024, 768]]) {
    const page = await openApp(browser, { width, height });
    await page.eval(`${T}.applyCaseExample('flatback')`);
    await sleep(300);
    await page.clickSelector('#toggleGait');
    await sleep(400);
    await shot(page, `gait_collapsed_${width}.png`);
    const collapsed = await page.eval(`(() => {
      const chip = document.getElementById('gaitChip'), heading = chip.querySelector('strong');
      const r = heading.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const canvas = document.getElementById('threeCanvas').getBoundingClientRect(), c = chip.getBoundingClientRect();
      return { hidden: chip.hidden, collapsed: chip.dataset.collapsed, headingHit: !!hit && heading.contains(hit), chipHeight: Math.round(c.height),
        coverage: Math.round(100 * (c.width * c.height) / (canvas.width * canvas.height)) };
    })()`);
    check(!collapsed.hidden && collapsed.collapsed === 'true' && collapsed.headingHit && collapsed.coverage <= 5,
      `${width}px: the gait readout starts collapsed and its heading takes clicks`, JSON.stringify(collapsed));
    await page.clickSelector('#gaitChip > strong');
    await sleep(250);
    const expanded = await page.eval(`(() => ({ collapsed: document.getElementById('gaitChip').dataset.collapsed, flag: document.body.dataset.gaitExpanded || null,
      geometry: getComputedStyle(document.getElementById('geometryChip')).display, shape: getComputedStyle(document.getElementById('shapeChip')).display }))()`);
    check(expanded.collapsed === 'false' && expanded.flag === 'true' && expanded.geometry === 'none' && expanded.shape === 'none',
      `${width}px: expanding the gait readout hides the geometry chips so nothing stacks over it`, JSON.stringify(expanded));
    await shot(page, `gait_expanded_${width}.png`);
    await page.clickSelector('#toggleGait');
    await sleep(200);
    const off = await page.eval(`({ flag: document.body.dataset.gaitExpanded || null, geometry: getComputedStyle(document.getElementById('geometryChip')).display })`);
    check(off.flag === null && off.geometry !== 'none', `${width}px: stopping gait restores the geometry chips`, JSON.stringify(off));
    check(page.errors.length === 0, `${width}px: no page errors in the gait flow`, page.errors.join(' | '));
    await page.close();
  }
}

/* ---- Q6 / Q7: guided demo and the user's case ---- */
async function demoFlow(browser) {
  const page = await openApp(browser, { width: 390, height: 844 });
  await page.setViewport(390, 844, { mobile: true });
  await sleep(300);
  await page.eval(`(() => { const s = document.getElementById('piSlider'); s.value = '65'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); ${T}.checkpointCaseHistory(); return true; })()`);
  // Cancel first: the case must stay and the demo must not start.
  await page.eval(`(window.__SPINE_DEMO__.start(), true)`);
  await sleep(300);
  const asked = await page.eval(`({ open: document.getElementById('confirmCaseDialog').open, text: document.getElementById('confirmCaseMessage').textContent })`);
  await shot(page, 'demo_confirm_390.png');
  check(asked.open && /Exit demo restores your case/.test(asked.text), 'starting the demo over an edited case asks first', JSON.stringify(asked));
  await page.eval(`(document.getElementById('confirmCaseCancel').click(), true)`);
  await sleep(300);
  const cancelled = await page.eval(`({ active: window.__SPINE_DEMO__.state().active, pi: ${T}.getState().params.pi })`);
  check(!cancelled.active && cancelled.pi === 65, 'cancelling keeps the case and does not start the demo', JSON.stringify(cancelled));
  // Accept: the demo runs, its toasts carry no Undo and sit above the bar.
  await page.eval(`(window.__SPINE_DEMO__.start(), true)`);
  await sleep(300);
  await page.eval(`(document.getElementById('confirmCaseAccept').click(), true)`);
  await sleep(1500);
  await page.eval(`(window.__SPINE_DEMO__.goTo(1), true)`);
  await sleep(1200);
  const during = await page.eval(`(() => {
    const toast = document.getElementById('toast'), bar = document.getElementById('demoBar').getBoundingClientRect(), t = toast.getBoundingClientRect();
    const covered = ['demoPlayPause', 'demoNext', 'demoPrev', 'demoExit'].filter(id => { const r = document.getElementById(id).getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !(hit && document.getElementById(id).contains(hit)); });
    return { active: window.__SPINE_DEMO__.state().active, action: !!toast.querySelector('.toast-action'), hasAction: toast.classList.contains('has-action'),
      visible: toast.classList.contains('is-visible'), toastBottom: Math.round(t.bottom), barTop: Math.round(bar.top), covered, pi: ${T}.getState().params.pi };
  })()`);
  check(during.active && !during.action && !during.hasAction && during.covered.length === 0 && (!during.visible || during.toastBottom <= during.barTop + 1),
    'during the demo, toasts carry no Undo, sit above the demo bar and cover none of its controls', JSON.stringify(during));
  await shot(page, 'demo_running_390.png');
  await page.eval(`(window.__SPINE_DEMO__.exit(), true)`);
  await sleep(600);
  const restored = await page.eval(`({ active: window.__SPINE_DEMO__.state().active, pi: ${T}.getState().params.pi, dirty: ${T}.getCaseHistory().dirty,
    slider: document.getElementById('piSlider').value })`);
  check(!restored.active && restored.pi === 65 && restored.slider === '65' && restored.dirty === true,
    'Exit demo restores the edited case (still marked as edited)', JSON.stringify(restored));
  check(page.errors.length === 0, 'no page errors in the demo flow', page.errors.join(' | '));
  await page.close();
}

/* ---- Q8 / Q10 / Q13 ---- */
async function panelsFlow(browser) {
  const page = await openApp(browser);
  // Q8: PT 30 lies outside the 13-24 degree cohort span.
  await page.eval(`${T}.applyCaseExample('neutral-reference')`);
  await page.eval(`(() => { const s = document.getElementById('ptSlider'); s.value = '30'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(200);
  await page.clickSelector('#openShowcase');
  await sleep(300);
  const showcase = await page.eval(`(() => { const c = document.getElementById('showcaseGaitCaveat');
    return { hidden: c.hidden, text: c.textContent, directions: Array.from(document.querySelectorAll('#showcaseGait .showcase-delta[data-dir]')).length }; })()`);
  await shot(page, 'showcase_pt30.png');
  check(!showcase.hidden && /outside the published cohort span/.test(showcase.text) && showcase.directions === 0,
    'the showcase gait section names extrapolation and drops the improvement colouring when PT is outside 13–24°', JSON.stringify(showcase));
  await page.eval(`(document.getElementById('closeShowcase').click(), true)`);
  await page.eval(`(() => { const s = document.getElementById('ptSlider'); s.value = '18'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await page.clickSelector('#openShowcase');
  await sleep(300);
  const inside = await page.eval(`({ hidden: document.getElementById('showcaseGaitCaveat').hidden })`);
  check(inside.hidden === true, 'inside the cohort span the caveat is not shown', JSON.stringify(inside));
  await page.eval(`(document.getElementById('closeShowcase').click(), true)`);

  // Q10: a refused Cobb entry leaves a visible note after the field is left.
  await page.eval(`(() => { const d = document.querySelector('.guided-advanced-inputs'); if (d) d.open = true; return true; })()`);
  await retype(page, '#primaryCobbInput', '45');
  await retype(page, '#primaryCobbInput', '250');
  await page.eval(`document.getElementById('primaryCobbInput').blur()`);
  await sleep(100);
  const cobb = await page.eval(`(() => { const e = document.getElementById('primaryCobbInputError'); return { value: document.getElementById('primaryCobbInput').value,
    note: e && !e.hidden ? e.textContent : null, state: ${T}.getState().globalDeformity.coronalMagnitude }; })()`);
  // Typing commits each valid prefix ("2", "25"), so the kept value is the
  // last valid one; the point is that the refusal stays visible.
  check(cobb.value === String(cobb.state) && /250 was not accepted/.test(cobb.note || '') && new RegExp('kept at ' + cobb.state + '°').test(cobb.note || ''),
    'a refused Cobb entry stays explained after blur, with the kept value', JSON.stringify(cobb));

  // Q13: the third pasted film replaces a staged one, and says so.
  const paste = await page.eval(`(async () => {
    const dialog = document.getElementById('patientImagingDialog');
    if (!dialog.open) document.getElementById('openPatientImaging').click();
    const fire = (el, t) => el && el.dispatchEvent(new Event(t, { bubbles: true }));
    const r = document.querySelector('input[name="imagingPath"][value="radiographs"]'); if (r) { r.checked = true; fire(r, 'change'); }
    const a = document.getElementById('imagingAuthorization'); if (a && !a.checked) { a.checked = true; fire(a, 'change'); }
    const make = async shade => { const c = document.createElement('canvas'); c.width = 420; c.height = 900; const g = c.getContext('2d');
      g.fillStyle = 'rgb(' + shade + ',' + shade + ',' + shade + ')'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#ddd'; g.fillRect(190, 60, 40, 780);
      const blob = await new Promise(res => c.toBlob(res, 'image/png')); return new File([blob], 'image.png', { type: 'image/png' }); };
    const statuses = [];
    for (const shade of [20, 40, 60]) {
      await acceptImagingFiles([await make(shade)], { origin: 'paste' });
      statuses.push(document.getElementById('imagingDropStatus') ? document.getElementById('imagingDropStatus').textContent : (imagingEls.dropStatus || {}).textContent);
    }
    return statuses;
  })()`);
  check(Array.isArray(paste) && /added from the clipboard/.test(paste[0]) && /added from the clipboard/.test(paste[1]) && /Replaced the frontal film/.test(paste[2]),
    'a third pasted film reports that it replaced the staged frontal film', JSON.stringify(paste));
  check(page.errors.length === 0, 'no page errors in the showcase, input and paste flows', page.errors.join(' | '));
  await page.close();
}

/* ---- Q1 / Q3 / Q9: staged film (internal sample fixture) ---- */
async function filmFlow(browser) {
  const sample = path.join(ROOT, 'samples', '2-1.jpg');
  if (!fs.existsSync(sample)) { notes.push('samples/2-1.jpg absent: film flow (Q1/Q3/Q9) skipped'); return; }
  const page = await openApp(browser);
  await page.eval(`(() => {
    const fire = (el, t) => el && el.dispatchEvent(new Event(t, { bubbles: true }));
    if (!document.getElementById('patientImagingDialog').open) document.getElementById('openPatientImaging').click();
    const r = document.querySelector('input[name="imagingPath"][value="radiographs"]'); if (r) { r.checked = true; fire(r, 'change'); }
    const a = document.getElementById('imagingAuthorization'); if (a && !a.checked) { a.checked = true; fire(a, 'change'); }
    const px = document.getElementById('imagingPixelReview'); if (px && !px.checked) { px.checked = true; fire(px, 'change'); }
    document.getElementById('autoLandmarkRunOnStage').checked = true;
    return true; })()`);
  await sleep(200);
  await page.setFiles('#standingPaInput', [sample]);
  for (let i = 0; i < 120; i += 1) {
    if (!(await page.eval(`typeof imagingChecksPending === 'function' ? imagingChecksPending() : false`))) break;
    await sleep(250);
  }
  await page.eval(`(document.getElementById('stagePatientImaging').click(), true)`);
  const t0 = Date.now();
  await sleep(600);
  while (Date.now() - t0 < 240000) {
    const s = await page.eval(`({ st: document.getElementById('autoLandmarkStatus').dataset.state, running: !!window.__SPINE_AUTOCAL__.resultState.running })`);
    if (s.st !== 'running' && !s.running) break;
    await sleep(300);
  }
  const frontal = await page.eval(`(() => { const f = window.__SPINE_AUTOCAL__.resultState.frontal; if (!f) return null;
    return { engine: f.engine || 'classical', primary: f.values.coronalMagnitude, secondary: f.values.compensatoryCobb, rejection: f.analysis && f.analysis.neuralRejection || null,
      status: (document.getElementById('autoLandmarkNeuralStatus') || {}).textContent || '' }; })()`);
  check(frontal && Number.isFinite(frontal.primary) && (frontal.secondary == null || frontal.primary >= frontal.secondary),
    'the automatic primary Cobb is never smaller than the secondary Cobb (samples/2-1.jpg)', JSON.stringify(frontal));
  if (frontal && frontal.rejection && !/neural/i.test(frontal.engine)) {
    check(/rejected/.test(frontal.status) && !/vertebrae proposed/.test(frontal.status),
      'a rejected neural pass is named in the neural status line', JSON.stringify(frontal));
  } else notes.push(`neural status check not exercised (engine ${frontal && frontal.engine}, rejection ${frontal && frontal.rejection})`);
  // Q1: zoom twice with real clicks; the toolbar must stay on top and work.
  const figure = '#autoLandmarkFrontalFigure';
  await page.clickSelector(`${figure} .rg-view-tools button[data-tool="zoomIn"]`);
  await sleep(150);
  await page.clickSelector(`${figure} .rg-view-tools button[data-tool="zoomIn"]`);
  await sleep(250);
  const zoomed = await page.eval(`(() => {
    const fig = document.querySelector(${JSON.stringify(figure)}), canvas = fig.querySelector('canvas');
    const blocked = Array.from(fig.querySelectorAll('.rg-view-tools button[data-tool]')).filter(b => !b.hidden && b.offsetWidth).filter(b => {
      const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !(hit && b.contains(hit)); }).map(b => b.dataset.tool);
    return { transform: canvas.style.transform, blocked };
  })()`);
  await page.eval(`(document.querySelector(${JSON.stringify(figure)}).scrollIntoView({ block: 'center' }), true)`);
  await shot(page, 'film_zoomed.png');
  check(/scale\(/.test(zoomed.transform) && zoomed.blocked.length === 0, 'after zooming the film, every view tool is still on top', JSON.stringify(zoomed));
  await page.clickSelector(`${figure} .rg-view-tools button[data-tool="fit"]`);
  await sleep(250);
  const fitted = await page.eval(`document.querySelector(${JSON.stringify(figure)} + ' canvas').style.transform`);
  check(fitted === '', 'a real click on Fit resets the zoom', fitted);
  check(page.errors.length === 0, 'no page errors in the film flow', page.errors.join(' | '));
  await page.close();
}

(async () => {
  const browser = await launch({ headless: true });
  const flows = [caseFileSecurityFlow, buildContentFlow, gaitFlow, demoFlow, panelsFlow, filmFlow];
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
