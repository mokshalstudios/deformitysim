#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// PI display field for the hip bones (v0.23.1), in real Chrome via cdp.js.
//
//   node audit-tools/pelvis_tests.js <build.html>
//
// The CT atlas has one pelvis (PI 52). Other PIs rotate the sacrum and spine
// about the L5-S1 proxy while the femoral-head axis stays put; the innominates
// used to be hidden there. They are now reshaped by an angle-blended field.
// This suite checks that:
//   P1  nothing is built or changed at the reference PI (the field is lazy)
//   P2  the innominates are visible at PI 30 and 80 and really are reshaped
//   P3  SI congruence: the 95th-percentile distance from the SI-region
//       innominate vertices (within 8 mm of the rest sacrum) to the nearest
//       sacrum vertex stays within 1 mm of its reference-PI value
//   P4  hip congruence: the acetabulum centre (centroid of the innominate
//       vertices within 30 mm of the femoral-head centre) keeps its distance to
//       the femoral-head centre within 0.5 mm
//   P5  no folded triangles (a face normal turned against its rest normal as
//       carried by the local field rotation), spikes or collapsed edges
//   P6  each update fits inside one 60 Hz frame (16.7 ms; typically 1.5-5 ms), including a
//       real slider drag. A tighter cap is timing-noise sensitive on loaded machines.
//   P7  SI-joint, ligament and S2AI overlays are shown and follow the field
//   P8  returning to PI 52 restores every buffer and bounding volume bit for bit
//   P9  measurement invariance: every reported value (T1PA, geometric SVA, S1 and
//       hip-axis landmark proxies, C7 plumb line, gait pelvis excursion, case
//       panel and outputs) equals the v0.23.0 release values in
//       fixtures/pelvis_invariance_v0.23.0.json, for PI {30,40,52,55,65,70,80} x
//       PT {10,22,35} (pre-op and a modeled PSO) and all example cases
//       (pre-op and a modeled construct)
//   P10 gait starts at PI 40 and 70 with the ilia visible
//   P11 the on-screen wording says the pelvis is adjusted schematically
// Exit code 0 only when every check passes.

const fs = require('fs');
const path = require('path');
const { launch, fileUrl, sleep } = require(path.join(__dirname, 'cdp.js'));

const ROOT = path.join(__dirname, '..');
const build = path.resolve(process.argv[2] || path.join(ROOT, 'spine_simulator.html'));
const FIXTURE = path.join(__dirname, 'fixtures', 'pelvis_invariance_v0.23.0.json');
const FRAME_MS = 1000 / 60;
const results = [];
const notes = [];
const check = (ok, label, detail = '') => results.push({ ok: Boolean(ok), label, detail: ok ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000) });

