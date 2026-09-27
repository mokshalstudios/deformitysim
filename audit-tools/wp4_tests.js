#!/usr/bin/env node
'use strict';
// WP4 -- one-screen imaging intake, exercised in a real browser (Chrome via CDP).
//
//   node audit-tools/wp4_tests.js <build.html> [--headed] [--shots <dir>]
//
// Covers: one session-level attestation kept across Clear and required before
// anything is read (F066); content-based DICOM detection for extensionless
// PACS/CD files, renamed non-images and a DICOMDIR (F019/F068); selection-time
// DICOM header summary, thumbnail and plain-language refusal (F027); supine
// picker accepts DICOM (F033); decoded-DICOM provenance (F034); frontal-only
// staging (F062/F096); optional pre-filled coverage toggles (F066); body-only
// scrolling on a phone (F060); sticky run bar and results scrolled into view
// with auto-run after staging (F065); DICOM copy (F067); Clear asks first
// (F072); placeholders that cannot pass for values (F074); PT >= PI flagged
// before Apply (F090); drag-and-drop with DICOM ViewPosition assignment, swap
// and clipboard paste; explicit "patient right is on the image" laterality,
// default not confirmed, DICOM autofill, PA/AP mapping and its handshake with
// the calibration module's projection flags; WP1 markup follow-ups.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, fileUrl, sleep } = require('./cdp.js');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(ROOT, 'ai-tools', 'dicom-tests', 'fixtures');
const build = process.argv[2];
const headed = process.argv.includes('--headed');
const shotsArg = process.argv.indexOf('--shots');
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
if (!build || !fs.existsSync(build)) {
  console.error('usage: node audit-tools/wp4_tests.js <build.html> [--headed] [--shots <dir>]');
  process.exit(2);
}

let passed = 0, failed = 0;
const failures = [], checks = [];
function check(cond, msg, detail) {
  checks.push(msg);
  if (cond) { passed++; return true; }
  failed++; failures.push(detail === undefined ? msg : `${msg} (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`);
  console.log('  FAIL: ' + failures[failures.length - 1]);
  return false;
}

// ------------------------------------------------------------- fixtures ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-'));
const apDicom = path.join(FIX, 'f21_jpeg_lossless_sv1_12bit.dcm');      // DX, ViewPosition AP, PatientOrientation L\F
const latDicom = path.join(FIX, 'f32_rle_16bit_lateral.dcm');           // DX, ViewPosition LL, PatientOrientation A\F
const j2kDicom = path.join(FIX, 'f47_jpeg2000.dcm');                    // refused: JPEG 2000
const noExt = path.join(tmp, 'IM000001');                              // PACS/CD export name, no extension
fs.copyFileSync(apDicom, noExt);
const supineNoExt = path.join(tmp, 'IM000002');
fs.copyFileSync(latDicom, supineNoExt);
const fakePng = path.join(tmp, 'notes.png');                           // named as an image, text inside
fs.writeFileSync(fakePng, 'this is not an image\n'.repeat(20));
// Minimal DICOMDIR: preamble, DICM, file meta naming the Media Storage Directory class.
function el(g, e, vr, val) {
  let v = Buffer.from(val, 'latin1');
  if (v.length % 2) v = Buffer.concat([v, Buffer.from([vr === 'UI' ? 0 : 0x20])]);
  const h = Buffer.alloc(8);
  h.writeUInt16LE(g, 0); h.writeUInt16LE(e, 2); h.write(vr, 4, 'latin1'); h.writeUInt16LE(v.length, 6);
  return Buffer.concat([h, v]);
}
const metaBody = Buffer.concat([el(2, 2, 'UI', '1.2.840.10008.1.3.10'), el(2, 0x10, 'UI', '1.2.840.10008.1.2.1')]);
const groupLen = Buffer.alloc(12); groupLen.writeUInt16LE(2, 0); groupLen.writeUInt16LE(0, 2); groupLen.write('UL', 4, 'latin1'); groupLen.writeUInt16LE(4, 6); groupLen.writeUInt32LE(metaBody.length, 8);
const dicomdir = path.join(tmp, 'DICOMDIR');
fs.writeFileSync(dicomdir, Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), groupLen, metaBody, el(4, 0x1130, 'CS', 'STUDY')]));
const film1 = path.join(ROOT, 'samples', '1.jpg');

const b64 = file => fs.readFileSync(file).toString('base64');

