    /* ---------------------------------------------------------------------
       6) READ-ONLY TEST SURFACE
       Stable names make numerical, hierarchy, and hardware assertions possible
       without coupling tests to presentation details.
    --------------------------------------------------------------------- */
    window.__SPINE_TEST__ = Object.freeze({
      MODEL_MANIFEST,
      REFERENCE_ATLAS_DATA,
      LOWER_LIMB_ATLAS_DATA,
      MODEL_SELF_TEST,
      LEVELS,
      SURGICAL_TARGETS,
      BODY_TARGETS,
      spannedSegmentIdsFor,
      consumedDiscSegmentIdsFor,
      spansOverlap,
      disruptsPosteriorTensionBand,
      findProcedureConflict,
      PROCEDURES,
      DEFORMITY_PRESETS,
      CASE_EXAMPLES,
      PATIENT_IMAGING_MODEL,
      IMPLANT_CATALOGS,
      PROCEDURE_IMPLANT_PROFILES,
      PROCEDURE_VISUALIZATION_CONTRACTS,
      IMPLANT_PLAN_SCHEMA_VERSION,
      CUSTOM_IMPLANT_DOMAINS,
      REFERENCE_MM_TO_SCENE,
      derivePelvicKinematicTargets,
      calculateBiomechanics,
      classifyModifiers,
      classifyCervicalModifiers,
      CONSTRUCT_TOPOLOGY_MODEL,
      deriveConstructTopology,
      derivePlannedFusionIntervals,
      computeFusionBoundarySegments,
      computeAdjacentMobileLevels,
      CONSTRUCT_EVIDENCE_SOURCES,
      CONSTRUCT_COMPARISON_MODEL,
      CONSTRUCT_TARGET_MODEL,
      deriveDeformityPhenotypes,
      derivePlanningTargets,
      deriveResidualDeficits,
      expandSuggestionPrerequisites,
      materializeSuggestedCandidate,
      planConstructComparisonBranch,
      computeConstructComparisons,
      stageConstructComparisonStep,
      applyConstructComparisonBranch,
      POSTOPERATIVE_SURVEILLANCE_MODEL,
      computePostoperativeSurveillance,
      runModelSelfTest,
      isProcedureCompatible,
      correctionPolicyFor,
      procedureThreePlanePolicyFor,
      computeThreePlaneScenario,
      THREE_PLANE_SCENARIO_MODEL,
      VERTEBRAL_PROFILES,
      CURVE_DISTRIBUTION,
      PATHOLOGY_VISUALIZATION,
      CORONAL_DISPLAY_PROFILES,
      normalizedRegionalCurveWeights,
      auditSceneStructure,
      updateReferenceLigamentContinuity,
      applyAnatomyPreset,
      resolveCaseExampleSeed,
      validateCaseExampleSeed,
      applyCaseExample,
      validatePatientImagingSelection,
      stagePatientImagingFromSession,
      applyImagingMeasurementsToModel,
      clearPatientImagingSession,
      getState: () => ({
        params: { ...state.params }, provenance: { ...state.provenance }, assumptions: { ...state.assumptions },
        globalDeformity: { ...state.globalDeformity },
        levelFactors: state.levelFactors instanceof Map
          ? Object.fromEntries([...state.levelFactors].map(([id, value]) => [id, { ...value }]))
          : Object.fromEntries(Object.entries(state.levelFactors || {}).map(([id, value]) => [id, { ...value }])),
        caseContext: {
          ...state.caseContext,
          featureTags: state.caseContext.featureTags.map(tag => ({ ...tag })),
          reportedContext: { ...state.caseContext.reportedContext },
          limitations: [...state.caseContext.limitations]
        },
        patientImaging: {
          ...state.patientImaging,
          sourceCounts: { ...(state.patientImaging.sourceCounts || {}) },
          sourceKinds: { ...(state.patientImaging.sourceKinds || {}) },
          coverage: [...(state.patientImaging.coverage || [])],
          capabilities: { ...(state.patientImaging.capabilities || {}) },
          appliedMeasurements: [...(state.patientImaging.appliedMeasurements || [])],
          // Per-key origin of the applied values, the case defaults left out,
          // and the review record's per-key source (copies, not live state).
          measurementSources: { ...(state.patientImaging.measurementSources || {}) },
          caseDefaultsNotApplied: [...(state.patientImaging.caseDefaultsNotApplied || [])],
          autoCalibration: state.patientImaging.autoCalibration
            ? { ...state.patientImaging.autoCalibration, perKeySource: { ...(state.patientImaging.autoCalibration.perKeySource || {}) } }
            : null
        },
        inspection: { ...state.inspection }, layers: { ...state.layers }, view: state.view,
        surveillance: {
          visible: state.surveillance.visible,
          selectedLevelId: state.surveillance.selectedLevelId,
          assessment: state.surveillance.assessment
        },
        constructComparisons: state.constructComparisons.map(option => ({
          ...option,
          steps: option.steps.map(step => ({ ...step })),
          branches: option.branches.map(branch => ({
            ...branch,
            steps: branch.steps.map(step => ({ ...step }))
          })),
          matchReasons: [...option.matchReasons],
          evidenceIds: [...option.evidenceIds],
          missingInputs: [...option.missingInputs]
        })),
        itinerary: state.itinerary.map(item => ({ ...item })), prediction: { ...state.prediction },
        threePlanePrediction: state.threePlanePrediction ? {
          ...state.threePlanePrediction,
          baseline: { ...state.threePlanePrediction.baseline },
          changes: { ...state.threePlanePrediction.changes },
          outputs: { ...state.threePlanePrediction.outputs },
          flexibility: { ...state.threePlanePrediction.flexibility }
        } : null
      }),
      getScene: () => scene,
      getCamera: () => camera,
      getControls: () => controls,
      getPelvis: () => pelvisGroup,
      getPelvicPosturePivot: () => pelvisPosturePivot,
      getSacralMorphologyRoot: () => sacralMorphologyRoot,
      getSacralMorphologyPivotAppMm: () => sacralMorphologyPivotAppMm.clone(),
      getSacralMorphologyPivotScene: () => sacralMorphologyPivotScene.clone(),
      getSacralReferenceSurface: () => sacralReferenceSurface,
      getPelvicIncidenceGuide: () => pelvicIncidenceGuide,
      getPelvicIncidenceRadiusLine: () => pelvicIncidenceRadiusLine,
      getPelvisReferenceLayer: () => pelvisReferenceLayer,
      getPelvicHardware: () => pelvicHardwareLayer,
      getSIJoints: () => siJointLayer,
      getPelvicLigaments: () => pelvisLigamentLayer,
      getLowerExtremities: () => lowerExtremityContext,
      getCoronalBalance: () => worldRoot?.userData?.coronalBalance || null,
      getInspectionRoot: () => inspectionRoot,
      getInspectionBounds: levelId => {
        const record = segmentRecords.get(levelId);
        return record ? visibleInspectionBoundsForRecord(record).clone() : null;
      },
      getPatientImagingSessionCounts: () => ({
        frontal: patientImagingSession.frontal ? 1 : 0,
        lateral: patientImagingSession.lateral ? 1 : 0,
        ct: patientImagingSession.ctFiles.length,
        previewUrls: patientImagingSession.previewUrls.size
      }),
      getSegments: () => new Map(segmentRecords),
      getReferenceAtlasDiagnostics: () => ({
        decoded: [...referenceAtlasDiagnostics.decoded],
        failures: Object.fromEntries(referenceAtlasDiagnostics.failures),
        cacheSize: referenceGeometryCache.size
      }),
      getLowerLimbAtlasDiagnostics: () => ({
        decoded: [...lowerLimbAtlasDiagnostics.decoded],
        failures: Object.fromEntries(lowerLimbAtlasDiagnostics.failures),
        cacheSize: lowerLimbGeometryCache.size,
        geometryMode: lowerExtremityContext?.userData?.geometryMode || 'not_initialized'
      }),
      setGlobalDeformity: patch => {
        if (!patch || typeof patch !== 'object') return false;
        state.globalDeformity = { ...state.globalDeformity, ...patch };
        state.threePlanePrediction = computeThreePlaneScenario(state.globalDeformity, state.itinerary, state.assumptions);
        applyModelTargets(true);
        return true;
      },
      setLevelFactor: (levelId, patch) => {
        if (!LEVEL_BY_ID.has(levelId) || !patch || typeof patch !== 'object') return false;
        if (state.levelFactors instanceof Map) state.levelFactors.set(levelId, { ...levelFactorFor(levelId), ...patch });
        else state.levelFactors[levelId] = { ...levelFactorFor(levelId), ...patch };
        applyModelTargets(true);
        return true;
      },
      buildImplantPlan,
      buildDefaultSuggestedImplantPlan,
      normalizeCustomImplantSelection,
      deriveCatalogCageHeights,
      implantPlanSummary,
      createHardware,
      createPelvicHardware,
      setView: view => setView(view, false),
      applyLayerVisibility,
      setLayerVisibility: patch => {
        if (!patch || typeof patch !== 'object') return { ...state.layers };
        Object.entries(patch).forEach(([key, value]) => {
          if (Object.prototype.hasOwnProperty.call(state.layers, key)) state.layers[key] = Boolean(value);
        });
        if (Object.prototype.hasOwnProperty.call(patch, 'lowerLimbs')) {
          state.globalDeformity.lowerExtremitiesVisible = state.layers.lowerLimbs;
        }
        updateSurgicalVisibility();
        return { ...state.layers };
      },
      zoomCameraByFactor,
      resetCameraView,
      frameVisibleAnatomy,
      getVisibleAnatomyBounds: includeLowerLimbs => visibleAnatomyBounds(includeLowerLimbs).clone(),
      getCameraFrameDiagnostics: () => camera?.userData?.lastAnatomyFrame
        ? {
            ...camera.userData.lastAnatomyFrame,
            center: [...camera.userData.lastAnatomyFrame.center],
            size: [...camera.userData.lastAnatomyFrame.size],
            boundsMin: [...camera.userData.lastAnatomyFrame.boundsMin],
            boundsMax: [...camera.userData.lastAnatomyFrame.boundsMax]
          }
        : null,
      applyPathologyTargets: () => applyPathologyTargets(true),
      setLowerExtremityVisibility,
      setInspectionSelection,
      exitInspectionMode,
      selectLevelAtClientPoint,
      updateScene: () => applyModelTargets(true),
      setGaitActive,
      getGaitState: () => ({ active: gait.active, phase: gait.phase, params: gait.params ? { ...gait.params } : null }),
      // Advances the walk cycle without the render loop, so gait can be verified
      // deterministically (and in environments where rAF never fires).
      stepGait: (deltaSeconds = 1 / 60) => { applyGaitTargets(deltaSeconds); return gait.phase; },
      renderNow: () => { if (renderer && scene && camera) renderer.render(scene, camera); },
      // Engine attribution helpers (wave A, WP6).
      correctionSharesFor,
      describeCorrectionMetricEffect,
      // Case history, case files and summary (WP5). The apply/undo entries
      // skip the replace-case confirmation, like applyCaseExample.
      CASE_FILE_SCHEMA,
      CASE_FILE_SCHEMA_VERSION,
      captureCaseSnapshot,
      buildCaseFileObject,
      parseCaseFile,
      loadCaseFileText: text => {
        const result = safeParseCaseFile(text);
        if (result.ok) result.clearedImaging = applyLoadedCase(result.snapshot);
        return { ok: result.ok, errors: [...result.errors], warnings: [...result.warnings], clearedImaging: result.clearedImaging === true };
      },
      buildCaseSummaryText,
      // Used by the guided demo (showcase.js): ask before replacing a dirty
      // case, keep it aside while the demo runs, and restore it on exit.
      confirmCaseReplacement: (label, options) => confirmCaseReplacement(label, options),
      captureCaseSession,
      restoreCaseSession,
      checkpointCaseHistory,
      undoCaseEdit,
      redoCaseEdit,
      getCaseHistory: () => ({
        undo: caseHistory.undo.length,
        redo: caseHistory.redo.length,
        pending: caseHistory.timer !== 0,
        dirty: caseHistory.baselineKey !== null && caseHistory.currentKey !== caseHistory.baselineKey
      }),
      beginProcedureEdit,
      cancelProcedureEdit,
      getProcedureEdit: () => ({ ...procedureEdit }),
      AGE_REFERENCE,
      CAMERA_VIEW_PRESETS,
      setCameraViewPreset: (preset, options = {}) => setCameraViewPreset(preset, { animate: false, announceChange: false, ...options }),
      getCameraViewPreset: () => cameraViewPreset,
      describeCameraOrientation
    });

    // Deterministic initial render sequence.
    syncCaseExamplePreview();
    syncPatientImagingControls();
    renderPatientImagingState();
    populateAnatomyLevelSelect();
    syncAnatomyLabControls();
    populateLevelSelect();
    populateProcedureSelect('alif');
    renderItinerary();
    refreshApplication();
    // The initial case is the first history entry and the "unchanged" baseline.
    checkpointCaseHistory();
    markCaseBaseline();
    syncLegendLayers();
    initializeThree();
  

