  // The canvas holds the full-resolution view; everything below is drawn in
  // analysis coordinates with sizes in CSS pixels (overlayUnit), so overlays
  // keep one readable size at any zoom.
  function drawBase(result,canvas){
    const A=result.analysis;
    rememberDetected(result);
    const ctx=paintPlane(canvas,A,result.plane);
    // While calibrating this plane, nothing automatic is drawn.
    if(!ctx||manualFocused(result.plane)) return ctx;
    const u=overlayUnit(ctx);
    ctx.strokeStyle='rgba(34,211,238,.9)';ctx.lineWidth=1.5*u;
    ctx.beginPath();result.corridor.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
    // Centreline points are draggable, so they are drawn as visible grab dots.
    result.centers.forEach(p=>{
      ctx.beginPath();ctx.arc(p.x,p.y,4*u,0,Math.PI*2);
      ctx.fillStyle='rgba(14,165,233,.85)';ctx.fill();
      ctx.lineWidth=1.5*u;ctx.strokeStyle='rgba(224,242,254,.95)';ctx.stroke();
    });
    return ctx;
  }
  function drawLine(ctx,line,color,width=2){
    if(!line||!line.a||!line.b)return;ctx.strokeStyle=color;ctx.lineWidth=width*overlayUnit(ctx);ctx.beginPath();ctx.moveTo(line.a.x,line.a.y);ctx.lineTo(line.b.x,line.b.y);ctx.stroke();
  }
  // Labels are kept inside the image so a value near an edge stays readable.
  function drawLabel(ctx,text,x,y,color){
    const u=overlayUnit(ctx),size=11*u,frame=canvasFrames.get(ctx.canvas);
    const W=frame?frame.raster.width:ctx.canvas.width,H=frame?frame.raster.height:ctx.canvas.height;
    ctx.font=`700 ${size}px system-ui`;
    const width=ctx.measureText(text).width+8*u;
    const left=clampValue(x,4*u,Math.max(4*u,W-width)),base=clampValue(y,size+3*u,Math.max(size+3*u,H-4*u));
    ctx.fillStyle='rgba(2,6,23,.78)';ctx.fillRect(left-4*u,base-size-1*u,width,size+5*u);ctx.fillStyle=color;ctx.fillText(text,left,base);
  }
  // Focus mode is clean: only the user's own points, never the automatic
  // answer they are meant to be measured independently of.
  function drawFocusedPlane(ctx,canvas,plane){
    drawManualPoints(ctx,plane);drawEditableHandles(ctx,plane);finishPaint(canvas,plane);
  }
  function drawFrontal(result,canvas){
    const ctx=drawBase(result,canvas);
    if(!ctx) return;
    if(manualFocused('frontal')) return drawFocusedPlane(ctx,canvas,'frontal');
    const u=overlayUnit(ctx);
    if(result.engine===NEURAL_FRONTAL_ENGINE){
      ctx.save();ctx.strokeStyle='rgba(167,243,208,.55)';ctx.lineWidth=1*u;
      result.lines.forEach(line=>{
        if(!line.corners||line.corners.length!==4) return;
        const [tl,tr,bl,br]=line.corners;
        ctx.beginPath();ctx.moveTo(tl.x,tl.y);ctx.lineTo(tr.x,tr.y);ctx.lineTo(br.x,br.y);ctx.lineTo(bl.x,bl.y);ctx.closePath();ctx.stroke();
      });
      ctx.restore();
    }
    if(result.primary){
      drawLine(ctx,result.lines[result.primary.i],'#34d399',2.5);
      drawLine(ctx,result.lines[result.primary.j],'#34d399',2.5);
      // The apex marker follows a dragged or anchored apex.
      const apex=result.manualApex||result.centers[result.apexIndex];
      if(apex){ctx.fillStyle='#f472b6';ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=1.5*u;ctx.beginPath();ctx.arc(apex.x,apex.y,5*u,0,Math.PI*2);ctx.fill();ctx.stroke();}
      const upper=result.lines[result.primary.i];
      if(upper&&Number.isFinite(result.primary.angle)) drawLabel(ctx,`Cobb ${result.primary.angle.toFixed(1)}°`,upper.b.x+6*u,upper.b.y,'#6ee7b7');
    }
    if(result.secondary){drawLine(ctx,result.lines[result.secondary.i],'#fbbf24',2);drawLine(ctx,result.lines[result.secondary.j],'#fbbf24',2);}
    drawGuideDots(ctx, 'frontal');
    drawManualPoints(ctx, 'frontal');
    drawEditableHandles(ctx, 'frontal');
    finishPaint(canvas, 'frontal');
  }
  function drawLateral(result,canvas){
    const ctx=drawBase(result,canvas),idx=result.indexes||{},lines=result.lines||[],values=result.values||{};
    if(!ctx) return;
    if(manualFocused('lateral')) return drawFocusedPlane(ctx,canvas,'lateral');
    const u=overlayUnit(ctx);
    [[idx.c2,'#a78bfa'],[idx.c7,'#a78bfa'],[idx.t4,'#fbbf24'],[idx.t12,'#fbbf24'],[idx.l1,'#34d399']].forEach(([i,c])=>drawLine(ctx,lines[i],c,2));
    drawLine(ctx,result.s1,'#34d399',2.5);
    const hip=result.hip,s1=result.s1;
    const hipDrawable=hip&&[hip.x,hip.y,hip.r].every(Number.isFinite)&&hip.confidence>=.18;
    if(hipDrawable&&s1&&Number.isFinite(s1.cx)){ctx.strokeStyle='#f472b6';ctx.lineWidth=2*u;ctx.beginPath();ctx.arc(hip.x,hip.y,hip.r,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#f472b6';ctx.beginPath();ctx.arc(hip.x,hip.y,4*u,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(hip.x,hip.y);ctx.lineTo(s1.cx,s1.cy);ctx.stroke();}
    if(result.c7Point&&s1&&Number.isFinite(s1.cy)){ctx.strokeStyle='rgba(96,165,250,.75)';ctx.lineWidth=1.5*u;ctx.setLineDash([5*u,5*u]);ctx.beginPath();ctx.moveTo(result.c7Point.x,result.c7Point.y);ctx.lineTo(result.c7Point.x,s1.cy);ctx.stroke();ctx.setLineDash([]);}
    // Level names on the automatic lateral are population estimates and a
    // magnitude without a declared anterior side has no sign, so the label
    // says which of the two it is instead of reading like a measurement.
    if(s1&&s1.b){
      const ll=values.ll,estimate=!(result.levelMapping&&result.levelMapping.identified===true);
      const text=!Number.isFinite(ll)?'LL —'
        :!result.signedSagittal?`|LL| ≈ ${Math.abs(ll).toFixed(1)}° (sign unknown)`
        :estimate?`LL ≈ ${ll.toFixed(1)}° (estimate)`:`LL ${ll.toFixed(1)}°`;
      drawLabel(ctx,text,s1.b.x+6*u,s1.b.y,'#6ee7b7');
    }
    drawGuideDots(ctx, 'lateral');
    drawManualPoints(ctx, 'lateral');
    drawEditableHandles(ctx, 'lateral');
    finishPaint(canvas, 'lateral');
  }

  function domainValue(key,value){
    const domains={pi:[30,80],ll:[10,80],tk:[10,70],cl:[-50,80],pt:[5,45],measuredSva:[-30,30],coronalMagnitude:[0,120],compensatoryCobb:[0,100],trunkShift:[-150,150]};
    if(value==null||!Number.isFinite(value)) return {valid:false,value:null,reason:'not available'};
    const domain=domains[key];
    if(domain&&(value<domain[0]||value>domain[1])) return {valid:false,value,reason:`outside ${domain[0]}–${domain[1]} model domain`};
    return {valid:true,value,reason:null};
  }

  // Where a result row's value came from. Points the user placed are
  // measurements; detector output stays an unvalidated estimate, and a
  // detector line the user reshaped (or steered with an anchor) is recorded
  // as adjusted. The same origin travels into the worksheet and the case.
  const RESULT_ORIGIN_LABELS=Object.freeze({
    manual_landmarks:'your manual landmarks',
    auto_beta:'automatic beta, unvalidated',
    auto_beta_user_adjusted:'automatic beta, adjusted by you'
  });
  const WORKSHEET_KEY_PLANE=Object.freeze({pi:'lateral',ll:'lateral',tk:'lateral',cl:'lateral',pt:'lateral',measuredSva:'lateral',coronalMagnitude:'frontal',coronalDirection:'frontal',compensatoryCobb:'frontal',trunkShift:'frontal'});
  // A row checked at or above the 'medium' boundary: a row labelled low is
  // never pre-selected.
  const ROW_PRECHECK_CONFIDENCE=.42;
  const lineUserEdited=line=>Boolean(line&&line.userEdited);
  // Whether the user moved the lines or points this value is measured from.
  // result defaults to the current result of the key's plane.
  function autoRowAdjusted(key,result){
    const plane=WORKSHEET_KEY_PLANE[key];
    const frontal=plane==='frontal'?result||resultState.frontal:null,lateral=plane==='lateral'?result||resultState.lateral:null;
    if(plane==='frontal'&&frontal&&Array.isArray(frontal.lines)){
      const pair=p=>p?[frontal.lines[p.i],frontal.lines[p.j]]:[];
      if(key==='compensatoryCobb') return pair(frontal.secondary).some(lineUserEdited);
      const primary=pair(frontal.primary).some(lineUserEdited);
      return key==='coronalMagnitude'?primary:primary||Boolean(frontal.manualApex);
    }
    if(plane==='lateral'&&lateral&&lateral.indexes&&Array.isArray(lateral.lines)){
      const idx=lateral.indexes,edited=i=>lineUserEdited(lateral.lines[i]);
      const s1=Boolean(lateral.s1Anchored||sacralLineEdited(lateral.s1));
      const hip=Boolean(lateral.hip&&(lateral.hip.anchored||moved(lateral.hip,lateral.hip.detected)));
      if(key==='cl') return edited(idx.c2)||edited(idx.c7);
      if(key==='tk') return edited(idx.t4)||edited(idx.t12);
      if(key==='ll') return edited(idx.l1)||s1;
      if(key==='measuredSva') return edited(idx.c7)||s1;
      return s1||hip;
    }
    return false;
  }
  // Which side of the frontal image shows the patient's right, and who said
  // so. The intake's "Patient right is on the image" control
  // (#frontalLateralitySelect, data-source default | dicom | user |
  // projection) is authoritative when present; it drives the hidden PA/AP
  // select the analysis reads. 'unconfirmed' withholds the apex side.
  function frontalLateralityDeclaration(){
    const laterality=byId('frontalLateralitySelect'),select=byId('frontalProjectionSelect');
    const assumed=frontalDisplayConvention().patientRightOnImage;
    if(laterality){
      const value=laterality.value==='left'||laterality.value==='right'?laterality.value:null;
      const source=!value?'default':laterality.dataset.source==='dicom'?'dicom':'user';
      return {control:laterality,confirmed:Boolean(value),patientRightOnImage:value||assumed,source};
    }
    const source=select&&select.dataset.autofill==='dicom'?'dicom':select&&select.dataset.userChosen==='true'?'user':'default';
    return {control:select,confirmed:source!=='default',patientRightOnImage:assumed,source};
  }
  const LATERALITY_SOURCE_TEXT=Object.freeze({dicom:'from the DICOM header',user:'your choice',default:'not confirmed'});
  // Apex side and signed translation follow the declared side; with no
  // declaration they are withheld (and never pre-selected).
  const SIDE_DEPENDENT_KEYS=new Set(['coronalDirection','trunkShift']);

  function resultDefinitions(){
    const rows=[];
    const lateral=resultState.lateral,frontal=resultState.frontal;
    if(lateral){
      const values=lateral.values||{},conf=lateral.confidences||{};
      // The automatic lateral names levels from population fractions of the
      // traced path, so every regional value is labelled as an estimate.
      const estimated=!(lateral.levelMapping&&lateral.levelMapping.identified===true);
      const level=text=>estimated?`${text} · population level estimate`:text;
      const sign=lateral.signedSagittal?'':' · sign unknown until the anterior side is chosen';
      const sideWithheld=!lateral.orientation?'withheld until the anterior side is chosen'
        :lateral.orientationRejected?'withheld: the detected S1 plate contradicts the chosen anterior side':null;
      const hipOk=lateral.hip&&(lateral.hip.confidence||0)>=HIP_CONFIDENCE_FLOOR;
      const pelvicWithheld=!hipOk?'withheld: no femoral head found clearly enough':null;
      rows.push({key:'ll',label:'Lumbar lordosis',unit:'°',value:values.ll,confidence:conf.ll,source:level('L1–S1 endplates')+sign});
      rows.push({key:'tk',label:'Thoracic kyphosis',unit:'°',value:values.tk,confidence:conf.tk,source:level('T4–T12 endplates')+sign});
      rows.push({key:'cl',label:'C2–C7 angle',unit:'°',value:values.cl,confidence:conf.cl,source:level('C2–C7 endplates'),unavailable:sideWithheld});
      rows.push({key:'pi',label:'Pelvic incidence',unit:'°',value:values.pi,confidence:conf.pi,source:'S1 line + detected femoral-head point',unavailable:pelvicWithheld});
      rows.push({key:'pt',label:'Pelvic tilt',unit:'°',value:values.pt,confidence:conf.pt,source:'S1 midpoint + detected femoral-head point',unavailable:pelvicWithheld||sideWithheld});
      rows.push({key:'measuredSva',label:'C7 SVA',unit:'cm',value:values.measuredSva,confidence:conf.measuredSva,source:level('C7 plumb to posterior S1 corner'),
        unavailable:sideWithheld||(!(finite(ui.lateralScale&&ui.lateralScale.value)&&Number(ui.lateralScale.value)>0)?'requires lateral mm/pixel':null)});
    }
    if(frontal){
      const values=frontal.values||{},conf=frontal.confidences||{};
      const declared=frontalLateralityDeclaration();
      // Until the side is declared the analysis withholds the apex side and
      // the signed translation (frontalApexValues) rather than assume PA.
      const sideUnconfirmed=!declared.confirmed
        ? 'patient side NOT CONFIRMED: withheld until you choose "Patient right is on the image" from the film’s L/R marker' : null;
      const laterality=sideUnconfirmed||`patient right on image ${declared.patientRightOnImage} (${LATERALITY_SOURCE_TEXT[declared.source]})`;
      rows.push({key:'coronalMagnitude',label:'Primary Cobb',unit:'°',value:values.coronalMagnitude,confidence:conf.coronalMagnitude,source:'max separated endplate pair'});
      rows.push({key:'coronalDirection',label:'Primary apex',unit:'',value:values.coronalDirection,confidence:conf.coronalDirection,source:laterality,
        unavailable:Number.isFinite(values.coronalMagnitude)&&values.coronalMagnitude<MIN_LATERALISED_COBB?'no apex side under 10°':sideUnconfirmed});
      rows.push({key:'compensatoryCobb',label:'Secondary Cobb',unit:'°',value:values.compensatoryCobb,confidence:conf.compensatoryCobb,source:'second non-overlapping curve'});
      rows.push({key:'trunkShift',label:'Apical translation',unit:'mm',value:values.trunkShift,confidence:conf.trunkShift,
        source:`apex offset from end-vertebra chord (+ = patient right)${declared.confirmed?'':' · patient side not confirmed'}`,unavailable:sideUnconfirmed||'requires frontal mm/pixel and an apex side'});
    }
    // The edit path gives the 55% "reviewed" floor only to a value whose own
    // lines or points the user moved (reviewedConfidence in the editor), so
    // every other row already carries the detector's confidence.
    rows.forEach(row=>{ row.origin=autoRowAdjusted(row.key)?'auto_beta_user_adjusted':'auto_beta'; });
    // Manually placed landmarks supersede the detector for the same
    // measurement - the user put the point exactly where they meant it - but
    // the automatic value is kept alongside for an auto-versus-manual check.
    const manualLabels = {
      ll:['Lumbar lordosis','°'], tk:['Thoracic kyphosis','°'], cl:['C2–C7 angle','°'],
      pi:['Pelvic incidence','°'], pt:['Pelvic tilt','°'], measuredSva:['C7 SVA','cm'],
      coronalMagnitude:['Primary Cobb','°'], coronalDirection:['Primary apex',''], trunkShift:['Apical translation','mm'],
      piLl:['PI − LL','°']
    };
    Object.entries(manualValues()).forEach(([key,value])=>{
      if(value==null || !manualLabels[key]) return;
      const row = { key, label:manualLabels[key][0], unit:manualLabels[key][1], value,
        confidence:.9, source:'manually placed landmarks', origin:'manual_landmarks' };
      // PI − LL is shown for reference; the worksheet has no field for it.
      if(key==='piLl'){ row.infoOnly=true; row.source='from your PI and LL landmarks · reference only, not a worksheet field'; }
      if(SIDE_DEPENDENT_KEYS.has(key)&&!frontalLateralityDeclaration().confirmed) row.source+=' · patient side not confirmed';
      const existing = rows.find(candidate=>candidate.key===key);
      if(existing){
        const auto={value:existing.value,confidence:existing.confidence,origin:existing.origin};
        Object.keys(existing).forEach(name=>{ delete existing[name]; });
        Object.assign(existing,row,{auto});
      } else rows.push(row);
    });
    return rows;
  }

  const rowDomain=row=>row.key==='coronalDirection'?{valid:row.value==='left'||row.value==='right',value:row.value,reason:null}:domainValue(row.key,row.value);
  const sideText=value=>value?value[0].toUpperCase()+value.slice(1):'—';
  function rowValueText(row,valid=rowDomain(row).valid){
    if(row.key==='coronalDirection') return sideText(row.value);
    return valid?`${Number(row.value).toFixed(1)}${row.unit}`:'—';
  }
  // "auto 43.0° (Δ +2.1°)" when a manual value replaced a detector value.
  function autoComparisonText(row){
    const auto=row.auto;
    if(!auto) return '';
    if(row.key==='coronalDirection') return auto.value?` · automatic: ${sideText(auto.value)}`:'';
    if(!Number.isFinite(auto.value)) return ' · no automatic value';
    const delta=row.value-auto.value;
    return ` · automatic ${auto.value.toFixed(1)}${row.unit} (Δ ${delta>=0?'+':''}${delta.toFixed(1)}${row.unit})`;
  }
  // A user's explicit check or uncheck survives redraws, drags and window
  // changes; it is reset only when the row's value source changes (a new
  // run, or a manual landmark value replacing the automatic one).
  // The apex side and translation also change with the declared patient side.
  const rowSelectionBasis=row=>{
    const basis=row.origin==='manual_landmarks'?'manual':`auto:${resultState.runSerial||0}`;
    return SIDE_DEPENDENT_KEYS.has(row.key)?`${basis}:${frontalLateralityDeclaration().patientRightOnImage}`:basis;
  };
  function rowSelected(row,domain){
    if(!domain.valid||row.infoOnly) return false;
    const choice=resultState.rowSelection&&resultState.rowSelection[row.key];
    if(choice&&choice.basis===rowSelectionBasis(row)) return Boolean(choice.checked);
    if(SIDE_DEPENDENT_KEYS.has(row.key)&&!frontalLateralityDeclaration().confirmed) return false;
    return (row.confidence||0)>=ROW_PRECHECK_CONFIDENCE;
  }
  function rememberRowChoice(event){
    const box=event&&event.target&&event.target.closest?event.target.closest('input[data-auto-key]'):null;
    if(!box) return;
    resultState.rowSelection={...(resultState.rowSelection||{}),[box.dataset.autoKey]:{checked:box.checked,basis:box.dataset.basis||''}};
  }

  function renderResults(){
    const frontal=ui.frontalFigure,lateral=ui.lateralFigure;
    // A plane with no detector result still needs its staged image drawn, so
    // manual landmarks can be placed and reviewed without running detection.
    if(!resultState.frontal || !resultState.lateral) renderGuidePreview();
    if(resultState.frontal) frontal.hidden=false;
    if(resultState.lateral) lateral.hidden=false;
    ui.previewGrid.hidden=!(resultState.frontal||resultState.lateral||resultState.previewRaster.frontal||resultState.previewRaster.lateral);
    if(resultState.frontal){drawFrontal(resultState.frontal,ui.frontalCanvas);ui.frontalConfidence.textContent=confidenceLabel(resultState.frontal.confidence);ui.frontalConfidence.dataset.level=confidenceLevel(resultState.frontal.confidence);}
    if(resultState.lateral){drawLateral(resultState.lateral,ui.lateralCanvas);ui.lateralConfidence.textContent=confidenceLabel(resultState.lateral.confidence);ui.lateralConfidence.dataset.level=confidenceLevel(resultState.lateral.confidence);}
    const rows=resultDefinitions();
    ui.results.replaceChildren();
    rows.forEach(row=>{
      const domain=rowDomain(row);
      const selectable=domain.valid&&!row.infoOnly;
      const element=document.createElement('label');element.className='auto-result-row';element.dataset.origin=row.origin||'';
      const why=domain.valid?row.source:((row.value==null&&row.unavailable)||domain.reason||row.source);
      const origin=RESULT_ORIGIN_LABELS[row.origin]||'';
      const trust=row.origin==='manual_landmarks'?'placed by you':confidenceLabel(row.confidence||0);
      element.innerHTML=`<input type="checkbox" data-auto-key="${row.key}" data-basis="${rowSelectionBasis(row)}" ${rowSelected(row,domain)?'checked':''} ${selectable?'':'disabled'}><span class="auto-result-copy"><strong>${row.label}</strong><small>${why} · ${origin?`${origin} · `:''}${trust}${autoComparisonText(row)}</small></span><span class="auto-result-value">${rowValueText(row,domain.valid)}</span>`;
      ui.results.append(element);
    });
    ui.results.hidden=!rows.length;
    if(rows.length) setEditorDescription('Editable overlay ready', 'Drag the colored handles on the preview to correct lines, dots, apex position, or hip center. Measurements update immediately from your edits.');
    const usable=rows.some(row=>!row.infoOnly&&rowDomain(row).valid&&(row.confidence||0)>=.25);
    ui.transfer.disabled=!usable;ui.apply.disabled=!usable;ui.clear.disabled=!rows.length;
    if(ui.copyMeasurements) ui.copyMeasurements.disabled=!rows.length;
    if(ui.downloadReview) ui.downloadReview.disabled=!(rows.length||resultState.frontal||resultState.lateral);
  }

  // Long runs produce several independent remarks (engine used, DICOM header,
  // withheld values, image-quality advice). Concatenating them into the single
  // status sentence made an unreadable paragraph, so they are listed instead.
  function setStatusNotes(notes){
    const host=ui.statusNotes;
    if(!host) return;
    const items=(notes||[]).filter(Boolean);
    host.replaceChildren(...items.map(text=>{ const li=document.createElement('li'); li.textContent=text; return li; }));
    host.hidden=items.length===0;
  }
  function setStatus(message,stateName='idle'){ui.status.textContent=message;ui.status.dataset.state=stateName;}

  /* ---------------------------------------------------------------------
     Review worksheet provenance. A transfer marks each field it fills with
     the row's origin and the exact text it wrote; a field still holding that
     text is "as transferred", anything else is the user's own entry. Rows the
     user unchecks, a new run and a cleared session take their unedited
     transfers back out, so a rejected value can never be applied later.
  --------------------------------------------------------------------- */
  const WORKSHEET_TRANSFER_ORIGINS=new Set(['auto_beta','auto_beta_user_adjusted','manual_landmarks']);
  const AUTO_ORIGINS=new Set(['auto_beta','auto_beta_user_adjusted']);
  function worksheetInputs(){
    return {pi:imagingEls.measurementPi,ll:imagingEls.measurementLl,tk:imagingEls.measurementTk,cl:imagingEls.measurementCl,pt:imagingEls.measurementPt,measuredSva:imagingEls.measurementSva,coronalMagnitude:imagingEls.measurementPrimaryCobb,coronalDirection:imagingEls.measurementPrimaryDirection,compensatoryCobb:imagingEls.measurementSecondaryCobb,trunkShift:imagingEls.measurementTranslation};
  }
  const worksheetTransferred=input=>Boolean(input&&WORKSHEET_TRANSFER_ORIGINS.has(input.dataset.worksheetSource)&&input.value===input.dataset.worksheetValue);
  function markWorksheetField(input,origin){
    input.dataset.worksheetSource=origin;input.dataset.worksheetValue=input.value;
    input.title=`Transferred from ${RESULT_ORIGIN_LABELS[origin]||origin}. Editing it makes it your own entry.`;
  }
  function clearWorksheetField(input){
    input.value=input.tagName==='SELECT'?'preserve':'';
    delete input.dataset.worksheetSource;delete input.dataset.worksheetValue;
    input.removeAttribute('title');input.removeAttribute('aria-invalid');
  }
  // Removes unedited transfers; keep(key, origin) returning true spares one.
  function clearWorksheetTransfers(keep=()=>false){
    let cleared=0;
    Object.entries(worksheetInputs()).forEach(([key,input])=>{
      if(!worksheetTransferred(input)||keep(key,input.dataset.worksheetSource)) return;
      clearWorksheetField(input);cleared++;
    });
    return cleared;
  }

  function clearResults(message='Beta results cleared.', clearStagedFiles=false){
    invalidateImagingWork(clearStagedFiles);
    resultState.frontal=null;resultState.lateral=null;
    resultState.rowSelection={};
    // Detector values in the worksheet belonged to the result just cleared.
    clearWorksheetTransfers((key,origin)=>!AUTO_ORIGINS.has(origin));
    ui.previewGrid.hidden=true;ui.results.hidden=true;ui.results.replaceChildren();
    ui.run.disabled=false;ui.transfer.disabled=true;ui.apply.disabled=true;ui.clear.disabled=true;
    if(ui.copyMeasurements) ui.copyMeasurements.disabled=true;
    if(ui.downloadReview) ui.downloadReview.disabled=true;
    hideReviewConfirm();
    setStatus(message,'idle');
    setStatusNotes([]);
    refreshNeuralAvailability();
  }
  function clearImagingCalibrationSession(message='Local files and beta results cleared.'){
    clearResults(message,true);
    clearWorksheetTransfers();
    resultState.previewRaster={frontal:null,lateral:null,supine:null};
    resultState.previewError={};
    [ui.frontalScale,ui.lateralScale].forEach(control=>{ if(control&&control.dataset.autofill==='dicom'){ control.value=''; delete control.dataset.autofill; } });
    resetDicomAutofill('frontal');resetDicomAutofill('lateral');
    manual.active=false;manual.plane=null;manual.index=0;
    manual.points={lateral:{},frontal:{},supine:{}};
    clearGuidePoints();
    renderManualPrompt();renderManualReadout();renderSupinePreview();renderFlexibility();
    return true;
  }

  function selectedRows(){
    const selected=new Set(Array.from(ui.results.querySelectorAll('input[data-auto-key]:checked')).map(input=>input.dataset.autoKey));
    const data={};
    for(const row of resultDefinitions()) if(selected.has(row.key)&&!row.infoOnly) data[row.key]=row.value;
    return data;
  }

  // Writes the selected rows into the worksheet and takes back earlier
  // transfers whose rows are no longer selected (unless the user edited them).
  function transferRows(){
    const selected=new Set(Array.from(ui.results.querySelectorAll('input[data-auto-key]:checked')).map(input=>input.dataset.autoKey));
    const inputs=worksheetInputs(),origins={};
    for(const row of resultDefinitions()){
      const input=inputs[row.key];
      if(!input||row.infoOnly||!selected.has(row.key)||!rowDomain(row).valid) continue;
      if(row.key==='coronalDirection'){
        input.value=row.value;input.dispatchEvent(new Event('change',{bubbles:true}));
      } else {
        input.value=Number(row.value).toFixed(row.key==='trunkShift'?0:1);input.dispatchEvent(new Event('input',{bubbles:true}));
      }
      markWorksheetField(input,row.origin||'auto_beta');
      origins[row.key]=row.origin||'auto_beta';
    }
    const cleared=clearWorksheetTransfers(key=>Object.prototype.hasOwnProperty.call(origins,key));
    return {count:Object.keys(origins).length,keys:Object.keys(origins),origins,cleared};
  }

  function transferSelected(){
    const outcome=transferRows(),count=outcome.count;
    const removed=outcome.cleared?`; ${outcome.cleared} earlier transferred value${outcome.cleared===1?' was':'s were'} removed because ${outcome.cleared===1?'its row is':'their rows are'} no longer selected`:'';
    setStatus(`${count} selected value${count===1?'':'s'} transferred to the review worksheet${removed}. Inspect and edit before applying.`,count?'ready':'warning');
    const anyAuto=Object.values(outcome.origins).some(origin=>AUTO_ORIGINS.has(origin));
    setImagingMeasurementStatus(anyAuto
      ? 'Experimental auto-landmark values were transferred. Review every value before applying to the model.'
      : count ? 'Values from your manual landmarks were transferred. Review every value before applying to the model.'
      : 'No value was transferred. Select at least one available measurement above.','idle');
    return count;
  }

  // Engine, DICOM and landmark provenance recorded with an applied case.
  function dicomProvenance(result){
    const info=result&&result.analysis&&result.analysis.dicom;
    if(!info) return null;
    return {transferSyntaxUID:info.transferSyntaxUID||null,pixelCodec:info.pixelCodec||null,pixelSpacingSource:info.pixelSpacingMm?.source||null,
      spacingApplied:info.spacingApplied??null,spacingDerivation:info.spacingDerivation||null,
      viewPosition:info.viewPosition||null,patientOrientation:info.orientation&&info.orientation.rowDirection?`${info.orientation.rowDirection}\\${info.orientation.columnDirection||''}`:null,
      orientationApplied:info.orientationApplied||null,slotWarning:info.slotWarning||null};
  }
  // sources: {key: origin} of every applied value (user_entered for typed ones).
  function provenanceRecord(sources){
    const outcome={origins:{...(sources||{})},count:Object.keys(sources||{}).length};
    const origins=Object.values(outcome.origins);
    const autoUsed=origins.some(origin=>AUTO_ORIGINS.has(origin));
    return {version:VERSION,
      algorithm:autoUsed?(resultState.frontal?.engine===NEURAL_FRONTAL_ENGINE
        ? 'frontal_neural_ap_corner_v1+lateral_contrast_normalization_band_prior_paired_wall_corridor_local_endplate_and_radial_symmetry'
        : 'contrast_normalization_band_prior_paired_wall_corridor_local_endplate_and_radial_symmetry'):null,
      engines:autoUsed?{frontal:resultState.frontal?(resultState.frontal.engine||'classical_corridor'):null,lateral:resultState.lateral?'classical_corridor':null}:{frontal:null,lateral:null},
      neural:autoUsed&&resultState.frontal?.neural?{modelVersion:resultState.frontal.neural.modelVersion,backend:resultState.frontal.neural.backend,vertebrae:resultState.frontal.neural.count,meanScore:resultState.frontal.neural.meanScore,pass:resultState.frontal.neural.pass||1,retry:resultState.frontal.neural.retry||null,deskew:resultState.frontal.neural.deskew?{...resultState.frontal.neural.deskew}:null}:null,
      dicom:{frontal:dicomProvenance(resultState.frontal),lateral:dicomProvenance(resultState.lateral)},
      perKeySource:{...outcome.origins},
      manualLandmarks:manualLandmarkRecord(),
      declarations:reviewDeclarations(),
      acceptedCount:outcome.count,frontalConfidence:resultState.frontal?.confidence??null,lateralConfidence:resultState.lateral?.confidence??null,reviewRequired:true,clinicallyValidated:false};
  }

  // "Apply selected values to model" applies exactly the selected rows: the
  // worksheet is synchronised first (so it shows what was applied), then only
  // those keys are passed on. Provenance comes from each field's origin.
  function applySelected(){
    const outcome=transferRows();
    if(!outcome.count){setStatus('Select at least one available measurement before applying.','warning');return false;}
    // The apply itself records each key's origin (measurementSources), picks
    // the measurementSource / qaStatus, attaches provenanceRecord() as
    // autoCalibration and says which kind of value was applied.
    return applyImagingMeasurementsToModel({onlyKeys:outcome.keys});
  }

  // Names the source-image problems that plausibly explain a weak result, so a
  // low score points at the input rather than looking like an unexplained fail.
  // Only image-quality findings are returned here; the standing hardware
  // caution is separate (HARDWARE_CAUTION) so it is never presented as the
  // "most likely cause" of anything.
  function imageQualityWarnings(){
    const notes = [];
    ['frontal','lateral'].forEach(plane => {
      const result = resultState[plane];
      if(!result?.analysis) return;
      const A = result.analysis;
      // The exposed field in ORIGINAL pixels is what decides whether an endplate
      // is resolvable — not the frame size, which a screenshot inflates.
      const spineSpan = Math.round(A.sourceFieldHeight || A.sourceHeight || A.height);
      // A DICOM export is the detector image itself: a small exposed field
      // there is collimation, never a viewer screenshot.
      if(A.fieldCropped && !A.dicom){
        const percent = Math.round(((A.sourceFieldWidth*A.sourceFieldHeight)/(A.sourceWidth*A.sourceHeight))*100);
        notes.push(`only about ${percent}% of the ${plane} frame is radiograph; the rest is border or viewer interface. If this is a screenshot, export the image itself instead so its full resolution is used.`);
      }
      if(spineSpan < 800) notes.push(`the ${plane} radiograph is only about ${spineSpan}px tall — below roughly 800px an endplate is 2-3 pixels thick and cannot be fitted reliably (aim for 1200px+).`);
      else if(spineSpan < 1200) notes.push(`the ${plane} radiograph is about ${spineSpan}px tall, which is marginal — 1200px+ gives noticeably better endplate fits.`);
    });
    const lateral = resultState.lateral;
    if(lateral && lateral.values && lateral.values.pi == null && lateral.values.pt == null){
      const hip = lateral.hip || {};
      // The radial search reports whether it had room to run at all; a search
      // that ran but found no clear rim is a different message from cropping.
      if(hip.searched === false) notes.push('the lateral shows no room below the sacrum for the femoral-head search — the femoral heads are probably cropped out, and PI and PT are undefined without them.');
      else if(!((hip.confidence || 0) >= HIP_CONFIDENCE_FLOOR)) notes.push(`no femoral-head outline was found clearly enough on the lateral (${Math.round((hip.confidence || 0)*100)}% rim evidence), so PI and PT are withheld. Place the hip-centre guide or the femoral-head manual landmarks.`);
      else notes.push('the detected femoral-head point sits implausibly far from the sacral plate, so PI and PT are withheld. Check the S1 line and hip centre on the overlay.');
    }
    return notes;
  }
  // Prior-hardware detection is computed but deliberately NOT surfaced as a
  // finding — see HARDWARE_DETECTION_GATE. Instead, every case carries the
  // standing caution, because a flag that misses hardware is worse than no
  // flag: its absence would be read as "no hardware present".
  const HARDWARE_CAUTION = 'if this patient has previous instrumentation, check the traced path over it by hand — metal is the strongest edge on a radiograph and pulls the corridor toward it. Automatic hardware flagging is not reliable enough to be shown here.';
  function sourceQualityWarnings(){
    const notes = imageQualityWarnings();
    if(resultState.frontal || resultState.lateral) notes.push(HARDWARE_CAUTION);
    return notes;
  }

  // Wide-field films (large patients, full-body stitches) leave the spine as a
  // thin strip of the 512x1024 input the network was trained on. When the
  // first pass is rejected, re-crop around the classical corridor and try once
  // more; coordinates map back through the crop offset and scale.
  function neuralFocusCrop(A,corridor){
    const src=A.modelSource,ai=window.__SPINE_AI__;
    if(!src||!corridor||!corridor.points?.length||!ai||!ai.inputSize) return null;
    const fieldWidth=(A.content?A.content.x1-A.content.x0+1:A.width);
    const xs=corridor.points.map(p=>p.x);
    const margin=fieldWidth*.22;
    const x0=clampValue(Math.min(...xs)-margin,0,A.width-32);
    const x1=clampValue(Math.max(...xs)+margin,x0+32,A.width);
    // Not worth a second pass when the crop barely narrows the field.
    if((x1-x0)>fieldWidth*.8) return null;
    const mw=ai.inputSize.width,mh=ai.inputSize.height;
    const canvas=document.createElement('canvas');canvas.width=mw;canvas.height=mh;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context) return null;
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(src.canvas,x0*src.perAnalysisX,0,(x1-x0)*src.perAnalysisX,src.height,0,0,mw,mh);
    return {
      modelInput:{canvas,width:mw,height:mh,imageData:context.getImageData(0,0,mw,mh)},
      mapping:{scaleX:(x1-x0)/mw,scaleY:A.height/mh,offsetX:x0,offsetY:0},
      crop:{x0,x1,widthFraction:(x1-x0)/fieldWidth}
    };
  }

  // Deskewed model input (see NEURAL_DESKEW). The bounded model-source copy of
  // the analysis region (isotropic pixels) is rotated about its centre by the
  // measured tilt so the spine axis is vertical, inside a window of the same
  // size: the network then sees the same scale and aspect ratio as in the
  // first pass (the 512x1024 input is a non-uniform stretch, so a wider frame
  // would squeeze every vertebra). Rotated-out corners are clipped and the
  // uncovered ones are black like collimation; the spine runs through the
  // middle of the frame and stays inside it. The exposed field is then
  // re-measured with the raster reader's rule, so a film scanned askew onto a
  // larger black canvas is re-framed to its own upright field. toAnalysis
  // inverts the whole chain exactly (one affine map), so every returned corner
  // lands in the original analysis frame.
  function neuralDeskewInput(A,tiltDeg){
    const src=A&&A.modelSource,ai=window.__SPINE_AI__;
    if(!src||!Number.isFinite(tiltDeg)||!ai||!ai.inputSize) return null;
    const W=src.width,H=src.height,phi=tiltDeg*Math.PI/180,cos=Math.cos(phi),sin=Math.sin(phi);
    const cx=W/2,cy=H/2;
    // d = R(phi)(p - c) + c: source px -> deskewed frame px.
    const rot=(x,y)=>({x:cos*(x-cx)-sin*(y-cy)+cx,y:sin*(x-cx)+cos*(y-cy)+cy});
    const drawDeskewed=(context,sx,sy,x0,y0)=>{
      context.setTransform(1,0,0,1,0,0);
      context.fillStyle='#000';context.fillRect(0,0,context.canvas.width,context.canvas.height);
      context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
      context.scale(sx,sy);context.translate(cx-x0,cy-y0);context.rotate(phi);context.translate(-cx,-cy);
      context.drawImage(src.canvas,0,0);
      context.setTransform(1,0,0,1,0,0);
    };
    // Field probe at the raster reader's analysis size (520x840 budget).
    const probeZoom=Math.min(520/W,840/H,1);
    const pw=Math.max(96,Math.round(W*probeZoom)),ph=Math.max(160,Math.round(H*probeZoom));
    const probe=document.createElement('canvas');probe.width=pw;probe.height=ph;
    const pctx=probe.getContext('2d',{willReadFrequently:true});
    if(!pctx) return null;
    drawDeskewed(pctx,pw/W,ph/H,0,0);
    const data=pctx.getImageData(0,0,pw,ph).data,raw=new Uint8Array(pw*ph);
    for(let i=0,p=0;i<raw.length;i++,p+=4) raw[i]=Math.round(.2126*data[p]+.7152*data[p+1]+.0722*data[p+2]);
    const field=detectExposedField(raw,pw,ph);
    let x0=0,y0=0,x1=W,y1=H;
    // Unlike rasterFromFile (which crops only below 70% of the frame), any
    // field the detector finds is used: the phantom study showed the network
    // is sensitive to framing (a +8 deg film re-framed from 72% of the window
    // kept its deskew gain, one left un-cropped lost it), and the black corners
    // this rotation itself adds leave every edge column part-exposed, so they
    // never read as a border. Known limit: a viewer screenshot photographed
    // askew keeps its chrome bar slightly slanted after deskew (the spine axis
    // is not the screen edge), so its film strip is not isolated; that film
    // usually fails the gates and falls back like any rejected pass.
    if(field.cropped){
      const pad=4;
      x0=Math.max(0,(field.x0-pad)*W/pw);y0=Math.max(0,(field.y0-pad)*H/ph);
      x1=Math.min(W,(field.x1+1+pad)*W/pw);y1=Math.min(H,(field.y1+1+pad)*H/ph);
    }
    const fw=x1-x0,fh=y1-y0;
    if(!(fw>=40&&fh>=80)) return null;
    const mw=ai.inputSize.width,mh=ai.inputSize.height;
    const canvas=document.createElement('canvas');canvas.width=mw;canvas.height=mh;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context) return null;
    drawDeskewed(context,mw/fw,mh/fh,x0,y0);
    // model px -> deskewed frame -> source px (inverse rotation) -> analysis px.
    const toAnalysis=point=>{
      const dx=point.x*fw/mw+x0-cx,dy=point.y*fh/mh+y0-cy;
      return {x:(cx+cos*dx+sin*dy)/src.perAnalysisX,y:(cy-sin*dx+cos*dy)/src.perAnalysisY};
    };
    // The forward map (analysis px -> model px), for regression checks.
    const toModel=point=>{
      const d=rot(point.x*src.perAnalysisX,point.y*src.perAnalysisY);
      return {x:(d.x-x0)*mw/fw,y:(d.y-y0)*mh/fh};
    };
    return {
      modelInput:{canvas,width:mw,height:mh,imageData:context.getImageData(0,0,mw,mh)},
      toAnalysis,toModel,tiltDeg,
      frame:{width:Math.round(fw),height:Math.round(fh),reframed:fw<W-1||fh<H-1}
    };
  }
  // The network's vertebrae mapped through a deskew's inverse (the detector
  // was called with an identity mapping, so its coordinates are model px).
  function mapNeuralThrough(neural,toAnalysis){
    if(!neural||!Array.isArray(neural.vertebrae)) return neural;
    return {...neural,vertebrae:neural.vertebrae.map(v=>({...v,center:toAnalysis(v.center),corners:(v.corners||[]).map(toAnalysis)}))};
  }

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setNeuralStatus(message,level){
    if(!ui.neuralStatus) return;
    ui.neuralStatus.textContent=`Neural model: ${message}`;
    if(level) ui.neuralStatus.dataset.level=level; else delete ui.neuralStatus.dataset.level;
  }
  // Availability is a property of the build and the browser, not of the last
  // run, so the line says what will happen before anything is staged.
  function refreshNeuralAvailability(){
    if(!ui.neural) return;
    const ai=window.__SPINE_AI__;
    const ok=Boolean(ai&&typeof ai.detectFrontal==='function'&&ai.supported&&ai.supported());
    if(!ok){
      const why=ai&&ai.unavailableReason?ai.unavailableReason():'not embedded in this build';
      ui.neural.checked=false;ui.neural.disabled=true;
      setNeuralStatus(`unavailable (${why}) — the classical corridor search will be used.`,'warning');
      return;
    }
    ui.neural.disabled=false;
    const status=ai.status?ai.status():null;
    if(status&&status.loaded){
      const mode=status.mode==='unpacked'||status.packed===false?'unpacked textures, slower fallback':'packed textures';
      setNeuralStatus(ui.neural.checked
        ? `ready (${status.backend||'webgl'}, ${mode}); runs on the frontal image.`
        : 'loaded but switched off — the classical corridor search will be used.', ui.neural.checked?'ready':null);
    } else {
      setNeuralStatus(ui.neural.checked
        ? 'available; it loads on the first frontal analysis and runs only in this browser.'
        : 'off — the classical corridor search will be used.');
    }
  }
  /* ---------------------------------------------------------------------
     DICOM header use. The decoder reports spacing, window, view position,
     patient orientation and magnification geometry; nothing identifying is
     read. Everything below turns those into plain sentences and fills a
     control only when the user has not made that choice themselves.
  --------------------------------------------------------------------- */
  // Decode failures are worded by the page-level plainDicomFailure
  // (03-state-dom.js), the same mapping the intake uses at file selection.
  const DICOM_WINDOW_LABELS=Object.freeze({tag:'window from header',voi_lut_sequence:'VOI LUT from header',identity:'colour image converted to luminance',auto_percentile:'automatic window'});
  const DICOM_WARNING_TEXT=Object.freeze({
    multi_frame_first_frame_used:'the file holds several frames and only the first was used',
    colour_converted_to_luminance:'a colour image (for example a viewer’s “save as DICOM”) was converted to greyscale',
    presentation_lut_inverse_applied_to_monochrome2:'the header asks for an inverted display, so the image was inverted',
    presentation_lut_identity_ignored_for_monochrome1:'a conflicting display instruction in the header was ignored for this negative-mode film',
    pixel_spacing_differs_from_imager_pixel_spacing:'the calibrated PixelSpacing differs from the detector spacing and was preferred',
    pixel_spacing_invalid_using_imager_pixel_spacing:'PixelSpacing was invalid, so the detector spacing was used',
    pixel_spacing_invalid:'the pixel spacing in the header is invalid and was ignored',
    sigmoid_voi_lut_function_unsupported_using_linear:'the header’s sigmoid contrast curve is shown as a linear window',
    voi_lut_sequence_ignored_window_tag_used:'the header window was used instead of its lookup table',
    voi_lut_sequence_ignored:'the header’s contrast lookup table was ignored',
    voi_lut_sequence_unreadable:'the header’s contrast lookup table could not be read, so another window was used',
    window_width_invalid_using_auto_window:'the header window was invalid, so an automatic window was used',
    estimated_magnification_invalid:'the magnification factor in the header is implausible and was ignored',
    orientation_codes_unrecognized:'the patient-orientation codes in the header could not be read',
    all_pixels_are_padding:'every pixel is marked as padding, so the image may be blank'
  });
  function dicomWarningSentences(warnings){
    const list=Array.isArray(warnings)?warnings:[];
    const known=list.filter(code=>DICOM_WARNING_TEXT[code]).map(code=>DICOM_WARNING_TEXT[code]);
    const other=list.length-known.length;
    if(other>0) known.push(`${other} minor header irregularit${other===1?'y was':'ies were'} tolerated`);
    return known;
  }
  const fmtSpacing=value=>String(Number(value.toFixed(4)));
  // Spacing in the patient plane where the header allows it. ImagerPixelSpacing
  // is measured at the detector, where the anatomy is magnified by the
  // source-to-detector / source-to-object ratio (PS3.3 DX/CR Estimated
  // Radiographic Magnification Factor); a calibrated PixelSpacing already is.
  function dicomPatientSpacing(info){
    const spacing=info&&info.pixelSpacingMm;
    if(!spacing||!Number.isFinite(spacing.row)||!Number.isFinite(spacing.col)) return null;
    const detector=(spacing.row+spacing.col)/2,cal=info.calibration||{};
    if(spacing.source==='PixelSpacing'){
      return {value:detector,source:'PixelSpacing',factor:null,calibrationType:cal.pixelSpacingCalibrationType||null,
        text:cal.pixelSpacingCalibrationType
          ? `PixelSpacing (calibrated, type ${cal.pixelSpacingCalibrationType})`
          : 'PixelSpacing (the header gives no calibration type; on CR/DX films this is often detector spacing, so check it against a known distance)'};
    }
    let factor=Number(cal.estimatedRadiographicMagnificationFactor),basis='magnification factor';
    if(!(factor>=1&&factor<4)&&cal.distanceSourceToDetectorMm>0&&cal.distanceSourceToPatientMm>0){
      factor=cal.distanceSourceToDetectorMm/cal.distanceSourceToPatientMm;basis='source-to-detector ÷ source-to-patient distance';
    }
    if(factor>=1&&factor<4){
      const value=detector/factor;
      return {value,source:'ImagerPixelSpacing/magnification',factor:Number(factor.toFixed(4)),detector,
        text:`ImagerPixelSpacing ${fmtSpacing(detector)} ÷ ${basis} ${factor.toFixed(3)} = ${fmtSpacing(value)} mm/px at the patient (an estimate: the true factor depends on how far the spine sat from the detector)`};
    }
    return {value:detector,source:'ImagerPixelSpacing',factor:null,detector,
      text:'ImagerPixelSpacing (detector plane, not magnification-corrected: distances such as SVA and apical translation may read roughly 10–20% high)'};
  }
  // A decoded DICOM carries its own spacing. It fills an empty spacing field
  // (mm per source pixel) and never overrides a typed value.
  function applyDicomSpacing(raster,plane,notes){
    const info=raster&&raster.dicom;
    if(!info) return;
    const control=plane==='frontal'?ui.frontalScale:ui.lateralScale;
    const windowText=info.window?(DICOM_WINDOW_LABELS[info.window.source]||'automatic window'):'automatic window';
    const parts=[`${plane==='frontal'?'Frontal':'Lateral'} DICOM decoded locally (${info.photometric||'monochrome'}, ${info.bitsStored||'?'}-bit, ${windowText})`];
    const spacing=info.pixelSpacingMm,derived=dicomPatientSpacing(info);
    if(derived){
      const value=Number(derived.value.toFixed(4));
      if(Math.abs(spacing.row-spacing.col)>1e-4) parts.push(`anisotropic spacing ${spacing.row}×${spacing.col} mm averaged`);
      info.spacingDerivation={source:derived.source,value,magnificationFactor:derived.factor,calibrationType:derived.calibrationType||null};
      // A value this code filled in earlier is not a typed value: it belongs to
      // the file that has just been replaced, so it is overwritten rather than
      // silently carried across to a different radiograph.
      const autofilled=control&&control.dataset.autofill==='dicom';
      if(control&&(autofilled||!(finite(control.value)&&Number(control.value)>0))){
        control.value=String(value);
        control.dataset.autofill='dicom';
        info.spacingApplied=value;
        parts.push(`${value} mm/px filled into the ${plane} spacing field from ${derived.text}`);
      } else parts.push(`${value} mm/px available from ${derived.text}; the value you typed was kept`);
    } else parts.push('no pixel spacing in the header, so distances (SVA, translation) need a typed mm/pixel value');
    if(info.modality&&!['CR','DX','RF','XA','RG','OT','DR'].includes(String(info.modality).toUpperCase())) parts.push(`modality ${info.modality} is not a projection-radiograph modality`);
    const warnings=dicomWarningSentences(info.warnings);
    if(warnings.length) parts.push(`note: ${warnings.join('; ')}`);
    notes.push(parts.join('; ')+'.');
  }

  // PatientOrientation (PS3.3 C.7.6.1.1.1) names where the image rows and
  // columns point in the patient. A rotate or mirror applied on the review
  // canvas changes that, so the codes are carried through the view options
  // (mirror first, then clockwise rotation, as orientTransform applies them).
  const OPPOSITE_DIRECTION=Object.freeze({A:'P',P:'A',L:'R',R:'L',H:'F',F:'H'});
  const oppositeCode=code=>code?String(code).split('').map(letter=>OPPOSITE_DIRECTION[letter]||letter).join(''):null;
  function displayedPatientOrientation(raster){
    const o=raster&&raster.dicom&&raster.dicom.orientation;
    if(!o||!o.rowDirection) return null;
    const options=raster.rasterOptions||{};
    let row=o.rowDirection,col=o.columnDirection||null;
    if(options.flip) row=oppositeCode(row);
    const turn=(((options.rotate||0)%360)+360)%360;
    if(turn===90) [row,col]=[oppositeCode(col),row];
    else if(turn===180) [row,col]=[oppositeCode(row),oppositeCode(col)];
    else if(turn===270) [row,col]=[col,oppositeCode(row)];
    return row?{row,col}:null;
  }
  const LATERAL_VIEW_POSITIONS=new Set(['LL','RL','LAT','LATERAL','LLO','RLO']);
  const FRONTAL_VIEW_POSITIONS=new Set(['AP','PA']);
  let projectionAutofillInProgress=false;
  // Uses the header's view position and patient orientation for one plane:
  // warns when the file looks like the other view (swapped slots), sets the
  // lateral anterior side and the frontal laterality convention when the
  // user has not chosen them, and says so in the notes.
  function applyDicomOrientation(raster,plane,notes){
    const info=raster&&raster.dicom;
    if(!info) return null;
    const view=String(info.viewPosition||'').trim().toUpperCase();
    const dir=displayedPatientOrientation(raster),lead=dir?dir.row.charAt(0):null;
    const codes=dir?`${dir.row}\\${dir.col||'?'}`:null;
    const outcome={plane,viewPosition:view||null,patientOrientation:codes,applied:null,slotWarning:null};
    const looksLateral=LATERAL_VIEW_POSITIONS.has(view)||lead==='A'||lead==='P';
    const looksFrontal=FRONTAL_VIEW_POSITIONS.has(view)||lead==='L'||lead==='R';
    const evidence=[view?`view position ${view}`:null,codes?`patient orientation ${codes}`:null].filter(Boolean).join(', ');
    const remedy=byId('swapImagingViews')?'Use “Swap frontal ⇄ lateral” in step 2 (or select each file in its own slot) and stage again.':'Select each file in its own slot and stage again.';
    const other=plane==='frontal'?'lateral':'frontal';
    if((plane==='frontal'&&looksLateral&&!looksFrontal)||(plane==='lateral'&&looksFrontal&&!looksLateral))
      outcome.slotWarning=`The file in the ${plane} slot is a ${other} view according to its DICOM header (${evidence}). Check that the frontal and lateral files were not swapped: a swapped pair gives plausible-looking but wrong numbers. ${remedy}`;
    info.slotWarning=outcome.slotWarning;
    // The caller lists a slot warning first; a contradicting file fills nothing.
    if(outcome.slotWarning) return outcome;
    if(plane==='lateral'&&(lead==='A'||lead==='P')&&ui.anteriorSide){
      // Rows running toward the patient's anterior put the front on image right.
      const side=lead==='A'?'right':'left',control=ui.anteriorSide;
      const userChose=control.value!=='auto'&&control.dataset.autofill!=='dicom';
      if(!userChose){
        control.value=side;control.dataset.autofill='dicom';outcome.applied=side;info.orientationApplied=`anterior image-${side}`;
        notes.push(`Lateral orientation was set from the DICOM header (${evidence}): anterior is image-${side}. Change it under Lateral orientation if the film is displayed differently.`);
      } else if(control.value!==side) notes.push(`The DICOM header (${evidence}) puts anterior on image-${side}, but you chose image-${control.value}; your choice was kept.`);
    }
    const select=byId('frontalProjectionSelect'),lateralitySelect=byId('frontalLateralitySelect');
    if(plane==='frontal'&&(lead==='L'||lead==='R')&&lateralitySelect){
      // Rows running toward the patient's left put the patient's right on image
      // left; toward the right, on image right. The intake fills the control
      // from the raw header when the file is chosen; this re-checks it against
      // the image as displayed (after any rotate or mirror on the canvas).
      const rightOn=lead==='L'?'left':'right',declared=frontalLateralityDeclaration();
      if(declared.source==='user'){
        if(declared.patientRightOnImage!==rightOn) notes.push(`The DICOM header (${evidence}) puts the patient’s right on image ${rightOn}, but you chose image ${declared.patientRightOnImage}; your choice was kept, so check the film’s L/R marker.`);
      } else {
        // applyFrontalLaterality (intake) also sets the PA/AP select the analysis reads.
        if((declared.patientRightOnImage!==rightOn||!declared.confirmed)&&typeof applyFrontalLaterality==='function') applyFrontalLaterality(rightOn,'dicom');
        outcome.applied=rightOn;info.orientationApplied=`patient right on image ${rightOn}`;
        notes.push(`Frontal laterality from the DICOM header (${evidence}): the patient’s right is on image ${rightOn}. Check it against the film’s L/R marker.`);
      }
    } else if(plane==='frontal'&&(lead==='L'||lead==='R')&&select){
      const convention=lead==='L'?'ap':'pa',rightOn=lead==='L'?'left':'right';
      const userChose=select.dataset.userChosen==='true'&&select.dataset.autofill!=='dicom';
      if(!userChose){
        if(select.value!==convention){
          projectionAutofillInProgress=true;
          try { select.value=convention; select.dispatchEvent(new Event('change',{bubbles:true})); }
          finally { projectionAutofillInProgress=false; }
        }
        select.dataset.autofill='dicom';outcome.applied=convention;info.orientationApplied=`patient right on image ${rightOn}`;
        notes.push(`Frontal laterality was set from the DICOM header (${evidence}): the patient’s right is on image ${rightOn}. Check it against the film’s L/R marker.`);
      } else if(select.value!==convention) notes.push(`The DICOM header (${evidence}) puts the patient’s right on image ${rightOn}, which differs from your PA/AP choice; your choice was kept, so check the film’s L/R marker.`);
    }
    return outcome;
  }
  // Values the header filled belong to that file; replacing or clearing it
  // returns the control to its default unless the user chose it since.
  function resetDicomAutofill(plane){
    if(plane==='lateral'&&ui.anteriorSide&&ui.anteriorSide.dataset.autofill==='dicom'){
      ui.anteriorSide.value='auto';delete ui.anteriorSide.dataset.autofill;
    }
    const select=byId('frontalProjectionSelect');
    if(plane==='frontal'&&select&&select.dataset.autofill==='dicom'){
      delete select.dataset.autofill;
      // With the intake's laterality control, the intake resets the side for a
      // new or cleared film itself; setting PA here would read as a choice.
      if(select.value!=='pa'&&!byId('frontalLateralitySelect')){
        projectionAutofillInProgress=true;
        try { select.value='pa'; select.dispatchEvent(new Event('change',{bubbles:true})); }
        finally { projectionAutofillInProgress=false; }
      }
    }
  }

  /* ---------------------------------------------------------------------
     Local review record. "Copy measurements" puts a compact text summary on
     the clipboard; "Download review" saves one .zip (or a .json alone) built
     in this browser with Blob + an <a download> link: an annotated overlay
     PNG per plane and a JSON of landmarks (source-pixel coordinates),
     values, confidences, per-value origin, spacing source, laterality and
     orientation declarations, engine and build. No file name and no DICOM
     identifier is ever written; the overlay images are the radiograph pixels
     as displayed, so burned-in text on the film is NOT removed and the user
     confirms that before images are included.
  --------------------------------------------------------------------- */
  const REVIEW_SCHEMA='deformitysim/radiograph-review/1';
  const REVIEW_DISCLAIMER='Research and education use only. Automatic values are unvalidated heuristic estimates (level names on the automatic lateral are population estimates); nothing here is a clinical measurement or a diagnosis.';
  const reviewSessionId=(()=>{
    try { const bytes=new Uint8Array(8); crypto.getRandomValues(bytes); return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''); }
    catch(error){ return Math.random().toString(16).slice(2,18); }
  })();
  const round1=value=>Number.isFinite(value)?Math.round(value*10)/10:null;
  const round3=value=>Number.isFinite(value)?Math.round(value*1000)/1000:null;
  // Confidences are exported at whole-percent precision, the same rounding the
  // row badges use, so copied and exported percentages match the screen.
  const roundPct=value=>Number.isFinite(value)?Math.round(value*100)/100:null;
  // Analysis-frame point to pixel coordinates of the file as stored (before
  // any on-canvas rotate/mirror or exposed-field crop).
  function toSourcePixel(A,point){
    if(!A||!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)) return null;
    const frame=A.frame;
    if(!frame||!frame.region||!frame.matrix||!(frame.zoomX>0)||!(frame.zoomY>0)){
      const scale=A.scale>0?A.scale:1;
      return {x:round1(point.x/scale),y:round1(point.y/scale)};
    }
    const oriented={x:point.x/frame.zoomX+frame.region.sx,y:point.y/frame.zoomY+frame.region.sy};
    const decoded=applyAffine(invertAffine(frame.matrix),oriented);
    const turned=((A.rasterOptions&&A.rasterOptions.rotate)||0)%180!==0;
    const fileWidth=turned?A.sourceHeight:A.sourceWidth,fileHeight=turned?A.sourceWidth:A.sourceHeight;
    return {x:round1(decoded.x*fileWidth/frame.decodedWidth),y:round1(decoded.y*fileHeight/frame.decodedHeight)};
  }
  const lineRecord=(A,line)=>line&&line.a&&line.b?{a:toSourcePixel(A,line.a),b:toSourcePixel(A,line.b),userEdited:Boolean(line.userEdited)}:null;
  function planeImageRecord(A){
    if(!A) return null;
    return {sourceWidth:A.sourceWidth||null,sourceHeight:A.sourceHeight||null,rotate:(A.rasterOptions&&A.rasterOptions.rotate)||0,
      mirrored:Boolean(A.rasterOptions&&A.rasterOptions.flip),coordinateFrame:'pixels of the file as stored (x right, y down)',
      dicom:A.dicom?{transferSyntax:A.dicom.transferSyntaxUID||null,pixelCodec:A.dicom.pixelCodec||null,modality:A.dicom.modality||null,
        viewPosition:A.dicom.viewPosition||null,patientOrientation:A.dicom.orientation&&A.dicom.orientation.rowDirection?`${A.dicom.orientation.rowDirection}\\${A.dicom.orientation.columnDirection||''}`:null,
        pixelSpacingSource:A.dicom.pixelSpacingMm?A.dicom.pixelSpacingMm.source:null,spacingDerivation:A.dicom.spacingDerivation||null,
        magnificationFactor:A.dicom.calibration?A.dicom.calibration.estimatedRadiographicMagnificationFactor:null,
        windowSource:A.dicom.window?A.dicom.window.source:null,decoderWarnings:(A.dicom.warnings||[]).slice(),
        orientationApplied:A.dicom.orientationApplied||null,slotWarning:A.dicom.slotWarning||null,identityTagsRead:false}:null};
  }
  function manualLandmarkRecord(){
    const out={};
    ['frontal','lateral','supine'].forEach(plane=>{
      const points=manual.points[plane]||{},keys=Object.keys(points);
      if(!keys.length) return;
      const A=plane==='supine'?resultState.previewRaster.supine:planeRaster(plane);
      out[plane]={};
      keys.forEach(key=>{ out[plane][key]=toSourcePixel(A,points[key]); });
    });
    return out;
  }
  function automaticLandmarkRecord(plane){
    const result=resultState[plane];
    if(!result||!result.analysis) return null;
    const A=result.analysis;
    if(plane==='frontal'){
      const pair=p=>p?{upper:lineRecord(A,result.lines[p.i]),lower:lineRecord(A,result.lines[p.j]),angle:round1(p.angle)}:null;
      return {engine:result.engine||'classical_corridor',overallConfidence:roundPct(result.confidence),
        primary:pair(result.primary),secondary:pair(result.secondary),
        apex:toSourcePixel(A,result.manualApex||(result.centers||[])[result.apexIndex]),apexUserPlaced:Boolean(result.manualApex),
        centreline:(result.centers||[]).map(point=>toSourcePixel(A,point)),
        neural:result.neural?{modelVersion:result.neural.modelVersion||null,vertebrae:result.neural.count||null,meanScore:roundPct(result.neural.meanScore),pass:result.neural.pass||1,retry:result.neural.retry||null,deskewDeg:result.neural.deskew?result.neural.deskew.appliedDeg:null}:null};
    }
    const idx=result.indexes||{},levels={};
    [['c2','C2 inferior'],['c7','C7 inferior'],['t4','T4 superior'],['t12','T12 inferior'],['l1','L1 superior']].forEach(([key,name])=>{ levels[key]={endplate:name,line:lineRecord(A,(result.lines||[])[idx[key]])}; });
    return {engine:'classical_corridor',overallConfidence:roundPct(result.confidence),
      levelNames:result.levelMapping&&result.levelMapping.identified===true?'identified':'population level estimates (not identified)',
      levelsAnchored:Boolean(result.levelMapping&&result.levelMapping.anchored),levels,
      s1:lineRecord(A,result.s1),s1UserPlaced:Boolean(result.s1Anchored||sacralLineEdited(result.s1)),
      femoralHead:result.hip&&Number.isFinite(result.hip.x)?{centre:toSourcePixel(A,result.hip),confidence:roundPct(result.hip.confidence),userPlaced:Boolean(result.hip.anchored||moved(result.hip,result.hip.detected))}:null,
      c7Point:toSourcePixel(A,result.c7Point),signedSagittal:Boolean(result.signedSagittal),orientationRejected:Boolean(result.orientationRejected)};
  }
  function spacingDeclaration(plane){
    const control=plane==='frontal'?ui.frontalScale:ui.lateralScale;
    const value=control&&finite(control.value)&&Number(control.value)>0?Number(control.value):null;
    const A=planeRaster(plane),derivation=A&&A.dicom&&A.dicom.spacingDerivation;
    return {mmPerSourcePixel:value,source:value==null?'not provided':control.dataset.autofill==='dicom'&&derivation?`DICOM ${derivation.source}`:'typed by the user',
      magnificationFactor:control&&control.dataset.autofill==='dicom'&&derivation?derivation.magnificationFactor:null};
  }
  function reviewDeclarations(){
    const convention=frontalDisplayConvention(),declared=frontalLateralityDeclaration();
    const side=ui.anteriorSide?ui.anteriorSide.value:'auto';
    return {
      frontalLaterality:{projection:convention.projection,patientRightOnImage:convention.patientRightOnImage,confirmed:declared.confirmed,
        source:declared.source==='dicom'?'DICOM patient orientation':declared.source==='user'?'chosen by the user':'default (not confirmed)'},
      lateralAnteriorSide:{value:side==='left'||side==='right'?`image-${side}`:'not declared',
        source:side==='auto'?'not declared':ui.anteriorSide.dataset.autofill==='dicom'?'DICOM patient orientation':'chosen by the user'},
      spacing:{frontal:spacingDeclaration('frontal'),lateral:spacingDeclaration('lateral')}
    };
  }
  function reviewMeasurementRows(){
    const checked=new Set(Array.from(ui.results?ui.results.querySelectorAll('input[data-auto-key]:checked'):[]).map(input=>input.dataset.autoKey));
    return resultDefinitions().map(row=>{
      const domain=rowDomain(row),numeric=row.key!=='coronalDirection';
      return {key:row.key,label:row.label,unit:row.unit||null,value:numeric?round1(row.value):(row.value||null),
        withinModelDomain:domain.valid,origin:row.origin||null,confidence:row.origin==='manual_landmarks'?null:roundPct(row.confidence||0),
        selected:checked.has(row.key),note:domain.valid?row.source:((row.value==null&&row.unavailable)||domain.reason||row.source),
        automatic:row.auto?{value:numeric?round1(row.auto.value):(row.auto.value||null),confidence:roundPct(row.auto.confidence||0),origin:row.auto.origin||null}:null};
    });
  }
  function buildReviewData({imagesIncluded=false}={}){
    const ai=window.__SPINE_AI__;
    let aiStatus=null;
    try { const s=ai&&ai.status?ai.status():null; if(s) aiStatus={loaded:Boolean(s.loaded),mode:s.mode||null,backend:s.backend||null}; } catch(error){ aiStatus=null; }
    return {
      schema:REVIEW_SCHEMA,createdAt:new Date().toISOString(),reviewId:reviewSessionId,disclaimer:REVIEW_DISCLAIMER,
      app:{radiographModule:VERSION,buildId:typeof MODEL_MANIFEST!=='undefined'&&MODEL_MANIFEST?MODEL_MANIFEST.buildId||null:null,
        modelVersion:typeof MODEL_MANIFEST!=='undefined'&&MODEL_MANIFEST?MODEL_MANIFEST.modelVersion||null:null,neuralRuntime:aiStatus},
      privacy:{fileNames:false,dicomIdentifiers:false,imagesIncluded,burnedInTextRemoved:false,
        note:imagesIncluded?'Overlay images show the radiograph pixels as displayed; burned-in text on the film is not removed.':'No image pixels are included.'},
      declarations:reviewDeclarations(),
      planes:{
        frontal:(resultState.frontal||planeRaster('frontal'))?{image:planeImageRecord(planeRaster('frontal')),automatic:automaticLandmarkRecord('frontal')}:null,
        lateral:(resultState.lateral||planeRaster('lateral'))?{image:planeImageRecord(planeRaster('lateral')),automatic:automaticLandmarkRecord('lateral')}:null
      },
      manualLandmarks:manualLandmarkRecord(),
      measurements:reviewMeasurementRows(),
      applied:state.patientImaging&&state.patientImaging.alignmentApplied?{measurementSource:state.patientImaging.measurementSource||null,
        measurementSources:state.patientImaging.measurementSources||null,appliedMeasurements:(state.patientImaging.appliedMeasurements||[]).slice()}:null
    };
  }
  // Compact text for pasting into notes or a spreadsheet.
  function measurementsText(){
    const data=buildReviewData(),d=data.declarations,lines=['DeformitySim radiograph review (research/education use; not clinically validated)'];
    ['frontal','lateral'].forEach(plane=>{
      const record=data.planes[plane];
      if(!record) return;
      const auto=record.automatic,parts=[plane==='frontal'?'Frontal':'Lateral'];
      if(auto) parts.push(`${auto.engine}, internal consistency ${Math.round((auto.overallConfidence||0)*100)}%`);
      else parts.push('no automatic result');
      if(plane==='frontal') parts.push(`patient right on image ${d.frontalLaterality.patientRightOnImage} (${d.frontalLaterality.source})`);
      else parts.push(`anterior ${d.lateralAnteriorSide.value} (${d.lateralAnteriorSide.source})`);
      const spacing=d.spacing[plane];
      parts.push(spacing.mmPerSourcePixel?`${spacing.mmPerSourcePixel} mm/px (${spacing.source})`:'no mm/px');
      lines.push(parts.join('; '));
    });
    data.measurements.forEach(row=>{
      const value=row.value==null?'—':row.key==='coronalDirection'?sideText(row.value):`${row.value}${row.unit||''}`;
      const how=row.origin==='manual_landmarks'?'manual landmarks':row.origin==='auto_beta_user_adjusted'?`automatic, adjusted (${Math.round((row.confidence||0)*100)}%)`:`automatic (${Math.round((row.confidence||0)*100)}%)`;
      const auto=row.automatic&&row.automatic.value!=null?`; automatic ${row.key==='coronalDirection'?sideText(row.automatic.value):`${row.automatic.value}${row.unit||''}`}`:'';
      lines.push(`${row.label}: ${value} [${how}${row.selected?', selected':''}${auto}]`);
    });
    lines.push(`Build ${data.app.buildId||'unknown'} · radiograph module ${data.app.radiographModule} · review ${data.reviewId}`);
    return lines.join('\n');
  }
  async function copyMeasurements(){
    const text=measurementsText();
    let copied=false;
    try { if(navigator.clipboard&&navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); copied=true; } } catch(error){ copied=false; }
    if(!copied){
      const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
      (ui.results&&ui.results.parentElement||document.body).append(area);area.select();
      try { copied=document.execCommand('copy'); } catch(error){ copied=false; }
      area.remove();
    }
    setStatus(copied?'Measurement summary copied to the clipboard (no file names or patient details).':'The browser blocked clipboard access; use Download review instead.',copied?'ready':'warning');
    return copied?text:null;
  }

  // Store-only ZIP (no compression: PNG and JSON gain little), so one click
  // saves one file instead of triggering a multiple-download prompt.
  const CRC32_TABLE=(()=>{ const table=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; table[n]=c>>>0; } return table; })();
  function crc32(bytes){ let c=0xFFFFFFFF; for(let i=0;i<bytes.length;i++) c=CRC32_TABLE[(c^bytes[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
  function zipStore(files){
    const encoder=new TextEncoder(),parts=[],central=[],now=new Date();
    const time=((now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1))&0xFFFF;
    const date=(((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate())&0xFFFF;
    let offset=0;
    files.forEach(file=>{
      const name=encoder.encode(file.name),data=file.bytes,crc=crc32(data);
      const local=new DataView(new ArrayBuffer(30));
      [[0,0x04034b50,4],[4,20,2],[6,0x0800,2],[8,0,2],[10,time,2],[12,date,2],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length,2],[28,0,2]]
        .forEach(([at,value,size])=>size===4?local.setUint32(at,value,true):local.setUint16(at,value,true));
      parts.push(new Uint8Array(local.buffer),name,data);
      const entry=new DataView(new ArrayBuffer(46));
      [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x0800,2],[10,0,2],[12,time,2],[14,date,2],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[30,0,2],[32,0,2],[34,0,2],[36,0,2],[38,0,4],[42,offset,4]]
        .forEach(([at,value,size])=>size===4?entry.setUint32(at,value,true):entry.setUint16(at,value,true));
      central.push(new Uint8Array(entry.buffer),name);
      offset+=30+name.length+data.length;
    });
    const size=central.reduce((sum,chunk)=>sum+chunk.length,0),end=new DataView(new ArrayBuffer(22));
    [[0,0x06054b50,4],[4,0,2],[6,0,2],[8,files.length,2],[10,files.length,2],[12,size,4],[16,offset,4],[20,0,2]]
      .forEach(([at,value,s])=>s===4?end.setUint32(at,value,true):end.setUint16(at,value,true));
    return new Blob([...parts,...central,new Uint8Array(end.buffer)],{type:'application/zip'});
  }
  const canvasPng=canvas=>new Promise(resolve=>{
    try { canvas.toBlob(blob=>resolve(blob),'image/png'); } catch(error){ resolve(null); }
  });
  // The overlay exactly as reviewed, redrawn outside manual focus mode.
  async function overlayImages(){
    const out=[];
    for(const plane of ['frontal','lateral']){
      if(!planeRaster(plane)) continue;
      const canvas=planeCanvas(plane);
      if(!canvas) continue;
      if(!manualFocused(plane)) redrawPlane(plane);
      if(!(canvas.width>0&&canvas.height>0)) continue;
      const blob=await canvasPng(canvas);
      if(blob) out.push({name:`${plane}_overlay.png`,bytes:new Uint8Array(await blob.arrayBuffer())});
    }
    return out;
  }
  // Builds the bundle without saving it (also the test surface).
  async function buildReviewBundle({images=false}={}){
    const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    const data=buildReviewData({imagesIncluded:Boolean(images)});
    const json=JSON.stringify(data,null,2),encoder=new TextEncoder();
    if(!images) return {name:`spine-review-${stamp}.json`,blob:new Blob([json],{type:'application/json'}),data,files:['review.json']};
    const pngs=await overlayImages();
    data.privacy.imagesIncluded=pngs.length>0;
    const files=[{name:'review.json',bytes:encoder.encode(JSON.stringify(data,null,2))},{name:'measurements.txt',bytes:encoder.encode(measurementsText())},...pngs];
    return {name:`spine-review-${stamp}.zip`,blob:zipStore(files),data,files:files.map(file=>file.name)};
  }
  function saveBlob(blob,name){
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=name;link.rel='noopener';link.hidden=true;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function downloadReview({images=false}={}){
    hideReviewConfirm();
    try {
      const bundle=await buildReviewBundle({images});
      saveBlob(bundle.blob,bundle.name);
      setStatus(`Review saved locally as ${bundle.name} (${bundle.files.join(', ')}). It contains no file names or DICOM identifiers${images?'; the overlay images are the films as displayed, so check them for burned-in details before sharing':''}.`,'ready');
      return bundle;
    } catch(error){
      setStatus(`The review could not be saved: ${error.message}`,'error');
      return null;
    }
  }
  // Images are included only after the user confirms the de-identification
  // caveat; the measurements-only JSON needs no confirmation.
  function showReviewConfirm(){ if(ui.reviewConfirm){ ui.reviewConfirm.hidden=false; const first=ui.reviewConfirm.querySelector('button'); if(first) first.focus(); } }
  function hideReviewConfirm(){ if(ui.reviewConfirm) ui.reviewConfirm.hidden=true; }
  function buildExportControls(){
    const actions=ui.clear&&ui.clear.parentElement;
    // Built once; the controls are created here rather than in the markup.
    if(!actions||ui.downloadReview) return;
    const button=(id,text,title)=>{ const b=document.createElement('button'); b.type='button'; b.className='lab-button'; b.id=id; b.textContent=text; if(title) b.title=title; b.disabled=true; return b; };
    ui.copyMeasurements=button('copyAutoLandmarkMeasurements','Copy measurements','Copies a text summary of the values, their origin and confidence. No file names or patient details.');
    ui.downloadReview=button('downloadAutoLandmarkReview','Download review…','Saves the reviewed overlay and a JSON record of landmarks and values to this device.');
    actions.append(ui.copyMeasurements,ui.downloadReview);
    const panel=document.createElement('div');
    panel.id='autoLandmarkReviewConfirm';panel.className='auto-landmark-actions';panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label','Download review');
    const note=document.createElement('p');note.className='auto-landmark-status';note.dataset.state='warning';
    note.textContent='The overlay images are the radiographs as displayed. Burned-in names, IDs or dates on a film are not removed. Include them only if you have checked the films carry none; the JSON alone holds no pixels, file names or DICOM identifiers.';
    const withImages=button('downloadReviewWithImages','Download .zip with overlay images');withImages.disabled=false;
    const jsonOnly=button('downloadReviewJson','Download measurements only (.json)');jsonOnly.disabled=false;
    const cancel=button('downloadReviewCancel','Cancel');cancel.disabled=false;
    panel.append(note,withImages,jsonOnly,cancel);
    actions.after(panel);
    ui.reviewConfirm=panel;
    ui.copyMeasurements.addEventListener('click',copyMeasurements);
    ui.downloadReview.addEventListener('click',()=>{ if(ui.reviewConfirm&&!ui.reviewConfirm.hidden) hideReviewConfirm(); else showReviewConfirm(); });
    withImages.addEventListener('click',()=>downloadReview({images:true}));
    jsonOnly.addEventListener('click',()=>downloadReview({images:false}));
    cancel.addEventListener('click',()=>{ hideReviewConfirm(); if(ui.downloadReview) ui.downloadReview.focus(); });
  }