// --------------------------------------------------------------- helpers ----
const HELPERS = `(() => {
  const $ = id => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const fileFrom = (base64, name, type) => { const bin = atob(base64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new File([bytes], name, { type: type || '' }); };
  const pngFile = async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, 64, 128); x.fillStyle = '#ddd'; x.fillRect(28, 8, 8, 112); const blob = await new Promise(r => c.toBlob(r, 'image/png')); return new File([blob], 'image.png', { type: 'image/png' }); };
  const S = () => window.__SPINE_TEST__;
  window.__wp4 = { $, fire, fileFrom, pngFile, S };
  return true;
})()`;

async function openApp(b, viewport) {
  const page = await b.open(fileUrl(build), viewport);
  if (viewport.mobile) await page.setViewport(viewport.width, viewport.height, { mobile: true });
  await page.unlock();
  await page.eval(`(() => { const x = document.getElementById('introExplore'); if (x) x.click(); return true; })()`);
  await sleep(400);
  await page.eval(HELPERS);
  return page;
}
const openDialog = page => page.eval(`(() => { document.getElementById('openPatientImaging').click(); return document.getElementById('patientImagingDialog').open; })()`);
const attest = (page, on = true) => page.eval(`(() => { const a = __wp4.$('imagingAuthorization'); if (a.checked !== ${on}) a.click(); return a.checked; })()`);
const statusOf = (page, id) => page.eval(`document.getElementById(${JSON.stringify(id)}).textContent.trim()`);
const imaging = page => page.eval(`JSON.parse(JSON.stringify(__wp4.S().getState ? __wp4.S().getState().patientImaging : null))`).catch(() => null);
const session = page => page.eval(`(() => { const f = __wp4.$('standingPaInput').files[0], l = __wp4.$('standingLateralInput').files[0]; return { frontal: f ? { name: f.name, size: f.size, type: f.type } : null, lateral: l ? { name: l.name, size: l.size, type: l.type } : null }; })()`);
const lateralityState = page => page.eval(`(() => { const s = __wp4.$('frontalLateralitySelect'), p = __wp4.$('frontalProjectionSelect'); return { value: s.value, source: s.dataset.source || null, disabled: s.disabled, projection: p.value, userChosen: p.dataset.userChosen || null, autofill: p.dataset.autofill || null, note: __wp4.$('frontalLateralityNote').textContent }; })()`);
const clearFilms = async page => {
  await page.eval(`(() => { __wp4.$('requestClearPatientImaging').click(); const c = __wp4.$('clearImagingConfirm'); if (!c.hidden) __wp4.$('clearPatientImaging').click(); return true; })()`);
  await sleep(150);
};
const setWorksheet = (page, values) => page.eval(`(() => { const v = ${JSON.stringify(values)}; Object.entries(v).forEach(([id, value]) => { const el = __wp4.$(id); el.value = String(value); __wp4.fire(el, el.tagName === 'SELECT' ? 'change' : 'input'); }); return __wp4.$('imagingMeasurementStatus').textContent; })()`);

