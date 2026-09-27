  /* ---------------------------------------------------------------------
     Manual rapid landmark calibration.

     Each prompt places one point. Measurements use the standard radiographic
     definitions, so PI = PT + SS is an identity the result must satisfy — it is
     computed independently and shown back as a self-check rather than assumed.
  --------------------------------------------------------------------- */

  const MANUAL_LATERAL_SEQUENCE = Object.freeze([
      { key:'c2a', target:'C2 inferior endplate — anterior corner', hint:'Front (belly-side) corner of the C2 body’s lower surface.' },
      { key:'c2p', target:'C2 inferior endplate — posterior corner', hint:'Back corner of the same surface.' },
      { key:'c7a', target:'C7 inferior endplate — anterior corner', hint:'Front corner of the C7 lower surface. C2–C7 gives cervical lordosis.' },
      { key:'c7p', target:'C7 inferior endplate — posterior corner', hint:'Back corner of the same surface.' },
      { key:'t4a', target:'T4 superior endplate — anterior corner', hint:'Front corner of the T4 upper surface. T4–T12 gives thoracic kyphosis.' },
      { key:'t4p', target:'T4 superior endplate — posterior corner', hint:'Back corner of the same surface.' },
      { key:'t12a', target:'T12 inferior endplate — anterior corner', hint:'Front corner of the T12 lower surface.' },
      { key:'t12p', target:'T12 inferior endplate — posterior corner', hint:'Back corner of the same surface.' },
      { key:'l1a', target:'L1 superior endplate — anterior corner', hint:'Front corner of the L1 upper surface. L1–S1 gives lumbar lordosis.' },
      { key:'l1p', target:'L1 superior endplate — posterior corner', hint:'Back corner of the same surface.' },
      { key:'s1a', target:'S1 superior endplate — anterior corner', hint:'Front corner of the sacral dome. Drives sacral slope, PT and PI.' },
      { key:'s1p', target:'S1 superior endplate — posterior corner', hint:'Back corner of the sacral dome. With a lateral mm/pixel value it is also the C7 SVA reference.' },
      { key:'fh1', target:'First femoral head — centre', hint:'Centre of one femoral head. If they overlap, place both on the same circle.' },
    { key:'fh2', target:'Second femoral head — centre', hint:'Centre of the other femoral head. Without both, PI and PT stay unavailable.' }
  ]);

  const MANUAL_SEQUENCES = Object.freeze({
    lateral: MANUAL_LATERAL_SEQUENCE,
    // The supine comparison only uses TK (T4–T12), LL (L1–S1) and sacral
    // slope, so it asks for those four endplates and nothing it would discard.
    supine: Object.freeze(MANUAL_LATERAL_SEQUENCE.filter(step => /^(t4|t12|l1|s1)[ap]$/.test(step.key))),
    // Corners are named by IMAGE side: which image side is the patient's right
    // depends on the declared PA/AP projection, applied to the apex side only.
    frontal: Object.freeze([
      { key:'upA', target:'Upper end vertebra — superior endplate, image-left corner', hint:'The most tilted vertebra at the top of the curve.' },
      { key:'upB', target:'Upper end vertebra — superior endplate, image-right corner', hint:'Other corner of the same endplate.' },
      { key:'lowA', target:'Lower end vertebra — inferior endplate, image-left corner', hint:'The most tilted vertebra at the bottom of the curve.' },
      { key:'lowB', target:'Lower end vertebra — inferior endplate, image-right corner', hint:'Other corner of the same endplate.' },
      { key:'apex', target:'Apex vertebra — centre', hint:'Centre of the most laterally displaced vertebra. Its patient side follows the PA/AP projection chosen at intake.' }
    ])
  });
  // Keep the start buttons' tap counts in step with the sequences above.
  [['manualStartLateral','lateral'],['manualStartFrontal','frontal'],['manualStartSupine','supine']].forEach(([id, plane]) => {
    const button = document.getElementById(id);
    if(button && /\d+ taps/.test(button.textContent)) button.textContent = button.textContent.replace(/\d+ taps/, `${MANUAL_SEQUENCES[plane].length} taps`);
  });

  const manual ={ plane:null, index:0, points:{ lateral:{}, frontal:{}, supine:{} }, active:false };

  const midpoint = (a,b) => (a && b) ? { x:(a.x+b.x)/2, y:(a.y+b.y)/2 } : null;

  // Signed angle of a->b measured from the image horizontal, normalised to +/-90.
  const segmentAngle = (a,b) => (a && b) ? normalizeAngle(degrees(Math.atan2(b.y-a.y, b.x-a.x))) : null;

  // Signed values (CL, TK, LL, PT, SVA) follow the declared lateral
  // orientation through sagittalValues, the definition the automatic and edit
  // paths share, and are omitted while it is undeclared or contradicted by
  // the sacral plate. PI is a line-to-line angle, so it needs no orientation
  // and PI = PT + SS holds for the signed values. SVA runs from the C7
  // inferior-endplate midpoint (standing in for the C7 centroid) to the
  // posterosuperior S1 corner and needs the lateral mm/pixel value.
  function manualLateralValues(plane = 'lateral'){
    const p = manual.points[plane] || {};
    const line = (a,b) => (p[a] && p[b]) ? segmentAngle(p[a], p[b]) : null;
    const raster = plane === 'lateral' ? (resultState.lateral?.analysis || resultState.previewRaster.lateral) : null;
    const measured = sagittalValues({
      angles:{ c2:line('c2a','c2p'), c7:line('c7a','c7p'), t4:line('t4a','t4p'), t12:line('t12a','t12p'), l1:line('l1a','l1p'), s1:line('s1a','s1p') },
      s1: (p.s1a && p.s1p) ? [p.s1a, p.s1p] : null,
      hip: midpoint(p.fh1, p.fh2),
      c7: midpoint(p.c7a, p.c7p),
      mmPerPixel: raster ? mmPerAnalysisPixel(raster, ui.lateralScale?.value) : null
    }, ui.anteriorSide?.value);
    const values = {};
    Object.entries(measured.values).forEach(([key, value]) => { if(Number.isFinite(value)) values[key] = value; });
    // PI − LL, the SRS-Schwab sagittal modifier, once both are measured.
    if(values.pi != null && values.ll != null) values.piLl = values.pi - values.ll;
    return values;
  }

  // Cobb is the unfolded angle between the two endplates (0–180°). The apex
  // side is in patient space via the declared PA/AP projection and withheld
  // under 10° or while the patient side is not confirmed; the apical translation (apex offset from the end-vertebra
  // chord, positive toward the patient's right) needs the frontal mm/pixel.
  function manualFrontalValues(){
    const p = manual.points.frontal;
    const values = {};
    const upper = (p.upA && p.upB) ? segmentAngle(p.upA, p.upB) : null;
    const lower = (p.lowA && p.lowB) ? segmentAngle(p.lowA, p.lowB) : null;
    if(upper!=null && lower!=null) values.coronalMagnitude = angleDifference(upper, lower);
    if(p.apex && p.upA && p.upB && p.lowA && p.lowB){
      const top = midpoint(p.upA,p.upB), bottom = midpoint(p.lowA,p.lowB);
      const f = (p.apex.y-top.y)/Math.max(1e-6, bottom.y-top.y);
      const baseline = top.x + (bottom.x-top.x)*f;
      const raster = resultState.frontal?.analysis || resultState.previewRaster.frontal;
      const apex = frontalApexValues(p.apex.x - baseline, values.coronalMagnitude, raster ? mmPerAnalysisPixel(raster, ui.frontalScale?.value) : null);
      if(apex.direction) values.coronalDirection = apex.direction;
      if(apex.trunkShift != null) values.trunkShift = apex.trunkShift;
    }
    return values;
  }

  function manualValues(){
    return { ...manualLateralValues('lateral'), ...manualFrontalValues() };
  }

  /* -----------------------------------------------------------------
     Standing vs supine positional change.

     This compares two POSITIONS. A large change means the shape is largely
     positional; a small change means it did not change between these two
     films. Neither is a measurement of segmental stiffness, and neither
     diagnoses fusion — the wording throughout stays on what was observed.
  ----------------------------------------------------------------- */

  const FLEX_REGIONS = Object.freeze([
    { key:'tk', label:'Thoracic kyphosis (T4–T12)' },
    { key:'ll', label:'Lumbar lordosis (L1–S1)' },
    { key:'sacralSlope', label:'Sacral slope' }
  ]);

  function flexibilityComparison(){
    const standing = manualLateralValues('lateral');
    const supine = manualLateralValues('supine');
    const rows = [];
    FLEX_REGIONS.forEach(region => {
      const a = standing[region.key], b = supine[region.key];
      if(a == null || b == null) return;
      const change = a - b;
      // Fraction of the standing magnitude that did not persist when supine.
      const fraction = Math.abs(a) > 1e-6 ? clampValue(Math.abs(change)/Math.abs(a), 0, 1) : null;
      const band = fraction == null ? 'partial'
        : fraction >= .35 ? 'mobile'
        : fraction >= .15 ? 'partial' : 'stiff';
      rows.push({ ...region, standing:a, supine:b, change, fraction, band });
    });
    return rows;
  }

  function renderFlexibility(){
    if(!ui.flexCompare) return;
    const rows = flexibilityComparison();
    const supinePlaced = Object.keys(manual.points.supine || {}).length;
    ui.flexCompare.hidden = rows.length === 0;
    if(!rows.length){
      if(ui.flexApply) ui.flexApply.disabled = true;
      return;
    }
    ui.flexCompareRows.innerHTML = rows.map(row => {
      const pct = row.fraction == null ? '—' : `${Math.round(row.fraction*100)}%`;
      const label = row.band === 'mobile' ? 'Largely positional'
        : row.band === 'partial' ? 'Partly positional' : 'Little change';
      return `<div class="flex-row"><span>${row.label}</span>`
        + `<small>standing <b>${row.standing.toFixed(1)}°</b></small>`
        + `<small>supine <b>${row.supine.toFixed(1)}°</b></small>`
        + `<span class="flex-tag" data-band="${row.band}">${label} · ${pct}</span></div>`;
    }).join('');

    const lumbar = rows.find(row => row.key === 'll');
    ui.flexCompareNote.textContent = lumbar
      ? `Lumbar lordosis changed ${Math.abs(lumbar.change).toFixed(1)}° between standing and supine (${Math.round((lumbar.fraction||0)*100)}% of the standing value). Segments showing little change between these two films are worth reviewing on cross-sectional imaging before assuming they will correct.`
      : 'Place the S1 and L1 landmarks on both films to compare lumbar lordosis.';
    if(ui.flexApply) ui.flexApply.disabled = !lumbar;
    ui.flexCompare.dataset.supinePoints = String(supinePlaced);
  }

  // The case model's only flexibility input is the CORONAL secondary-curve
  // flexibility, and a sagittal lordosis change between two positions cannot
  // set it. The comparison is therefore recorded with the staged imaging
  // session as its own sagittal observation and drives no modelled value.
  function applyMeasuredFlexibility(){
    const rows = flexibilityComparison();
    const lumbar = rows.find(row => row.key === 'll');
    if(!lumbar || lumbar.fraction == null) return false;
    const round = value => value == null ? null : Math.round(value*10)/10;
    const observation = Object.freeze({
      kind:'standing_vs_supine_sagittal_positional_change', source:'manual_landmarks',
      recordedAt:new Date().toISOString(), appliedToModel:false,
      rows:rows.map(row => ({ key:row.key, standing:round(row.standing), supine:round(row.supine), change:round(row.change), fraction:row.fraction == null ? null : Math.round(row.fraction*100)/100 }))
    });
    if(state && state.patientImaging) state.patientImaging = { ...state.patientImaging, positionalComparison:observation };
    const percent = Math.round(clampValue(lumbar.fraction, 0, 1)*100);
    setStatus(`Standing-vs-supine change recorded with this imaging session (lumbar lordosis ${percent}% positional). It is a sagittal two-position observation, so it is not written into the coronal secondary-curve flexibility or any other model input.`, 'ready');
    showToast('Positional change recorded');
    return true;
  }

  function renderManualReadout(){
    if(!ui.manualReadout) return;
    const values = manualValues();
    const cell = (label, text, check) =>
      `<span${check?` data-check="${check}"`:''}><small>${label}</small><b>${text}</b></span>`;
    const deg = v => `${v.toFixed(1)}°`;
    const parts = [];
    // Signed lateral values need a declared anterior side that the placed
    // sacral plate does not contradict; say which, instead of a silent gap.
    const p = manual.points.lateral || {};
    const has = (...keys) => keys.every(key => p[key]);
    const side = explicitLateralOrientation(ui.anteriorSide?.value);
    const s1Tilt = has('s1a','s1p') ? anteriorDownTilt(segmentAngle(p.s1a, p.s1p), side) : null;
    const withheld = !side ? 'choose anterior side'
      : (s1Tilt != null && s1Tilt < SACRAL_SLOPE_FLOOR) ? 'S1 contradicts side' : null;
    const signedCell = (label, value, keys, text = deg) => {
      if(value != null) parts.push(cell(label, text(value)));
      else if(withheld && has(...keys)) parts.push(cell(label, withheld, 'withheld'));
    };
    signedCell('C2–C7', values.cl, ['c2a','c2p','c7a','c7p']);
    signedCell('T4–T12 TK', values.tk, ['t4a','t4p','t12a','t12p']);
    signedCell('L1–S1 LL', values.ll, ['l1a','l1p','s1a','s1p']);
    if(values.sacralSlope!=null) parts.push(cell('Sacral slope', deg(values.sacralSlope)));
    signedCell('Pelvic tilt', values.pt, ['s1a','s1p','fh1','fh2']);
    if(values.pi!=null) parts.push(cell('Pelvic incidence', deg(values.pi)));
    if(values.piLl!=null) parts.push(cell('PI − LL', deg(values.piLl)));
    if(values.measuredSva!=null) parts.push(cell('C7 SVA', `${values.measuredSva.toFixed(1)} cm`));
    else if(has('c7a','c7p','s1a','s1p')) parts.push(cell('C7 SVA', withheld || 'needs lateral mm/px', 'withheld'));
    if(values.coronalMagnitude!=null) parts.push(cell('Cobb', deg(values.coronalMagnitude)));
    if(values.coronalDirection) parts.push(cell('Apex', values.coronalDirection === 'right' ? 'Right' : 'Left'));
    else if(values.coronalMagnitude >= MIN_LATERALISED_COBB && manual.points.frontal?.apex && !frontalLateralityConfirmed()) parts.push(cell('Apex', 'patient side not confirmed', 'withheld'));
    // Apical translation keeps the worksheet sign: positive toward the patient's right.
    if(values.trunkShift!=null) parts.push(cell('Apical translation', `${values.trunkShift >= 0 ? '+' : ''}${values.trunkShift.toFixed(0)} mm`));
    // PI = PT + SS is a geometric identity, so a mismatch means a mis-placed
    // point rather than an unusual patient. Surface it instead of hiding it.
    if(values.pi!=null && values.pt!=null && values.sacralSlope!=null){
      const residual = Math.abs(values.pi - (values.pt + values.sacralSlope));
      parts.push(cell('PI − (PT+SS)', `${residual.toFixed(1)}°`, residual <= 3 ? 'pass' : 'fail'));
    }
    ui.manualReadout.hidden = parts.length === 0;
    ui.manualReadout.innerHTML = parts.join('');
  }

  // True while this plane is the one being calibrated — used to suppress every
  // automatic overlay so the user sees a clean image.
  function manualFocused(plane){
    return manual.active && manual.plane === plane;
  }

  function applyManualFocus(){
    const figures = { frontal: ui.frontalFigure, lateral: ui.lateralFigure, supine: ui.supineFigure };
    Object.entries(figures).forEach(([plane, figure])=>{
      if(!figure) return;
      const focused = manualFocused(plane);
      // Entering or leaving focus resizes the canvas, so the view starts fitted.
      if(figure.dataset.focus !== String(focused)) fitView(plane);
      figure.dataset.focus = String(focused);
      // The focused figure must be visible even if its plane has no result yet.
      if(focused) figure.hidden = false;
    });
    if(manual.active) document.body.dataset.manualFocus = 'true';
    else delete document.body.dataset.manualFocus;
    measureManualChrome();
    // Overlay sizes follow the on-screen scale, which the new layout changed.
    requestAnimationFrame(() => EDIT_PLANES.forEach(plane => { if(planeRaster(plane)) scheduleRedraw(plane); }));
  }

  /* The prompt wraps to different heights depending on the landmark description,
     so the space the image has to avoid is measured rather than assumed. Runs
     after a layout pass so the freshly shown bars report real heights. */
  function measureManualChrome(){
    const set = () => {
      const root = document.documentElement;
      if(!manual.active){
        root.style.removeProperty('--manual-prompt-height');
        root.style.removeProperty('--manual-bar-height');
        return;
      }
      // A zero height means the element has not been laid out yet. Writing that
      // through would clear the reserved space and put the banner back over the
      // top of the film, so the CSS fallback is left in place instead.
      const apply = (node, prop) => {
        if(!node || node.hidden) return;
        const height = Math.ceil(node.getBoundingClientRect().height);
        if(height > 0) root.style.setProperty(prop, `${height}px`);
      };
      apply(ui.manualPrompt, '--manual-prompt-height');
      apply(document.getElementById('manualFocusBar'), '--manual-bar-height');
    };
    set();
    requestAnimationFrame(set);
  }

  // Short chip labels for the step list; the full target is the tooltip.
  const manualStepLabel = key => ({ upA:'Upper 1', upB:'Upper 2', lowA:'Lower 1', lowB:'Lower 2', apex:'Apex', fh1:'FH 1', fh2:'FH 2' })[key]
    || String(key).replace(/^([a-z]+)(\d*)([ap]?)$/i, (match, level, number, side) => `${level.toUpperCase()}${number}${side ? (side === 'a' ? ' ant' : ' post') : ''}`);
  // The landmark list: every step as a chip showing placed / open / current.
  // Choosing one re-places that landmark, so fixing step 3 of 14 no longer
  // means undoing the eleven correct points after it.
  function renderManualSteps(sequence){
    const prompt = ui.manualPrompt;
    if(!prompt || typeof document.createElement !== 'function') return;
    let host = prompt.querySelector ? prompt.querySelector('.manual-steps') : null;
    if(!host){
      host = document.createElement('div');
      host.className = 'manual-steps';
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', 'Landmarks. Choose one to place or re-place it');
      host.addEventListener('click', event => {
        const button = event.target && event.target.closest ? event.target.closest('button[data-step]') : null;
        if(button) jumpManualStep(Number(button.dataset.step));
      });
      prompt.append(host);
    }
    if(host.dataset.plane !== manual.plane || host.children.length !== sequence.length){
      host.dataset.plane = manual.plane || '';
      host.replaceChildren(...sequence.map((step, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.step = String(index);
        button.textContent = manualStepLabel(step.key);
        button.title = step.target;
        button.setAttribute('aria-label', `Landmark ${index+1}: ${step.target}`);
        return button;
      }));
    }
    const points = manual.points[manual.plane] || {};
    Array.from(host.children).forEach((button, index) => {
      const step = sequence[index];
      if(!step) return;
      const current = index === manual.index;
      button.dataset.state = current ? 'current' : points[step.key] ? 'placed' : 'open';
      if(current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
  }
  // Live values inside focus mode, where the results list is out of sight.
  function renderManualFocusReadout(){
    const prompt = ui.manualPrompt;
    if(!prompt || typeof document.createElement !== 'function') return;
    let line = prompt.querySelector ? prompt.querySelector('.manual-focus-readout') : null;
    if(!line){ line = document.createElement('p'); line.className = 'manual-focus-readout'; prompt.append(line); }
    const values = (manual.plane === 'frontal' ? manualFrontalValues() : manualLateralValues(manual.plane)) || {};
    const parts = [];
    [['coronalMagnitude','Cobb'],['cl','C2–C7'],['tk','TK'],['ll','LL'],['sacralSlope','SS'],['pt','PT'],['pi','PI']].forEach(([key, label]) => {
      if(Number.isFinite(values[key])) parts.push(`${label} ${values[key].toFixed(1)}°`);
    });
    if(values.coronalDirection) parts.push(`apex ${values.coronalDirection}`);
    line.textContent = parts.length ? parts.join(' · ') : 'Values appear here as the landmarks that define them are placed.';
  }
  function renderManualPrompt(){
    const sequence = MANUAL_SEQUENCES[manual.plane] || [];
    const step = sequence[manual.index];
    if(!ui.manualPrompt) return;
    ui.manualPrompt.hidden = !manual.active;
    applyManualFocus();
    if(ui.frontalFigure) ui.frontalFigure.dataset.manual = String(manual.active && manual.plane==='frontal');
    if(ui.lateralFigure) ui.lateralFigure.dataset.manual = String(manual.active && manual.plane==='lateral');
    if(ui.supineFigure) ui.supineFigure.dataset.manual = String(manual.active && manual.plane==='supine');
    // Undo/Redo follow the edit history, so they stay usable after Done.
    updateHistoryUi();
    const skipButton = document.getElementById('manualFocusSkip');
    if(skipButton) skipButton.disabled = !manual.active || !step;
    if(ui.manualReset) ui.manualReset.disabled = !manual.active && !EDIT_PLANES.some(plane => Object.keys(manual.points[plane] || {}).length);
    if(!manual.active) return;
    renderManualSteps(sequence);
    renderManualFocusReadout();
    const hint = document.getElementById('manualFocusHint');
    const coarse = Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const points = manual.points[manual.plane] || {};
    const placed = sequence.filter(item => points[item.key]).length;
    if(!step){
      const skipped = sequence.length - placed;
      // Three planes are reachable, so a two-way label told supine users they
      // had finished the frontal film - the one plane they had not touched.
      const planeLabel = manual.plane === 'lateral' ? 'Lateral'
        : manual.plane === 'supine' ? 'Supine' : 'Frontal';
      ui.manualStep.textContent = 'Complete';
      ui.manualTarget.textContent = skipped > 0
        ? `${planeLabel} landmarks done · ${skipped} skipped`
        : `${planeLabel} landmarks complete`;
      ui.manualHint.textContent = skipped > 0
        ? 'Measurements that needed a skipped landmark are omitted rather than estimated. Choose a step above to place it, or drag any point to adjust it.'
        : 'Drag any point to adjust it, or choose a step above to re-place it. Done returns to the panel, where the values join the results list.';
      if(hint) hint.textContent = coarse ? 'Drag a point to adjust it' : 'Drag a point to adjust it · wheel zooms';
      ui.manualProgressFill.style.width = '100%';
      setManualProgressAria(sequence.length, sequence.length);
      // Measured again once the copy, step list and readout are final, so the
      // image is inset by the prompt's real height at once, not a frame later.
      measureManualChrome();
      return;
    }
    ui.manualStep.textContent = `Step ${manual.index+1} / ${sequence.length}`;
    ui.manualTarget.textContent = step.target;
    ui.manualHint.textContent = step.hint;
    if(hint) hint.textContent = coarse ? 'Touch, slide to fine-tune, lift to place' : 'Click to place · wheel zooms · arrows + Enter place by keyboard';
    const progress = Math.max(manual.index, placed);
    ui.manualProgressFill.style.width = `${Math.round((progress/sequence.length)*100)}%`;
    setManualProgressAria(progress, sequence.length);
    measureManualChrome();
  }
  function setManualProgressAria(now, max){
    const bar = ui.manualProgressFill && ui.manualProgressFill.parentElement;
    if(!bar || bar.getAttribute('role') !== 'progressbar') return;
    bar.setAttribute('aria-valuemax', String(max));
    bar.setAttribute('aria-valuenow', String(now));
  }

  function startManual(plane){
    // Focus mode must belong to a raster from the current imaging generation.
    const available = plane === 'supine'
      ? resultState.previewRaster.supine
      : resultState[plane] || resultState.previewRaster[plane];
    if(!available){
      setStatus(`Load the current ${plane} image before starting manual calibration.`, 'warning');
      return false;
    }
    // Points already on this film are kept and the prompt resumes at the first
    // landmark still missing: restarting used to wipe every point unasked.
    // Reset clears them (and is undoable).
    manual.points[plane] = manual.points[plane] || {};
    const resumed = Object.keys(manual.points[plane]).length;
    manual.plane = plane;
    manual.index = nextOpenStep(plane, 0);
    manual.active = true;
    resultState.activeGuide = null;
    resultState.selectedHandle = null;
    resultState.drag = null;
    renderManualPrompt();
    renderManualReadout();
    renderAll();
    const figure = plane==='frontal' ? ui.frontalFigure : plane==='supine' ? ui.supineFigure : ui.lateralFigure;
    scrollFigureIntoImagingBody(figure, 'center');
    // Keyboard users land on the image: arrows move a crosshair, Enter places.
    const canvas = planeCanvas(plane);
    if(canvas && typeof canvas.focus === 'function') canvas.focus({ preventScroll:true });
    setStatus(resumed
      ? `Manual calibration resumed on the ${plane} image: ${resumed} landmark${resumed===1?'':'s'} already placed. Drag any of them to adjust, or choose a step to re-place it.`
      : `Manual calibration started. Tap each prompted point on the ${plane} image.`, 'running');
    return true;
  }

  // First step at or after `from` with no point placed (the length when none).
  function nextOpenStep(plane, from){
    const sequence = MANUAL_SEQUENCES[plane] || [], points = manual.points[plane] || {};
    for(let i = Math.max(0, from); i < sequence.length; i++) if(!points[sequence[i].key]) return i;
    return sequence.length;
  }
  function pendingManualStep(){
    return manual.active ? (MANUAL_SEQUENCES[manual.plane] || [])[manual.index] || null : null;
  }
  // Points the prompt at any step, placed or not; the next tap (re)places it.
  function jumpManualStep(index){
    const sequence = MANUAL_SEQUENCES[manual.plane] || [];
    if(!manual.active || !(index >= 0 && index < sequence.length)) return false;
    manual.index = index;
    renderManualPrompt();
    redrawPlane(manual.plane);
    return true;
  }
  // Moves an existing landmark (drag or keyboard nudge; history is recorded
  // by the caller once per gesture).
  function setManualPoint(plane, key, point){
    if(!manual.points[plane] || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    manual.points[plane][key] = { x:point.x, y:point.y };
    return true;
  }

  function recordManualPoint(plane, point){
    if(!manual.active || manual.plane !== plane) return false;
    const sequence = MANUAL_SEQUENCES[plane] || [];
    const step = sequence[manual.index];
    if(!step || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const before = editSnapshot(plane, 'manual');
    manual.points[plane][step.key] = { x:point.x, y:point.y };
    commitEdit(before);
    // Sequential flow moves to the next step; after re-placing an earlier
    // step it returns to the first landmark still missing after it.
    manual.index = nextOpenStep(plane, manual.index + 1);
    if(manual.index >= sequence.length){
      setStatus(`Manual ${plane} calibration complete. Review the values, then transfer them to the worksheet.`, 'ready');
    }
    renderAfterManualChange();
    return true;
  }

  /* Landmarks are routinely unreadable: collimated off the film, obscured by
     bowel gas or the shoulder girdle, or destroyed by hardware. Forcing a guess
     would put a fabricated point into the measurement, so a step can be passed
     over instead. Every derived value in manualLateralValues is already guarded
     on the presence of its own landmarks, so skipping one drops exactly the
     measurements that depended on it and leaves the rest intact. */
  function skipManualPoint(){
    if(!manual.active) return false;
    const sequence = MANUAL_SEQUENCES[manual.plane] || [];
    const step = sequence[manual.index];
    if(!step) return false;
    const before = editSnapshot(manual.plane, 'manual');
    delete manual.points[manual.plane][step.key];
    commitEdit(before);
    manual.index = nextOpenStep(manual.plane, manual.index + 1);
    if(manual.index >= sequence.length){
      setStatus(`Manual ${manual.plane} calibration finished with skipped landmarks. Measurements that needed them are omitted.`, 'ready');
    }
    renderAfterManualChange();
    return true;
  }

  // Undo is the edit history: any placement, move, skip or reset can be
  // reverted, in focus mode (for the plane being calibrated) and after Done.
  function undoManual(){
    return undoEdit(manual.active ? manual.plane : null);
  }

  // Leaves focus mode but keeps every placed point, so the user can review the
  // overlay and the derived values without starting over.
  function finishManual(){
    if(!manual.active) return;
    const plane = manual.plane;
    manual.active = false;
    resultState.selectedHandle = null;
    editorGestures[plane] = null;
    hideLoupe();
    renderAfterManualChange();
    const placed = Object.keys(manual.points[plane] || {}).length;
    setStatus(placed
      ? 'Manual landmarks saved. The derived values are in the results list below and override the detector. Drag any point to adjust it.'
      : 'Manual calibration closed. No points were placed.', placed ? 'ready' : 'idle');
    // Keyboard focus returns to the control that started the session.
    const start = plane === 'frontal' ? ui.manualStartFrontal : plane === 'supine' ? ui.manualStartSupine : ui.manualStartLateral;
    if(start && !start.hidden && typeof start.focus === 'function') start.focus({ preventScroll:true });
  }

  function resetManual(){
    // Undoable rather than confirmed: Undo brings every cleared point back.
    const before = editSnapshot(null, 'manualAll');
    const had = EDIT_PLANES.some(plane => Object.keys(manual.points[plane] || {}).length);
    manual.active = false; manual.plane = null; manual.index = 0;
    manual.points = { lateral:{}, frontal:{}, supine:{} };
    resultState.selectedHandle = null;
    hideLoupe();
    if(had) commitEdit(before);
    renderAfterManualChange();
    setStatus(had ? 'Manual landmarks cleared. Undo restores them.' : 'Manual landmarks cleared.', 'idle');
  }

  const ENDPLATE_CORNER_PAIRS = Object.freeze([
    ['c2a','c2p'], ['c7a','c7p'], ['t4a','t4p'], ['t12a','t12p'], ['l1a','l1p'], ['s1a','s1p'],
    ['upA','upB'], ['lowA','lowB']
  ]);
  function drawManualPoints(ctx, plane){
    const points = manual.points[plane] || {};
    const u = overlayUnit(ctx);
    // Join the endplate corner pairs so the fitted line is visible as it forms.
    // Pairs are named explicitly rather than taken from consecutive steps, so
    // a sequence can gain single-point steps (apex, C7 centre, CSVL) without a
    // stray line being drawn to them; the femoral heads have their own axis.
    ENDPLATE_CORNER_PAIRS.forEach(([keyA, keyB]) => {
      const a = points[keyA], b = points[keyB];
      if(!a || !b) return;
      ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2*u;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    });
    const current = pendingManualStep();
    Object.entries(points).forEach(([key, p])=>{
      const isHip = key === 'fh1' || key === 'fh2';
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5*u, 0, Math.PI*2);
      ctx.fillStyle = isHip ? '#f472b6' : '#34d399'; ctx.fill();
      ctx.lineWidth = 1.5*u; ctx.strokeStyle = 'rgba(236,253,245,.95)'; ctx.stroke();
      // The landmark the prompt is about to re-place is ringed in yellow.
      if(manualFocused(plane) && current && current.key === key){
        ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2*u;
        ctx.beginPath(); ctx.arc(p.x, p.y, 10*u, 0, Math.PI*2); ctx.stroke();
      }
    });
    // Femoral-head axis and the sacral connection that PT/PI are measured from.
    if(points.fh1 && points.fh2){
      ctx.strokeStyle = 'rgba(244,114,182,.9)'; ctx.lineWidth = 2*u;
      ctx.beginPath(); ctx.moveTo(points.fh1.x,points.fh1.y); ctx.lineTo(points.fh2.x,points.fh2.y); ctx.stroke();
      const hip = midpoint(points.fh1, points.fh2), sacral = midpoint(points.s1a, points.s1p);
      if(sacral){
        ctx.setLineDash([5*u,4*u]);
        ctx.beginPath(); ctx.moveTo(hip.x,hip.y); ctx.lineTo(sacral.x,sacral.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

