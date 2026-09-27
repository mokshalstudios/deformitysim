  // Short numbered progress lines, so a long first run (model load, large
  // films) visibly advances instead of looking stuck. The sticky run bar
  // mirrors this text and shows the elapsed time next to it.
  function runProgress(total,isCurrent){
    let step=0,text='';
    const paint=()=>{ if(isCurrent()) setStatus(`Step ${step} of ${total}: ${text}…`,'running'); };
    return {
      next(label){ step=Math.min(total,step+1);text=label;paint(); },
      detail(label){ text=label;paint(); },
      stop(){}
    };
  }
  const PLANE_NAMES=Object.freeze({frontal:'Frontal',lateral:'Lateral'});

  // Lateral confidences after the anterior side changes: the orientation
  // decides only signs and which values exist, so detector values keep the
  // detector's confidence (as if the side had been declared before the run)
  // and only measurements whose landmarks the user moved get the reviewed
  // floor. The generic edit path floors every value, which rated untouched
  // 22% detector values at 55% and pre-selected them.
  function lateralConfidencesAfterOrientation(result,previous){
    const lines=result.lines||[],idx=result.indexes||{},values=result.values||{};
    const corridorConfidence=result.corridor&&Number.isFinite(result.corridor.confidence)?result.corridor.confidence:0;
    const lineConfidence=line=>line&&Number.isFinite(line.confidence)?line.confidence:0;
    const region=(a,b)=>clampValue(.34*corridorConfidence+.66*Math.min(lineConfidence(a),lineConfidence(b)),.04,.94);
    const hipConfidence=result.hip&&Number.isFinite(result.hip.confidence)?result.hip.confidence:0;
    const pelvic=clampValue(.3*corridorConfidence+.35*lineConfidence(result.s1)+.35*hipConfidence,.03,.9);
    const llConf=region(lines[idx.l1],result.s1);
    const detector={cl:region(lines[idx.c2],lines[idx.c7]),tk:region(lines[idx.t4],lines[idx.t12]),ll:llConf,pt:pelvic,pi:pelvic,measuredSva:Math.min(llConf,.72)};
    const next={};
    Object.keys(detector).forEach(key=>{
      if(!Number.isFinite(values[key])){ next[key]=0; return; }
      const reviewed=autoRowAdjusted(key);
      // A value the user had already reviewed keeps its earlier rating.
      const earlier=previous&&Number.isFinite(previous[key])&&previous[key]>0?previous[key]:0;
      next[key]=reviewed?clampValue(Math.max(detector[key],earlier,.55),.05,.95):detector[key];
    });
    result.confidences=next;
    capLateralConfidences(result);
    return result.confidences;
  }

  // The frontal neural passes after the first full-field inference: a deskewed
  // re-run when the spine axis is tilted (NEURAL_DESKEW), then the spine-focused
  // crop when every earlier pass was rejected. Every pass meets the same gates
  // (analyzeFrontalNeural); a deskewed pass that passes them is preferred over
  // the tilted first pass unless the network is less confident in it. Returns
  // null when the run went stale.
  async function frontalNeuralPasses(A,neural,{ai,scale,guides,isCurrent=()=>true,progress=null,deskew=true}={}){
    let result=analyzeFrontal(A,scale,guides,neural);
    if(!isCurrent()) return null;
    let firstRejection=result.engine===NEURAL_FRONTAL_ENGINE?null:(A.neuralRejection||'implausible');
    let deskewInfo=null;
    if(deskew&&neural){
      const axis=frontalSpineAxis(A,neural,firstRejection?result.corridor:null);
      const tilt=axis?axis.tiltDeg:null;
      deskewInfo={estimatedTiltDeg:Number.isFinite(tilt)?Number(tilt.toFixed(1)):null,axisSource:axis?axis.source:null,axisPoints:axis?axis.count:0,applied:false,outcome:axis?'not needed':'axis not estimable'};
      if(axis&&Math.abs(tilt)>NEURAL_DESKEW.maxTiltDeg) deskewInfo.outcome='tilt beyond the deskew range';
      else if(axis&&Math.abs(tilt)>NEURAL_DESKEW.minTiltDeg){
        const input=neuralDeskewInput(A,tilt);
        if(!input) deskewInfo.outcome='deskewed input could not be built';
        else{
          try{
            if(progress) progress.detail(`the spine axis is tilted ${Math.abs(tilt).toFixed(1)}°; re-running the network on a deskewed copy`);
            const raw=await ai.detectFrontal(input.modelInput,{scaleX:1,scaleY:1,offsetX:0,offsetY:0});
            if(!isCurrent()) return null;
            const deskewed=analyzeFrontalNeural(A,scale,guides,mapNeuralThrough(raw,input.toAnalysis));
            deskewInfo.firstPassMeanScore=result.neural?Number(result.neural.meanScore.toFixed(3)):null;
            deskewInfo.deskewedMeanScore=deskewed&&deskewed.neural?Number(deskewed.neural.meanScore.toFixed(3)):null;
            deskewInfo.firstPassCobb=result.neural&&result.values?result.values.coronalMagnitude:null;
            // Both passes met the gates: the deskewed one is kept unless the
            // network is less confident in it. In the phantom study the
            // deskewed pass scored higher on 48 of 50 rotated films and lower
            // on both upright films whose natural axis exceeded 3 deg (where it
            // was also the less accurate), so a spine that is genuinely off
            // vertical keeps its upright-frame reading.
            const lessConfident=deskewed&&!deskewed.rejected&&!firstRejection&&deskewed.neural.meanScore<result.neural.meanScore;
            if(lessConfident) deskewInfo.outcome=`not preferred (mean corner confidence ${(deskewed.neural.meanScore*100).toFixed(1)}% below the first pass's ${(result.neural.meanScore*100).toFixed(1)}%)`;
            else if(deskewed&&!deskewed.rejected){
              deskewInfo.applied=true;deskewInfo.outcome='kept';deskewInfo.reframed=input.frame.reframed;
              deskewed.neural.pass=2;deskewed.neural.retry='deskew';
              deskewed.neural.firstPass=firstRejection?`was rejected (${firstRejection})`:'also met the gates';
              result=deskewed;
            } else deskewInfo.outcome=`rejected (${deskewed?deskewed.rejected:'no output'})`;
          } catch(error){
            if(!isCurrent()) return null;
            deskewInfo.outcome=`failed (${error.message})`;
          }
        }
      }
    }
    if(neural&&result.engine!==NEURAL_FRONTAL_ENGINE){
      if(deskewInfo&&/^(rejected|failed)/.test(deskewInfo.outcome)) firstRejection+=`; deskewed retry (${Math.abs(deskewInfo.estimatedTiltDeg)}°) ${deskewInfo.outcome}`;
      const focused=neuralFocusCrop(A,result.corridor);
      if(focused){
        try{
          if(progress) progress.detail('first neural pass rejected; retrying on a spine-focused crop');
          const neural2=await ai.detectFrontal(focused.modelInput,focused.mapping);
          if(!isCurrent()) return null;
          const second=analyzeFrontal(A,scale,guides,neural2);
          if(!isCurrent()) return null;
          if(second.engine===NEURAL_FRONTAL_ENGINE){
            second.neural.pass=2;second.neural.retry='focus crop';second.neural.cropWidthFraction=Number(focused.crop.widthFraction.toFixed(2));
            result=second;
          } else firstRejection+=`; focused retry rejected (${A.neuralRejection||'implausible'})`;
        } catch(error){
          if(!isCurrent()) return null;
          firstRejection+=`; focused retry failed (${error.message})`;
        }
      }
    }
    if(result.engine===NEURAL_FRONTAL_ENGINE){
      result.neural.pass=result.neural.pass||1;
      result.neural.deskew=deskewInfo?{...deskewInfo,appliedDeg:deskewInfo.applied?deskewInfo.estimatedTiltDeg:0}:null;
      // A tilted pass kept only because its deskewed retry failed (or the tilt
      // is beyond the deskew range) is the confidently-wrong case the phantom
      // study found, so its ratings are capped below the run's warning level.
      if(deskewInfo&&!deskewInfo.applied&&/^(rejected|failed|tilt beyond)/.test(deskewInfo.outcome)){
        const cap=.4;
        result.confidence=Math.min(result.confidence,cap);
        Object.keys(result.confidences||{}).forEach(key=>{ result.confidences[key]=Math.min(result.confidences[key],cap); });
      }
    }
    return {result,firstRejection,deskew:deskewInfo};
  }
  // The note (and status suffix) that says how the kept neural pass was made.
  function frontalNeuralNote(result){
    const n=result.neural,d=n.deskew;
    const how=n.retry==='focus crop'?` (second pass on a spine-focused crop, ${Math.round(n.cropWidthFraction*100)}% of field width)`
      :n.retry==='deskew'?` (deskewed by ${Math.abs(d.estimatedTiltDeg).toFixed(1)}° before inference, the model input turned ${d.estimatedTiltDeg>0?'clockwise':'counter-clockwise'} as displayed: the ${d.axisSource==='neural'?'first-pass vertebra centres':'traced corridor'} put the spine axis ${Math.abs(d.estimatedTiltDeg).toFixed(1)}° off vertical, and the corners were mapped back onto the original film; the tilted first pass ${n.firstPass})`:'';
    const kept=d&&!d.applied&&/^(rejected|failed)/.test(d.outcome)
      ? ` The film looks rotated by ${Math.abs(d.estimatedTiltDeg).toFixed(1)}°, but the deskewed pass was ${d.outcome}, so these values come from the tilted pass, which is less reliable; straighten the film or check the Cobb lines by hand.`
      : d&&/^not preferred/.test(d.outcome)
        ? ` A deskewed pass (${Math.abs(d.estimatedTiltDeg).toFixed(1)}°) also met the gates, but the network was less confident in it, so the upright-frame reading is kept.`
      : d&&d.outcome==='tilt beyond the deskew range'
        ? ` The spine axis reads ${Math.abs(d.estimatedTiltDeg).toFixed(1)}° off vertical, beyond the ${NEURAL_DESKEW.maxTiltDeg}° deskew range; check the film orientation.` : '';
    return `Frontal: neural corner model${how}, ${n.count} vertebrae, mean corner confidence ${Math.round(n.meanScore*100)}%.${kept}`;
  }

  async function run(){
    if(resultState.running)return false;
    if(state.patientImaging.status!=='staged'||!['radiographs','hybrid'].includes(state.patientImaging.path)){
      setStatus('Stage a standing radiograph pair before running automatic calibration.','warning');return false;
    }
    if(!standingFilesMatch(resultState.stagedStandingFiles)){
      setStatus('The selected standing images differ from the staged source set. Stage them again before calibration.','warning');return false;
    }
    const frontalFile=patientImagingSession.frontal,lateralFile=patientImagingSession.lateral;
    if(!frontalFile&&!lateralFile){setStatus('No raster image references are available.','error');return false;}
    const generation=resultState.imagingGeneration;
    const stagedFiles=resultState.stagedStandingFiles;
    const runIsCurrent=()=>imagingWorkIsCurrent(generation)
      && resultState.activeRunGeneration===generation
      && standingFilesMatch(stagedFiles)
      && frontalFile===patientImagingSession.frontal
      && lateralFile===patientImagingSession.lateral;
    resultState.activeRunGeneration=generation;
    resultState.running=true;ui.run.disabled=true;ui.transfer.disabled=true;ui.apply.disabled=true;
    setStatus('Starting the local analysis…','running');
    // Detector values transferred from an earlier run are stale from here on.
    const staleTransfers=clearWorksheetTransfers((key,origin)=>!AUTO_ORIGINS.has(origin));
    const errors=[],notes=[],warnings=[],failed=[];
    const ai=window.__SPINE_AI__;
    const neuralRequested=Boolean(ui.neural&&ui.neural.checked&&ai&&typeof ai.detectFrontal==='function'&&ai.supported&&ai.supported());
    if(ui.neural&&ui.neural.checked&&!neuralRequested) notes.push(ai?`Neural frontal model unavailable: ${ai.unavailableReason?ai.unavailableReason():'unsupported browser'}; classical search used.`:'Neural frontal model is not embedded in this build; classical search used.');
    if(!neuralRequested) refreshNeuralAvailability();
    if(staleTransfers) notes.push(`${staleTransfers} worksheet value${staleTransfers===1?' was':'s were'} transferred from the previous automatic result and ${staleTransfers===1?'was':'were'} removed; transfer again after reviewing this run.`);
    setStatusNotes([]);
    const progress=runProgress((frontalFile?(neuralRequested?3:2):0)+(lateralFile?2:0),()=>runIsCurrent()&&resultState.running);
    try{
      await nextFrame();
      if(!runIsCurrent())return false;
      if(frontalFile){
        try{
          progress.next('reading the frontal image');
          const raster=await rasterFromFile(frontalFile,{modelInput:neuralRequested});
          if(!runIsCurrent())return false;
          applyDicomSpacing(raster,'frontal',notes);
          const view=applyDicomOrientation(raster,'frontal',notes);
          if(view&&view.slotWarning) warnings.push(view.slotWarning);
          const A=buildAnalysis(raster);
          let neural=null;
          if(neuralRequested&&raster.modelInput){
            try{
              const loaded=Boolean(ai.status&&ai.status()&&ai.status().loaded);
              progress.next(loaded?'running the neural vertebra-corner model on the frontal image':'loading the neural vertebra-corner model (the first run takes several seconds)');
              setNeuralStatus('Loading model…','running');
              await ai.ensureLoaded(message=>setNeuralStatus(message,'running'));
              if(!runIsCurrent())return false;
              if(!loaded) progress.detail('running the neural vertebra-corner model on the frontal image');
              neural=await ai.detectFrontal(raster.modelInput,{scaleX:A.width/raster.modelInput.width,scaleY:A.height/raster.modelInput.height});
              if(!runIsCurrent())return false;
              const modeNote=neural.packed===false?', unpacked textures after the faster path failed the numeric self-test':'';
              setNeuralStatus(`ready (${neural.backend||'tfjs'}${modeNote}) · ${neural.vertebrae.length} vertebrae proposed in ${Math.round(neural.inferenceMs||0)} ms.`,'ready');
              if(neural.packed===false) notes.push('This GPU failed the fast-path numeric self-test, so the model ran in the slower unpacked mode.');
            } catch(error){
              if(!runIsCurrent())return false;
              neural=null;
              notes.push(`Neural frontal model failed (${error.message}); classical search used.`);
              setNeuralStatus(`Model error: ${error.message}`,'error');
            }
          }
          progress.next(neural?'building Cobb candidates from the neural vertebra corners':'tracing the frontal spine and fitting Cobb endplates');
          await nextFrame();
          if(!runIsCurrent())return false;
          const passes=await frontalNeuralPasses(A,neural,{ai,scale:ui.frontalScale.value,guides:resultState.guides.frontal,isCurrent:runIsCurrent,progress});
          if(!passes||!runIsCurrent())return false;
          const result=passes.result,firstRejection=passes.firstRejection;
          if(result.engine===NEURAL_FRONTAL_ENGINE){
            notes.push(frontalNeuralNote(result));
            const d=result.neural.deskew;
            if(d&&d.applied&&ui.neuralStatus) setNeuralStatus(`${ui.neuralStatus.textContent.replace(/^Neural model: /,'').replace(/\.$/,'')} · deskewed by ${Math.abs(d.estimatedTiltDeg).toFixed(1)}° before the kept pass.`,'ready');
          }
          else if(neural){
            notes.push(`Neural frontal output rejected (${firstRejection}); classical search used.`);
            // The status line must not keep reporting proposed vertebrae as if
            // they produced the values.
            setNeuralStatus(`ran, but its output was rejected (${firstRejection}); every frontal value comes from the classical search.`,'warning');
          }
          // The full-resolution model canvases are only needed while the passes
          // run; keeping them on the result would hold tens of MB for the rest
          // of the session.
          A.modelInput=null;A.modelSource=null;
          resultState.frontal=result;
        } catch(error){
          if(!runIsCurrent())return false;
          errors.push(`Frontal image: ${error.message}`);failed.push('frontal');resultState.frontal=null;
        }
      }
      if(lateralFile){
        try{
          progress.next('reading the lateral image');
          const raster=await rasterFromFile(lateralFile);
          if(!runIsCurrent())return false;
          applyDicomSpacing(raster,'lateral',notes);
          const view=applyDicomOrientation(raster,'lateral',notes);
          if(view&&view.slotWarning) warnings.push(view.slotWarning);
          const A=buildAnalysis(raster);
          progress.next('tracing the lateral spine, regional endplates and pelvic point');
          await nextFrame();
          if(!runIsCurrent())return false;
          const result=analyzeLateral(A,ui.lateralScale.value,ui.anteriorSide.value,resultState.guides.lateral);
          if(!runIsCurrent())return false;
          resultState.lateral=result;
        } catch(error){
          if(!runIsCurrent())return false;
          errors.push(`Lateral image: ${error.message}`);failed.push('lateral');resultState.lateral=null;
        }
      }
      if(!runIsCurrent())return false;
      progress.stop();
      // A new result is a new value source: earlier row choices do not carry over.
      resultState.runSerial=(resultState.runSerial||0)+1;
      // The detector's own ratings, kept so later edits cannot inflate them
      // for values the user did not touch (see resultDefinitions).
      ['frontal','lateral'].forEach(plane=>{ const result=resultState[plane]; if(result&&result.confidences) result.detectorConfidences={...result.confidences}; });
      renderResults();
      renderManualReadout();
      if(resultState.frontal||resultState.lateral){
        const overall=[resultState.frontal?.confidence,resultState.lateral?.confidence].filter(Number.isFinite);
        const score=overall.length?overall.reduce((a,b)=>a+b,0)/overall.length:0;
        const lateral=resultState.lateral;
        const orientationNotice=lateral&&!lateral.orientation
          ? 'Signed lateral values (C2–C7, TK and LL signs, PT and C7 SVA) are withheld because the lateral orientation is still Auto; choose image-left or image-right anterior under Lateral orientation.'
          : lateral&&lateral.orientationRejected
            ? 'Signed lateral values are withheld because the detected S1 plate contradicts the chosen anterior side; check the side or drag the S1 line.' : '';
        const anchorNotice=lateral&&lateral.levelMapping&&!lateral.levelMapping.anchored
          ? 'Lateral level names are population estimates. Place the C2 and S1 guide anchors before running, or use the manual lateral landmarks, for values you can rely on.' : '';
        // "Most likely cause" is reserved for image-quality findings; the
        // standing hardware caution is listed last as information.
        const quality=imageQualityWarnings();
        const advice=score<.42&&quality.length?quality.map((note,index)=>index===0?`Most likely cause: ${note}`:note):quality;
        const confidenceText=`${confidenceLevel(score)} internal consistency (${Math.round(score*100)}%)`;
        const analysed=['frontal','lateral'].filter(plane=>resultState[plane]);
        // The headline leads with a dropped plane: a pair with one film
        // missing must not read like a completed pair.
        const headline=failed.length
          ? `${PLANE_NAMES[failed[0]]} image could not be analysed; only the ${analysed.join(' and ')} result is shown (${confidenceText}). See the first note for why and how to fix it.`
          : warnings.length
            ? `Automatic landmark beta completed with ${confidenceText}, but the DICOM header suggests the frontal and lateral files are swapped. Check the first note before using any value.`
            : `Automatic landmark beta completed with ${confidenceText}. Review overlay placement and uncheck any unreliable value before transfer.`;
        setStatus(headline,failed.length||warnings.length||score<.42?'warning':'ready');
        setStatusNotes([...errors,...warnings,orientationNotice,anchorNotice,...advice,...notes,`Standing caution: ${HARDWARE_CAUTION}`]);
      }else{
        setStatus(errors.length?`No image could be analysed. ${errors.join(' ')}`:'Automatic calibration could not generate a result.','error');
        setStatusNotes([...warnings,...notes.filter(note=>!/^(Frontal|Lateral) DICOM decoded/.test(note))]);
      }
    }catch(error){
      if(runIsCurrent()){
        clearResults('Automatic calibration failed.');
        setStatus(`Automatic calibration failed: ${error.message}`,'error');
      }
      return false;
    } finally {
      progress.stop();
      if(resultState.activeRunGeneration===generation){
        resultState.activeRunGeneration=null;
        resultState.running=false;
        ui.run.disabled=false;
      }
    }
    return imagingWorkIsCurrent(generation)&&standingFilesMatch(stagedFiles)&&Boolean(resultState.frontal||resultState.lateral);
  }

  // After a preview decode: say which staged plane failed and why, in words,
  // and apply the header's orientation where the user has not chosen one.
  function reportPreview(planes){
    const notes=[],failures=[],slotWarnings=[];
    planes.forEach(plane=>{
      const file=plane==='frontal'?patientImagingSession.frontal:patientImagingSession.lateral;
      if(!file) return;
      const raster=resultState.previewRaster[plane];
      if(raster){ const view=applyDicomOrientation(raster,plane,notes); if(view&&view.slotWarning) slotWarnings.push(view.slotWarning); }
      else failures.push(`${PLANE_NAMES[plane]} image could not be decoded: ${(resultState.previewError&&resultState.previewError[plane])||'the file could not be read.'}`);
    });
    if(notes.length) renderManualReadout();
    return {notes,failures,slotWarnings};
  }

  function init(){
    Object.assign(ui,{
      beta:byId('autoLandmarkBeta'),run:byId('runAutoLandmark'),transfer:byId('transferAutoLandmark'),apply:byId('applyAutoLandmark'),clear:byId('clearAutoLandmark'),runOnStage:byId('autoLandmarkRunOnStage'),neural:byId('autoLandmarkNeural'),neuralStatus:byId('autoLandmarkNeuralStatus'),anteriorSide:byId('autoLandmarkAnteriorSide'),frontalScale:byId('autoLandmarkFrontalScale'),lateralScale:byId('autoLandmarkLateralScale'),windowMode:byId('autoLandmarkWindow'),manualPrompt:byId('manualPrompt'),manualStep:byId('manualStep'),manualTarget:byId('manualTarget'),manualHint:byId('manualHint'),manualProgressFill:byId('manualProgressFill'),manualReadout:byId('manualReadout'),manualStartLateral:byId('manualStartLateral'),manualStartFrontal:byId('manualStartFrontal'),manualStartSupine:byId('manualStartSupine'),manualUndo:byId('manualUndo'),manualReset:byId('manualReset'),supineFigure:byId('autoLandmarkSupineFigure'),supineCanvas:byId('autoLandmarkSupineCanvas'),flexCompare:byId('flexCompare'),flexCompareRows:byId('flexCompareRows'),flexCompareNote:byId('flexCompareNote'),flexApply:byId('flexApply'),status:byId('autoLandmarkStatus'),statusNotes:byId('autoLandmarkStatusNotes'),previewGrid:byId('autoLandmarkPreviewGrid'),frontalFigure:byId('autoLandmarkFrontalFigure'),lateralFigure:byId('autoLandmarkLateralFigure'),frontalCanvas:byId('autoLandmarkFrontalCanvas'),lateralCanvas:byId('autoLandmarkLateralCanvas'),frontalConfidence:byId('autoLandmarkFrontalConfidence'),lateralConfidence:byId('autoLandmarkLateralConfidence'),results:byId('autoLandmarkResults'), editorSummary:byId('landmarkEditorSummary'), editorTitle:byId('landmarkEditorTitle'), editorDescription:byId('landmarkEditorDescription'), guideHint:byId('guideHint'), guideButtons:Array.from(document.querySelectorAll('[data-guide]')), showGuidePreview:byId('showGuidePreview'), clearGuidePoints:byId('clearGuidePoints')
    });
    if(Object.values(ui).some(value=>!value))return;
    ui.run.addEventListener('click',run);ui.transfer.addEventListener('click',transferSelected);ui.apply.addEventListener('click',applySelected);ui.clear.addEventListener('click',()=>clearResults());
    // Row checks are the user's review decisions and survive every redraw.
    ui.results.addEventListener('change',rememberRowChoice);
    buildExportControls();
    // A PA/AP choice the user makes is never overridden by the DICOM header.
    const projectionSelect=byId('frontalProjectionSelect');
    if(projectionSelect) projectionSelect.addEventListener('change',()=>{
      if(!projectionAutofillInProgress){ projectionSelect.dataset.userChosen='true';delete projectionSelect.dataset.autofill; }
      // The patient side changed (the intake's laterality control drives this
      // select): an existing apex side and signed translation are re-derived,
      // and unedited transfers of them are taken back out of the worksheet.
      if(resultState.running) return;
      const frontal=resultState.frontal;
      if(frontal&&frontal.values&&typeof applyFrontalApex==='function') applyFrontalApex(frontal,ui.frontalScale.value);
      const cleared=clearWorksheetTransfers(key=>!SIDE_DEPENDENT_KEYS.has(key));
      if(frontal||Object.keys(manual.points.frontal||{}).length){ renderResults(); renderManualReadout(); }
      if(cleared) setStatus(`Frontal patient side changed: the apex side and apical translation were recomputed, and ${cleared} transferred value${cleared===1?' was':'s were'} removed from the worksheet. Transfer again after checking them.`,'warning');
    });
    if(ui.showGuidePreview) ui.showGuidePreview.addEventListener('click',async ()=>{
      const generation=resultState.imagingGeneration;
      setStatus('Loading the staged image preview…','running');
      const current=await prepareGuidePreview(generation);
      if(!current||!imagingWorkIsCurrent(generation))return;
      const available=Boolean(resultState.previewRaster.frontal||resultState.previewRaster.lateral);
      const report=reportPreview(['frontal','lateral']);
      setStatus(!available
        ? 'No current standing image could be decoded for preview.'
        : report.failures.length||report.slotWarnings.length
          ? 'Only part of the staged pair could be previewed; see the notes below.'
          : 'Staged image preview loaded. You can place optional guide points before rerunning calibration.',
        available&&!report.failures.length&&!report.slotWarnings.length?'ready':'warning');
      setStatusNotes([...report.failures,...report.slotWarnings,...report.notes]);
    });
    if(ui.clearGuidePoints) ui.clearGuidePoints.addEventListener('click', clearGuidePoints);
    if(ui.neural) ui.neural.addEventListener('change', refreshNeuralAvailability);
    refreshNeuralAvailability();
    // Manual calibration starts only after a current-generation raster is ready.
    const beginManual = async plane => {
      const generation=resultState.imagingGeneration;
      const hasRaster=()=>Boolean(resultState[plane]||resultState.previewRaster[plane]);
      if(!hasRaster())await prepareGuidePreview(generation);
      if(!imagingWorkIsCurrent(generation))return false;
      if(!hasRaster()){
        const why=resultState.previewError&&resultState.previewError[plane];
        setStatus(why?`The ${plane} image could not be decoded: ${why}`:`Load a ${plane} image before starting manual calibration.`,'error');
        return false;
      }
      return startManual(plane);
    };
    if(ui.manualStartLateral) ui.manualStartLateral.addEventListener('click', ()=>beginManual('lateral'));
    if(ui.manualStartFrontal) ui.manualStartFrontal.addEventListener('click', ()=>beginManual('frontal'));
    if(ui.manualStartSupine) ui.manualStartSupine.addEventListener('click', async ()=>{
      const generation=resultState.imagingGeneration;
      if(!resultState.previewRaster.supine)await refreshSupine();
      if(!imagingWorkIsCurrent(generation)||!resultState.previewRaster.supine)return;
      startManual('supine');
    });
    if(ui.flexApply) ui.flexApply.addEventListener('click', applyMeasuredFlexibility);
    byId('manualFocusUndo')?.addEventListener('click', undoManual);
    byId('manualFocusSkip')?.addEventListener('click', skipManualPoint);
    byId('manualFocusDone')?.addEventListener('click', finishManual);
    document.addEventListener('keydown', event => {
      if(event.key === 'Escape' && manual.active){ event.preventDefault(); finishManual(); }
    });
    attachEditor(ui.supineCanvas, 'supine');
    if(ui.manualUndo) ui.manualUndo.addEventListener('click', undoManual);
    if(ui.manualReset) ui.manualReset.addEventListener('click', resetManual);
    renderManualPrompt();
    if(ui.guideButtons) ui.guideButtons.forEach(button=>button.addEventListener('click',()=>setActiveGuide(button.dataset.guide)));
    attachEditor(ui.frontalCanvas, 'frontal'); attachEditor(ui.lateralCanvas, 'lateral');
    ui.anteriorSide.addEventListener('change',()=>{
      // The user's choice from now on, whatever the header said.
      delete ui.anteriorSide.dataset.autofill;
      const lateral=resultState.lateral;
      if(lateral){
        // Only orientation-dependent values change here (signs, CL, PT, SVA,
        // the S1 candidate); confidences stay detector confidences.
        const previous={...(lateral.confidences||{})};
        lateral.orientation=explicitLateralOrientation(ui.anteriorSide.value);
        measureLateralResult(lateral,ui.lateralScale.value);
        lateralConfidencesAfterOrientation(lateral,previous);
        // Untouched values now carry the detector rating for this side.
        lateral.detectorConfidences={...lateral.confidences};
      }
      renderResults();
      renderManualReadout();
      const declared=explicitLateralOrientation(ui.anteriorSide.value);
      setStatus(!declared
        ? 'Signed lateral values (C2–C7, TK and LL signs, PT and C7 SVA) are withheld until image-left or image-right anterior is selected.'
        : lateral&&lateral.orientationRejected
          ? 'The detected S1 plate contradicts this anterior side, so signed lateral values stay withheld; check the side or drag the S1 line.'
          : 'Lateral orientation set; signed C2–C7, TK, LL, PT and C7 SVA were recomputed from the overlay. Their confidence did not change: review them before transfer.','warning');
    });
    [ui.frontalScale,ui.lateralScale].forEach(control=>control.addEventListener('change',()=>{
      if(resultState.frontal||resultState.lateral){
        ui.transfer.disabled=true;ui.apply.disabled=true;
        setStatus('Image scale changed. Run the beta again before transferring measurements.','warning');
      }
    }));
    // Windowing is a display choice only; detection always uses the enhanced data.
    if(ui.windowMode) ui.windowMode.addEventListener('change',()=>{
      resultState.showEnhanced = ui.windowMode.value !== 'original';
      if(resultState.frontal||resultState.lateral) renderResults(); else renderGuidePreview();
    });
    imagingEls.stage.addEventListener('click',()=>{
      clearResults('Staging the current source set…',true);
      resultState.previewRaster={
        frontal:null,lateral:null,supine:resultState.previewRaster.supine||null
      };
      const generation=resultState.imagingGeneration;
      const stagedAtClick=state.patientImaging.status==='staged'&&['radiographs','hybrid'].includes(state.patientImaging.path);
      resultState.stagedStandingFiles=stagedAtClick?captureStandingFiles():null;
      setTimeout(async ()=>{
        if(!imagingWorkIsCurrent(generation))return;
        const staged=state.patientImaging.status==='staged'&&['radiographs','hybrid'].includes(state.patientImaging.path);
        resultState.stagedStandingFiles=staged?captureStandingFiles():null;
        if(!staged){setStatus('The current source set was not staged. Review the intake requirements and try again.','warning');return;}
        await prepareGuidePreview(generation);
        if(!imagingWorkIsCurrent(generation)||!standingFilesMatch(resultState.stagedStandingFiles))return;
        if(ui.runOnStage.checked){ run(); return; }
        // Without an automatic run, a plane that failed to decode must be
        // reported here, not discovered later when a button does nothing.
        const report=reportPreview(['frontal','lateral']);
        const any=Boolean(resultState.previewRaster.frontal||resultState.previewRaster.lateral);
        if(report.failures.length) setStatus(any?'Only part of the staged pair could be loaded; see the note below for why and how to fix it.':'Neither staged image could be decoded; see the notes below for why and how to fix it.','warning');
        else if(report.slotWarnings.length) setStatus('Staged images loaded, but the DICOM header suggests the frontal and lateral files are swapped; see the note below.','warning');
        else setStatus('Current staged image preview loaded. Review or place guide points, then run calibration.','ready');
        setStatusNotes([...report.failures,...report.slotWarnings,...report.notes]);
      },90);
    });
    // clearPatientImagingSession() owns invalidation, including programmatic
    // demo/API clears; this listener clears editor-only state afterward.
    imagingEls.clear.addEventListener('click',()=>{ clearGuidePoints(); resultState.previewRaster={frontal:null,lateral:null,supine:null}; });
    // Typing in a spacing field takes ownership of it back from the decoder.
    [[ui.frontalScale,'frontal'],[ui.lateralScale,'lateral']].forEach(([control])=>{
      if(control) control.addEventListener('input',()=>{ delete control.dataset.autofill; });
    });
    [imagingEls.frontalInput,imagingEls.lateralInput].forEach(input=>input.addEventListener('change',()=>{
      clearResults('New image selected. Stage the source set to run automatic calibration.',true);
      const plane=input===imagingEls.frontalInput?'frontal':'lateral';
      const scaleControl=plane==='frontal'?ui.frontalScale:ui.lateralScale;
      if(scaleControl&&scaleControl.dataset.autofill==='dicom'){ scaleControl.value=''; delete scaleControl.dataset.autofill; }
      // Header-derived orientation and this plane's landmark transfers belonged to the replaced file.
      resetDicomAutofill(plane);
      clearWorksheetTransfers(key=>WORKSHEET_KEY_PLANE[key]!==plane);
      resultState.previewRaster={...resultState.previewRaster,[plane]:null};
      resultState.guides[plane]={};manual.points[plane]={};
      if(manual.active&&manual.plane===plane){manual.active=false;manual.index=0;}
      renderManualPrompt();renderManualReadout();
      const generation=resultState.imagingGeneration;
      prepareGuidePreview(generation).then(current=>{
        if(!current||!imagingWorkIsCurrent(generation)) return;
        const report=reportPreview([plane]);
        if(report.failures.length||report.slotWarnings.length){
          setStatus(report.failures.length?`The new ${plane} image could not be decoded; see the note below.`:`The new ${plane} image may be in the wrong slot; see the note below.`,'warning');
          setStatusNotes([...report.failures,...report.slotWarnings,...report.notes]);
        } else if(report.notes.length) setStatusNotes(report.notes);
      });
    }));
    window.__SPINE_AUTOCAL__=Object.freeze({version:VERSION,run,clear:clearResults,clearSession:clearImagingCalibrationSession,getResults:()=>({frontal:resultState.frontal,lateral:resultState.lateral}),analyzeFrontal,analyzeLateral,buildAnalysis,detectSpineCorridor,detectEndplateLine,prepareGuidePreview,getGuides:()=>resultState.guides,resultState,ui,renderResults,sourceQualityWarnings,
      startManual,recordManualPoint,skipManualPoint,undoManual,resetManual,manualValues,manual,MANUAL_SEQUENCES,
      refreshSupine,resetSupineLandmarks,flexibilityComparison,applyMeasuredFlexibility,renderFlexibility,
      detectLikelyHardware,HARDWARE_DETECTION_GATE,
      // Review, provenance and DICOM-header helpers (WP3).
      resultDefinitions,transferSelected,applySelected,provenanceRecord,imageQualityWarnings,buildReviewData,buildReviewBundle,measurementsText,copyMeasurements,downloadReview,
      plainDicomFailure,dicomPatientSpacing,applyDicomOrientation,displayedPatientOrientation,lateralConfidencesAfterOrientation,
      // The intake's selection-time DICOM decode, reused by staging and the run.
      primeDicomDecode,shareDicomDecode,
      // The overlay edit path (value re-derivation and the per-value reviewed floor).
      recomputeFrontalFromEdits,recomputeLateralFromEdits,
      // Neural deskew (NEURAL_DESKEW): the pass orchestration, its pieces, and
      // a one-file frontal path for measurement outside the staging flow.
      frontalNeuralPasses,frontalSpineAxis,spineAxisTilt,neuralDeskewInput,NEURAL_DESKEW,analyzeFrontalFile});
  }
  // One frontal file through the same neural passes as run(), without the
  // staging flow or DICOM header handling. {deskew:false} reproduces the
  // pre-deskew behaviour for before/after measurement.
  async function analyzeFrontalFile(file,opts={}){
    const ai=window.__SPINE_AI__;
    if(!ai||typeof ai.detectFrontal!=='function') throw new Error('the neural model is not embedded in this build');
    await ai.ensureLoaded();
    const raster=await rasterFromFile(file,{modelInput:true});
    if(!raster.modelInput) throw new Error('no model input was built');
    const A=buildAnalysis(raster);
    const neural=await ai.detectFrontal(raster.modelInput,{scaleX:A.width/raster.modelInput.width,scaleY:A.height/raster.modelInput.height});
    const passes=await frontalNeuralPasses(A,neural,{ai,scale:opts.scale==null?'':opts.scale,guides:null,deskew:opts.deskew!==false});
    if(!opts.keepModelInput){A.modelInput=null;A.modelSource=null;}
    passes.note=passes.result.engine===NEURAL_FRONTAL_ENGINE?frontalNeuralNote(passes.result):null;
    return passes;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
