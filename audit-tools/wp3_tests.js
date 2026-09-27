#!/usr/bin/env node
'use strict';
// WP3 -- radiograph results, provenance, export and DICOM integration, in a
// real browser (Chrome via CDP) under the app's own CSP.
//
//   node audit-tools/wp3_tests.js <build.html> [--headed] [--shots <dir>]
//
// Covers: F011/F059 (orientation change keeps detector confidences), F010
// (.42 pre-check), F041 (row choices survive redraws), F040/F064 (unchecked
// and stale transfers never applied), F048/F063 (per-field provenance; case
// defaults are not measurements), F052/F076 (review export: overlay PNGs +
// JSON, no file names or DICOM identifiers; copy text), F053 (manual readout),
// F065 (step progress), F075 (hardware caution never the "most likely
// cause"), F025/F026 (plain-language DICOM failures, dropped plane headline),
// F028 (no screen-capture claim for DICOM), F023/F024 (header orientation,
// laterality, swapped slots, magnification-corrected spacing).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, fileUrl, sleep } = require('./cdp.js');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const FIX = path.join(ROOT, 'ai-tools', 'dicom-tests', 'fixtures');
const build = process.argv[2];
if (!build || !fs.existsSync(build)) {
  console.error('usage: node audit-tools/wp3_tests.js <build.html> [--headed] [--shots <dir>]');
  process.exit(2);
}
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

let passed = 0, failed = 0;
const failures = [];
function check(cond, label, detail) {
  if (cond) { passed++; return true; }
  failed++; failures.push({ label, detail: detail === undefined ? null : JSON.stringify(detail).slice(0, 600) });
  console.log('  FAIL: ' + label + (detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 300)));
  return false;
}

// ---- Minimal DICOM writer: a sample JPEG wrapped as JPEG Baseline DX with
// view / orientation / spacing / magnification tags and dummy identifiers
// (which must never reach the review export).
function el(g, e, vr, val) {
  let v = Buffer.isBuffer(val) ? val : Buffer.from(val, 'latin1');
  if (v.length % 2) v = Buffer.concat([v, Buffer.from([vr === 'UI' || vr === 'OB' ? 0 : 0x20])]);
  const long = ['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr);
  const h = Buffer.alloc(long ? 12 : 8);
  h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.write(vr, 4, 'latin1');
  if (long) h.writeUInt32LE(v.length, 8); else h.writeUInt16LE(v.length, 6);
  return Buffer.concat([h, v]);
}
const us = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
function jpegSize(jpg) {
  for (let p = 2; p + 9 < jpg.length;) {
    if (jpg[p] !== 0xFF) throw new Error('bad JPEG');
    const m = jpg[p + 1], len = jpg.readUInt16BE(p + 2);
    if (m >= 0xC0 && m <= 0xC3) return { rows: jpg.readUInt16BE(p + 5), cols: jpg.readUInt16BE(p + 7), comps: jpg[p + 9] };
    p += 2 + len;
  }
  throw new Error('no SOF');
}
const SOP_UID = '2.25.31415926535897932384';
function wrapJpeg(jpg, { view, orientation, imagerSpacing, ermf }) {
  const { rows, cols, comps } = jpegSize(jpg);
  const metaBody = Buffer.concat([el(2, 1, 'OB', Buffer.from([0, 1])), el(2, 2, 'UI', '1.2.840.10008.5.1.4.1.1.1.1'),
    el(2, 3, 'UI', SOP_UID), el(2, 0x10, 'UI', '1.2.840.10008.1.2.4.50')]);
  // Tags in ascending order, as the standard requires.
  const ds = Buffer.concat([
    el(8, 0x16, 'UI', '1.2.840.10008.5.1.4.1.1.1.1'), el(8, 0x18, 'UI', SOP_UID), el(8, 0x60, 'CS', 'DX'),
    el(0x10, 0x10, 'PN', 'WP3^PRIVACY^CANARY'), el(0x10, 0x20, 'LO', 'MRN-WP3-CANARY'),
    el(0x18, 0x1114, 'DS', String(ermf)), el(0x18, 0x1164, 'DS', `${imagerSpacing}\\${imagerSpacing}`), el(0x18, 0x5101, 'CS', view),
    el(0x20, 0x20, 'CS', orientation),
    el(0x28, 2, 'US', us(comps)), el(0x28, 4, 'CS', comps === 3 ? 'YBR_FULL_422' : 'MONOCHROME2'),
    ...(comps === 3 ? [el(0x28, 6, 'US', us(0))] : []),
    el(0x28, 0x10, 'US', us(rows)), el(0x28, 0x11, 'US', us(cols)), el(0x28, 0x100, 'US', us(8)), el(0x28, 0x101, 'US', us(8)),
    el(0x28, 0x102, 'US', us(7)), el(0x28, 0x103, 'US', us(0))]);
  const frag = jpg.length % 2 ? Buffer.concat([jpg, Buffer.from([0])]) : jpg;
  const item = (tag2, len) => { const b = Buffer.alloc(8); b.writeUInt16LE(0xFFFE, 0); b.writeUInt16LE(tag2, 2); b.writeUInt32LE(len, 4); return b; };
  const px = Buffer.concat([Buffer.from([0xE0, 0x7F, 0x10, 0x00, 0x4F, 0x42, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF]), item(0xE000, 0), item(0xE000, frag.length), frag, item(0xE0DD, 0)]);
  const gl = Buffer.alloc(4); gl.writeUInt32LE(metaBody.length);
  return Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), el(2, 0, 'UL', gl), metaBody, ds, px]);
}