// In-page helpers. The metric definitions are those used for the published
// values (research page helpers: pts / metrics / geometry / gaitRun).
const HELPERS = String.raw`(() => {
  const T = window.__SPINE_TEST__;
  const THREE = window.THREE;
  const R2D = 180 / Math.PI;
  const MM = T.REFERENCE_MM_TO_SCENE;
  const V = () => new THREE.Vector3();
  const wp = o => { const v = V(); o.getWorldPosition(v); return v; };
  const arr = v => v ? [v.x, v.y, v.z] : null;
  const findByName = name => { let hit = null; T.getScene().traverse(o => { if (!hit && o.name === name) hit = o; }); return hit; };
  const boneCenterWorld = key => {
    const m = findByName('ctReferenceSurface:' + key);
    if (!m || !m.geometry) return null;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const c = m.geometry.boundingBox.min.clone().add(m.geometry.boundingBox.max).multiplyScalar(0.5);
    m.updateMatrixWorld(true);
    return c.applyMatrix4(m.matrixWorld);
  };
  const linePts = name => {
    const l = findByName(name);
    if (!l || !l.geometry || !l.geometry.attributes || !l.geometry.attributes.position) return null;
    const a = l.geometry.attributes.position.array;
    l.updateMatrixWorld(true);
    return [V().set(a[0], a[1], a[2]).applyMatrix4(l.matrixWorld), V().set(a[3], a[4], a[5]).applyMatrix4(l.matrixWorld)];
  };
  const hipCentre = () => { const hips = []; T.getScene().traverse(o => { if (o.name && o.name.startsWith('femoralHeadCenter:')) hips.push(o); }); return hips.map(wp).reduce((a, b) => a.add(b)).multiplyScalar(1 / hips.length); };
  function pts() {
    T.getScene().updateMatrixWorld(true);
    return { hip: hipCentre(), s1p: wp(findByName('posterosuperiorS1')), sb: wp(T.getSacralMorphologyRoot()), c7: boneCenterWorld('C7'), t1: boneCenterWorld('T1'), c2: boneCenterWorld('C2') };
  }
  function metrics(p) {
    const ant = Math.sign(p.hip.x - p.s1p.x) || 1;
    const thetaPost = v => Math.atan2(-ant * v.x, v.y) * R2D;
    const mid = p.s1p.clone().add(p.sb).multiplyScalar(0.5);
    const ptMid = thetaPost(mid.clone().sub(p.hip));
    const thT1 = thetaPost(p.t1.clone().sub(p.hip));
    const ep = p.sb.clone().sub(p.s1p);
    const ss = Math.atan2(-(ep.y), ant * ep.x) * R2D;
    return { svaMm: ant * (p.c7.x - p.s1p.x) / MM, t1OffsetMm: ant * (p.t1.x - p.s1p.x) / MM, cSvaMm: ant * (p.c2.x - p.c7.x) / MM,
      ptGeoMidDeg: ptMid, ptGeoSacralBaseDeg: thetaPost(p.sb.clone().sub(p.hip)), ssGeoDeg: ss, piGeoDeg: ptMid + ss, t1spiDeg: -thT1, tpaDeg: ptMid - thT1 };
  }
  function geometry() {
    const pelvis = T.getPelvis();
    const ws = V(); pelvis.getWorldScale(ws);
    const worldPerMm = MM * ws.x;
    const hip = hipCentre(), pelvisOrigin = wp(pelvis), sacralBase = wp(T.getSacralMorphologyRoot());
    const sva = linePts('svaConnector'), plumb = linePts('plumbLine');
    const s1x = sva ? sva[0].x : null, c7x = sva ? sva[1].x : null;
    const c7 = boneCenterWorld('C7'), t1 = boneCenterWorld('T1'), c2 = boneCenterWorld('C2');
    const antSign = Math.sign(hip.x - (s1x ?? sacralBase.x)) || 1;
    const thetaPost = v => Math.atan2(-antSign * v.x, v.y) * R2D;
    const ptGeo = thetaPost(sacralBase.clone().sub(hip));
    const thT1 = t1 ? thetaPost(t1.clone().sub(hip)) : null;
    const ang = (a, b) => Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * R2D;
    const toMm = w => w / worldPerMm;
    return {
      svaGeoMm: sva ? toMm(antSign * (c7x - s1x)) : null,
      c7CentroidMinusS1_mm: (c7 && sva) ? toMm(antSign * (c7.x - s1x)) : null,
      t1CentroidMinusS1_mm: (t1 && sva) ? toMm(antSign * (t1.x - s1x)) : null,
      cSvaGeoMm: (c2 && c7) ? toMm(antSign * (c2.x - c7.x)) : null,
      c7AboveS1_mm: (sva && plumb) ? toMm(sva[1].y - Math.min(plumb[0].y, plumb[1].y)) : null,
      ptGeoDeg: ptGeo, t1spiGeoDeg: thT1 === null ? null : -thT1, t1paGeoDeg: thT1 === null ? null : ptGeo - thT1,
      globalTiltGeoDeg: c7 ? Math.abs(ang(c7.clone().sub(sacralBase), hip.clone().sub(sacralBase))) : null,
      hipVsPelvisOriginMm: toMm(hip.distanceTo(pelvisOrigin))
    };
  }
  const DOM = ['metricMismatch', 'metricSva', 'metricSvaContext', 'modifierMismatch', 'modifierSva', 'modifierPt', 'sacralSlope',
    'llBefore', 'llAfter', 'llDelta', 'clBefore', 'clAfter', 'clDelta', 'tkBefore', 'tkAfter', 'tkDelta', 'ptBefore', 'ptAfter', 'ptDelta',
    'primaryCobbAfter', 'apicalTranslationAfter', 'contextSva', 'contextMismatch', 'c7Label', 'plumbLabel'];
  const txt = id => { const e = document.getElementById(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
  function snapshot() {
    T.setLayerVisibility({ measurements: true });
    T.updateScene();
    T.renderNow();
    T.getScene().updateMatrixWorld(true);
    const st = T.getState();
    const p = pts();
    const lines = {};
    ['plumbLine', 'svaConnector', 'cogLine', 'pelvicIncidenceRadiusLine'].forEach(n => { const l = linePts(n); lines[n] = l ? l.map(arr) : null; });
    const landmark = n => arr(wp(findByName(n)));
    return JSON.parse(JSON.stringify({
      prediction: { newLL: st.prediction.newLL, newTK: st.prediction.newTK, newPT: st.prediction.newPT, newCL: st.prediction.newCL, applicabilityStatus: st.prediction.applicabilityStatus },
      metrics: metrics(p), geometry: geometry(),
      pts: { hip: arr(p.hip), s1p: arr(p.s1p), sb: arr(p.sb), c7: arr(p.c7), t1: arr(p.t1), c2: arr(p.c2) },
      lines,
      landmarks: Object.fromEntries(['femoralHeadCenter:left', 'femoralHeadCenter:right', 'posterosuperiorS1', 'authoredSacralBaseMorphologyRoot'].map(n => [n, landmark(n)])),
      coronalBalance: T.getCoronalBalance(),
      dom: Object.fromEntries(DOM.map(id => [id, txt(id)]))
    }));
  }
  function gaitRun(nSteps = 480, dt = 1 / 120) {
    T.setLayerVisibility({ lowerLimbs: true });
    T.setLowerExtremityVisibility(true);
    T.setGaitActive(false);
    T.setGaitActive(true);
    if (!T.getGaitState().active) { T.setGaitActive(false); return { error: 'gait did not start' }; }
    const lec = T.getLowerExtremities();
    const rises = [], knees = [[], []], hips = [[], []];
    for (let i = 0; i < nSteps; i++) {
      T.stepGait(dt);
      rises.push(lec.userData.targetPositionY);
      lec.children.forEach((hip, idx) => {
        const knee = hip.children.find(c => c.name.startsWith('kneePivot:'));
        if (idx < 2) { hips[idx].push(-hip.userData.targetRotationZ * R2D); if (knee) knees[idx].push(knee.userData.targetRotationZ * R2D); }
      });
    }
    const g = T.getGaitState().params;
    const min = a => Math.min(...a), max = a => Math.max(...a);
    const out = {
      verticalExcursionMm: (max(rises) - min(rises)) / MM, stepLengthMm: g.stepScene / MM,
      kneeRangeDeg: knees.map(k => [min(k), max(k)]), hipRangeDeg: hips.map(h => [min(h), max(h)]),
      animatedHipRomDeg: g.animatedHipRomDeg, animatedKneeRomDeg: g.animatedKneeRomDeg,
      cadenceCyclesPerSecond: g.cadenceCyclesPerSecond, baseHipHeight: g.baseHipHeight
    };
    T.setGaitActive(false);
    return out;
  }
  function loadScenario(params, itinerary) {
    T.applyCaseExample('neutral-reference');
    const obj = T.buildCaseFileObject();
    obj.case.params = { ...obj.case.params, ...params };
    if (!('measuredSva' in params)) obj.case.params.measuredSva = null;
    obj.case.levelFactors = {};
    obj.case.itinerary = itinerary.map((it, i) => ({ id: i + 1, ...it }));
    obj.case.nextProcedureId = itinerary.length + 1;
    return T.loadCaseFileText(JSON.stringify(obj));
  }

  // ---- pelvis geometry probes (app mm, pelvis reference frame) ----
  const layer = T.getPelvisReferenceLayer();
  const sacrum = layer.getObjectByName('ctReferenceSurface:sacrum');
  const hipsMeshes = ['left', 'right'].map(side => layer.getObjectByName('ctReferenceSurface:hip_' + side));
  const overlayMeshes = () => { const list = []; [T.getSIJoints(), T.getPelvicLigaments()].forEach(root => root.traverse(o => { if (o.isMesh) list.push(o); })); return list; };
  const worldMm = mesh => {
    T.getScene().updateMatrixWorld(true);
    const pos = mesh.geometry.getAttribute('position'); const out = new Float64Array(pos.count * 3); const v = V();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); out[i * 3] = v.x / MM; out[i * 3 + 1] = v.y / MM; out[i * 3 + 2] = v.z / MM; }
    return out;
  };
  const nearest = (P, i, Q) => { let best = Infinity; const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; for (let j = 0; j < Q.length; j += 3) { const dx = x - Q[j], dy = y - Q[j + 1], dz = z - Q[j + 2]; const d = dx * dx + dy * dy + dz * dz; if (d < best) best = d; } return Math.sqrt(best); };
  const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const visibleInHierarchy = o => { for (let x = o; x; x = x.parent) if (x.visible === false) return false; return true; };
  const bufferState = mesh => {
    const g = mesh.geometry;
    return { position: Array.from(g.getAttribute('position').array), normal: g.getAttribute('normal') ? Array.from(g.getAttribute('normal').array) : null,
      box: g.boundingBox ? [...g.boundingBox.min.toArray(), ...g.boundingBox.max.toArray()] : null,
      sphere: g.boundingSphere ? [...g.boundingSphere.center.toArray(), g.boundingSphere.radius] : null };
  };
  // A face is folded when its normal turns against the rest face normal
  // carried by the local field rotation (the mean of its vertices' w * theta
  // about the sacral pivot's Z axis). The innominates sit untransformed in the
  // app-mm reference frame, so buffer coordinates are app mm.
  const faceNormal = (pos, a, b, c) => {
    const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
    const e2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
    return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  };
  const restWeights = new Map();
  const weightsFor = (mesh, rest) => {
    if (!restWeights.has(mesh)) {
      const weights = new Float64Array(rest.length / 3);
      for (let i = 0; i < weights.length; i++) weights[i] = T.pelvicIncidenceFieldPoint([rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]], 0).weight;
      restWeights.set(mesh, weights);
    }
    return restWeights.get(mesh);
  };
  const foldedFaces = (mesh, rest, theta) => {
    const index = mesh.geometry.getIndex().array, pos = mesh.geometry.getAttribute('position').array;
    const weights = weightsFor(mesh, rest);
    let folded = 0;
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
      const n0 = faceNormal(rest, a, b, c), n = faceNormal(pos, a, b, c);
      const angle = theta * (weights[a] + weights[b] + weights[c]) / 3;
      const carried = [Math.cos(angle) * n0[0] - Math.sin(angle) * n0[1], Math.sin(angle) * n0[0] + Math.cos(angle) * n0[1], n0[2]];
      if (carried[0] * n[0] + carried[1] * n[1] + carried[2] * n[2] < 0) folded += 1;
    }
    return folded;
  };
  let reference = null;
  function captureReference() {
    // Render first: three.js computes missing bounding spheres lazily on the
    // first draw, so the reference must include them.
    T.renderNow();
    const sac = worldMm(sacrum);
    const heads = ['left', 'right'].map(side => wp(findByName('femoralHeadCenter:' + side)).multiplyScalar(1 / MM));
    reference = {
      sac,
      buffers: { innominates: hipsMeshes.map(bufferState), overlays: overlayMeshes().map(bufferState) },
      sides: hipsMeshes.map((mesh, k) => {
        const P = worldMm(mesh);
        const d = []; for (let i = 0; i < P.length / 3; i++) d.push(nearest(P, i, sac));
        const band = d.map((value, i) => value <= 8 ? i : -1).filter(i => i >= 0);
        const acetabular = []; for (let i = 0; i < P.length / 3; i++) { if (Math.hypot(P[i * 3] - heads[k].x, P[i * 3 + 1] - heads[k].y, P[i * 3 + 2] - heads[k].z) < 30) acetabular.push(i); }
        return { P, d, band, acetabular };
      })
    };
    return { bandVertices: reference.sides.map(s => s.band.length), acetabularVertices: reference.sides.map(s => s.acetabular.length) };
  }
  function pelvisProbe() {
    const S = worldMm(sacrum);
    const heads = ['left', 'right'].map(side => wp(findByName('femoralHeadCenter:' + side)).multiplyScalar(1 / MM));
    return hipsMeshes.map((mesh, k) => {
      const ref = reference.sides[k];
      const P = worldMm(mesh);
      const bandNow = ref.band.map(i => nearest(P, i, S));
      const bandMaxChange = ref.band.reduce((m, i, j) => Math.max(m, Math.abs(bandNow[j] - ref.d[i])), 0);
      const centroid = (Q, idx) => idx.reduce((c, i) => [c[0] + Q[i * 3] / idx.length, c[1] + Q[i * 3 + 1] / idx.length, c[2] + Q[i * 3 + 2] / idx.length], [0, 0, 0]);
      const toHead = c => Math.hypot(c[0] - heads[k].x, c[1] - heads[k].y, c[2] - heads[k].z);
      // Displacement relative to the rest pose, measured in the pelvis frame
      // (the posture is the same PT 22 in both).
      let maxDisplacement = 0;
      for (let i = 0; i < P.length; i += 3) maxDisplacement = Math.max(maxDisplacement, Math.hypot(P[i] - ref.P[i], P[i + 1] - ref.P[i + 1], P[i + 2] - ref.P[i + 2]));
      // Folds (see foldedFaces); spikes and collapses: edge length ratios
      // against the rest mesh.
      const g = mesh.geometry, index = g.getIndex().array, pos = g.getAttribute('position').array;
      const rest = reference.buffers.innominates[k].position;
      const folded = foldedFaces(mesh, rest, T.getSacralMorphologyRoot().rotation.z);
      let maxEdgeRatio = 0, minEdgeRatio = Infinity;
      for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
        [[a, b], [b, c], [c, a]].forEach(([u, w]) => {
          const now = Math.hypot(pos[u * 3] - pos[w * 3], pos[u * 3 + 1] - pos[w * 3 + 1], pos[u * 3 + 2] - pos[w * 3 + 2]);
          const was = Math.hypot(rest[u * 3] - rest[w * 3], rest[u * 3 + 1] - rest[w * 3 + 1], rest[u * 3 + 2] - rest[w * 3 + 2]);
          if (was > 1e-6) { maxEdgeRatio = Math.max(maxEdgeRatio, now / was); minEdgeRatio = Math.min(minEdgeRatio, now / was); }
        });
      }
      return {
        side: ['left', 'right'][k], visible: visibleInHierarchy(mesh),
        siP95Reference: percentile(ref.band.map(i => ref.d[i]), 0.95), siP95: percentile(bandNow, 0.95), siBandMaxChangeMm: bandMaxChange,
        acetabulumToHeadReferenceMm: toHead(centroid(ref.P, ref.acetabular)), acetabulumToHeadMm: toHead(centroid(P, ref.acetabular)),
        maxDisplacementMm: maxDisplacement, foldedTriangles: folded, maxEdgeRatio, minEdgeRatio,
        finite: Array.from(pos).every(Number.isFinite)
      };
    });
  }
  function restMatches() {
    const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
    const compare = (meshes, states) => meshes.map((mesh, i) => { const now = bufferState(mesh), was = states[i];
      return same(now.position, was.position) && same(now.normal, was.normal) && same(now.box, was.box) && same(now.sphere, was.sphere); });
    return { innominates: compare(hipsMeshes, reference.buffers.innominates), overlays: compare(overlayMeshes(), reference.buffers.overlays) };
  }
  window.__PELVIS__ = { snapshot, gaitRun, loadScenario, captureReference, pelvisProbe, restMatches, txt, visibleInHierarchy, hipsMeshes };
  return Object.keys(window.__PELVIS__);
})()`;

