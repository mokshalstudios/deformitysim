(function(){
  'use strict';
  const VERSION = '0.20.0-beta.1';
  const resultState = {
    frontal: null, lateral: null, running: false, imagingGeneration: 0,
    activeRunGeneration: null, stagedStandingFiles: null,
    guides: { frontal: {}, lateral: {} }, activeGuide: null, drag: null, previewError: {},
    selectedHandle: null, previewRaster: { frontal: null, lateral: null, supine: null }
  };
  const currentImagingFile = kind => kind === 'frontal' ? patientImagingSession.frontal
    : kind === 'supine' ? patientImagingSession.supine
    : patientImagingSession.lateral;
  const captureStandingFiles = () => ({
    frontal: patientImagingSession.frontal || null,
    lateral: patientImagingSession.lateral || null
  });
  const standingFilesMatch = snapshot => Boolean(snapshot
    && snapshot.frontal === patientImagingSession.frontal
    && snapshot.lateral === patientImagingSession.lateral);
  const imagingWorkIsCurrent = (generation, kind = null, file = null) =>
    generation === resultState.imagingGeneration
      && (!kind || currentImagingFile(kind) === file);
  function invalidateImagingWork(clearStagedFiles = false){
    resultState.imagingGeneration += 1;
    resultState.activeRunGeneration = null;
    resultState.running = false;
    if(clearStagedFiles) resultState.stagedStandingFiles = null;
    return resultState.imagingGeneration;
  }
  const byId = id => document.getElementById(id);
  const ui = {};
  const clampValue = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const finite = value => Number.isFinite(Number(value));
  const radians = deg => deg * Math.PI / 180;
  const degrees = rad => rad * 180 / Math.PI;
  const normalizeAngle = angle => {
    let value = angle;
    while (value > 90) value -= 180;
    while (value < -90) value += 180;
    return value;
  };
  // Endplates are sub-horizontal lines, so each tilt is normalised once into
  // ±90 and the difference is not wrapped again: endplates tilted +50° and
  // −50° enclose a 100° Cobb angle, which re-wrapping used to fold to 80°.
  const angleDifference = (a, b) => Math.abs(normalizeAngle(a) - normalizeAngle(b));
  const explicitLateralOrientation = value => value === 'left' || value === 'right' ? value : null;
  // Anterior-down tilt of a lateral endplate line (degrees; positive when its
  // anterior end is lower). A normalised line angle does not depend on which
  // end was placed first, so only the declared anterior side sets the sign:
  // image y grows downward, so with anterior on image-left a lower anterior
  // end gives a negative image angle. Mirroring the image flips every sign,
  // which is why nothing signed is emitted without a declared anterior side.
  const anteriorDownTilt = (angle, orientation) => {
    const side = explicitLateralOrientation(orientation);
    if(!Number.isFinite(angle) || !side) return null;
    const tilt = normalizeAngle(angle);
    return side === 'left' ? -tilt : tilt;
  };
  // Signed regional angle from an upper to a lower endplate, lordosis
  // positive: in lordosis the endplates tilt progressively more anterior-down
  // going caudally (they converge posteriorly). C2–C7 and L1–S1 use it as is;
  // T4–T12 kyphosis is its negation. Same convention as the case panel's CL
  // slider (positive lordosis, negative kyphosis).
  const signedLordosis = (upperAngle, lowerAngle, orientation) => {
    const upper = anteriorDownTilt(upperAngle, orientation), lower = anteriorDownTilt(lowerAngle, orientation);
    return upper == null || lower == null ? null : lower - upper;
  };
  const signedKyphosis = (upperAngle, lowerAngle, orientation) => {
    const lordosis = signedLordosis(upperAngle, lowerAngle, orientation);
    return lordosis == null ? null : -lordosis;
  };
  const signedCervicalAngle = (c2Angle, c7Angle, orientation) => signedLordosis(c2Angle, c7Angle, orientation);
  // Pelvic tilt: angle from the vertical to the line joining the femoral-head
  // axis and the S1 endplate midpoint, positive when the axis lies anterior to
  // that midpoint (Duval-Beaupère/Legaye). Negative PT is real anatomy, so the
  // sign is kept; the axis must sit below the sacral plate.
  const signedPelvicTilt = (hip, sacralMid, orientation) => {
    const side = explicitLateralOrientation(orientation);
    if(!side || !hip || !sacralMid || ![hip.x, hip.y, sacralMid.x, sacralMid.y].every(Number.isFinite)) return null;
    const below = hip.y - sacralMid.y;
    if(!(below > 0)) return null;
    const anterior = (hip.x - sacralMid.x) * (side === 'left' ? -1 : 1);
    return Math.atan2(anterior, below) * 180 / Math.PI;
  };
  // Pelvic incidence: angle between the S1 endplate normal at its midpoint and
  // the line to the femoral-head axis. It is a line-to-line angle, so it needs
  // no orientation; PI = PT + SS then holds for the signed PT and SS.
  const pelvicIncidence = (endA, endB, hip) => {
    if(!endA || !endB || !hip || ![endA.x, endA.y, endB.x, endB.y, hip.x, hip.y].every(Number.isFinite)) return null;
    const ex = endB.x - endA.x, ey = endB.y - endA.y;
    const hx = hip.x - (endA.x + endB.x)/2, hy = hip.y - (endA.y + endB.y)/2;
    const scale = Math.hypot(ex, ey) * Math.hypot(hx, hy);
    if(!(scale > 1e-9) || !(hy > 0)) return null;
    return Math.acos(Math.min(1, Math.abs(ex*hy - ey*hx)/scale)) * 180 / Math.PI;
  };
  const confidenceLevel = score => score >= .68 ? 'high' : score >= .42 ? 'medium' : 'low';
  const confidenceLabel = score => `${confidenceLevel(score)} · ${Math.round(clampValue(score,0,1)*100)}%`;
  // requestAnimationFrame never fires while the tab is backgrounded or otherwise
  // not compositing, which would leave the analysis awaiting forever with its
  // controls disabled. Race it against a timer so the run always progresses.
  const nextFrame = () => new Promise(resolve => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; resolve(); };
    requestAnimationFrame(done);
    setTimeout(done, 60);
  });


  const GUIDE_LABELS = Object.freeze({
    'frontal.top':'Frontal top anchor',
    'frontal.bottom':'Frontal bottom anchor',
    'frontal.apex':'Frontal apex anchor',
    'lateral.c2':'Lateral C2 anchor',
    'lateral.s1':'Lateral S1 anchor',
    'lateral.hip':'Lateral hip-center anchor'
  });

  function lineAngleFromPoints(a,b){ return degrees(Math.atan2(b.y-a.y, b.x-a.x)); }
  function lineCenter(line){ return {x:(line.a.x+line.b.x)/2, y:(line.a.y+line.b.y)/2}; }
  function copyPoint(p){ return p ? {x:p.x, y:p.y} : null; }
  function syncLineGeometry(line){
    if(!line || !line.a || !line.b) return;
    line.cx=(line.a.x+line.b.x)/2; line.cy=(line.a.y+line.b.y)/2; line.angle=lineAngleFromPoints(line.a,line.b);
  }
  function setEditorDescription(title, description){
    if(!ui.editorSummary||!ui.editorTitle||!ui.editorDescription) return;
    ui.editorSummary.hidden=false; ui.editorTitle.textContent=title; ui.editorDescription.textContent=description;
  }
  function clearActiveGuideButtons(){
    if(!ui.guideButtons) return;
    ui.guideButtons.forEach(button=>button.dataset.active='false');
  }
  function setActiveGuide(key){
    resultState.activeGuide = key || null;
    clearActiveGuideButtons();
    if(ui.frontalFigure) ui.frontalFigure.dataset.guideTarget = key && key.startsWith('frontal') ? 'true' : 'false';
    if(ui.lateralFigure) ui.lateralFigure.dataset.guideTarget = key && key.startsWith('lateral') ? 'true' : 'false';
    if(key){
      const button = ui.guideButtons.find(node=>node.dataset.guide===key);
      if(button) button.dataset.active='true';
      setEditorDescription('Guide placement', `${GUIDE_LABELS[key] || 'Guide'} selected. Click the corresponding preview image to place or replace that point.`);
      setStatus(`${GUIDE_LABELS[key] || 'Guide'} selected. Click the matching preview image to place the anchor.`, 'warning');
      const targetFigure = key.startsWith('frontal') ? ui.frontalFigure : ui.lateralFigure;
      if(targetFigure && !targetFigure.hidden) scrollFigureIntoImagingBody(targetFigure, 'nearest');
      else if(ui.previewGrid && ui.previewGrid.hidden && typeof prepareGuidePreview === 'function') prepareGuidePreview();
    }
  }
  // Brings a preview figure into view by scrolling the imaging dialog's body
  // (#patientImagingBody), below its sticky run bar. figure.scrollIntoView
  // would also scroll the dialog frame itself in browsers without
  // overflow:clip (Safari before 16). block is 'nearest' or 'center'.
  function scrollFigureIntoImagingBody(figure, block){
    if(!figure || figure.hidden || typeof figure.getBoundingClientRect !== 'function') return false;
    const body = byId('patientImagingBody');
    if(!body || !body.contains(figure) || typeof body.scrollTo !== 'function') return false;
    const runBar = byId('imagingRunBar');
    const inset = runBar && !runBar.hidden ? runBar.offsetHeight : 0;
    const view = body.getBoundingClientRect(), rect = figure.getBoundingClientRect();
    const viewTop = view.top + inset, viewHeight = Math.max(1, view.bottom - viewTop);
    let delta;
    if(block === 'center') delta = rect.top - viewTop - Math.max(0, (viewHeight - rect.height) / 2);
    else if(rect.top < viewTop + 8 || rect.height > viewHeight - 16) delta = rect.top - viewTop - 8;
    else if(rect.bottom > view.bottom - 8) delta = rect.bottom - view.bottom + 8;
    else return true;
    body.scrollTo({ top: Math.max(0, body.scrollTop + delta), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    return true;
  }
  function setGuidePoint(plane,key,point){
    resultState.guides[plane][key] = { x: point.x, y: point.y };
    setActiveGuide(null);
    setEditorDescription('Guide saved', `${GUIDE_LABELS[`${plane}.${key}`] || 'Guide point'} placed at x ${Math.round(point.x)}, y ${Math.round(point.y)}. Re-run calibration to use this anchor.`);
    if(resultState.previewRaster.frontal || resultState.previewRaster.lateral) renderGuidePreview();
  }
  function clearGuidePoints(){
    resultState.guides = { frontal: {}, lateral: {} };
    resultState.selectedHandle = null;
    resultState.drag = null;
    clearActiveGuideButtons();
    setEditorDescription('Guide points cleared', 'All user anchor points were removed. You can place new guide points and rerun calibration.');
    renderGuidePreview();
    if(resultState.frontal || resultState.lateral) renderResults();
  }
  // Client point -> analysis-frame point. The preview canvas is letterboxed by
  // object-fit: contain (and scaled/panned by the zoom transform), so the map
  // goes through the painted content box rather than the element box, then
  // from display-resolution canvas pixels to the analysis frame. `inside` is
  // false in the letterbox bars, where nothing may be placed.
  function pickCanvasPoint(event, canvas){
    const rect = canvas.getBoundingClientRect();
    const cw = Math.max(1, canvas.width), ch = Math.max(1, canvas.height);
    const s = Math.min(rect.width / cw, rect.height / ch) || 1;
    const cx = (event.clientX - rect.left - (rect.width - cw*s)/2) / s;
    const cy = (event.clientY - rect.top - (rect.height - ch*s)/2) / s;
    const frame = canvasFrames.get(canvas) || { kx:1, ky:1 };
    return { x: cx/frame.kx, y: cy/frame.ky, inside: cx >= 0 && cy >= 0 && cx <= cw && cy <= ch };
  }
  function drawGuideDots(ctx, plane){
    if(manualFocused(plane)) return;
    const guides = resultState.guides[plane] || {};
    const u = overlayUnit(ctx);
    Object.entries(guides).forEach(([key, point])=>{
      ctx.fillStyle = '#f43f5e'; ctx.strokeStyle='rgba(255,255,255,.95)'; ctx.lineWidth=1.5*u;
      ctx.beginPath(); ctx.arc(point.x, point.y, 5*u, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      drawLabel(ctx, key.toUpperCase(), point.x + 8*u, point.y - 6*u, '#fecdd3');
    });
  }
  async function loadPreviewRaster(kind, generation = resultState.imagingGeneration){
    const file = currentImagingFile(kind);
    if(!file) {
      if(imagingWorkIsCurrent(generation, kind, file)) resultState.previewRaster[kind] = null;
      return null;
    }
    // A plane whose file and view options did not change keeps its raster, so
    // replacing one film no longer re-decodes the others.
    const existing = resultState.previewRaster[kind];
    if(existing && existing.fileToken === rasterFileToken(file) && rasterOptionsKey(existing.rasterOptions || {}) === rasterOptionsKey(rasterOptionsFor(file))) return existing;
    // Analysis and decoding may outlive a clear or file replacement. Commit
    // only when both the generation and the exact File object still match.
    try {
      const raster = await rasterFromFile(file);
      if(!imagingWorkIsCurrent(generation, kind, file)) return null;
      const analysed = buildAnalysis(raster);
      if(!imagingWorkIsCurrent(generation, kind, file)) return null;
      resultState.previewRaster[kind] = analysed;
      if(resultState.previewError) delete resultState.previewError[kind];
      return analysed;
    } catch(error){
      // Remember why, so manual calibration can say what went wrong instead of
      // appearing to ignore the button.
      if(imagingWorkIsCurrent(generation, kind, file)){ resultState.previewError = {...(resultState.previewError||{}), [kind]: error.message}; }
      if(imagingWorkIsCurrent(generation, kind, file)) resultState.previewRaster[kind] = null;
      return null;
    }
  }
  async function prepareGuidePreview(generation = resultState.imagingGeneration){
    await Promise.all([
      loadPreviewRaster('frontal', generation),
      loadPreviewRaster('lateral', generation),
      loadPreviewRaster('supine', generation)
    ]);
    if(!imagingWorkIsCurrent(generation)) return false;
    renderGuidePreview();
    return true;
  }

  // The supine image is never auto-analysed; it exists purely as a manual
  // landmark surface for the positional comparison.
  function renderSupinePreview(){
    const raster = resultState.previewRaster.supine;
    const available = !!raster;
    if(ui.manualStartSupine) ui.manualStartSupine.hidden = !available;
    if(!ui.supineFigure) return;
    ui.supineFigure.hidden = !available;
    if(!available) return;
    const ctx = paintPlane(ui.supineCanvas, raster, 'supine');
    if(!ctx) return;
    drawManualPoints(ctx, 'supine');
    drawEditableHandles(ctx, 'supine');
    finishPaint(ui.supineCanvas, 'supine');
  }

  function resetSupineLandmarks(){
    resultState.previewRaster={...resultState.previewRaster,supine:null};
    manual.points.supine={};
    if(manual.active&&manual.plane==='supine'){manual.active=false;manual.index=0;}
    renderManualPrompt();renderManualReadout();renderFlexibility();
  }
  async function refreshSupine(){
    const generation = resultState.imagingGeneration;
    await loadPreviewRaster('supine', generation);
    if(!imagingWorkIsCurrent(generation)) return false;
    renderSupinePreview();
    renderFlexibility();
    if(ui.previewGrid) ui.previewGrid.hidden = !(resultState.frontal||resultState.lateral||resultState.previewRaster.frontal||resultState.previewRaster.lateral||resultState.previewRaster.supine);
    return true;
  }
  // The working image for a raster: the auto-windowed or original exposure, at
  // view resolution when the source has more detail than the analysis canvas.
  function previewSource(raster){
    const enhanced = resultState.showEnhanced !== false;
    if(raster.view) return enhanced ? enhancedView(raster) : raster.view.canvas;
    return (enhanced && raster.display) ? raster.display : raster.canvas;
  }
  function renderGuidePreview(){
    const frontalRaster = resultState.previewRaster.frontal, lateralRaster = resultState.previewRaster.lateral;
    const hasAny = !!(frontalRaster || lateralRaster || resultState.frontal || resultState.lateral);
    if(ui.previewGrid) ui.previewGrid.hidden = !hasAny;
    [['frontal', frontalRaster, ui.frontalFigure, ui.frontalCanvas, ui.frontalConfidence], ['lateral', lateralRaster, ui.lateralFigure, ui.lateralCanvas, ui.lateralConfidence]].forEach(([plane, raster, figure, canvas, badge])=>{
      if(!raster || resultState[plane]) return;
      figure.hidden = false;
      const ctx = paintPlane(canvas, raster, plane);
      if(ctx){ drawGuideDots(ctx, plane); drawManualPoints(ctx, plane); drawEditableHandles(ctx, plane); finishPaint(canvas, plane); }
      badge.textContent = 'preview'; badge.dataset.level='low';
    });
    if(!frontalRaster && !resultState.frontal) ui.frontalFigure.hidden = true;
    if(!lateralRaster && !resultState.lateral) ui.lateralFigure.hidden = true;
  }
  const guidePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x:p.x, y:p.y } : null;
  // Anchor list for the corridor search, which treats each one as a hard
  // constraint (see pinCorridorRows).
  const guideAnchors = guides => guides ? [guides.top, guides.apex, guides.bottom].map(guidePoint).filter(Boolean) : [];
  // Anchors refine the traced path rather than replace it. The corridor search
  // has already been constrained to pass within a few pixels of each anchor;
  // what remains is a residual offset, interpolated between anchors (and
  // tapered to zero at an unanchored end), so the path meets every anchor
  // exactly while keeping the detected curvature everywhere else. Blending
  // with a straight chord or an apex-at-mid-height Bezier used to throw the
  // detected curve away, so a correct anchor could make the result worse.
  function corridorWithGuides(corridor, guides){
    const top = guidePoint(guides?.top), bottom = guidePoint(guides?.bottom), apex = guidePoint(guides?.apex);
    if(!top && !bottom && !apex) return corridor;
    if(top) corridor.top = clampValue(top.y, 0, (bottom ? bottom.y : corridor.bottom) - 20);
    if(bottom) corridor.bottom = clampValue(bottom.y, corridor.top + 20, corridor.analysis ? corridor.analysis.height - 2 : 1e9);
    const detectedXAt = corridor.xAt.bind(corridor);
    const pins = [top, apex, bottom].filter(Boolean).map(p => ({ y:p.y, dx:p.x - detectedXAt(p.y) }));
    if(!top) pins.push({ y:corridor.top, dx:0 });
    if(!bottom) pins.push({ y:corridor.bottom, dx:0 });
    pins.sort((a, b) => a.y - b.y);
    const offsetAt = y => {
      if(y <= pins[0].y) return pins[0].dx;
      for(let i = 1; i < pins.length; i++){
        if(y <= pins[i].y){
          const span = pins[i].y - pins[i-1].y;
          return span > 1e-6 ? pins[i-1].dx + (pins[i].dx - pins[i-1].dx)*(y - pins[i-1].y)/span : pins[i].dx;
        }
      }
      return pins[pins.length-1].dx;
    };
    corridor.xAt = y => detectedXAt(y) + offsetAt(y);
    corridor.points = [];
    for(let y=corridor.top;y<=corridor.bottom;y+=Math.max(3,Math.round((corridor.bottom-corridor.top)/120))) corridor.points.push({x:corridor.xAt(y),y});
    // Anchors fix where the path passes, not how well the image supports it
    // elsewhere, so the corridor keeps its own evidence-based confidence.
    corridor.guided = true;
    return corridor;
  }
  // Once the user edits the centreline, the detected corridor is replaced by a
  // path interpolated straight through their points, so what they drag is
  // exactly what every later measurement is fitted to.
  function corridorFromCenters(centers, analysis){
    const xAt = y => {
      if(!centers.length) return 0;
      if(y <= centers[0].y) return centers[0].x;
      const last = centers[centers.length-1];
      if(y >= last.y) return last.x;
      for(let i=1;i<centers.length;i++){
        if(y <= centers[i].y){
          const span = centers[i].y - centers[i-1].y;
          const t = span > 1e-6 ? (y - centers[i-1].y)/span : 0;
          return centers[i-1].x + (centers[i].x - centers[i-1].x)*t;
        }
      }
      return last.x;
    };
    return {
      xAt, analysis,
      top: centers[0]?.y ?? 0,
      bottom: centers[centers.length-1]?.y ?? 0,
      points: centers.map(p => ({ x:p.x, y:p.y })),
      confidence: .62,
      userEdited: true
    };
  }

  function moveLineTo(line, cx, cy){
    if(!line) return;
    // Neural lines carry the vertebral-body quad that is drawn under them, so
    // the quad travels with the line rather than being left behind.
    const dx = cx - line.cx, dy = cy - line.cy;
    const half = Math.hypot(line.b.x-line.a.x, line.b.y-line.a.y)/2;
    const rad = radians(line.angle), cos = Math.cos(rad), sin = Math.sin(rad);
    line.a = { x: cx-half*cos, y: cy-half*sin };
    line.b = { x: cx+half*cos, y: cy+half*sin };
    if(Array.isArray(line.corners) && Number.isFinite(dx) && Number.isFinite(dy)) line.corners.forEach(corner => { corner.x += dx; corner.y += dy; });
    syncLineGeometry(line);
  }

  // Live drag: keep it cheap by sliding the existing lines along with their
  // centres. The full re-fit runs once, on release.
  // Only the dragged centre's line travels (by the same displacement, keeping
  // its shape); snapping every line onto its centre used to shift lines the
  // user had shaped by hand.
  function followCenters(result, index, dx, dy){
    if(!result) return;
    result.corridor = corridorFromCenters(result.centers, result.analysis);
    const line = Number.isInteger(index) ? result.lines[index] : null;
    if(line) moveLineTo(line, line.cx + dx, line.cy + dy);
    else if(!Number.isInteger(index)) result.centers.forEach((point, i) => moveLineTo(result.lines[i], point.x, point.y));
    if(result.plane === 'frontal' && result.primary) recomputeFrontalFromEdits(result);
    if(result.plane === 'lateral') recomputeLateralFromEdits(result);
  }

  function refitFromCenters(result){
    if(!result || !result.centers?.length) return;
    const A = result.analysis;
    const corridor = corridorFromCenters(result.centers, A);
    result.corridor = corridor;
    const count = result.centers.length;
    const spacing = (corridor.bottom - corridor.top)/Math.max(1, count-1);
    if(!(spacing > 0)) return;
    const frontal = result.plane === 'frontal';
    const neural = result.engine === NEURAL_FRONTAL_ENGINE;
    if(neural){
      // Network lines already travelled with their centres during the drag
      // (followCenters); the classical edge search must not overwrite them.
    } else {
      // Clamp relative to the exposed field, matching analyzeFrontal/analyzeLateral.
      const fieldWidth = (A.content ? A.content.x1 - A.content.x0 + 1 : A.width);
      const halfLength = frontal
        ? clampValue(spacing*.55, fieldWidth*.03, fieldWidth*.1)
        : clampValue(spacing*.6, fieldWidth*.03, fieldWidth*.11);
      const fresh = result.centers.map(point => detectEndplateLine(
        A, point.x, point.y, halfLength,
        spacing*(frontal ? .26 : .28), frontal ? 16 : 26,
        corridorExpectedAngle(corridor, point.y, spacing*.6)
      ));
      regularizeLineAngles(fresh);
      gateLineConfidences(fresh);
      // A line the user shaped by its endpoints is theirs: only untouched lines
      // are re-detected along the corrected path. Re-detecting everything used
      // to discard an earlier endpoint edit silently on any centreline nudge.
      const previous = result.lines;
      result.lines = fresh.map((line, index) => previous[index] && previous[index].userEdited ? previous[index] : line);
    }
    if(frontal){
      // Cobb pairs that contain an edited line keep their end vertebrae; the
      // apex, whether dragged or anchored, is the user's too and is kept.
      const editedPair = [result.primary, result.secondary].some(pair => pair && (result.lines[pair.i]?.userEdited || result.lines[pair.j]?.userEdited));
      if(!editedPair){
        if(neural) assignFrontalCobbPairs(result, 2, 0, count-1);
        else assignFrontalCobbPairs(result, 3, 1, count-2);
      }
      if(result.primary) recomputeFrontalFromEdits(result);
    } else {
      recomputeLateralFromEdits(result);
    }
  }

  function centerHandlesFor(result, plane){
    if(!result?.centers?.length) return [];
    return result.centers.map((point, index) => ({
      plane, kind:'center', index, point,
      label:`Spine centreline point ${index+1} of ${result.centers.length}`
    }));
  }

  function buildEditableHandles(){
    const handles = [];
    // Placed manual landmarks come first: they stay draggable after the prompt
    // sequence ends, in focus mode and on the review canvas alike.
    ['frontal','lateral','supine'].forEach(plane=>{
      const points = manual.points[plane] || {};
      (MANUAL_SEQUENCES[plane] || []).forEach((step, index)=>{
        if(points[step.key]) handles.push({ plane, kind:'manual', key:step.key, index, point:points[step.key], label:`Manual landmark ${index+1}: ${step.target}` });
      });
    });
    if(resultState.frontal){
      const r = resultState.frontal;
      handles.push(...centerHandlesFor(r, 'frontal'));
      if(r.primary){
        handles.push({plane:'frontal', kind:'line', line:r.lines[r.primary.i], endpoint:'a', label:'Primary Cobb upper endplate · endpoint A'});
        handles.push({plane:'frontal', kind:'line', line:r.lines[r.primary.i], endpoint:'b', label:'Primary Cobb upper endplate · endpoint B'});
        handles.push({plane:'frontal', kind:'line', line:r.lines[r.primary.j], endpoint:'a', label:'Primary Cobb lower endplate · endpoint A'});
        handles.push({plane:'frontal', kind:'line', line:r.lines[r.primary.j], endpoint:'b', label:'Primary Cobb lower endplate · endpoint B'});
      }
      if(r.secondary){
        handles.push({plane:'frontal', kind:'line', line:r.lines[r.secondary.i], endpoint:'a', label:'Secondary Cobb upper endplate · endpoint A'});
        handles.push({plane:'frontal', kind:'line', line:r.lines[r.secondary.i], endpoint:'b', label:'Secondary Cobb upper endplate · endpoint B'});
        handles.push({plane:'frontal', kind:'line', line:r.lines[r.secondary.j], endpoint:'a', label:'Secondary Cobb lower endplate · endpoint A'});
        handles.push({plane:'frontal', kind:'line', line:r.lines[r.secondary.j], endpoint:'b', label:'Secondary Cobb lower endplate · endpoint B'});
      }
      if(r.manualApex || r.centers[r.apexIndex]) handles.push({plane:'frontal', kind:'point', target:'apex', point:r.manualApex || r.centers[r.apexIndex], label:'Primary curve apex'});
    }
    if(resultState.lateral){
      const r = resultState.lateral;
      handles.push(...centerHandlesFor(r, 'lateral'));
      [['C2', r.lines[r.indexes.c2]], ['C7', r.lines[r.indexes.c7]], ['T4', r.lines[r.indexes.t4]], ['T12', r.lines[r.indexes.t12]], ['L1', r.lines[r.indexes.l1]], ['S1', r.s1]].forEach(([name, line])=>{
        if(line){ handles.push({plane:'lateral', kind:'line', line, endpoint:'a', label:`${name} endplate · endpoint A`}); handles.push({plane:'lateral', kind:'line', line, endpoint:'b', label:`${name} endplate · endpoint B`}); }
      });
      if(r.hip) handles.push({plane:'lateral', kind:'point', target:'hip', point:r.hip, label:'Hip / bicoxofemoral center estimate'});
    }
    resultState.handles = handles;
    return handles;
  }
  function handlePosition(handle){
    if(handle.kind==='line') return handle.line[handle.endpoint];
    return handle.point;
  }
  // Two handles are the same target when they grab the same point; handle
  // objects are rebuilt on every draw, so identity alone cannot tell.
  const sameHandle = (a, b) => Boolean(a && b && a.plane === b.plane && a.kind === b.kind
    && (a.kind === 'line' ? a.line === b.line && a.endpoint === b.endpoint : a.kind === 'center' ? a.index === b.index : a.kind === 'manual' ? a.key === b.key : a.target === b.target));
  function drawEditableHandles(ctx, plane){
    const focused = manualFocused(plane);
    const u = overlayUnit(ctx);
    buildEditableHandles().filter(handle=>handle.plane===plane).forEach(handle=>{
      // Focus mode shows the user's own points only.
      if(focused && handle.kind !== 'manual') return;
      const p = handlePosition(handle); if(!p) return;
      const selected = sameHandle(resultState.selectedHandle, handle), hovered = sameHandle(resultState.hoverHandle, handle);
      // Centreline dots and manual points are already drawn; only a selected or
      // hovered one is ringed.
      if((handle.kind === 'center' || handle.kind === 'manual') && !selected && !hovered) return;
      ctx.lineWidth = 2*u;
      if(handle.kind === 'manual'){
        ctx.strokeStyle = selected ? '#22d3ee' : 'rgba(236,253,245,.9)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 9*u, 0, Math.PI*2); ctx.stroke();
      } else {
        ctx.fillStyle = selected ? '#22d3ee' : '#ffffff';
        ctx.strokeStyle = selected ? '#0f172a' : '#22d3ee';
        ctx.beginPath(); ctx.arc(p.x, p.y, (selected || hovered ? 6 : 4.5)*u, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      }
      // The grab hint appears only on the handle under the pointer or in use,
      // placed below-left so it never covers the Cobb/LL value labels.
      if(hovered || selected){
        ctx.font = `700 ${11*u}px system-ui`;
        const text = handle.kind === 'manual' ? 'drag to adjust' : 'drag';
        drawLabel(ctx, text, p.x - ctx.measureText(text).width - 14*u, p.y + 18*u, '#bae6fd');
      }
    });
  }
  // The 55% "reviewed" floor belongs to a value whose own lines or points the
  // user moved (autoRowAdjusted: its endplate lines, the S1 line or hip, the
  // apex). Every other value keeps the confidence the detector gave it, so a
  // drag elsewhere on the film cannot pre-select a weak value.
  const REVIEWED_CONFIDENCE_FLOOR = .55;
  function reviewedConfidence(result, key, cap = .95){
    const current = Number.isFinite(result.confidences[key]) ? result.confidences[key] : 0;
    return autoRowAdjusted(key, result) ? clampValue(Math.max(current, REVIEWED_CONFIDENCE_FLOOR), .05, cap) : current;
  }
  function recomputeFrontalFromEdits(result){
    if(!result || !result.primary) return;
    [result.lines[result.primary.i], result.lines[result.primary.j], result.secondary ? result.lines[result.secondary.i] : null, result.secondary ? result.lines[result.secondary.j] : null].filter(Boolean).forEach(syncLineGeometry);
    result.values.coronalMagnitude = angleDifference(result.lines[result.primary.i].angle, result.lines[result.primary.j].angle);
    // Keep the pair objects in step with the lines: the on-canvas label reads
    // primary.angle, so without this it keeps showing the originally detected
    // angle after an edit.
    result.primary.angle = result.values.coronalMagnitude;
    // A re-fit can drop the secondary pair or create one where there was none;
    // the value and its confidence must follow, or a stale angle stays listed.
    if(result.secondary){
      result.values.compensatoryCobb = angleDifference(result.lines[result.secondary.i].angle, result.lines[result.secondary.j].angle);
      result.secondary.angle = result.values.compensatoryCobb;
      result.confidences.compensatoryCobb = reviewedConfidence(result, 'compensatoryCobb', .9);
    } else { result.values.compensatoryCobb = null; result.confidences.compensatoryCobb = 0; }
    const apex = result.manualApex || result.centers[result.apexIndex];
    const a = result.centers[result.primary.i], b = result.centers[result.primary.j];
    const f = (apex.y-a.y)/Math.max(1, b.y-a.y), baseline = a.x+(b.x-a.x)*f;
    result.deviation = apex.x-baseline;
    // Apex side and translation share one patient-space mapping with the
    // automatic and manual paths (declared projection; withheld under 10°).
    applyFrontalApex(result, ui.frontalScale.value);
    result.confidences.coronalMagnitude = reviewedConfidence(result, 'coronalMagnitude');
    // A withheld side (under 10°, or the patient side not confirmed) carries
    // no confidence, and neither does a translation that is not reported.
    result.confidences.coronalDirection = result.values.coronalDirection ? reviewedConfidence(result, 'coronalDirection') : 0;
    if(result.values.trunkShift == null) result.confidences.trunkShift = 0;
  }
  function recomputeLateralFromEdits(result){
    if(!result) return;
    [result.lines[result.indexes.c2], result.lines[result.indexes.c7], result.lines[result.indexes.t4], result.lines[result.indexes.t12], result.lines[result.indexes.l1], result.s1].filter(Boolean).forEach(syncLineGeometry);
    // Values come from the same definition the analyzer uses (signed CL/TK/
    // LL/PT/SVA, geometric PI, and the hip confidence floor that stops an
    // unrelated drag from resurrecting PT/PI from a rejected radial point).
    measureLateralResult(result, ui.lateralScale.value);
    ['tk','ll'].forEach(key=>{ result.confidences[key] = reviewedConfidence(result, key); });
    // A withheld value must not carry a confidence that would pre-check its row.
    ['pt','pi','cl','measuredSva'].forEach(key=>{ result.confidences[key] = Number.isFinite(result.values[key]) ? reviewedConfidence(result, key) : 0; });
    // Level names on the automatic lateral stay estimates after an edit, and
    // sign-unknown magnitudes stay below acceptance (see capLateralConfidences).
    capLateralConfidences(result);
  }
  // Handle kinds in grab priority: a tie goes to the more specific target, so
  // the apex dot drawn over a centreline dot is the one that moves.
  const HANDLE_PRIORITY = { manual:0, point:1, line:2, center:3 };
  function pickNearestHandle(plane, point, canvas, kinds){
    const handles = buildEditableHandles().filter(handle=>handle.plane===plane && (!kinds || kinds.includes(handle.kind)));
    // An 18 CSS-pixel touch radius in analysis units, measured through the
    // painted content box so letterboxing and zoom are both accounted for.
    const perCss = canvas ? 1 / displayScale(canvas) : 1;
    const radius = canvas ? 18 * perCss : 14;
    let best = null;
    handles.forEach(handle=>{
      const p = handlePosition(handle); if(!p) return;
      const d = Math.hypot(point.x-p.x, point.y-p.y);
      if(d > radius) return;
      // Within a CSS pixel, priority decides; otherwise the nearer handle wins.
      const rank = HANDLE_PRIORITY[handle.kind] ?? 4;
      if(!best || d < best.distance - perCss || (d <= best.distance + perCss && rank < best.rank)) best = { handle, distance:d, rank };
    });
    return best?.handle || null;
  }
  // Moves one editable handle to an analysis-frame point and recomputes what
  // depends on it. Shared by pointer drags and keyboard nudges.
  function moveHandle(plane, handle, point){
    if(handle.kind === 'manual'){ setManualPoint(plane, handle.key, point); handle.point = manual.points[plane][handle.key]; return; }
    const result = planeResult(plane);
    if(!result) return;
    if(handle.kind === 'line') {
      handle.line[handle.endpoint].x = point.x; handle.line[handle.endpoint].y = point.y;
      // Marks the line as the user's, so a later centreline re-fit keeps it.
      handle.line.userEdited = true;
    }
    else if(handle.kind === 'center') {
      const center = result.centers?.[handle.index];
      if(center){
        // Keep the centreline single-valued in y so the corridor stays a
        // function; x is free, which is what corrects a mistraced curve.
        const previous = result.centers[handle.index-1];
        const next = result.centers[handle.index+1];
        const x = point.x, y = clampValue(point.y, previous ? previous.y+2 : 0, next ? next.y-2 : result.analysis.height);
        const dx = x - center.x, dy = y - center.y;
        center.x = x; center.y = y;
        handle.point = center;
        followCenters(result, handle.index, dx, dy);
      }
    }
    else if(handle.target === 'apex') { result.manualApex = { x: point.x, y: point.y }; handle.point = result.manualApex; }
    // Placing the hip by hand is as good as a guide anchor, so it clears the
    // confidence gate that PT/PI are held behind.
    else if(handle.target === 'hip' && result.hip) { result.hip.x = point.x; result.hip.y = point.y; result.hip.confidence = Math.max(result.hip.confidence || 0, .62); }
    if(handle.kind !== 'center'){
      if(plane === 'frontal') recomputeFrontalFromEdits(result);
      if(plane === 'lateral') recomputeLateralFromEdits(result);
    }
  }
  function attachEditor(canvas, plane){
    if(!canvas) return;
    setupEditorChrome();
    const figure = planeFigure(plane);
    const view = viewState[plane];
    const pointers = new Map();
    const setGesture = value => { editorGestures[plane] = value; return value; };
    const gesture = () => editorGestures[plane];
    const moved = (event, start) => Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > 4;
    const touchLike = event => event.pointerType === 'touch' || event.pointerType === 'pen';
    const panGesture = (event, start) => setGesture({ type:'pan', pointerId:event.pointerId, start, panX:view.panX, panY:view.panY });
    function endDrag(){
      resultState.drag = null;
      if(figure) figure.dataset.editing = 'false';
    }
    // A second finger cancels whatever the first began: an unfinished drag is
    // reverted and a pending point is dropped, then the pair pinches and pans.
    function cancelGesture(){
      const current = gesture();
      if(current && current.type === 'drag'){ if(current.moved && current.before) restoreSnapshot(current.before); endDrag(); renderAll(); }
      setGesture(null); hideLoupe();
    }
    function startPinch(){
      const [a, b] = Array.from(pointers.values());
      const rect = canvas.getBoundingClientRect(), applied = view.applied || { panX:0, panY:0, zoom:1 };
      setGesture({ type:'pinch', distance: Math.max(1, Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY)),
        mid: { x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2 }, zoom:applied.zoom, panX:applied.panX, panY:applied.panY,
        left: rect.left - applied.panX, top: rect.top - applied.panY });
    }
    function updatePinch(){
      const [a, b] = Array.from(pointers.values()), g = gesture();
      if(!a || !b || !g) return;
      const zoom = clampValue(g.zoom * Math.max(1, Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY)) / g.distance, 1, MAX_VIEW_ZOOM);
      const ux = (g.mid.x - g.left - g.panX)/g.zoom, uy = (g.mid.y - g.top - g.panY)/g.zoom;
      const mx = (a.clientX+b.clientX)/2, my = (a.clientY+b.clientY)/2;
      view.zoom = zoom; view.panX = mx - g.left - zoom*ux; view.panY = my - g.top - zoom*uy;
      applyViewTransform(plane);
    }
    function onPointerDown(event){
      pointers.set(event.pointerId, { clientX:event.clientX, clientY:event.clientY });
      if(!planeRaster(plane)) return;
      try { if(canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId); } catch(error){ /* capture is an optimisation */ }
      if(typeof canvas.focus === 'function') canvas.focus({ preventScroll:true });
      if(pointers.size === 2 && touchLike(event)){ cancelGesture(); startPinch(); event.preventDefault(); return; }
      if(pointers.size > 1) return;
      const start = { clientX:event.clientX, clientY:event.clientY };
      const point = pickCanvasPoint(event, canvas);
      // Middle or Shift+drag pans; right-drag (or the W/L tool) sets window/level.
      if(event.button === 1 || (event.button === 0 && event.shiftKey && view.zoom > 1)){ panGesture(event, start); event.preventDefault(); return; }
      if(event.button === 2 || (view.adjust && event.button === 0)){
        setGesture({ type:'wl', pointerId:event.pointerId, start, window:view.window, level:view.level }); event.preventDefault(); return;
      }
      if(event.button !== 0) return;
      // Manual calibration owns every tap on the plane being calibrated, and
      // guides and automatic handles are never touched in focus mode. With a
      // landmark outstanding the press starts that point, which follows the
      // pointer and is committed on release (the finger no longer hides the
      // target: the loupe shows it); once every step is answered a press on
      // a placed point drags it.
      if(manual.active && manual.plane === plane){
        if(pendingManualStep()) setGesture({ type:'place', pointerId:event.pointerId, start, point });
        else {
          const handle = pickNearestHandle(plane, point, canvas, ['manual']);
          resultState.selectedHandle = handle;
          if(handle) setGesture({ type:'drag', pointerId:event.pointerId, start, handle, before: editSnapshot(plane, 'manual'), moved:false });
        }
        showLoupe(plane, event);
        redrawPlane(plane);
        event.preventDefault();
        return;
      }
      if(resultState.activeGuide){
        const [gPlane, gKey] = resultState.activeGuide.split('.');
        if(gPlane !== plane) return;
        if(point.inside) setGuidePoint(gPlane, gKey, point);
        event.preventDefault();
        return;
      }
      const handle = pickNearestHandle(plane, point, canvas);
      if(handle){
        resultState.selectedHandle = handle;
        if(handle.kind !== 'manual') resultState.drag = { plane, handle };
        setGesture({ type:'drag', pointerId:event.pointerId, start, handle, before: editSnapshot(plane, handle.kind === 'manual' ? 'manual' : 'auto'), moved:false });
        if(figure) figure.dataset.editing = 'true';
        setEditorDescription('Editing landmark', `${handle.label}. Drag to refine the overlay; measurements update immediately.`);
        renderAll();
        showLoupe(plane, event);
        event.preventDefault();
        return;
      }
      // Empty image: a zoomed view pans; otherwise the press clears a selection.
      if(view.zoom > 1){ panGesture(event, start); event.preventDefault(); return; }
      if(resultState.selectedHandle){ resultState.selectedHandle = null; redrawPlane(plane); }
    }
    function hover(event){
      const point = pickCanvasPoint(event, canvas);
      const focus = manual.active && manual.plane === plane;
      const handle = focus ? (pendingManualStep() ? null : pickNearestHandle(plane, point, canvas, ['manual']))
        : resultState.activeGuide ? null : pickNearestHandle(plane, point, canvas);
      if(!sameHandle(handle, resultState.hoverHandle)){
        resultState.hoverHandle = handle;
        canvas.style.cursor = handle ? 'grab' : '';
        redrawPlane(plane);
      }
      if(focus && point.inside) showLoupe(plane, event); else hideLoupe();
    }
    function onPointerMove(event){
      if(pointers.has(event.pointerId)) pointers.set(event.pointerId, { clientX:event.clientX, clientY:event.clientY });
      const current = gesture();
      if(current && current.type === 'pinch'){ if(pointers.size >= 2) updatePinch(); event.preventDefault(); return; }
      if(!current || current.pointerId !== event.pointerId){
        if(event.pointerType === 'mouse' && !event.buttons) hover(event);
        return;
      }
      current.moved = current.moved || moved(event, current.start);
      if(current.type === 'pan'){
        view.panX = current.panX + event.clientX - current.start.clientX; view.panY = current.panY + event.clientY - current.start.clientY;
        applyViewTransform(plane); event.preventDefault(); return;
      }
      if(current.type === 'wl'){
        // Left-right widens the window, up-down moves the level (PACS habit).
        view.window = clampValue(current.window + (event.clientX - current.start.clientX)*2, 8, 510);
        view.level = clampValue(current.level + (event.clientY - current.start.clientY)*1.5, -128, 383);
        scheduleRedraw(plane); updateViewTools(plane); event.preventDefault(); return;
      }
      const point = pickCanvasPoint(event, canvas);
      if(current.type === 'place'){ current.point = point; redrawPlane(plane); showLoupe(plane, event); event.preventDefault(); return; }
      if(current.type === 'drag'){
        if(!current.moved) return;
        if(current.handle.kind !== 'manual' && (!resultState.drag || resultState.drag.plane !== plane)) return;
        moveHandle(plane, current.handle, point);
        if(current.handle.kind === 'manual') renderAfterManualChange(); else renderAll();
        showLoupe(plane, event);
        event.preventDefault();
      }
    }
    function onPointerUp(event){
      if(event && pointers.has(event.pointerId)) pointers.delete(event.pointerId);
      const current = gesture();
      if(!current) return;
      if(current.type === 'pinch'){ if(pointers.size === 0) setGesture(null); return; }
      if(event && current.pointerId !== event.pointerId) return;
      setGesture(null);
      hideLoupe();
      const cancelled = event && event.type === 'pointercancel';
      if(current.type === 'place'){
        const point = event && !cancelled ? pickCanvasPoint(event, canvas) : null;
        // Released over the letterbox bars, or cancelled: nothing is placed.
        if(point && point.inside && manual.active && manual.plane === plane){ recordManualPoint(plane, point); viewState[plane].cursor = { x:point.x, y:point.y }; }
        else redrawPlane(plane);
        return;
      }
      if(current.type !== 'drag') return;
      const handle = current.handle;
      if(handle.kind !== 'manual') endDrag();
      if(cancelled && current.moved && current.before){ restoreSnapshot(current.before); renderAll(); return; }
      if(current.moved) commitEdit(current.before);
      // Releasing a centreline point re-fits the endplate search along the
      // corrected path, which is the whole point of dragging it.
      if(handle.kind === 'center' && current.moved){
        const result = planeResult(plane);
        if(result) refitFromCenters(result);
        renderAll();
        setEditorDescription('Centreline updated', 'Endplate lines were re-fitted along your corrected centreline; lines you shaped by hand were kept. Undo reverts the change.');
        return;
      }
      if(handle.kind === 'manual') renderAfterManualChange(); else renderAll();
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', event => {
      if(event.pointerType === 'mouse' && !gesture()){
        hideLoupe();
        if(resultState.hoverHandle && resultState.hoverHandle.plane === plane){ resultState.hoverHandle = null; canvas.style.cursor = ''; redrawPlane(plane); }
      }
    });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    // Wheel zooms around the pointer: always in focus mode, with Ctrl/Cmd (or
    // a trackpad pinch) on the review canvas so page scrolling still works.
    canvas.addEventListener('wheel', event => {
      if(!planeRaster(plane) || !(manualFocused(plane) || event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      zoomAt(plane, Math.exp(-clampValue(event.deltaY, -120, 120) * .0025), event.clientX, event.clientY);
    }, { passive:false });
    canvas.addEventListener('keydown', event => handleEditorKey(plane, event));
    canvas.style.touchAction = 'none';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-describedby', 'rgEditorKeys');
    setupViewTools(plane);
  }

  /* ---------------------------------------------------------------------
     Review canvas: display resolution, view transform (zoom/pan), window and
     level, loupe, keyboard operation and the landmark edit history.

     Every overlay is drawn in the analysis frame (the coordinates the
     measurements use); the canvas itself holds the bounded full-resolution
     view, so the drawing context is scaled once per paint. Overlay sizes are
     given in CSS pixels through overlayUnit(), so lines and labels keep one
     readable on-screen size at any zoom. Display adjustments never touch the
     pixels any measurement or detector reads.
  --------------------------------------------------------------------- */
  const EDIT_PLANES = ['frontal','lateral','supine'];
  const MAX_VIEW_ZOOM = 8;
  const canvasFrames = new WeakMap();
  const editorGestures = { frontal:null, lateral:null, supine:null };
  function newViewState(){ return { zoom:1, panX:0, panY:0, applied:null, invert:false, window:255, level:127.5, adjust:false, loupe:true, token:null, tokenKey:'', cursor:null }; }
  const viewState = { frontal:newViewState(), lateral:newViewState(), supine:newViewState() };
  const planeCanvas = plane => plane === 'frontal' ? ui.frontalCanvas : plane === 'lateral' ? ui.lateralCanvas : ui.supineCanvas;
  const planeFigure = plane => plane === 'frontal' ? ui.frontalFigure : plane === 'lateral' ? ui.lateralFigure : ui.supineFigure;
  const planeResult = plane => plane === 'frontal' || plane === 'lateral' ? resultState[plane] : null;
  const planeRaster = plane => planeResult(plane)?.analysis || resultState.previewRaster[plane] || null;
  const planeLabel = plane => plane === 'frontal' ? 'Frontal' : plane === 'lateral' ? 'Lateral' : 'Supine';

  // CSS pixels per analysis unit as painted now (letterbox and zoom included).
  // A canvas that is not laid out is assumed to be at the review size.
  function displayScale(canvas){
    const frame = canvas ? canvasFrames.get(canvas) : null;
    const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const s = rect && rect.width > 0 && rect.height > 0 ? Math.min(rect.width / Math.max(1, canvas.width), rect.height / Math.max(1, canvas.height)) : 0;
    if(s > 0 && Number.isFinite(s)) return s * (frame ? frame.kx : 1);
    return frame ? Math.min(1, 560 / Math.max(1, frame.raster.height)) : 1;
  }
  // Analysis units per CSS pixel for the canvas a context draws into.
  function overlayUnit(ctx){
    const frame = ctx && ctx.canvas ? canvasFrames.get(ctx.canvas) : null;
    return frame ? frame.unit : Math.max(1, ((ctx && ctx.canvas && ctx.canvas.width) || 480) / 480);
  }

  // Window/level and invert are applied through a lookup table to a copy of
  // the displayed image only; the analysis data never changes.
  const adjustCache = new WeakMap();
  function adjustedImage(src, view){
    if(!src || (!view.invert && view.window >= 255 && Math.abs(view.level - 127.5) < .5)) return src;
    const key = `${view.invert ? 1 : 0}|${view.window.toFixed(1)}|${view.level.toFixed(1)}`;
    let entry = adjustCache.get(src);
    if(entry && entry.key === key) return entry.canvas;
    if(!entry){
      const w = src.width, h = src.height, sourceContext = src.getContext && src.getContext('2d');
      if(!sourceContext) return src;
      const data = sourceContext.getImageData(0, 0, w, h).data, gray = new Uint8Array(w*h);
      for(let i=0, p=0; i<gray.length; i++, p+=4) gray[i] = Math.round(.2126*data[p] + .7152*data[p+1] + .0722*data[p+2]);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const context = canvas.getContext('2d');
      if(!context) return src;
      entry = { gray, canvas, context, image: context.createImageData(w, h), key:null };
      adjustCache.set(src, entry);
    }
    const lut = new Uint8ClampedArray(256), low = view.level - view.window/2;
    for(let v=0; v<256; v++){ const out = (v - low) / view.window * 255; lut[v] = view.invert ? 255 - out : out; }
    const out = entry.image.data;
    for(let i=0, p=0; i<entry.gray.length; i++, p+=4){ const o = lut[entry.gray[i]]; out[p] = out[p+1] = out[p+2] = o; out[p+3] = 255; }
    entry.context.putImageData(entry.image, 0, 0);
    entry.key = key;
    return entry.canvas;
  }

  // Paints a plane's working image and returns a context in analysis units.
  function paintPlane(canvas, raster, plane){
    if(!canvas || !raster) return null;
    const view = viewState[plane];
    const token = raster.fileToken || raster, tokenKey = rasterOptionsKey(raster.rasterOptions || {});
    // A different film starts from a fitted, unadjusted view; the same film
    // re-oriented keeps its window/level and invert but is fitted again.
    if(view.token !== token || view.tokenKey !== tokenKey){
      if(view.token !== token) Object.assign(view, { invert:false, window:255, level:127.5 });
      Object.assign(view, { zoom:1, panX:0, panY:0, cursor:null, token, tokenKey });
      applyViewTransform(plane, false);
    }
    const src = adjustedImage(previewSource(raster), view);
    if(!src) return null;
    if(canvas.width !== src.width) canvas.width = src.width;
    if(canvas.height !== src.height) canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    if(!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0);
    const frame = { plane, raster, kx: canvas.width / raster.width, ky: canvas.height / raster.height, unit: 1 };
    canvasFrames.set(canvas, frame);
    frame.unit = 1 / displayScale(canvas);
    ctx.setTransform(frame.kx, 0, 0, frame.ky, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    return ctx;
  }
  // Last layer of every paint: the point being placed, the keyboard crosshair
  // and the loupe, which copies from the finished canvas.
  function finishPaint(canvas, plane){
    const frame = canvas ? canvasFrames.get(canvas) : null, ctx = frame ? canvas.getContext('2d') : null;
    if(!ctx) return;
    const u = frame.unit, gesture = editorGestures[plane], view = viewState[plane];
    const cross = (p, color, dashed) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5*u; if(dashed) ctx.setLineDash([3*u, 3*u]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 8*u, 0, Math.PI*2);
      ctx.moveTo(p.x - 14*u, p.y); ctx.lineTo(p.x - 4*u, p.y); ctx.moveTo(p.x + 4*u, p.y); ctx.lineTo(p.x + 14*u, p.y);
      ctx.moveTo(p.x, p.y - 14*u); ctx.lineTo(p.x, p.y - 4*u); ctx.moveTo(p.x, p.y + 4*u); ctx.lineTo(p.x, p.y + 14*u);
      ctx.stroke(); ctx.restore();
    };
    if(gesture && gesture.type === 'place' && gesture.point && gesture.point.inside) cross(gesture.point, '#fde047', false);
    if(view.cursor && manualFocused(plane) && pendingManualStep() && !(gesture && gesture.type === 'place')) cross(view.cursor, '#fde047', true);
    if(loupe && !loupe.hidden && loupe.plane === plane) drawLoupe();
    updateViewTools(plane);
  }
  function redrawPlane(plane){
    if(plane === 'supine') return renderSupinePreview();
    const result = planeResult(plane), canvas = planeCanvas(plane);
    if(result && canvas) (plane === 'frontal' ? drawFrontal : drawLateral)(result, canvas);
    else renderGuidePreview();
  }
  const redrawQueue = new Set();
  function scheduleRedraw(plane){
    if(redrawQueue.has(plane)) return;
    redrawQueue.add(plane);
    requestAnimationFrame(() => { redrawQueue.delete(plane); redrawPlane(plane); });
  }
  // Measurements, readouts and every canvas after an edit. The editor copy is
  // restated afterwards because renderResults() resets it to the generic text.
  function renderAll(){
    renderResults();
    syncEditorCopy();
    updateHistoryUi();
    EDIT_PLANES.forEach(updateViewTools);
  }
  function renderAfterManualChange(){
    renderManualPrompt();
    renderManualReadout();
    renderSupinePreview();
    renderFlexibility();
    renderAll();
  }
  function syncEditorCopy(){
    const drag = resultState.drag;
    if(drag && drag.handle){ setEditorDescription('Editing landmark', `${drag.handle.label}. Drag to refine the overlay; measurements update immediately.`); return; }
    if(resultState.frontal || resultState.lateral) return;
    const placed = EDIT_PLANES.reduce((count, plane) => count + Object.keys(manual.points[plane] || {}).length, 0);
    if(placed) setEditorDescription('Manual landmarks', 'Drag any placed point on the image to adjust it, or use the arrow keys after selecting it with Tab; the values update immediately. Undo (Ctrl+Z) reverts the last change.');
  }

  // Zoom and pan are a CSS transform on the canvas (origin top-left). The
  // pointer map reads the transformed box, so no coordinate code changes.
  function applyViewTransform(plane, redraw = true){
    const canvas = planeCanvas(plane), view = viewState[plane];
    if(!canvas || !canvas.style) return;
    const w = canvas.offsetWidth || 0, h = canvas.offsetHeight || 0;
    view.zoom = clampValue(view.zoom, 1, MAX_VIEW_ZOOM);
    if(view.zoom <= 1.001){ view.zoom = 1; view.panX = 0; view.panY = 0; }
    else { view.panX = clampValue(view.panX, w*(1-view.zoom), 0); view.panY = clampValue(view.panY, h*(1-view.zoom), 0); }
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = view.zoom === 1 ? '' : `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
    view.applied = { panX:view.panX, panY:view.panY, zoom:view.zoom };
    const figure = planeFigure(plane);
    if(figure && figure.dataset) figure.dataset.zoomed = String(view.zoom > 1);
    if(redraw){ scheduleRedraw(plane); updateViewTools(plane); }
  }
  function zoomAt(plane, factor, clientX, clientY){
    const canvas = planeCanvas(plane), view = viewState[plane];
    if(!canvas || !planeRaster(plane)) return;
    const rect = canvas.getBoundingClientRect(), applied = view.applied || { panX:0, panY:0, zoom:1 };
    const left = rect.left - applied.panX, top = rect.top - applied.panY;
    if(!Number.isFinite(clientX) || !Number.isFinite(clientY)){
      // Keyboard and buttons zoom about the middle of what is visible.
      const box = (planeFigure(plane) || canvas).getBoundingClientRect();
      clientX = clampValue((box.left + box.right)/2, rect.left, rect.right); clientY = clampValue((box.top + box.bottom)/2, rect.top, rect.bottom);
    }
    const next = clampValue(applied.zoom * factor, 1, MAX_VIEW_ZOOM);
    const ux = (clientX - left - applied.panX)/applied.zoom, uy = (clientY - top - applied.panY)/applied.zoom;
    view.zoom = next; view.panX = clientX - left - next*ux; view.panY = clientY - top - next*uy;
    applyViewTransform(plane);
  }
  function fitView(plane){ Object.assign(viewState[plane], { zoom:1, panX:0, panY:0 }); applyViewTransform(plane); }

  /* Loupe: a 3x magnified inset of the painted canvas around the pointer,
     offset above a finger (which would hide the target) or beside a mouse. */
  let loupe = null;
  function showLoupe(plane, event){
    const view = viewState[plane], figure = planeFigure(plane);
    if(!view.loupe || !figure || !event){ hideLoupe(); return; }
    if(!loupe){
      loupe = document.createElement('canvas');
      loupe.className = 'rg-loupe';
      loupe.setAttribute('aria-hidden', 'true');
    }
    if(loupe.parentNode !== figure && typeof figure.appendChild === 'function') figure.appendChild(loupe);
    const dpr = Math.min(2, window.devicePixelRatio || 1), size = Math.round(148*dpr);
    if(loupe.width !== size){ loupe.width = size; loupe.height = size; }
    loupe.hidden = false;
    loupe.plane = plane;
    loupe.client = { x:event.clientX, y:event.clientY, touch: event.pointerType === 'touch' || event.pointerType === 'pen' };
    drawLoupe();
  }
  function hideLoupe(){ if(loupe) loupe.hidden = true; }
  function drawLoupe(){
    const canvas = loupe ? planeCanvas(loupe.plane) : null;
    const ctx = canvas ? loupe.getContext('2d') : null;
    if(!ctx) return;
    const rect = canvas.getBoundingClientRect(), cw = Math.max(1, canvas.width), ch = Math.max(1, canvas.height);
    const s = Math.min(rect.width/cw, rect.height/ch) || 1, c = loupe.client, L = loupe.width, css = 148;
    const px = (c.x - rect.left - (rect.width - cw*s)/2)/s, py = (c.y - rect.top - (rect.height - ch*s)/2)/s;
    const span = css / (3*s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, L, L);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    try { ctx.drawImage(canvas, px - span/2, py - span/2, span, span, 0, 0, L, L); } catch(error){ /* outside the image */ }
    ctx.strokeStyle = 'rgba(253,224,71,.95)'; ctx.lineWidth = Math.max(1, L/148);
    ctx.beginPath();
    ctx.moveTo(L/2 - L*.12, L/2); ctx.lineTo(L/2 - L*.03, L/2); ctx.moveTo(L/2 + L*.03, L/2); ctx.lineTo(L/2 + L*.12, L/2);
    ctx.moveTo(L/2, L/2 - L*.12); ctx.lineTo(L/2, L/2 - L*.03); ctx.moveTo(L/2, L/2 + L*.03); ctx.lineTo(L/2, L/2 + L*.12);
    ctx.stroke();
    const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    let left = c.touch ? c.x - css/2 : c.x + 22, top = c.touch ? c.y - css - 60 : c.y + 22;
    if(c.touch && top < 8) top = c.y + 60;
    if(!c.touch && left + css > vw - 8) left = c.x - css - 22;
    if(!c.touch && top + css > vh - 8) top = c.y - css - 22;
    loupe.style.left = `${clampValue(left, 4, Math.max(4, vw - css - 4))}px`;
    loupe.style.top = `${clampValue(top, 4, Math.max(4, vh - css - 4))}px`;
  }

  /* Edit history. Every manual place/move/skip/reset and every overlay drag or
     nudge stores a snapshot of what it changed, so any of them can be undone
     or redone, in any order across planes. In focus mode Undo acts on the
     plane being calibrated only. An entry is dropped once its film or result
     is replaced, so an undo can never write stale landmarks onto a new image. */
  const editHistory = { undo:[], redo:[] };
  let editSeq = 0;
  function cloneData(value, depth = 0){
    if(depth > 8) return value;
    if(Array.isArray(value)) return value.map(item => cloneData(item, depth+1));
    if(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype){
      const out = {};
      Object.keys(value).forEach(key => { out[key] = key === 'analysis' ? value[key] : cloneData(value[key], depth+1); });
      return out;
    }
    return value;
  }
  function captureResultState(result){
    const state = {};
    Object.keys(result).forEach(key => { if(key !== 'analysis') state[key] = cloneData(result[key]); });
    return state;
  }
  function editSnapshot(plane, kind){
    if(kind === 'manualAll') return { kind, plane:'*', all: EDIT_PLANES.map(p => editSnapshot(p, 'manual')), sessionPlane: manual.plane, index: manual.index };
    const raster = planeRaster(plane);
    const base = { kind, plane, token: raster ? raster.fileToken || raster : null, tokenKey: raster ? rasterOptionsKey(raster.rasterOptions || {}) : '' };
    if(kind === 'manual') return { ...base, points: cloneData(manual.points[plane] || {}), index: manual.plane === plane ? manual.index : null };
    const result = planeResult(plane);
    return result ? { ...base, result, state: captureResultState(result) } : null;
  }
  function entryValid(entry){
    if(!entry) return false;
    if(entry.kind === 'manualAll') return entry.all.some(entryValid) && entry.all.some(e => Object.keys(e.points).length);
    const raster = planeRaster(entry.plane);
    if(entry.kind === 'manual' && !raster) return !entry.token;
    if(!raster || (raster.fileToken || raster) !== entry.token || rasterOptionsKey(raster.rasterOptions || {}) !== entry.tokenKey) return false;
    return entry.kind !== 'auto' || planeResult(entry.plane) === entry.result;
  }
  function restoreSnapshot(entry){
    if(entry.kind === 'manualAll'){
      entry.all.forEach(item => { if(entryValid(item)) manual.points[item.plane] = cloneData(item.points); });
      if(manual.plane && manual.plane === entry.sessionPlane) manual.index = entry.index;
      return;
    }
    if(entry.kind === 'manual'){
      manual.points[entry.plane] = cloneData(entry.points);
      if(manual.plane === entry.plane && entry.index != null) manual.index = entry.index;
      return;
    }
    Object.keys(entry.state).forEach(key => { entry.result[key] = cloneData(entry.state[key]); });
    resultState.selectedHandle = null; resultState.hoverHandle = null;
    if(entry.plane === 'frontal' && entry.result.primary) recomputeFrontalFromEdits(entry.result);
    if(entry.plane === 'lateral') recomputeLateralFromEdits(entry.result);
  }
  function commitEdit(before){
    if(!before) return;
    editHistory.undo.push({ ...before, seq: ++editSeq });
    if(editHistory.undo.length > 150) editHistory.undo.shift();
    editHistory.redo.length = 0;
    updateHistoryUi();
  }
  function takeEntry(stack, plane, remove = true){
    for(let i = stack.length - 1; i >= 0; i--){
      const entry = stack[i];
      if(!entryValid(entry)){ stack.splice(i, 1); continue; }
      if(!plane || entry.plane === plane || entry.plane === '*'){ if(remove) stack.splice(i, 1); return entry; }
    }
    return null;
  }
  function stepHistory(from, to, plane){
    const entry = takeEntry(from, plane);
    if(!entry) return false;
    const counterpart = entry.kind === 'manualAll' ? editSnapshot(null, 'manualAll') : editSnapshot(entry.plane, entry.kind);
    if(counterpart) to.push({ ...counterpart, seq: entry.seq });
    restoreSnapshot(entry);
    resultState.selectedHandle = null;
    renderAfterManualChange();
    return true;
  }
  const historyPlane = plane => plane || (manual.active ? manual.plane : null);
  function undoEdit(plane){ return stepHistory(editHistory.undo, editHistory.redo, historyPlane(plane)); }
  function redoEdit(plane){ return stepHistory(editHistory.redo, editHistory.undo, historyPlane(plane)); }
  const canUndo = plane => Boolean(takeEntry(editHistory.undo, historyPlane(plane), false));
  const canRedo = plane => Boolean(takeEntry(editHistory.redo, historyPlane(plane), false));
  function updateHistoryUi(){
    const undo = !canUndo(), redo = !canRedo();
    [ui.manualUndo, byId('manualFocusUndo')].forEach(button => { if(button) button.disabled = undo; });
    [byId('manualRedo'), byId('manualFocusRedo')].forEach(button => { if(button) button.disabled = redo; });
  }
  // The detected state of each automatic result, for "Reset overlay".
  const detectedStates = new WeakMap();
  function rememberDetected(result){ if(result && !detectedStates.has(result)) detectedStates.set(result, captureResultState(result)); }
  function resetOverlay(plane){
    const result = planeResult(plane), detected = result && detectedStates.get(result);
    if(!detected) return false;
    commitEdit(editSnapshot(plane, 'auto'));
    restoreSnapshot({ kind:'auto', plane, result, state: detected });
    renderAll();
    setEditorDescription('Overlay reset', `${planeLabel(plane)} lines and points were restored to the automatic detection. Undo brings your edits back.`);
    return true;
  }

  /* Keyboard operation (the canvas is focusable, role=application). */
  let nudgeBurst = null;
  function announceEditor(text){ const live = byId('rgEditorLive'); if(live) live.textContent = text; }
  function handleEditorKey(plane, event){
    const raster = planeRaster(plane);
    if(!raster) return;
    const key = String(event.key || ''), mod = event.ctrlKey || event.metaKey, focus = manualFocused(plane), view = viewState[plane];
    const done = () => { event.preventDefault(); event.stopPropagation(); };
    if(mod && (key === 'z' || key === 'Z')){ if(event.shiftKey) redoEdit(focus ? plane : null); else undoEdit(focus ? plane : null); return done(); }
    if(mod && (key === 'y' || key === 'Y')){ redoEdit(focus ? plane : null); return done(); }
    if(mod) return;
    if(key === '+' || key === '='){ zoomAt(plane, 1.25); return done(); }
    if(key === '-' || key === '_'){ zoomAt(plane, 1/1.25); return done(); }
    if(key === '0'){ fitView(plane); return done(); }
    const selected = resultState.selectedHandle && resultState.selectedHandle.plane === plane ? resultState.selectedHandle : null;
    const pending = focus ? pendingManualStep() : null;
    if(key.startsWith('Arrow')){
      // One step is one display pixel of the film; Shift x10, Alt x0.25.
      const frame = canvasFrames.get(planeCanvas(plane));
      const step = (event.shiftKey ? 10 : event.altKey ? .25 : 1) / (frame ? frame.kx : 1);
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      if(pending){
        const c = view.cursor || { x: raster.width/2, y: raster.height/2 };
        view.cursor = { x: clampValue(c.x + dx, 0, raster.width), y: clampValue(c.y + dy, 0, raster.height) };
        redrawPlane(plane);
        announceEditor(`Crosshair x ${Math.round(view.cursor.x)}, y ${Math.round(view.cursor.y)}`);
        return done();
      }
      if(selected){
        const now = Date.now();
        const burst = nudgeBurst && sameHandle(nudgeBurst.handle, selected) && now - nudgeBurst.at < 1500;
        if(!burst) commitEdit(editSnapshot(plane, selected.kind === 'manual' ? 'manual' : 'auto'));
        nudgeBurst = { handle: selected, at: now };
        const p = handlePosition(selected);
        if(p){
          moveHandle(plane, selected, { x: p.x + dx, y: p.y + dy });
          if(selected.kind === 'center'){ const result = planeResult(plane); if(result) refitFromCenters(result); }
          if(selected.kind === 'manual') renderAfterManualChange(); else renderAll();
          const q = handlePosition(selected);
          if(q) announceEditor(`${selected.label}: x ${Math.round(q.x)}, y ${Math.round(q.y)}`);
        }
        return done();
      }
      return;
    }
    if((key === 'Enter' || key === ' ') && focus){
      if(pending){
        const c = view.cursor || { x: raster.width/2, y: raster.height/2 };
        recordManualPoint(plane, c);
        announceEditor(`Placed ${pending.target}.`);
      }
      return done();
    }
    if((key === 's' || key === 'S') && focus && pending){ skipManualPoint(); announceEditor(`Skipped ${pending.target}.`); return done(); }
    if((key === 'Backspace' || key === 'Delete') && focus){ undoEdit(plane); return done(); }
    if(key === 'Tab'){
      const handles = buildEditableHandles().filter(handle => handle.plane === plane && (!focus || handle.kind === 'manual'));
      if(!handles.length || (focus && pending)) return;
      const index = selected ? handles.findIndex(handle => sameHandle(handle, selected)) : -1;
      const next = index + (event.shiftKey ? -1 : 1);
      // Past either end the selection clears and focus moves on as normal.
      if(next < 0 || next >= handles.length || (index < 0 && event.shiftKey)){ if(selected){ resultState.selectedHandle = null; redrawPlane(plane); } return; }
      resultState.selectedHandle = handles[next];
      redrawPlane(plane);
      announceEditor(`${handles[next].label} selected. Arrow keys move it.`);
      return done();
    }
    if(key === 'Escape' && selected && !focus){ resultState.selectedHandle = null; redrawPlane(plane); return done(); }
  }

  /* Rotate, flip and full-frame change the film the analysis reads, so the
     preview is rebuilt, placed landmarks and guide anchors are carried into
     the new frame, and an automatic result for the old frame is withdrawn. */
  async function reorientPlane(plane, change){
    const file = currentImagingFile(plane);
    const before = planeRaster(plane);
    if(!file || !before){ setStatus(`Load the ${plane} image first.`, 'warning'); return false; }
    if(resultState.running){ setStatus('Wait for the running calibration to finish before re-orienting a film.', 'warning'); return false; }
    const previous = rasterOptionsFor(file);
    const next = change === 'rotate' ? { rotate: previous.rotate + 90 }
      : change === 'flip' ? { flip: !previous.flip, rotate: (360 - previous.rotate) % 360 }
      : { fullFrame: !previous.fullFrame };
    const generation = resultState.imagingGeneration;
    setRasterOptions(file, next);
    const after = await loadPreviewRaster(plane, generation);
    if(!imagingWorkIsCurrent(generation, plane, file)) return false;
    if(!after){ setRasterOptions(file, previous); await loadPreviewRaster(plane, generation); setStatus(`The ${plane} image could not be re-oriented.`, 'error'); renderAll(); return false; }
    const carry = point => { const moved = mapRasterPoint(point, before, after); return moved ? { ...point, x: moved.x, y: moved.y } : point; };
    const points = manual.points[plane] || {};
    Object.keys(points).forEach(key => { points[key] = carry(points[key]); });
    const guides = resultState.guides[plane];
    if(guides) Object.keys(guides).forEach(key => { guides[key] = carry(guides[key]); });
    const hadResult = Boolean(planeResult(plane));
    if(hadResult) resultState[plane] = null;
    resultState.selectedHandle = null; resultState.hoverHandle = null; resultState.drag = null;
    viewState[plane].cursor = null;
    renderAfterManualChange();
    const what = change === 'rotate' ? 'rotated 90°' : change === 'flip' ? 'mirrored' : after.rasterOptions.fullFrame ? 'shown full frame (automatic crop off)' : 'cropped to the detected exposed field again';
    setStatus(`${planeLabel(plane)} image ${what}. ${hadResult ? 'Its automatic result belonged to the old frame and was withdrawn; run calibration again to analyse this one.' : 'Calibration will analyse it this way.'}${Object.keys(points).length ? ' Placed landmarks moved with the film.' : ''}`, 'warning');
    return true;
  }

  /* View tools: one toolbar per figure, built here so the markup stays free
     of editor internals. Display-only tools never change a measurement. */
  const VIEW_TOOLS = [
    { id:'zoomOut', text:'−', label:'Zoom out (minus key)' },
    { id:'zoomIn', text:'+', label:'Zoom in (plus key, Ctrl+wheel, pinch)' },
    { id:'fit', text:'Fit', label:'Fit the whole image (0 key)' },
    { id:'loupe', text:'Loupe', label:'Magnifier loupe while placing and dragging points', toggle:true },
    { id:'adjust', text:'W/L', label:'Window/level: drag left-right for window, up-down for level (right-drag always does this). Display only', toggle:true },
    { id:'invert', text:'Invert', label:'Invert the display (display only)', toggle:true },
    { id:'resetView', text:'Reset view', label:'Reset zoom, window/level and invert' },
    { id:'rotate', text:'Rotate 90°', label:'Rotate the film 90° clockwise. Re-analysed in the new orientation; placed landmarks follow', group:'orient' },
    { id:'flip', text:'Flip', label:'Mirror the film left-right. Re-analysed; placed landmarks follow', group:'orient' },
    { id:'fullFrame', text:'Full frame', label:'Use the whole image instead of the automatic exposed-field crop', toggle:true, group:'orient' },
    { id:'resetOverlay', text:'Reset overlay', label:'Restore the automatically detected lines and points (undoable)', group:'auto' }
  ];
  const LEGENDS = {
    frontal: [['#34d399','Primary Cobb endplates'],['#fbbf24','Secondary Cobb'],['#f472b6','Apex'],['#0ea5e9','Centreline (drag)'],['#fde047','Point being placed']],
    lateral: [['#a78bfa','C2 / C7'],['#fbbf24','T4 / T12'],['#34d399','L1 / S1'],['#f472b6','Hip centre'],['#60a5fa','C7 plumb line'],['#0ea5e9','Centreline (drag)']],
    supine: [['#34d399','Manual endplates'],['#f472b6','Femoral heads'],['#fde047','Point being placed']]
  };
  function setupViewTools(plane){
    const figure = planeFigure(plane), canvas = planeCanvas(plane);
    if(!figure || !canvas || typeof document.createElement !== 'function' || figure.querySelector?.('.rg-view-tools')) return;
    try {
      const bar = document.createElement('div');
      bar.className = 'rg-view-tools';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', `${planeLabel(plane)} image view tools`);
      VIEW_TOOLS.forEach(tool => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tool.text;
        button.title = tool.label;
        button.setAttribute('aria-label', tool.label);
        button.dataset.tool = tool.id;
        if(tool.group) button.dataset.group = tool.group;
        if(tool.toggle) button.setAttribute('aria-pressed', 'false');
        // The supine film is never auto-analysed, so it has no overlay to reset.
        if(tool.group === 'auto' && plane === 'supine') button.hidden = true;
        button.addEventListener('click', () => runViewTool(plane, tool.id));
        bar.append(button);
      });
      if(typeof figure.insertBefore === 'function' && canvas.parentNode === figure) figure.insertBefore(bar, canvas); else figure.append(bar);
      const legend = document.createElement('div');
      legend.className = 'rg-legend';
      legend.setAttribute('aria-label', 'Overlay colours');
      (LEGENDS[plane] || []).forEach(([color, text]) => {
        const item = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.background = color;
        swatch.setAttribute('aria-hidden', 'true');
        item.append(swatch, document.createTextNode ? document.createTextNode(text) : text);
        legend.append(item);
      });
      figure.append(legend);
      updateViewTools(plane);
    } catch(error){ console.warn('Radiograph view tools unavailable:', error && error.message); }
  }
  function runViewTool(plane, id){
    const view = viewState[plane];
    if(!planeRaster(plane)) return;
    if(id === 'zoomIn') zoomAt(plane, 1.4);
    else if(id === 'zoomOut') zoomAt(plane, 1/1.4);
    else if(id === 'fit') fitView(plane);
    else if(id === 'loupe'){ view.loupe = !view.loupe; if(!view.loupe) hideLoupe(); }
    else if(id === 'adjust') view.adjust = !view.adjust;
    else if(id === 'invert'){ view.invert = !view.invert; scheduleRedraw(plane); }
    else if(id === 'resetView'){ Object.assign(view, { invert:false, window:255, level:127.5, adjust:false }); fitView(plane); }
    else if(id === 'rotate' || id === 'flip' || id === 'fullFrame') reorientPlane(plane, id);
    else if(id === 'resetOverlay') resetOverlay(plane);
    updateViewTools(plane);
  }
  function updateViewTools(plane){
    const figure = planeFigure(plane), bar = figure && figure.querySelector ? figure.querySelector('.rg-view-tools') : null;
    if(!bar || !bar.querySelectorAll) return;
    const view = viewState[plane], raster = planeRaster(plane), result = planeResult(plane);
    const file = currentImagingFile(plane), options = rasterOptionsFor(file);
    const state = { loupe: view.loupe, adjust: view.adjust, invert: view.invert, fullFrame: options.fullFrame };
    bar.querySelectorAll('button[data-tool]').forEach(button => {
      const id = button.dataset.tool;
      if(id in state) button.setAttribute('aria-pressed', String(Boolean(state[id])));
      button.disabled = !raster
        || (id === 'zoomOut' && view.zoom <= 1) || (id === 'zoomIn' && view.zoom >= MAX_VIEW_ZOOM)
        // (A run in progress is refused by reorientPlane itself: the run's own
        // last paint happens before it clears the running flag.)
        || (button.dataset.group === 'orient' && !file)
        // Disabled rather than hidden, so the toolbar never re-wraps and moves
        // the image under the pointer.
        || (id === 'resetOverlay' && !(result && detectedStates.has(result)));
    });
    const adjusted = view.invert || view.window < 255 || Math.abs(view.level - 127.5) >= .5;
    if(figure.dataset) figure.dataset.adjusted = String(adjusted);
  }

  /* One-time wiring shared by the three canvases. */
  let editorChromeReady = false;
  function setupEditorChrome(){
    if(editorChromeReady) return;
    editorChromeReady = true;
    try {
      // Closing or cancelling the dialog (Esc, Android back, the X) must end
      // focus mode, or the page stays scroll-locked under floating controls.
      const dialog = byId('patientImagingDialog');
      if(dialog && dialog.addEventListener){
        const end = () => { if(manual.active) finishManual(); else applyManualFocus(); hideLoupe(); };
        dialog.addEventListener('close', end);
        dialog.addEventListener('cancel', end);
      }
      byId('manualFocusRedo')?.addEventListener('click', () => redoEdit());
      // A Redo beside the in-panel Undo.
      if(ui.manualUndo && !byId('manualRedo') && typeof document.createElement === 'function'){
        const redo = document.createElement('button');
        redo.type = 'button'; redo.id = 'manualRedo'; redo.className = 'lab-button'; redo.textContent = 'Redo'; redo.disabled = true;
        redo.addEventListener('click', () => redoEdit());
        if(ui.manualUndo.parentNode && typeof ui.manualUndo.parentNode.insertBefore === 'function') ui.manualUndo.parentNode.insertBefore(redo, ui.manualUndo.nextSibling);
      }
      const host = ui.previewGrid && ui.previewGrid.parentNode;
      if(host && typeof host.insertBefore === 'function' && !byId('rgEditorKeys')){
        const keys = document.createElement('p');
        keys.id = 'rgEditorKeys'; keys.className = 'rg-sr-only';
        keys.textContent = 'Image editor. Arrow keys move the crosshair or the selected point (Shift for 10 pixels, Alt for a quarter pixel). Enter places the prompted landmark, S skips it, Tab selects placed points, Ctrl+Z undoes and Ctrl+Y redoes, plus and minus zoom, 0 fits the image.';
        const live = document.createElement('p');
        live.id = 'rgEditorLive'; live.className = 'rg-sr-only';
        live.setAttribute('aria-live', 'polite');
        host.insertBefore(keys, ui.previewGrid);
        host.insertBefore(live, ui.previewGrid);
      }
      window.addEventListener('resize', () => EDIT_PLANES.forEach(plane => { if(planeRaster(plane)){ applyViewTransform(plane, false); scheduleRedraw(plane); } }));
    } catch(error){ console.warn('Radiograph editor chrome unavailable:', error && error.message); }
  }