// The film flows need the internal sample radiographs (samples/1.jpg, samples/2.jpg), which are
// not part of the public repository (unrecorded provenance). Without them this suite is skipped.
if (!fs.existsSync(path.join(SAMPLES, '1.jpg')) || !fs.existsSync(path.join(SAMPLES, '2.jpg'))) {
  console.log(JSON.stringify({ passed: 0, failed: 0, skipped: true, note: 'samples/1.jpg and samples/2.jpg absent: wp3 film flows skipped' }, null, 2));
  process.exit(0);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wp3-'));
const AP_DCM = path.join(TMP, 'wp3_ap_view.dcm'), LAT_DCM = path.join(TMP, 'wp3_lat_view.dcm');
fs.writeFileSync(AP_DCM, wrapJpeg(fs.readFileSync(path.join(SAMPLES, '1.jpg')), { view: 'AP', orientation: 'L\\F', imagerSpacing: 0.15, ermf: 1.15 }));
fs.writeFileSync(LAT_DCM, wrapJpeg(fs.readFileSync(path.join(SAMPLES, '2.jpg')), { view: 'LL', orientation: 'A\\F', imagerSpacing: 0.15, ermf: 1.18 }));

const ROWS = `Array.from(document.querySelectorAll('#autoLandmarkResults input[data-auto-key]')).map(b => ({ key: b.dataset.autoKey, checked: b.checked, disabled: b.disabled,
  text: (b.closest('label').querySelector('small') || {}).textContent || '', value: (b.closest('label').querySelector('.auto-result-value') || {}).textContent || '' }))`;
const WS = `({ pi: imagingEls.measurementPi.value, ll: imagingEls.measurementLl.value, tk: imagingEls.measurementTk.value, cl: imagingEls.measurementCl.value,
  pt: imagingEls.measurementPt.value, sva: imagingEls.measurementSva.value, primary: imagingEls.measurementPrimaryCobb.value,
  secondary: imagingEls.measurementSecondaryCobb.value, translation: imagingEls.measurementTranslation.value, direction: imagingEls.measurementPrimaryDirection.value })`;
const STATUS = `({ text: document.getElementById('autoLandmarkStatus').textContent, state: document.getElementById('autoLandmarkStatus').dataset.state,
  notes: Array.from(document.querySelectorAll('#autoLandmarkStatusNotes li')).map(li => li.textContent) })`;
const IMAGING = `(() => { const p = state.patientImaging; return { applied: p.appliedMeasurements, source: p.measurementSource, qa: p.qaStatus,
  sources: p.measurementSources || null, defaults: p.caseDefaultsNotApplied || null, alignmentApplied: p.alignmentApplied,
  perKey: p.autoCalibration ? p.autoCalibration.perKeySource : null, engines: p.autoCalibration ? p.autoCalibration.engines : null }; })()`;

async function openIntake(page, { runOnStage = true } = {}) {
  await page.eval(`(() => {
    const fire = (el, t) => el && el.dispatchEvent(new Event(t, { bubbles: true }));
    const dialog = document.getElementById('patientImagingDialog');
    if (dialog && !dialog.open) document.getElementById('openPatientImaging').click();
    const r = document.querySelector('input[name="imagingPath"][value="radiographs"]'); if (r) { r.checked = true; fire(r, 'change'); }
    const a = document.getElementById('imagingAuthorization'); if (a && !a.checked) { a.checked = true; fire(a, 'change'); }
    const px = document.getElementById('imagingPixelReview'); if (px && !px.checked) { px.checked = true; fire(px, 'change'); }
    const n = document.getElementById('autoLandmarkNeural'); if (n && n.checked) { n.checked = false; fire(n, 'change'); }
    document.getElementById('autoLandmarkRunOnStage').checked = ${runOnStage};
    return true; })()`);
  await sleep(200);
}
async function waitIdle(page, ms = 180000) {
  const t0 = Date.now(); await sleep(400);
  while (Date.now() - t0 < ms) {
    const s = await page.eval(`({ st: document.getElementById('autoLandmarkStatus').dataset.state, running: !!window.__SPINE_AUTOCAL__.resultState.running,
      pending: typeof imagingChecksPending === 'function' ? imagingChecksPending() : false })`);
    if (s.st !== 'running' && !s.running && !s.pending) return Date.now() - t0;
    await sleep(250);
  }
  return -1;
}
async function stage(page, frontal, lateral, beforeStage) {
  if (frontal) await page.setFiles('#standingPaInput', [frontal]);
  await sleep(300);
  if (lateral) await page.setFiles('#standingLateralInput', [lateral]);
  // The intake checks each file's content (a full decode for DICOM) first.
  for (let i = 0; i < 120; i++) {
    if (!(await page.eval(`typeof imagingChecksPending === 'function' ? imagingChecksPending() : false`))) break;
    await sleep(250);
  }
  await sleep(300);
  if (beforeStage) await beforeStage();
  // Record every status text during the run (F065 progress).
  await page.eval(`(() => { window.__wp3Status = []; const s = document.getElementById('autoLandmarkStatus');
    if (window.__wp3Observer) window.__wp3Observer.disconnect();
    window.__wp3Observer = new MutationObserver(() => window.__wp3Status.push(s.dataset.state + '|' + s.textContent));
    window.__wp3Observer.observe(s, { childList: true, characterData: true, subtree: true, attributes: true }); return true; })()`);
  await page.eval(`(document.getElementById('stagePatientImaging').click(), true)`);
  await sleep(300);
  return waitIdle(page);
}
const setSelect = (page, id, value) => page.eval(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(value)};
  s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const setRows = (page, map) => page.eval(`(() => { const want = ${JSON.stringify(map)};
  document.querySelectorAll('#autoLandmarkResults input[data-auto-key]').forEach(b => {
    if (!(b.dataset.autoKey in want) || b.disabled) return; b.checked = want[b.dataset.autoKey]; b.dispatchEvent(new Event('change', { bubbles: true })); });
  return true; })()`);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot(path.join(SHOTS, name)); } };