(function(){
  function initUiFlowRefinement(){
    const appShell = document.querySelector('.app-shell');
    const patientPanel = document.getElementById('patientParameters');
    const itineraryPanel = document.getElementById('surgicalItinerary');
    const workflowLinks = Array.from(document.querySelectorAll('.workflow-nav a[data-step]'));
    const targets = {
      '1': document.getElementById('patientParameters'),
      '2': document.getElementById('viewport'),
      '3': document.getElementById('surgicalItinerary')
    };
    if (!appShell || !patientPanel || !itineraryPanel || !workflowLinks.length) return;

    function setPanelTab(panel, tab){
      if (!panel) return;
      panel.dataset.panelTab = tab;
      panel.querySelectorAll('.panel-tab').forEach((btn)=>{
        const active = btn.dataset.tab === tab;
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        // Roving tabindex: Tab reaches the selected tab only; arrows move (F114).
        btn.setAttribute('tabindex', active ? '0' : '-1');
      });
    }

    function setWorkflowStep(step, opts){
      // syncTabs:false keeps the current panel tab - used by the resize handler,
      // which must not move the user off the control they are editing.
      const options = Object.assign({scroll: true, syncTabs: true}, opts || {});
      appShell.dataset.workflowStep = step;
      workflowLinks.forEach((link)=>{
        const active = link.dataset.step === step;
        if (active) link.setAttribute('aria-current','step');
        else link.removeAttribute('aria-current');
      });
      if (options.syncTabs) {
        if (step === '1') {
          setPanelTab(patientPanel, patientPanel.dataset.panelTab || 'cases');
        }
        if (step === '2') {
          setPanelTab(itineraryPanel, 'review');
        }
        if (step === '3') {
          setPanelTab(itineraryPanel, 'build');
        }
      }
      const target = targets[step];
      if (options.scroll && target) {
        const block = window.matchMedia('(max-width: 980px)').matches ? 'start' : 'nearest';
        target.scrollIntoView({behavior:'smooth', block});
      }
    }

    workflowLinks.forEach((link)=>{
      link.addEventListener('click', (event)=>{
        event.preventDefault();
        setWorkflowStep(link.dataset.step);
      });
    });

    document.querySelectorAll('.panel-tab').forEach((button)=>{
      button.addEventListener('click', ()=>{
        const targetPanel = button.dataset.panelTarget === 'patient' ? patientPanel : itineraryPanel;
        setPanelTab(targetPanel, button.dataset.tab);
      });
      // WAI-ARIA tabs pattern: Left/Right (wrapping), Home and End select and
      // focus a sibling tab.
      button.addEventListener('keydown', (event)=>{
        const tabs = Array.from(button.closest('[role="tablist"]')?.querySelectorAll('.panel-tab') || []);
        const index = tabs.indexOf(button);
        if (index < 0) return;
        const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
          : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
          : event.key === 'Home' ? tabs[0]
          : event.key === 'End' ? tabs[tabs.length - 1]
          : null;
        if (!next) return;
        event.preventDefault();
        next.click();
        next.focus();
      });
    });

    /* The Pre-Op / Modeled Post-Op switch only moves the workflow forward from
       step 1, and never changes the panel tab: pressing it while building a
       procedure used to jump to step 2 and hide the procedure form (F100). */
    const preButton = document.getElementById('preViewButton');
    const postButton = document.getElementById('postViewButton');
    const advanceFromCaseStep = ()=>{
      if ((appShell.dataset.workflowStep || '1') === '1') setWorkflowStep('2', {scroll: false, syncTabs: false});
    };
    if (preButton && postButton) {
      preButton.addEventListener('click', advanceFromCaseStep);
      postButton.addEventListener('click', advanceFromCaseStep);
    }

    window.addEventListener('resize', ()=>{
      // Keep step state consistent after a breakpoint change, but never re-pick
      // the panel tab: on a phone the soft keyboard fires resize, and switching
      // tabs mid-entry hides the field being typed into.
      const current = appShell.dataset.workflowStep || '1';
      setWorkflowStep(current, {scroll: false, syncTabs: false});
    });

    setPanelTab(patientPanel, patientPanel.dataset.panelTab || 'cases');
    setPanelTab(itineraryPanel, itineraryPanel.dataset.panelTab || 'build');
    setWorkflowStep(appShell.dataset.workflowStep || '1', {scroll: false});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUiFlowRefinement);
  else initUiFlowRefinement();
})();