// Compares a live snapshot with the fixture (numbers within tolerance, strings exact).
function compareValues(expected, actual, where, tolerance, mismatches) {
  if (typeof expected === 'number' || typeof actual === 'number') {
    if (!(typeof expected === 'number' && typeof actual === 'number' && Math.abs(expected - actual) <= tolerance)) mismatches.push({ where, expected, actual });
    return;
  }
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    if (expected !== actual) mismatches.push({ where, expected, actual });
    return;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  keys.forEach(key => compareValues(expected[key], actual[key], `${where}.${key}`, tolerance, mismatches));
}

async function openApp(browser) {
  const page = await browser.open(fileUrl(build), { width: 1440, height: 900 });
  await page.unlock();
  await page.waitFor(`window.__SPINE_TEST__ && window.__SPINE_TEST__.getSegments().size > 0`, { timeout: 180000 });
  await sleep(500);
  try { await page.clickSelector('#introExplore'); } catch (_) { /* intro already dismissed */ }
  await sleep(800);
  await page.eval(HELPERS);
  return page;
}

async function fieldFlow(browser) {
  const page = await openApp(browser);
  const T = 'window.__SPINE_TEST__', H = 'window.__PELVIS__';
  // P1: at startup (PI 52) the field is not even built.
  const startup = await page.eval(`(() => { const T = ${T}; return { pi: T.getState().params.pi, field: T.getPelvicIncidenceField(), hips: ${H}.hipsMeshes.map(${H}.visibleInHierarchy) }; })()`);
  check(startup.pi === 52 && startup.field.built === false && startup.hips.every(Boolean),
    'P1 at the atlas PI the hip bones are shown and no PI field is built or applied', startup);
  const referenceInfo = await page.eval(`(() => { const T = ${T}; T.setLayerVisibility({ siJoints: true, ligaments: true }); T.updateScene(); return ${H}.captureReference(); })()`);
  check(referenceInfo.bandVertices.every(n => n > 200) && referenceInfo.acetabularVertices.every(n => n > 50),
    'reference SI-region and acetabular vertex sets are non-trivial', referenceInfo);

  for (const pi of [30, 40, 65, 80]) {
    const probe = await page.eval(`(() => { const T = ${T}, H = ${H};
      H.loadScenario({ pi: ${pi}, pt: 22 }, []); T.setView('pre');
      T.setLayerVisibility({ siJoints: true, ligaments: true }); T.updateScene();
      return { sides: H.pelvisProbe(), field: T.getPelvicIncidenceField(), chip: H.txt('geometryChip'), canvas: H.txt('canvasDescription'),
        siVisible: H.visibleInHierarchy(T.getSIJoints()), ligamentsVisible: H.visibleInHierarchy(T.getPelvicLigaments()) }; })()`, { timeout: 300000 });
    const sides = probe.sides;
    notes.push({ pi, fieldUpdateMs: probe.field.lastUpdateMs, sides: sides.map(s => ({ side: s.side, siP95Reference: +s.siP95Reference.toFixed(4), siP95: +s.siP95.toFixed(4), siBandMaxChangeMm: +s.siBandMaxChangeMm.toExponential(2), acetabulumToHeadReferenceMm: +s.acetabulumToHeadReferenceMm.toFixed(4), acetabulumToHeadMm: +s.acetabulumToHeadMm.toFixed(4), maxDisplacementMm: +s.maxDisplacementMm.toFixed(1), folded: s.foldedTriangles, edgeRatio: [+s.minEdgeRatio.toFixed(2), +s.maxEdgeRatio.toFixed(2)] })) });
    if (pi === 30 || pi === 80) {
      check(sides.every(s => s.visible && s.finite && s.maxDisplacementMm > 5),
        `P2 PI ${pi}: both innominates are visible and reshaped`, sides.map(s => ({ side: s.side, visible: s.visible, maxDisplacementMm: s.maxDisplacementMm })));
    }
    check(sides.every(s => Math.abs(s.siP95 - s.siP95Reference) <= 1 && s.siBandMaxChangeMm < 0.01),
      `P3 PI ${pi}: SI congruence (p95 innominate-to-sacrum distance within 1 mm of the reference PI)`,
      sides.map(s => ({ side: s.side, ref: s.siP95Reference, now: s.siP95, bandMaxChangeMm: s.siBandMaxChangeMm })));
    check(sides.every(s => Math.abs(s.acetabulumToHeadMm - s.acetabulumToHeadReferenceMm) <= 0.5),
      `P4 PI ${pi}: hip congruence (acetabulum centre to femoral-head centre unchanged within 0.5 mm)`,
      sides.map(s => ({ side: s.side, ref: s.acetabulumToHeadReferenceMm, now: s.acetabulumToHeadMm })));
    check(sides.every(s => s.foldedTriangles === 0 && s.maxEdgeRatio < 3 && s.minEdgeRatio > 0.3),
      `P5 PI ${pi}: no folded triangles, spikes or collapsed edges`,
      sides.map(s => ({ side: s.side, folded: s.foldedTriangles, maxEdgeRatio: s.maxEdgeRatio, minEdgeRatio: s.minEdgeRatio })));
    check(probe.field.ready && probe.field.lastUpdateMs < FRAME_MS && probe.field.maxUpdateMs < FRAME_MS,
      `P6 PI ${pi}: the field update fits within one 60 Hz frame`, probe.field);
    check(probe.siVisible && probe.ligamentsVisible, `P7 PI ${pi}: SI-joint and pelvic-ligament overlays are shown`, probe);
    check(/pelvis shape adjusted schematically to PI \d+° \(educational approximation, not patient anatomy\)/.test(probe.chip)
        && !/withheld for non-reference PI/.test(probe.chip)
        && /pelvis shape is adjusted schematically/.test(probe.canvas) && /not patient anatomy/.test(probe.canvas),
      `P11 PI ${pi}: the geometry chip and scene description say the pelvis is adjusted schematically`, { chip: probe.chip, canvas: probe.canvas.slice(0, 600) });
  }

  // P7: S2AI hardware at PI 80 is visible, rigid and anchored on the field.
  const hardware = await page.eval(`(() => { const T = ${T}, H = ${H}, THREE = window.THREE;
    H.loadScenario({ pi: 80, pt: 22 }, [{ levelId: 'PELVIS-SI', procedureId: 's2aiFixation' }]); T.setView('post'); T.updateScene();
    T.getScene().updateMatrixWorld(true);
    const ref = T.getPelvisReferenceLayer(), toMm = ref.matrixWorld.clone().invert(), theta = T.getSacralMorphologyRoot().rotation.z;
    const implants = [];
    T.getPelvicHardware().children.forEach(root => root.children.forEach(implant => {
      if (!implant.isGroup || !Array.isArray(implant.userData.pelvicAnchorScene)) return;
      const anchor = new THREE.Vector3().fromArray(implant.userData.pelvicAnchorScene);
      const rest = anchor.clone().applyMatrix4(root.matrixWorld).applyMatrix4(toMm);
      const now = anchor.clone().applyMatrix4(implant.matrixWorld).applyMatrix4(toMm);
      const expected = new THREE.Vector3().fromArray(T.pelvicIncidenceFieldPoint(rest.toArray(), theta).point);
      const scale = new THREE.Vector3().setFromMatrixScale(new THREE.Matrix4().multiplyMatrices(root.matrixWorld.clone().invert(), implant.matrixWorld));
      implants.push({ name: implant.name, anchorErrorMm: now.distanceTo(expected), scale: scale.toArray(), moved: implant.position.length() > 1e-6 });
    }));
    return { visible: H.visibleInHierarchy(T.getPelvicHardware()), implants, audit: T.auditSceneStructure().passed }; })()`);
  check(hardware.visible && hardware.implants.length >= 2 && hardware.audit
      && hardware.implants.every(i => i.moved && i.anchorErrorMm < 1e-3 && i.scale.every(s => Math.abs(s - 1) < 1e-6)),
    'P7 PI 80: S2AI implants stay visible, rigid and anchored at their entry point on the field', hardware);

  // P8: back at the atlas PI every buffer and bounding volume is bit-identical.
  const restored = await page.eval(`(() => { const T = ${T}, H = ${H};
    H.loadScenario({ pi: 52, pt: 22 }, []); T.setView('pre'); T.setLayerVisibility({ siJoints: true, ligaments: true }); T.updateScene();
    return { matches: H.restMatches(), field: T.getPelvicIncidenceField() }; })()`);
  check(restored.matches.innominates.every(Boolean) && restored.matches.overlays.length > 0 && restored.matches.overlays.every(Boolean)
      && restored.field.appliedAngleDeg === 0,
    'P8 PI 52 restores the innominate and overlay buffers and bounding volumes bit for bit', restored);

  // P6: a real slider drag, left to the damped render loop.
  const drag = await page.eval(`(() => { const T = ${T};
    T.setLayerVisibility({ siJoints: false, ligaments: false, measurements: false });
    const before = T.getPelvicIncidenceField().updates;
    const slider = document.getElementById('piSlider');
    slider.scrollIntoView({ block: 'center' });
    [56, 60, 64, 68].forEach(v => { slider.value = String(v); slider.dispatchEvent(new Event('input', { bubbles: true })); });
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    return { before, pi: T.getState().params.pi }; })()`);
  await sleep(2500);
  const afterDrag = await page.eval(`(() => { const T = ${T}, H = ${H}; const f = T.getPelvicIncidenceField();
    return { field: f, pi: T.getState().params.pi, visible: H.hipsMeshes.map(H.visibleInHierarchy), sides: H.pelvisProbe().map(s => ({ side: s.side, siBandMaxChangeMm: s.siBandMaxChangeMm, folded: s.foldedTriangles })) }; })()`, { timeout: 300000 });
  check(drag.pi === 68 && afterDrag.pi === 68 && afterDrag.field.updates > drag.before + 1 && afterDrag.field.maxUpdateMs < FRAME_MS
      && afterDrag.visible.every(Boolean) && afterDrag.sides.every(s => s.siBandMaxChangeMm < 0.01 && s.folded === 0),
    'P6 a PI slider drag animates the reshaped pelvis frame by frame, each update within one 60 Hz frame, with the SI joints congruent',
    { drag, afterDrag });

  // P10: gait at PI 40 and 70 with the ilia visible.
  for (const pi of [40, 70]) {
    const gait = await page.eval(`(() => { const T = ${T}, H = ${H};
      H.loadScenario({ pi: ${pi}, pt: 22 }, []); T.setView('pre'); T.updateScene();
      T.setLowerExtremityVisibility(true); T.setGaitActive(true);
      for (let i = 0; i < 90; i++) T.stepGait(1 / 60);
      const state = T.getGaitState();
      const flags = H.txt('gaitFlags');
      const visible = H.hipsMeshes.map(H.visibleInHierarchy);
      T.setGaitActive(false);
      return { active: state.active, phase: state.phase, visible, flags }; })()`);
    check(gait.active && gait.phase > 0 && gait.visible.every(Boolean)
        && /pelvis shape is adjusted schematically to the entered PI \(an educational approximation, not patient anatomy\)/.test(gait.flags)
        && !/hidden/.test(gait.flags),
      `P10 gait starts at PI ${pi} with the ilia visible and the readout says the pelvis is adjusted schematically`, gait);
  }
  check(page.errors.length === 0, 'no page errors in the PI field flow', page.errors.join(' | '));
  await page.close();
}