async function main() {
  const b = await launch({ headless: !process.argv.includes('--headed') });
  try {
    const page = await b.open(fileUrl(path.resolve(build)), { width: 1440, height: 1000 });
    await page.unlock();
    await page.eval(`(window.__csp = [], document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)), true)`);
    await page.clickSelector('#introExplore'); await sleep(600);
    // Downloads are recorded instead of navigating.
    await page.eval(`(() => { window.__wp3Downloads = []; const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__wp3Downloads.push({ name: this.download, href: this.href.slice(0, 5) }); return; } return click.call(this); }; return true; })()`);

    // ---------------- Unit-level checks on the module surface -------------
    console.log('== helpers');
    const helpers = await page.eval(`(() => { const M = window.__SPINE_AUTOCAL__;
      const fail = M.plainDicomFailure({ ok: false, reason: 'jpeg2000_unsupported', transferSyntaxUID: '1.2.840.10008.1.2.4.90' });
      const trunc = M.plainDicomFailure({ ok: false, reason: 'pixel_data_truncated' });
      const sp = info => M.dicomPatientSpacing(info);
      return { fail, trunc,
        ermf: sp({ pixelSpacingMm: { row: .15, col: .15, source: 'ImagerPixelSpacing' }, calibration: { estimatedRadiographicMagnificationFactor: 1.18 } }),
        sid: sp({ pixelSpacingMm: { row: .15, col: .15, source: 'ImagerPixelSpacing' }, calibration: { distanceSourceToDetectorMm: 1800, distanceSourceToPatientMm: 1500 } }),
        plain: sp({ pixelSpacingMm: { row: .15, col: .15, source: 'ImagerPixelSpacing' }, calibration: {} }),
        calibrated: sp({ pixelSpacingMm: { row: .13, col: .13, source: 'PixelSpacing' }, calibration: { pixelSpacingCalibrationType: 'GEOMETRY' } }),
        uncalibrated: sp({ pixelSpacingMm: { row: .13, col: .13, source: 'PixelSpacing' }, calibration: {} }) }; })()`);
    check(/JPEG 2000/.test(helpers.fail) && /Explicit VR Little Endian/.test(helpers.fail) && !/_unsupported|1\.2\.840/.test(helpers.fail), 'F026 a JPEG 2000 failure reads as a named format plus re-export advice, no reason code or UID', helpers.fail);
    check(/incomplete or damaged/.test(helpers.trunc), 'F026 a truncated file is explained in words', helpers.trunc);
    check(Math.abs(helpers.ermf.value - 0.15 / 1.18) < 1e-6 && /÷ magnification factor 1\.180/.test(helpers.ermf.text), 'F024 ImagerPixelSpacing is divided by ERMF and the text says so', helpers.ermf);
    check(Math.abs(helpers.sid.value - 0.15 / 1.2) < 1e-6 && /source-to-detector/.test(helpers.sid.text), 'F024 SID/SOD give the magnification when ERMF is absent', helpers.sid);
    check(helpers.plain.value === 0.15 && /not magnification-corrected/.test(helpers.plain.text), 'F024 uncorrected detector spacing is labelled as such', helpers.plain);
    check(helpers.calibrated.value === 0.13 && /calibrated, type GEOMETRY/.test(helpers.calibrated.text) && /no calibration type/.test(helpers.uncalibrated.text), 'F024 PixelSpacing is caveated when the calibration type is absent', [helpers.calibrated, helpers.uncalibrated]);
    const f028 = await page.eval(`(() => { const M = window.__SPINE_AUTOCAL__, rs = M.resultState, keep = rs.frontal;
      const A = { fieldCropped: true, sourceFieldWidth: 400, sourceFieldHeight: 1600, sourceWidth: 1000, sourceHeight: 2000, height: 1600 };
      rs.frontal = { analysis: { ...A, dicom: { modality: 'DX' } } }; const dicom = M.imageQualityWarnings();
      rs.frontal = { analysis: A }; const raster = M.imageQualityWarnings();
      rs.frontal = keep; return { dicom, raster }; })()`);
    check(!f028.dicom.some(n => /screenshot|viewer interface|screen capture/.test(n)) && f028.raster.some(n => /screenshot/.test(n)), 'F028 a DICOM with a small exposed field is never called a screen capture', f028);

    // ---------------- JPG pair: run, orientation, selection, transfer --------
    console.log('== JPG pair');
    await openIntake(page);
    const t1 = await stage(page, path.join(SAMPLES, '1.jpg'), path.join(SAMPLES, '2.jpg'));
    check(t1 > 0, 'JPG pair run finished', t1);
    const progress = await page.eval('window.__wp3Status');
    check(progress.some(s => /^running\|Step 1 of \d: /.test(s)) && progress.some(s => /^running\|Step [2-9] of \d: /.test(s)), 'F065 the run reports numbered steps while it works', progress.slice(0, 8));
    let st = await page.eval(STATUS);
    check(!st.notes.some(n => /^Most likely cause: if this patient has previous instrumentation/.test(n)) && /^Standing caution: /.test(st.notes[st.notes.length - 1] || ''), 'F075 the hardware caution is last and never the "most likely cause"', st.notes);
    let rows = await page.eval(ROWS);
    const conf = await page.eval('({ ...window.__SPINE_AUTOCAL__.resultState.lateral.confidences })');
    const checkedLow = rows.filter(r => r.checked && /· low ·|\blow\b/.test(r.text) && !/placed by you/.test(r.text));
    check(checkedLow.length === 0, 'F010 no row labelled low is pre-selected (.42 threshold)', checkedLow);
    const dirRow = rows.find(r => r.key === 'coronalDirection');
    check(dirRow && !dirRow.checked && /NOT CONFIRMED/.test(dirRow.text), 'F023 with the frontal side unconfirmed the apex side is labelled and not pre-selected', dirRow);
    // F059 (edit path): the 55% reviewed floor is given per value, only to a
    // value whose own lines or points were moved. A stray edit elsewhere (here
    // the apex point, which Primary Cobb is not measured from) runs the real
    // edit path and must leave Primary Cobb at the detector confidence.
    const stray = await page.eval(`(() => { const M = window.__SPINE_AUTOCAL__, f = M.resultState.frontal;
      if (!f || !f.primary || !f.detectorConfidences || typeof M.recomputeFrontalFromEdits !== 'function') return { missing: true };
      const key = 'coronalMagnitude', detector = f.detectorConfidences[key], line = f.lines[f.primary.i];
      const saved = { confidences: { ...f.confidences }, hadApex: 'manualApex' in f, apex: f.manualApex, edited: line.userEdited };
      const row = () => M.resultDefinitions().find(r => r.key === key);
      const auto = f.centers[f.apexIndex];
      f.manualApex = { x: auto.x, y: auto.y }; M.recomputeFrontalFromEdits(f); M.renderResults();
      const untouched = row(), untouchedChecked = document.querySelector('#autoLandmarkResults input[data-auto-key="coronalMagnitude"]').checked;
      const apexRow = M.resultDefinitions().find(r => r.key === 'coronalDirection');
      line.userEdited = true; M.recomputeFrontalFromEdits(f); M.renderResults(); const edited = row();
      line.userEdited = saved.edited; if (saved.hadApex) f.manualApex = saved.apex; else delete f.manualApex;
      f.confidences = saved.confidences; M.renderResults();
      return { detector, untouched: untouched.confidence, untouchedOrigin: untouched.origin, untouchedChecked, apexOrigin: apexRow && apexRow.origin,
        edited: edited.confidence, editedOrigin: edited.origin }; })()`);
    check(!stray.missing && Math.abs(stray.untouched - stray.detector) < 1e-9 && stray.untouchedOrigin === 'auto_beta' && (stray.detector >= .42 || !stray.untouchedChecked)
      && stray.apexOrigin === 'auto_beta_user_adjusted'
      && stray.edited >= .55 && stray.editedOrigin === 'auto_beta_user_adjusted', 'F059 a stray edit keeps untouched values at the detector confidence; a moved line gets the reviewed floor', stray);
    const lateralRows = rows.filter(r => ['ll', 'tk', 'cl', 'measuredSva'].includes(r.key) && r.value !== '—');
    check(lateralRows.every(r => /population level estimate/.test(r.text)), 'WP1 automatic lateral level rows are labelled population level estimates', lateralRows.map(r => r.text));
    await shot(page, 'wp3_jpg_run.png');

    // F011/F059: re-selecting / choosing the anterior side keeps confidences.
    await setSelect(page, 'autoLandmarkAnteriorSide', 'right');
    const confRight = await page.eval('({ ...window.__SPINE_AUTOCAL__.resultState.lateral.confidences })');
    await setSelect(page, 'autoLandmarkAnteriorSide', 'right');
    const confAgain = await page.eval('({ ...window.__SPINE_AUTOCAL__.resultState.lateral.confidences })');
    // The reference is the same film analysed with the side declared up front.
    const declaredUpFront = await page.eval(`(() => { const M = window.__SPINE_AUTOCAL__, rs = M.resultState;
      return { ...M.analyzeLateral(rs.lateral.analysis, M.ui.lateralScale.value, 'right', rs.guides.lateral).confidences }; })()`);
    check(Object.keys(declaredUpFront).every(k => Math.abs((confRight[k] || 0) - (declaredUpFront[k] || 0)) < 1e-9), 'F059 after choosing the side, confidences equal those of a run with the side declared up front', { before: conf, after: confRight, upFront: declaredUpFront });
    check(Object.keys(confRight).every(k => Math.abs((confAgain[k] || 0) - (confRight[k] || 0)) < 1e-9), 'F011 re-selecting the same side changes no confidence', { first: confRight, again: confAgain });
    check(Object.values(confRight).every(v => !(Math.abs(v - .55) < 1e-9)), 'F059 no value is floored to 55% without a user edit', confRight);
    rows = await page.eval(ROWS);
    const lowChecked = rows.filter(r => r.checked && /· low ·/.test(r.text));
    check(lowChecked.length === 0, 'F059 no low-confidence row becomes pre-selected after the orientation change', lowChecked);
    st = await page.eval(STATUS);
    check(/confidence did not change/i.test(st.text), 'F011 the orientation message says confidences did not change', st.text);

    // F041: unchecks survive a redraw, a window change and a drag-free render.
    await setRows(page, Object.fromEntries(rows.map(r => [r.key, false])));
    await setSelect(page, 'autoLandmarkWindow', 'original');
    await page.eval('(window.__SPINE_AUTOCAL__.renderResults(), true)');
    rows = await page.eval(ROWS);
    check(rows.every(r => !r.checked), 'F041 unchecked rows stay unchecked after a window change and redraw', rows.filter(r => r.checked));
    await setSelect(page, 'autoLandmarkWindow', 'enhanced');

    // F053: manual cervical points with the side withheld, then declared.
    const readout = await page.eval(`(() => { const M = window.__SPINE_AUTOCAL__, rs = M.resultState, A = rs.lateral.analysis;
      const cx = A.width / 2, y = A.height * .12;
      M.manual.points.lateral = { c2a: { x: cx + 30, y }, c2p: { x: cx - 30, y: y + 6 }, c7a: { x: cx + 30, y: y + 150 }, c7p: { x: cx - 30, y: y + 150 },
        l1a: { x: cx + 40, y: A.height * .55 }, l1p: { x: cx - 40, y: A.height * .56 }, s1a: { x: cx + 40, y: A.height * .78 }, s1p: { x: cx - 40, y: A.height * .74 } };
      // The change handler re-renders the results and the manual readout.
      const s = document.getElementById('autoLandmarkAnteriorSide'); s.value = 'auto'; s.dispatchEvent(new Event('change', { bubbles: true }));
      const before = document.getElementById('manualReadout').textContent;
      s.value = 'right'; s.dispatchEvent(new Event('change', { bubbles: true }));
      return { before, after: document.getElementById('manualReadout').textContent }; })()`).catch(e => ({ error: String(e) }));
    check(/C2–C7/.test(readout.before || '') && /choose anterior side/.test(readout.before || ''), 'F053 C2–C7 shows "choose anterior side" instead of vanishing', readout);
    check(/C2–C7\s*-?\d/.test((readout.after || '').replace(/\s+/g, ' ')) || /C2–C7[^a-z]*-?\d+\.\d°/.test(readout.after || ''), 'F053 the manual readout updates when the side is chosen', readout.after);
    rows = await page.eval(ROWS);
    const llRow = rows.find(r => r.key === 'll');
    check(llRow && /your manual landmarks/.test(llRow.text) && /automatic -?\d+\.\d° \(Δ [+-]/.test(llRow.text), 'F052 a manual value shows the automatic value and the difference', llRow);

    // Frontal side: declaring it re-derives the apex side and labels the source.
    const dirBefore = (await page.eval(ROWS)).find(r => r.key === 'coronalDirection');
    await setSelect(page, 'frontalLateralitySelect', 'left');
    const dirAfter = (await page.eval(ROWS)).find(r => r.key === 'coronalDirection');
    check(dirAfter && /your choice/.test(dirAfter.text) && !/NOT CONFIRMED/.test(dirAfter.text), 'F023 a declared frontal side is named as the user\'s choice', dirAfter);
    if (dirBefore && /Right|Left/.test(dirBefore.value)) check(dirAfter.value !== dirBefore.value, 'F023 changing the patient side re-derives an existing apex side', [dirBefore.value, dirAfter.value]);

    // F040/F064: transfer, uncheck, transfer again, apply only selected.
    const before = await page.eval('({ secondary: state.globalDeformity.compensatoryCobb, pi: state.params.pi, pt: state.params.pt })');
    await setRows(page, { coronalMagnitude: true, compensatoryCobb: true, ll: true });
    await page.eval(`(document.getElementById('transferAutoLandmark').click(), true)`);
    const ws1 = await page.eval(WS);
    check(ws1.primary !== '' && ws1.ll !== '', 'transfer #1 fills the selected worksheet fields', ws1);
    await setRows(page, { compensatoryCobb: false });
    await page.eval(`(document.getElementById('transferAutoLandmark').click(), true)`);
    const ws2 = await page.eval(WS);
    check(ws1.secondary === '' || ws2.secondary === '', 'F064 an unchecked row\'s earlier transfer is removed from the worksheet', { ws1, ws2 });
    st = await page.eval(STATUS);
    // Rows now: primary auto, ll manual. Apply selected applies only those.
    await page.eval(`(document.getElementById('applyAutoLandmark').click(), true)`); await sleep(400);
    let im = await page.eval(IMAGING);
    const after = await page.eval('({ secondary: state.globalDeformity.compensatoryCobb, pi: state.params.pi, pt: state.params.pt })');
    check(im.alignmentApplied && !im.applied.includes('compensatoryCobb') && after.secondary === before.secondary, 'F040 an unchecked value is not applied', { im, before, after });
    check(im.sources && im.sources.ll === 'manual_landmarks' && /^auto_beta/.test(im.sources.coronalMagnitude || ''), 'F048 each applied key records its own origin', im.sources);
    check(im.source === 'mixed' && im.qa === 'experimental_auto_landmarks_applied_unvalidated', 'F048 mixed manual + auto provenance is recorded as mixed and experimental', im);
    check(im.perKey && im.perKey.ll === 'manual_landmarks' && im.engines && im.engines.frontal, 'F048 the review provenance record carries per-key sources and engines', { perKey: im.perKey, engines: im.engines });

    // Manual-only apply through the same button.
    await openIntake(page);
    await setRows(page, Object.fromEntries((await page.eval(ROWS)).map(r => [r.key, r.key === 'll'])));
    await page.eval(`(document.getElementById('applyAutoLandmark').click(), true)`); await sleep(400);
    im = await page.eval(IMAGING);
    check(im.source === 'user_placed_manual_landmarks' && im.qa === 'manual_landmark_measurements_applied_to_reference_alignment' && im.applied.join() === 'll', 'F048 manual-only values are recorded as user-placed landmarks', im);

    // F063: case defaults are not measurements; a typed value is user_entered.
    await openIntake(page);
    await page.eval(`(document.getElementById('prefillImagingMeasurements').click(), true)`);
    const prefillOnly = await page.eval(`(() => { const ok = applyImagingMeasurementsToModel(); return { ok, msg: document.getElementById('imagingMeasurementStatus').textContent }; })()`);
    check(prefillOnly.ok === false && /current case values/.test(prefillOnly.msg), 'F063 applying untouched case defaults applies nothing and says why', prefillOnly);
    await page.eval(`(() => { const i = imagingEls.measurementPi; i.value = String(Number(i.value) + 1); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await page.eval(`(document.getElementById('applyImagingMeasurements').click(), true)`); await sleep(300);
    im = await page.eval(IMAGING);
    check(im.applied.join() === 'pi' && im.sources && im.sources.pi === 'user_entered' && im.source === 'explicit_user_entered_from_staged_standing_images' && (im.defaults || []).length >= 8,
      'F063 only the edited field is applied, as user-entered; the untouched defaults are listed as not applied', im);

    // F064: a transfer, then a re-run, removes the stale automatic transfer.
    await openIntake(page);
    await page.eval('(clearImagingMeasurementInputs(), true)');
    await setRows(page, { coronalMagnitude: true });
    await page.eval(`(document.getElementById('transferAutoLandmark').click(), true)`);
    const wsBeforeRun = await page.eval(WS);
    await page.eval('(window.__SPINE_AUTOCAL__.run(), true)');
    await waitIdle(page);
    const wsAfterRun = await page.eval(WS);
    st = await page.eval(STATUS);
    check(wsBeforeRun.primary !== '' && wsAfterRun.primary === '' && st.notes.some(n => /removed; transfer again/.test(n)), 'F064 re-running removes automatic values transferred from the previous result', { wsBeforeRun, wsAfterRun, notes: st.notes.slice(0, 3) });

    // F052/F076: export.
    const copyText = await page.eval('window.__SPINE_AUTOCAL__.measurementsText()');
    check(/research\/education use; not clinically validated/.test(copyText) && /Primary Cobb: /.test(copyText) && !/1\.jpg|2\.jpg|samples/.test(copyText), 'F052 copy text lists values with origin and no file names', copyText.slice(0, 400));
    const bundle = await page.eval(`(async () => { const r = await window.__SPINE_AUTOCAL__.buildReviewBundle({ images: true });
      const bytes = new Uint8Array(await r.blob.arrayBuffer()); let pngs = 0;
      for (let i = 0; i + 3 < bytes.length; i++) if (bytes[i] === 0x89 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x47) pngs++;
      return { name: r.name, files: r.files, size: bytes.length, pk: bytes[0] === 0x50 && bytes[1] === 0x4B, pngs,
        json: JSON.stringify(r.data) }; })()`);
    const data = JSON.parse(bundle.json);
    check(bundle.pk && bundle.files.includes('review.json') && bundle.files.includes('frontal_overlay.png') && bundle.files.includes('lateral_overlay.png') && bundle.pngs === 2,
      'F076 the review bundle is a zip with review.json and an overlay PNG per plane', { name: bundle.name, files: bundle.files, pngs: bundle.pngs });
    check(!/1\.jpg|2\.jpg|samples[\\/]/.test(bundle.json) && data.privacy && data.privacy.fileNames === false && data.privacy.dicomIdentifiers === false, 'F076 the review JSON holds no file names', data.privacy);
    check(data.planes.frontal.automatic && data.planes.frontal.automatic.engine && data.planes.lateral.automatic && data.planes.lateral.automatic.levelNames,
      'F076 the JSON records engines and the lateral level-name status', { f: data.planes.frontal.automatic && data.planes.frontal.automatic.engine, l: data.planes.lateral.automatic && data.planes.lateral.automatic.levelNames });
    check(data.manualLandmarks.lateral && Number.isFinite(data.manualLandmarks.lateral.c2a.x) && data.declarations.lateralAnteriorSide.value === 'image-right' && data.declarations.frontalLaterality.source === 'chosen by the user',
      'F076 the JSON records landmarks in source pixels and the side declarations', data.declarations);
    check(data.measurements.some(m => m.key === 'll' && m.origin === 'manual_landmarks' && m.automatic) && data.app && 'buildId' in data.app,
      'F076 the JSON records per-value origin, the automatic comparison and the build', data.app);
    await page.eval(`(document.getElementById('downloadAutoLandmarkReview').click(), true)`);
    const confirmShown = await page.eval(`!document.getElementById('autoLandmarkReviewConfirm').hidden`);
    await page.eval(`(document.getElementById('downloadReviewJson').click(), true)`); await sleep(400);
    const downloads = await page.eval('window.__wp3Downloads');
    check(confirmShown && downloads.length === 1 && /^spine-review-.*\.json$/.test(downloads[0].name) && downloads[0].href === 'blob:', 'F076 Download review asks first, then saves a local blob with a neutral name', downloads);
    await shot(page, 'wp3_export.png');

    // ---------------- DICOM pair with header orientation -------------------
    console.log('== DICOM pair');
    await page.eval(`(document.getElementById('clearAutoLandmark') && window.__SPINE_AUTOCAL__.clearSession(), true)`);
    await openIntake(page);
    await setSelect(page, 'autoLandmarkAnteriorSide', 'auto');
    const t2 = await stage(page, AP_DCM, LAT_DCM);
    check(t2 > 0, 'DICOM pair run finished', t2);
    st = await page.eval(STATUS);
    const ctl = await page.eval(`({ side: document.getElementById('autoLandmarkAnteriorSide').value, sideFill: document.getElementById('autoLandmarkAnteriorSide').dataset.autofill || null,
      lat: document.getElementById('frontalLateralitySelect').value, latSource: document.getElementById('frontalLateralitySelect').dataset.source || null,
      proj: document.getElementById('frontalProjectionSelect').value, fs: document.getElementById('autoLandmarkFrontalScale').value, ls: document.getElementById('autoLandmarkLateralScale').value })`);
    check(ctl.side === 'right' && ctl.sideFill === 'dicom' && st.notes.some(n => /Lateral orientation was set from the DICOM header .*A\\F.*image-right/.test(n)), 'F023 the lateral anterior side comes from PatientOrientation A\\F and is stated', { ctl, notes: st.notes });
    check(ctl.lat === 'left' && ctl.latSource === 'dicom' && ctl.proj === 'ap', 'F023 frontal laterality defaults from PatientOrientation L\\F', ctl);
    check(Math.abs(Number(ctl.fs) - 0.15 / 1.15) < 1e-4 && Math.abs(Number(ctl.ls) - 0.15 / 1.18) < 1e-4, 'F024 spacing fields hold magnification-corrected values', ctl);
    check(st.notes.some(n => /÷ magnification factor 1\.180/.test(n)), 'F024 the notes state the magnification correction', st.notes);
    check(!st.notes.some(n => /\b[a-z]+_[a-z]+_[a-z_]+\b/.test(n)) && st.notes.some(n => /converted to greyscale/.test(n)), 'WP7 decoder warnings appear as sentences, not codes', st.notes);
    rows = await page.eval(ROWS);
    check(rows.some(r => r.key === 'cl' && !r.disabled) || rows.some(r => r.key === 'cl' && !/withheld until the anterior side/.test(r.text)), 'F023 C2–C7 is no longer withheld for a DICOM lateral with orientation', rows.find(r => r.key === 'cl'));
    const dicomJson = JSON.stringify(await page.eval('window.__SPINE_AUTOCAL__.buildReviewData()'));
    check(!dicomJson.includes('CANARY') && !dicomJson.includes(SOP_UID) && !/wp3_(ap|lat)_view/.test(dicomJson) && /"identityTagsRead":false/.test(dicomJson), 'F076 the DICOM review record has no identifiers, UIDs or file names', dicomJson.slice(0, 200));
    // A user choice is never overridden by the header.
    await setSelect(page, 'autoLandmarkAnteriorSide', 'left');
    await page.eval('(window.__SPINE_AUTOCAL__.run(), true)'); await waitIdle(page);
    const kept = await page.eval(`({ side: document.getElementById('autoLandmarkAnteriorSide').value, notes: Array.from(document.querySelectorAll('#autoLandmarkStatusNotes li')).map(li => li.textContent) })`);
    check(kept.side === 'left' && kept.notes.some(n => /your choice was kept/.test(n)), 'F023 a user-chosen anterior side is kept and the disagreement is stated', kept);
    await shot(page, 'wp3_dicom_run.png');

    // Swapped slots.
    console.log('== swapped DICOM slots');
    await page.eval('(window.__SPINE_AUTOCAL__.clearSession(), true)');
    await openIntake(page);
    await stage(page, LAT_DCM, AP_DCM);
    st = await page.eval(STATUS);
    check(st.state === 'warning' && /swapped/.test(st.text) && /frontal slot is a lateral view/.test(st.notes[0] || ''), 'F023 a lateral DICOM in the frontal slot is flagged first', st);

    // ---------------- DICOM failure paths ----------------------------------
    // The intake refuses files its own check cannot decode, so a failure at
    // analysis time (F025/F026) is simulated: the frontal decode is made to
    // fail with a JPEG 2000 reason after the intake check has passed.
    console.log('== DICOM failures');
    await page.eval('(window.__SPINE_AUTOCAL__.clearSession(), true)');
    await openIntake(page, { runOnStage: false });
    const apBytes = fs.statSync(AP_DCM).size;
    // Selection decodes each file once, shared by the intake check and the
    // analysis module. That first frontal decode passes the intake check but
    // carries no pixels, so the module refuses it and decodes again when the
    // pair is staged; that analysis decode fails with a JPEG 2000 reason.
    await page.eval(`(() => { const d = window.__SPINE_DICOM__; window.__wp3RealDecode = d.decodeRadiographAsync; window.__wp3FrontalDecodes = 0;
      d.decodeRadiographAsync = function (buffer, opts) {
        const frontal = buffer && buffer.byteLength === ${apBytes};
        if (frontal && window.__wp3FrontalDecodes++ > 0)
          return Promise.resolve({ ok: false, reason: 'jpeg2000_unsupported', transferSyntaxUID: '1.2.840.10008.1.2.4.90', message: 'raw decoder text' });
        const real = window.__wp3RealDecode.call(d, buffer, opts);
        return frontal ? Promise.resolve(real).then(r => ({ ...r, gray8: null })) : real; }; return true; })()`);
    await stage(page, AP_DCM, path.join(SAMPLES, '2.jpg'));
    st = await page.eval(STATUS);
    check(st.state === 'warning' && /Only part of the staged pair/.test(st.text) && st.notes.some(n => /^Frontal image could not be decoded: This DICOM image is stored as JPEG 2000/.test(n)) && !st.notes.some(n => /jpeg2000_unsupported|raw decoder text/.test(n)),
      'F025/F026 staging without a run reports the undecodable plane in words, not green', st);
    await page.eval('(window.__SPINE_AUTOCAL__.run(), true)'); await waitIdle(page);
    st = await page.eval(STATUS);
    check(/^Frontal image could not be analysed; only the lateral result is shown/.test(st.text) && st.state === 'warning' && /JPEG 2000/.test(st.notes[0] || ''), 'F026 the run headline leads with the dropped plane and the first note says why', st);
    await page.eval('(window.__SPINE_DICOM__.decodeRadiographAsync = window.__wp3RealDecode, true)');

    const csp = await page.eval('window.__csp');
    check(csp.length === 0, 'no CSP violation', csp);
    check(page.errors.length === 0, 'no page errors during the WP3 run', page.errors.slice(0, 3));
  } finally {
    await b.close();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ }
  }
  console.log(JSON.stringify({ file: build, passed, failed, failures }, null, 2));
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
