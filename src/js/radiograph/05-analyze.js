  // ---- Neural frontal path ------------------------------------------------
  // window.__SPINE_AI__ (a separate script block) returns vertebra
  // quadrilaterals from a corner-landmark network trained on AP whole-spine
  // scoliosis radiographs. Each vertebra becomes one tilt line through the
  // midpoints of its left and right borders - the convention the training
  // labels' Cobb angles were computed with - so the downstream Cobb pairing,
  // overlay, and drag editor work unchanged. Implausible output is rejected
  // with a named reason and the classical corridor search runs instead.
  const NEURAL_FRONTAL_ENGINE='neural_ap_corner_v1';
  const NEURAL_FRONTAL_GATES=Object.freeze({minVertebrae:10,minScore:.2,maxSpacingRatio:2.6,minMeanScore:.3,minInsideFraction:.8});
  function neuralFrontalRejection(vertebrae,A){
    if(!Array.isArray(vertebrae)||vertebrae.length<NEURAL_FRONTAL_GATES.minVertebrae) return `only ${vertebrae?vertebrae.length:0} confident vertebrae (need ${NEURAL_FRONTAL_GATES.minVertebrae})`;
    const ys=vertebrae.map(v=>v.center.y);
    for(let i=1;i<ys.length;i++) if(!(ys[i]>ys[i-1])) return 'vertebra order is not monotonic';
    const gaps=ys.slice(1).map((y,i)=>y-ys[i]);
    const minGap=Math.min(...gaps),maxGap=Math.max(...gaps);
    if(!(minGap>1)||maxGap/minGap>NEURAL_FRONTAL_GATES.maxSpacingRatio) return 'vertebra spacing is implausible';
    const mean=vertebrae.reduce((sum,v)=>sum+v.score,0)/vertebrae.length;
    if(mean<NEURAL_FRONTAL_GATES.minMeanScore) return `mean corner confidence ${mean.toFixed(2)} is below ${NEURAL_FRONTAL_GATES.minMeanScore}`;
    const content=A.content||{x0:0,y0:0,x1:A.width-1,y1:A.height-1};
    const inside=vertebrae.filter(v=>v.center.x>=content.x0&&v.center.x<=content.x1&&v.center.y>=content.y0&&v.center.y<=content.y1).length;
    if(inside<vertebrae.length*NEURAL_FRONTAL_GATES.minInsideFraction) return 'detections fall outside the exposed field';
    return null;
  }

  // ---- Frontal laterality -------------------------------------------------
  // Which image side shows the patient's right follows the declared frontal
  // projection (#frontalProjectionSelect). A PA film is viewed as if from
  // behind the patient (the scoliosis-clinic convention), so the patient's
  // right is on image-right; an AP film in radiological convention is viewed
  // facing the patient, so the patient's right is on image-left.
  const FRONTAL_DISPLAY_CONVENTIONS=Object.freeze({
    pa:Object.freeze({projection:'pa',patientRightOnImage:'right',label:'PA viewed from behind: patient right on image right'}),
    ap:Object.freeze({projection:'ap',patientRightOnImage:'left',label:'AP radiological view: patient right on image left'})
  });
  // Below 10° there is no scoliosis to lateralise (SRS definition), so the
  // apex side and its translation are withheld rather than guessed.
  const MIN_LATERALISED_COBB=10;
  // The patient side is confirmed only by a declaration: the intake's "Patient
  // right is on the image" control (#frontalLateralitySelect) set to left or
  // right, or, without that control, a PA/AP choice the user made or the DICOM
  // header filled (data-user-chosen / data-autofill). The PA default the
  // select starts on is not a declaration.
  function frontalLateralityConfirmed(){
    const laterality=document.getElementById('frontalLateralitySelect');
    if(laterality) return laterality.value==='left'||laterality.value==='right';
    const select=document.getElementById('frontalProjectionSelect'),flags=select&&select.dataset||{};
    return flags.userChosen==='true'||Boolean(flags.autofill);
  }
  // confirmed:false means the mapping is only the assumed PA default: the apex
  // side and the signed translation are then withheld, not guessed.
  function frontalDisplayConvention(){
    const select=document.getElementById('frontalProjectionSelect');
    const convention=FRONTAL_DISPLAY_CONVENTIONS[select&&select.value==='ap'?'ap':'pa'];
    return Object.freeze({...convention,confirmed:frontalLateralityConfirmed()});
  }
  function patientSideOfImageOffset(dx,convention=frontalDisplayConvention()){
    if(!Number.isFinite(dx)||dx===0||convention.confirmed===false) return null;
    const imageSide=dx>0?'right':'left';
    return convention.patientRightOnImage==='right'?imageSide:imageSide==='right'?'left':'right';
  }
  const mmPerAnalysisPixel=(A,scaleMmPerSourcePixel)=>finite(scaleMmPerSourcePixel)&&Number(scaleMmPerSourcePixel)>0&&A?Number(scaleMmPerSourcePixel)/(A.scale||1):null;
  // Apex side and translation in patient space. The translation keeps the
  // worksheet convention (positive toward the patient's right), so it always
  // points the same way as the apex it belongs to. It is the apex offset from
  // the end-vertebra chord, not an SRS CSVL apical vertebral translation.
  // Both are null while the patient side is not confirmed.
  function frontalApexValues(deviationPx,cobb,mmPerPixel,convention=frontalDisplayConvention()){
    const direction=Number.isFinite(cobb)&&cobb>=MIN_LATERALISED_COBB?patientSideOfImageOffset(deviationPx,convention):null;
    const trunkShift=direction&&mmPerPixel?(direction==='right'?1:-1)*Math.abs(deviationPx)*mmPerPixel:null;
    return {direction,trunkShift,convention};
  }
  function applyFrontalApex(result,scaleMmPerSourcePixel){
    const apex=frontalApexValues(result.deviation,result.values.coronalMagnitude,mmPerAnalysisPixel(result.analysis,scaleMmPerSourcePixel));
    result.direction=apex.direction;result.laterality=apex.convention;
    result.values.coronalDirection=apex.direction;result.values.trunkShift=apex.trunkShift;
    return apex;
  }
  // Every frontal row is bounded by the primary Cobb it depends on: a
  // secondary curve, an apex side or a translation must not arrive checked
  // while the primary curve itself is not.
  function frontalConfidences(result,primaryConfidence,secondaryConfidence){
    const primary=result.primary?primaryConfidence:.05;
    result.confidence=primaryConfidence;
    result.confidences={coronalMagnitude:primary,compensatoryCobb:result.secondary?Math.min(primary,secondaryConfidence):0};
    frontalApexConfidences(result);
  }
  function frontalApexConfidences(result){
    const c=result.confidences,primary=c.coronalMagnitude;
    c.coronalDirection=result.values.coronalDirection?Math.min(primary,clampValue(result.corridor.confidence*.8,.05,.85)):0;
    c.trunkShift=result.values.trunkShift!=null?clampValue(primary*.72,.05,.8):0;
  }
  // Declares the mapping on the control itself and re-derives any existing
  // apex side when the projection changes.
  (function bindFrontalLaterality(){
    const select=document.getElementById('frontalProjectionSelect');
    if(!select) return;
    Array.from(select.options).forEach(option=>{
      const convention=FRONTAL_DISPLAY_CONVENTIONS[option.value];
      if(convention) option.textContent=`${convention.projection.toUpperCase()} — patient right on image ${convention.patientRightOnImage}`;
    });
    select.title='Sets which image side is the patient’s right for the apex side and apical translation: PA films are viewed from behind (patient right on image right), AP films in radiological convention (patient right on image left). Check the film’s L/R marker.';
    select.addEventListener('change',()=>{
      const frontal=resultState.frontal;
      if(frontal&&frontal.values&&frontal.primary){
        applyFrontalApex(frontal,ui.frontalScale?ui.frontalScale.value:null);
        frontalApexConfidences(frontal);
      }
      if(ui.results&&ui.previewGrid&&ui.frontalFigure&&ui.lateralFigure){ renderResults(); renderManualReadout(); }
    });
  })();

  function assignFrontalCobbPairs(result,minSeparation,rangeStart,rangeEnd){
    const lines=result.lines,centers=result.centers,count=lines.length;
    let primary=maxCobbPair(lines,minSeparation,rangeStart,rangeEnd);
    let secondary=null;
    if(primary){
      const upper=primary.i>=rangeStart+4?maxCobbPair(lines,minSeparation,rangeStart,primary.i):null;
      const lower=primary.j<=rangeEnd-4?maxCobbPair(lines,minSeparation,primary.j,rangeEnd):null;
      secondary=[upper,lower].filter(Boolean).sort((a,b)=>b.score-a.score)[0]||null;
      // The pair search ranks by a confidence-weighted score, so the second
      // curve can measure larger. The major (primary) curve is always the
      // larger Cobb angle; the apex below is derived from whichever is primary.
      if(secondary&&secondary.angle>primary.angle){ const major=secondary; secondary=primary; primary=major; }
      if(secondary&&secondary.angle<6) secondary=null;
    }
    let apexIndex=primary?Math.round((primary.i+primary.j)/2):Math.round(count/2),deviation=0;
    if(primary){
      const a=centers[primary.i],b=centers[primary.j];
      for(let k=primary.i;k<=primary.j;k++){
        const f=(centers[k].y-a.y)/(b.y-a.y||1),baseline=a.x+(b.x-a.x)*f,d=centers[k].x-baseline;
        if(Math.abs(d)>Math.abs(deviation)){deviation=d;apexIndex=k;}
      }
    }
    result.primary=primary;result.secondary=secondary;result.apexIndex=apexIndex;result.deviation=deviation;
    return result;
  }
  function applyApexGuide(result,guides){
    if(!guides||!guidePoint(guides.apex)) return;
    const centers=result.centers,primary=result.primary;
    result.manualApex={x:guides.apex.x,y:guides.apex.y};
    if(primary){
      const a=centers[primary.i],b=centers[primary.j];
      const f=(result.manualApex.y-a.y)/(b.y-a.y||1),baseline=a.x+(b.x-a.x)*f;
      result.deviation=result.manualApex.x-baseline;
    }
    result.apexIndex=centers.reduce((best,p,i)=>Math.abs(p.y-result.manualApex.y)<Math.abs(centers[best].y-result.manualApex.y)?i:best,result.apexIndex);
  }
  function confidentNeuralVertebrae(detected){
    const confident=(Array.isArray(detected)?detected:[])
      .filter(v=>v&&Number.isFinite(v.score)&&v.score>=NEURAL_FRONTAL_GATES.minScore&&Array.isArray(v.corners)&&v.corners.length===4&&v.center)
      .slice().sort((a,b)=>a.center.y-b.center.y);
    // Two peaks on one vertebral body (heatmap NMS only suppresses a 3x3 cell
    // neighbourhood) would otherwise fake an implausible spacing. Keep the
    // stronger of any pair closer than 45% of the median gap.
    const gaps=confident.slice(1).map((v,i)=>v.center.y-confident[i].center.y).sort((a,b)=>a-b);
    const medianGap=gaps.length?gaps[Math.floor(gaps.length/2)]:0;
    const accepted=[];
    confident.forEach(v=>{
      const last=accepted[accepted.length-1];
      if(last&&medianGap>0&&(v.center.y-last.center.y)<medianGap*.45){
        if(v.score>last.score) accepted[accepted.length-1]=v;
      } else accepted.push(v);
    });
    return accepted;
  }

  // ---- Deskew before neural inference -------------------------------------
  // The corner network was trained on upright AASCE films (Wu et al., BoostNet,
  // MICCAI 2017; Yi et al., vertebra-focused landmark detection, ISBI 2020),
  // so it has seen little in-plane rotation. A digital-phantom study of this
  // build (50 phantoms, fixed seed) found film rotation made it confidently
  // wrong while every plausibility gate still passed: Cobb MAE 5.2 deg upright,
  // 7.8 deg at +8 deg rotation, 11.7 deg at -15 deg. The film tilt is taken
  // from the global spine axis: the chord between the mean of the three most
  // cranial and the three most caudal centres, after a least-squares line
  // drops outlying detections. A chord rather than the regression slope,
  // because an asymmetric single curve biases the regression but not the line
  // joining the ends of the spine, and in a coronally balanced spine the C7
  // plumb line falls on the CSVL (coronal balance as defined in the Spinal
  // Deformity Study Group Radiographic Measurement Manual, O'Brien et al. 2008).
  // minTiltDeg: a 2 cm coronal offset over a ~45 cm C7-S1 span is ~2.5 deg, so
  // 3 deg separates film rotation from ordinary imbalance; it is also inside
  // the 3-5 deg Cobb measurement variability (Morrissy et al., JBJS Am
  // 1990;72:320-7), so smaller tilts are not worth a resample. maxTiltDeg:
  // beyond 25 deg the frame is not a standing AP film shot slightly askew, so
  // the estimate is not trusted and no deskew runs (fail closed).
  const NEURAL_DESKEW=Object.freeze({minCenters:8,minTiltDeg:3,maxTiltDeg:25,endCount:3});
  // points: {x,y} in an isotropic pixel frame, any order. Returns the chord
  // tilt from vertical in degrees (positive = the spine runs toward image-right
  // as it descends), or null when too few points survive the outlier trim.
  function spineAxisTilt(points,minCount=NEURAL_DESKEW.minCenters){
    let pts=(points||[]).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)).slice().sort((a,b)=>a.y-b.y);
    if(pts.length<Math.max(3,minCount)) return null;
    const fit=set=>{
      const n=set.length,my=set.reduce((s,p)=>s+p.y,0)/n,mx=set.reduce((s,p)=>s+p.x,0)/n;
      let syy=0,sxy=0;set.forEach(p=>{syy+=(p.y-my)*(p.y-my);sxy+=(p.y-my)*(p.x-mx);});
      const b=syy>0?sxy/syy:0;
      return {b,res:set.map(p=>p.x-(mx+b*(p.y-my)))};
    };
    const first=fit(pts);
    const absRes=first.res.map(Math.abs),mad=absRes.slice().sort((a,b)=>a-b)[Math.floor(absRes.length/2)];
    const span=pts[pts.length-1].y-pts[0].y;
    // A scoliotic curve is not an outlier: the trim only drops points far off
    // both the line and the curve band (e.g. a detection on a rib or the iliac
    // crest), never more than a quarter of them.
    const limit=Math.max(3*mad*1.4826,.08*span);
    const kept=pts.filter((p,i)=>absRes[i]<=limit);
    if(kept.length>=Math.max(minCount,Math.ceil(pts.length*.75))) pts=kept;
    if(pts.length<Math.max(3,minCount)||!(span>0)) return null;
    const k=Math.min(NEURAL_DESKEW.endCount,Math.floor(pts.length/3));
    const mean=set=>({x:set.reduce((s,p)=>s+p.x,0)/set.length,y:set.reduce((s,p)=>s+p.y,0)/set.length});
    const top=mean(pts.slice(0,k)),bottom=mean(pts.slice(-k));
    if(!(bottom.y-top.y>0)) return null;
    return {tiltDeg:Math.atan2(bottom.x-top.x,bottom.y-top.y)*180/Math.PI,regressionTiltDeg:Math.atan(fit(pts).b)*180/Math.PI,count:pts.length};
  }
  // The film's spine axis for deskewing the neural input: first-pass network
  // centres when enough are confident, else the classical corridor. Computed in
  // the isotropic model-source frame (the analysis canvas may carry a rounding
  // anisotropy between axes).
  function frontalSpineAxis(A,neural,corridor){
    const src=A&&A.modelSource,kx=src?src.perAnalysisX:1,ky=src?src.perAnalysisY:1;
    const confident=confidentNeuralVertebrae(neural&&neural.vertebrae);
    if(confident.length>=NEURAL_DESKEW.minCenters){
      const axis=spineAxisTilt(confident.map(v=>({x:v.center.x*kx,y:v.center.y*ky})));
      if(axis) return {...axis,source:'neural'};
    }
    const points=corridor&&Array.isArray(corridor.points)?corridor.points:[];
    if(points.length>=NEURAL_DESKEW.minCenters){
      const axis=spineAxisTilt(points.map(p=>({x:p.x*kx,y:p.y*ky})));
      if(axis) return {...axis,source:'corridor'};
    }
    return null;
  }

  function analyzeFrontalNeural(A,scaleMmPerSourcePixel,guides,neural){
    const detected=Array.isArray(neural?.vertebrae)?neural.vertebrae:[];
    const accepted=confidentNeuralVertebrae(detected);
    const rejection=neuralFrontalRejection(accepted,A);
    if(rejection) return {rejected:rejection,detected:detected.length,accepted:accepted.length};
    const centers=accepted.map(v=>({x:v.center.x,y:v.center.y}));
    const corridor=corridorFromCenters(centers,A);
    corridor.userEdited=false;corridor.neural=true;
    const meanScore=accepted.reduce((sum,v)=>sum+v.score,0)/accepted.length;
    corridor.confidence=clampValue(.35+.6*meanScore,.3,.92);
    const lines=accepted.map(v=>{
      const [tl,tr,bl,br]=v.corners;
      const a={x:(tl.x+bl.x)/2,y:(tl.y+bl.y)/2},b={x:(tr.x+br.x)/2,y:(tr.y+br.y)/2};
      const line={a,b,score:v.score,relStrength:1,confidence:clampValue(v.score,.05,.95),neural:true,corners:v.corners.map(copyPoint),label:v.label||null};
      syncLineGeometry(line);
      return line;
    });
    const count=lines.length;
    const result={plane:'frontal',analysis:A,corridor,centers,lines,manualApex:null,engine:NEURAL_FRONTAL_ENGINE,
      neural:{count,meanScore,detected:detected.length,inputWidth:neural.inputWidth||null,inputHeight:neural.inputHeight||null,modelVersion:neural.modelVersion||null,backend:neural.backend||null,inferenceMs:neural.inferenceMs||null}};
    assignFrontalCobbPairs(result,2,0,count-1);
    applyApexGuide(result,guides);
    const primary=result.primary,secondary=result.secondary;
    const pairConfidence=pair=>clampValue(.4*corridor.confidence+.6*(pair?Math.min(lines[pair.i].confidence,lines[pair.j].confidence):.05),.05,.93);
    result.values={coronalMagnitude:primary?primary.angle:null,compensatoryCobb:secondary?secondary.angle:null,coronalDirection:null,trunkShift:null};
    applyFrontalApex(result,scaleMmPerSourcePixel);
    frontalConfidences(result,pairConfidence(primary),Math.min(.9,pairConfidence(secondary)));
    return result;
  }

  function analyzeFrontal(A,scaleMmPerSourcePixel,guides,neural){
    if(neural){
      const neuralResult=analyzeFrontalNeural(A,scaleMmPerSourcePixel,guides,neural);
      if(neuralResult&&!neuralResult.rejected) return neuralResult;
      A.neuralRejection=neuralResult?neuralResult.rejected:'no output';
    }
    // Guide anchors constrain the corridor search itself; corridorWithGuides
    // then only removes the residual so the path meets them exactly.
    let corridor=detectSpineCorridor(A,guideAnchors(guides));
    corridor.analysis = A;
    // The pelvic brim sits just below the lumbar spine on frontal images and its
    // oblique rim reads as a steep false endplate, so trim the corridor floor
    // (relative to the exposed field, not the padded canvas).
    const field=A.content||{y0:0,y1:A.height-1};
    corridor.bottom = Math.min(corridor.bottom, field.y0+(field.y1-field.y0+1)*.9);
    if(guides) corridor = corridorWithGuides(corridor, guides);
    const span=corridor.bottom-corridor.top;
    // Prefer sample points placed on the detected vertebral rhythm; fall back to
    // even spacing when the periodicity is not convincing.
    const pitch=detectVertebralPitch(A,corridor);
    let centers=null,spacing;
    if(pitch.reliable){
      centers=[];
      for(let y=corridor.top+pitch.offsetPx;y<=corridor.bottom;y+=pitch.pitchPx) centers.push(centerAt(corridor,y));
      if(centers.length<9) centers=null; else spacing=pitch.pitchPx;
    }
    if(!centers){
      const fallbackCount=17;
      spacing=span/(fallbackCount-1);
      centers=Array.from({length:fallbackCount},(_,i)=>centerAt(corridor,corridor.top+i*spacing));
    }
    const count=centers.length;
    const fieldWidth=(A.content?A.content.x1-A.content.x0+1:A.width);
    const halfLength=clampValue(spacing*.55,fieldWidth*.03,fieldWidth*.1);
    const lines=centers.map(point=>detectEndplateLine(A,point.x,point.y,halfLength,spacing*.26,16,corridorExpectedAngle(corridor,point.y,spacing*.6)));
    regularizeLineAngles(lines);
    gateLineConfidences(lines);
    // Exclude the outermost line at each end: corridor endpoints commonly land on
    // the pelvic rim or lower cervical clutter and would fake an end vertebra.
    const result={plane:'frontal',analysis:A,corridor,centers,lines,manualApex:null};
    assignFrontalCobbPairs(result,3,1,count-2);
    applyApexGuide(result,guides);
    const primary=result.primary,secondary=result.secondary;
    // The agreement penalty applies to both curves: a secondary pair fitted to
    // clutter is no more trustworthy than a primary one.
    const agreement=lineAgreementFactor(lines,corridor,centers,spacing*.6);
    const pairConfidence=pair=>clampValue((.45*corridor.confidence+.55*(pair?Math.min(lines[pair.i].confidence,lines[pair.j].confidence):.05))*(.35+.65*agreement),.05,.93);
    result.values={coronalMagnitude:primary?primary.angle:null,compensatoryCobb:secondary?secondary.angle:null,coronalDirection:null,trunkShift:null};
    applyFrontalApex(result,scaleMmPerSourcePixel);
    frontalConfidences(result,pairConfidence(primary),Math.min(.9,pairConfidence(secondary)));
    return result;
  }

  // Radial-symmetry search for the femoral heads below the sacral plate. S1 is
  // an endplate line ({cx, cy}); the search used to read a non-existent s1.y,
  // which made its bounds NaN so it never ran and always returned the fallback.
  function detectRadialPoint(A,s1){
    const field=A.content||{x0:0,y0:0,x1:A.width-1,y1:A.height-1};
    const fw=field.x1-field.x0+1,fh=field.y1-field.y0+1;
    const xMin=Math.round(field.x0+fw*.1),xMax=Math.round(field.x1-fw*.1);
    const yMin=Math.round(Math.max(field.y0,s1.cy+fh*.02)),yMax=Math.round(Math.min(field.y1,s1.cy+fh*.3));
    const rMin=Math.max(7,Math.round(fw*.025)),rMax=Math.max(rMin+4,Math.round(fw*.09));
    let best={score:-Infinity,x:s1.cx,y:Math.min(field.y1,s1.cy+fh*.12),r:rMin};
    const step=Math.max(3,Math.round(fw/130));
    for(let y=yMin;y<=yMax;y+=step) for(let x=xMin;x<=xMax;x+=step) {
      if(Math.hypot(x-s1.cx,y-s1.cy)>fw*.38) continue;
      for(let r=rMin;r<=rMax;r+=Math.max(3,Math.round(fw*.012))) {
        // A ring crossing the field border scores the border itself as a rim.
        if(x-r<field.x0+2||x+r>field.x1-2||y-r<field.y0+2||y+r>field.y1-2) continue;
        // A femoral head is a closed rim: its gradient is radial all the way
        // round. Straight edges (a femoral shaft, a corner) cross the ring
        // tangentially on part of it, so tangential gradient is subtracted and
        // the score is weighted by how much of the ring carries a radial edge.
        let radial=0,tangential=0,covered=0;
        for(let k=0;k<24;k++){
          const theta=2*Math.PI*k/24,c=Math.cos(theta),s=Math.sin(theta);
          const gx=sample(A.gx,A,x+r*c,y+r*s),gy=sample(A.gy,A,x+r*c,y+r*s);
          const along=Math.abs(gx*c+gy*s);
          radial+=along;tangential+=Math.abs(gy*c-gx*s);
          if(along>A.edgeP90*.5) covered++;
        }
        const score=((radial-.5*tangential)/24)*(covered/24);
        if(score>best.score) best={score,x,y,r};
      }
    }
    best.searched=Number.isFinite(best.score);
    best.confidence=best.searched?clampValue((best.score/A.edgeP90-.3)/1.8,.03,.88):.03;
    return best;
  }

  // ---- Lateral ------------------------------------------------------------
  // The classical tracer does not identify vertebral levels. The 23 samples
  // (C2..L5) are placed at population arc-length fractions of the traced path,
  // each at the endplate its measurement uses: C2 inferior at 0, C7 inferior
  // .161, T4 superior .279, T12 inferior .672, L1 superior .684 of the arc from
  // the C2 inferior to the S1 superior endplate, from approximate adult body
  // and disc heights (cervical bodies ~14 mm, thoracic 17-24 mm, lumbar
  // 26-28 mm; discs ~5, 4-6 and 9-11 mm), i.e. C2-C7 ~16%, T1-T12 ~50% and
  // L1-S1 ~32% of the arc. Equal spacing put the C7/T4/T12/L1 lines one to
  // three levels low. Only with C2 and S1 anchors does the path span that arc,
  // and even then the level names are estimates, so their confidence is capped
  // (LATERAL_CONFIDENCE_CAPS) and manual landmarks remain the measured route.
  const LATERAL_LEVELS=Object.freeze(['C2','C3','C4','C5','C6','C7','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12','L1','L2','L3','L4','L5']);
  const LATERAL_LEVEL_FRACTIONS=Object.freeze([0,.032,.064,.096,.129,.161,.184,.22,.257,.279,.336,.377,.42,.463,.507,.553,.602,.672,.684,.766,.829,.895,.96]);
  // Approximate adult vertebral body depth (anteroposterior, mm) per level,
  // on the same 591 mm C2-S1 arc: a cervical endplate is about half as deep
  // as a lumbar one, so one line length for every level overshot the neck.
  const LATERAL_LEVEL_DEPTH_MM=Object.freeze([16,16,16,16,16,17,18,20,22,24,25,26,27,28,29,30,31,32,33,34,35,35,35]);
  const LATERAL_ARC_MM=591;
  const LATERAL_INDEXES=Object.freeze({c2:0,c7:5,t4:9,t12:17,l1:18,l5:22});
  const HIP_CONFIDENCE_FLOOR=.24;
  // A sacral slope this far below zero is not physiological: it means the
  // declared anterior side contradicts the image, so signed values are held.
  const SACRAL_SLOPE_FLOOR=-10;
  const LATERAL_CONFIDENCE_CAPS=Object.freeze({unanchoredLevels:.15,anchoredLevels:.34,unidentifiedS1:.15,detectedHip:.34,unsigned:.1});

  // Arc length is taken along a smoothed copy of the traced path: small
  // wiggles in the trace would otherwise lengthen whichever region they sit
  // in and push every level fraction toward it.
  function corridorArcProfile(corridor){
    const steps=240,span=corridor.bottom-corridor.top,cumulative=[0];
    const xs=smoothSeries(Float32Array.from({length:steps+1},(_,i)=>corridor.xAt(corridor.top+span*i/steps)),12);
    for(let i=1;i<=steps;i++) cumulative.push(cumulative[i-1]+Math.hypot(xs[i]-xs[i-1],span/steps));
    return {steps,span,cumulative};
  }
  const corridorArcLength=corridor=>{ const profile=corridorArcProfile(corridor); return profile.cumulative[profile.steps]; };
  function corridorArcPoints(corridor,fractions){
    const {steps,span,cumulative}=corridorArcProfile(corridor);
    const total=cumulative[steps];
    return fractions.map(fraction=>{
      const target=fraction*total;let i=1;
      while(i<steps&&cumulative[i]<target) i++;
      const segment=cumulative[i]-cumulative[i-1],t=segment>1e-9?clampValue((target-cumulative[i-1])/segment,0,1):0;
      return centerAt(corridor,corridor.top+span*(i-1+t)/steps);
    });
  }
  // The sacral plate is inclined anterior-down, normally 20-60°. Searching
  // ±48° around horizontal with a pull toward 0° capped steep slopes and
  // favoured flat clutter, so each side's search covers 10-70° with only a
  // weak prior. Both inclinations are kept: the declared anterior side picks
  // one, including when the orientation is declared after the run.
  function sacralEndplateCandidates(A,center,halfLength,verticalWindow){
    const candidates={
      left:detectEndplateLine(A,center.x,center.y,halfLength,verticalWindow,30,-40,.004),
      right:detectEndplateLine(A,center.x,center.y,halfLength,verticalWindow,30,40,.004)
    };
    Object.values(candidates).forEach(line=>{ line.detected={a:copyPoint(line.a),b:copyPoint(line.b)}; });
    return candidates;
  }
  const pickSacralEndplate=(candidates,orientation)=>{
    const side=explicitLateralOrientation(orientation);
    return side?candidates[side]:candidates.left.score>=candidates.right.score?candidates.left:candidates.right;
  };
  const moved=(point,origin)=>Boolean(point&&origin&&Math.hypot(point.x-origin.x,point.y-origin.y)>1);
  // The user has drawn this S1 line (its endpoints moved from the detection).
  const sacralLineEdited=s1=>Boolean(s1&&s1.detected&&(moved(s1.a,s1.detected.a)||moved(s1.b,s1.detected.b)));

  // One definition of every sagittal value for the automatic, edited and
  // manual paths. angles are image line angles (degrees) keyed c2, c7, t4,
  // t12, l1, s1; s1 holds the S1 superior endplate's two ends; hip is the
  // femoral-head axis; c7 is the C7 plumb reference. Signed CL/TK/LL/PT/SVA
  // need a declared anterior side that the sacrum does not contradict; PI is a
  // line-to-line angle and is kept either way. s1Placed says the S1 line was
  // drawn by the user, whose sacral tilt then checks the declared side.
  function sagittalValues({angles={},s1=null,hip=null,c7=null,mmPerPixel=null,s1Placed=true}={},declared){
    let orientation=explicitLateralOrientation(declared),orientationRejected=false;
    const s1Tilt=anteriorDownTilt(angles.s1,orientation);
    if(s1Placed&&s1Tilt!=null&&s1Tilt<SACRAL_SLOPE_FLOOR){orientation=null;orientationRejected=true;}
    const values={
      cl:signedCervicalAngle(angles.c2,angles.c7,orientation),
      tk:signedKyphosis(angles.t4,angles.t12,orientation),
      ll:signedLordosis(angles.l1,angles.s1,orientation),
      pt:null,pi:null,measuredSva:null,
      sacralSlope:Number.isFinite(angles.s1)?(orientation?anteriorDownTilt(angles.s1,orientation):Math.abs(normalizeAngle(angles.s1))):null
    };
    if(hip&&s1&&s1[0]&&s1[1]){
      const mid={x:(s1[0].x+s1[1].x)/2,y:(s1[0].y+s1[1].y)/2};
      const tilt=Math.atan2(Math.abs(hip.x-mid.x),hip.y-mid.y)*180/Math.PI;
      // A pelvic point this far off the sacrum is a mis-detection, not anatomy.
      if(hip.y>mid.y&&tilt<=60){ values.pi=pelvicIncidence(s1[0],s1[1],hip); values.pt=signedPelvicTilt(hip,mid,orientation); }
    }
    let posteriorCorner=null;
    if(orientation&&s1&&s1[0]&&s1[1]) posteriorCorner=orientation==='left'?(s1[0].x>s1[1].x?s1[0]:s1[1]):(s1[0].x<s1[1].x?s1[0]:s1[1]);
    // SVA: C7 plumb to the posterosuperior S1 corner, positive when C7 is anterior.
    if(posteriorCorner&&c7&&mmPerPixel>0) values.measuredSva=(orientation==='left'?posteriorCorner.x-c7.x:c7.x-posteriorCorner.x)*mmPerPixel/10;
    return {values,orientation,orientationRejected,posteriorCorner};
  }

  // Re-derives a lateral result's values from its current lines, S1 and hip.
  // Used by analyzeLateral and by every overlay edit.
  function measureLateralResult(result,scaleMmPerSourcePixel){
    result.orientation=explicitLateralOrientation(result.orientation);
    // Until the user reshapes it, the S1 line is the detected candidate that
    // matches the declared side.
    if(result.s1Candidates&&!sacralLineEdited(result.s1)) result.s1=pickSacralEndplate(result.s1Candidates,result.orientation);
    const lines=result.lines,idx=result.indexes,s1=result.s1;
    result.c7Point=lineCenter(lines[idx.c7]);
    // The radial search always returns a point (its fallback is the centre of
    // the window), so PT/PI stay behind the same confidence floor on every
    // path; a hand-placed or dragged hip clears it.
    const hip=result.hip&&(result.hip.confidence||0)>=HIP_CONFIDENCE_FLOOR?result.hip:null;
    const measured=sagittalValues({
      angles:{c2:lines[idx.c2].angle,c7:lines[idx.c7].angle,t4:lines[idx.t4].angle,t12:lines[idx.t12].angle,l1:lines[idx.l1].angle,s1:s1.angle},
      s1:[s1.a,s1.b],hip,c7:result.c7Point,mmPerPixel:mmPerAnalysisPixel(result.analysis,scaleMmPerSourcePixel),s1Placed:sacralLineEdited(s1)
    },result.orientation);
    const v=measured.values;
    // Without a usable anterior side the overlay still needs TK/LL numbers, so
    // magnitudes are kept there - sign unknown, and capped far below
    // acceptance by capLateralConfidences so they are never pre-selected.
    result.signedSagittal=Boolean(measured.orientation);
    result.orientationRejected=measured.orientationRejected;
    result.posteriorCorner=measured.posteriorCorner;
    result.values={
      cl:v.cl,
      tk:v.tk!=null?v.tk:angleDifference(lines[idx.t4].angle,lines[idx.t12].angle),
      ll:v.ll!=null?v.ll:angleDifference(lines[idx.l1].angle,s1.angle),
      pt:v.pt,pi:v.pi,measuredSva:v.measuredSva,sacralSlope:v.sacralSlope
    };
    return result;
  }

  // Level identity, not edge strength, limits the automatic lateral: level
  // names come from population fractions (tighter with C2 and S1 anchors) and
  // the pelvic parameters from an S1 line and a radial hip search. These caps
  // keep such rows below acceptance until the user has placed the points.
  function capLateralConfidences(result){
    if(!result||!result.confidences) return result;
    const caps=LATERAL_CONFIDENCE_CAPS,c=result.confidences;
    const s1Identified=Boolean(result.s1Anchored||sacralLineEdited(result.s1));
    const hipPlaced=Boolean(result.hip&&(result.hip.anchored||moved(result.hip,result.hip.detected)));
    const level=result.levelMapping&&result.levelMapping.anchored?caps.anchoredLevels:caps.unanchoredLevels;
    const cap=(key,limit)=>{ if(Number.isFinite(c[key])) c[key]=Math.min(c[key],limit); };
    ['cl','tk','measuredSva'].forEach(key=>cap(key,level));
    cap('ll',s1Identified?level:Math.min(level,caps.unidentifiedS1));
    ['pt','pi'].forEach(key=>cap(key,!s1Identified?caps.unidentifiedS1:hipPlaced?1:caps.detectedHip));
    if(!result.signedSagittal) ['tk','ll'].forEach(key=>cap(key,caps.unsigned));
    return result;
  }

  function analyzeLateral(A,scaleMmPerSourcePixel,anteriorSide,guides){
    const g=guides||{},c2Guide=guidePoint(g.c2),s1Guide=guidePoint(g.s1),hipGuide=guidePoint(g.hip);
    let corridor=detectSpineCorridor(A,[c2Guide,s1Guide].filter(Boolean));
    corridor.analysis = A;
    if(c2Guide||s1Guide) corridor=corridorWithGuides(corridor,{top:c2Guide,bottom:s1Guide});
    const count=LATERAL_LEVEL_FRACTIONS.length,span=corridor.bottom-corridor.top,spacing=span/(count-1);
    const centers=corridorArcPoints(corridor,LATERAL_LEVEL_FRACTIONS);
    const fieldWidth=(A.content?A.content.x1-A.content.x0+1:A.width);
    const halfLength=clampValue(spacing*.6,fieldWidth*.03,fieldWidth*.11);
    const pxPerMm=corridorArcLength(corridor)/LATERAL_ARC_MM;
    // Each search window follows the local level spacing and each line the
    // level's body depth: cervical levels sit about half as far apart, and are
    // about half as deep, as lumbar ones.
    const lines=centers.map((point,i)=>{
      const gap=i===0?centers[1].y-point.y:i===count-1?point.y-centers[i-1].y:(centers[i+1].y-centers[i-1].y)/2;
      const levelHalf=clampValue(.55*LATERAL_LEVEL_DEPTH_MM[i]*pxPerMm,fieldWidth*.015,fieldWidth*.11);
      return detectEndplateLine(A,point.x,point.y,levelHalf,Math.max(2,gap*.28),26,corridorExpectedAngle(corridor,point.y,spacing*.6));
    });
    // Regional indices are fixed level positions, so the sample count must not
    // change; only the angles are regularised.
    regularizeLineAngles(lines);
    gateLineConfidences(lines);
    const orientation=explicitLateralOrientation(anteriorSide);
    // An S1 anchor sits on the sacral plate itself, so its window stays tight
    // enough to exclude the L5 inferior endplate one disc height above.
    const s1Center=s1Guide||centerAt(corridor,corridor.bottom);
    const s1Candidates=sacralEndplateCandidates(A,s1Center,halfLength*1.2,spacing*(s1Guide?.22:1));
    const detectedHip=detectRadialPoint(A,pickSacralEndplate(s1Candidates,orientation));
    const hip=hipGuide?{...detectedHip,x:hipGuide.x,y:hipGuide.y,confidence:Math.max(.62,detectedHip.confidence),r:Math.max(8,Math.round(A.width*.05)),anchored:true}:detectedHip;
    hip.detected={x:hip.x,y:hip.y};
    const result={plane:'lateral',analysis:A,corridor,centers,lines,s1:null,s1Candidates,hip,indexes:LATERAL_INDEXES,orientation,
      levelMapping:{method:'population_arc_fraction',anchored:Boolean(c2Guide&&s1Guide),levels:LATERAL_LEVELS,identified:false},
      s1Anchored:Boolean(s1Guide)};
    measureLateralResult(result,scaleMmPerSourcePixel);
    const idx=LATERAL_INDEXES,values=result.values,s1=result.s1;
    const regionConfidence=(a,b)=>clampValue(.34*corridor.confidence+.66*Math.min(a.confidence,b.confidence),.04,.94);
    const pelvicConf=clampValue(.3*corridor.confidence+.35*s1.confidence+.35*hip.confidence,.03,.9);
    const llConf=regionConfidence(lines[idx.l1],s1);
    result.confidences={
      cl:values.cl==null?0:regionConfidence(lines[idx.c2],lines[idx.c7]),
      tk:regionConfidence(lines[idx.t4],lines[idx.t12]),
      ll:llConf,
      pt:values.pt==null?0:pelvicConf,pi:values.pi==null?0:pelvicConf,
      measuredSva:values.measuredSva==null?0:Math.min(llConf,.72)
    };
    capLateralConfidences(result);
    const agreement=lineAgreementFactor(lines,corridor,centers,spacing*.6);
    const c=result.confidences;
    result.confidence=clampValue(((c.cl+c.tk+c.ll+Math.max(.15,Math.max(c.pt,c.pi)))/4)*(.35+.65*agreement),.04,.92);
    return result;
  }