(function(){
  function initPremiumGuidedUi(){
    const appShell = document.querySelector('.app-shell');
    const patientPanel = document.getElementById('patientParameters');
    const itineraryPanel = document.getElementById('surgicalItinerary');
    const viewport = document.getElementById('viewport');
    if (!appShell || !patientPanel || !itineraryPanel || !viewport) return;

    const workflowLinks = Array.from(document.querySelectorAll('.workflow-nav a[data-step]'));
    const contexts = {
      '1': {
        eyebrow: 'Step 1 of 3',
        title: 'Define the case',
        description: 'Enter the measurements that drive the reference scenario. Advanced three-plane inputs remain available without crowding the primary workflow.'
      },
      '2': {
        eyebrow: 'Step 2 of 3',
        title: 'Inspect anatomy and modeled alignment',
        description: 'Rotate the reference anatomy, compare pre-op and modeled post-op states, and review the currently authored alignment outputs.'
      },
      '3': {
        eyebrow: 'Step 3 of 3',
        title: 'Author the procedure scenario',
        description: 'Choose a level and procedure, declare correction assumptions, add the construct, then review the modeled output and validation gates.'
      }
    };

    function clickWorkflowStep(step){
      const link = workflowLinks.find(item => item.dataset.step === String(step));
      if (link) link.click();
    }

    function clickPanelTab(panel, tab){
      const button = panel.querySelector(`.panel-tab[data-tab="${tab}"]`);
      if (button) button.click();
    }

    function createCardHead(title, description, chip){
      const head = document.createElement('div');
      head.className = 'guided-card-head';
      const copy = document.createElement('div');
      copy.innerHTML = `<h3>${title}</h3><p>${description}</p>`;
      const tag = document.createElement('span');
      tag.className = 'guided-step-chip';
      tag.textContent = chip;
      head.append(copy, tag);
      return head;
    }

    function organizeCasePanel(){
      if (patientPanel.querySelector('.guided-case-core')) return;
      const tabs = patientPanel.querySelector('.panel-tabs');
      const kicker = patientPanel.querySelector('.section-kicker');
      const parameterList = patientPanel.querySelector('.parameter-list');
      const derived = patientPanel.querySelector('.derived-strip');
      const measured = patientPanel.querySelector('.measured-sva-field');
      const threePlane = patientPanel.querySelector('.three-plane-case');
      if (!tabs || !kicker || !parameterList || !derived || !measured || !threePlane) return;

      const core = document.createElement('section');
      core.className = 'guided-card guided-case-core';
      core.append(createCardHead('Core alignment profile', 'Primary sagittal measurements used by the scenario engine.', 'Required'));
      tabs.insertAdjacentElement('afterend', core);
      core.append(kicker, parameterList, derived);

      const advanced = document.createElement('details');
      advanced.className = 'guided-disclosure guided-advanced-inputs';
      const summary = document.createElement('summary');
      summary.innerHTML = '<span class="disclosure-copy"><strong>Additional measurements</strong><span>Measured SVA, optional age reference, and coronal/axial scenario inputs</span></span>';
      const content = document.createElement('div');
      content.className = 'guided-disclosure-content';
      advanced.append(summary, content);
      core.insertAdjacentElement('afterend', advanced);
      // The optional age reference travels with measured SVA (display only).
      const ageField = patientPanel.querySelector('.age-reference-field');
      content.append(measured, ...(ageField ? [ageField] : []), threePlane);

      const anyAdvancedValue = () => {
        const values = [
          document.getElementById('primaryCobbInput')?.value,
          document.getElementById('compensatoryCobbInput')?.value,
          document.getElementById('apicalTranslationInput')?.value,
          document.getElementById('primaryAxialRotationInput')?.value
        ].map(Number);
        return Boolean(document.getElementById('measuredSvaInput')?.value) || Boolean(document.getElementById('ageInput')?.value)
          || values.some(value => Number.isFinite(value) && value !== 0);
      };
      advanced.open = anyAdvancedValue();

      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'guided-panel-cta';
      cta.innerHTML = '<span>Continue to anatomy review</span><small>Step 2 →</small>';
      cta.addEventListener('click', () => clickWorkflowStep('2'));
      advanced.insertAdjacentElement('afterend', cta);

      // Loaded examples, case files and undo/redo all replace the case; the
      // disclosure follows the values they bring (a cancelled reset no longer
      // collapses it).
      document.addEventListener('spine:case-restored', () => { advanced.open = anyAdvancedValue(); updateContext(); });
    }

    function organizeProcedurePanel(){
      const form = document.getElementById('procedureForm');
      if (!form || form.querySelector('.guided-procedure-core')) return;
      const levelField = document.getElementById('levelSelect')?.closest('.form-field');
      const procedureField = document.getElementById('procedureSelect')?.closest('.form-field');
      const compatibility = document.getElementById('compatibilityCopy');
      const impact = document.getElementById('impactPreview');
      if (!levelField || !procedureField || !compatibility || !impact) return;

      const core = document.createElement('section');
      core.className = 'guided-card guided-procedure-core';
      core.append(createCardHead('Procedure essentials', 'Select the target and operation before refining correction or implant dimensions.', 'Start here'));
      form.insertBefore(core, levelField);
      core.append(levelField, procedureField, compatibility, impact);

      const list = document.getElementById('itineraryList');
      if (list && !document.querySelector('#reviewOutputCta')) {
        const cta = document.createElement('button');
        cta.type = 'button';
        cta.id = 'reviewOutputCta';
        cta.className = 'guided-panel-cta';
        cta.innerHTML = '<span>Review modeled output</span><small>Results →</small>';
        cta.addEventListener('click', () => clickPanelTab(itineraryPanel, 'review'));
        list.insertAdjacentElement('afterend', cta);
      }
    }

    function wrapReviewSection(section, title, countElement){
      if (!section || section.parentElement?.classList.contains('review-disclosure')) return;
      const details = document.createElement('details');
      details.className = 'review-disclosure';
      const summary = document.createElement('summary');
      const meta = document.createElement('span');
      meta.className = 'review-summary-meta';
      const label = document.createElement('span');
      label.textContent = title;
      meta.append(label);
      if (countElement) {
        const count = document.createElement('span');
        count.className = 'count-badge review-count-copy';
        count.textContent = countElement.textContent || '0';
        meta.append(count);
        const observer = new MutationObserver(() => { count.textContent = countElement.textContent || '0'; });
        observer.observe(countElement, { childList: true, characterData: true, subtree: true });
      }
      summary.append(meta);
      section.insertAdjacentElement('beforebegin', details);
      details.append(summary, section);
    }

    function organizeReviewPanel(){
      wrapReviewSection(document.querySelector('.surveillance-card'), 'Post-op construct review', document.getElementById('surveillanceCount'));
      wrapReviewSection(document.querySelector('.mechanics-card'), 'Mechanics and validation gate', null);
    }

    /* Keep the bottom bar clear of the guided CTA, which is pinned to the same
       corner at a higher z-index and was painting straight over the interaction
       hint. A zero width means the CTA is hidden (step 3) or display:none
       (mobile), and the reserve collapses. Declared out here because it is set
       up in organizeViewportToolbar but called from updateContext. */
    function syncViewportCtaSpace(){
      const bottom = document.querySelector('.viewport-bottom');
      if (!bottom) return;
      const cta = document.querySelector('#viewportContinueCta');
      const width = cta && !cta.hidden ? Math.ceil(cta.getBoundingClientRect().width) : 0;
      bottom.style.setProperty('--viewport-cta-space', width > 0 ? `${width + 12}px` : '0px');
    }

    function organizeViewportToolbar(){
      const actions = viewport.querySelector('.viewport-actions');
      if (!actions || document.querySelector('#viewportMoreButton')) return;
      const wrap = document.createElement('div');
      wrap.className = 'viewport-more-wrap';
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'viewportMoreButton';
      button.className = 'viewport-action-button';
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = '<span aria-hidden="true">•••</span> More';
      const menu = document.createElement('div');
      menu.className = 'viewport-more-menu';
      menu.hidden = true;
      wrap.append(button, menu);
      actions.append(wrap);
      ['toggleSurveillance', 'resetCamera', 'toggleLegend'].forEach(id => {
        const item = document.getElementById(id);
        if (item) menu.append(item);
      });
      const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
      button.addEventListener('click', event => {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
        button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
        /* Both popovers hang off the same toolbar corner and the layers panel
           is the taller of the two, so opening this menu on top of it buried
           its first few anatomy checkboxes. One popover at a time. */
        if (!menu.hidden) {
          const layers = document.getElementById('layerPanel');
          if (layers && !layers.hidden) {
            layers.hidden = true;
            document.getElementById('toggleLayers')?.setAttribute('aria-expanded', 'false');
            document.body.dataset.layersOpen = 'false';
          }
        }
      });
      menu.addEventListener('click', event => event.stopPropagation());
      document.addEventListener('click', close);
      document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

      window.addEventListener('resize', syncViewportCtaSpace, { passive: true });

      if (!document.querySelector('#viewportContinueCta')) {
        const cta = document.createElement('button');
        cta.type = 'button';
        cta.id = 'viewportContinueCta';
        cta.className = 'viewport-guided-cta';
        cta.innerHTML = '<span>Build procedure</span><span aria-hidden="true">→</span>';
        cta.addEventListener('click', () => {
          const step = appShell.dataset.workflowStep || '1';
          clickWorkflowStep(step === '1' ? '2' : '3');
        });
        viewport.append(cta);
      }
    }

    /* Below 980px only one workflow region is on screen at a time, so one of the
       two skip links always points at a display:none element — and the dead one
       is frequently the first thing keyboard focus reaches on load. Send the
       user to the step that owns the target rather than to a fragment that
       cannot be scrolled to. */
    function wireSkipLinks(){
      const owningStep = { patientParameters: '1', viewport: '2' };
      document.querySelectorAll('.skip-link[href^="#"]').forEach(link => {
        link.addEventListener('click', event => {
          const id = link.getAttribute('href').slice(1);
          const target = document.getElementById(id);
          if (!target) return;
          if (window.getComputedStyle(target).display !== 'none') return;
          event.preventDefault();
          const step = owningStep[id];
          if (step) document.querySelector(`.workflow-nav a[data-step="${step}"]`)?.click();
          window.requestAnimationFrame(() => {
            target.scrollIntoView({ block: 'start' });
            // The case panel is a plain <aside>; without this focus() no-ops and
            // the keyboard user is left where they started.
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
          });
        });
      });
    }

    /* The phone layout hands the viewport whatever the chrome leaves instead of
       a dvh slice, so something has to know how tall the chrome actually is.
       Hardcoding it does not survive a wrapped header, a different safe-area
       inset, or the step-context disclosure being open, so it is measured. The
       property is written at every width and only consumed inside the stacked
       media query, which keeps the wider layouts out of it entirely. */
    let lastPhoneChrome = null;
    let lastStickyNav = null;
    function syncPhoneChrome(){
      const total = ['.app-header', '.workflow-nav', '.step-context-bar', '.mobile-flow-bar']
        .reduce((sum, selector) => {
          const node = document.querySelector(selector);
          if (!node) return sum;
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return sum;
          return sum + node.getBoundingClientRect().height;
        }, 0);
      const next = `${Math.round(total)}px`;
      // The sticky workflow nav covers whatever is scrolled to block:start on
      // phones; its height feeds scroll-margin-top on the step targets (F102).
      const nav = document.querySelector('.workflow-nav');
      const navStyle = nav ? window.getComputedStyle(nav) : null;
      const stickyNav = navStyle && navStyle.position === 'sticky' && navStyle.display !== 'none'
        ? `${Math.round(nav.getBoundingClientRect().height)}px`
        : '0px';
      if (stickyNav !== lastStickyNav) {
        lastStickyNav = stickyNav;
        document.documentElement.style.setProperty('--sticky-nav-h', stickyNav);
      }
      // updateContext calls this on every metric change, and a metric changes on
      // every frame of a slider drag. Writing a custom property invalidates style
      // document-wide, so only write when the value actually moved.
      if (next === lastPhoneChrome) return;
      lastPhoneChrome = next;
      document.documentElement.style.setProperty('--phone-chrome', next);
    }

    /* The demo lower-third is fixed and opaque and its height moves with the
       caption text, so the shell has to reserve the measured value rather than a
       constant. Zero when the tour is not running, which makes the reserve in
       the stylesheet a no-op the rest of the time. */
    let lastDemoBarHeight = null;
    function syncDemoBarHeight(){
      const bar = document.querySelector('.demo-bar');
      const live = bar && !bar.hidden && window.getComputedStyle(bar).display !== 'none';
      const next = live ? `${Math.round(bar.getBoundingClientRect().height)}px` : '0px';
      if (next === lastDemoBarHeight) return;
      lastDemoBarHeight = next;
      document.documentElement.style.setProperty('--demo-bar-h', next);
    }

    /* Collapsing the step strip to one row costs the step title and description
       their place on screen. The description had already been display:none at
       this width, so it would have been lost for good — this puts it one tap
       away instead, and the strip collapses to its heading the same way the
       gait readout does rather than to an unlabelled icon. */
    function createStepContextToggle(){
      const bar = document.querySelector('.step-context-bar');
      if (!bar || bar.querySelector('.step-context-toggle')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'stepContextToggle';
      button.className = 'step-context-toggle';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'stepContextCopy');
      /* This label is the step heading on phones, where the copy it stands in
         for is collapsed and therefore silent. It changes only on a step
         transition, so it is the right granularity for a live region — unlike
         the strip as a whole, which also holds metrics that churn per frame. */
      button.innerHTML = '<span id="stepContextToggleLabel" aria-live="polite">Define the case</span>';
      bar.dataset.expanded = 'false';
      bar.prepend(button);
      button.addEventListener('click', () => {
        const expanded = bar.dataset.expanded !== 'true';
        bar.dataset.expanded = expanded ? 'true' : 'false';
        button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        // The strip just changed height, so the viewport's share changed with it.
        syncPhoneChrome();
      });
    }

    function createMobileFlowBar(){
      if (document.querySelector('.mobile-flow-bar')) return;
      const bar = document.createElement('nav');
      bar.className = 'mobile-flow-bar';
      bar.setAttribute('aria-label', 'Guided workflow controls');
      bar.innerHTML = `
        <button type="button" class="mobile-flow-button" id="mobileFlowBack">Back</button>
        <div class="mobile-flow-status"><small id="mobileFlowStep">Step 1 of 3</small><strong id="mobileFlowTitle">Case inputs</strong></div>
        <button type="button" class="mobile-flow-button primary" id="mobileFlowNext">Review anatomy</button>`;
      document.body.append(bar);
      document.getElementById('mobileFlowBack')?.addEventListener('click', () => {
        const step = appShell.dataset.workflowStep || '1';
        const tab = itineraryPanel.dataset.panelTab || 'build';
        if (step === '3' && tab === 'review') clickPanelTab(itineraryPanel, 'build');
        else if (step === '3') clickWorkflowStep('2');
        else if (step === '2') clickWorkflowStep('1');
      });
      document.getElementById('mobileFlowNext')?.addEventListener('click', () => {
        const step = appShell.dataset.workflowStep || '1';
        const tab = itineraryPanel.dataset.panelTab || 'build';
        if (step === '1') clickWorkflowStep('2');
        else if (step === '2') clickWorkflowStep('3');
        else if (step === '3' && tab === 'build') clickPanelTab(itineraryPanel, 'review');
      });
    }

    function updateContext(){
      const step = appShell.dataset.workflowStep || '1';
      const context = contexts[step] || contexts['1'];
      const eyebrow = document.getElementById('stepContextEyebrow');
      const title = document.getElementById('stepContextTitle');
      const description = document.getElementById('stepContextDescription');
      // Writing identical text still mutates the node, which re-fires the live
      // region and every observer watching it. updateContext runs on each input
      // event of a slider drag, so the no-op guard is not cosmetic.
      const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
      setText(eyebrow, context.eyebrow);
      setText(title, context.title);
      setText(description, context.description);

      const mismatch = document.getElementById('metricMismatch')?.textContent?.trim() || '—';
      // The committed value, not the field text: an out-of-range entry used to
      // show here while the model held the last valid value (F098).
      const cobb = Math.abs(Number(state.globalDeformity?.coronalMagnitude) || 0);
      const procedures = document.getElementById('procedureCount')?.textContent?.trim() || '0';
      // Echoes the header card the phone layout hides; same source, so the two
      // cannot disagree.
      const sva = document.getElementById('metricSva')?.textContent?.trim() || '—';
      setText(document.getElementById('contextSva'), sva);
      setText(document.getElementById('contextMismatch'), mismatch);
      setText(document.getElementById('contextCobb'), `${Number.isFinite(cobb) ? cobb : 0}°`);
      setText(document.getElementById('contextProcedures'), procedures);
      const suggestionCount = Number(document.getElementById('constructComparisonCount')?.textContent) || 0;
      const suggestionJump = document.getElementById('contextSuggestionsJump');
      if (suggestionJump) {
        suggestionJump.hidden = suggestionCount === 0;
        const suggestionValue = document.getElementById('contextSuggestions');
        if (suggestionValue) suggestionValue.textContent = String(suggestionCount);
      }

      const back = document.getElementById('mobileFlowBack');
      const next = document.getElementById('mobileFlowNext');
      const flowStep = document.getElementById('mobileFlowStep');
      const flowTitle = document.getElementById('mobileFlowTitle');
      const tab = itineraryPanel.dataset.panelTab || 'build';
      const itineraryHeading = document.getElementById('itineraryHeading');
      const itinerarySubtitle = itineraryHeading?.parentElement?.querySelector('p');
      if (itineraryHeading) itineraryHeading.textContent = tab === 'review' ? 'Modeled output' : 'Procedure scenario';
      if (itinerarySubtitle) itinerarySubtitle.textContent = tab === 'review' ? 'Alignment summary, construct review, and validation gates' : 'Level-specific modeled correction & hardware';
      const viewportCta = document.querySelector('#viewportContinueCta');
      if (viewportCta) {
        viewportCta.hidden = step === '3';
        viewportCta.innerHTML = step === '1'
          ? '<span>Review anatomy</span><span aria-hidden="true">→</span>'
          : '<span>Build procedure</span><span aria-hidden="true">→</span>';
      }
      syncViewportCtaSpace();
      if (step === '3' && tab === 'review') {
        setText(title, 'Review the modeled output');
        setText(description, 'Inspect the alignment summary, construct boundaries, and validation gates without changing the authored scenario.');
      }
      // The phone strip collapses to this heading, so it has to be read after
      // the step-3 review override above rather than from the context table.
      if (title) setText(document.getElementById('stepContextToggleLabel'), title.textContent);
      if (flowStep) flowStep.textContent = context.eyebrow;
      if (flowTitle) flowTitle.textContent = step === '1' ? 'Case inputs' : step === '2' ? 'Review anatomy' : tab === 'review' ? 'Review output' : 'Build procedure';
      if (back) {
        back.disabled = step === '1';
        back.textContent = step === '3' && tab === 'review' ? 'Edit' : 'Back';
      }
      if (next) {
        next.disabled = step === '3' && tab === 'review';
        next.textContent = step === '1' ? 'Review anatomy' : step === '2' ? 'Build procedure' : tab === 'build' ? 'Review output' : 'Complete';
      }
      // A step change rewrites the strip and the flow bar; re-measure now rather
      // than waiting a frame for the observer, so the viewport never flashes at
      // the previous step's height.
      syncPhoneChrome();
    }

    organizeCasePanel();
    organizeProcedurePanel();
    organizeReviewPanel();
    organizeViewportToolbar();
    createStepContextToggle();
    createMobileFlowBar();
    wireSkipLinks();

    /* Font loading, a rotation, or immersive mode being toggled all change the
       chrome height without a step change, and the viewport is sized off it —
       so watch the bars themselves rather than only the events that usually
       move them. */
    const syncChrome = () => { syncPhoneChrome(); syncDemoBarHeight(); };
    syncChrome();
    window.addEventListener('resize', syncChrome, { passive: true });
    window.addEventListener('orientationchange', syncChrome, { passive: true });
    if (typeof ResizeObserver === 'function') {
      const chromeObserver = new ResizeObserver(syncChrome);
      ['.app-header', '.workflow-nav', '.step-context-bar', '.mobile-flow-bar']
        .forEach(selector => {
          const node = document.querySelector(selector);
          if (node) chromeObserver.observe(node);
        });
      /* The demo bar is appended by a later script and its height changes with
         each chapter's caption, so it is watched as it appears rather than
         looked up once. */
      const demoObserver = new ResizeObserver(syncDemoBarHeight);
      const attachDemoBar = () => {
        const bar = document.querySelector('.demo-bar');
        if (bar) { demoObserver.observe(bar); return true; }
        return false;
      };
      if (!attachDemoBar()) {
        const wait = new MutationObserver(() => { if (attachDemoBar()) wait.disconnect(); });
        wait.observe(document.body, { childList: true });
      }
    }
    new MutationObserver(syncChrome)
      .observe(document.body, { attributes: true, attributeFilter: ['data-immersive', 'data-demo-active'] });

    const stateObserver = new MutationObserver(updateContext);
    stateObserver.observe(appShell, { attributes: true, attributeFilter: ['data-workflow-step'] });
    stateObserver.observe(itineraryPanel, { attributes: true, attributeFilter: ['data-panel-tab'] });
    ['metricMismatch', 'metricSva', 'procedureCount', 'constructComparisonCount'].forEach(id => {
      const node = document.getElementById(id);
      if (node) stateObserver.observe(node, { childList: true, characterData: true, subtree: true });
    });
    ['primaryCobbInput', 'measuredSvaInput'].forEach(id => document.getElementById(id)?.addEventListener('input', updateContext));
    document.addEventListener('spine:case-restored', updateContext);
    document.getElementById('contextSuggestionsJump')?.addEventListener('click', () => {
      clickWorkflowStep('3');
      clickPanelTab(itineraryPanel, 'build');
      const card = itineraryPanel.querySelector('.construct-comparison-card');
      if (card) {
        card.open = true;
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    /* Everything updateContext owns is step-dependent — the step-context copy,
       the mobile flow bar, and the guided CTA's label and hidden state — but it
       only ever ran once at init, so all of it froze at its step-1 values the
       moment the user navigated. That is why the CTA kept saying "Review
       anatomy" and stayed painted at step 3, on top of the interaction hint.

       setWorkflowStep lives in a different scope and cannot call in here, so
       watch the attribute it writes instead of coupling the two. */
    new MutationObserver(() => updateContext())
      .observe(appShell, { attributes: true, attributeFilter: ['data-workflow-step'] });
    updateContext();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPremiumGuidedUi);
  else initPremiumGuidedUi();
})();