(async () => {
  const b = await launch({ headless: !headed });
  try {
    // ============================================================ desktop ==
    const page = await openApp(b, { width: 1440, height: 900 });
    check(await page.eval(`typeof __wp4.S().getState === 'function'`), 'the test surface exposes getState');

    // --- static markup (WP1 follow-ups, F033, F067, laterality default)
    const markup = await page.eval(`(() => {
      const d = __wp4.$('patientImagingDialog'), text = d.textContent;
      return {
        supineAccept: __wp4.$('supineInput').getAttribute('accept'),
        supineTaps: __wp4.$('manualStartSupine').textContent.trim(),
        flexApply: __wp4.$('flexApply').textContent.trim(),
        orientation: __wp4.$('autoLandmarkAnteriorSide').options[0].textContent,
        visibleAttestations: [...d.querySelectorAll('input[type=checkbox]')].filter(i => !i.hidden && i.closest('.imaging-step') && !i.classList.contains('imaging-coverage-input') && i.id !== 'autoLandmarkRunOnStage' && !i.closest('#autoLandmarkBeta')).map(i => i.id),
        pixelReviewHidden: __wp4.$('imagingPixelReview').hidden,
        laterality: __wp4.$('frontalLateralitySelect').value,
        lateralityOptions: [...__wp4.$('frontalLateralitySelect').options].map(o => o.value),
        noDecodeClaim: !/DICOM pixel decoding is not implemented|decode DICOM spacing|appears here for PNG, JPEG, or WebP/.test(text),
        dicomSupported: /single-frame DICOM/.test(text) && /CT series decoding is not implemented/.test(text),
        placeholder: __wp4.$('standingPaPlaceholder').textContent,
        frameOverflow: getComputedStyle(d).overflow
      };
    })()`);
    check(/\.dcm/.test(markup.supineAccept) && /application\/dicom/.test(markup.supineAccept), 'F033: the supine picker accepts DICOM', markup.supineAccept);
    check(markup.supineTaps === 'Supine: 8 taps', 'WP1: the supine button says 8 taps', markup.supineTaps);
    check(markup.flexApply === 'Record positional change', 'WP1: flexibility action renamed to "Record positional change"', markup.flexApply);
    check(/signed LL\/TK\/CL, PT and SVA withheld/.test(markup.orientation), 'WP1: orientation copy covers every signed value', markup.orientation);
    check(markup.visibleAttestations.length === 1 && markup.visibleAttestations[0] === 'imagingAuthorization' && markup.pixelReviewHidden, 'F066: a single visible attestation checkbox', markup.visibleAttestations);
    check(markup.laterality === 'unconfirmed' && markup.lateralityOptions.join() === 'unconfirmed,left,right', 'laterality control defaults to "not confirmed" with left/right options', markup);
    check(markup.noDecodeClaim && markup.dicomSupported && /DICOM/.test(markup.placeholder), 'F067: no copy says DICOM is not decoded; CT series is the blocked part', markup);

    // --- nothing is read before the attestation (F066)
    await openDialog(page);
    const locked = await page.eval(`(async () => {
      __wp4.$('imagingAuthorization').checked && __wp4.$('imagingAuthorization').click();
      const zone = __wp4.$('imagingDropZone'), dt = new DataTransfer(); dt.items.add(await __wp4.pngFile());
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
      return { inputDisabled: __wp4.$('standingPaInput').disabled, zone: zone.dataset.state, status: __wp4.$('imagingDropStatus').textContent, frontal: __wp4.$('standingPaInput').files.length };
    })()`);
    check(locked.inputDisabled && locked.zone === 'error' && locked.frontal === 0 && /not read/.test(locked.status), 'F066: before the attestation, pickers are disabled and a dropped file is not read', locked);
    check(await attest(page) && !(await page.eval(`__wp4.$('standingPaInput').disabled`)), 'ticking the one statement enables the pickers');

    // --- F019/F068/F027: extensionless DICOM detected by content, summary, thumbnail, DICOM laterality
    await page.setFiles('#standingPaInput', [noExt]);
    await page.waitFor(`/^DICOM/.test(__wp4.$('standingPaStatus').textContent)`, { timeout: 15000 }).catch(() => null);
    const noExtInfo = await page.eval(`(() => { const t = __wp4.$('standingPaThumb'); return { status: __wp4.$('standingPaStatus').textContent, thumb: !t.hidden && t.width > 0, placeholderHidden: __wp4.$('standingPaPlaceholder').hidden, name: __wp4.$('standingPaInput').files[0]?.name, type: __wp4.$('standingPaInput').files[0]?.type }; })()`);
    check(/^DICOM · DX · 168×320/.test(noExtInfo.status) && /file name hidden/.test(noExtInfo.status) && !/IM000001/.test(noExtInfo.status), 'F019/F027: an extensionless PACS file is recognized as DICOM and summarized at selection', noExtInfo.status);
    check(noExtInfo.thumb && noExtInfo.placeholderHidden, 'F027: a DICOM thumbnail is drawn at selection time', noExtInfo);
    check(noExtInfo.name === 'dicom-image.dcm' && noExtInfo.type === 'application/dicom', 'F019: the content-identified file is handed on with a neutral DICOM name and type', noExtInfo);
    const autoSide = await lateralityState(page);
    check(autoSide.value === 'left' && autoSide.source === 'dicom' && autoSide.projection === 'ap' && autoSide.autofill === 'dicom' && !autoSide.userChosen, 'laterality is filled from DICOM Patient Orientation (L -> patient right on image left = AP) and flagged as DICOM for the calibration module', autoSide);

    await page.setFiles('#standingLateralInput', [j2kDicom]);
    await page.waitFor(`/Cannot be analyzed/.test(__wp4.$('standingLateralStatus').textContent)`, { timeout: 15000 }).catch(() => null);
    const j2k = await page.eval(`({ status: __wp4.$('standingLateralStatus').textContent, state: __wp4.$('standingLateralStatus').dataset.state, pre: __wp4.$('imagingPreflightStatus').dataset.state, preText: __wp4.$('imagingPreflightStatus').textContent })`);
    check(/JPEG 2000/.test(j2k.status) && /Re-export/.test(j2k.status) && j2k.state === 'error', 'F027: an undecodable DICOM is refused at selection with a plain reason and a remedy', j2k.status);
    check(j2k.pre === 'error' && /cannot be analyzed/.test(j2k.preText), 'F066: the preflight re-validates on change and names the blocking file', j2k);
    await page.eval(`(__wp4.$('autoLandmarkRunOnStage').checked && __wp4.$('autoLandmarkRunOnStage').click(), __wp4.$('stagePatientImaging').click(), true)`);
    await sleep(200);
    check((await imaging(page))?.status === 'invalid', 'staging refuses an undecodable DICOM', await imaging(page));

    await page.setFiles('#standingLateralInput', [fakePng]);
    await page.waitFor(`/content is not PNG/.test(__wp4.$('standingLateralStatus').textContent)`, { timeout: 10000 }).catch(() => null);
    check(/content is not PNG, JPEG or WebP/.test(await statusOf(page, 'standingLateralStatus')), 'F068: a renamed non-image is refused by content, not accepted by extension', await statusOf(page, 'standingLateralStatus'));
    await page.setFiles('#standingLateralInput', [dicomdir]);
    await page.waitFor(`/disc index/.test(__wp4.$('standingLateralStatus').textContent)`, { timeout: 10000 }).catch(() => null);
    check(/disc index \(DICOMDIR\)/.test(await statusOf(page, 'standingLateralStatus')), 'F019: a DICOMDIR gets "choose an image file inside the folder" guidance', await statusOf(page, 'standingLateralStatus'));
    await page.eval(`(__wp4.$('removeLateralFilm').click(), true)`);
    await sleep(100);

    // --- F033: supine DICOM without extension
    await page.setFiles('#supineInput', [supineNoExt]);
    await page.waitFor(`/^DICOM/.test(__wp4.$('supineStatus').textContent)`, { timeout: 10000 }).catch(() => null);
    check(/^DICOM · DX/.test(await statusOf(page, 'supineStatus')), 'F033: an extensionless DICOM supine film is accepted and summarized', await statusOf(page, 'supineStatus'));

    // --- F066 coverage toggles, F062/F096 frontal-only staging, F034 provenance
    const cov = await page.eval(`({ hidden: __wp4.$('imagingCoverageDetails').hidden, checked: [...document.querySelectorAll('.imaging-coverage-input:checked')].map(i => i.value), scope: __wp4.$('imagingCoverageScope').textContent, pre: __wp4.$('imagingPreflightStatus').textContent })`);
    check(!cov.hidden && cov.checked.join() === 'occiput-cervical,thoracic,lumbar-pelvis' && /frontal film/.test(cov.scope), 'F066: coverage declarations are optional, pre-filled and scoped to the films supplied', cov);
    check(/Ready: frontal film only/.test(cov.pre), 'F062: a frontal film alone is ready to stage', cov.pre);
    await page.eval(`(__wp4.$('stagePatientImaging').click(), true)`);
    await sleep(300);
    const staged = await imaging(page);
    check(staged?.status === 'staged' && staged.views?.join() === 'frontal' && staged.sourceCounts?.lateral === 0, 'F062/F096: a frontal-only study stages; the lateral plane is recorded as not provided', staged && { status: staged.status, views: staged.views, counts: staged.sourceCounts });
    check(staged?.representation === 'standing_frontal_only_dicom_decoded' && staged.capabilities?.dicomMetadataParsed === true, 'F034: a decoded DICOM is recorded as parsed, not "selected_unparsed"', staged && { rep: staged.representation, caps: staged.capabilities });
    check(staged?.frontalLaterality?.patientRightOnImage === 'left' && staged.frontalLaterality.source === 'dicom_patient_orientation' && staged.dicomHeaders?.frontal?.orientation?.viewPosition === 'AP', 'the staged record keeps the laterality source and the non-identifying header summary', staged && { lat: staged.frontalLaterality, hdr: staged.dicomHeaders });
    check(!(await page.eval(`__wp4.$('imagingMeasurementStep').hidden`)), 'the measurement step opens after staging');

    // --- F074 placeholders, F090 PT >= PI
    const ph = await page.eval(`[...document.querySelectorAll('.imaging-measurement-input')].map(i => i.placeholder)`);
    check(ph.every(p => /^current/.test(p)), 'F074: worksheet placeholders are prefixed "current", never a bare value', ph);
    const ptBefore = await page.eval(`__wp4.S().getState().params ? __wp4.S().getState().params.pt : null`).catch(() => null);
    const f090 = await setWorksheet(page, { imagingPiInput: 40, imagingPtInput: 45 });
    check(/sacral slope of -5°/.test(f090) && await page.eval(`__wp4.$('imagingPtInput').getAttribute('aria-invalid') === 'true'`), 'F090: PT >= PI is flagged while typing', f090);
    await page.eval(`(__wp4.$('applyImagingMeasurements').click(), true)`);
    await sleep(150);
    const afterRefuse = await imaging(page);
    check(!afterRefuse?.alignmentApplied && /sacral slope/.test(await statusOf(page, 'imagingMeasurementStatus')), 'F090: Apply refuses PT >= PI', await statusOf(page, 'imagingMeasurementStatus'));
    if (ptBefore !== null) check(await page.eval(`__wp4.S().getState().params.pt`) === ptBefore, 'F090: the refused PT is not written to the case');

    // --- laterality gate: side-dependent values wait for a confirmed side
    await page.eval(`(() => { const s = __wp4.$('frontalLateralitySelect'); s.value = 'unconfirmed'; __wp4.fire(s, 'change'); return true; })()`);
    const unconf = await lateralityState(page);
    check(unconf.value === 'unconfirmed' && !unconf.userChosen && !unconf.autofill && unconf.projection === 'pa' && /Not confirmed/.test(unconf.note), '"not confirmed" clears the projection flags (calibration module reads it as the unconfirmed default)', unconf);
    await setWorksheet(page, { imagingPiInput: 52, imagingPtInput: 20, imagingPrimaryCobbInput: 35, imagingPrimaryDirection: 'right' });
    await page.eval(`(__wp4.$('applyImagingMeasurements').click(), true)`);
    await sleep(150);
    const gate = await statusOf(page, 'imagingMeasurementStatus');
    check(/Confirm which side of the frontal film/.test(gate) && !(await imaging(page))?.alignmentApplied, 'an apex side is not applied while the frontal laterality is not confirmed', gate);
    await page.eval(`(() => { const s = __wp4.$('frontalLateralitySelect'); s.value = 'right'; __wp4.fire(s, 'change'); return true; })()`);
    const conf = await lateralityState(page);
    check(conf.projection === 'pa' && conf.userChosen === 'true' && !conf.autofill && conf.source === 'user', 'choosing "right" maps to PA and is flagged as the user\'s choice', conf);
    check((await imaging(page))?.frontalLaterality?.patientRightOnImage === 'right', 'a laterality confirmed after staging updates the staged record');
    await page.eval(`(__wp4.$('applyImagingMeasurements').click(), true)`);
    await sleep(400);
    const applied = await page.eval(`(() => { const s = __wp4.S().getState(); return { applied: s.patientImaging.alignmentApplied, dir: s.globalDeformity && s.globalDeformity.coronalDirection, pi: s.params && s.params.pi }; })()`).catch(e => ({ error: String(e) }));
    check(applied.applied === true && applied.dir === 'right' && applied.pi === 52, 'with the side confirmed the reviewed values apply', applied);
    const summary = await statusOf(page, 'patientImagingSummary');
    check(/from the film: PI, PT, primary Cobb, apex side/.test(summary) && /not measured, case values kept: LL, TK, C2–C7/.test(summary), 'F073: the imaging summary separates film values from unmeasured case values', summary);
    await openDialog(page);

    // --- the calibration module (or a scripted caller) setting PA/AP is mirrored
    const mirrored = await page.eval(`(async () => { const p = __wp4.$('frontalProjectionSelect'); p.value = 'ap'; __wp4.fire(p, 'change'); await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); const s = __wp4.$('frontalLateralitySelect'); return { value: s.value, source: s.dataset.source }; })()`);
    check(mirrored.value === 'left' && mirrored.source === 'projection', 'a direct AP choice on the projection select shows as "patient right on image left"', mirrored);

    // --- F072: Clear asks first and keeps the attestation
    const ask = await page.eval(`(() => { __wp4.$('requestClearPatientImaging').click(); return { shown: !__wp4.$('clearImagingConfirm').hidden, text: __wp4.$('clearImagingConfirmText').textContent }; })()`);
    check(ask.shown && /Discard 2 films/.test(ask.text) && /stays ticked/.test(ask.text), 'F072: Clear local files asks before discarding', ask);
    await page.eval(`(__wp4.$('cancelClearPatientImaging').click(), true)`);
    check((await session(page)).frontal !== null && await page.eval(`__wp4.$('clearImagingConfirm').hidden`), 'F072: "Keep them" keeps the films');
    await clearFilms(page);
    const cleared = await page.eval(`({ frontal: __wp4.$('standingPaInput').files.length, attested: __wp4.$('imagingAuthorization').checked, lat: __wp4.$('frontalLateralitySelect').value, status: __wp4.S().getState().patientImaging.status })`);
    check(cleared.frontal === 0 && cleared.attested && cleared.lat === 'unconfirmed' && cleared.status === 'none', 'F066/F072: confirmed Clear discards films but keeps the session attestation', cleared);

    // --- drag-and-drop: two DICOMs dropped in the wrong order are assigned by ViewPosition
    await page.eval(`(async () => { const zone = __wp4.$('imagingDropZone'), dt = new DataTransfer();
      dt.items.add(__wp4.fileFrom(${JSON.stringify(b64(latDicom))}, 'lat', ''));
      dt.items.add(__wp4.fileFrom(${JSON.stringify(b64(apDicom))}, 'ap', ''));
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
    await page.waitFor(`__wp4.$('standingPaInput').files.length === 1 && __wp4.$('standingLateralInput').files.length === 1 && /^DICOM/.test(__wp4.$('standingLateralStatus').textContent) && /^DICOM/.test(__wp4.$('standingPaStatus').textContent)`, { timeout: 15000 }).catch(() => null);
    const dropped = await session(page);
    const apSize = fs.statSync(apDicom).size, latSize = fs.statSync(latDicom).size;
    check(dropped.frontal?.size === apSize && dropped.lateral?.size === latSize, 'drop: two films are assigned by DICOM ViewPosition, not drop order', dropped);
    check(/DICOM view position/.test(await statusOf(page, 'imagingAssignNote')), 'drop: the assignment basis is stated', await statusOf(page, 'imagingAssignNote'));
    await page.eval(`(__wp4.$('swapImagingViews').click(), true)`);
    await page.waitFor(`/header says lateral view/.test(__wp4.$('standingPaStatus').textContent)`, { timeout: 10000 }).catch(() => null);
    const swapped = await session(page);
    check(swapped.frontal?.size === latSize && swapped.lateral?.size === apSize, 'swap exchanges the frontal and lateral films', swapped);
    check(/header says lateral view/.test(await statusOf(page, 'standingPaStatus')) && (await lateralityState(page)).value === 'unconfirmed', 'swap: the header mismatch is flagged and the laterality returns to not confirmed', await statusOf(page, 'standingPaStatus'));
    await clearFilms(page);

    // --- paste a screenshot from the clipboard
    await page.eval(`(async () => { const dt = new DataTransfer(); dt.items.add(await __wp4.pngFile()); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
    await page.waitFor(`/^PNG image/.test(__wp4.$('standingPaStatus').textContent)`, { timeout: 10000 }).catch(() => null);
    check(/^PNG image · 64×128/.test(await statusOf(page, 'standingPaStatus')) && /clipboard/.test(await statusOf(page, 'imagingDropStatus')), 'paste: a clipboard image goes into the frontal slot', await statusOf(page, 'standingPaStatus'));
    await clearFilms(page);

    // --- F065: stage runs the analysis at once; sticky bar while it runs; results scrolled into view
    await page.setFiles('#standingPaInput', [film1]);
    await page.waitFor(`/^JPEG image/.test(__wp4.$('standingPaStatus').textContent)`, { timeout: 10000 }).catch(() => null);
    await page.eval(`(() => { const box = __wp4.$('autoLandmarkRunOnStage'); if (!box.checked) box.click(); window.__wp4Bar = false;
      new MutationObserver(() => { if (!__wp4.$('imagingRunBar').hidden) window.__wp4Bar = { sticky: getComputedStyle(__wp4.$('imagingRunBar')).position, text: __wp4.$('imagingRunBarText').textContent }; }).observe(__wp4.$('imagingRunBar'), { attributes: true });
      __wp4.$('patientImagingBody').scrollTop = 0; return __wp4.$('stagePatientImaging').textContent; })()`).then(label => check(label === 'Stage & analyze', 'the primary action reads "Stage & analyze" while auto-run is on', label));
    await page.eval(`(__wp4.$('stagePatientImaging').click(), true)`);
    await page.waitFor(`window.__wp4Bar && true`, { timeout: 30000 }).catch(() => null);
    await page.waitFor(`__wp4.$('autoLandmarkStatus').dataset.state !== 'running' && __wp4.$('imagingRunBar').hidden && window.__wp4Bar`, { timeout: 180000 }).catch(() => null);
    // Let the smooth scroll settle.
    await page.eval(`(async () => { const body = __wp4.$('patientImagingBody'); let last = -1; for (let i = 0; i < 40 && body.scrollTop !== last; i++) { last = body.scrollTop; await new Promise(r => setTimeout(r, 120)); } return true; })()`);
    const ran = await page.eval(`(() => { const body = __wp4.$('patientImagingBody'), grid = __wp4.$('autoLandmarkPreviewGrid');
      return { bar: window.__wp4Bar, barHidden: __wp4.$('imagingRunBar').hidden, state: __wp4.$('autoLandmarkStatus').dataset.state, grid: !grid.hidden, gridOffset: Math.round(grid.getBoundingClientRect().top - body.getBoundingClientRect().top), bodyTop: body.scrollTop, frameTop: __wp4.$('patientImagingDialog').scrollTop }; })()`);
    check(ran.bar && ran.bar.sticky === 'sticky', 'F065: a sticky status bar shows while the analysis runs', ran);
    check(ran.barHidden && ran.state !== 'running' && ran.grid, 'auto-run: staging alone produced a reviewed-overlay result', ran);
    check(ran.bodyTop > 0 && ran.gridOffset >= 0 && ran.gridOffset <= 40 && ran.frameTop === 0, 'F065/F060: the result is scrolled to the top of the dialog body; the dialog frame never scrolls', ran);
    if (shots) await page.screenshot(path.join(shots, 'wp4_desktop_result.png'));
    check(!page.errors.length, 'no page errors on the desktop intake run', page.errors.slice(0, 3));
    await page.close();

    // ============================================================= mobile ==
    const phone = await openApp(b, { width: 390, height: 844, mobile: true });
    await openDialog(phone);
    await attest(phone);
    await phone.setFiles('#standingPaInput', [film1]);
    await phone.waitFor(`/^JPEG image/.test(__wp4.$('standingPaStatus').textContent)`, { timeout: 10000 }).catch(() => null);
    await phone.eval(`(() => { const box = __wp4.$('autoLandmarkRunOnStage'); if (box.checked) box.click(); __wp4.$('stagePatientImaging').click(); return true; })()`);
    await sleep(900);
    const m = await phone.eval(`(() => { const d = __wp4.$('patientImagingDialog'), head = d.querySelector('.dialog-head').getBoundingClientRect(), close = __wp4.$('closePatientImaging').getBoundingClientRect(), body = __wp4.$('patientImagingBody'), dr = d.getBoundingClientRect();
      return { frameTop: d.scrollTop, headTop: Math.round(head.top), closeVisible: close.top >= 0 && close.bottom <= innerHeight && close.width > 0, bodyTop: body.scrollTop, dialogBottom: Math.round(dr.bottom), vh: innerHeight, bodyBottom: Math.round(body.getBoundingClientRect().bottom), status: d.querySelector('#imagingPreflightStatus strong').textContent }; })()`);
    check(m.frameTop === 0 && m.headTop >= 0 && m.closeVisible, 'F060: after staging on a phone the header and close button stay on screen', m);
    check(m.bodyTop > 0 && Math.abs(m.bodyBottom - m.dialogBottom) <= 2, 'F060: only the dialog body scrolls and it fills the dialog (no dead band)', m);
    if (shots) await phone.screenshot(path.join(shots, 'wp4_mobile_after_stage.png'));
    check(!phone.errors.length, 'no page errors on the phone intake run', phone.errors.slice(0, 3));
    await phone.close();
  } finally {
    await b.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  console.log(JSON.stringify({ file: build, assertions: passed + failed, passed, failed, failures }, null, 2));
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