async function invarianceFlow(browser) {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const page = await openApp(browser);
  const H = 'window.__PELVIS__';
  const mismatches = [];
  let scenarios = 0;
  for (const [key, expected] of Object.entries(fixture.grid)) {
    const [, pi, pt] = /^pi(\d+)_pt(\d+)$/.exec(key).map(Number);
    const actual = await page.eval(`(() => { const T = window.__SPINE_TEST__, H = ${H}; const r = {};
      H.loadScenario({ pi: ${pi}, pt: ${pt} }, []); T.setView('pre');
      r.pre = H.snapshot(); r.preGait = H.gaitRun();
      H.loadScenario({ pi: ${pi}, pt: ${pt} }, [{ procedureId: 'pso', levelId: 'L3-L4', plannedAngle: 20, plannedAngleSource: 'user_planned' }]);
      T.setView('post'); r.post = H.snapshot(); r.postGait = H.gaitRun(); T.setView('pre'); return r; })()`, { timeout: 300000 });
    compareValues(expected, actual, `grid.${key}`, fixture.tolerance, mismatches);
    scenarios += 2;
  }
  for (const [id, expected] of Object.entries(fixture.examples)) {
    const actual = await page.eval(`(() => { const T = window.__SPINE_TEST__, H = ${H}; const r = {};
      T.applyCaseExample(${JSON.stringify(id)}); T.setView('pre');
      r.pre = H.snapshot(); r.preGait = H.gaitRun();
      const options = T.getState().constructComparisons;
      r.appliedBranch = null;
      if (options.length && options[0].branches.length) {
        r.appliedBranch = { option: options[0].id, branch: options[0].branches[0].id };
        T.applyConstructComparisonBranch(options[0].id, options[0].branches[0].id);
      }
      T.setView('post'); r.post = H.snapshot(); r.postGait = H.gaitRun(); T.setView('pre'); return r; })()`, { timeout: 300000 });
    compareValues(expected, actual, `examples.${id}`, fixture.tolerance, mismatches);
    scenarios += 2;
  }
  check(mismatches.length === 0 && scenarios === 2 * (Object.keys(fixture.grid).length + Object.keys(fixture.examples).length),
    `P9 every reported value of ${scenarios} scenarios (T1PA, SVA, S1 and hip-axis proxies, C7 plumb line, gait excursion, outputs) matches the v0.23.0 release within ${fixture.tolerance}`,
    mismatches.slice(0, 12));
  check(page.errors.length === 0, 'no page errors in the invariance flow', page.errors.join(' | '));
  await page.close();
}

(async () => {
  const browser = await launch({ headless: true });
  try {
    for (const flow of [fieldFlow, invarianceFlow]) {
      try { await flow(browser); } catch (error) { check(false, `${flow.name} completed`, error && error.stack || String(error)); }
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter(result => !result.ok);
  console.log(JSON.stringify({ build, summary: { passed: results.length - failed.length, failed: failed.length, total: results.length }, failures: failed, notes }, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
