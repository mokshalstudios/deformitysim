#!/usr/bin/env node
'use strict';
// Regenerates the README screenshots in media/ from a build (no patient data: the imaging
// shot uses the synthetic AP phantom in samples/synthetic/).
//
//   node tools/readme_screenshots.js <build.html>
const fs = require('fs');
const path = require('path');
const { launch, fileUrl, sleep } = require('../audit-tools/cdp.js');

const root = path.resolve(__dirname, '..');
const build = path.resolve(process.argv[2] || path.join(root, 'spine_simulator.html'));
const media = path.join(root, 'media');
fs.mkdirSync(media, { recursive: true });

(async () => {
  const b = await launch({ headless: true });
  const page = await b.open(fileUrl(build), { width: 1600, height: 900 });
  await page.unlock();
  await page.waitFor(`!!document.getElementById('introExplore')`, { timeout: 60000 });
  await page.clickSelector('#introExplore');
  await sleep(1200);

  // 1. Flatback example, lateral view.
  await page.eval(`window.__SPINE_TEST__.applyCaseExample('flatback')`);
  await sleep(2500);
  await page.eval(`(() => { document.querySelectorAll('[class*=toast], [id*=oast]').forEach(e => { e.style.display = 'none'; }); return true; })()`);
  await page.screenshot(path.join(media, 'workspace-flatback-lateral.png'));

  // 2. Degenerative scoliosis, AP view.
  await page.eval(`window.__SPINE_TEST__.applyCaseExample('degenerative-scoliosis')`);
  await page.eval(`window.__SPINE_TEST__.setCameraViewPreset('ap')`);
  await sleep(2500);
  await page.eval(`(() => { document.querySelectorAll('[class*=toast], [id*=oast]').forEach(e => { e.style.display = 'none'; }); return true; })()`);
  await page.screenshot(path.join(media, 'workspace-scoliosis-ap.png'));

  // 3. Imaging review on the synthetic AP phantom.
  await page.eval(`(() => { const t = [...document.querySelectorAll('button,[role=tab]')].find(x => /examples\\s*&\\s*import/i.test(x.textContent)); if (t) t.click(); return !!t; })()`);
  await sleep(400);
  await page.clickSelector('#openPatientImaging');
  await sleep(600);
  await page.eval(`(() => { const c = document.getElementById('imagingAuthorization'); if (c && !c.checked) c.click(); return true; })()`);
  await sleep(300);
  const film = [path.join(root, 'samples', 'synthetic', 'synthetic_ap_a.jpg'), path.join(root, 'samples', '1.jpg')].find(p => fs.existsSync(p));
  await page.setFiles('#standingPaInput', [film]);
  await sleep(1500);
  await page.eval(`(() => { const s = document.getElementById('stagePatientImaging'); if (s && !s.disabled) s.click(); return true; })()`);
  await page.waitFor(`(() => { const r = document.querySelectorAll('#autoLandmarkResults input[data-auto-key]'); return r.length > 0; })()`, { timeout: 180000 }).catch(() => {});
  await sleep(1500);
  await page.eval(`(() => { const f = document.getElementById('autoLandmarkStatus') || document.getElementById('autoLandmarkFrontalFigure'); if (f) f.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(600);
  await page.screenshot(path.join(media, 'imaging-review-synthetic.png'));

  if (page.errors.length) console.log('page errors:', page.errors.slice(0, 5));
  console.log('screenshots written to', media);
  await b.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
