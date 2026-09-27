  function buildAnalysis(raster){
    const { width: w, height: h, imageData } = raster;
    const length = w * h;
    const raw = new Uint8Array(length);
    for (let i = 0, p = 0; i < length; i++, p += 4) {
      raw[i] = Math.round(.2126 * imageData.data[p] + .7152 * imageData.data[p+1] + .0722 * imageData.data[p+2]);
    }
    const content = detectExposedField(raw, w, h);
    // Window on the exposed field only, so collimation cannot flatten the range.
    const histogram = new Uint32Array(256);
    let fieldCount = 0;
    for (let y=content.y0; y<=content.y1; y++){
      const yw = y*w;
      for (let x=content.x0; x<=content.x1; x++){ histogram[raw[yw+x]]++; fieldCount++; }
    }
    const histPercent = q => {
      const target = fieldCount * q; let count = 0;
      for (let i=0;i<256;i++){ count += histogram[i]; if (count >= target) return i; }
      return 255;
    };
    const low = histPercent(.005), high = Math.max(low + 12, histPercent(.995));
    const gray = new Float32Array(length);
    for (let i=0;i<length;i++) gray[i] = clampValue((raw[i]-low)/(high-low),0,1)*255;
    // CLAHE is a viewing aid only. It deliberately equalises local contrast,
    // which is exactly the signal the paired-wall corridor scorer measures, so
    // detection keeps working from the globally windowed field data.
    const display = grayToCanvas(applyClahe(gray, w, h, content, 8, 8, 2.5), w, h);
    const gx = new Float32Array(length), gy = new Float32Array(length), edge = new Float32Array(length);
    const edgeValues = [];
    for (let y=1;y<h-1;y++) {
      const yw=y*w;
      for (let x=1;x<w-1;x++) {
        const i=yw+x;
        const sx = (gray[i+1]-gray[i-1]) + .5*((gray[i-w+1]-gray[i-w-1])+(gray[i+w+1]-gray[i+w-1]));
        const sy = (gray[i+w]-gray[i-w]) + .5*((gray[i+w-1]-gray[i-w-1])+(gray[i+w+1]-gray[i-w+1]));
        gx[i]=sx; gy[i]=sy; edge[i]=Math.hypot(sx,sy);
        if ((x+y)%13===0) edgeValues.push(edge[i]);
      }
    }
    const edgeP90 = Math.max(8, percentile(edgeValues,.90));
    const edgeP98 = Math.max(edgeP90, percentile(edgeValues,.98));
    const analysis = { ...raster, gray, gx, gy, edge, edgeP90, edgeP98, content, display };
    analysis.hardware = detectLikelyHardware(analysis);
    return analysis;
  }

  function sample(array, analysis, x, y){
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= analysis.width-1 || yi >= analysis.height-1) return 0;
    return array[yi*analysis.width+xi] || 0;
  }

  function corridorCandidateScore(A, x, y, radii){
    const field = A.content || { x0:0, x1:A.width-1 };
    const fieldWidth = field.x1 - field.x0 + 1;
    const fieldCenter = (field.x0 + field.x1)/2;
    let best = 0;
    for (const r of radii) {
      // Both sample walls must stay inside the exposed field. Without this a
      // wide radius pairs the spine's own edge with the chest wall or the
      // collimation border and scores higher than the vertebral body itself.
      if (x-r*1.5 < field.x0+1 || x+r*1.5 > field.x1-1) continue;
      let sideL = 0, sideR = 0, horizontal = 0, interior = 0;
      for (let dy=-2;dy<=2;dy++) {
        sideL += Math.abs(sample(A.gx,A,x-r,y+dy));
        sideR += Math.abs(sample(A.gx,A,x+r,y+dy));
        horizontal += Math.abs(sample(A.gy,A,x,y+dy));
        interior += Math.abs(sample(A.gx,A,x,y+dy));
      }
      // The spine reads as a band with TWO roughly symmetric vertical walls and a
      // comparatively quiet interior. min(sideL,sideR) rejects single strong edges
      // (rib borders, chest wall) that used to dominate the old summed score.
      const paired = Math.min(sideL, sideR);
      const balance = 1 - Math.min(1, Math.abs(sideL - sideR) / Math.max(1, sideL + sideR));
      let inside = 0, insideCount = 0;
      for (let dx=-Math.max(2,Math.floor(r*.45));dx<=Math.max(2,Math.floor(r*.45));dx+=2) { inside += sample(A.gray,A,x+dx,y); insideCount++; }
      const outside = (sample(A.gray,A,x-r*1.5,y) + sample(A.gray,A,x+r*1.5,y)) / 2;
      const contrast = Math.abs(inside/Math.max(1,insideCount) - outside);
      const score = paired*(1 + .8*balance) + horizontal*.3 + contrast*.4 - interior*.3;
      if (score>best) best=score;
    }
    const centerPrior = 1 - Math.min(.6, Math.abs(x-fieldCenter)/(fieldWidth*.5));
    return Math.max(0, best) * (.75 + .25*centerPrior);
  }

  function smoothSeries(values, radius){
    const result = new Float32Array(values.length);
    for (let i=0;i<values.length;i++) {
      let sum=0,count=0;
      for (let j=Math.max(0,i-radius);j<=Math.min(values.length-1,i+radius);j++){ sum+=values[j]; count++; }
      result[i]=sum/count;
    }
    return result;
  }

  // Guide anchors are hard constraints on the corridor path: rows at an
  // anchor keep only the columns within ~2% of the field width of it, so the
  // dynamic program passes through every anchor and still follows the image
  // evidence between them (a chord blend used to discard the traced curve).
  function pinCorridorRows(rowScores,anchors,ys,xs,yStep,xStep,fw){
    const pins=(anchors||[]).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
    if(!pins.length) return 0;
    const tolerance=Math.max(2,Math.round(fw*.02/xStep));
    pins.forEach(p=>{
      const row=Math.round((p.y-ys[0])/yStep);
      const column=clampValue(Math.round((p.x-xs[0])/xStep),0,xs.length-1);
      for(let yi=Math.max(0,row-1);yi<=Math.min(ys.length-1,row+1);yi++)
        for(let xi=0;xi<xs.length;xi++) if(Math.abs(xi-column)>tolerance) rowScores[yi][xi]=-1e9;
    });
    return pins.length;
  }

  function detectSpineCorridor(A,anchors){
    const w=A.width,h=A.height;
    const field=A.content||{x0:0,y0:0,x1:w-1,y1:h-1};
    const fw=field.x1-field.x0+1, fh=field.y1-field.y0+1;
    const yStep=Math.max(2,Math.round(h/260));
    const xStep=2;
    // All bounds are relative to the exposed field, not the padded frame, so a
    // collimated image does not push the search window off the anatomy.
    const yMin=Math.round(field.y0+fh*.045), yMax=Math.round(field.y0+fh*.94);
    const xMin=Math.round(field.x0+fw*.12), xMax=Math.round(field.x0+fw*.88);
    const xs=[]; for(let x=xMin;x<=xMax;x+=xStep) xs.push(x);
    const ys=[]; for(let y=yMin;y<=yMax;y+=yStep) ys.push(y);
    // A vertebral body occupies a roughly fixed fraction of the collimated
    // field, so every spatial scale below is field-relative rather than
    // canvas-relative — otherwise a tightly collimated film searches for
    // bodies several times wider than the anatomy actually is.
    const radii=[];
    const rMin=Math.max(3,Math.round(fw*.015)), rMax=Math.max(rMin+4,Math.round(fw*.09));
    for(let r=rMin;r<=rMax;r+=Math.max(2,Math.round(fw*.012))) radii.push(r);
    const rowScores=[];
    for (const y of ys) {
      const row=new Float32Array(xs.length);
      for(let xi=0;xi<xs.length;xi++) row[xi]=corridorCandidateScore(A,xs[xi],y,radii);
      rowScores.push(row);
    }
    // Global vertical-band prior: the spinal column is the strongest vertically
    // persistent band in the image. Penalizing distance from that band keeps the
    // dynamic-programming path from wandering across ribs or the chest wall while
    // still leaving room for genuine scoliotic lateral deviation.
    const columnStrength=new Float32Array(xs.length);
    for(let yi=0;yi<ys.length;yi++) for(let xi=0;xi<xs.length;xi++) columnStrength[xi]+=rowScores[yi][xi];
    const smoothedColumn=smoothSeries(columnStrength,Math.max(2,Math.round(w*.03/xStep)));
    let bandIndex=0;
    for(let i=1;i<smoothedColumn.length;i++) if(smoothedColumn[i]>smoothedColumn[bandIndex]) bandIndex=i;
    const bandAllowance=Math.max(4,Math.round(fw*.16/xStep));
    const bandPenalty=A.edgeP90*.35;
    for(let yi=0;yi<ys.length;yi++) {
      for(let xi=0;xi<xs.length;xi++) {
        const overshoot=Math.abs(xi-bandIndex)-bandAllowance;
        if(overshoot>0) rowScores[yi][xi]-=bandPenalty*overshoot;
      }
    }
    const pinned=pinCorridorRows(rowScores,anchors,ys,xs,yStep,xStep,fw);
    const maxJump=Math.max(2,Math.round(fw*.012/xStep));
    const penalty=A.edgeP90*.5;
    let prev=new Float32Array(xs.length), curr=new Float32Array(xs.length);
    const back=Array.from({length:ys.length},()=>new Int16Array(xs.length));
    prev.set(rowScores[0]);
    for(let yi=1;yi<ys.length;yi++) {
      for(let xi=0;xi<xs.length;xi++) {
        let best=-Infinity,bestIndex=xi;
        const from=Math.max(0,xi-maxJump),to=Math.min(xs.length-1,xi+maxJump);
        for(let pj=from;pj<=to;pj++) {
          const d=xi-pj;
          const value=prev[pj]-penalty*d*d;
          if(value>best){best=value;bestIndex=pj;}
        }
        curr[xi]=rowScores[yi][xi]+best;
        back[yi][xi]=bestIndex;
      }
      const swap=prev;prev=curr;curr=swap;
    }
    let endIndex=0;
    for(let i=1;i<prev.length;i++) if(prev[i]>prev[endIndex]) endIndex=i;
    const pathIndices=new Int16Array(ys.length); pathIndices[ys.length-1]=endIndex;
    for(let yi=ys.length-1;yi>0;yi--) pathIndices[yi-1]=back[yi][pathIndices[yi]];
    const xPath=smoothSeries(Float32Array.from(pathIndices,(index)=>xs[index]),Math.max(2,Math.round(7/yStep)));
    const selectedScores=Float32Array.from(pathIndices,(index,yi)=>rowScores[yi][index]);
    const smoothedScores=smoothSeries(selectedScores,Math.max(2,Math.round(10/yStep)));
    const threshold=percentile(smoothedScores,.48);
    let first=0,last=smoothedScores.length-1;
    for(let i=0;i<smoothedScores.length;i++) {
      let hits=0; for(let j=i;j<Math.min(smoothedScores.length,i+6);j++) if(smoothedScores[j]>=threshold) hits++;
      if(hits>=4){ first=i; break; }
    }
    for(let i=smoothedScores.length-1;i>=0;i--) {
      let hits=0; for(let j=i;j>=Math.max(0,i-5);j--) if(smoothedScores[j]>=threshold) hits++;
      if(hits>=4){ last=i; break; }
    }
    // Extent clamps follow the exposed field like every other bound here; the
    // canvas fractions they replaced ignored where the collimated film sits.
    const top=clampValue(ys[Math.max(0,first-2)],field.y0+fh*.05,field.y0+fh*.30);
    const bottom=clampValue(ys[Math.min(ys.length-1,last+2)],field.y0+fh*.70,field.y0+fh*.94);
    function xAt(y){
      const t=clampValue((y-yMin)/yStep,0,xPath.length-1);
      const i=Math.floor(t),j=Math.min(xPath.length-1,i+1),f=t-i;
      return xPath[i]+(xPath[j]-xPath[i])*f;
    }
    let roughness=0;
    for(let i=2;i<xPath.length;i++) roughness+=Math.abs(xPath[i]-2*xPath[i-1]+xPath[i-2]);
    roughness/=Math.max(1,xPath.length-2);
    const meanScore=Array.from(selectedScores).reduce((a,b)=>a+b,0)/selectedScores.length;
    const scoreScale=Math.max(A.edgeP90*9,percentile(selectedScores,.85));
    const confidence=clampValue(.22+.65*(meanScore/scoreScale)-.05*(roughness/Math.max(1,w*.01)),.08,.92);
    const points=[];
    for(let y=top;y<=bottom;y+=Math.max(3,yStep*2)) points.push({x:xAt(y),y});
    return { top,bottom,xAt,points,confidence,selectedScores,roughness,pinned };
  }

  function sampleBilinear(array, analysis, x, y){
    const x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 1 || y0 < 1 || x0 >= analysis.width-2 || y0 >= analysis.height-2) return 0;
    const fx = x-x0, fy = y-y0, i = y0*analysis.width+x0, w = analysis.width;
    return (array[i]*(1-fx)+array[i+1]*fx)*(1-fy) + (array[i+w]*(1-fx)+array[i+w+1]*fx)*fy;
  }

  function detectEndplateLine(A,cx,cy,halfLength,verticalWindow,angleLimit=42,baseAngle=0,priorPerDegree=.012){
    let best={score:-Infinity,angle:baseAngle,cx,cy};
    const angleStep=2;
    const offsetStep=Math.max(1,Math.round(verticalWindow/7));
    const lineScore=(angle,offset,read)=>{
      const rad=radians(angle),cos=Math.cos(rad),sin=Math.sin(rad);
      const nx=-sin,ny=cos;
      let score=0,count=0;
      for(let t=-halfLength;t<=halfLength;t+=2) {
        const x=cx+t*cos,y=cy+offset+t*sin;
        score+=Math.abs(read(A.gx,A,x,y)*nx+read(A.gy,A,x,y)*ny);count++;
      }
      return count?score/count:0;
    };
    for(let offset=-verticalWindow;offset<=verticalWindow;offset+=offsetStep) {
      for(let angle=baseAngle-angleLimit;angle<=baseAngle+angleLimit;angle+=angleStep) {
        // Soft anatomical prior: distant angles need proportionally stronger
        // gradient evidence, which keeps ambiguous rows near the expected tilt.
        const prior=1-Math.min(.3,Math.abs(angle-baseAngle)*priorPerDegree);
        const score=lineScore(angle,offset,sample)*prior;
        if(score>best.score) best={score,angle,cx,cy:cy+offset};
      }
    }
    // The 2° grid quantised every tilt and the prior pulled it toward the
    // expected angle, so Cobb angles on steep curves read systematically low.
    // A parabola through the unweighted, bilinearly sampled scores at the grid
    // optimum and its neighbours recovers the sub-step tilt.
    if(Number.isFinite(best.score)){
      const offset=best.cy-cy;
      const left=lineScore(best.angle-angleStep,offset,sampleBilinear),mid=lineScore(best.angle,offset,sampleBilinear),right=lineScore(best.angle+angleStep,offset,sampleBilinear);
      const curvature=left-2*mid+right;
      if(curvature<0) best.angle+=clampValue(.5*(left-right)/curvature,-1,1)*angleStep;
    }
    const rad=radians(best.angle),cos=Math.cos(rad),sin=Math.sin(rad);
    best.a={x:best.cx-halfLength*cos,y:best.cy-halfLength*sin};
    best.b={x:best.cx+halfLength*cos,y:best.cy+halfLength*sin};
    best.confidence=clampValue((best.score/A.edgeP90-.35)/1.8,.05,.95);
    return best;
  }

  // If the fitted endplate lines disagree with the tangent of the traced spine,
  // the fit is being driven by clutter rather than by real endplates. Grading
  // that disagreement keeps a confident-looking corridor from lending false
  // confidence to angle measurements taken off noisy lines.
  function lineAgreementFactor(lines, corridor, centers, delta){
    if(!lines?.length || !centers?.length) return .5;
    const deviations = lines.map((line, index) => {
      const expected = corridorExpectedAngle(corridor, centers[index].y, delta);
      return Math.abs(normalizeAngle(line.angle - expected));
    });
    const median = percentile(deviations, .5);
    return clampValue(1 - median/16, .12, 1);
  }

  // Vertebral bodies alternate bone/disc along the column, so the intensity
  // profile down the centreline is quasi-periodic. Recovering that pitch lets
  // sample points land on real vertebrae instead of arbitrary even fractions of
  // the corridor — the classical stand-in for the learned shape prior that
  // modern CNN landmark detectors rely on.
  function detectVertebralPitch(A, corridor){
    const span = corridor.bottom - corridor.top;
    if (!(span > 40)) return { reliable:false };
    const samples = Math.max(48, Math.min(600, Math.round(span)));
    const fieldWidth = A.content ? (A.content.x1-A.content.x0+1) : A.width;
    const half = Math.max(2, Math.round(fieldWidth*.03));
    const profile = new Float32Array(samples);
    for (let i=0;i<samples;i++){
      const y = corridor.top + span*i/(samples-1);
      const x = corridor.xAt(y);
      let total = 0, count = 0;
      for (let dx=-half; dx<=half; dx+=2){ total += sample(A.gray,A,x+dx,y); count++; }
      profile[i] = count ? total/count : 0;
    }
    // Remove the slow exposure gradient so autocorrelation sees only the
    // vertebra/disc alternation.
    const trend = smoothSeries(profile, Math.max(3, Math.round(samples*.08)));
    const detrended = new Float32Array(samples);
    for (let i=0;i<samples;i++) detrended[i] = profile[i] - trend[i];

    let energy = 0;
    for (let i=0;i<samples;i++) energy += detrended[i]*detrended[i];
    if (!(energy > 0)) return { reliable:false };

    // A thoracolumbar corridor plausibly holds ~9-24 vertebrae.
    const minLag = Math.max(3, Math.round(samples/24));
    const maxLag = Math.max(minLag+2, Math.round(samples/9));
    const autocorrelation = lag => {
      let sum = 0, n = 0;
      for (let i=0;i+lag<samples;i++){ sum += detrended[i]*detrended[i+lag]; n++; }
      return n ? sum/n : 0;
    };
    let best = { lag:0, score:-Infinity };
    for (let lag=minLag; lag<=maxLag; lag++){
      const score = autocorrelation(lag);
      if (score > best.score) best = { lag, score };
    }
    const strength = best.score / (energy/samples);
    if (!(best.lag > 0) || !(strength > .18)) return { reliable:false };
    // An integer lag quantises the pitch by ~1/lag, and that error accumulates
    // down the column: a pixel's change in corridor length could re-phase the
    // lower samples onto the wrong vertebra. A parabola through the peak and
    // its neighbours gives the sub-sample period.
    let period = best.lag;
    const before = autocorrelation(best.lag-1), after = autocorrelation(best.lag+1), curvature = before - 2*best.score + after;
    if (curvature < 0) period += clampValue(.5*(before-after)/curvature, -.5, .5);

    // Phase: disc spaces are the darker rows, so pick the offset whose comb
    // lands on the lowest total intensity.
    let phase = 0, darkest = Infinity;
    for (let p=0;p<best.lag;p++){
      let total = 0, n = 0;
      for (let k=0, i=p; i<samples; k++, i=Math.round(p+k*period)){ total += profile[i]; n++; }
      if (n >= 4 && total/n < darkest){ darkest = total/n; phase = p; }
    }
    const pitchPx = span * period/(samples-1);
    const offsetPx = span * phase/(samples-1);
    const count = Math.floor((span - offsetPx)/pitchPx) + 1;
    if (count < 9 || count > 26) return { reliable:false };
    return { reliable:true, pitchPx, offsetPx, count, strength: clampValue(strength, 0, 1) };
  }

  // A real spine's endplate angles change smoothly from level to level. A line
  // whose angle departs sharply from its neighbours is being driven by clutter
  // (a rib crossing, bowel gas, hardware), so pull it back toward the local
  // trend and drop its confidence rather than letting it set a Cobb angle.
  function regularizeLineAngles(lines){
    if (!lines || lines.length < 5) return;
    const angles = lines.map(line => line.angle);
    const trend = angles.map((_, i) => {
      const lo = Math.max(0, i-2), hi = Math.min(angles.length-1, i+2);
      const window = angles.slice(lo, hi+1).slice().sort((a,b)=>a-b);
      return window[Math.floor(window.length/2)];
    });
    const residuals = angles.map((angle, i) => Math.abs(angle - trend[i]));
    // Robust scale: median absolute deviation, floored so a very clean image
    // does not start rejecting genuine curvature.
    const cutoff = Math.max(6, percentile(residuals, .5)*1.4826*2.5);
    lines.forEach((line, i) => {
      const deviation = residuals[i];
      if (deviation <= cutoff) return;
      const weight = clampValue(cutoff/deviation, .2, 1);
      line.angle = trend[i] + (angles[i]-trend[i])*weight;
      line.confidence = clampValue(line.confidence*weight, .05, .95);
      moveLineTo(line, line.cx, line.cy);
    });
  }

  function centerAt(corridor,y){ return {x:corridor.xAt(y),y}; }

  // Vertebral endplates sit roughly perpendicular to the local spine centerline,
  // so the corridor tangent predicts each endplate's tilt. Searching only a
  // window around that prediction stops lines from locking onto rib arcs or
  // bowel gas that cross the corridor at unrelated angles.
  function corridorExpectedAngle(corridor,y,delta){
    const d=Math.max(4,delta);
    const dxdy=(corridor.xAt(y+d)-corridor.xAt(y-d))/(2*d);
    return degrees(Math.atan(-dxdy));
  }

  // Sample rows that landed between endplates have no real line to find; their
  // best fit is weak, angle-arbitrary structure. Grading each line against the
  // strong lines in the same image (rather than a global edge percentile) pushes
  // those rows below the pairing floor so they cannot fake an end vertebra.
  function gateLineConfidences(lines){
    const reference=Math.max(1e-6,percentile(lines.map(line=>line.score),.75));
    lines.forEach(line=>{
      line.relStrength=line.score/reference;
      line.confidence=clampValue(Math.min(line.confidence,(line.relStrength-.3)*1.2),.05,.95);
    });
  }

  function maxCobbPair(lines,minSeparation=3,rangeStart=0,rangeEnd=lines.length-1){
    // Low-confidence endplate lines are usually noise (bowel gas, rib crossings);
    // pairing them produces wildly inflated Cobb angles. Search confident lines
    // first and only fall back to the unfiltered set when too few qualify.
    const floor=Math.max(.16,percentile(lines.slice(rangeStart,rangeEnd+1).map(line=>line.confidence),.35)*.9);
    const search=useFloor=>{
      let best=null;
      for(let i=rangeStart;i<=rangeEnd;i++) {
        if(useFloor&&lines[i].confidence<floor) continue;
        for(let j=i+minSeparation;j<=rangeEnd;j++) {
          if(useFloor&&lines[j].confidence<floor) continue;
          const angle=angleDifference(lines[i].angle,lines[j].angle);
          const score=angle*(.35+.65*Math.min(lines[i].confidence,lines[j].confidence));
          if(!best||score>best.score) best={i,j,angle,score};
        }
      }
      return best;
    };
    return search(true)||search(false);
  }

