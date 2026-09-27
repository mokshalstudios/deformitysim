    /* ---------------------------------------------------------------------
       3) APPLICATION STATE & DOM BINDINGS
    --------------------------------------------------------------------- */
    const state = {
      params: { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22, measuredSva: null },
      provenance: { measuredSva: 'not_provided' },
      // Reciprocal thoracic response defaults ON. Thoracic kyphosis increasing
      // as lumbar lordosis is restored is a documented reciprocal change, and
      // the pelvic half of the same response is already applied unconditionally
      // — leaving the thoracic half opt-in modelled a spine that gains lordosis
      // with a rigid thorax, which is the less realistic of the two states.
      assumptions: { applyReciprocalResponse: true, applyCoronalCompensation: false },
      editorCorrectionSource: 'procedure_default_assumption',
      editorComparisonPrefill: null,
      view: 'pre',
      itinerary: [],
      globalDeformity: createDefaultGlobalDeformity(),
      levelFactors: createDefaultLevelFactors(),
      caseContext: { exampleId: null, label: null, featureTags: [], reportedContext: {}, limitations: [] },
      // Optional age for the display-only Lafage 2016 reference bands. It feeds
      // no model output, modifier or suggestion.
      demographics: { ageYears: null },
      patientImaging: {
        status: 'none', path: null, privacyMode: PATIENT_IMAGING_MODEL.privacyMode,
        sourceCounts: { frontal: 0, lateral: 0, ct: 0 }, totalBytes: 0,
        representation: 'atlas_reference', geometryReady: false, alignmentReady: false,
        qaStatus: 'not_started', appliedToGeometry: false, alignmentApplied: false,
        measurementSource: null, appliedMeasurements: []
      },
      constructComparisons: [],
      inspection: { levelId: 'L4-L5', scope: 'level', explode: false, active: false },
      surveillance: { visible: true, selectedLevelId: null, assessment: null },
      layers: {
        skull: true, cervical: true, thoracic: true, lumbar: true, pelvis: true, lowerLimbs: true,
        discs: true, ligaments: false, siJoints: false, measurements: false, implants: true
      },
      prediction: null,
      threePlanePrediction: null,
      predictionError: null
    };
    let nextProcedureId = 1;
    let toastTimer = 0;
    let sceneReady = false;

    const $ = id => document.getElementById(id);
    const els = {
      metricMismatch: $('metricMismatch'), metricSva: $('metricSva'), metricSvaContext: $('metricSvaContext'), modifierBands: $('modifierBands'),
      headerViewLabel: $('headerViewLabel'), sacralSlope: $('sacralSlope'),
      levelSelect: $('levelSelect'), procedureSelect: $('procedureSelect'), compatibilityCopy: $('compatibilityCopy'),
      impactPreview: $('impactPreview'), correctionInput: $('correctionInput'), coronalCorrectionInput: $('coronalCorrectionInput'), axialCorrectionInput: $('axialCorrectionInput'), translationCorrectionInput: $('translationCorrectionInput'), procedureForm: $('procedureForm'), procedureError: $('procedureError'),
      itineraryList: $('itineraryList'), procedureCount: $('procedureCount'), viewSwitch: $('viewSwitch'),
      constructComparisonCount: $('constructComparisonCount'), constructComparisonSummary: $('constructComparisonSummary'), constructComparisonList: $('constructComparisonList'),
      preViewButton: $('preViewButton'), postViewButton: $('postViewButton'), modeChip: $('modeChip'),
      measuredSvaInput: $('measuredSvaInput'), reciprocalAssumptionInput: $('reciprocalAssumptionInput'),
      primaryCobbInput: $('primaryCobbInput'), primaryCurveDirection: $('primaryCurveDirection'), compensatoryCobbInput: $('compensatoryCobbInput'), apicalTranslationInput: $('apicalTranslationInput'), primaryAxialRotationInput: $('primaryAxialRotationInput'), coronalCompensationInput: $('coronalCompensationInput'), secondaryFlexibilityInput: $('secondaryFlexibilityInput'), secondaryFlexibilityValue: $('secondaryFlexibilityValue'),
      editScenarioButton: $('editScenarioButton'),
      shapeChip: $('shapeChip'), geometryChip: $('geometryChip'), mechanicsAdjacent: $('mechanicsAdjacent'), mechanicsLigaments: $('mechanicsLigaments'), mechanicsStress: $('mechanicsStress'),
      canvasDescription: $('canvasDescription'), loadingState: $('loadingState'), canvasError: $('canvasError'),
      c7Label: $('c7Label'), plumbLabel: $('plumbLabel'),
      toggleSurveillance: $('toggleSurveillance'), surveillanceToggleCount: $('surveillanceToggleCount'),
      surveillanceMarkerLayer: $('surveillanceMarkerLayer'), surveillanceInspector: $('surveillanceInspector'),
      surveillanceInspectorHeading: $('surveillanceInspectorHeading'), surveillanceInspectorSubtitle: $('surveillanceInspectorSubtitle'),
      surveillanceFactorList: $('surveillanceFactorList'), surveillanceUnknowns: $('surveillanceUnknowns'),
      closeSurveillanceInspector: $('closeSurveillanceInspector'), inspectSurveillanceLevel: $('inspectSurveillanceLevel'),
      surveillanceCount: $('surveillanceCount'), surveillanceSummary: $('surveillanceSummary'), surveillanceLevelList: $('surveillanceLevelList'),
      toggleImplantDetails: $('toggleImplantDetails'),
      toast: $('toast'), liveRegion: $('liveRegion'), interactionHint: $('interactionHint')
    };

    const implantEls = {
      config: $('implantConfig'), catalogLabel: $('implantCatalogLabel'), disclosure: $('implantDisclosure'),
      catalogFields: $('catalogImplantFields'), customMode: $('customImplantMode'), customModeField: $('customImplantModeField'),
      supplementalPosterior: $('includePosteriorFixation'), supplementalPosteriorField: $('supplementalPosteriorField'), supplementalPosteriorNote: $('supplementalPosteriorNote'),
      customFields: $('customImplantFields'), customLabel: $('customImplantLabel'),
      cageCatalog: $('cageCatalogSelect'), cageCatalogField: $('cageCatalogField'),
      cageFootprint: $('cageFootprintSelect'), cageFootprintField: $('cageFootprintField'),
      cageHeight: $('cageHeightSelect'), cageHeightField: $('cageHeightField'),
      cageLordosis: $('cageLordosisSelect'), cageLordosisField: $('cageLordosisField'),
      topsIpd: $('topsIpdSelect'), topsIpdField: $('topsIpdField'),
      topsPlateLength: $('topsPlateLengthSelect'), topsPlateLengthField: $('topsPlateLengthField'),
      screwDiameter: $('screwDiameterSelect'), screwDiameterField: $('screwDiameterField'),
      screwLength: $('screwLengthSelect'), screwLengthField: $('screwLengthField'),
      rodDiameter: $('rodDiameterSelect'), rodDiameterField: $('rodDiameterField'),
      rodLength: $('rodLengthSelect'), rodLengthField: $('rodLengthField'),
      graftFamily: $('graftFamilySelect'), graftFamilyField: $('graftFamilyField'),
      graftVolume: $('graftVolumeSelect'), graftVolumeField: $('graftVolumeField'),
      customCageAp: $('customCageAp'), customCageApField: $('customCageApField'),
      customCageMl: $('customCageMl'), customCageMlField: $('customCageMlField'),
      customCageAnterior: $('customCageAnterior'), customCageAnteriorField: $('customCageAnteriorField'),
      customCagePosterior: $('customCagePosterior'), customCagePosteriorField: $('customCagePosteriorField'),
      customScrewDiameter: $('customScrewDiameter'), customScrewDiameterField: $('customScrewDiameterField'),
      customScrewLength: $('customScrewLength'), customScrewLengthField: $('customScrewLengthField'),
      customRodDiameter: $('customRodDiameter'), customRodDiameterField: $('customRodDiameterField'),
      customRodLength: $('customRodLength'), customRodLengthField: $('customRodLengthField'),
      customGraftLabel: $('customGraftLabel'), customGraftLabelField: $('customGraftLabelField'),
      customGraftVolume: $('customGraftVolume'), customGraftVolumeField: $('customGraftVolumeField')
    };

    const layerEls = {
      toggle: $('toggleLayers'), panel: $('layerPanel'),
      skull: $('layerSkull'), cervical: $('layerCervical'), thoracic: $('layerThoracic'),
      lumbar: $('layerLumbar'), pelvis: $('layerPelvis'), lowerLimbs: $('layerLowerLimbs'),
      discs: $('layerDiscs'), ligaments: $('layerLigaments'),
      siJoints: $('layerSiJoints'), measurements: $('layerMeasurements'), implants: $('layerImplants')
    };

    const demoEls = {
      select: $('demoCaseSelect'), description: $('demoCaseDescription'),
      load: $('scanButton'), loadText: $('scanButtonText'), reset: $('resetScenario'),
      openImaging: $('openPatientImaging'), imagingSummary: $('patientImagingSummary')
    };

    const imagingEls = {
      dialog: $('patientImagingDialog'), close: $('closePatientImaging'),
      authorization: $('imagingAuthorization'), pixelReview: $('imagingPixelReview'),
      frontalProjection: $('frontalProjectionSelect'),
      frontalInput: $('standingPaInput'), lateralInput: $('standingLateralInput'), ctInput: $('ctSeriesInput'),
      frontalPicker: $('standingPaPicker'), lateralPicker: $('standingLateralPicker'), ctPicker: $('ctSeriesPicker'),
      supineInput: $('supineInput'), supinePicker: $('supinePicker'), supineStatus: $('supineStatus'),
      supineField: $('supineField'), supineKind: $('supineKindSelect'),
      frontalField: $('standingPaField'), lateralField: $('standingLateralField'), ctField: $('ctSeriesField'),
      frontalStatus: $('standingPaStatus'), lateralStatus: $('standingLateralStatus'), ctStatus: $('ctSeriesStatus'),
      frontalPreview: $('standingPaPreview'), lateralPreview: $('standingLateralPreview'),
      frontalPlaceholder: $('standingPaPlaceholder'), lateralPlaceholder: $('standingLateralPlaceholder'),
      previewGrid: $('radiographPreviewGrid'), preflight: $('imagingPreflightStatus'),
      stage: $('stagePatientImaging'), clear: $('clearPatientImaging'),
      measurementStep: $('imagingMeasurementStep'), measurementStatus: $('imagingMeasurementStatus'),
      measurementPi: $('imagingPiInput'), measurementLl: $('imagingLlInput'), measurementTk: $('imagingTkInput'),
      measurementCl: $('imagingClInput'), measurementPt: $('imagingPtInput'), measurementSva: $('imagingSvaInput'),
      measurementPrimaryCobb: $('imagingPrimaryCobbInput'), measurementPrimaryDirection: $('imagingPrimaryDirection'),
      measurementSecondaryCobb: $('imagingSecondaryCobbInput'), measurementTranslation: $('imagingTranslationInput'),
      measurementPrefill: $('prefillImagingMeasurements'), measurementApply: $('applyImagingMeasurements'),
      body: $('patientImagingBody'), runBar: $('imagingRunBar'), runBarText: $('imagingRunBarText'), runBarTime: $('imagingRunBarTime'),
      dropZone: $('imagingDropZone'), dropStatus: $('imagingDropStatus'),
      laterality: $('frontalLateralitySelect'), lateralityNote: $('frontalLateralityNote'),
      frontalThumb: $('standingPaThumb'), lateralThumb: $('standingLateralThumb'),
      removeFrontal: $('removeFrontalFilm'), removeLateral: $('removeLateralFilm'),
      swap: $('swapImagingViews'), assignNote: $('imagingAssignNote'),
      coverageDetails: $('imagingCoverageDetails'), coverageScope: $('imagingCoverageScope'),
      autoRun: $('autoLandmarkRunOnStage'), requestClear: $('requestClearPatientImaging'),
      clearConfirm: $('clearImagingConfirm'), clearConfirmText: $('clearImagingConfirmText'), cancelClear: $('cancelClearPatientImaging')
    };

    const missingElementBindings = Object.entries(els).filter(([, element]) => !element).map(([name]) => name);
    if (missingElementBindings.length) {
      const message = `Startup integrity check failed: missing ${missingElementBindings.join(', ')}.`;
      window.__spineModuleReady = true;
      window.__showSpine3dError(message);
      throw new Error(`DeformitySim: ${message}`);
    }
    const missingImplantBindings = Object.entries(implantEls).filter(([, element]) => !element).map(([name]) => name);
    if (missingImplantBindings.length) {
      const message = `Implant editor integrity check failed: missing ${missingImplantBindings.join(', ')}.`;
      window.__spineModuleReady = true;
      window.__showSpine3dError(message);
      throw new Error(`DeformitySim: ${message}`);
    }
    const missingLayerBindings = Object.entries(layerEls).filter(([, element]) => !element).map(([name]) => name);
    if (missingLayerBindings.length) {
      const message = `Viewport-layer integrity check failed: missing ${missingLayerBindings.join(', ')}.`;
      window.__spineModuleReady = true;
      window.__showSpine3dError(message);
      throw new Error(`DeformitySim: ${message}`);
    }
    const missingDemoBindings = Object.entries(demoEls).filter(([, element]) => !element).map(([name]) => name);
    if (missingDemoBindings.length) {
      const message = `Example-case integrity check failed: missing ${missingDemoBindings.join(', ')}.`;
      window.__spineModuleReady = true;
      window.__showSpine3dError(message);
      throw new Error(`DeformitySim: ${message}`);
    }
    const missingImagingBindings = Object.entries(imagingEls).filter(([, element]) => !element).map(([name]) => name);
    if (missingImagingBindings.length || document.querySelectorAll('.imaging-coverage-input').length !== 4) {
      const detail = missingImagingBindings.length ? missingImagingBindings.join(', ') : 'coverage inputs';
      const message = `Patient-imaging integrity check failed: missing ${detail}.`;
      window.__spineModuleReady = true;
      window.__showSpine3dError(message);
      throw new Error(`DeformitySim: ${message}`);
    }

    const labEls = {
      dialog: $('anatomyLabDialog'), open: $('openAnatomyLab'), close: $('closeAnatomyLab'),
      preset: $('deformityPreset'), presetDescription: $('presetDescription'),
      coronalMagnitude: $('coronalMagnitude'), coronalMagnitudeValue: $('coronalMagnitudeValue'),
      coronalDirection: $('coronalDirection'), globalAxialRotation: $('globalAxialRotation'), globalAxialRotationValue: $('globalAxialRotationValue'),
      pelvicObliquity: $('pelvicObliquity'), pelvicObliquityValue: $('pelvicObliquityValue'), trunkShift: $('trunkShift'), trunkShiftValue: $('trunkShiftValue'),
      cervicalSvaField: $('cervicalSva'), cervicalSvaValue: $('cervicalSvaValue'),
      t1SlopeField: $('t1Slope'), t1SlopeValue: $('t1SlopeValue'),
      cbvaField: $('cbva'), cbvaValue: $('cbvaValue'), cervicalModifierSummary: $('cervicalModifierSummary'),
      lowerExtremitiesVisible: $('lowerExtremitiesVisible'), hipFlexion: $('hipFlexion'), hipFlexionValue: $('hipFlexionValue'),
      kneeFlexion: $('kneeFlexion'), kneeFlexionValue: $('kneeFlexionValue'), ankleFlexion: $('ankleFlexion'), ankleFlexionValue: $('ankleFlexionValue'),
      pelvicShift: $('pelvicShift'), pelvicShiftValue: $('pelvicShiftValue'),
      levelSelect: $('anatomyLevelSelect'), selectedLevelTag: $('selectedLevelTag'), morphologyVariant: $('morphologyVariant'),
      discHeightLoss: $('discHeightLoss'), discHeightLossValue: $('discHeightLossValue'), sagittalWedge: $('sagittalWedge'), sagittalWedgeValue: $('sagittalWedgeValue'),
      coronalWedge: $('coronalWedge'), coronalWedgeValue: $('coronalWedgeValue'), levelAxialRotation: $('levelAxialRotation'), levelAxialRotationValue: $('levelAxialRotationValue'),
      apTranslation: $('apTranslation'), apTranslationValue: $('apTranslationValue'), lateralTranslation: $('lateralTranslation'), lateralTranslationValue: $('lateralTranslationValue'),
      facetHypertrophy: $('facetHypertrophy'), facetHypertrophyValue: $('facetHypertrophyValue'), osteophyteBurden: $('osteophyteBurden'), osteophyteBurdenValue: $('osteophyteBurdenValue'),
      bodyWidthScale: $('bodyWidthScale'), bodyWidthScaleValue: $('bodyWidthScaleValue'), bodyDepthScale: $('bodyDepthScale'), bodyDepthScaleValue: $('bodyDepthScaleValue'),
      pedicleScale: $('pedicleScale'), pedicleScaleValue: $('pedicleScaleValue'), canalScale: $('canalScale'), canalScaleValue: $('canalScaleValue'),
      inspectionExplode: $('inspectionExplode'), inspectionSummary: $('inspectionSummary'), inspect: $('inspectSelection'), restore: $('restoreInspection'),
      resetCurrent: $('resetCurrentLevel'), resetAll: $('resetAllAnatomy'), levelSummary: $('levelFactorSummary')
    };
    const missingLabBindings = Object.entries(labEls).filter(([, element]) => !element).map(([name]) => name);
    if (missingLabBindings.length) {
      const message = `Anatomy Lab integrity check failed: missing ${missingLabBindings.join(', ')}.`;
      window.__spineModuleReady = true;
      window.__showSpine3dError(message);
      throw new Error(`DeformitySim: ${message}`);
    }

    const LAB_GLOBAL_RANGES = Object.freeze([
      Object.freeze({ stateKey: 'coronalMagnitude', inputKey: 'coronalMagnitude', outputKey: 'coronalMagnitudeValue', unit: '\u00B0', signed: false }),
      Object.freeze({ stateKey: 'axialRotation', inputKey: 'globalAxialRotation', outputKey: 'globalAxialRotationValue', unit: '\u00B0', signed: true }),
      Object.freeze({ stateKey: 'pelvicObliquity', inputKey: 'pelvicObliquity', outputKey: 'pelvicObliquityValue', unit: '\u00B0', signed: true }),
      Object.freeze({ stateKey: 'trunkShift', inputKey: 'trunkShift', outputKey: 'trunkShiftValue', unit: ' mm', signed: true }),
      Object.freeze({ stateKey: 'cervicalSva', inputKey: 'cervicalSvaField', outputKey: 'cervicalSvaValue', unit: ' mm', signed: true }),
      Object.freeze({ stateKey: 't1Slope', inputKey: 't1SlopeField', outputKey: 't1SlopeValue', unit: '\u00B0', signed: false }),
      Object.freeze({ stateKey: 'cbva', inputKey: 'cbvaField', outputKey: 'cbvaValue', unit: '\u00B0', signed: true }),
      Object.freeze({ stateKey: 'hipFlexion', inputKey: 'hipFlexion', outputKey: 'hipFlexionValue', unit: '\u00B0', signed: true }),
      Object.freeze({ stateKey: 'kneeFlexion', inputKey: 'kneeFlexion', outputKey: 'kneeFlexionValue', unit: '\u00B0', signed: false }),
      Object.freeze({ stateKey: 'ankleFlexion', inputKey: 'ankleFlexion', outputKey: 'ankleFlexionValue', unit: '\u00B0', signed: true }),
      Object.freeze({ stateKey: 'pelvicShift', inputKey: 'pelvicShift', outputKey: 'pelvicShiftValue', unit: ' mm', signed: true })
    ]);
    const LAB_LEVEL_RANGES = Object.freeze([
      Object.freeze({ stateKey: 'discHeightLoss', inputKey: 'discHeightLoss', outputKey: 'discHeightLossValue', unit: '%', signed: false, scale: 1 }),
      Object.freeze({ stateKey: 'sagittalWedge', inputKey: 'sagittalWedge', outputKey: 'sagittalWedgeValue', unit: '\u00B0', signed: true, scale: 1 }),
      Object.freeze({ stateKey: 'coronalWedge', inputKey: 'coronalWedge', outputKey: 'coronalWedgeValue', unit: '\u00B0', signed: true, scale: 1 }),
      Object.freeze({ stateKey: 'axialRotation', inputKey: 'levelAxialRotation', outputKey: 'levelAxialRotationValue', unit: '\u00B0', signed: true, scale: 1 }),
      Object.freeze({ stateKey: 'apTranslation', inputKey: 'apTranslation', outputKey: 'apTranslationValue', unit: ' mm', signed: true, scale: 1 }),
      Object.freeze({ stateKey: 'lateralTranslation', inputKey: 'lateralTranslation', outputKey: 'lateralTranslationValue', unit: ' mm', signed: true, scale: 1 }),
      Object.freeze({ stateKey: 'facetHypertrophy', inputKey: 'facetHypertrophy', outputKey: 'facetHypertrophyValue', unit: '%', signed: false, scale: 1 }),
      Object.freeze({ stateKey: 'osteophyteBurden', inputKey: 'osteophyteBurden', outputKey: 'osteophyteBurdenValue', unit: '%', signed: false, scale: 1 }),
      Object.freeze({ stateKey: 'bodyWidthScale', inputKey: 'bodyWidthScale', outputKey: 'bodyWidthScaleValue', unit: '%', signed: false, scale: 100 }),
      Object.freeze({ stateKey: 'bodyDepthScale', inputKey: 'bodyDepthScale', outputKey: 'bodyDepthScaleValue', unit: '%', signed: false, scale: 100 }),
      Object.freeze({ stateKey: 'pedicleScale', inputKey: 'pedicleScale', outputKey: 'pedicleScaleValue', unit: '%', signed: false, scale: 100 }),
      Object.freeze({ stateKey: 'canalScale', inputKey: 'canalScale', outputKey: 'canalScaleValue', unit: '%', signed: false, scale: 100 })
    ]);

    const degree = value => {
      const normalized = Math.abs(value) < 0.05 ? 0 : value;
      return `${Number.isInteger(normalized) ? normalized.toFixed(0) : normalized.toFixed(1)}°`;
    };
    const signedDegree = value => {
      const normalized = Math.abs(value) < 0.05 ? 0 : value;
      return `${normalized > 0 ? '+' : ''}${degree(normalized)}`;
    };
    const signedNumber = (value, digits = 1) => {
      const normalized = Math.abs(value) < (0.5 * 10 ** -digits) ? 0 : value;
      return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}`;
    };
    function announce(message) {
      els.liveRegion.textContent = '';
      window.setTimeout(() => { els.liveRegion.textContent = message; }, 20);
    }

    function showToast(message, action = null) {
      window.clearTimeout(toastTimer);
      // During the guided demo the chapter narration owns the case: an Undo
      // would revert it under the narration, and an interactive toast would
      // sit over the demo controls. Toasts stay plain and click-through.
      if (document.body?.dataset?.demoActive === 'true') action = null;
      els.toast.textContent = message;
      els.toast.classList.remove('has-action');
      // An action (Undo) makes the toast interactive, so it stays up longer and
      // takes pointer events; a plain toast stays click-through.
      if (action && typeof action.run === 'function' && typeof document.createElement === 'function') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toast-action';
        button.textContent = action.label || 'Undo';
        button.addEventListener('click', () => {
          window.clearTimeout(toastTimer);
          els.toast.classList.remove('is-visible', 'has-action');
          action.run();
        });
        els.toast.append?.(button);
        els.toast.classList.add('has-action');
      }
      els.toast.classList.add('is-visible');
      toastTimer = window.setTimeout(() => els.toast.classList.remove('is-visible', 'has-action'), action ? 7000 : 2600);
    }

    const patientImagingSession = {
      frontal: null,
      lateral: null,
      supine: null,
      ctFiles: [],
      previewUrls: new Map(),
      // The standing files the current staged state was built from.
      stagedFiles: null
    };

    // Per-File result of the content check and, for DICOM, the header and
    // thumbnail preflight. Keyed by the File object, so a replaced or cleared
    // file simply drops out. Nothing here is written to app storage, and only
    // non-identifying header fields are kept (the decoder never reads group
    // 0010 or institution/physician tags).
    const imagingFileChecks = new WeakMap();
    const IMAGING_MAX_FILE_BYTES = 64 * 1024 * 1024;
    const IMAGING_MAX_SOURCE_PIXELS = 80000000;
    const IMAGING_THUMB_LONG_SIDE = 360;
    const IMAGING_PREVIEW_PLACEHOLDER = 'A thumbnail appears here for PNG, JPEG, WebP or DICOM.';
    const IMAGING_REEXPORT_ADVICE = 'Re-export it from the PACS or viewer as uncompressed DICOM (Explicit VR Little Endian; for example dcmdjpeg or gdcmconv --raw) or as a full-resolution PNG, then select that file.';
    const IMAGING_RASTER_SIGNATURES = Object.freeze([
      Object.freeze({ mime: 'image/png', extension: 'png', label: 'PNG', test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 }),
      Object.freeze({ mime: 'image/jpeg', extension: 'jpg', label: 'JPEG', test: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF }),
      Object.freeze({ mime: 'image/webp', extension: 'webp', label: 'WebP', test: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 })
    ]);
    // Patient side of the image columns, mapped onto the projection select the
    // analysis reads: PA = patient right on image right, AP = image left.
    const FRONTAL_LATERALITY_PROJECTIONS = Object.freeze({ left: 'ap', right: 'pa' });
    // A file being put into a slot programmatically (drop, paste, swap,
    // content normalisation) while its input's change event is dispatched.
    let pendingImagingAssignment = null;
    let imagingRestagePending = false;
    let syncingFrontalProjection = false;
    const imagingRunTracker = { running: false, startedAt: 0, timer: 0 };

    function selectedImagingPath() {
      const value = document.querySelector('input[name="imagingPath"]:checked')?.value;
      return Object.prototype.hasOwnProperty.call(PATIENT_IMAGING_MODEL.representations, value) ? value : 'radiographs';
    }

    function extensionImagingFileKind(file) {
      const mime = String(file.type || '').toLowerCase();
      const transientName = String(file.name || '').toLowerCase();
      if (['image/jpeg', 'image/png', 'image/webp'].includes(mime) || /\.(jpe?g|png|webp)$/.test(transientName)) return 'raster';
      if (mime === 'application/dicom' || mime === 'application/dicom+json' || /\.(dcm|dicom)$/.test(transientName)) return 'dicom';
      return 'invalid';
    }

    function imagingFileCheck(file) {
      return file && typeof file === 'object' ? imagingFileChecks.get(file) || null : null;
    }

    // Content wins over the name: a PACS/CD export named IM000001 is DICOM and
    // a renamed text file is not an image. The name/MIME rule is only used
    // until the bytes have been checked, or where they cannot be read.
    function localImagingFileKind(file) {
      if (!file || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size <= 0) return 'invalid';
      const check = imagingFileCheck(file);
      if (check && check.kind) return check.kind;
      return extensionImagingFileKind(file);
    }

    const dicomViewOf = viewPosition => {
      const code = String(viewPosition || '').toUpperCase();
      if (code === 'AP' || code === 'PA') return 'frontal';
      if (['LL', 'RL', 'LAT', 'LATERAL', 'LLD', 'RLD'].includes(code)) return 'lateral';
      return null;
    };

    // A DICOM decode failure in words a clinician can act on, with the remedy.
    // This is the one mapping: the intake's selection-time check and the
    // radiograph module's analysis decode (which resolves this global name)
    // both use it, so a refused file reads the same in both places. The reason
    // code and the decoder's technical text are never shown.
    function plainDicomFailure(decoded) {
      const reason = String(decoded?.reason || 'decode_failed');
      const advice = IMAGING_REEXPORT_ADVICE;
      if (/^1.2.840.10008.1.3.10$/.test(String(decoded?.sopClassUID || ''))) return 'This is the disc index (DICOMDIR), not an image. Choose an image file inside the DICOM folder instead.';
      // Transfer syntax (by UID suffix after 1.2.840.10008.1.2) to a codec name.
      const codecOf = uid => {
        const ts = String(uid || '');
        const k = ts.startsWith('1.2.840.10008.1.2.4.') ? Number(ts.slice(20)) : null;
        if (k === 50) return 'baseline JPEG'; if (k === 51) return '12-bit lossy JPEG';
        if (k === 57 || k === 70) return 'lossless JPEG'; if (k === 80 || k === 81) return 'JPEG-LS';
        if (k >= 90 && k <= 93) return 'JPEG 2000'; if (k >= 201 && k <= 204) return 'High-Throughput JPEG 2000';
        if (k >= 100 && k <= 108) return 'video (MPEG/HEVC)'; if (k >= 110 && k <= 112) return 'JPEG XL';
        if (ts === '1.2.840.10008.1.2.5') return 'RLE'; if (ts === '1.2.840.10008.1.2.1.99') return 'deflate-compressed';
        if (ts === '1.2.840.10008.1.2.2') return 'big-endian';
        return null;
      };
      const codec = ({
        jpeg2000_unsupported: 'JPEG 2000', jpeg_ls_unsupported: 'JPEG-LS', jpeg_xl_unsupported: 'JPEG XL',
        jpeg_arithmetic_unsupported: 'arithmetic-coded JPEG', jpeg_hierarchical_unsupported: 'hierarchical JPEG',
        jpeg_12bit_lossy_unsupported: '12-bit lossy JPEG', jpeg_lossy_requires_async: 'lossy JPEG', deflated_requires_async: 'deflate-compressed'
      })[reason] || codecOf(decoded?.transferSyntaxUID);
      if (reason === 'not_dicom') return 'This file is not a readable DICOM image (no DICOM header was found). If it is really a PNG or JPEG, give it its real extension; otherwise export the image again.';
      if (reason === 'pixel_data_missing') return 'This DICOM file contains no image (it may be a report, a key-image note or a DICOMDIR index). Select the radiograph image file itself.';
      if (reason === 'too_large') return `This DICOM image is larger than the ${Math.round(IMAGING_MAX_FILE_BYTES / 1048576)} MiB / ${Math.round(IMAGING_MAX_SOURCE_PIXELS / 1e6)}-megapixel local-analysis limit of this app. Export a downsized full-spine image (PNG or uncompressed DICOM).`;
      if (reason === 'video_transfer_syntax_unsupported') return 'This DICOM file is a video object, not a radiograph. Select the radiograph image file itself.';
      if (reason === 'jpip_unsupported') return `This DICOM file does not contain its pixels: they are held on a remote JPIP server. ${advice}`;
      if (/_unsupported$/.test(reason) && /jpeg|compressed|big_endian/.test(reason)) return `This DICOM image is ${reason === 'big_endian_unsupported' ? 'stored big-endian' : codec ? `stored as ${codec}` : 'stored in a compressed format'}, which this offline app cannot decode. ${advice}`;
      if (/requires_async$/.test(reason)) return `This browser could not decode the ${codec || 'compressed'} image data in this DICOM file. ${advice}`;
      if (/truncated|corrupt|stream_invalid|mismatch/.test(reason)) return `The image data in this DICOM file is incomplete or damaged (the copy may have been cut short). Copy or export the file again; if that fails, ${advice.charAt(0).toLowerCase() + advice.slice(1)}`;
      if (/photometric|bits|samples_per_pixel/.test(reason)) return `This DICOM uses a pixel format the app does not read (for example palette colour or 32-bit data). ${advice}`;
      if (/dimensions|frames/.test(reason)) return `The DICOM header describes the image size inconsistently, so it was not decoded rather than guessed. ${advice}`;
      return `The DICOM file could not be decoded locally. ${advice}`;
    }

    // Non-identifying header summary: nothing here names the patient, the
    // institution or the study.
    function dicomHeaderSummary(decoded) {
      const spacing = decoded.pixelSpacingMm && Number.isFinite(decoded.pixelSpacingMm.row) && Number.isFinite(decoded.pixelSpacingMm.col)
        ? { row: decoded.pixelSpacingMm.row, col: decoded.pixelSpacingMm.col, source: decoded.pixelSpacingMm.source || null } : null;
      const orientation = decoded.orientation || {};
      return {
        modality: decoded.modality || null,
        rows: Number.isFinite(decoded.rows) ? decoded.rows : null,
        columns: Number.isFinite(decoded.columns) ? decoded.columns : null,
        bitsStored: Number.isFinite(decoded.bitsStored) ? decoded.bitsStored : null,
        photometric: decoded.photometric || null,
        pixelCodec: decoded.pixelCodec || null,
        transferSyntaxUID: decoded.transferSyntaxUID || null,
        pixelSpacingMm: spacing,
        orientation: {
          viewPosition: orientation.viewPosition || null,
          rowDirection: orientation.rowDirection || null,
          columnDirection: orientation.columnDirection || null,
          imageLaterality: orientation.imageLaterality || null
        },
        numberOfFrames: Number.isFinite(decoded.numberOfFrames) ? decoded.numberOfFrames : null,
        warnings: Array.isArray(decoded.warnings) ? decoded.warnings.filter(w => /^(multi_frame|colour_converted|presentation_lut)/.test(w)).slice(0, 4) : []
      };
    }

    function dicomSummaryLine(summary) {
      const parts = ['DICOM'];
      if (summary.modality) parts.push(summary.modality);
      if (summary.columns && summary.rows) parts.push(`${summary.columns}×${summary.rows}`);
      if (summary.bitsStored) parts.push(`${summary.bitsStored}-bit`);
      if (summary.pixelSpacingMm) {
        const detector = summary.pixelSpacingMm.source === 'ImagerPixelSpacing';
        parts.push(`${Number(summary.pixelSpacingMm.col.toFixed(3))} mm/px (${detector ? 'detector plane' : 'PixelSpacing'})`);
      } else parts.push('no pixel spacing in header');
      if (summary.orientation.viewPosition) parts.push(`view ${summary.orientation.viewPosition}`);
      return parts.join(' · ');
    }

    // Box-averaged 8-bit thumbnail. Only the 8-bit display raster outlives the
    // check (held by the analysis module for staging); the rest is dropped.
    function dicomThumbnail(decoded) {
      const width = decoded.columns, height = decoded.rows, gray = decoded.gray8;
      if (!gray || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
      const scale = Math.min(1, IMAGING_THUMB_LONG_SIDE / Math.max(width, height));
      const tw = Math.max(1, Math.round(width * scale)), th = Math.max(1, Math.round(height * scale));
      const out = new Uint8ClampedArray(tw * th);
      for (let y = 0; y < th; y++) {
        const y0 = Math.floor(y * height / th), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / th));
        for (let x = 0; x < tw; x++) {
          const x0 = Math.floor(x * width / tw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / tw));
          const stepY = Math.max(1, Math.floor((y1 - y0) / 4)), stepX = Math.max(1, Math.floor((x1 - x0) / 4));
          let sum = 0, count = 0;
          for (let sy = y0; sy < y1; sy += stepY) for (let sx = x0; sx < x1; sx += stepX) { sum += gray[sy * width + sx]; count++; }
          out[y * tw + x] = count ? sum / count : 0;
        }
      }
      return { width: tw, height: th, gray: out };
    }

    // One DICOM decode per File while it is in flight. Choosing a film starts
    // both this intake check and the radiograph module's preview decode; both
    // await the same promise (the module reaches this global through
    // dicomImageFromFile). Only the in-flight promise is shared: the full
    // decode is not kept here once it settles. A null return means no decoder.
    const imagingDicomDecodes = new WeakMap();
    function decodeImagingDicom(file) {
      const decoder = window.__SPINE_DICOM__;
      if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function' || !decoder || typeof decoder.decodeRadiograph !== 'function') return null;
      let pending = imagingDicomDecodes.get(file);
      if (!pending) {
        // The asynchronous entry point also decodes Deflated and 8-bit lossy JPEG.
        const decode = typeof decoder.decodeRadiographAsync === 'function' ? decoder.decodeRadiographAsync : decoder.decodeRadiograph;
        pending = file.arrayBuffer().then(buffer => decode.call(decoder, buffer, { maxBytes: IMAGING_MAX_FILE_BYTES, maxPixels: IMAGING_MAX_SOURCE_PIXELS }));
        imagingDicomDecodes.set(file, pending);
        const release = () => { if (imagingDicomDecodes.get(file) === pending) imagingDicomDecodes.delete(file); };
        pending.then(release, release);
      }
      return pending;
    }

    async function runImagingFileCheck(file, record) {
      const extensionKind = extensionImagingFileKind(file);
      if (file.size > IMAGING_MAX_FILE_BYTES) {
        record.kind = extensionKind === 'invalid' ? 'dicom' : extensionKind;
        record.state = 'failed';
        record.message = 'The file is larger than the 64 MiB local-analysis limit.';
        return;
      }
      const head = new Uint8Array(await file.slice(0, 132).arrayBuffer());
      const raster = IMAGING_RASTER_SIGNATURES.find(signature => head.length >= 12 && signature.test(head));
      if (raster) {
        Object.assign(record, { kind: 'raster', format: raster.label, mime: raster.mime, extension: raster.extension, state: 'ok' });
        return;
      }
      const ascii = (offset, length) => String.fromCharCode(...head.subarray(offset, offset + length));
      const marked = (head.length >= 132 && ascii(128, 4) === 'DICM') || ascii(0, 4) === 'DICM';
      if (!marked && extensionKind === 'raster') {
        Object.assign(record, { kind: 'invalid', state: 'failed', message: 'It is named as an image, but its content is not PNG, JPEG or WebP.' });
        return;
      }
      const decoder = window.__SPINE_DICOM__;
      if (!decoder || typeof decoder.decodeRadiograph !== 'function') {
        Object.assign(record, marked
          ? { kind: 'dicom', format: 'DICOM', state: 'failed', message: 'DICOM decoding is not available in this build.' }
          : { kind: extensionKind, state: extensionKind === 'invalid' ? 'failed' : 'ok', message: extensionKind === 'invalid' ? 'It is not a PNG, JPEG, WebP or DICOM image.' : '' });
        return;
      }
      // A successful parse is the other proof of DICOM: raw datasets without
      // the 128-byte preamble and 'DICM' still decode.
      const decoded = await decodeImagingDicom(file);
      if (!marked && decoded.reason === 'not_dicom') {
        Object.assign(record, { kind: 'invalid', state: 'failed', message: 'It is not a PNG, JPEG, WebP or DICOM image.' });
        return;
      }
      Object.assign(record, { kind: 'dicom', format: 'DICOM', mime: 'application/dicom', extension: 'dcm', dicom: dicomHeaderSummary(decoded) });
      if (!decoded.ok) {
        record.state = 'failed';
        record.message = plainDicomFailure(decoded);
        return;
      }
      // The analysis module keeps this decode for staging and the run even when
      // its own preview decode had not started yet (it takes only what fits
      // its limits), so the file is decoded once.
      try { window.__SPINE_AUTOCAL__?.primeDicomDecode?.(file, decoded); } catch (_) { /* it decodes on its own */ }
      record.thumb = dicomThumbnail(decoded);
      record.state = 'ok';
    }

    function startImagingFileCheck(file) {
      if (!file || typeof file !== 'object' || typeof file.slice !== 'function' || !(file.size > 0)) return null;
      const known = imagingFileChecks.get(file);
      if (known) return known;
      const record = { state: 'pending', kind: null, format: null, mime: null, extension: null, message: '', dicom: null, thumb: null, dims: null, promise: null };
      imagingFileChecks.set(file, record);
      record.promise = runImagingFileCheck(file, record).catch(() => {
        record.state = 'failed';
        record.kind = record.kind || 'invalid';
        record.message = record.message || 'The file could not be read locally.';
      }).then(() => record);
      return record;
    }

    function imagingChecksPending() {
      return ['frontal', 'lateral'].some(slot => imagingFileCheck(patientImagingSession[slot])?.state === 'pending');
    }

    // The analysis module recognizes files by name and MIME type. A file the
    // content check identified is re-wrapped (same bytes, no copy) with a
    // neutral name and the matching type, which also keeps the original file
    // name out of every later code path.
    function normalizedImagingFile(file, record) {
      if (!record || record.state === 'pending' || !['raster', 'dicom'].includes(record.kind) || typeof File !== 'function') return file;
      if (extensionImagingFileKind(file) === record.kind) return file;
      try {
        const wrapped = new File([file], `${record.kind === 'dicom' ? 'dicom-image' : 'image'}.${record.extension || (record.kind === 'dicom' ? 'dcm' : 'png')}`, { type: record.mime || (record.kind === 'dicom' ? 'application/dicom' : 'image/png'), lastModified: file.lastModified });
        imagingFileChecks.set(wrapped, record);
        if (record.kind === 'dicom') {
          try { window.__SPINE_AUTOCAL__?.shareDicomDecode?.(file, wrapped); } catch (_) { /* decoded again on demand */ }
        }
        return wrapped;
      } catch (_) {
        return file;
      }
    }

    function formatImagingBytes(bytes) {
      const value = Number(bytes) || 0;
      if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
      return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    }

    function imagingSlotEls(slot) {
      if (slot === 'frontal') return { input: imagingEls.frontalInput, image: imagingEls.frontalPreview, thumb: imagingEls.frontalThumb, placeholder: imagingEls.frontalPlaceholder, picker: imagingEls.frontalPicker, remove: imagingEls.removeFrontal };
      if (slot === 'lateral') return { input: imagingEls.lateralInput, image: imagingEls.lateralPreview, thumb: imagingEls.lateralThumb, placeholder: imagingEls.lateralPlaceholder, picker: imagingEls.lateralPicker, remove: imagingEls.removeLateral };
      return { input: imagingEls.supineInput, picker: imagingEls.supinePicker };
    }

    function revokeImagingPreview(slot) {
      const { image, thumb, placeholder } = imagingSlotEls(slot);
      if (image) {
        image.hidden = true;
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
      }
      if (thumb) thumb.hidden = true;
      if (placeholder) {
        placeholder.hidden = false;
        placeholder.textContent = IMAGING_PREVIEW_PLACEHOLDER;
      }
      const url = patientImagingSession.previewUrls.get(slot);
      if (!url) return;
      patientImagingSession.previewUrls.delete(slot);
      if (window.URL?.revokeObjectURL) window.URL.revokeObjectURL(url);
    }

    function drawImagingThumb(canvas, thumb) {
      if (!canvas || !thumb || typeof canvas.getContext !== 'function' || typeof ImageData !== 'function') return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      const rgba = new Uint8ClampedArray(thumb.width * thumb.height * 4);
      for (let i = 0, p = 0; i < thumb.gray.length; i++, p += 4) { rgba[p] = rgba[p + 1] = rgba[p + 2] = thumb.gray[i]; rgba[p + 3] = 255; }
      canvas.width = thumb.width;
      canvas.height = thumb.height;
      context.putImageData(new ImageData(rgba, thumb.width, thumb.height), 0, 0);
      return true;
    }

    function updateImagingPreview(slot, file) {
      revokeImagingPreview(slot);
      if (!file) return;
      const { image, thumb, placeholder } = imagingSlotEls(slot);
      const kind = localImagingFileKind(file);
      const check = imagingFileCheck(file);
      if (kind === 'raster' && window.URL?.createObjectURL) {
        try {
          const url = window.URL.createObjectURL(file);
          patientImagingSession.previewUrls.set(slot, url);
          // The browser's own decode is the raster preflight: a file it cannot
          // show cannot be analyzed either.
          image.onload = () => {
            if (patientImagingSession[slot] !== file) return;
            const record = imagingFileCheck(file);
            if (record && image.naturalWidth) record.dims = { width: image.naturalWidth, height: image.naturalHeight };
            renderImagingFileStatus();
          };
          image.onerror = () => {
            if (patientImagingSession[slot] !== file) return;
            const record = imagingFileCheck(file);
            if (record && record.state !== 'pending') Object.assign(record, { state: 'failed', message: 'The browser could not decode this image; it may be damaged or in an unsupported format.' });
            revokeImagingPreview(slot);
            placeholder.textContent = 'No preview: the browser could not decode this image.';
            renderImagingFileStatus();
            refreshImagingPreflight();
          };
          image.src = url;
          image.hidden = false;
          placeholder.hidden = true;
        } catch (_) {
          revokeImagingPreview(slot);
        }
        return;
      }
      if (kind === 'dicom' && check?.state === 'ok' && check.thumb && drawImagingThumb(thumb, check.thumb)) {
        thumb.hidden = false;
        placeholder.hidden = true;
        return;
      }
      placeholder.textContent = check?.state === 'pending'
        ? 'Checking the file locally…'
        : check?.state === 'failed'
          ? 'No preview: this file cannot be decoded here.'
          : 'No preview for this file.';
    }

    function describeImagingFile(file, label) {
      if (!file) return 'Not provided';
      const kind = localImagingFileKind(file);
      const check = imagingFileCheck(file);
      const size = formatImagingBytes(file.size);
      if (check?.state === 'pending') return `Checking the ${label} file locally… · ${size} · file name hidden`;
      if (check?.state === 'failed') return `Cannot be analyzed here: ${check.message}`;
      if (kind === 'invalid') return `Unsupported ${label} file selected; file name hidden`;
      if (kind === 'dicom') {
        if (!check?.dicom) return `1 DICOM file selected - ${size} - file name hidden`;
        const view = dicomViewOf(check.dicom.orientation.viewPosition);
        const mismatch = view && ['frontal', 'lateral'].includes(label) && view !== label ? ` · the header says ${view} view: use Swap if it is in the wrong slot` : '';
        const notes = check.dicom.warnings.length ? ' · first frame / converted to greyscale' : '';
        const modality = check.dicom.modality && !['CR', 'DX', 'RF', 'XA', 'RG', 'OT', 'DR'].includes(String(check.dicom.modality).toUpperCase()) ? ` · modality ${check.dicom.modality} is not a projection radiograph` : '';
        return `${dicomSummaryLine(check.dicom)}${notes}${modality} · ${size} · file name hidden${mismatch}`;
      }
      const dims = check?.dims ? ` · ${check.dims.width}×${check.dims.height}` : '';
      return check?.format ? `${check.format} image${dims} · ${size} · file name hidden` : `1 raster file selected - ${size} - file name hidden`;
    }

    function renderImagingFileStatus() {
      imagingEls.frontalStatus.textContent = describeImagingFile(patientImagingSession.frontal, 'frontal');
      imagingEls.lateralStatus.textContent = describeImagingFile(patientImagingSession.lateral, 'lateral');
      if (imagingEls.supineStatus) imagingEls.supineStatus.textContent = describeImagingFile(patientImagingSession.supine, 'supine');
      [['frontal', imagingEls.frontalStatus], ['lateral', imagingEls.lateralStatus], ['supine', imagingEls.supineStatus]].forEach(([slot, element]) => {
        if (element) element.dataset.state = imagingFileCheck(patientImagingSession[slot])?.state === 'failed' || (patientImagingSession[slot] && localImagingFileKind(patientImagingSession[slot]) === 'invalid') ? 'error' : 'idle';
      });
      imagingEls.ctStatus.textContent = 'CT series decoding is untested here and stays blocked until validated.';
    }

    // Every route that puts a file into a slot (picker, drop, paste, swap,
    // remove, content normalisation) ends in that slot's input change event,
    // so the calibration module resets the film's landmarks exactly as it does
    // for a picker selection.
    function assignImagingFile(slot, file, { preserveLaterality = false } = {}) {
      const { input } = imagingSlotEls(slot);
      if (!input) return false;
      try {
        if (typeof DataTransfer === 'function') {
          const transfer = new DataTransfer();
          if (file) transfer.items.add(file);
          input.files = transfer.files;
        } else if (!file) input.value = '';
      } catch (_) { /* The session assignment below stays authoritative. */ }
      pendingImagingAssignment = { slot, file: file || null, preserveLaterality };
      try {
        input.dispatchEvent(typeof Event === 'function' ? new Event('change', { bubbles: true }) : { type: 'change' });
      } finally {
        pendingImagingAssignment = null;
      }
      return true;
    }

    function handleImagingInputChange(slot) {
      const { input } = imagingSlotEls(slot);
      const pending = pendingImagingAssignment && pendingImagingAssignment.slot === slot ? pendingImagingAssignment : null;
      const file = pending ? pending.file : (input?.files?.[0] || null);
      patientImagingSession[slot] = file;
      if (slot !== 'supine') updateImagingPreview(slot, file);
      if (file && slot !== 'supine') prefillImagingCoverage();
      // Laterality belongs to the film it was confirmed on.
      if (slot === 'frontal' && !pending?.preserveLaterality) applyFrontalLaterality('unconfirmed', 'default');
      renderImagingFileStatus();
      syncImagingSlotControls();
      refreshImagingPreflight();
      if (file) followImagingFileCheck(slot, file);
      return file;
    }

    function followImagingFileCheck(slot, file) {
      const record = startImagingFileCheck(file);
      if (!record) return;
      record.promise.then(() => {
        if (patientImagingSession[slot] !== file) return;
        const normalized = normalizedImagingFile(file, record);
        if (normalized !== file) {
          assignImagingFile(slot, normalized, { preserveLaterality: true });
          return;
        }
        if (slot !== 'supine' && !patientImagingSession.previewUrls.has(slot)) updateImagingPreview(slot, file);
        if (slot === 'frontal') autofillFrontalLaterality(record);
        renderImagingFileStatus();
        syncImagingSlotControls();
        refreshImagingPreflight();
        if (imagingRestagePending && !imagingChecksPending()) {
          imagingRestagePending = false;
          imagingEls.stage.click();
        }
      });
    }

    function setImagingDropStatus(message, stateName = 'idle') {
      if (!imagingEls.dropStatus) return;
      imagingEls.dropStatus.textContent = message;
      if (imagingEls.dropZone) imagingEls.dropZone.dataset.state = stateName;
    }

    function setImagingAssignNote(message) {
      if (!imagingEls.assignNote) return;
      imagingEls.assignNote.textContent = message || '';
      imagingEls.assignNote.hidden = !message;
    }

    function imagingSlotFromElement(element) {
      const field = element && typeof element.closest === 'function' ? element.closest('[data-slot], #supineField') : null;
      if (!field || field.id === '') return null;
      return field.id === 'supineField' ? 'supine' : ['frontal', 'lateral'].includes(field.dataset?.slot) ? field.dataset.slot : null;
    }

    // Dropped, pasted or multi-selected files. One file goes to the slot it was
    // dropped on, else to the view its DICOM header names, else to the first
    // empty standing slot. Two files are assigned by DICOM ViewPosition when a
    // header provides it, otherwise in the order given, with Swap offered.
    async function acceptImagingFiles(fileList, { targetSlot = null, origin = 'drop' } = {}) {
      const files = Array.from(fileList || []).filter(file => file && typeof file.size === 'number');
      if (!files.length) return false;
      if (!imagingEls.authorization.checked) {
        setImagingDropStatus(`Tick the statement in step 1 first. The ${origin === 'paste' ? 'pasted image' : files.length === 1 ? 'dropped file' : 'dropped files'} ${files.length === 1 ? 'was' : 'were'} not read.`, 'error');
        announce('Confirm the de-identification statement in step 1 before adding films.');
        return false;
      }
      if (selectedImagingPath() !== 'radiographs') return false;
      if (targetSlot === 'supine') {
        assignImagingFile('supine', files[0]);
        setImagingDropStatus('Supine comparison file added.', 'ready');
        return true;
      }
      const standing = files.slice(0, 2);
      setImagingDropStatus(standing.length === 1 ? 'Checking the file locally…' : 'Checking both files locally…', 'busy');
      const records = await Promise.all(standing.map(file => startImagingFileCheck(file)?.promise || Promise.resolve(null)));
      const views = records.map(record => dicomViewOf(record?.dicom?.orientation?.viewPosition));
      let plan, basis;
      if (standing.length === 1) {
        const slot = targetSlot || views[0] || (!patientImagingSession.frontal ? 'frontal' : !patientImagingSession.lateral ? 'lateral' : 'frontal');
        plan = { [slot]: standing[0] };
        basis = targetSlot ? `placed in the ${slot} slot you chose` : views[0] ? `placed as ${slot} from its DICOM view position` : `placed in the ${slot} slot`;
      } else if (views[0] && views[1] && views[0] !== views[1]) {
        plan = { [views[0]]: standing[0], [views[1]]: standing[1] };
        basis = 'assigned by their DICOM view position';
      } else if ((views[0] || views[1]) && views[0] !== views[1]) {
        const known = views[0] ? 0 : 1, other = known ? 0 : 1;
        const knownSlot = views[known], otherSlot = knownSlot === 'frontal' ? 'lateral' : 'frontal';
        plan = { [knownSlot]: standing[known], [otherSlot]: standing[other] };
        basis = 'assigned from the one DICOM view position present';
      } else {
        plan = { frontal: standing[0], lateral: standing[1] };
        basis = 'assigned in the order given (first frontal, second lateral)';
      }
      // A film already in a slot is replaced, and the messages say so rather
      // than reporting the file as simply added.
      const replaced = Object.keys(plan).filter(slot => patientImagingSession[slot]);
      Object.entries(plan).forEach(([slot, file]) => assignImagingFile(slot, file));
      const extra = files.length > 2 ? ` Only the first two of ${files.length} files were used.` : '';
      const verify = standing.length === 2 && !basis.startsWith('assigned by their') ? ' Check both thumbnails and use Swap if they are the wrong way round.' : '';
      const replacedText = replaced.length ? ` It replaced the ${replaced.join(' and ')} film${replaced.length === 1 ? '' : 's'} that ${replaced.length === 1 ? 'was' : 'were'} already there; choose that film again if you still need it.` : '';
      setImagingAssignNote(`${standing.length === 1 ? 'Film' : 'Films'} ${basis}.${replacedText}${verify}${extra}`);
      const from = origin === 'paste' ? 'the clipboard' : origin === 'drop' ? 'the drop' : 'the selection';
      setImagingDropStatus(replaced.length
        ? `Replaced the ${replaced.join(' and ')} film${replaced.length === 1 ? '' : 's'} with ${standing.length === 1 ? 'the file' : 'the files'} from ${from}.`
        : `${standing.length === 1 ? 'File' : 'Files'} added from ${from}.`, 'ready');
      announce(`${standing.length === 1 ? 'One film' : 'Two films'} ${basis}.${replacedText}`);
      return true;
    }

    function swapImagingViews() {
      const frontal = patientImagingSession.frontal, lateral = patientImagingSession.lateral;
      if (!frontal && !lateral) return false;
      assignImagingFile('frontal', lateral);
      assignImagingFile('lateral', frontal);
      setImagingAssignNote('Frontal and lateral swapped. Confirm the patient side for the new frontal film.');
      announce('Frontal and lateral films swapped. Landmarks placed on either film were cleared.');
      return true;
    }

    function applyFrontalLaterality(value, source = 'user') {
      const select = imagingEls.laterality;
      if (!select) return 'unconfirmed';
      const next = Object.prototype.hasOwnProperty.call(FRONTAL_LATERALITY_PROJECTIONS, value) ? value : 'unconfirmed';
      // A user's change event arrives with the new value already in place, so
      // the previous confirmation is read from the recorded source instead.
      const wasConfirmed = (select.dataset.source || 'default') !== 'default';
      select.value = next;
      select.dataset.source = next === 'unconfirmed' ? 'default' : source;
      const projection = FRONTAL_LATERALITY_PROJECTIONS[next] || 'pa';
      const projectionSelect = imagingEls.frontalProjection;
      // Confirming or withdrawing the side re-derives the apex side even when
      // the PA/AP mapping stays the same: the analysis withholds it while the
      // side is not confirmed.
      if (projectionSelect.value !== projection || wasConfirmed !== (next !== 'unconfirmed')) {
        projectionSelect.value = projection;
        // The analysis re-derives an existing apex side on this event.
        syncingFrontalProjection = true;
        try {
          projectionSelect.dispatchEvent(typeof Event === 'function' ? new Event('change', { bubbles: true }) : { type: 'change' });
        } finally {
          syncingFrontalProjection = false;
        }
      }
      // The calibration module reads who set the projection from these flags
      // (its review record and its DICOM autofill, which never overrides a
      // user choice). They are written after the event, whose own listener
      // marks every change as the user's.
      if (projectionSelect.dataset) {
        delete projectionSelect.dataset.userChosen;
        delete projectionSelect.dataset.autofill;
        if (next !== 'unconfirmed' && source === 'dicom') projectionSelect.dataset.autofill = 'dicom';
        else if (next !== 'unconfirmed') projectionSelect.dataset.userChosen = 'true';
      }
      syncStagedFrontalLaterality();
      renderFrontalLateralityNote();
      return next;
    }

    // The staged record follows a laterality confirmed after staging.
    function syncStagedFrontalLaterality() {
      const imaging = state.patientImaging, select = imagingEls.laterality;
      if (!imaging || imaging.status !== 'staged' || !imaging.frontalLaterality || !select) return;
      const value = select.value, source = select.dataset.source || 'default';
      imaging.frontalLaterality = {
        patientRightOnImage: value === 'left' || value === 'right' ? value : null,
        source: value === 'unconfirmed' ? 'not_confirmed' : source === 'dicom' ? 'dicom_patient_orientation' : 'user'
      };
      imaging.frontalProjection = imagingEls.frontalProjection.value === 'ap' ? 'ap' : 'pa';
    }

    // Another component set the projection directly (PA/AP semantics): the
    // calibration module's DICOM autofill or its reset, or a scripted caller.
    // Its flags are final only after its own handler returns, so they are
    // read a microtask later: autofill = DICOM, userChosen = a choice, and
    // neither = the unconfirmed default.
    function mirrorFrontalProjection() {
      if (syncingFrontalProjection || !imagingEls.laterality) return;
      // Going through applyFrontalLaterality (same flags and source as before)
      // also re-derives an existing apex side when the confirmation changed,
      // since the analysis withholds the side while it is unconfirmed.
      const settle = () => {
        const select = imagingEls.frontalProjection, flags = select.dataset || {};
        const side = select.value === 'ap' ? 'left' : 'right';
        if (flags.autofill === 'dicom') applyFrontalLaterality(side, 'dicom');
        else if (flags.userChosen === 'true') applyFrontalLaterality(side, 'projection');
        else applyFrontalLaterality('unconfirmed');
        refreshImagingPreflight();
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(settle);
      else Promise.resolve().then(settle);
    }

    // DICOM Patient Orientation (0020,0020): the first code is the patient
    // direction the rows run toward. 'L' puts the patient's right on image
    // left; 'R' on image right. A user's own choice is never overridden.
    function autofillFrontalLaterality(record) {
      const row = String(record?.dicom?.orientation?.rowDirection || '');
      const side = row === 'L' ? 'left' : row === 'R' ? 'right' : null;
      if (!side || !imagingEls.laterality) return false;
      const source = imagingEls.laterality.dataset.source || 'default';
      if (source !== 'default' && source !== 'dicom') return false;
      applyFrontalLaterality(side, 'dicom');
      return true;
    }

    function renderFrontalLateralityNote() {
      const note = imagingEls.lateralityNote, select = imagingEls.laterality;
      if (!note || !select) return;
      const value = select.value, source = select.dataset.source || 'default';
      note.dataset.state = value === 'unconfirmed' ? 'unconfirmed' : 'confirmed';
      note.textContent = value === 'unconfirmed'
        ? 'Not confirmed: the apex side and signed apical translation are not verified until you choose the side shown by the film’s L/R marker.'
        : source === 'dicom'
          ? `Read from the DICOM Patient Orientation tag: patient right on image ${value}. Change it if the film’s L/R marker disagrees.`
          : `Patient right on image ${value} (${value === 'left' ? 'AP, radiological view' : 'PA, viewed from behind'}). Check it against the film’s L/R marker.`;
    }

    function prefillImagingCoverage() {
      document.querySelectorAll('.imaging-coverage-input').forEach(input => {
        if (input.dataset.userSet === 'true') return;
        input.checked = input.value !== 'lower-limb';
      });
    }

    function syncImagingSlotControls() {
      const authorized = imagingEls.authorization.checked;
      const has = { frontal: Boolean(patientImagingSession.frontal), lateral: Boolean(patientImagingSession.lateral) };
      ['frontal', 'lateral'].forEach(slot => {
        const { remove, picker } = imagingSlotEls(slot);
        if (remove) {
          remove.hidden = !has[slot];
          remove.disabled = !authorized;
        }
        if (picker) picker.textContent = `${has[slot] ? 'Replace' : 'Choose'} ${slot} file`;
      });
      if (imagingEls.supinePicker) imagingEls.supinePicker.textContent = `${patientImagingSession.supine ? 'Replace' : 'Choose'} supine file`;
      if (imagingEls.swap) imagingEls.swap.disabled = !authorized || (!has.frontal && !has.lateral);
      if (imagingEls.coverageDetails) imagingEls.coverageDetails.hidden = !has.frontal && !has.lateral;
      if (imagingEls.coverageScope) imagingEls.coverageScope.textContent = has.frontal && has.lateral ? 'for both films' : has.frontal ? 'for the frontal film' : 'for the lateral film';
    }

    // Scrolls only the dialog body. Element.scrollIntoView also scrolls every
    // scrollable ancestor, including the dialog frame, which on a phone pushed
    // the header and its close button out of reach.
    function scrollImagingBodyTo(target) {
      const body = imagingEls.body;
      if (!body || !target || typeof body.scrollTo !== 'function' || typeof target.getBoundingClientRect !== 'function') return false;
      const inset = imagingEls.runBar && !imagingEls.runBar.hidden ? imagingEls.runBar.offsetHeight : 0;
      const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - inset - 8;
      body.scrollTo({ top: Math.max(0, top), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      return true;
    }

    // Mirrors #autoLandmarkStatus into the sticky bar at the top of the dialog
    // body while an analysis runs, and brings the result into view afterwards.
    function syncImagingRunBar() {
      const status = document.getElementById('autoLandmarkStatus');
      if (!status || !imagingEls.runBar) return;
      const tick = () => { imagingEls.runBarTime.textContent = `${Math.max(0, Math.round((Date.now() - imagingRunTracker.startedAt) / 1000))} s`; };
      if (status.dataset.state === 'running') {
        if (!imagingRunTracker.running) {
          imagingRunTracker.running = true;
          imagingRunTracker.startedAt = Date.now();
          window.clearInterval(imagingRunTracker.timer);
          imagingRunTracker.timer = window.setInterval(tick, 1000);
        }
        imagingEls.runBarText.textContent = status.textContent;
        imagingEls.runBar.hidden = false;
        tick();
        return;
      }
      if (!imagingRunTracker.running) return;
      imagingRunTracker.running = false;
      window.clearInterval(imagingRunTracker.timer);
      imagingEls.runBar.hidden = true;
      if (!imagingEls.dialog.open || document.body.dataset.manualFocus === 'true') return;
      const grid = document.getElementById('autoLandmarkPreviewGrid');
      scrollImagingBodyTo(grid && !grid.hidden ? grid : status);
    }

    function imagingClearCounts() {
      const films = ['frontal', 'lateral', 'supine'].filter(slot => patientImagingSession[slot]).length;
      const points = window.__SPINE_AUTOCAL__?.manual?.points || {};
      const landmarks = ['frontal', 'lateral', 'supine'].reduce((sum, plane) => sum + Object.keys(points[plane] || {}).length, 0);
      return { films, landmarks };
    }

    // Clearing discards films, results and placed landmarks, so it asks first
    // whenever there is anything to lose.
    function requestPatientImagingClear() {
      const { films, landmarks } = imagingClearCounts();
      const applied = Boolean(state.patientImaging.alignmentApplied);
      if (!films && !landmarks && state.patientImaging.status !== 'staged') {
        imagingEls.clear.click();
        return false;
      }
      const parts = [];
      if (films) parts.push(`${films} film${films === 1 ? '' : 's'}`);
      if (landmarks) parts.push(`${landmarks} placed landmark${landmarks === 1 ? '' : 's'}`);
      imagingEls.clearConfirmText.textContent = `Discard ${parts.length ? parts.join(' and ') : 'the staged source set'} and any beta result?${applied ? ' Measurements already applied to the case stay applied.' : ''} The statement in step 1 stays ticked.`;
      imagingEls.clearConfirm.hidden = false;
      imagingEls.requestClear.hidden = true;
      imagingEls.cancelClear.focus?.();
      return true;
    }

    function cancelPatientImagingClear() {
      imagingEls.clearConfirm.hidden = true;
      imagingEls.requestClear.hidden = false;
      imagingEls.requestClear.focus?.();
    }

    function imagingCoverageValues() {
      return [...document.querySelectorAll('.imaging-coverage-input:checked')].map(input => input.value);
    }

    function validatePatientImagingSelection(selection) {
      const path = selection?.path;
      const frontal = selection?.frontal || null;
      const lateral = selection?.lateral || null;
      const ctFiles = Array.from(selection?.ctFiles || []);
      const coverage = Array.from(selection?.coverage || []);
      const errors = [];
      const needsPair = path === 'radiographs' || path === 'hybrid';
      const needsCt = path === 'ct' || path === 'hybrid';
      if (!Object.prototype.hasOwnProperty.call(PATIENT_IMAGING_MODEL.representations, path)) errors.push('Choose a supported source combination.');
      if (needsCt) errors.push('CT DICOM intake is untested in this build and is blocked until it passes validation. Stage standing radiographs instead.');
      // One statement covers de-identification and the burned-in pixel review;
      // a caller that still passes the old separate flag as false is refused.
      if (selection?.authorization !== true || selection?.pixelReview === false) errors.push('Tick the de-identification and pixel-review statement in step 1.');
      // Either standing view alone is analyzable: each plane is processed
      // independently, and the embedded model is frontal-only.
      const views = needsPair ? [['frontal', frontal], ['lateral', lateral]].filter(([, file]) => file) : [];
      if (needsPair) {
        if (!views.length) errors.push('Add a standing frontal or lateral film (or both).');
        views.forEach(([slot, file]) => {
          const kind = localImagingFileKind(file);
          if (!['raster', 'dicom'].includes(kind)) {
            errors.push(`The ${slot} file must be PNG, JPEG, WebP, or DICOM.`);
            return;
          }
          const check = imagingFileCheck(file);
          if (check?.state === 'failed') errors.push(`The ${slot} ${kind === 'dicom' ? 'DICOM' : 'image'} cannot be analyzed here: ${check.message}`);
        });
      }
      if (needsCt) {
        if (ctFiles.length < 2) errors.push('Select a multi-file CT DICOM series.');
        if (ctFiles.some(file => localImagingFileKind(file) !== 'dicom')) errors.push('Every CT-series file must be DICOM.');
      }
      // Coverage declarations are optional, pre-filled toggles: recorded as
      // declared, never required for staging.
      const allFiles = [needsPair ? frontal : null, needsPair ? lateral : null, ...(needsCt ? ctFiles : [])].filter(Boolean);
      const totalBytes = allFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
      if (allFiles.length && !totalBytes) errors.push('The selected source set is empty.');
      if (totalBytes > PATIENT_IMAGING_MODEL.maxSessionBytes) errors.push('The local source set exceeds the 2 GB session guardrail.');
      const viewKinds = views.map(([, file]) => localImagingFileKind(file));
      const dicomChecks = views.filter(([, file]) => localImagingFileKind(file) === 'dicom').map(([, file]) => imagingFileCheck(file));
      const dicomParsed = dicomChecks.length > 0 && dicomChecks.every(check => check?.state === 'ok');
      const content = viewKinds.includes('raster') ? 'raster' : dicomParsed ? 'dicom_decoded' : 'dicom_selected_unparsed';
      const standingRepresentation = views.length === 2
        ? { raster: 'standing_raster_pair_preview_only', dicom_decoded: 'standing_dicom_pair_decoded', dicom_selected_unparsed: 'standing_dicom_pair_selected_unparsed' }[content]
        : views.length === 1 ? `standing_${views[0][0]}_only_${content}` : 'standing_raster_pair_preview_only';
      const representation = path === 'radiographs'
        ? standingRepresentation
        : path === 'ct'
          ? 'ct_dicom_series_selected_unparsed_unsegmented'
          : 'hybrid_sources_selected_registration_unavailable';
      const laterality = ['left', 'right'].includes(selection?.frontalLaterality) ? selection.frontalLaterality : 'unconfirmed';
      const headerFor = file => {
        const check = localImagingFileKind(file) === 'dicom' ? imagingFileCheck(file) : null;
        return check?.state === 'ok' && check.dicom ? { ...check.dicom, pixelSpacingMm: check.dicom.pixelSpacingMm ? { ...check.dicom.pixelSpacingMm } : null, orientation: { ...check.dicom.orientation }, warnings: [...check.dicom.warnings] } : null;
      };
      return {
        valid: errors.length === 0,
        errors,
        summary: {
          status: errors.length ? 'invalid' : 'staged',
          path,
          privacyMode: PATIENT_IMAGING_MODEL.privacyMode,
          source: 'local_user_selection',
          frontalProjection: ['pa', 'ap'].includes(selection?.frontalProjection) ? selection.frontalProjection : 'pa',
          frontalLaterality: needsPair && frontal ? {
            patientRightOnImage: laterality === 'unconfirmed' ? null : laterality,
            source: laterality === 'unconfirmed' ? 'not_confirmed' : selection?.frontalLateralitySource === 'dicom' ? 'dicom_patient_orientation' : 'user'
          } : null,
          views: views.map(([slot]) => slot),
          sourceCounts: { frontal: needsPair && frontal ? 1 : 0, lateral: needsPair && lateral ? 1 : 0, ct: needsCt ? ctFiles.length : 0 },
          sourceKinds: { frontal: needsPair && frontal ? localImagingFileKind(frontal) : 'none', lateral: needsPair && lateral ? localImagingFileKind(lateral) : 'none', ct: needsCt && ctFiles.length ? 'dicom' : 'none' },
          dicomHeaders: { frontal: needsPair && frontal ? headerFor(frontal) : null, lateral: needsPair && lateral ? headerFor(lateral) : null },
          totalBytes,
          coverage: [...new Set(coverage)],
          representation,
          geometryReady: false,
          alignmentReady: false,
          alignmentApplied: false,
          measurementSource: null,
          appliedMeasurements: [],
          qaStatus: errors.length ? 'source_preflight_failed' : 'source_selected_measurements_required',
          appliedToGeometry: false,
          capabilities: {
            previewOnly: viewKinds.includes('raster'),
            dicomMetadataParsed: dicomParsed,
            calibratedMeasurements: false,
            landmarksReviewed: false,
            ctSeriesCoherent: false,
            segmentationReviewed: false,
            levelNumberingReviewed: false,
            standingRegistrationReviewed: false,
            patientSpecificGeometry: false
          }
        }
      };
    }


    const RADIOGRAPHIC_MEASUREMENT_FIELDS = Object.freeze([
      Object.freeze({ key: 'pi', elementKey: 'measurementPi', label: 'Pelvic incidence', min: 30, max: 80, target: 'params' }),
      Object.freeze({ key: 'll', elementKey: 'measurementLl', label: 'Lumbar lordosis', min: 10, max: 80, target: 'params' }),
      Object.freeze({ key: 'tk', elementKey: 'measurementTk', label: 'Thoracic kyphosis', min: 10, max: 70, target: 'params' }),
      Object.freeze({ key: 'cl', elementKey: 'measurementCl', label: 'C2-C7 angle', min: -50, max: 80, target: 'params' }),
      Object.freeze({ key: 'pt', elementKey: 'measurementPt', label: 'Pelvic tilt', min: 5, max: 45, target: 'params' }),
      Object.freeze({ key: 'measuredSva', elementKey: 'measurementSva', label: 'C7 SVA', min: -30, max: 30, target: 'params' }),
      Object.freeze({ key: 'coronalMagnitude', elementKey: 'measurementPrimaryCobb', label: 'Primary Cobb', min: 0, max: 120, target: 'global' }),
      Object.freeze({ key: 'compensatoryCobb', elementKey: 'measurementSecondaryCobb', label: 'Secondary Cobb', min: 0, max: 100, target: 'global' }),
      Object.freeze({ key: 'trunkShift', elementKey: 'measurementTranslation', label: 'Apical translation', min: -150, max: 150, target: 'global' })
    ]);

    function setImagingMeasurementStatus(message, stateName = 'idle') {
      imagingEls.measurementStatus.textContent = message;
      imagingEls.measurementStatus.dataset.state = stateName;
    }

    function clearImagingMeasurementInputs() {
      RADIOGRAPHIC_MEASUREMENT_FIELDS.forEach(field => {
        const input = imagingEls[field.elementKey];
        input.value = '';
        input.removeAttribute('aria-invalid');
        clearImagingFieldOrigin(input);
      });
      imagingEls.measurementPrimaryDirection.value = 'preserve';
      clearImagingFieldOrigin(imagingEls.measurementPrimaryDirection);
    }

    // Where each worksheet value came from. "Transfer selected values" and
    // "Use current case as starting values" mark a field with its origin and
    // the exact text written (data-worksheet-source / data-worksheet-value); a
    // field still holding that text keeps the origin, any edit makes it the
    // user's own entry. Unedited case values are not measurements.
    const IMAGING_FIELD_ORIGINS = Object.freeze(['auto_beta', 'auto_beta_user_adjusted', 'manual_landmarks', 'case_default']);
    function imagingFieldOrigin(input) {
      const source = input?.dataset?.worksheetSource;
      return IMAGING_FIELD_ORIGINS.includes(source) && input.value === input.dataset.worksheetValue ? source : 'user_entered';
    }
    function clearImagingFieldOrigin(input) {
      if (!input?.dataset) return;
      delete input.dataset.worksheetSource;
      delete input.dataset.worksheetValue;
      input.removeAttribute('title');
    }

    function syncImagingMeasurementPlaceholders() {
      const placeholderValues = {
        pi: state.params.pi, ll: state.params.ll, tk: state.params.tk, cl: state.params.cl, pt: state.params.pt,
        measuredSva: Number.isFinite(state.params.measuredSva) ? state.params.measuredSva : 'not entered',
        coronalMagnitude: Math.abs(Number(state.globalDeformity.coronalMagnitude) || 0),
        compensatoryCobb: Math.abs(Number(state.globalDeformity.compensatoryCobb) || 0),
        trunkShift: Number(state.globalDeformity.trunkShift) || 0
      };
      // Prefixed so an empty field cannot be mistaken for a filled one.
      RADIOGRAPHIC_MEASUREMENT_FIELDS.forEach(field => {
        const value = placeholderValues[field.key];
        imagingEls[field.elementKey].placeholder = typeof value === 'number' ? `current ${Number(value.toFixed(1))}` : `current: ${value}`;
      });
    }

    // PI = PT + sacral slope, so a pelvic tilt at or above the incidence means
    // a zero or negative sacral slope, which is almost always a misplaced
    // femoral-head or S1 landmark. Checked against the values Apply would
    // leave in the case: the worksheet entry, or the unchanged case value.
    function imagingPelvicConsistencyError() {
      const rawPi = imagingEls.measurementPi.value.trim(), rawPt = imagingEls.measurementPt.value.trim();
      if (rawPi === '' && rawPt === '') return null;
      const pi = rawPi === '' ? Number(state.params.pi) : Number(rawPi);
      const pt = rawPt === '' ? Number(state.params.pt) : Number(rawPt);
      if (!Number.isFinite(pi) || !Number.isFinite(pt) || pt < pi) return null;
      const round = value => Number(value.toFixed(1));
      return `Pelvic tilt ${round(pt)}°${rawPt === '' ? ' (current case value)' : ''} is not smaller than pelvic incidence ${round(pi)}°${rawPi === '' ? ' (current case value)' : ''}. Because PI = PT + sacral slope, that means a sacral slope of ${round(pi - pt)}°: re-check the femoral-head and S1 landmarks before applying.`;
    }

    // The apex side and the sign of the apical translation depend on which
    // image side shows the patient's right. While that is not confirmed for a
    // staged frontal film, both are withheld rather than guessed.
    function imagingLateralityError(values) {
      const frontalStaged = Number(state.patientImaging?.sourceCounts?.frontal) > 0;
      if (!frontalStaged || (imagingEls.laterality?.value || 'unconfirmed') !== 'unconfirmed') return null;
      // An untouched copy of the case's own value is not read from this film.
      const caseDefault = input => typeof imagingFieldOrigin === 'function' && imagingFieldOrigin(input) === 'case_default';
      const sided = [];
      if (Object.prototype.hasOwnProperty.call(values, 'coronalDirection') && !caseDefault(imagingEls.measurementPrimaryDirection)) sided.push('the primary apex side');
      if (Number(values.trunkShift) && !caseDefault(imagingEls.measurementTranslation)) sided.push('a signed apical translation');
      if (!sided.length) return null;
      return `Confirm which side of the frontal film shows the patient's right (step 2, "Patient right is on the image") before applying ${sided.join(' or ')}. Until then, set Primary apex to "Preserve current" and leave the translation blank or 0.`;
    }

    function prefillImagingMeasurementsFromCurrentCase() {
      const values = {
        pi: state.params.pi, ll: state.params.ll, tk: state.params.tk, cl: state.params.cl, pt: state.params.pt,
        measuredSva: Number.isFinite(state.params.measuredSva) ? state.params.measuredSva : '',
        coronalMagnitude: Math.abs(Number(state.globalDeformity.coronalMagnitude) || 0),
        compensatoryCobb: Math.abs(Number(state.globalDeformity.compensatoryCobb) || 0),
        trunkShift: Number(state.globalDeformity.trunkShift) || 0
      };
      const markCaseDefault = input => {
        input.dataset.worksheetSource = 'case_default';
        input.dataset.worksheetValue = input.value;
        input.title = 'Current case value, not measured from the film. Edit it to enter your measurement; unedited case values are not applied.';
      };
      RADIOGRAPHIC_MEASUREMENT_FIELDS.forEach(field => {
        imagingEls[field.elementKey].value = String(values[field.key]);
        imagingEls[field.elementKey].removeAttribute('aria-invalid');
        markCaseDefault(imagingEls[field.elementKey]);
      });
      imagingEls.measurementPrimaryDirection.value = state.globalDeformity.coronalDirection === 'left' ? 'left' : 'right';
      markCaseDefault(imagingEls.measurementPrimaryDirection);
      setImagingMeasurementStatus('Current case values copied as a starting point. They were not extracted from the uploaded images: edit the ones you measured. Fields left unchanged are not applied or counted as measurements.', 'idle');
    }

    function readImagingMeasurements() {
      const values = {};
      const errors = [];
      imagingEls.measurementPrimaryDirection.removeAttribute('aria-invalid');
      RADIOGRAPHIC_MEASUREMENT_FIELDS.forEach(field => {
        const input = imagingEls[field.elementKey];
        const raw = input.value.trim();
        input.removeAttribute('aria-invalid');
        if (raw === '') return;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < field.min || value > field.max) {
          input.setAttribute('aria-invalid', 'true');
          errors.push(`${field.label} must be between ${field.min} and ${field.max}.`);
          return;
        }
        values[field.key] = value;
      });
      const direction = imagingEls.measurementPrimaryDirection.value;
      if (direction === 'left' || direction === 'right') values.coronalDirection = direction;
      const lateralityError = imagingLateralityError(values);
      if (lateralityError) {
        errors.push(lateralityError);
        if (Object.prototype.hasOwnProperty.call(values, 'coronalDirection')) imagingEls.measurementPrimaryDirection.setAttribute('aria-invalid', 'true');
        if (values.trunkShift) imagingEls.measurementTranslation.setAttribute('aria-invalid', 'true');
      }
      const pelvicError = imagingPelvicConsistencyError();
      if (pelvicError) {
        errors.push(pelvicError);
        imagingEls.measurementPt.setAttribute('aria-invalid', 'true');
      }
      return { values, errors };
    }

    // Per-field provenance for an apply: the worksheet origin of every value.
    const IMAGING_SOURCE_PHRASES = Object.freeze({
      user_entered: 'typed by you', manual_landmarks: 'from your manual landmarks',
      auto_beta: 'experimental automatic values you accepted', auto_beta_user_adjusted: 'experimental automatic values you adjusted'
    });
    function imagingMeasurementSourceSummary(sources) {
      const kinds = new Set(Object.values(sources));
      const auto = kinds.has('auto_beta') || kinds.has('auto_beta_user_adjusted');
      const measurementSource = kinds.size === 1 && kinds.has('user_entered') ? 'explicit_user_entered_from_staged_standing_images'
        : kinds.size === 1 && kinds.has('manual_landmarks') ? 'user_placed_manual_landmarks'
          : [...kinds].every(kind => kind === 'auto_beta' || kind === 'auto_beta_user_adjusted') ? 'experimental_local_auto_landmark_beta_user_accepted'
            : 'mixed';
      const qaStatus = auto ? 'experimental_auto_landmarks_applied_unvalidated'
        : kinds.has('manual_landmarks') ? 'manual_landmark_measurements_applied_to_reference_alignment'
          : 'manual_measurements_applied_to_reference_alignment';
      return { measurementSource, qaStatus, auto, manualLandmarks: kinds.has('manual_landmarks') };
    }
    // Values from the radiograph review panel carry its engine, landmark and
    // DICOM provenance (window.__SPINE_AUTOCAL__.provenanceRecord); values
    // typed by hand carry none, so no earlier record is left behind.
    function imagingReviewProvenance(sources) {
      const fromReview = Object.values(sources).some(source => source !== 'user_entered');
      const build = window.__SPINE_AUTOCAL__?.provenanceRecord;
      if (!fromReview || typeof build !== 'function') return null;
      try { return build(sources); } catch (_) { return null; }
    }

    // options.onlyKeys (from "Apply selected values to model") limits the
    // apply to those worksheet keys; the Apply button passes its click event.
    function applyImagingMeasurementsToModel(options) {
      if (state.patientImaging.status !== 'staged' || !['radiographs', 'hybrid'].includes(state.patientImaging.path)) {
        setImagingMeasurementStatus('Stage a standing frontal and lateral source set before applying measurements.', 'error');
        return false;
      }
      const onlyKeys = options && Array.isArray(options.onlyKeys) ? new Set(options.onlyKeys) : null;
      const { values: read, errors } = readImagingMeasurements();
      if (errors.length) {
        setImagingMeasurementStatus(errors.join(' '), 'error');
        announce('Radiographic measurements were not applied because one or more values are outside the declared model domain.');
        return false;
      }
      const fieldFor = key => key === 'coronalDirection' ? imagingEls.measurementPrimaryDirection
        : imagingEls[RADIOGRAPHIC_MEASUREMENT_FIELDS.find(field => field.key === key)?.elementKey];
      // Unedited case values copied by "Use current case as starting values"
      // stay case values: they are neither applied nor counted as measured.
      const values = {}, sources = {}, skippedCaseDefaults = [];
      Object.keys(read).forEach(key => {
        if (onlyKeys && !onlyKeys.has(key)) return;
        const origin = imagingFieldOrigin(fieldFor(key));
        if (origin === 'case_default') { skippedCaseDefaults.push(key); return; }
        values[key] = read[key];
        sources[key] = origin;
      });
      const appliedKeys = Object.keys(values);
      if (!appliedKeys.length) {
        setImagingMeasurementStatus(skippedCaseDefaults.length
          ? 'Nothing to apply — the worksheet still holds only the current case values copied as a starting point, and those are not measurements. Edit the fields you measured, or transfer values from the review above, then press Apply again.'
          : 'Nothing to apply — every worksheet field is empty. Type a measurement into any field below, or run the beta above and press "Transfer selected values to worksheet", then press Apply again.', 'error');
        return false;
      }

      ['pi', 'll', 'tk', 'cl', 'pt'].forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(values, key)) return;
        state.params[key] = values[key];
        const slider = $(`${key}Slider`);
        slider.value = String(values[key]);
        syncSliderVisual(slider);
      });
      if (Object.prototype.hasOwnProperty.call(values, 'measuredSva')) {
        state.params.measuredSva = values.measuredSva;
        state.provenance.measuredSva = ['auto_beta', 'auto_beta_user_adjusted'].includes(sources.measuredSva)
          ? 'experimental_auto_landmark_measurement_user_accepted' : 'manual_radiograph_measurement';
        els.measuredSvaInput.value = String(values.measuredSva);
        els.measuredSvaInput.removeAttribute('aria-invalid');
      }
      if (Object.prototype.hasOwnProperty.call(values, 'coronalMagnitude')) state.globalDeformity.coronalMagnitude = Math.abs(values.coronalMagnitude);
      if (Object.prototype.hasOwnProperty.call(values, 'compensatoryCobb')) state.globalDeformity.compensatoryCobb = Math.abs(values.compensatoryCobb);
      if (Object.prototype.hasOwnProperty.call(values, 'trunkShift')) state.globalDeformity.trunkShift = values.trunkShift;
      if (Object.prototype.hasOwnProperty.call(values, 'coronalDirection')) state.globalDeformity.coronalDirection = values.coronalDirection;

      markAnatomyPresetCustom();
      const provenance = imagingMeasurementSourceSummary(sources);
      state.patientImaging = {
        ...state.patientImaging,
        alignmentReady: true,
        alignmentApplied: true,
        measurementSource: provenance.measurementSource,
        // Keys stay plain strings for existing readers; the origin of each is
        // in measurementSources (user_entered, manual_landmarks, auto_beta,
        // auto_beta_user_adjusted). Case defaults left unedited are listed
        // separately and were not applied.
        appliedMeasurements: appliedKeys,
        measurementSources: { ...sources },
        caseDefaultsNotApplied: skippedCaseDefaults,
        autoCalibration: imagingReviewProvenance(sources),
        qaStatus: provenance.qaStatus,
        appliedToGeometry: false
      };
      syncThreePlaneCaseControls();
      syncAnatomyLabControls();
      setView('pre', false);
      refreshApplication({ markPrediction: true });
      renderPatientImagingState();
      renderImagingPreflight({ valid: true, errors: [], summary: state.patientImaging });
      syncImagingMeasurementPlaceholders();
      const bySource = Object.keys(IMAGING_SOURCE_PHRASES).map(kind => {
        const count = Object.values(sources).filter(source => source === kind).length;
        return count ? `${count} ${IMAGING_SOURCE_PHRASES[kind]}` : null;
      }).filter(Boolean).join(', ');
      const keptDefaults = skippedCaseDefaults.length ? ` ${skippedCaseDefaults.length} unchanged case value${skippedCaseDefaults.length === 1 ? ' was' : 's were'} kept as case values, not counted as measured.` : '';
      setImagingMeasurementStatus(`${appliedKeys.length} measurement${appliedKeys.length === 1 ? '' : 's'} applied to the reference-atlas alignment (${bySource}).${keptDefaults} Patient-specific bone geometry remains unavailable.`, 'applied');
      if (provenance.auto) {
        showToast('Experimental auto measurements applied');
        announce('Measurements including user-accepted experimental automatic landmark values were applied to the reference-atlas alignment. The landmark detector is not clinically validated. Exact patient bone geometry was not created.');
      } else if (provenance.manualLandmarks) {
        showToast('Manual landmark measurements applied');
        announce('Measurements from your manually placed landmarks were applied to the reference-atlas alignment. Exact patient bone geometry was not created.');
      } else {
        showToast('Measured alignment applied');
        announce('Reviewed radiographic measurements were applied to the reference-atlas alignment. Exact patient bone geometry was not created.');
      }
      if (imagingEls.dialog.open) imagingEls.dialog.close();
      const reviewStep = document.querySelector('.workflow-nav a[data-step="2"]');
      if (reviewStep) reviewStep.click();
      return true;
    }

    function renderPatientImagingState() {
      const imaging = state.patientImaging;
      if (imaging.status !== 'staged') {
        demoEls.imagingSummary.textContent = 'No patient imaging staged. Atlas reference anatomy is active.';
        return;
      }
      const counts = imaging.sourceCounts;
      const standingLabel = counts.frontal && counts.lateral ? 'standing pair' : counts.frontal ? 'standing frontal film' : counts.lateral ? 'standing lateral film' : 'standing source';
      const sourceLabel = imaging.path === 'radiographs'
        ? standingLabel
        : imaging.path === 'ct'
          ? `${counts.ct} CT slices`
          : `${standingLabel} + ${counts.ct} CT slices`;
      const capitalized = sourceLabel.charAt(0).toUpperCase() + sourceLabel.slice(1);
      if (!imaging.alignmentApplied) {
        demoEls.imagingSummary.textContent = `${capitalized} staged locally - no measurements applied yet - atlas reference anatomy remains active.`;
        return;
      }
      // Name what came from the film and what is still the case value, so an
      // unmeasured default cannot pass for a film measurement.
      const applied = appliedImagingKeys(imaging);
      const fromFilm = applied.map(key => IMAGING_MEASUREMENT_SHORT_LABELS[key]).filter(Boolean);
      const notMeasured = ['pi', 'll', 'tk', 'cl', 'pt'].filter(key => !applied.includes(key)).map(key => IMAGING_MEASUREMENT_SHORT_LABELS[key]);
      demoEls.imagingSummary.textContent = `${capitalized} staged - from the film: ${fromFilm.join(', ') || 'none'}${notMeasured.length ? ` - not measured, case values kept: ${notMeasured.join(', ')}` : ''} - reference bone geometry retained.`;
    }

    const IMAGING_MEASUREMENT_SHORT_LABELS = Object.freeze({
      pi: 'PI', ll: 'LL', tk: 'TK', cl: 'C2–C7', pt: 'PT', measuredSva: 'SVA',
      coronalMagnitude: 'primary Cobb', compensatoryCobb: 'secondary Cobb', trunkShift: 'apical translation', coronalDirection: 'apex side'
    });
    // appliedMeasurements holds keys, or {key, source} records.
    const appliedImagingKeys = imaging => (imaging?.appliedMeasurements || [])
      .map(item => typeof item === 'string' ? item : item && item.key).filter(Boolean);

    // The representation ids are internal state, not user-facing copy.
    const IMAGING_REPRESENTATION_LABELS = Object.freeze({
      standing_dicom_pair_selected_unparsed: 'Standing DICOM pair staged; pixels are decoded when analysis runs',
      standing_dicom_pair_decoded: 'Standing DICOM pair staged; both headers and pixels decoded locally',
      standing_raster_pair_preview_only: 'Standing raster pair staged',
      ct_dicom_series_selected_unparsed_unsegmented: 'CT DICOM series staged; CT intake is not yet validated',
      hybrid_sources_selected_registration_unavailable: 'Standing pair and CT staged; registration is unavailable'
    });
    function imagingRepresentationLabel(representation) {
      if (IMAGING_REPRESENTATION_LABELS[representation]) return IMAGING_REPRESENTATION_LABELS[representation];
      const single = /^standing_(frontal|lateral)_only_(raster|dicom_decoded|dicom_selected_unparsed)$/.exec(String(representation || ''));
      if (!single) return 'Source set staged';
      const kind = single[2] === 'raster' ? 'image' : single[2] === 'dicom_decoded' ? 'DICOM (header and pixels decoded locally)' : 'DICOM';
      return `Standing ${single[1]} ${kind} staged alone; the ${single[1] === 'frontal' ? 'lateral' : 'frontal'} plane is not provided`;
    }

    function currentImagingSelection() {
      return {
        path: selectedImagingPath(),
        authorization: imagingEls.authorization.checked,
        // The single statement covers the burned-in pixel review.
        pixelReview: imagingEls.authorization.checked,
        frontalProjection: imagingEls.frontalProjection.value,
        frontalLaterality: imagingEls.laterality?.value || 'unconfirmed',
        frontalLateralitySource: imagingEls.laterality?.dataset.source || 'default',
        frontal: patientImagingSession.frontal,
        lateral: patientImagingSession.lateral,
        ctFiles: patientImagingSession.ctFiles,
        coverage: imagingCoverageValues()
      };
    }

    function renderImagingPreflight(result = null) {
      const current = result || { valid: false, errors: [], summary: state.patientImaging };
      const strong = imagingEls.preflight.querySelector('strong'), text = imagingEls.preflight.querySelector('p');
      if (current.pending) {
        imagingEls.preflight.dataset.state = 'checking';
        strong.textContent = 'Checking the selected files…';
        text.textContent = 'The DICOM header and thumbnail are read locally. Staging continues automatically when the check finishes.';
      } else if (current.changed) {
        imagingEls.preflight.dataset.state = 'error';
        strong.textContent = 'Films changed since staging';
        text.textContent = `The staged result no longer matches the films above. Press ${imagingEls.stage.textContent || 'Stage & analyze'} to use the current films.`;
      } else if (current.valid && current.ready) {
        const views = current.summary.views || [];
        imagingEls.preflight.dataset.state = 'ready';
        strong.textContent = `Ready: ${views.length === 2 ? 'frontal and lateral films' : `${views[0]} film only`}`;
        text.textContent = `${views.length === 1 ? `The ${views[0] === 'frontal' ? 'lateral' : 'frontal'} plane will be reported as not provided. ` : ''}${imagingEls.autoRun?.checked ? 'Staging runs the automatic beta straight away.' : 'Automatic analysis is off: stage, then run it from step 3.'}${views.includes('frontal') && (imagingEls.laterality?.value || 'unconfirmed') === 'unconfirmed' ? ' The patient side of the frontal film is not confirmed yet.' : ''}`;
      } else if (current.valid) {
        imagingEls.preflight.dataset.state = 'staged';
        strong.textContent = current.summary.alignmentApplied
          ? 'Reviewed alignment applied to reference anatomy'
          : 'Source set staged; automatic beta is ready for review';
        text.textContent = current.summary.alignmentApplied
          ? `${appliedImagingKeys(current.summary).length} explicit measurements drive the atlas pose. Exact patient bone geometry remains unavailable.`
          : `${imagingRepresentationLabel(current.summary.representation)}. Standing images (PNG, JPEG, WebP or single-frame DICOM) are analyzed locally by the experimental beta; review is required before transfer.`;
      } else if (current.errors?.length) {
        imagingEls.preflight.dataset.state = 'error';
        strong.textContent = 'Source preflight incomplete';
        text.textContent = current.errors.join(' ');
      } else {
        imagingEls.preflight.dataset.state = 'idle';
        strong.textContent = 'Nothing staged';
        text.textContent = 'Add a frontal or lateral film. No file name, patient name, MRN, UID, or pixel data is written to app storage.';
      }
    }

    // Re-validated on every change, so a requirement already met never stays
    // listed as missing.
    function refreshImagingPreflight() {
      const imaging = state.patientImaging;
      if (imaging.status === 'staged') {
        const staged = patientImagingSession.stagedFiles;
        const current = !staged || (staged.frontal === patientImagingSession.frontal && staged.lateral === patientImagingSession.lateral);
        renderImagingPreflight(current ? { valid: true, errors: [], summary: imaging } : { valid: false, changed: true, errors: [] });
        return;
      }
      if (imagingRestagePending && imagingChecksPending()) {
        renderImagingPreflight({ valid: false, pending: true, errors: [] });
        return;
      }
      if (!patientImagingSession.frontal && !patientImagingSession.lateral && imaging.status !== 'invalid') {
        renderImagingPreflight();
        return;
      }
      const result = validatePatientImagingSelection(currentImagingSelection());
      renderImagingPreflight(result.valid ? { ...result, ready: true } : result);
    }

    function syncPatientImagingControls() {
      const path = selectedImagingPath();
      const authorized = imagingEls.authorization.checked;
      const needsPair = path === 'radiographs' || path === 'hybrid';
      const needsCt = path === 'ct' || path === 'hybrid';
      imagingEls.frontalField.hidden = !needsPair;
      imagingEls.lateralField.hidden = !needsPair;
      imagingEls.previewGrid.hidden = !needsPair;
      imagingEls.ctField.hidden = !needsCt;
      imagingEls.frontalProjection.disabled = !authorized || !needsPair;
      if (imagingEls.laterality) imagingEls.laterality.disabled = !authorized || !needsPair;
      // Mirrors the single statement for scripted callers of the old control.
      imagingEls.pixelReview.checked = authorized;
      if (!authorized) setImagingDropStatus('Tick the statement in step 1 to add films. Nothing is read before that.', 'locked');
      else if (['locked', 'error', 'idle', undefined].includes(imagingEls.dropZone?.dataset.state)) setImagingDropStatus('Films are read only in this browser.', 'ready');
      imagingEls.stage.textContent = imagingEls.autoRun?.checked === false ? 'Stage films' : 'Stage & analyze';
      if (imagingEls.supineField) imagingEls.supineField.hidden = !needsPair;
      [[imagingEls.frontalInput, imagingEls.frontalPicker, needsPair], [imagingEls.lateralInput, imagingEls.lateralPicker, needsPair], [imagingEls.ctInput, imagingEls.ctPicker, needsCt], [imagingEls.supineInput, imagingEls.supinePicker, needsPair]].forEach(([input, picker, needed]) => {
        if (!input || !picker) return;
        input.disabled = !authorized || !needed;
        picker.setAttribute('aria-disabled', String(!authorized || !needed));
      });
      const stagedStandingSource = state.patientImaging.status === 'staged' && ['radiographs', 'hybrid'].includes(state.patientImaging.path);
      imagingEls.measurementStep.hidden = !stagedStandingSource;
      imagingEls.measurementApply.disabled = !stagedStandingSource;
      imagingEls.measurementPrefill.disabled = !stagedStandingSource;
      syncImagingMeasurementPlaceholders();
      if (stagedStandingSource && state.patientImaging.alignmentApplied) {
        setImagingMeasurementStatus(`${state.patientImaging.appliedMeasurements?.length || 0} reviewed measurements are currently applied to the atlas alignment.`, 'applied');
      } else if (stagedStandingSource) {
        setImagingMeasurementStatus('Source staged. Fill any worksheet field below — by typing it, or by transferring values from the beta above — then press Apply measurements.', 'idle');
      } else {
        setImagingMeasurementStatus('Source staging is required before measurements can be applied.', 'idle');
      }
      renderImagingFileStatus();
      syncImagingSlotControls();
      renderFrontalLateralityNote();
      refreshImagingPreflight();
    }

    function stagePatientImagingFromSession() {
      // A DICOM header check still running decides whether the file can be
      // analyzed at all, so staging waits for it and then continues itself.
      if (imagingChecksPending()) {
        imagingRestagePending = true;
        renderImagingPreflight({ valid: false, pending: true, errors: [] });
        return false;
      }
      imagingRestagePending = false;
      const result = validatePatientImagingSelection(currentImagingSelection());
      renderImagingPreflight(result);
      if (!result.valid) {
        state.patientImaging = { ...result.summary, status: 'invalid' };
        renderPatientImagingState();
        announce('Patient imaging source preflight is incomplete. Review the listed requirements.');
        return false;
      }
      state.patientImaging = {
        ...result.summary,
        sourceCounts: { ...result.summary.sourceCounts },
        sourceKinds: { ...result.summary.sourceKinds },
        coverage: [...result.summary.coverage],
        capabilities: { ...result.summary.capabilities }
      };
      patientImagingSession.stagedFiles = { frontal: patientImagingSession.frontal, lateral: patientImagingSession.lateral };
      clearImagingMeasurementInputs();
      syncPatientImagingControls();
      renderPatientImagingState();
      scrollImagingBodyTo(imagingEls.measurementStep);
      // Auto-calibration starts a frame later, so the announcement must not
      // claim that nothing was inferred when it is about to run.
      const autoRunPending = imagingEls.autoRun?.checked
        && ['radiographs', 'hybrid'].includes(state.patientImaging.path)
        && Boolean(patientImagingSession.frontal || patientImagingSession.lateral);
      const staged = result.summary.views.length === 2 ? 'Standing pair' : `Standing ${result.summary.views[0] || 'source'} film`;
      showToast(autoRunPending ? `${staged} staged - analyzing` : `${staged} staged - enter measurements`);
      announce(autoRunPending
        ? `${staged} staged locally. Automatic calibration is running on the local pixels; review the experimental result before transferring any value.`
        : `${staged} staged locally. No image values were inferred. Run the automatic beta or enter reviewed radiographic measurements to update the reference-atlas alignment.`);
      return true;
    }

    function clearPatientImagingSession() {
      // Demo-case loads and API clears call this function directly rather than
      // clicking the Clear button. Invalidate any pending detector work first.
      window.__SPINE_AUTOCAL__?.clearSession?.('Local files and beta results cleared.');
      revokeImagingPreview('frontal');
      revokeImagingPreview('lateral');
      patientImagingSession.frontal = null;
      patientImagingSession.lateral = null;
      patientImagingSession.supine = null;
      patientImagingSession.stagedFiles = null;
      imagingRestagePending = false;
      if (imagingEls.supineInput) imagingEls.supineInput.value = '';
      patientImagingSession.ctFiles = [];
      [imagingEls.frontalInput, imagingEls.lateralInput, imagingEls.ctInput].forEach(input => { input.value = ''; });
      // The session-level statement is kept: replacing a film must not mean
      // attesting again. It is forgotten on page exit (see the pagehide handler).
      document.querySelectorAll('.imaging-coverage-input').forEach(input => { input.checked = false; delete input.dataset.userSet; });
      applyFrontalLaterality('unconfirmed', 'default');
      setImagingAssignNote('');
      if (imagingEls.clearConfirm) imagingEls.clearConfirm.hidden = true;
      if (imagingEls.requestClear) imagingEls.requestClear.hidden = false;
      state.patientImaging = {
        status: 'none', path: null, privacyMode: PATIENT_IMAGING_MODEL.privacyMode,
        sourceCounts: { frontal: 0, lateral: 0, ct: 0 }, totalBytes: 0,
        representation: 'atlas_reference', geometryReady: false, alignmentReady: false,
        qaStatus: 'not_started', appliedToGeometry: false, alignmentApplied: false,
        measurementSource: null, appliedMeasurements: []
      };
      clearImagingMeasurementInputs();
      syncPatientImagingControls();
      renderImagingPreflight();
      renderPatientImagingState();
      return true;
    }

    function syncCaseExamplePreview() {
      const example = CASE_EXAMPLES[demoEls.select.value] || CASE_EXAMPLES['neutral-reference'];
      const limitations = example.limitations.length ? ` ${example.limitations.join(' ')}` : '';
      const context = example.reportedContext.boneQuality ? ' Context only; geometry is intentionally unchanged.' : '';
      demoEls.description.textContent = `${example.description}${limitations}${context}`;
    }

    function applyCaseExample(caseId) {
      const seed = resolveCaseExampleSeed(caseId);
      if (!validateCaseExampleSeed(seed)) throw new RangeError(`Example case failed validation: ${caseId}`);
      // Flush any pending edit so the case being replaced is one undo step.
      if (typeof checkpointCaseHistory === 'function') checkpointCaseHistory();
      if (typeof cancelProcedureEdit === 'function') cancelProcedureEdit({ silent: true });
      const clearedImaging = Boolean(state.patientImaging.status !== 'none'
        || patientImagingSession.frontal || patientImagingSession.lateral || patientImagingSession.ctFiles.length);
      if (clearedImaging) clearPatientImagingSession();
      if (state.inspection.active && typeof exitInspectionMode === 'function') exitInspectionMode();
      state.params = { ...seed.params };
      state.provenance = { ...seed.provenance };
      state.assumptions = { ...seed.assumptions };
      state.globalDeformity = { ...seed.globalDeformity };
      state.levelFactors = Object.fromEntries(Object.entries(seed.levelFactors).map(([levelId, factors]) => [levelId, { ...factors }]));
      state.itinerary = [];
      state.constructComparisons = [];
      state.caseContext = {
        exampleId: seed.example.id,
        label: seed.example.label,
        featureTags: seed.example.featureTags.map(tag => ({ ...tag })),
        reportedContext: { ...seed.example.reportedContext },
        limitations: [...seed.example.limitations]
      };
      state.inspection = {
        levelId: seed.example.focusLevelId || (ANATOMY_LEVEL_IDS.includes(els.levelSelect.value) ? els.levelSelect.value : 'L4-L5'),
        scope: 'level', explode: false, active: false
      };
      nextProcedureId = 1;
      ['pi', 'll', 'tk', 'cl', 'pt'].forEach(key => {
        const input = $(`${key}Slider`);
        input.value = String(state.params[key]);
        syncSliderVisual(input);
      });
      els.measuredSvaInput.value = Number.isFinite(state.params.measuredSva) ? String(state.params.measuredSva) : '';
      setFieldError(els.measuredSvaInput, null);
      if (typeof syncMeasuredSvaHint === 'function') syncMeasuredSvaHint();
      // A loaded example is a new case, so the optional age starts empty.
      state.demographics = { ageYears: null };
      if ($('ageInput')) { $('ageInput').value = ''; setFieldError($('ageInput'), null); }
      labEls.levelSelect.value = state.inspection.levelId;
      renderItinerary();
      if (sceneReady) rebuildHardware();
      setView('pre', false);
      syncAnatomyLabControls();
      syncThreePlaneCaseControls();
      demoEls.select.value = seed.example.id;
      syncCaseExamplePreview();
      if (sceneReady) {
        applyModelTargets(true);
        resetCameraView({ announceChange: false });
      }
      if (typeof checkpointCaseHistory === 'function') {
        checkpointCaseHistory();
        markCaseBaseline();
      }
      if (typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('spine:case-restored', { detail: { source: 'example' } }));
      showToast(`${seed.example.label} loaded`, caseHistoryUndoAction());
      announce(`${seed.example.label} example loaded. All prior procedures, assumptions, inspection state, level edits${clearedImaging ? ', and local imaging references' : ''} were cleared before applying the authored example.`);
      return true;
    }

    const labLevelLabel = levelId => levelId === 'C0-C1' ? 'Occiput\u2013C1' : levelId.replace('-', '\u2013');
    const formatLabValue = (value, unit, signed = false) => {
      const normalized = Math.abs(value) < 0.0001 ? 0 : value;
      const prefix = signed && normalized > 0 ? '+' : '';
      return `${prefix}${Number.isInteger(normalized) ? normalized.toFixed(0) : normalized.toFixed(1)}${unit}`;
    };

    function populateAnatomyLevelSelect() {
      const groups = [
        ['Craniovertebral', levelId => levelId === 'C0-C1' || levelId === 'C1-C2'],
        ['Subaxial cervical', levelId => levelId.startsWith('C') && levelId !== 'C0-C1' && levelId !== 'C1-C2'],
        ['Thoracic', levelId => levelId.startsWith('T')],
        ['Lumbar / lumbosacral', levelId => levelId.startsWith('L')]
      ];
      labEls.levelSelect.replaceChildren();
      groups.forEach(([label, predicate]) => {
        const group = document.createElement('optgroup');
        group.label = label;
        ANATOMY_LEVEL_IDS.filter(predicate).forEach(levelId => {
          const option = document.createElement('option');
          option.value = levelId;
          option.textContent = labLevelLabel(levelId);
          group.append(option);
        });
        labEls.levelSelect.append(group);
      });
      labEls.levelSelect.value = state.inspection.levelId;
    }

    function invokePathologyHook() {
      if (typeof applyModelTargets === 'function' && sceneReady) applyModelTargets();
      else if (typeof applyPathologyTargets === 'function') applyPathologyTargets();
      if (typeof updateGeometryStatus === 'function') updateGeometryStatus();
      if (typeof renderConstructComparisons === 'function') renderConstructComparisons();
      if (typeof updatePostoperativeSurveillance === 'function') updatePostoperativeSurveillance();
      if (typeof updateMechanicsSummary === 'function') updateMechanicsSummary();
      if (typeof updateShapeStatus === 'function') updateShapeStatus();
      if (typeof updateCanvasDescription === 'function') updateCanvasDescription();
      if (typeof scheduleCaseCheckpoint === 'function') scheduleCaseCheckpoint();
    }

    function selectedInspectionScope() {
      const value = document.querySelector('input[name="inspectionScope"]:checked')?.value;
      return ['body', 'implant', 'level'].includes(value) ? value : 'level';
    }

    function syncInspectionSummary() {
      const scope = selectedInspectionScope();
      const levelId = labEls.levelSelect.value;
      const level = labLevelLabel(levelId);
      const superior = LEVEL_BY_ID.get(levelId)?.superior || level;
      const base = scope === 'body'
        ? `Ready to isolate ${superior} only (the superior vertebra of ${level}).`
        : `Ready to isolate the entire ${level} motion segment.`;
      labEls.inspectionSummary.textContent = labEls.inspectionExplode.checked
        ? `${base} Non-anatomic inspection layout\u2014measurements, containment and collisions disabled.`
        : base;
    }

    function summarizeCurrentLevel() {
      const levelId = labEls.levelSelect.value;
      const factor = state.levelFactors[levelId];
      if (!factor) return;
      const changed = [
        factor.discHeightLoss !== 0, factor.sagittalWedge !== 0, factor.coronalWedge !== 0,
        factor.axialRotation !== 0, factor.apTranslation !== 0, factor.lateralTranslation !== 0,
        factor.facetHypertrophy !== 0, factor.osteophyteBurden !== 0, factor.morphologyVariant !== 'typical',
        factor.bodyWidthScale !== 1, factor.bodyDepthScale !== 1, factor.pedicleScale !== 1, factor.canalScale !== 1
      ].filter(Boolean).length;
      const morphologyLabel = labEls.morphologyVariant.options[labEls.morphologyVariant.selectedIndex]?.text || 'Typical reference';
      const craniovertebralNote = ['C0-C1', 'C1-C2'].includes(levelId)
        ? ' Joint cartilage is shown; disc-height loss and vertebral-body topology transforms do not apply.'
        : '';
      labEls.levelSummary.textContent = (changed === 0
        ? `${labLevelLabel(levelId)} uses neutral reference factors.`
        : `${labLevelLabel(levelId)} has ${changed} customized geometric factor${changed === 1 ? '' : 's'} \u00B7 ${morphologyLabel}.`) + craniovertebralNote;
    }

    function syncPresetDescription() {
      const preset = DEFORMITY_PRESETS[state.globalDeformity?.preset];
      labEls.presetDescription.textContent = preset?.description
        || 'Custom authored geometry and standing-alignment context. No diagnosis, correction target, or outcome is inferred.';
    }

    function syncCervicalModifierSummary() {
      const global = state.globalDeformity || {};
      const modifiers = classifyCervicalModifiers({
        cervicalSva: Number(global.cervicalSva),
        cbva: Number(global.cbva),
        t1Slope: Number(global.t1Slope),
        cervicalLordosis: Number(state.params.cl)
      });
      const mismatch = Number.isFinite(modifiers.mismatch) ? ` (${signedDegree(modifiers.mismatch)})` : '';
      labEls.cervicalModifierSummary.textContent = `cSVA ${modifiers.cervicalSva} \u00B7 CBVA ${modifiers.cbva} \u00B7 T1S\u2212CL ${modifiers.t1SlopeMinusCl}${mismatch}`;
      labEls.cervicalModifierSummary.setAttribute(
        'aria-label',
        `Ames-style reference bands: C2 to C7 sagittal vertical axis ${modifiers.cervicalSva}, chin-brow vertical angle ${modifiers.cbva}, T1 slope minus C2 to C7 angle ${modifiers.t1SlopeMinusCl}${Number.isFinite(modifiers.mismatch) ? `, mismatch ${signedDegree(modifiers.mismatch)}` : ''}. Not a diagnosis or correction target.`
      );
    }

    function markAnatomyPresetCustom() {
      state.globalDeformity.preset = 'custom';
      state.caseContext = { exampleId: null, label: null, featureTags: [], reportedContext: {}, limitations: [] };
      labEls.preset.value = 'custom';
      syncPresetDescription();
    }

    /* The committed value of each coronal/axial case field, as the field shows
       it. Shared by the sync below and by the blur handler that reverts an
       invalid entry. */
    const THREE_PLANE_CASE_FIELDS = Object.freeze([
      Object.freeze({ elementKey: 'primaryCobbInput', stateKey: 'coronalMagnitude', label: 'Primary Cobb input', unit: '°', display: global => Math.abs(Number(global.coronalMagnitude) || 0) }),
      Object.freeze({ elementKey: 'compensatoryCobbInput', stateKey: 'compensatoryCobb', label: 'Secondary Cobb input', unit: '°', display: global => Math.abs(Number(global.compensatoryCobb) || 0) }),
      Object.freeze({ elementKey: 'apicalTranslationInput', stateKey: 'trunkShift', label: 'Apical translation', unit: ' mm', display: global => Number(global.trunkShift) || 0 }),
      Object.freeze({ elementKey: 'primaryAxialRotationInput', stateKey: 'axialRotation', label: 'Apical axial rotation', unit: '°', display: global => Number(global.axialRotation) || 0 })
    ]);

    // Inline message under a number field. aria-invalid alone had no visible
    // style on these inputs, so an out-of-range entry looked accepted.
    function setFieldError(input, message) {
      if (!input) return;
      const errorId = `${input.id}Error`;
      let node = $(errorId);
      if (!message) {
        input.removeAttribute('aria-invalid');
        if (node) { node.hidden = true; node.textContent = ''; }
        return;
      }
      input.setAttribute('aria-invalid', 'true');
      if (!node && typeof document.createElement === 'function') {
        node = document.createElement('p');
        node.id = errorId;
        node.className = 'field-error';
        const anchor = input.closest?.('.correction-input-wrap') || input;
        anchor.insertAdjacentElement?.('afterend', node);
        const describedBy = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        if (!describedBy.includes(errorId)) input.setAttribute('aria-describedby', [...describedBy, errorId].join(' '));
      }
      if (node) { node.hidden = false; node.textContent = message; }
    }

    // Plain-language reason a number field was rejected: range, step, or both.
    function numberFieldProblem(input, unit = '') {
      const min = input.min === '' ? null : Number(input.min);
      const max = input.max === '' ? null : Number(input.max);
      const step = Number(input.step);
      const range = min !== null && max !== null ? `${min} to ${max}${unit}` : '';
      if (input.validity?.stepMismatch && Number.isFinite(step) && step > 0) {
        return step === 1
          ? `Use whole numbers${range ? ` (${range})` : ''}.`
          : `Use ${step}${unit.trim() === 'mm' ? ' mm' : '°'} increments (for example 12 or 12.5)${range ? `, ${range}` : ''}.`;
      }
      return range ? `Enter ${range}.` : 'Enter a number.';
    }

    function syncThreePlaneCaseControls() {
      const global = state.globalDeformity || createDefaultGlobalDeformity();
      // Never rewrite the field the user is typing in: select-all + Backspace
      // used to write "0" back mid-edit, so typing "-20" produced "0-20" and a
      // negative translation or rotation could not be entered at all.
      const active = typeof document.activeElement !== 'undefined' ? document.activeElement : null;
      THREE_PLANE_CASE_FIELDS.forEach(field => {
        const input = els[field.elementKey];
        if (input === active) return;
        input.value = String(field.display(global));
        setFieldError(input, null);
      });
      els.primaryCurveDirection.value = global.coronalDirection === 'left' ? 'left' : 'right';
      const flexibilityPercent = Math.round(Math.max(0, Math.min(1, Number(global.secondaryFlexibility) || 0)) * 100);
      els.secondaryFlexibilityInput.value = String(flexibilityPercent);
      els.secondaryFlexibilityInput.style.setProperty('--progress', `${flexibilityPercent}%`);
      els.secondaryFlexibilityValue.textContent = `${flexibilityPercent}%`;
      els.coronalCompensationInput.checked = state.assumptions.applyCoronalCompensation === true;
      // Was missing, so an example that set this assumption left the checkbox
      // disagreeing with the state actually driving the model.
      els.reciprocalAssumptionInput.checked = state.assumptions.applyReciprocalResponse === true;
    }

    function syncAnatomyLabControls() {
      const global = state.globalDeformity;
      labEls.preset.value = global.preset;
      labEls.coronalDirection.value = global.coronalDirection;
      labEls.lowerExtremitiesVisible.checked = global.lowerExtremitiesVisible && state.layers?.lowerLimbs !== false;
      if (layerEls?.lowerLimbs) layerEls.lowerLimbs.checked = labEls.lowerExtremitiesVisible.checked;
      LAB_GLOBAL_RANGES.forEach(field => {
        labEls[field.inputKey].value = String(global[field.stateKey]);
        syncRangeFill(labEls[field.inputKey]);
        labEls[field.outputKey].textContent = formatLabValue(global[field.stateKey], field.unit, field.signed);
      });
      syncPresetDescription();
      syncCervicalModifierSummary();
      syncThreePlaneCaseControls();

      const levelId = ANATOMY_LEVEL_IDS.includes(labEls.levelSelect.value) ? labEls.levelSelect.value : state.inspection.levelId;
      labEls.levelSelect.value = levelId;
      labEls.selectedLevelTag.textContent = labLevelLabel(levelId);
      const factor = state.levelFactors[levelId];
      const craniovertebral = ['C0-C1', 'C1-C2'].includes(levelId);
      labEls.discHeightLoss.disabled = craniovertebral;
      labEls.morphologyVariant.disabled = craniovertebral;
      labEls.pedicleScale.disabled = craniovertebral;
      labEls.canalScale.disabled = craniovertebral;
      labEls.morphologyVariant.value = MORPHOLOGY_VARIANTS.includes(factor.morphologyVariant) ? factor.morphologyVariant : 'typical';
      LAB_LEVEL_RANGES.forEach(field => {
        const displayValue = factor[field.stateKey] * field.scale;
        labEls[field.inputKey].value = String(displayValue);
        syncRangeFill(labEls[field.inputKey]);
        labEls[field.outputKey].textContent = formatLabValue(displayValue, field.unit, field.signed);
      });
      labEls.inspectionExplode.checked = state.inspection.explode;
      const scopeRadio = document.querySelector(`input[name="inspectionScope"][value="${state.inspection.scope}"]`);
      if (scopeRadio) scopeRadio.checked = true;
      summarizeCurrentLevel();
      syncInspectionSummary();
    }

    function applyAnatomyPreset(presetId) {
      const preset = DEFORMITY_PRESETS[presetId];
      if (!preset) return;
      state.caseContext = { exampleId: null, label: null, featureTags: [], reportedContext: {}, limitations: [] };
      state.globalDeformity = { ...createDefaultGlobalDeformity(), ...preset.global, preset: presetId };
      state.levelFactors = createDefaultLevelFactors();
      Object.entries(preset.levels).forEach(([levelId, overrides]) => {
        if (state.levelFactors[levelId]) Object.assign(state.levelFactors[levelId], overrides);
      });
      Object.entries(preset.alignment).forEach(([key, value]) => {
        if (key in state.params) state.params[key] = value;
      });
      ['pi', 'll', 'tk', 'cl', 'pt'].forEach(key => {
        const input = $(`${key}Slider`);
        if (!input || !Number.isFinite(state.params[key])) return;
        input.value = String(state.params[key]);
        syncSliderVisual(input);
      });
      els.measuredSvaInput.value = Number.isFinite(state.params.measuredSva) ? String(state.params.measuredSva) : '';
      els.measuredSvaInput.removeAttribute('aria-invalid');
      state.provenance.measuredSva = Number.isFinite(state.params.measuredSva) ? 'authored_reference_preset' : 'not_provided';
      syncAnatomyLabControls();
      refreshApplication({ markPrediction: true });
      announce(`${labEls.preset.options[labEls.preset.selectedIndex]?.text || 'Anatomy'} measurement-pattern preset applied. Numeric alignment and authored geometry were synchronized; no diagnosis, correction target, or mechanics were inferred.`);
    }

    function updateGlobalAnatomyFactor(field) {
      const value = Number(labEls[field.inputKey].value);
      if (!Number.isFinite(value)) return;
      state.globalDeformity[field.stateKey] = value;
      markAnatomyPresetCustom();
      syncRangeFill(labEls[field.inputKey]);
      labEls[field.outputKey].textContent = formatLabValue(value, field.unit, field.signed);
      syncCervicalModifierSummary();
      syncThreePlaneCaseControls();
      refreshApplication({ markPrediction: true });
    }

    function updateCurrentLevelFactor(field) {
      const levelId = labEls.levelSelect.value;
      const value = Number(labEls[field.inputKey].value);
      if (!state.levelFactors[levelId] || !Number.isFinite(value)) return;
      state.levelFactors[levelId][field.stateKey] = value / field.scale;
      markAnatomyPresetCustom();
      syncRangeFill(labEls[field.inputKey]);
      labEls[field.outputKey].textContent = formatLabValue(value, field.unit, field.signed);
      summarizeCurrentLevel();
      invokePathologyHook();
    }

    function resetCurrentAnatomyLevel() {
      const levelId = labEls.levelSelect.value;
      state.levelFactors[levelId] = createDefaultLevelFactor();
      markAnatomyPresetCustom();
      syncAnatomyLabControls();
      invokePathologyHook();
      announce(`${labLevelLabel(levelId)} geometric factors reset.`);
    }

    function resetAllAnatomyFactors() {
      state.inspection = { levelId: labEls.levelSelect.value, scope: selectedInspectionScope(), explode: false, active: false };
      if (typeof exitInspectionMode === 'function') exitInspectionMode();
      applyAnatomyPreset('neutral');
      announce('All Anatomy Lab geometry and standing-alignment context reset to the neutral reference pattern.');
    }

    /* Track fill for any range input. Only the case sliders and the secondary
       flexibility slider used to set --progress, so every Anatomy Lab slider
       showed a 50% fill whatever its value. */
    function syncRangeFill(input) {
      if (!input?.style?.setProperty) return;
      const min = Number(input.min);
      const max = Number(input.max);
      const value = Number(input.value);
      const fraction = Number.isFinite(min) && Number.isFinite(max) && max > min && Number.isFinite(value)
        ? Math.min(1, Math.max(0, (value - min) / (max - min)))
        : .5;
      input.style.setProperty('--progress', `${Number((fraction * 100).toFixed(3))}%`);
    }

    function syncSliderVisual(input) {
      const key = input.dataset.param;
      syncRangeFill(input);
      const output = $(`${key}Value`);
      if (output) output.querySelector('span').textContent = String(Number(input.value));
    }

    function populateLevelSelect() {
      const labels = { cervical: 'Cervical', thoracic: 'Thoracic / Junctional', lumbar: 'Lumbar', pelvis: 'Pelvis & SI joints' };
      els.levelSelect.replaceChildren();
      /* Motion segments and vertebral bodies go in separate groups, and every
         body option names the two discs it spans. Picking "L4 body" when you
         meant "L4-L5" is the single most likely mistake this change introduces,
         and an unlabelled "L4" sitting next to "L4-L5" in one list invites it. */
      const appendGroup = (label, targets) => {
        if (!targets.length) return;
        const group = document.createElement('optgroup');
        group.label = label;
        targets.forEach(level => {
          const option = document.createElement('option');
          option.value = level.id;
          option.textContent = level.kind === 'vertebral_body'
            ? `${displayLevel(level.id)} — spans ${displayLevel(level.cranialSegmentId)} and ${displayLevel(level.caudalSegmentId)}`
            : displayLevel(level.id);
          group.append(option);
        });
        els.levelSelect.append(group);
      };
      for (const region of ['cervical', 'thoracic', 'lumbar', 'pelvis']) {
        const inRegion = SURGICAL_TARGETS.filter(level => level.region === region);
        const bodies = inRegion.filter(level => level.kind === 'vertebral_body');
        appendGroup(labels[region], inRegion.filter(level => level.kind !== 'vertebral_body'));
        appendGroup(`${labels[region]} · vertebral bodies (corpectomy, VCR, augmentation)`, bodies);
      }
      els.levelSelect.value = 'L4-L5';
    }

    function populateProcedureSelect(preferredId = '') {
      const level = LEVEL_BY_ID.get(els.levelSelect.value);
      const compatible = Object.entries(PROCEDURES).filter(([, procedure]) => isProcedureCompatible(procedure, level));
      els.procedureSelect.replaceChildren();
      compatible.forEach(([id, procedure]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = procedure.name;
        els.procedureSelect.append(option);
      });
      if (preferredId && compatible.some(([id]) => id === preferredId)) els.procedureSelect.value = preferredId;
      else if (level?.region === 'lumbar' && compatible.some(([id]) => id === 'alif')) els.procedureSelect.value = 'alif';
      els.compatibilityCopy.textContent = `Showing ${level?.region || ''}-compatible procedures at ${displayLevel(level?.id || '')}`;
      updateImpactPreview();
    }

    let lastImpactPreviewKey = null;
    function updateImpactPreview({ preserveEditorValues = true } = {}) {
      const procedure = PROCEDURES[els.procedureSelect.value];
      const level = LEVEL_BY_ID.get(els.levelSelect.value);
      if (!procedure || !level) {
        lastImpactPreviewKey = null;
        els.impactPreview.innerHTML = '<div><strong>Choose a procedure</strong><span>Modeled effect and implant will appear here</span></div><span class="angle-chip">—</span>';
        els.correctionInput.value = '0';
        els.correctionInput.disabled = true;
        [els.coronalCorrectionInput, els.axialCorrectionInput, els.translationCorrectionInput].forEach(input => {
          input.value = '0'; input.disabled = true;
        });
        state.editorCorrectionSource = 'not_applicable';
        state.editorComparisonPrefill = null;
        return;
      }
      updateImplantConfiguration();
      const correctionPolicy = correctionPolicyFor(procedure, level);
      const planePolicy = procedureThreePlanePolicyFor(els.procedureSelect.value, level);
      const posteriorOptionalAndOff = OPTIONAL_POSTERIOR_FIXATION_PROCEDURES.has(els.procedureSelect.value)
        && implantEls.supplementalPosterior.checked === false;
      const hardwareDescription = posteriorOptionalAndOff
        ? `${procedure.interbodyApproach?.toUpperCase() || 'Interbody'} cage envelope · interbody-only construct · no posterior screws/rods`
        : procedure.hardware;
      // Name what the default does to the reported metrics (per spanned disc),
      // not the target's region: a junction body used to read "local segment".
      els.impactPreview.innerHTML = `
        <div><strong>${procedure.effect}</strong><span>${hardwareDescription}</span></div>
        <span class="angle-chip">${correctionPolicy.enabled ? `Default ${signedDegree(correctionPolicy.defaultDeg)} · ${escapeHtml(describeCorrectionMetricEffect(level.id, correctionPolicy.defaultDeg))}` : 'No angular output'}</span>`;
      /* A re-render for the same level and procedure (the posterior-fixation
         toggle, an implant change) keeps the values the user typed or a
         comparison prefilled. Only a new level or procedure resets them to the
         procedure default. Values outside the new bounds are clamped, and the
         clamp is announced. */
      const previewKey = `${els.procedureSelect.value}|${level.id}`;
      const keepEditorValues = preserveEditorValues !== false
        && lastImpactPreviewKey === previewKey
        && ['user_planned', 'evidence_comparison_prefill'].includes(state.editorCorrectionSource);
      lastImpactPreviewKey = previewKey;
      const clampedFields = [];
      const keepOrReset = (input, fallback, min, max, label) => {
        const current = Number(input.value);
        if (keepEditorValues && input.value.trim() !== '' && Number.isFinite(current)) {
          const clamped = Math.min(max, Math.max(min, current));
          if (clamped !== current) clampedFields.push(label);
          input.value = String(clamped);
        } else {
          input.value = String(fallback);
        }
      };
      els.correctionInput.disabled = !correctionPolicy.enabled;
      els.correctionInput.min = String(correctionPolicy.minDeg);
      els.correctionInput.max = String(correctionPolicy.maxDeg);
      keepOrReset(els.correctionInput, correctionPolicy.defaultDeg, correctionPolicy.minDeg, correctionPolicy.maxDeg, 'sagittal');
      if (!keepEditorValues) {
        state.editorCorrectionSource = correctionPolicy.enabled ? 'procedure_default_assumption' : 'not_applicable';
        state.editorComparisonPrefill = null;
      }
      [
        [els.coronalCorrectionInput, planePolicy.coronal, 'coronal'],
        [els.axialCorrectionInput, planePolicy.axial, 'axial'],
        [els.translationCorrectionInput, planePolicy.translation, 'translation']
      ].forEach(([input, axis, label]) => {
        input.disabled = !axis.enabled;
        input.min = String(axis.min);
        input.max = String(axis.max);
        if (axis.enabled) keepOrReset(input, 0, axis.min, axis.max, label);
        else input.value = '0';
        input.removeAttribute('aria-invalid');
      });
      els.correctionInput.removeAttribute('aria-invalid');
      if (clampedFields.length) announce(`Planned ${clampedFields.join(', ')} change clamped to the new bounds for this construct.`);
      $('correctionNote').textContent = correctionPolicy.enabled
        ? `Editable signed scenario input (${correctionPolicy.minDeg}° to ${correctionPolicy.maxDeg}°, 0.5° steps); positive ${correctionPolicy.positiveMeaning}. ${correctionPolicy.localOnly ? 'This local value is visualized at its level and is excluded from aggregate CL, TK, and LL outputs. ' : ''}It is not a predicted surgical result.`
        : 'This procedure has no authored angular scenario output.';
      const activeAxes = [planePolicy.coronal.enabled && 'coronal', planePolicy.axial.enabled && 'axial', planePolicy.translation.enabled && 'translation'].filter(Boolean);
      $('planeCorrectionDisclosure').textContent = activeAxes.length
        ? `Editable ${activeAxes.join(', ')} rigid-transform axes are available for this procedure. Positive coronal change moves toward apex right; positive axial change is clockwise viewed cranially; positive translation is patient-right. These are authored scenario changes, not predicted achieved correction, force, or implant behavior.`
        : 'No coronal, axial, or translation change is assigned to this procedure. The fields remain unavailable rather than implying a correction capability.';
    }

    function implantProfileFor(procedureId, levelId) {
      const base = PROCEDURE_IMPLANT_PROFILES[procedureId] || { unsupported: true, note: 'No verified implant catalog is mapped to this procedure.' };
      if (procedureId === 'pcf' && levelId === 'C1-C2') return { ...base, screwCatalogId: 'neon3_pedicle' };
      return base;
    }

    function editorImplantProfileFor(procedureId, levelId) {
      const base = implantProfileFor(procedureId, levelId);
      if (OPTIONAL_POSTERIOR_FIXATION_PROCEDURES.has(procedureId) && implantEls.supplementalPosterior.checked === false) {
        return {
          ...base,
          screwCatalogId: null,
          note: [base.note, 'Interbody-only construct authored; supplemental posterior fixation is not included.']
            .filter(Boolean)
            .join(' ')
        };
      }
      return base;
    }

    function fillSelect(select, values, formatter, preferredValue = null) {
      select.replaceChildren();
      values.forEach((value, index) => {
        const option = document.createElement('option');
        option.value = typeof value === 'object' ? (value.id || JSON.stringify(value)) : String(value);
        option.textContent = formatter(value);
        select.append(option);
        if (preferredValue !== null && option.value === String(preferredValue)) select.selectedIndex = index;
      });
      if (select.selectedIndex < 0 && select.options.length) select.selectedIndex = Math.floor((select.options.length - 1) / 2);
    }

    function selectedCageCatalog() {
      return IMPLANT_CATALOGS.cages[implantEls.cageCatalog.value] || null;
    }

    function selectedMotionDeviceCatalog() {
      const profile = editorImplantProfileFor(els.procedureSelect.value, els.levelSelect.value);
      return IMPLANT_CATALOGS.motionDevices[profile.motionCatalogId] || null;
    }

    function selectedScrewCatalog() {
      const profile = editorImplantProfileFor(els.procedureSelect.value, els.levelSelect.value);
      return IMPLANT_CATALOGS.screws[profile.screwCatalogId] || null;
    }

    function populateCageDimensionOptions() {
      const catalog = selectedCageCatalog();
      if (!catalog) return;
      const defaults = {
        hedron_c: { footprint: { ap: 14, ml: 16 }, height: 7, lordosis: 7 },
        mobi_c: { footprint: { ap: 14, ml: 17 }, height: 6, lordosis: 0 },
        hedron_t: { footprint: { ap: 28, ml: 10 }, height: 9, lordosis: 8 },
        hedron_p: { footprint: { ap: 26, ml: 10 }, height: 9, lordosis: 8 },
        hedron_a: { footprint: { ap: 24, ml: 35 }, height: 11, lordosis: 15 },
        hedron_l: { footprint: { ap: 18, ml: 40 }, height: 9, lordosis: 10 }
      }[catalog.id];
      fillSelect(implantEls.cageFootprint, catalog.footprints, value => `${value.ap} × ${value.ml} mm`, JSON.stringify(defaults?.footprint));
      fillSelect(implantEls.cageHeight, catalog.heights, value => `${value} mm`, defaults?.height);
      fillSelect(implantEls.cageLordosis, catalog.lordosis, value => `${value}°`, defaults?.lordosis);
      implantEls.catalogLabel.textContent = `${catalog.label} · ${catalog.revision}`;
    }

    function populateScrewLengthOptions() {
      const catalog = selectedScrewCatalog();
      if (!catalog) return;
      const lengths = catalog.diameterLengths[implantEls.screwDiameter.value] || [];
      const preferred = catalog.id === 'neon3_lms' ? 14
        : catalog.id === 'neon3_pedicle' ? 28
          : catalog.id === 'tops_pedicle' || catalog.id === 'ucentum_pedicle' ? 45
            : 80;
      fillSelect(implantEls.screwLength, lengths, value => `${value} mm`, preferred);
    }

    function populateGraftVolumeOptions() {
      const catalog = IMPLANT_CATALOGS.grafts[implantEls.graftFamily.value];
      if (!catalog) return;
      const preferred = catalog.id === 'mastergraft_putty' ? 3 : catalog.volumesCc[0];
      fillSelect(implantEls.graftVolume, catalog.volumesCc, value => `${value} cc package`, preferred);
    }

    function deepFreezeSnapshot(value) {
      if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
      Object.values(value).forEach(deepFreezeSnapshot);
      return Object.freeze(value);
    }

    function normalizeCustomLabel(rawValue, fieldLabel) {
      const value = String(rawValue ?? '').replace(/\s+/g, ' ').trim();
      const domain = CUSTOM_IMPLANT_DOMAINS.labelLength;
      if (value.length < domain.min || value.length > domain.max || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new RangeError(`${fieldLabel} must contain ${domain.min} to ${domain.max} printable characters.`);
      }
      return value;
    }

    function boundedCustomNumber(rawValue, domain, fieldLabel) {
      if (rawValue === '' || rawValue === null || rawValue === undefined || typeof rawValue === 'boolean') {
        throw new TypeError(`${fieldLabel} is required.`);
      }
      const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      if (!Number.isFinite(value) || value < domain.min || value > domain.max) {
        throw new RangeError(`${fieldLabel} must be a finite value from ${domain.min} to ${domain.max}.`);
      }
      return value;
    }

    function deriveCatalogCageHeights(apMm, maximumHeightMm, lordosisDeg) {
      const ap = boundedCustomNumber(apMm, CUSTOM_IMPLANT_DOMAINS.cageApMm, 'Cage AP');
      const maximumHeight = boundedCustomNumber(maximumHeightMm, CUSTOM_IMPLANT_DOMAINS.cageHeightMm, 'Catalog maximum cage height');
      const angle = boundedCustomNumber(lordosisDeg, CUSTOM_IMPLANT_DOMAINS.cageAngleDeg, 'Cage angle');
      const heightDelta = ap * Math.tan(THREE.MathUtils.degToRad(angle));
      const anteriorHeight = angle >= 0 ? maximumHeight : maximumHeight + heightDelta;
      const posteriorHeight = angle >= 0 ? maximumHeight - heightDelta : maximumHeight;
      if (!Number.isFinite(anteriorHeight) || !Number.isFinite(posteriorHeight)
          || Math.min(anteriorHeight, posteriorHeight) < CUSTOM_IMPLANT_DOMAINS.cageHeightMm.min) {
        throw new RangeError(`That catalog height and angle produce an edge below the ${CUSTOM_IMPLANT_DOMAINS.cageHeightMm.min} mm rendering guardrail.`);
      }
      return Object.freeze({ anteriorHeight, posteriorHeight, maximumHeight, lordosisDeg: angle });
    }

    function normalizeCustomImplantSelection(profile, selection) {
      if (!profile || profile.unsupported) throw new RangeError('Custom geometry is unavailable because this procedure has no supported parametric template.');
      if (profile.motionCatalogId) throw new RangeError('The FDA-named TOPS procedure uses only its listed motion-implant and proprietary screw configurations; a custom envelope is not labeled as TOPS.');
      const label = normalizeCustomLabel(selection?.label, 'Custom component label');
      const components = [];
      const provenanceFor = componentKind => Object.freeze({
        kind: 'user_entered', componentKind, displayLabel: label,
        manufacturer: null, catalogId: null, sourceUrl: null,
        catalogAvailabilityVerified: false, dimensionsVerifiedAgainstSource: false
      });
      if (profile.cageCatalogIds?.length) {
        const referenceCatalog = IMPLANT_CATALOGS.cages[profile.cageCatalogIds[0]];
        if (!referenceCatalog) throw new RangeError('The procedure does not declare a supported interbody geometry template.');
        const ap = boundedCustomNumber(selection?.cage?.ap, CUSTOM_IMPLANT_DOMAINS.cageApMm, 'Cage AP');
        const ml = boundedCustomNumber(selection?.cage?.ml, CUSTOM_IMPLANT_DOMAINS.cageMlMm, 'Cage ML');
        const anteriorHeight = boundedCustomNumber(selection?.cage?.anteriorHeight, CUSTOM_IMPLANT_DOMAINS.cageHeightMm, 'Anterior cage height');
        const posteriorHeight = boundedCustomNumber(selection?.cage?.posteriorHeight, CUSTOM_IMPLANT_DOMAINS.cageHeightMm, 'Posterior cage height');
        const lordosisDeg = THREE.MathUtils.radToDeg(Math.atan2(anteriorHeight - posteriorHeight, ap));
        boundedCustomNumber(lordosisDeg, CUSTOM_IMPLANT_DOMAINS.cageAngleDeg, 'Derived cage angle');
        components.push({
          role: referenceCatalog.kind,
          geometryTemplate: referenceCatalog.kind === 'arthroplasty' ? 'arthroplasty_envelope' : 'lordotic_interbody_envelope',
          dimensionSource: 'user_entered', catalogId: null, catalogLabel: label, catalogRevision: null, sourceUrl: null,
          dimensionsMm: { ap, ml, height: Math.max(anteriorHeight, posteriorHeight), anteriorHeight, posteriorHeight },
          heightConvention: 'explicit_anterior_posterior', lordosisDeg,
          provenance: provenanceFor(referenceCatalog.kind)
        });
      }
      if (profile.screwCatalogId || profile.customScrewOnly) {
        const outerDiameter = boundedCustomNumber(selection?.screw?.outerDiameter, CUSTOM_IMPLANT_DOMAINS.screwDiameterMm, 'Screw shaft diameter');
        const length = boundedCustomNumber(selection?.screw?.length, CUSTOM_IMPLANT_DOMAINS.screwLengthMm, 'Screw length');
        components.push({
          role: 'screw_set', geometryTemplate: 'shaft_only', dimensionSource: 'user_entered',
          catalogId: null, catalogLabel: label, catalogRevision: null, sourceUrl: null,
          dimensionsMm: { outerDiameter, length }, headEnvelopeMm: null,
          provenance: provenanceFor('screw_shaft')
        });
        if (profile.customRodRequired !== false) {
          const rodDiameter = boundedCustomNumber(selection?.rod?.diameter, CUSTOM_IMPLANT_DOMAINS.rodDiameterMm, 'Rod diameter');
          const rodLength = boundedCustomNumber(selection?.rod?.length, CUSTOM_IMPLANT_DOMAINS.rodLengthMm, 'Rod length');
          components.push({
            role: 'rod_set', geometryTemplate: 'straight_rod_envelope', dimensionSource: 'user_entered',
            catalogId: null, catalogLabel: label, catalogRevision: null, sourceUrl: null,
            dimensionsMm: { diameter: rodDiameter, length: rodLength },
            provenance: provenanceFor('rod')
          });
        }
      }
      const graft = profile.graft ? (() => {
        const graftLabel = normalizeCustomLabel(selection?.graft?.label, 'Custom graft label');
        const declaredQuantityCc = boundedCustomNumber(selection?.graft?.quantityCc, CUSTOM_IMPLANT_DOMAINS.graftQuantityCc, 'Declared graft quantity');
        return {
          catalogId: null, catalogLabel: graftLabel, sourceUrl: null,
          declaredQuantityCc, packageVolumeCc: declaredQuantityCc,
          quantityMeaning: 'user_declared_reference_quantity', placedVolumeInferred: false,
          provenance: Object.freeze({ kind: 'user_entered', catalogAvailabilityVerified: false, dimensionsVerifiedAgainstSource: false })
        };
      })() : null;
      return deepFreezeSnapshot({ label, components, graft });
    }

    function readCustomImplantSelection() {
      return {
        label: implantEls.customLabel.value,
        cage: {
          ap: implantEls.customCageAp.value, ml: implantEls.customCageMl.value,
          anteriorHeight: implantEls.customCageAnterior.value, posteriorHeight: implantEls.customCagePosterior.value
        },
        screw: { outerDiameter: implantEls.customScrewDiameter.value, length: implantEls.customScrewLength.value },
        rod: { diameter: implantEls.customRodDiameter.value, length: implantEls.customRodLength.value },
        graft: { label: implantEls.customGraftLabel.value, quantityCc: implantEls.customGraftVolume.value }
      };
    }

    function seedCustomDimensionsFromCatalog(profile) {
      if (profile.cageCatalogIds?.length) {
        const catalog = selectedCageCatalog();
        if (catalog && implantEls.cageFootprint.value) {
          const footprint = JSON.parse(implantEls.cageFootprint.value);
          const derived = deriveCatalogCageHeights(footprint.ap, Number(implantEls.cageHeight.value), Number(implantEls.cageLordosis.value));
          implantEls.customCageAp.value = String(footprint.ap);
          implantEls.customCageMl.value = String(footprint.ml);
          implantEls.customCageAnterior.value = String(Number(derived.anteriorHeight.toFixed(2)));
          implantEls.customCagePosterior.value = String(Number(derived.posteriorHeight.toFixed(2)));
        }
      }
      if (profile.screwCatalogId) {
        implantEls.customScrewDiameter.value = implantEls.screwDiameter.value;
        implantEls.customScrewLength.value = implantEls.screwLength.value;
        implantEls.customRodDiameter.value = implantEls.rodDiameter.value;
        implantEls.customRodLength.value = implantEls.rodLength.value;
      }
      if (profile.graft) {
        const graft = IMPLANT_CATALOGS.grafts[implantEls.graftFamily.value];
        if (graft) implantEls.customGraftLabel.value = `${graft.label} · user-declared`;
        implantEls.customGraftVolume.value = implantEls.graftVolume.value;
      }
    }

    function syncImplantModeUI({ seedCustom = false } = {}) {
      const profile = editorImplantProfileFor(els.procedureSelect.value, els.levelSelect.value);
      const hasCage = Boolean(profile.cageCatalogIds?.length);
      const hasMotionDevice = Boolean(profile.motionCatalogId);
      const hasScrews = Boolean(profile.screwCatalogId || profile.customScrewOnly);
      const hasRods = hasScrews && profile.customRodRequired !== false;
      const hasGraft = profile.graft === true;
      const customAvailable = !profile.unsupported && !hasMotionDevice && (hasCage || hasScrews || hasGraft);
      if (profile.customRequired) implantEls.customMode.checked = true;
      else if (!customAvailable) implantEls.customMode.checked = false;
      implantEls.customMode.disabled = !customAvailable || profile.customRequired === true;
      implantEls.customModeField.hidden = !customAvailable;
      implantEls.customModeField.querySelector('span').textContent = profile.customRequired
        ? 'Custom dimensions required (no verified catalog loaded)'
        : 'Use custom dimensional envelope';
      const custom = customAvailable && implantEls.customMode.checked;
      if (custom && seedCustom && !profile.customRequired) seedCustomDimensionsFromCatalog(profile);
      implantEls.catalogFields.hidden = custom;
      implantEls.customFields.hidden = !custom;
      [implantEls.customCageApField, implantEls.customCageMlField, implantEls.customCageAnteriorField, implantEls.customCagePosteriorField]
        .forEach(field => { field.hidden = !hasCage; });
      [implantEls.customScrewDiameterField, implantEls.customScrewLengthField].forEach(field => { field.hidden = !hasScrews; });
      [implantEls.customRodDiameterField, implantEls.customRodLengthField].forEach(field => { field.hidden = !hasRods; });
      [implantEls.customGraftLabelField, implantEls.customGraftVolumeField].forEach(field => { field.hidden = !hasGraft; });
      if (custom) {
        implantEls.catalogLabel.textContent = profile.customRequired
          ? 'Explicit user dimensions required · no catalog attribution'
          : 'User-entered dimensions · not catalog verified';
        implantEls.disclosure.textContent = profile.customRequired
          ? `${profile.note || ''} Geometry is withheld until diameter and length are explicitly entered. Values do not establish device availability, fit, trajectory, indication, or safety.`
          : 'Custom dimensional envelope only. Values are user-entered and are not evidence of catalog availability, fit, trajectory, containment, indication, or safety.';
      }
    }

    function updateImplantConfiguration() {
      const procedureId = els.procedureSelect.value;
      const optionalPosteriorFixation = OPTIONAL_POSTERIOR_FIXATION_PROCEDURES.has(procedureId);
      const procedureChanged = implantEls.config.dataset.procedureId !== procedureId;
      implantEls.config.dataset.procedureId = procedureId;
      if (procedureChanged) {
        implantEls.supplementalPosterior.checked = true;
      }
      implantEls.supplementalPosteriorField.hidden = !optionalPosteriorFixation;
      implantEls.supplementalPosteriorNote.hidden = !optionalPosteriorFixation;
      const profile = editorImplantProfileFor(procedureId, els.levelSelect.value);
      const cageIds = profile.cageCatalogIds || [];
      const motionCatalog = IMPLANT_CATALOGS.motionDevices[profile.motionCatalogId] || null;
      const screwCatalog = IMPLANT_CATALOGS.screws[profile.screwCatalogId] || null;
      const hasCage = cageIds.length > 0;
      const hasMotionDevice = Boolean(motionCatalog);
      const hasScrews = Boolean(screwCatalog || profile.customScrewOnly);
      const hasRods = Boolean(screwCatalog?.rodDiameters?.length && screwCatalog?.rodLengths?.length);
      const hasGraft = profile.graft === true;
      if (procedureChanged && profile.customRequired) {
        implantEls.customMode.checked = true;
        implantEls.customLabel.value = 'Generic trans-SI implant';
        implantEls.customScrewDiameter.value = '';
        implantEls.customScrewLength.value = '';
        implantEls.config.dataset.collapsed = 'false';
        els.toggleImplantDetails.setAttribute('aria-expanded', 'true');
        els.toggleImplantDetails.textContent = 'Hide sizes';
      }
      implantEls.config.hidden = !hasCage && !hasMotionDevice && !hasScrews && !profile.note;
      [implantEls.cageCatalogField, implantEls.cageFootprintField, implantEls.cageHeightField, implantEls.cageLordosisField].forEach(field => { field.hidden = !hasCage; });
      implantEls.topsIpdField.hidden = !hasMotionDevice;
      implantEls.topsPlateLengthField.hidden = !hasMotionDevice;
      [implantEls.screwDiameterField, implantEls.screwLengthField].forEach(field => { field.hidden = !hasScrews; });
      [implantEls.rodDiameterField, implantEls.rodLengthField].forEach(field => { field.hidden = !hasRods; });
      [implantEls.graftFamilyField, implantEls.graftVolumeField].forEach(field => { field.hidden = !hasGraft; });

      if (hasCage) {
        fillSelect(implantEls.cageCatalog, cageIds.map(id => IMPLANT_CATALOGS.cages[id]), value => value.label);
        implantEls.cageCatalog.value = cageIds[0];
        populateCageDimensionOptions();
      }
      if (hasMotionDevice) {
        fillSelect(
          implantEls.topsIpd,
          motionCatalog.ipdConfigurations,
          value => `${value.ipdMm} mm IPD · ${value.armAngleDeg}° arm configuration`,
          JSON.stringify(motionCatalog.ipdConfigurations.find(value => value.ipdMm === 30))
        );
        fillSelect(
          implantEls.topsPlateLength,
          motionCatalog.plateLengthConfigurations,
          value => `${value.label} · top ${value.topPlateLengthMm} / bottom ${value.bottomPlateLengthMm} mm`,
          'M'
        );
        implantEls.catalogLabel.textContent = `${motionCatalog.label} · ${motionCatalog.revision}`;
      }
      if (screwCatalog) {
        const diameters = Object.keys(screwCatalog.diameterLengths).map(Number);
        const preferredDiameter = screwCatalog.id === 'neon3_lms' ? 3.5
          : screwCatalog.id === 'neon3_pedicle' ? 4
            : screwCatalog.id === 'tops_pedicle' || screwCatalog.id === 'ucentum_pedicle' ? 6.5
              : 8.5;
        fillSelect(implantEls.screwDiameter, diameters, value => `Ø ${value} mm`, preferredDiameter);
        populateScrewLengthOptions();
        if (hasRods) {
          fillSelect(implantEls.rodDiameter, screwCatalog.rodDiameters, value => `Ø ${value} mm`, screwCatalog.rodDiameters[0]);
          const preferredRodLength = screwCatalog.id.startsWith('neon3') ? 40 : screwCatalog.id === 'ucentum_pedicle' ? 60 : 100;
          fillSelect(implantEls.rodLength, screwCatalog.rodLengths, value => `${value} mm`, preferredRodLength);
        }
        if (!hasCage && !hasMotionDevice) implantEls.catalogLabel.textContent = `${screwCatalog.label} · ${screwCatalog.revision}`;
      }
      if (hasGraft) {
        const grafts = Object.values(IMPLANT_CATALOGS.grafts);
        fillSelect(implantEls.graftFamily, grafts, value => value.label);
        implantEls.graftFamily.value = 'mastergraft_putty';
        populateGraftVolumeOptions();
      }
      implantEls.disclosure.textContent = profile.note
        ? `${profile.note} Catalog-size visualization only; no fit, trajectory, containment, indication, or safety is inferred.`
        : 'Catalog-size visualization only. Selection does not establish fit, trajectory, containment, indication, or safety.';
      syncImplantModeUI();
    }

    function buildImplantPlan(procedureId, levelId) {
      const profile = editorImplantProfileFor(procedureId, levelId);
      const constructVariantFor = components => {
        const roles = new Set((components || []).map(component => component.role));
        if (roles.has('fusion_cage') && roles.has('screw_set') && roles.has('rod_set')) return 'interbody_plus_posterior_fixation';
        if (roles.has('fusion_cage')) return 'interbody_only';
        if (roles.has('arthroplasty')) return 'motion_preserving_interbody';
        if (roles.has('posterior_motion_device') && roles.has('screw_set')) return 'posterior_motion_device_with_pedicle_screws';
        if (roles.has('screw_set') && roles.has('rod_set')) return 'posterior_screw_rod';
        if (roles.has('screw_set')) return 'standalone_screw_fixation';
        return 'no_verified_implant_geometry';
      };
      if (profile.anatomyOnly) {
        return deepFreezeSnapshot({
          schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'not_applicable', catalogRevision: null,
          sizingSource: 'anatomy_only', automaticSizing: false, catalogMatch: false,
          clinicalSuitability: 'not_assessed', fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
          renderStatus: 'anatomy_only', constructVariant: 'anatomy_only', note: profile.note || null, components: [], graft: null
        });
      }
      if (profile.unsupported) {
        return deepFreezeSnapshot({
          schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'withheld', catalogRevision: IMPLANT_CATALOG_REVISION,
          sizingSource: 'not_available', automaticSizing: false, catalogMatch: false,
          clinicalSuitability: 'not_assessed', fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
          renderStatus: 'withheld_unverified_geometry', constructVariant: 'geometry_withheld', note: profile.note || null, components: [], graft: null
        });
      }
      if (profile.customRequired || implantEls.customMode.checked) {
        const custom = normalizeCustomImplantSelection(profile, readCustomImplantSelection());
        return deepFreezeSnapshot({
          schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'custom', catalogRevision: null,
          sizingSource: 'user_entered_dimensions', automaticSizing: false, catalogMatch: false,
          clinicalSuitability: 'not_assessed', fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
          renderStatus: 'custom_dimensions_available', constructVariant: constructVariantFor(custom.components),
          note: profile.note || 'User-entered dimensional envelope; catalog availability and clinical suitability are not established.',
          components: custom.components, graft: custom.graft
        });
      }
      const components = [];
      if (profile.motionCatalogId) {
        const catalog = selectedMotionDeviceCatalog();
        if (!catalog || catalog.id !== profile.motionCatalogId) throw new RangeError('Select the motion-device family listed for this procedure.');
        let ipdConfiguration;
        try { ipdConfiguration = JSON.parse(implantEls.topsIpd.value); } catch { throw new TypeError('Select a valid TOPS interpedicular-distance configuration.'); }
        const verifiedIpd = catalog.ipdConfigurations.find(value =>
          value.ipdMm === Number(ipdConfiguration.ipdMm) && value.armAngleDeg === Number(ipdConfiguration.armAngleDeg)
        );
        const plateConfiguration = catalog.plateLengthConfigurations.find(value => value.id === implantEls.topsPlateLength.value);
        if (!verifiedIpd || !plateConfiguration) throw new RangeError('The selected TOPS configuration is not listed in the FDA SSED reference table.');
        components.push({
          role: catalog.kind, catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
          geometryTemplate: 'tops_external_component_topology', dimensionSource: 'fda_ssed_rounded_reference_dimensions',
          sourceUrl: catalog.sourceUrl,
          dimensionsMm: {
            interpedicularDistance: verifiedIpd.ipdMm,
            armAngleDeg: verifiedIpd.armAngleDeg,
            plateLengthClass: plateConfiguration.id,
            topPlateLength: plateConfiguration.topPlateLengthMm,
            bottomPlateLength: plateConfiguration.bottomPlateLengthMm
          },
          materials: catalog.materials,
          labeledDesignMotionLimitsDeg: catalog.labeledDesignMotionLimitsDeg,
          sagittalTranslationDesign: catalog.sagittalTranslationDesign,
          provenance: {
            kind: 'fda_pma_ssed',
            listedConfiguration: true,
            dimensionsRoundedReferenceOnly: true,
            internalMechanismGeometryVerified: false
          }
        });
      }
      if (profile.cageCatalogIds?.length) {
        const catalog = selectedCageCatalog();
        if (!catalog || !profile.cageCatalogIds.includes(catalog.id)) throw new RangeError('Select a cage family listed for this procedure.');
        let footprint;
        try { footprint = JSON.parse(implantEls.cageFootprint.value); } catch { throw new TypeError('Select a valid catalog cage footprint.'); }
        if (!catalog.footprints.some(value => value.ap === footprint.ap && value.ml === footprint.ml)) throw new RangeError('The selected footprint is not listed for this cage family.');
        const height = Number(implantEls.cageHeight.value);
        const lordosisDeg = Number(implantEls.cageLordosis.value);
        if (!catalog.heights.includes(height) || !catalog.lordosis.includes(lordosisDeg)) throw new RangeError('The selected height or angle is not listed for this cage family.');
        const derived = deriveCatalogCageHeights(footprint.ap, height, lordosisDeg);
        components.push({
          role: catalog.kind, catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
          geometryTemplate: catalog.kind === 'arthroplasty' ? 'arthroplasty_envelope' : 'lordotic_interbody_envelope',
          dimensionSource: 'manufacturer_catalog', sourceUrl: catalog.sourceUrl,
          dimensionsMm: { ap: footprint.ap, ml: footprint.ml, height, maximumHeight: height, anteriorHeight: derived.anteriorHeight, posteriorHeight: derived.posteriorHeight },
          heightConvention: 'catalog_maximum_height', lordosisDeg,
          provenance: { kind: 'manufacturer_catalog', listedDimensionValues: true, combinationOrderabilityVerified: false }
        });
      }
      if (profile.screwCatalogId) {
        const catalog = selectedScrewCatalog();
        if (!catalog || catalog.id !== profile.screwCatalogId) throw new RangeError('Select a fixation family listed for this procedure.');
        const outerDiameter = Number(implantEls.screwDiameter.value);
        const length = Number(implantEls.screwLength.value);
        const hasRods = Boolean(catalog.rodDiameters?.length && catalog.rodLengths?.length);
        const rodDiameter = hasRods ? Number(implantEls.rodDiameter.value) : null;
        const rodLength = hasRods ? Number(implantEls.rodLength.value) : null;
        if (!catalog.diameterLengths[String(outerDiameter)]?.includes(length)) throw new RangeError('That screw diameter and length combination is not listed in the selected catalog.');
        if (hasRods && (!catalog.rodDiameters.includes(rodDiameter) || !catalog.rodLengths.includes(rodLength))) throw new RangeError('That rod diameter or length is not listed in the selected catalog.');
        components.push({
          role: 'screw_set', catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
          geometryTemplate: 'catalog_shaft_generic_head_envelope', dimensionSource: 'manufacturer_catalog',
          sourceUrl: catalog.sourceUrl, dimensionsMm: { outerDiameter, length },
          provenance: { kind: 'manufacturer_catalog', listedDiameterLengthCombination: true, headGeometryVerified: false }
        });
        if (hasRods) {
          components.push({
            role: 'rod_set', catalogId: catalog.id, catalogLabel: catalog.label, geometryTemplate: 'straight_rod_envelope',
            dimensionSource: 'manufacturer_catalog', sourceUrl: catalog.sourceUrl,
            dimensionsMm: { diameter: rodDiameter, length: rodLength },
            provenance: { kind: 'manufacturer_catalog', listedDimensionValues: true, contouringVerified: false }
          });
        }
      }
      const graft = profile.graft ? (() => {
        const catalog = IMPLANT_CATALOGS.grafts[implantEls.graftFamily.value];
        const packageVolumeCc = Number(implantEls.graftVolume.value);
        if (!catalog || !catalog.volumesCc.includes(packageVolumeCc)) throw new RangeError('Select a listed graft package quantity.');
        return { catalogId: catalog.id, catalogLabel: catalog.label, sourceUrl: catalog.sourceUrl, packageVolumeCc, placedVolumeInferred: false,
          provenance: { kind: 'manufacturer_catalog', listedPackageQuantity: true } };
      })() : null;
      return deepFreezeSnapshot({
        schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'catalog', catalogRevision: IMPLANT_CATALOG_REVISION,
        sizingSource: 'explicit_user_selected_catalog_dimensions', automaticSizing: false,
        catalogMatch: 'listed_dimension_values_only', clinicalSuitability: 'not_assessed', fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
        renderStatus: 'catalog_dimensions_available', constructVariant: constructVariantFor(components), note: profile.note || null, components, graft
      });
    }

    function buildDefaultSuggestedImplantPlan(procedureId, levelId) {
      const profile = implantProfileFor(procedureId, levelId);
      const constructVariantFor = components => {
        const roles = new Set((components || []).map(component => component.role));
        if (roles.has('fusion_cage') && roles.has('screw_set') && roles.has('rod_set')) return 'interbody_plus_posterior_fixation';
        if (roles.has('fusion_cage')) return 'interbody_only';
        if (roles.has('arthroplasty')) return 'motion_preserving_interbody';
        if (roles.has('posterior_motion_device') && roles.has('screw_set')) return 'posterior_motion_device_with_pedicle_screws';
        if (roles.has('screw_set') && roles.has('rod_set')) return 'posterior_screw_rod';
        if (roles.has('screw_set')) return 'standalone_screw_fixation';
        return 'no_verified_implant_geometry';
      };
      if (profile.anatomyOnly) {
        return deepFreezeSnapshot({
          schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'not_applicable', catalogRevision: null,
          sizingSource: 'anatomy_only', automaticSizing: false, catalogMatch: false,
          clinicalSuitability: 'not_assessed', fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
          renderStatus: 'anatomy_only', constructVariant: 'anatomy_only',
          note: profile.note || null, components: [], graft: null
        });
      }
      if (profile.unsupported) {
        return deepFreezeSnapshot({
          schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'withheld', catalogRevision: IMPLANT_CATALOG_REVISION,
          sizingSource: 'not_available', automaticSizing: false, catalogMatch: false,
          clinicalSuitability: 'not_assessed', fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
          renderStatus: 'withheld_unverified_geometry', constructVariant: 'geometry_withheld',
          note: profile.note || null, components: [], graft: null
        });
      }
      if (profile.customRequired) {
        return deepFreezeSnapshot({
          schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'custom_required', catalogRevision: null,
          sizingSource: 'explicit_user_input_required', automaticSizing: false, catalogMatch: false,
          clinicalSuitability: 'not_assessed', fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
          renderStatus: 'withheld_pending_user_dimensions', constructVariant: 'geometry_withheld',
          note: profile.note || 'Explicit user dimensions are required.', components: [], graft: null
        });
      }
      const components = [];
      if (profile.motionCatalogId) {
        const catalog = IMPLANT_CATALOGS.motionDevices[profile.motionCatalogId];
        const ipd = catalog?.ipdConfigurations.find(value => value.ipdMm === 30);
        const plate = catalog?.plateLengthConfigurations.find(value => value.id === 'M');
        if (!catalog || !ipd || !plate) throw new RangeError('The default motion-device configuration is unavailable.');
        components.push({
          role: catalog.kind, catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
          geometryTemplate: 'tops_external_component_topology', dimensionSource: 'fda_ssed_rounded_reference_dimensions',
          sourceUrl: catalog.sourceUrl,
          dimensionsMm: {
            interpedicularDistance: ipd.ipdMm, armAngleDeg: ipd.armAngleDeg,
            plateLengthClass: plate.id, topPlateLength: plate.topPlateLengthMm, bottomPlateLength: plate.bottomPlateLengthMm
          },
          materials: catalog.materials,
          labeledDesignMotionLimitsDeg: catalog.labeledDesignMotionLimitsDeg,
          sagittalTranslationDesign: catalog.sagittalTranslationDesign,
          provenance: {
            kind: 'fda_pma_ssed', listedConfiguration: true,
            dimensionsRoundedReferenceOnly: true, internalMechanismGeometryVerified: false
          }
        });
      }
      if (profile.cageCatalogIds?.length) {
        const catalog = IMPLANT_CATALOGS.cages[profile.cageCatalogIds[0]];
        const defaults = {
          hedron_c: { footprint: { ap: 14, ml: 16 }, height: 7, lordosis: 7 },
          mobi_c: { footprint: { ap: 14, ml: 17 }, height: 6, lordosis: 0 },
          hedron_t: { footprint: { ap: 28, ml: 10 }, height: 9, lordosis: 8 },
          hedron_p: { footprint: { ap: 26, ml: 10 }, height: 9, lordosis: 8 },
          hedron_a: { footprint: { ap: 24, ml: 35 }, height: 11, lordosis: 15 },
          hedron_l: { footprint: { ap: 18, ml: 40 }, height: 9, lordosis: 10 }
        }[catalog?.id];
        if (!catalog || !defaults) throw new RangeError('The default interbody configuration is unavailable.');
        const derived = deriveCatalogCageHeights(defaults.footprint.ap, defaults.height, defaults.lordosis);
        components.push({
          role: catalog.kind, catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
          geometryTemplate: catalog.kind === 'arthroplasty' ? 'arthroplasty_envelope' : 'lordotic_interbody_envelope',
          dimensionSource: 'manufacturer_catalog', sourceUrl: catalog.sourceUrl,
          dimensionsMm: {
            ap: defaults.footprint.ap, ml: defaults.footprint.ml, height: defaults.height,
            maximumHeight: defaults.height, anteriorHeight: derived.anteriorHeight, posteriorHeight: derived.posteriorHeight
          },
          heightConvention: 'catalog_maximum_height', lordosisDeg: defaults.lordosis,
          provenance: { kind: 'manufacturer_catalog', listedDimensionValues: true, combinationOrderabilityVerified: false }
        });
      }
      if (profile.screwCatalogId) {
        const catalog = IMPLANT_CATALOGS.screws[profile.screwCatalogId];
        const defaults = {
          neon3_lms: { diameter: 3.5, length: 14, rodDiameter: 4, rodLength: 40 },
          neon3_pedicle: { diameter: 4, length: 28, rodDiameter: 4, rodLength: 40 },
          tops_pedicle: { diameter: 6.5, length: 45 },
          ucentum_pedicle: { diameter: 6.5, length: 45, rodDiameter: 5.5, rodLength: 60 },
          ubase_s2ai: { diameter: 8.5, length: 80, rodDiameter: 5.5, rodLength: 100 },
          ubase_iliac: { diameter: 8.5, length: 80, rodDiameter: 5.5, rodLength: 100 }
        }[catalog?.id];
        if (!catalog || !defaults || !catalog.diameterLengths[String(defaults.diameter)]?.includes(defaults.length)) {
          throw new RangeError('The default fixation configuration is unavailable.');
        }
        components.push({
          role: 'screw_set', catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
          geometryTemplate: 'catalog_shaft_generic_head_envelope', dimensionSource: 'manufacturer_catalog',
          sourceUrl: catalog.sourceUrl, dimensionsMm: { outerDiameter: defaults.diameter, length: defaults.length },
          provenance: { kind: 'manufacturer_catalog', listedDiameterLengthCombination: true, headGeometryVerified: false }
        });
        if (Number.isFinite(defaults.rodDiameter) && Number.isFinite(defaults.rodLength)) {
          components.push({
            role: 'rod_set', catalogId: catalog.id, catalogLabel: catalog.label, geometryTemplate: 'straight_rod_envelope',
            dimensionSource: 'manufacturer_catalog', sourceUrl: catalog.sourceUrl,
            dimensionsMm: { diameter: defaults.rodDiameter, length: defaults.rodLength },
            provenance: { kind: 'manufacturer_catalog', listedDimensionValues: true, contouringVerified: false }
          });
        }
      }
      const graft = profile.graft ? {
        catalogId: 'mastergraft_putty', catalogLabel: IMPLANT_CATALOGS.grafts.mastergraft_putty.label,
        sourceUrl: IMPLANT_CATALOGS.grafts.mastergraft_putty.sourceUrl, packageVolumeCc: 3,
        placedVolumeInferred: false, provenance: { kind: 'manufacturer_catalog', listedPackageQuantity: true }
      } : null;
      return deepFreezeSnapshot({
        schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'catalog', catalogRevision: IMPLANT_CATALOG_REVISION,
        sizingSource: 'comparison_default_listed_dimensions', automaticSizing: false,
        catalogMatch: 'listed_dimension_values_only', clinicalSuitability: 'not_assessed',
        fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
        renderStatus: 'catalog_dimensions_available', constructVariant: constructVariantFor(components),
        note: profile.note || null, components, graft
      });
    }

    function implantPlanSummary(plan) {
      if (!plan || String(plan.renderStatus || '').startsWith('withheld_')) return plan?.note || 'Hardware geometry withheld';
      if (plan.dimensionMode === 'custom') {
        const parts = plan.components.map(component => {
          if (component.role === 'fusion_cage' || component.role === 'arthroplasty') {
            const d = component.dimensionsMm;
            return `Custom · ${component.catalogLabel} ${d.ap}×${d.ml} mm · A/P ${d.anteriorHeight}/${d.posteriorHeight} mm · ${Number(component.lordosisDeg.toFixed(1))}°`;
          }
          if (component.role === 'screw_set') return `${component.catalogLabel} shaft Ø${component.dimensionsMm.outerDiameter}×${component.dimensionsMm.length} mm`;
          if (component.role === 'rod_set') return `rod Ø${component.dimensionsMm.diameter}×${component.dimensionsMm.length} mm`;
          return component.role;
        });
        if (plan.graft) parts.push(`${plan.graft.catalogLabel} · declared ${plan.graft.declaredQuantityCc} cc`);
        return parts.join(' · ');
      }
      const parts = plan.components.map(component => {
        if (component.role === 'posterior_motion_device') {
          const d = component.dimensionsMm;
          return `${component.catalogLabel} ${d.interpedicularDistance} mm IPD · ${d.armAngleDeg}° arms · ${d.plateLengthClass} plates ${d.topPlateLength}/${d.bottomPlateLength} mm`;
        }
        if (component.role === 'fusion_cage' || component.role === 'arthroplasty') {
          const d = component.dimensionsMm;
          if (component.heightConvention === 'catalog_maximum_height') {
            return `${component.catalogLabel} ${d.ap}×${d.ml} mm · ${d.height} mm max height · ${component.lordosisDeg}°`;
          }
          return `${component.catalogLabel} ${d.ap}×${d.ml}×${d.height} mm · ${component.lordosisDeg}°`;
        }
        if (component.role === 'screw_set') return `${component.catalogLabel} Ø${component.dimensionsMm.outerDiameter}×${component.dimensionsMm.length} mm`;
        if (component.role === 'rod_set') return `rod Ø${component.dimensionsMm.diameter}×${component.dimensionsMm.length} mm`;
        return component.role;
      });
      if (plan.graft) parts.push(`${plan.graft.catalogLabel} ${plan.graft.packageVolumeCc} cc package`);
      return parts.join(' · ');
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }

    function createSuppressedPrediction(error) {
      const assumption = MODEL_MANIFEST.assumptions;
      const assumptionSnapshot = Object.freeze({
        id: assumption.reciprocalResponseId,
        enabled: state.assumptions.applyReciprocalResponse === true,
        reciprocalTkPerLumbarDegree: assumption.reciprocalTkPerLumbarDegree,
        ptReductionPerDegreeByLevel: assumption.ptReductionPerDegreeByLevel,
        minimumModeledPt: assumption.minimumModeledPt
      });
      const suppressedOutput = key => Object.freeze({
        value: null,
        unit: 'degrees',
        provenance: 'suppressed_out_of_domain',
        sourceInputs: Object.freeze({ baseline: Object.freeze({ key: `params.${key}`, value: state.params[key] }), corrections: Object.freeze([]) }),
        equationId: null,
        assumptionSnapshot,
        uncertaintyStatus: 'not_established',
        applicabilityStatus: 'suppressed_out_of_domain',
        modelId: MODEL_MANIFEST.modelId,
        modelVersion: MODEL_MANIFEST.modelVersion,
        buildId: MODEL_MANIFEST.buildId,
        validationStatus: MODEL_MANIFEST.validationStatus
      });
      return Object.freeze({
        newLL: state.params.ll,
        newCL: state.params.cl,
        newTK: state.params.tk,
        newPT: state.params.pt,
        lumbarGain: 0,
        cervicalGain: 0,
        thoracicLocalGain: 0,
        inputSnapshot: Object.freeze({ pi: state.params.pi, ll: state.params.ll, tk: state.params.tk, cl: state.params.cl, pt: state.params.pt }),
        itinerarySnapshot: Object.freeze([]),
        outputs: Object.freeze({ ll: suppressedOutput('ll'), cl: suppressedOutput('cl'), tk: suppressedOutput('tk'), pt: suppressedOutput('pt') }),
        constraintsApplied: Object.freeze([]),
        assumptions: assumptionSnapshot,
        applicabilityStatus: 'suppressed_out_of_domain',
        reason: error instanceof Error ? error.message : String(error),
        modelId: MODEL_MANIFEST.modelId,
        modelVersion: MODEL_MANIFEST.modelVersion,
        buildId: MODEL_MANIFEST.buildId,
        validationStatus: MODEL_MANIFEST.validationStatus
      });
    }

    function getDisplayedAlignment() {
      if (state.view === 'post') {
        return {
          ll: state.prediction.newLL, tk: state.prediction.newTK,
          cl: state.prediction.newCL, pt: state.prediction.newPT, measuredSva: null
        };
      }
      return {
        ll: state.params.ll, tk: state.params.tk, cl: state.params.cl,
        pt: state.params.pt, measuredSva: state.params.measuredSva
      };
    }

    function updateHeaderMetrics() {
      const current = getDisplayedAlignment();
      const mismatch = state.params.pi - current.ll;
      // Modeled post-op values never receive measured reference modifiers.
      const modifiers = state.view === 'post'
        ? Object.freeze({ mismatch: '—', sva: '—', pt: '—' })
        : classifyModifiers({ mismatch, measuredSva: current.measuredSva, pt: current.pt });
      els.metricMismatch.textContent = signedDegree(mismatch);
      els.metricSva.textContent = Number.isFinite(current.measuredSva) ? `${signedNumber(current.measuredSva, 1)} cm` : '—';
      els.metricSvaContext.textContent = state.view === 'post'
        ? 'Not inferred post-op'
        : state.provenance.measuredSva === 'demo_preset' ? 'Hypothetical demo · cm'
        : state.provenance.measuredSva === 'authored_reference_preset' ? 'Authored preset · cm'
        : state.provenance.measuredSva === 'experimental_auto_landmark_measurement_user_accepted' && Number.isFinite(current.measuredSva) ? 'Auto beta (accepted) · cm'
        : Number.isFinite(current.measuredSva) ? 'Measured input · cm' : 'Optional measured · cm';
      const modifierElements = {
        mismatch: $('modifierMismatch'),
        sva: $('modifierSva'),
        pt: $('modifierPt')
      };
      Object.entries(modifiers).forEach(([key, grade]) => {
        modifierElements[key].dataset.grade = grade === '—' ? 'na' : grade;
        modifierElements[key].querySelector('strong').textContent = grade;
      });
      els.modifierBands.setAttribute('aria-label', state.view === 'post'
        ? 'Reference modifiers unavailable for modeled post-operative values'
        : `PI–LL reference grade ${modifiers.mismatch === '—' ? 'unavailable' : modifiers.mismatch}, measured SVA reference grade ${modifiers.sva === '—' ? 'unavailable' : modifiers.sva}, pelvic tilt reference grade ${modifiers.pt === '—' ? 'unavailable' : modifiers.pt}`
      );
      els.headerViewLabel.textContent = state.view === 'post'
        ? state.prediction?.applicabilityStatus === 'within_engineering_domain' ? 'Modeled Post-Op' : 'Post-Op · unavailable'
        : 'Pre-Op';
    }

    function setPredictionRow(prefix, before, after, formatter = degree, deltaFormatter = signedDegree) {
      $(`${prefix}Before`).textContent = formatter(before);
      $(`${prefix}After`).textContent = formatter(after);
      $(`${prefix}Delta`).textContent = `Δ ${deltaFormatter(after - before)}`;
    }

    function updateThreePlanePredictionSummary() {
      const scenario = state.threePlanePrediction;
      const setUnavailable = prefix => {
        $(`${prefix}Before`).textContent = '—';
        $(`${prefix}After`).textContent = '—';
        $(`${prefix}Delta`).textContent = 'unavailable';
      };
      if (!scenario) {
        ['primaryCobb', 'secondaryCobb', 'apicalTranslation', 'axialRotation'].forEach(setUnavailable);
        $('secondaryCobbProvenance').textContent = 'surrogate unavailable';
        return;
      }
      const setScenarioRow = (prefix, before, after, formatter, deltaFormatter) => {
        $(`${prefix}Before`).textContent = formatter(before);
        $(`${prefix}After`).textContent = formatter(after);
        $(`${prefix}Delta`).textContent = `Δ ${deltaFormatter(after - before)}`;
      };
      setScenarioRow('primaryCobb', scenario.baseline.primaryCobb, scenario.outputs.primaryCobb, signedDegree, signedDegree);
      setScenarioRow('secondaryCobb', scenario.baseline.secondaryCobb, scenario.outputs.secondaryCobb, signedDegree, signedDegree);
      setScenarioRow('apicalTranslation', scenario.baseline.apicalTranslation, scenario.outputs.apicalTranslation, value => `${signedNumber(value, 0)} mm`, value => `${signedNumber(value, 0)} mm`);
      setScenarioRow('axialRotation', scenario.baseline.axialRotation, scenario.outputs.axialRotation, signedDegree, signedDegree);
      $('secondaryCobbProvenance').textContent = !scenario.flexibility.enabled
        ? 'response off'
        : scenario.flexibility.declaredFraction === 0 ? 'structural · 0% response'
        : `${Math.round(scenario.flexibility.declaredFraction * 100)}% flexible · ${Math.round(scenario.flexibility.responseFraction * 100)}% response`;
    }

    // The derived strip's label is static markup ("Pre-op sacral slope"), but
    // the value switches to PI − modeled PT in the post-op view, so the label
    // follows the value. PT at or above PI is flagged inline as implausible.
    function setSacralSlopeReadout(pt, modeled) {
      const sacralSlope = state.params.pi - pt;
      els.sacralSlope.textContent = degree(sacralSlope);
      const label = els.sacralSlope.parentElement?.querySelector('span');
      if (label) {
        label.textContent = `${modeled ? 'Modeled post-op' : 'Pre-op'} sacral slope · PI − PT${sacralSlope > 0 ? '' : ' · implausible: PT ≥ PI'}`;
      }
      els.sacralSlope.dataset.plausible = sacralSlope > 0 ? 'true' : 'false';
    }

    function updatePredictionSummary() {
      const p = state.prediction;
      const suppressed = p.applicabilityStatus !== 'within_engineering_domain';
      updateThreePlanePredictionSummary();
      if (suppressed) {
        ['ll', 'cl', 'tk', 'pt'].forEach(prefix => {
          $(`${prefix}Before`).textContent = degree(state.params[prefix]);
          $(`${prefix}After`).textContent = '—';
          $(`${prefix}Delta`).textContent = 'suppressed';
          $(`${prefix}Provenance`).textContent = 'out of domain';
        });
        $('tkRowLabel').childNodes[0].textContent = 'Thoracic kyphosis ';
        $('ptRowLabel').childNodes[0].textContent = 'Pelvic tilt ';
        setSacralSlopeReadout(state.params.pt, false);
        const warning = $('modelWarning');
        warning.hidden = false;
        warning.textContent = `Modeled alignment suppressed: ${p.reason}`;
        return;
      }
      setPredictionRow('ll', state.params.ll, p.newLL);
      setPredictionRow('cl', state.params.cl, p.newCL);
      setPredictionRow('tk', state.params.tk, p.newTK);
      setPredictionRow('pt', state.params.pt, p.newPT);
      const assumptionsApplied = p.assumptions.enabled;
      $('tkRowLabel').childNodes[0].textContent = assumptionsApplied ? 'Reciprocal thoracic kyphosis ' : 'Thoracic kyphosis ';
      // The provenance tag already reads "balance response"; keep the row label plain.
      $('ptRowLabel').childNodes[0].textContent = 'Pelvic tilt ';
      const provenanceLabel = value => ({
        input_passthrough: 'input',
        user_planned_derived: 'planned-derived',
        evidence_comparison_prefill_derived: 'comparison prefill',
        procedure_default_assumption_derived: 'default assumption',
        mixed_correction_sources: 'mixed correction sources',
        assumption_derived: 'assumption-derived',
        pelvic_balance_response_derived: 'balance response',
        mixed_correction_and_reciprocal_assumption_derived: 'correction + assumption'
      })[value] || value;
      $('llProvenance').textContent = provenanceLabel(p.outputs.ll.provenance);
      $('clProvenance').textContent = provenanceLabel(p.outputs.cl.provenance);
      $('tkProvenance').textContent = provenanceLabel(p.outputs.tk.provenance);
      $('ptProvenance').textContent = `${provenanceLabel(p.outputs.pt.provenance)}${p.constraintsApplied.includes('minimumModeledPt') ? ' · floor applied' : ''}`;
      setSacralSlopeReadout(state.view === 'post' ? p.newPT : state.params.pt, state.view === 'post');
      const warning = $('modelWarning');
      warning.hidden = true;
      warning.textContent = '';
    }

    function authoredDisplayFactorCount() {
      const global = state.globalDeformity || {};
      const globalValues = ['coronalMagnitude', 'compensatoryCobb', 'axialRotation', 'pelvicObliquity', 'trunkShift', 'hipFlexion', 'kneeFlexion', 'ankleFlexion', 'pelvicShift'];
      let count = globalValues.filter(key => Math.abs(Number(global[key]) || 0) > .0001).length;
      Object.values(state.levelFactors || {}).forEach(factor => {
        if (!factor) return;
        count += [
          factor.discHeightLoss, factor.sagittalWedge, factor.coronalWedge, factor.axialRotation,
          factor.apTranslation, factor.lateralTranslation, factor.facetHypertrophy, factor.osteophyteBurden
        ].filter(value => Math.abs(Number(value) || 0) > .0001).length;
        if (factor.morphologyVariant && factor.morphologyVariant !== 'typical') count += 1;
        ['bodyWidthScale', 'bodyDepthScale', 'pedicleScale', 'canalScale'].forEach(key => {
          if (Math.abs((Number(factor[key]) || 1) - 1) > .0001) count += 1;
        });
      });
      return count;
    }

    function updateShapeStatus() {
      if (state.inspection?.active) {
        const mode = segmentRecords.get(state.inspection.levelId)?.geometryMode;
        const source = mode === 'ct_reference' ? 'CT-derived whole-bone surface' : 'explicit semantic fallback';
        const scope = state.inspection.scope === 'body' ? 'single superior vertebra' : state.inspection.scope === 'implant' ? 'implant context' : 'motion segment';
        els.shapeChip.textContent = `Focused inspection · ${displayLevel(state.inspection.levelId)} · ${scope} · ${source} · measurements, containment and collisions disabled`;
        return;
      }
      const current = getDisplayedAlignment();
      const mismatch = state.params.pi - current.ll;
      const measurement = state.view === 'pre' && Number.isFinite(current.measuredSva)
        ? ` · entered SVA ${signedNumber(current.measuredSva, 1)} cm`
        : '';
      const suppressed = state.view === 'post' && state.prediction?.applicabilityStatus !== 'within_engineering_domain'
        ? ' · modeled correction suppressed'
        : '';
      const authoredFactors = authoredDisplayFactorCount();
      const prefix = authoredFactors
        ? `Authored 3D display factors active (${authoredFactors}) · numeric sagittal metrics unchanged`
        : 'Source CT reference pose · PT changes posture · PI changes the authored sacral-base morphology';
      const examplePrefix = state.caseContext?.exampleId ? `Example: ${state.caseContext.label} · ` : '';
      els.shapeChip.textContent = `${examplePrefix}${prefix} · PI–LL ${signedDegree(mismatch)} · LL ${degree(current.ll)} · TK ${degree(current.tk)}${measurement}${suppressed}`;
    }

    function fusionBoundarySegments() {
      return computeFusionBoundarySegments(state.itinerary).map(item => {
        if (item.relation === 'between_fused_intervals') return `${displayLevel(item.levelId)} between planned fusion intervals`;
        return `${displayLevel(item.levelId)} at ${item.relation} fusion boundary`;
      });
    }

    function updateMechanicsSummary() {
      const topology = deriveConstructTopology(state.itinerary);
      const adjacent = fusionBoundarySegments();
      const supportedFusion = topology.segments
        .filter(segment => segment.fusionIntent && segment.posteriorFixationPlanned)
        .map(segment => `${displayLevel(segment.levelId)} posterior screw–rod supported`);
      const interbodyOnlyFusion = topology.segments
        .filter(segment => segment.fusionIntent && segment.interbodySupportPlanned && !segment.posteriorFixationPlanned)
        .map(segment => `${displayLevel(segment.levelId)} interbody-only`);
      const motionDevices = topology.segments
        .filter(segment => segment.motionPreservingStabilizationPlanned)
        .map(segment => `${displayLevel(segment.levelId)} motion device planned`);
      const topologyParts = [
        supportedFusion.length ? supportedFusion.join(', ') : '',
        interbodyOnlyFusion.length ? interbodyOnlyFusion.join(', ') : '',
        motionDevices.length ? motionDevices.join(', ') : '',
        adjacent.length ? adjacent.join(' · ') : topology.fixedLevelIds.length ? 'No free boundary within the displayed chain' : 'No planned fusion span'
      ].filter(Boolean);
      els.mechanicsAdjacent.textContent = topologyParts.join(' · ');
      const disruptiveItems = state.itinerary.filter(item => disruptsPosteriorTensionBand(PROCEDURES[item.procedureId]));
      if (!disruptiveItems.length) {
        els.mechanicsLigaments.textContent = state.layers?.ligaments ? 'Reference attachment pathways displayed' : 'Reference pathways available · hidden in Layers';
      } else if (state.view === 'post') {
        els.mechanicsLigaments.textContent = `${disruptiveItems.length} modeled interruption footprint${disruptiveItems.length === 1 ? '' : 's'} displayed · geometry only`;
      } else {
        els.mechanicsLigaments.textContent = `${disruptiveItems.length} planned interruption footprint${disruptiveItems.length === 1 ? '' : 's'} · view Modeled Post-Op`;
      }
      const implantCount = state.itinerary.filter(item => PROCEDURES[item.procedureId]?.type !== 'decompression').length;
      els.mechanicsStress.textContent = implantCount
        ? `Unavailable for ${implantCount} implant-bearing scenario item${implantCount === 1 ? '' : 's'} · validated FE solver not connected`
        : 'Unavailable · no construct and no validated FE solver';
    }

    function surveillanceMarkerFor(levelId) {
      return state.surveillance?.assessment?.markers?.find(marker => marker.levelId === levelId) || null;
    }

    function closeSurveillanceInspector({ restoreHighlight = true } = {}) {
      state.surveillance.selectedLevelId = null;
      els.surveillanceInspector.hidden = true;
      /* On a phone the inspector is a full-width sheet in the same band as the
         gait readout, which it covered completely. CSS cannot select a preceding
         sibling, so mirror the data-layers-open pattern and let it stand the
         readout down the way the legend already does. */
      document.body.dataset.inspectorOpen = 'false';
      els.inspectSurveillanceLevel.dataset.levelId = '';
      if (restoreHighlight) setHighlightedLevel(null);
      els.surveillanceMarkerLayer.querySelectorAll('.surveillance-marker').forEach(button => button.setAttribute('aria-pressed', 'false'));
      els.surveillanceLevelList.querySelectorAll('.surveillance-level-button').forEach(button => button.setAttribute('aria-pressed', 'false'));
    }

    function renderSurveillanceInspector(marker) {
      if (!marker) {
        closeSurveillanceInspector();
        return;
      }
      els.surveillanceInspectorHeading.textContent = `${displayLevel(marker.levelId)} construct review point`;
      const toneLabel = marker.tone === 'review'
          ? 'unspanned construct review'
        : marker.tone === 'stabilized'
          ? 'modeled fixation or motion device present'
          : 'planned fusion boundary';
      els.surveillanceInspector.dataset.tone = marker.tone || 'transition';
      els.surveillanceInspectorSubtitle.textContent = `${toneLabel} · ${marker.factors.length} transparent factor${marker.factors.length === 1 ? '' : 's'} · no probability or score`;
      els.surveillanceFactorList.replaceChildren();
      marker.factors.forEach(factor => {
        const item = document.createElement('li');
        const label = document.createElement('strong');
        label.textContent = factor.label;
        const detail = document.createElement('span');
        detail.textContent = factor.detail;
        const source = document.createElement('a');
        source.href = factor.sourceUrl;
        source.target = '_blank';
        source.rel = 'noreferrer';
        source.textContent = factor.evidenceLabel;
        item.append(label, detail, source);
        els.surveillanceFactorList.append(item);
      });
      els.surveillanceUnknowns.textContent = state.surveillance.assessment.unknownInputs.join(' · ');
      els.inspectSurveillanceLevel.dataset.levelId = marker.levelId;
      els.surveillanceInspector.hidden = false;
      document.body.dataset.inspectorOpen = 'true';
    }

    function selectSurveillanceMarker(levelId, { focusInspector = false } = {}) {
      const marker = surveillanceMarkerFor(levelId);
      if (!marker) return false;
      state.surveillance.selectedLevelId = levelId;
      setHighlightedLevel(levelId);
      renderSurveillanceInspector(marker);
      els.surveillanceMarkerLayer.querySelectorAll('.surveillance-marker').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.levelId === levelId));
      });
      els.surveillanceLevelList.querySelectorAll('.surveillance-level-button').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.levelId === levelId));
      });
      if (focusInspector) els.closeSurveillanceInspector.focus();
      announce(`${displayLevel(levelId)} postoperative construct review point opened. ${marker.factors.length} scenario factor${marker.factors.length === 1 ? '' : 's'} present; no probability or recommendation is calculated.`);
      return true;
    }

    function setSurveillanceVisibility(visible, shouldAnnounce = true) {
      state.surveillance.visible = Boolean(visible);
      els.toggleSurveillance.setAttribute('aria-pressed', String(state.surveillance.visible));
      els.surveillanceMarkerLayer.hidden = !(state.surveillance.visible && state.view === 'post' && state.surveillance.assessment?.markers?.length);
      if (!state.surveillance.visible) closeSurveillanceInspector();
      if (shouldAnnounce) announce(`Postoperative construct review markers ${state.surveillance.visible ? 'enabled' : 'hidden'}. Factor details remain available in the scenario panel.`);
    }

    function renderPostoperativeSurveillance() {
      const assessment = state.surveillance.assessment;
      const markers = assessment?.markers || [];
      const selectedLevelId = markers.some(marker => marker.levelId === state.surveillance.selectedLevelId)
        ? state.surveillance.selectedLevelId
        : null;
      if (!selectedLevelId && state.surveillance.selectedLevelId) closeSurveillanceInspector();
      state.surveillance.selectedLevelId = selectedLevelId;
      els.surveillanceCount.textContent = String(markers.length);
      els.surveillanceToggleCount.textContent = String(markers.length);
      els.surveillanceMarkerLayer.replaceChildren();
      els.surveillanceLevelList.replaceChildren();

      markers.forEach(marker => {
        const toneLabel = marker.tone === 'review'
          ? 'unspanned construct review'
          : marker.tone === 'stabilized'
            ? 'fixation spans the operated level'
            : 'segment outside planned fusion span';
        const accessibleLabel = `Review ${displayLevel(marker.levelId)}: ${toneLabel}; ${marker.factors.length} scenario factor${marker.factors.length === 1 ? '' : 's'}, no probability calculated`;
        const viewportButton = document.createElement('button');
        viewportButton.type = 'button';
        viewportButton.className = 'surveillance-marker';
        viewportButton.dataset.levelId = marker.levelId;
        viewportButton.dataset.tone = marker.tone || 'transition';
        viewportButton.setAttribute('aria-label', accessibleLabel);
        viewportButton.setAttribute('aria-pressed', String(marker.levelId === selectedLevelId));
        const symbol = document.createElement('span');
        symbol.className = 'surveillance-marker-symbol';
        symbol.setAttribute('aria-hidden', 'true');
        symbol.textContent = marker.tone === 'review' ? '!' : marker.tone === 'stabilized' ? '↔' : 'i';
        const level = document.createElement('span');
        level.className = 'surveillance-marker-level';
        level.setAttribute('aria-hidden', 'true');
        level.textContent = displayLevel(marker.levelId);
        viewportButton.append(symbol, level);
        viewportButton.addEventListener('click', () => selectSurveillanceMarker(marker.levelId, { focusInspector: true }));
        els.surveillanceMarkerLayer.append(viewportButton);

        const listButton = document.createElement('button');
        listButton.type = 'button';
        listButton.className = 'surveillance-level-button';
        listButton.dataset.levelId = marker.levelId;
        listButton.dataset.tone = marker.tone || 'transition';
        listButton.setAttribute('aria-label', accessibleLabel);
        listButton.setAttribute('aria-pressed', String(marker.levelId === selectedLevelId));
        const listLabel = document.createElement('strong');
        listLabel.textContent = displayLevel(marker.levelId);
        const factorCount = document.createElement('span');
        factorCount.textContent = marker.tone === 'review'
          ? `${marker.factors.length} review factor${marker.factors.length === 1 ? '' : 's'}`
          : marker.tone === 'stabilized'
            ? 'support present'
            : 'fusion boundary';
        listButton.append(listLabel, factorCount);
        listButton.addEventListener('click', () => {
          if (state.view !== 'post') setView('post');
          selectSurveillanceMarker(marker.levelId, { focusInspector: true });
        });
        els.surveillanceLevelList.append(listButton);
      });

      if (!markers.length) {
        const empty = document.createElement('p');
        empty.className = 'surveillance-empty';
        empty.textContent = state.itinerary.length
          ? 'No construct-boundary or unspanned-disruption point is present in this scenario. This does not establish mechanical safety.'
          : 'Add a modeled construct or posterior-element disruption to identify review points.';
        els.surveillanceLevelList.append(empty);
      }
      els.surveillanceSummary.textContent = markers.length
        ? state.view === 'post'
          ? `${markers.length} clickable level${markers.length === 1 ? '' : 's'} marked in the 3D view. Open one for its exact factor breakdown.`
          : `${markers.length} factor-triggered level${markers.length === 1 ? '' : 's'} identified. Switch to Modeled Post-Op to show markers in 3D.`
        : state.itinerary.length
          ? 'No construct-boundary or unspanned-disruption point is present. This does not establish low risk; required patient and mechanical inputs remain unavailable.'
          : 'Add a modeled construct or posterior-element disruption to identify transparent review points.';
      setSurveillanceVisibility(state.surveillance.visible, false);
      if (selectedLevelId) renderSurveillanceInspector(surveillanceMarkerFor(selectedLevelId));
    }

    function updatePostoperativeSurveillance() {
      state.surveillance.assessment = computePostoperativeSurveillance(
        state.params,
        state.itinerary,
        state.levelFactors,
        state.prediction
      );
      renderPostoperativeSurveillance();
      return state.surveillance.assessment;
    }

    function updateCanvasDescription() {
      if (state.inspection?.active) {
        const level = displayLevel(state.inspection.levelId || '');
        const mode = segmentRecords.get(state.inspection.levelId)?.geometryMode;
        const source = mode === 'ct_reference' ? 'a CT-derived external whole-bone reference surface' : 'the explicit semantic procedural fallback';
        els.canvasDescription.textContent = `Focused non-anatomic inspection of ${level} using ${source}. Numeric measurements, containment, collision checks, and screw-safety inference are disabled. Use Restore full construct in Anatomy Lab to return to the authored pose.`;
        return;
      }
      const current = getDisplayedAlignment();
      const procedures = state.itinerary.length
        ? state.itinerary.map(item => `${PROCEDURES[item.procedureId].name} at ${displayLevel(item.levelId)}`).join(', ')
        : 'no procedures planned';
      const measurementLabel = state.provenance.measuredSva === 'demo_preset'
        ? 'Hypothetical demo'
        : state.provenance.measuredSva === 'authored_reference_preset' ? 'Authored preset'
        // An automatic-beta value the user accepted is not a hand measurement.
        : state.provenance.measuredSva === 'experimental_auto_landmark_measurement_user_accepted' ? 'Auto beta (accepted)' : 'Measured';
      const measurement = Number.isFinite(current.measuredSva)
        ? ` ${measurementLabel} C7 SVA ${signedNumber(current.measuredSva, 1)} centimeters.`
        : '';
      const assumption = state.assumptions.applyReciprocalResponse ? ' Reciprocal thoracic kyphosis response is enabled; the pelvic balance (PT) response is always applied.' : ' Reciprocal thoracic kyphosis response is disabled; the pelvic balance (PT) response is always applied.';
      const availability = state.view === 'post' && state.prediction?.applicabilityStatus !== 'within_engineering_domain'
        ? ` Modeled alignment is suppressed: ${state.prediction.reason}`
        : '';
      const authoredFactors = authoredDisplayFactorCount();
      const authoredStatus = authoredFactors
        ? ` ${authoredFactors} manually authored three-dimensional display factor${authoredFactors === 1 ? ' is' : 's are'} active; the numeric sagittal metrics are unchanged and are not derived from those factors.`
        : '';
      // The coronal balancing bend (applyPathologyTargets) is a display
      // convention, so it is named whenever it is drawn.
      const coronalBalance = worldRoot?.userData?.coronalBalance || null;
      const balanceActive = coronalBalance && coronalBalance.mode !== 'none'
        && (Math.abs(coronalBalance.caudalDeg) + Math.abs(coronalBalance.cranialDeg)) > .05;
      const coronalBalanceStatus = balanceActive
        ? ` Coronal display: an unmeasured balancing bend of ${Math.abs(coronalBalance.caudalDeg).toFixed(0)}° below and ${Math.abs(coronalBalance.cranialDeg).toFixed(0)}° above the authored coronal geometry keeps the head over the pelvis (no C7–CSVL decompensation input exists); it is not a reported Cobb.`
        : '';
      const ctLevels = [...segmentRecords.values()].filter(record => record.geometryMode === 'ct_reference').length;
      const referenceContext = `${pelvisReferenceLayer?.children.length ? ', a CT-derived pelvis' : ''}${lowerExtremityContext?.userData?.geometryMode === 'bodyparts3d_bilateral_reference' ? ', and bilateral open-atlas lower limbs' : ''}`;
      const geometryStatus = ctLevels
        ? ` ${ctLevels} intact level${ctLevels === 1 ? '' : 's'} use CT-derived external reference surfaces${referenceContext}; edited or operated levels may use an explicit semantic fallback.`
        : ' The semantic procedural fallback is active because the embedded CT surfaces are unavailable or incompatible with the current edit.';
      els.canvasDescription.textContent = `${state.view === 'post' ? 'Modeled post-operative' : 'Pre-operative'} three-dimensional reference spine. Pelvic incidence ${degree(state.params.pi)}, pelvic tilt ${degree(current.pt)}, derived sacral slope ${degree(state.params.pi - current.pt)}, lumbar lordosis ${degree(current.ll)}, thoracic kyphosis ${degree(current.tk)}, and signed C2–C7 angle ${signedDegree(current.cl)}. PI changes the authored sacral-base morphology while PT changes hip-centered posture.${geometryStatus}${authoredStatus}${coronalBalanceStatus}${measurement}${assumption}${availability} ${procedures}. Use drag to rotate, scroll or pinch to zoom, arrow keys to orbit, plus or minus to zoom, and R to reset.`;
    }

    function renderItinerary() {
      els.itineraryList.replaceChildren();
      els.procedureCount.textContent = String(state.itinerary.length);

      if (!state.itinerary.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-itinerary';
        empty.innerHTML = '<div><i class="fa-solid fa-layer-group" aria-hidden="true"></i><strong>No procedures added</strong><span>Choose a level and procedure to begin the modeled scenario.</span></div>';
        els.itineraryList.append(empty);
        return;
      }

      state.itinerary.forEach((item, index) => {
        const procedure = PROCEDURES[item.procedureId];
        const level = LEVEL_BY_ID.get(item.levelId);
        const plannedAngle = correctionFor(item, procedure);
        const card = document.createElement('article');
        card.className = 'procedure-card';
        card.dataset.itemId = String(item.id);
        card.dataset.level = item.levelId;
        // Name the metric the correction actually changes (per spanned disc),
        // not the anatomic region: ACDF at C7-T1 is a local junction rotation
        // that leaves CL unchanged, and a thoracic SPO lowers TK.
        const correctionDescription = plannedAngle === 0
          ? 'no angular change'
          : `scenario ${plannedAngle > 0 ? '+' : ''}${plannedAngle}° (${describeCorrectionMetricEffect(level.id, plannedAngle)})`;
        const planeParts = [
          Number(item.plannedCoronal) ? `coronal ${signedDegree(Number(item.plannedCoronal))}` : '',
          Number(item.plannedAxialRotation) ? `axial ${signedDegree(Number(item.plannedAxialRotation))}` : '',
          Number(item.plannedTranslationMm) ? `apical shift ${signedNumber(Number(item.plannedTranslationMm), 0)} mm` : ''
        ].filter(Boolean);
        const planeDescription = planeParts.length ? ` · ${planeParts.join(' · ')}` : '';
        let topsFitNoticeHtml = '';
        if (procedure.type === 'posterior_motion' && sceneReady) {
          const hardwareRoot = segmentRecords.get(item.levelId)?.hardwareLayer?.children
            .find(child => child.userData.itemId === item.id);
          const topsMetadata = hardwareRoot?.userData?.topsMotionDevice;
          if (hardwareRoot?.userData?.hardwareWithheld) {
            topsFitNoticeHtml = `<div class="procedure-fit-warning"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Construct withheld: ${escapeHtml(hardwareRoot.userData.withheldReason || 'source anchors are unavailable')}.</div>`;
          } else if (topsMetadata?.proxyDisplaySeatingStatus === 'unseated_proxy') {
            const reasons = topsMetadata.proxyDisplaySeatingReasons?.length
              ? topsMetadata.proxyDisplaySeatingReasons.join('; ')
              : 'the selected public configuration does not align with the reference anchor proxies';
            topsFitNoticeHtml = `<div class="procedure-fit-warning"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Reference fit proxy unseated: ${escapeHtml(reasons)}. No patient fit is inferred.</div>`;
          }
        }
        card.innerHTML = `
          <div class="procedure-index">${String(index + 1).padStart(2, '0')}</div>
          <div class="procedure-copy">
            <div class="procedure-title-line"><span class="level-pill">${displayLevel(item.levelId)}</span><span class="procedure-name">${procedure.name}</span></div>
            <div class="procedure-effect">${procedure.effect} · ${correctionDescription}${planeDescription} · ${item.plannedAngleSource === 'procedure_default_assumption' ? 'default assumption' : item.plannedAngleSource === 'evidence_comparison_prefill' ? 'comparison prefill' : item.plannedAngleSource === 'not_applicable' ? 'not applicable' : 'user-planned'}</div>
            <div class="hardware-label"><i class="fa-solid fa-microchip" aria-hidden="true"></i> ${escapeHtml(implantPlanSummary(item.implantPlan))}</div>
            ${topsFitNoticeHtml}
          </div>
          <div class="procedure-actions">
            <button class="edit-button" type="button" aria-label="Edit ${procedure.name} at ${displayLevel(item.levelId)}" title="Edit this item"><i class="fa-solid fa-pen" aria-hidden="true"></i><span>Edit</span></button>
            <button class="remove-button" type="button" aria-label="Remove ${procedure.name} at ${displayLevel(item.levelId)}" title="Remove this item"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
          </div>`;
        if (procedureEdit.itemId === item.id) card.dataset.editing = 'true';

        const removeButton = card.querySelector('.remove-button');
        removeButton.addEventListener('click', () => removeProcedure(item.id));
        card.querySelector('.edit-button')?.addEventListener('click', () => beginProcedureEdit(item.id));
        card.addEventListener('mouseenter', () => setHighlightedLevel(item.levelId));
        card.addEventListener('mouseleave', () => setHighlightedLevel(null));
        card.addEventListener('focusin', () => setHighlightedLevel(item.levelId));
        card.addEventListener('focusout', event => {
          if (!card.contains(event.relatedTarget)) setHighlightedLevel(null);
        });
        els.itineraryList.append(card);
      });
    }

    function stageConstructComparisonStep(optionId, stepIndex) {
      const option = state.constructComparisons.find(candidate => candidate.id === optionId);
      const step = option?.steps?.[stepIndex];
      if (!option || !step) return false;
      const itineraryLength = state.itinerary.length;
      implantEls.customMode.checked = false;
      implantEls.supplementalPosterior.checked = true;
      els.levelSelect.value = step.levelId;
      populateProcedureSelect(step.procedureId);
      els.procedureSelect.value = step.procedureId;
      updateImpactPreview();
      const setEditorValue = (input, value) => {
        if (!input || input.disabled) return;
        const minimum = Number(input.min);
        const maximum = Number(input.max);
        const requested = Number(value) || 0;
        const clamped = Math.min(maximum, Math.max(minimum, requested));
        const increment = Number(input.step);
        const snapped = Number.isFinite(increment) && increment > 0
          ? minimum + Math.round((clamped - minimum) / increment) * increment
          : clamped;
        input.value = String(Number(Math.min(maximum, Math.max(minimum, snapped)).toFixed(4)));
        input.removeAttribute('aria-invalid');
      };
      setEditorValue(els.correctionInput, step.sagittal);
      setEditorValue(els.coronalCorrectionInput, step.coronal);
      setEditorValue(els.axialCorrectionInput, step.axial);
      setEditorValue(els.translationCorrectionInput, step.translation);
      state.editorCorrectionSource = els.correctionInput.disabled ? 'not_applicable' : 'evidence_comparison_prefill';
      state.editorComparisonPrefill = Object.freeze({
        optionId: option.id,
        optionTitle: option.title,
        stepIndex,
        stepLabel: step.label,
        evidenceIds: Object.freeze([...option.evidenceIds])
      });
      els.procedureError.textContent = '';
      if (state.itinerary.length !== itineraryLength) throw new Error('Construct comparison prefill must not mutate the itinerary.');
      announce(`${option.title}: ${step.label} loaded into the editor at ${displayLevel(step.levelId)}. Review all values before adding it.`);
      els.procedureForm.scrollIntoView?.({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      (els.correctionInput.disabled ? els.procedureSelect : els.correctionInput).focus({ preventScroll: true });
      return true;
    }

    function constructBranchEvaluationText(evaluation) {
      if (!evaluation?.valid) return evaluation?.message || 'This branch is not currently applicable.';
      const before = evaluation.before.residual;
      const after = evaluation.after.residual;
      const metrics = [
        ['PI–LL', 'piLl', '°', 0.1],
        ['TK departure', 'thoracicKyphosis', '°', 0.1],
        ['CL below T1S-based target', 'cervicalLordosis', '°', 0.1],
        ['Primary Cobb', 'primaryCobb', '°', 0.1],
        ['Axial rotation', 'axialRotation', '°', 0.1],
        ['Apical translation', 'apicalTranslation', ' mm', 0.5]
      ];
      const changed = metrics
        .filter(([, key, , threshold]) => Math.abs(Number(after[key]) - Number(before[key])) >= threshold)
        .map(([label, key, unit]) => `${label} ${signedNumber(before[key], 1)}${unit} → ${signedNumber(after[key], 1)}${unit}`);
      return changed.length
        ? `Modeled residual: ${changed.join(' · ')}.`
        : 'This branch changes construct topology but no currently modeled target residual.';
    }

    function applyConstructComparisonBranch(optionId, branchId) {
      const option = state.constructComparisons.find(candidate => candidate.id === optionId);
      const branch = option?.branches?.find(candidate => candidate.id === branchId);
      if (!option || !branch) return false;
      const plan = planConstructComparisonBranch(
        state.params,
        state.globalDeformity,
        state.itinerary,
        state.assumptions,
        option,
        branch,
        nextProcedureId
      );
      if (!plan.valid) {
        els.procedureError.textContent = plan.message;
        announce(`Construct branch not applied: ${plan.message}`);
        return false;
      }
      const priorItinerary = state.itinerary;
      const priorNextProcedureId = nextProcedureId;
      if (typeof checkpointCaseHistory === 'function') checkpointCaseHistory();
      if (typeof cancelProcedureEdit === 'function') cancelProcedureEdit({ silent: true });
      try {
        state.itinerary = [...plan.draftItinerary];
        nextProcedureId += plan.candidates.length;
        renderItinerary();
        refreshApplication({ hardwareChanged: true, markPrediction: true });
      } catch (error) {
        state.itinerary = priorItinerary;
        nextProcedureId = priorNextProcedureId;
        renderItinerary();
        refreshApplication({ hardwareChanged: true });
        const message = error instanceof Error ? error.message : String(error);
        els.procedureError.textContent = message;
        announce(`Construct branch rolled back: ${message}`);
        return false;
      }
      const automaticCount = plan.expandedSteps.filter(step => step.autoAddedPrerequisite).length;
      if (typeof checkpointCaseHistory === 'function') checkpointCaseHistory();
      showToast(`${branch.label} applied · ${plan.candidates.length} item${plan.candidates.length === 1 ? '' : 's'}`, caseHistoryUndoAction());
      announce(`${option.title}: ${branch.label} applied atomically${automaticCount ? ` with ${automaticCount} automatic prerequisite` : ''}. Review every authored value and implant dimension.`);
      return true;
    }

    function renderConstructComparisons() {
      const previousCount = state.constructComparisons.length;
      // Comparisons are residuals of the current modeled scenario, so they are
      // withheld with the scenario. Computing them anyway re-ran the engine and
      // rethrew the out-of-domain RangeError from inside refreshApplication, which
      // skipped every later UI update and froze the view on stale values.
      let withheldReason = state.prediction?.applicabilityStatus === 'within_engineering_domain'
        ? ''
        : state.prediction?.reason || state.predictionError || 'the modeled scenario is outside its engineering domain';
      let computed = [];
      if (!withheldReason) {
        try {
          computed = computeConstructComparisons(
            state.params,
            state.globalDeformity,
            state.levelFactors,
            state.itinerary,
            state.assumptions
          );
        } catch (error) {
          if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
          withheldReason = error.message;
        }
      }
      state.constructComparisons = [...computed];
      const options = state.constructComparisons;
      els.constructComparisonCount.textContent = String(options.length);
      const comparisonCard = els.constructComparisonList.closest('.construct-comparison-card');
      if (comparisonCard) {
        comparisonCard.dataset.hasOptions = options.length ? 'true' : 'false';
        if (options.length && !previousCount) comparisonCard.open = true;
      }
      els.constructComparisonList.replaceChildren();
      if (withheldReason) {
        const empty = document.createElement('p');
        empty.className = 'surveillance-empty';
        empty.textContent = `Construct comparisons are withheld while the modeled scenario is unavailable: ${withheldReason}`;
        els.constructComparisonList.append(empty);
        els.constructComparisonSummary.textContent = 'Construct comparisons unavailable. Adjust the inputs or remove a procedure to return inside the modeled domain.';
        return;
      }
      if (!options.length) {
        const empty = document.createElement('p');
        empty.className = 'surveillance-empty';
        empty.textContent = 'No compatible construct branch currently changes a modeled residual. PT- or SVA-only departures, flexibility, symptoms, neural compression, and other unmodeled factors are intentionally not converted into a procedure.';
        els.constructComparisonList.append(empty);
        els.constructComparisonSummary.textContent = 'No safe educational branch can be generated from the currently modeled targets alone.';
        return;
      }
      options.forEach(option => {
        const article = document.createElement('article');
        article.className = 'construct-option';
        const title = document.createElement('h4');
        title.textContent = option.title;
        const reason = document.createElement('p');
        reason.className = 'construct-option-reason';
        reason.textContent = option.matchReasons.join(' ');
        const summary = document.createElement('p');
        summary.className = 'construct-option-summary';
        summary.textContent = option.constructSummary;
        const missing = document.createElement('p');
        missing.className = 'construct-option-missing';
        missing.textContent = `Important clinical context not evaluated here: ${option.missingInputs.join(' · ')}.`;
        const evidence = document.createElement('details');
        evidence.className = 'construct-option-evidence';
        const evidenceSummary = document.createElement('summary');
        evidenceSummary.textContent = `Evidence and limitations · ${option.evidenceIds.length} source${option.evidenceIds.length === 1 ? '' : 's'}`;
        evidence.append(evidenceSummary);
        option.evidenceIds.forEach(evidenceId => {
          const source = CONSTRUCT_EVIDENCE_SOURCES[evidenceId];
          const sourceItem = document.createElement('div');
          sourceItem.className = 'construct-evidence-item';
          const link = document.createElement('a');
          link.href = source.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = source.label;
          link.setAttribute('aria-label', `${source.label}; opens in a new tab`);
          const context = document.createElement('p');
          context.textContent = `${source.studyDesign} · ${source.population}. ${source.supportedClaim}`;
          const limitation = document.createElement('p');
          limitation.className = 'construct-evidence-limitation';
          limitation.textContent = `Limitation: ${source.limitation}`;
          sourceItem.append(link, context, limitation);
          evidence.append(sourceItem);
        });
        const actions = document.createElement('div');
        actions.className = 'construct-option-actions';
        option.branches.forEach(branch => {
          const branchGroup = document.createElement('div');
          branchGroup.className = 'construct-branch';
          const branchLabel = document.createElement('strong');
          branchLabel.textContent = branch.label;
          const branchNote = document.createElement('span');
          const automaticCount = branch.evaluation?.expandedSteps?.filter(step => step.autoAddedPrerequisite).length || 0;
          branchNote.textContent = automaticCount
            ? `${automaticCount} linked prerequisite${automaticCount === 1 ? '' : 's'} will be inserted automatically`
            : branch.sequence && branch.steps.length > 1 ? 'Applied in this order' : 'Alternative branch';
          const evaluation = document.createElement('p');
          evaluation.className = `construct-branch-evaluation${branch.evaluation?.valid ? '' : ' construct-branch-error'}`;
          evaluation.textContent = constructBranchEvaluationText(branch.evaluation);
          const branchButtons = document.createElement('div');
          branchButtons.className = 'construct-branch-buttons';
          const applyButton = document.createElement('button');
          applyButton.type = 'button';
          applyButton.className = 'construct-prefill-button construct-apply-button';
          applyButton.textContent = 'Apply branch';
          applyButton.setAttribute('aria-label', `${option.title}: apply ${branch.label} atomically`);
          applyButton.disabled = !branch.evaluation?.valid;
          if (!branch.evaluation?.valid) applyButton.title = branch.evaluation?.message || 'This branch is unavailable.';
          applyButton.addEventListener('click', () => applyConstructComparisonBranch(option.id, branch.id));
          branchButtons.append(applyButton);
          branch.steps.forEach(step => {
            const stepIndex = option.steps.indexOf(step);
            const duplicate = state.itinerary.some(item => item.levelId === step.levelId && item.procedureId === step.procedureId);
            const conflict = duplicate
              ? `${PROCEDURES[step.procedureId].name} is already in the itinerary at ${displayLevel(step.levelId)}.`
              : findProcedureConflict(step.procedureId, step.levelId, state.itinerary);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'construct-prefill-button';
            button.textContent = `Prefill ${step.label}`;
            button.setAttribute('aria-label', `${option.title}: prefill ${step.label} at ${displayLevel(step.levelId)}`);
            button.disabled = Boolean(conflict);
            if (conflict) button.title = conflict;
            button.addEventListener('click', () => stageConstructComparisonStep(option.id, stepIndex));
            branchButtons.append(button);
          });
          branchGroup.append(branchLabel, branchNote, evaluation, branchButtons);
          actions.append(branchGroup);
        });
        article.append(title, reason, summary, missing, evidence, actions);
        els.constructComparisonList.append(article);
      });
      els.constructComparisonSummary.textContent = `${options.length} unranked comparison scenario${options.length === 1 ? '' : 's'} matched to the residual authored pattern. Prefill does not alter the itinerary; Apply branch commits the reviewed sequence atomically.`;
    }

    // Set once the gait module's own state object exists. refreshApplication is
    // declared long before that object, and can run during boot, so the gait
    // resync below has to stay inert until the module is actually live.
    let gaitModuleReady = false;

    function refreshApplication({ hardwareChanged = false, markPrediction = false } = {}) {
      try {
        state.prediction = calculateBiomechanics(state.params, state.itinerary, state.assumptions);
        state.threePlanePrediction = computeThreePlaneScenario(state.globalDeformity, state.itinerary, state.assumptions);
        state.predictionError = null;
      } catch (error) {
        if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
        state.predictionError = error instanceof Error ? error.message : String(error);
        state.prediction = createSuppressedPrediction(error);
      }
      updateHeaderMetrics();
      updatePredictionSummary();
      renderConstructComparisons();
      updatePostoperativeSurveillance();
      updateShapeStatus();
      updateMechanicsSummary();
      updateCanvasDescription();
      els.modeChip.textContent = state.view === 'post'
        ? state.prediction.applicabilityStatus === 'within_engineering_domain' ? 'Modeled anatomy + hardware' : 'Construct shown · alignment suppressed'
        : 'Pre-Op anatomy';
      if (markPrediction && state.view === 'pre') els.viewSwitch.dataset.updated = 'true';
      if (sceneReady) {
        if (hardwareChanged) rebuildHardware();
        applyModelTargets();
        if (hardwareChanged || state.itinerary.some(item => PROCEDURES[item.procedureId]?.type === 'posterior_motion')) {
          renderItinerary();
        }
        updateShapeStatus();
        updateCanvasDescription();
      }
      // Last, because applyModelTargets above invalidates the cached gait
      // amplitudes and rewrites the pose values they are derived from. The
      // animation already recovered lazily on the next frame; the readout panel
      // did not, so it stayed pinned to whatever the case looked like when gait
      // was switched on.
      refreshGaitDerivedState();
      if (typeof scheduleCaseCheckpoint === 'function') scheduleCaseCheckpoint();
      if (typeof renderAgeReference === 'function') renderAgeReference();
      if (typeof syncLegendLayers === 'function') syncLegendLayers();
    }

    /* Editing an existing itinerary item (F107). The item is loaded into the
       same form used to add one, and "Update item" replaces it in place after
       the same validation and conflict checks, run against the itinerary
       without the item being edited. The implant plan saved with the item is
       kept unless an implant control is changed while editing. */
    const procedureEdit = { itemId: null, implantTouched: false };

    function syncProcedureEditChrome() {
      const editing = procedureEdit.itemId !== null
        ? state.itinerary.find(item => item.id === procedureEdit.itemId) || null
        : null;
      const label = $('addProcedureLabel');
      const banner = $('procedureEditBanner');
      const cancel = $('cancelProcedureEdit');
      if (label) label.textContent = editing ? 'Update item' : 'Add to itinerary';
      if (cancel) cancel.hidden = !editing;
      if (banner) {
        banner.hidden = !editing;
        banner.textContent = editing
          ? `Editing item ${String(state.itinerary.indexOf(editing) + 1).padStart(2, '0')} · ${PROCEDURES[editing.procedureId]?.name || editing.procedureId} at ${displayLevel(editing.levelId)}. Implant sizes stay as saved unless you change them.`
          : '';
      }
      els.procedureForm.dataset.editing = editing ? 'true' : 'false';
      els.itineraryList.querySelectorAll?.('.procedure-card').forEach(card => {
        if (editing && card.dataset.itemId === String(editing.id)) card.dataset.editing = 'true';
        else delete card.dataset.editing;
      });
    }

    function cancelProcedureEdit({ silent = false } = {}) {
      if (procedureEdit.itemId === null) return false;
      procedureEdit.itemId = null;
      procedureEdit.implantTouched = false;
      els.procedureError.textContent = '';
      syncProcedureEditChrome();
      if (!silent) announce('Edit cancelled. The item was not changed.');
      return true;
    }

    function beginProcedureEdit(itemId) {
      const item = state.itinerary.find(candidate => candidate.id === itemId);
      if (!item) return false;
      const level = LEVEL_BY_ID.get(item.levelId);
      if (!level) return false;
      procedureEdit.itemId = item.id;
      procedureEdit.implantTouched = false;
      implantEls.customMode.checked = item.implantPlan?.dimensionMode === 'custom';
      els.levelSelect.value = item.levelId;
      populateProcedureSelect(item.procedureId);
      els.procedureSelect.value = item.procedureId;
      if (OPTIONAL_POSTERIOR_FIXATION_PROCEDURES.has(item.procedureId)) {
        implantEls.config.dataset.procedureId = item.procedureId;
        implantEls.supplementalPosterior.checked = item.implantPlan?.constructVariant !== 'interbody_only';
      }
      updateImpactPreview({ preserveEditorValues: false });
      const setValue = (input, value) => {
        if (!input || input.disabled) return;
        input.value = String(Number(value) || 0);
        input.removeAttribute('aria-invalid');
      };
      setValue(els.correctionInput, item.plannedAngle);
      setValue(els.coronalCorrectionInput, item.plannedCoronal);
      setValue(els.axialCorrectionInput, item.plannedAxialRotation);
      setValue(els.translationCorrectionInput, item.plannedTranslationMm);
      state.editorCorrectionSource = els.correctionInput.disabled ? 'not_applicable' : (item.plannedAngleSource || 'user_planned');
      state.editorComparisonPrefill = item.comparisonPrefill || null;
      // The re-render above must not clear the values just loaded.
      lastImpactPreviewKey = `${item.procedureId}|${item.levelId}`;
      els.procedureError.textContent = '';
      syncProcedureEditChrome();
      announce(`Editing ${PROCEDURES[item.procedureId].name} at ${displayLevel(item.levelId)}. Change the values, then choose Update item, or Cancel edit.`);
      els.procedureForm.scrollIntoView?.({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      (els.correctionInput.disabled ? els.procedureSelect : els.correctionInput).focus?.({ preventScroll: true });
      return true;
    }

    function addProcedure() {
      els.procedureError.textContent = '';
      const levelId = els.levelSelect.value;
      const procedureId = els.procedureSelect.value;
      const level = LEVEL_BY_ID.get(levelId);
      const procedure = PROCEDURES[procedureId];
      const correctionRaw = els.correctionInput.value.trim();
      const editing = procedureEdit.itemId !== null
        ? state.itinerary.find(item => item.id === procedureEdit.itemId) || null
        : null;
      if (procedureEdit.itemId !== null && !editing) cancelProcedureEdit({ silent: true });
      const editIndex = editing ? state.itinerary.indexOf(editing) : -1;
      // Validation runs against the itinerary without the item being replaced.
      const baseItinerary = editing ? state.itinerary.filter(item => item.id !== editing.id) : state.itinerary;

      if (!level || !procedure || !isProcedureCompatible(procedure, level)) {
        els.procedureError.textContent = 'That procedure is not available at the selected level.';
        return;
      }
      const correctionPolicy = correctionPolicyFor(procedure, level);
      const plannedAngle = correctionPolicy.enabled ? (correctionRaw === '' ? NaN : Number(correctionRaw)) : 0;
      if (!Number.isFinite(plannedAngle) || !els.correctionInput.validity.valid || plannedAngle < correctionPolicy.minDeg || plannedAngle > correctionPolicy.maxDeg) {
        // A value inside the range can still fail on the 0.5° step; say so
        // instead of repeating a range the value already satisfies.
        els.procedureError.textContent = Number.isFinite(plannedAngle) && els.correctionInput.validity.stepMismatch
          && plannedAngle >= correctionPolicy.minDeg && plannedAngle <= correctionPolicy.maxDeg
          ? `Use 0.5° increments for the planned correction (for example 12 or 12.5), ${correctionPolicy.minDeg}° to ${correctionPolicy.maxDeg}°.`
          : `Enter a planned correction from ${correctionPolicy.minDeg}° to ${correctionPolicy.maxDeg}° for this scenario.`;
        els.correctionInput.setAttribute('aria-invalid', 'true');
        els.correctionInput.focus();
        return;
      }
      els.correctionInput.removeAttribute('aria-invalid');
      const planePolicy = procedureThreePlanePolicyFor(procedureId, level);
      const readPlaneInput = (input, axis, label) => {
        const value = axis.enabled ? Number(input.value.trim()) : 0;
        if (!Number.isFinite(value) || !input.validity.valid || value < axis.min || value > axis.max) {
          input.setAttribute('aria-invalid', 'true');
          const stepOnly = Number.isFinite(value) && input.validity.stepMismatch && value >= axis.min && value <= axis.max;
          throw new RangeError(stepOnly
            ? `Use ${input.step} ${axis.unit} increments for ${label} (${axis.min} to ${axis.max} ${axis.unit}).`
            : `Enter ${label} from ${axis.min} to ${axis.max} ${axis.unit} for this scenario.`);
        }
        input.removeAttribute('aria-invalid');
        return value;
      };
      let plannedCoronal;
      let plannedAxialRotation;
      let plannedTranslationMm;
      try {
        plannedCoronal = readPlaneInput(els.coronalCorrectionInput, planePolicy.coronal, 'a coronal change');
        plannedAxialRotation = readPlaneInput(els.axialCorrectionInput, planePolicy.axial, 'an axial rotation change');
        plannedTranslationMm = readPlaneInput(els.translationCorrectionInput, planePolicy.translation, 'an apical translation change');
      } catch (error) {
        els.procedureError.textContent = error instanceof Error ? error.message : String(error);
        return;
      }
      if (baseItinerary.some(item => item.levelId === levelId && item.procedureId === procedureId)) {
        const message = `${procedure.name} at ${displayLevel(levelId)} is already in the itinerary.`;
        els.procedureError.textContent = message;
        announce(message);
        return;
      }

      const plannedAngleSource = correctionPolicy.enabled ? state.editorCorrectionSource : 'not_applicable';
      let implantPlan;
      try {
        const keepSavedPlan = editing && !procedureEdit.implantTouched
          && editing.levelId === levelId && editing.procedureId === procedureId && editing.implantPlan;
        implantPlan = keepSavedPlan ? editing.implantPlan : buildImplantPlan(procedureId, levelId);
      } catch (error) {
        if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        els.procedureError.textContent = message;
        announce(message);
        return;
      }
      const conflict = findProcedureConflict(procedureId, levelId, baseItinerary, implantPlan);
      if (conflict) {
        els.procedureError.textContent = conflict;
        announce(conflict);
        return;
      }
      const comparisonPrefill = state.editorComparisonPrefill
        ? deepFreezeSnapshot({ ...state.editorComparisonPrefill, evidenceIds: [...(state.editorComparisonPrefill.evidenceIds || [])] })
        : null;
      const candidates = [];
      const automaticDecompression = procedureId === 'tops'
        && !baseItinerary.some(item => item.levelId === levelId && item.procedureId === 'laminectomy');
      let nextId = nextProcedureId;
      if (automaticDecompression) {
        const linkedComparisonPrefill = comparisonPrefill
          ? deepFreezeSnapshot({ ...comparisonPrefill, stepLabel: 'Automatic TOPS decompression', autoAddedPrerequisite: true })
          : null;
        candidates.push({
          id: nextId,
          levelId,
          procedureId: 'laminectomy',
          plannedAngle: 0,
          // Laminectomy has no modeled angular output, so its provenance is
          // "not applicable" rather than a default-assumption correction.
          plannedAngleSource: 'not_applicable',
          plannedCoronal: 0,
          plannedAxialRotation: 0,
          plannedTranslationMm: 0,
          implantPlan: buildDefaultSuggestedImplantPlan('laminectomy', levelId),
          comparisonPrefill: linkedComparisonPrefill,
          autoLinkedFor: 'tops'
        });
        nextId += 1;
      }
      const candidate = {
        // An edited item keeps its id, so hardware and review markers follow it.
        id: editing ? editing.id : nextId,
        levelId,
        procedureId,
        plannedAngle,
        plannedAngleSource,
        plannedCoronal,
        plannedAxialRotation,
        plannedTranslationMm,
        implantPlan,
        comparisonPrefill
      };
      if (!editing) nextId += 1;
      candidates.push(candidate);
      const draftItinerary = [...baseItinerary];
      try {
        const insertAt = editing ? Math.max(0, Math.min(editIndex, draftItinerary.length)) : draftItinerary.length;
        const checked = [];
        candidates.forEach(item => {
          if ([...draftItinerary, ...checked].some(existing => existing.levelId === item.levelId && existing.procedureId === item.procedureId)) {
            throw new RangeError(`${PROCEDURES[item.procedureId].name} at ${displayLevel(item.levelId)} is already in the itinerary.`);
          }
          const itemConflict = findProcedureConflict(item.procedureId, item.levelId, [...draftItinerary, ...checked], item.implantPlan);
          if (itemConflict) throw new RangeError(itemConflict);
          checked.push(item);
        });
        draftItinerary.splice(insertAt, 0, ...checked);
        draftItinerary.forEach(item => {
          const requirement = findProcedureRequirement(item.procedureId, item.levelId, draftItinerary);
          if (requirement) throw new RangeError(requirement);
        });
        calculateBiomechanics(state.params, draftItinerary, state.assumptions);
        computeThreePlaneScenario(state.globalDeformity, draftItinerary, state.assumptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        els.procedureError.textContent = message;
        announce(message);
        return;
      }

      if (typeof checkpointCaseHistory === 'function') checkpointCaseHistory();
      nextProcedureId = nextId;
      state.itinerary = draftItinerary;
      procedureEdit.itemId = null;
      procedureEdit.implantTouched = false;
      renderItinerary();
      syncProcedureEditChrome();
      refreshApplication({ hardwareChanged: true, markPrediction: true });
      if (typeof checkpointCaseHistory === 'function') checkpointCaseHistory();
      if (editing) {
        showToast(`${procedure.name} at ${displayLevel(levelId)} updated`, caseHistoryUndoAction());
        announce(`${procedure.name} at ${displayLevel(levelId)} updated in place${automaticDecompression ? ' with its automatic linked decompression' : ''}. Modeled alignment updated.`);
        return;
      }
      showToast(`${procedure.name}${automaticDecompression ? ' + decompression' : ''} added at ${displayLevel(levelId)}`, caseHistoryUndoAction());
      announce(`${procedure.name} at ${displayLevel(levelId)} added${automaticDecompression ? ' with its automatic linked decompression' : ''}. Modeled alignment updated.`);
    }

    function removeProcedure(itemId) {
      const index = state.itinerary.findIndex(item => item.id === itemId);
      if (index < 0) return;
      if (typeof checkpointCaseHistory === 'function') checkpointCaseHistory();
      const [removed] = state.itinerary.splice(index, 1);
      const procedure = PROCEDURES[removed.procedureId];
      const dependentTops = removed.procedureId === 'laminectomy'
        ? state.itinerary.filter(item => item.levelId === removed.levelId && item.procedureId === 'tops')
        : [];
      const autoLinkedDecompression = removed.procedureId === 'tops'
        ? state.itinerary.find(item =>
            item.levelId === removed.levelId
            && item.procedureId === 'laminectomy'
            && item.autoLinkedFor === 'tops'
          )
        : null;
      if (dependentTops.length) {
        const dependentIds = new Set(dependentTops.map(item => item.id));
        state.itinerary = state.itinerary.filter(item => !dependentIds.has(item.id));
      }
      if (autoLinkedDecompression) {
        state.itinerary = state.itinerary.filter(item => item.id !== autoLinkedDecompression.id);
      }
      if (procedureEdit.itemId !== null && !state.itinerary.some(item => item.id === procedureEdit.itemId)) {
        cancelProcedureEdit({ silent: true });
      }
      renderItinerary();
      refreshApplication({ hardwareChanged: true, markPrediction: true });
      if (typeof checkpointCaseHistory === 'function') checkpointCaseHistory();
      const buttons = els.itineraryList.querySelectorAll('.remove-button');
      if (buttons.length) buttons[Math.min(index, buttons.length - 1)].focus();
      else $('addProcedure').focus();
      const linkedRemoval = dependentTops.length
        ? ' and dependent TOPS'
        : autoLinkedDecompression ? ' and automatic decompression' : '';
      showToast(`${procedure.name}${linkedRemoval} removed`, caseHistoryUndoAction());
      announce(`${procedure.name} at ${displayLevel(removed.levelId)} removed${linkedRemoval ? ` with${linkedRemoval.replace(/^ and/, '')}` : ''}. Modeled alignment updated. Undo is available.`);
    }

    function setView(view, shouldAnnounce = true) {
      if (!['pre', 'post'].includes(view)) return;
      state.view = view;
      const isPost = view === 'post';
      els.preViewButton.setAttribute('aria-pressed', String(!isPost));
      els.postViewButton.setAttribute('aria-pressed', String(isPost));
      els.modeChip.textContent = isPost ? 'Modeled anatomy + hardware' : 'Pre-Op anatomy';
      if (isPost) els.viewSwitch.dataset.updated = 'false';
      refreshApplication();
      if (shouldAnnounce) announce(`${isPost ? 'Modeled post-operative' : 'Pre-operative'} view selected.`);
    }

    /* ---------------------------------------------------------------------
       CASE HISTORY (UNDO/REDO), CASE FILES, CASE SUMMARY, AGE REFERENCE
       A "case" is the plain-JSON part of state the user authors: alignment
       inputs and their provenance, assumptions, three-plane and per-level
       geometry, the itinerary with its implant snapshots, the example context
       and the optional age. Imaging is never part of a case: pixels, file
       names and the imaging session stay out of history, case files and the
       copied summary.
    --------------------------------------------------------------------- */
    const CASE_FILE_SCHEMA = 'deformitysim.case';
    // Case files saved before the rename (v0.23.0-alpha builds named Spine Scenario Studio) still open.
    const LEGACY_CASE_FILE_SCHEMAS = Object.freeze(['spine-scenario-studio.case']);
    const CASE_FILE_SCHEMA_VERSION = 1;
    const CASE_FILE_MAX_BYTES = 512 * 1024;
    const CASE_HISTORY_LIMIT = 50;
    const CASE_HISTORY_DEBOUNCE_MS = 650;
    const caseHistory = {
      undo: [], redo: [], current: null, currentKey: '', baselineKey: null,
      timer: 0, restoring: false, lastCheckpointPushed: false
    };

    function captureCaseSnapshot() {
      return JSON.parse(JSON.stringify({
        params: state.params,
        provenance: state.provenance,
        assumptions: state.assumptions,
        globalDeformity: state.globalDeformity,
        levelFactors: state.levelFactors instanceof Map ? Object.fromEntries(state.levelFactors) : state.levelFactors,
        itinerary: state.itinerary,
        nextProcedureId,
        caseContext: state.caseContext,
        demographics: state.demographics || { ageYears: null }
      }));
    }

    function syncCaseHistoryControls() {
      const canUndo = caseHistory.undo.length > 0 || caseHistory.timer !== 0;
      const canRedo = caseHistory.redo.length > 0;
      ['undoCase', 'undoCaseMenu'].forEach(id => { const button = $(id); if (button) button.disabled = !canUndo; });
      ['redoCase', 'redoCaseMenu'].forEach(id => { const button = $(id); if (button) button.disabled = !canRedo; });
    }

    // Records the current case as a history step when it differs from the last
    // recorded one. Returns whether a step was pushed.
    function checkpointCaseHistory() {
      if (caseHistory.restoring) return false;
      window.clearTimeout(caseHistory.timer);
      caseHistory.timer = 0;
      const snapshot = captureCaseSnapshot();
      const key = JSON.stringify(snapshot);
      let pushed = false;
      if (caseHistory.current === null) {
        caseHistory.current = snapshot;
        caseHistory.currentKey = key;
      } else if (key !== caseHistory.currentKey) {
        caseHistory.undo.push(caseHistory.current);
        if (caseHistory.undo.length > CASE_HISTORY_LIMIT) caseHistory.undo.shift();
        caseHistory.redo.length = 0;
        caseHistory.current = snapshot;
        caseHistory.currentKey = key;
        pushed = true;
      }
      caseHistory.lastCheckpointPushed = pushed;
      syncCaseHistoryControls();
      return pushed;
    }

    // Slider drags and typing refresh the model on every input event; they are
    // coalesced into one undo step once the edits pause.
    function scheduleCaseCheckpoint() {
      if (caseHistory.restoring || caseHistory.current === null) return;
      window.clearTimeout(caseHistory.timer);
      caseHistory.timer = window.setTimeout(checkpointCaseHistory, CASE_HISTORY_DEBOUNCE_MS);
      syncCaseHistoryControls();
    }

    // Toast action for the change just committed; null when that change pushed
    // no history step, so the toast never offers to undo something older.
    function caseHistoryUndoAction() {
      if (!caseHistory.lastCheckpointPushed || !caseHistory.undo.length) return null;
      return { label: 'Undo', run: () => undoCaseEdit() };
    }

    function markCaseBaseline() {
      caseHistory.baselineKey = caseHistory.currentKey;
    }

    function caseDirtySummary() {
      checkpointCaseHistory();
      const imaging = Boolean(state.patientImaging.status !== 'none'
        || patientImagingSession.frontal || patientImagingSession.lateral || patientImagingSession.ctFiles.length);
      const edited = caseHistory.baselineKey !== null && caseHistory.currentKey !== caseHistory.baselineKey;
      return { dirty: edited || imaging, edited, imaging, procedures: state.itinerary.length, ...imagingLossSummary() };
    }

    // What replacing the case would release from the imaging session: films
    // chosen or staged, and landmarks placed on them (manual points and guide
    // anchors). Undo restores the case only, so the confirmation names these.
    function imagingLossSummary() {
      const films = ['frontal', 'lateral', 'supine'].filter(slot => patientImagingSession[slot]).length;
      const ctFiles = patientImagingSession.ctFiles.length;
      let landmarks = 0;
      try {
        const autocal = window.__SPINE_AUTOCAL__;
        const count = map => map && typeof map === 'object' ? Object.values(map).filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y)).length : 0;
        Object.values(autocal?.manual?.points || {}).forEach(points => { landmarks += count(points); });
        Object.values(autocal?.getGuides?.() || {}).forEach(guides => { landmarks += count(guides); });
      } catch (_) { landmarks = 0; }
      return { films, filmsStaged: state.patientImaging.status === 'staged', ctFiles, landmarks };
    }

    function syncCaseInputsFromState() {
      ['pi', 'll', 'tk', 'cl', 'pt'].forEach(key => {
        const input = $(`${key}Slider`);
        if (!input || !Number.isFinite(state.params[key])) return;
        input.value = String(state.params[key]);
        syncSliderVisual(input);
      });
      els.measuredSvaInput.value = Number.isFinite(state.params.measuredSva) ? String(state.params.measuredSva) : '';
      setFieldError(els.measuredSvaInput, null);
      syncMeasuredSvaHint();
      const ageInput = $('ageInput');
      if (ageInput) {
        ageInput.value = Number.isFinite(state.demographics?.ageYears) ? String(state.demographics.ageYears) : '';
        setFieldError(ageInput, null);
      }
      if (ANATOMY_LEVEL_IDS.includes(state.inspection.levelId)) labEls.levelSelect.value = state.inspection.levelId;
      syncAnatomyLabControls();
      if (state.caseContext?.exampleId && CASE_EXAMPLES[state.caseContext.exampleId]) {
        demoEls.select.value = state.caseContext.exampleId;
        syncCaseExamplePreview();
      }
    }

    // Restores a captured (or validated, loaded) case. Imaging is untouched.
    function applyCaseSnapshot(snapshot) {
      caseHistory.restoring = true;
      try {
        cancelProcedureEdit({ silent: true });
        if (state.inspection.active && typeof exitInspectionMode === 'function') exitInspectionMode();
        state.params = { ...snapshot.params };
        state.provenance = { ...snapshot.provenance };
        state.assumptions = { ...snapshot.assumptions };
        state.globalDeformity = { ...createDefaultGlobalDeformity(), ...snapshot.globalDeformity };
        state.levelFactors = Object.fromEntries(Object.entries(snapshot.levelFactors)
          .map(([levelId, factors]) => [levelId, { ...factors }]));
        state.itinerary = snapshot.itinerary.map(item => ({
          ...item,
          implantPlan: item.implantPlan ? deepFreezeSnapshot(JSON.parse(JSON.stringify(item.implantPlan))) : item.implantPlan,
          comparisonPrefill: item.comparisonPrefill ? deepFreezeSnapshot(JSON.parse(JSON.stringify(item.comparisonPrefill))) : null
        }));
        state.constructComparisons = [];
        state.caseContext = {
          exampleId: snapshot.caseContext?.exampleId ?? null,
          label: snapshot.caseContext?.label ?? null,
          featureTags: (snapshot.caseContext?.featureTags || []).map(tag => ({ ...tag })),
          reportedContext: { ...(snapshot.caseContext?.reportedContext || {}) },
          limitations: [...(snapshot.caseContext?.limitations || [])]
        };
        state.demographics = { ageYears: Number.isFinite(snapshot.demographics?.ageYears) ? snapshot.demographics.ageYears : null };
        const highestId = state.itinerary.reduce((maximum, item) => Math.max(maximum, Number(item.id) || 0), 0);
        nextProcedureId = Math.max(Number(snapshot.nextProcedureId) || 1, highestId + 1);
        syncCaseInputsFromState();
        renderItinerary();
        refreshApplication({ hardwareChanged: true, markPrediction: true });
      } finally {
        caseHistory.restoring = false;
      }
      if (typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('spine:case-restored'));
    }

    function stepCaseHistory(direction) {
      checkpointCaseHistory();
      const from = direction === 'undo' ? caseHistory.undo : caseHistory.redo;
      const to = direction === 'undo' ? caseHistory.redo : caseHistory.undo;
      if (!from.length) {
        announce(direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
        return false;
      }
      const target = from.pop();
      to.push(caseHistory.current);
      applyCaseSnapshot(target);
      caseHistory.current = captureCaseSnapshot();
      caseHistory.currentKey = JSON.stringify(caseHistory.current);
      caseHistory.lastCheckpointPushed = false;
      syncCaseHistoryControls();
      const remaining = direction === 'undo' ? caseHistory.undo.length : caseHistory.redo.length;
      showToast(direction === 'undo' ? 'Case edit undone' : 'Case edit redone');
      announce(`${direction === 'undo' ? 'Undo' : 'Redo'}: case restored. ${remaining} more step${remaining === 1 ? '' : 's'} available. Local imaging is not part of the undo history.`);
      return true;
    }
    const undoCaseEdit = () => stepCaseHistory('undo');
    const redoCaseEdit = () => stepCaseHistory('redo');

    // The guided demo keeps the user's case aside while it runs and puts it
    // back on exit, with its saved/unsaved baseline. Imaging is not included.
    function captureCaseSession() {
      checkpointCaseHistory();
      return { snapshot: captureCaseSnapshot(), baselineKey: caseHistory.baselineKey };
    }
    function restoreCaseSession(saved) {
      if (!saved || !isPlainObjectSnapshot(saved.snapshot)) return false;
      checkpointCaseHistory();
      cancelProcedureEdit({ silent: true });
      applyCaseSnapshot(saved.snapshot);
      setView('pre', false);
      if (sceneReady) {
        applyModelTargets(true);
        resetCameraView({ announceChange: false });
      }
      checkpointCaseHistory();
      caseHistory.baselineKey = saved.baselineKey;
      showToast('Your case was restored');
      announce('Guided demo closed. Your case inputs and procedures were restored. Local imaging is not part of a restored case.');
      return true;
    }
    const isPlainObjectSnapshot = value => Boolean(value) && typeof value === 'object'
      && Boolean(value.params) && Array.isArray(value.itinerary) && Boolean(value.levelFactors);

    /* Replacing a case (Reset, Load example, Open case file) asks first when
       there is something to lose. Undo can bring the case back; it cannot bring
       back released imaging, and the message says so. */
    function imagingLossSentence(summary) {
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const items = [];
      if (summary.films) items.push(plural(summary.films, summary.filmsStaged ? 'staged film' : 'selected film'));
      if (summary.ctFiles) items.push(plural(summary.ctFiles, 'CT file'));
      if (summary.landmarks) items.push(plural(summary.landmarks, 'placed landmark'));
      if (!items.length) return 'Local imaging references will also be released, and Undo cannot restore them.';
      const list = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0];
      return `Local imaging will also be released: ${list}. Undo cannot restore imaging; stage the films again afterwards if you still need them.`;
    }

    function confirmCaseReplacement(actionLabel, options = {}) {
      const summary = caseDirtySummary();
      const dialog = $('confirmCaseDialog');
      if (!summary.dirty || !dialog || typeof dialog.showModal !== 'function' || dialog.open) return Promise.resolve(true);
      const parts = [];
      if (summary.procedures) parts.push(`${summary.procedures} procedure${summary.procedures === 1 ? '' : 's'}`);
      if (summary.edited) parts.push(summary.procedures ? 'the edited inputs' : 'your edited case inputs');
      const lost = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
      $('confirmCaseHeading').textContent = `${actionLabel}?`;
      // The guided demo swaps the case only while it runs and puts it back on
      // exit; released imaging is still not restorable.
      const caseSentence = options.restoresCase
        ? 'The demo replaces the current case while it runs; Exit demo restores your case inputs and procedures.'
        : lost ? `This replaces the current case; ${lost} will be cleared.` : 'This replaces the current case.';
      $('confirmCaseMessage').textContent = [
        caseSentence,
        summary.imaging ? imagingLossSentence(summary) : ''
      ].filter(Boolean).join(' ');
      $('confirmCaseAccept').textContent = actionLabel;
      return new Promise(resolve => {
        const onClose = () => {
          dialog.removeEventListener('close', onClose);
          resolve(dialog.returnValue === 'confirm');
        };
        dialog.returnValue = '';
        dialog.addEventListener('close', onClose);
        dialog.showModal();
        $('confirmCaseCancel')?.focus();
      });
    }

    /* ---- Case files ---- */
    const isPlainRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    // Table lookups driven by file values accept own keys only, so names such as
    // "__proto__", "constructor" or "toString" never resolve to Object.prototype.
    const ownEntry = (table, key) => (typeof key === 'string' && table
      && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);
    const CASE_FILE_RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const constructVariantForComponents = components => {
      const roles = new Set((components || []).map(component => component.role));
      if (roles.has('fusion_cage') && roles.has('screw_set') && roles.has('rod_set')) return 'interbody_plus_posterior_fixation';
      if (roles.has('fusion_cage')) return 'interbody_only';
      if (roles.has('arthroplasty')) return 'motion_preserving_interbody';
      if (roles.has('posterior_motion_device') && roles.has('screw_set')) return 'posterior_motion_device_with_pedicle_screws';
      if (roles.has('screw_set') && roles.has('rod_set')) return 'posterior_screw_rod';
      if (roles.has('screw_set')) return 'standalone_screw_fixation';
      return 'no_verified_implant_geometry';
    };

    function buildCaseFileObject() {
      checkpointCaseHistory();
      return {
        schema: CASE_FILE_SCHEMA,
        schemaVersion: CASE_FILE_SCHEMA_VERSION,
        app: {
          name: 'DeformitySim',
          release: 'alpha',
          modelVersion: MODEL_MANIFEST.modelVersion,
          buildId: MODEL_MANIFEST.buildId
        },
        savedAt: new Date().toISOString(),
        notice: 'Research and education scenario, not a surgical plan or a prediction of achieved correction. Holds case parameters, procedures, implant selections and assumptions only: no imaging pixels, file names or patient identifiers.',
        case: captureCaseSnapshot()
      };
    }

    function caseFileName() {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
      return `spine-case-${stamp}.json`;
    }

    function saveCaseFile() {
      const text = JSON.stringify(buildCaseFileObject(), null, 2);
      try {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = caseFileName();
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (_) {
        showToast('Case file could not be saved');
        announce('The browser blocked the case-file download.');
        return null;
      }
      showToast('Case file saved');
      announce('Case file saved to your device. It holds parameters, procedures, implant selections and assumptions only; no imaging or file names.');
      return text;
    }

    // Catalog selections are re-verified against this build's catalogs and
    // rebuilt from them, so a file cannot inject labels, links or dimensions.
    function rebuildLoadedCatalogPlan(plan, procedureId, levelId) {
      const base = implantProfileFor(procedureId, levelId);
      const saved = (Array.isArray(plan.components) ? plan.components : []).filter(isPlainRecord);
      const rebuilt = [];
      let interbodyOnly = false;
      if (base.motionCatalogId) {
        const catalog = IMPLANT_CATALOGS.motionDevices[base.motionCatalogId];
        const component = saved.find(candidate => candidate.catalogId === catalog?.id);
        const dims = isPlainRecord(component?.dimensionsMm) ? component.dimensionsMm : {};
        const ipd = catalog?.ipdConfigurations.find(value => value.ipdMm === dims.interpedicularDistance && value.armAngleDeg === dims.armAngleDeg);
        const plate = catalog?.plateLengthConfigurations.find(value => value.id === dims.plateLengthClass);
        if (!catalog || !ipd || !plate) return null;
        rebuilt.push({
          role: catalog.kind, catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
          geometryTemplate: 'tops_external_component_topology', dimensionSource: 'fda_ssed_rounded_reference_dimensions',
          sourceUrl: catalog.sourceUrl,
          dimensionsMm: {
            interpedicularDistance: ipd.ipdMm, armAngleDeg: ipd.armAngleDeg,
            plateLengthClass: plate.id, topPlateLength: plate.topPlateLengthMm, bottomPlateLength: plate.bottomPlateLengthMm
          },
          materials: catalog.materials,
          labeledDesignMotionLimitsDeg: catalog.labeledDesignMotionLimitsDeg,
          sagittalTranslationDesign: catalog.sagittalTranslationDesign,
          provenance: { kind: 'fda_pma_ssed', listedConfiguration: true, dimensionsRoundedReferenceOnly: true, internalMechanismGeometryVerified: false }
        });
      }
      if (base.cageCatalogIds?.length) {
        const component = saved.find(candidate => base.cageCatalogIds.includes(candidate.catalogId));
        const catalog = component ? IMPLANT_CATALOGS.cages[component.catalogId] : null;
        const dims = isPlainRecord(component?.dimensionsMm) ? component.dimensionsMm : {};
        if (!catalog || !catalog.footprints.some(value => value.ap === dims.ap && value.ml === dims.ml)
            || !catalog.heights.includes(dims.height) || !catalog.lordosis.includes(component.lordosisDeg)) return null;
        const derived = deriveCatalogCageHeights(dims.ap, dims.height, component.lordosisDeg);
        rebuilt.push({
          role: catalog.kind, catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
          geometryTemplate: catalog.kind === 'arthroplasty' ? 'arthroplasty_envelope' : 'lordotic_interbody_envelope',
          dimensionSource: 'manufacturer_catalog', sourceUrl: catalog.sourceUrl,
          dimensionsMm: { ap: dims.ap, ml: dims.ml, height: dims.height, maximumHeight: dims.height, anteriorHeight: derived.anteriorHeight, posteriorHeight: derived.posteriorHeight },
          heightConvention: 'catalog_maximum_height', lordosisDeg: component.lordosisDeg,
          provenance: { kind: 'manufacturer_catalog', listedDimensionValues: true, combinationOrderabilityVerified: false }
        });
      }
      if (base.screwCatalogId) {
        const catalog = IMPLANT_CATALOGS.screws[base.screwCatalogId];
        const screw = saved.find(candidate => candidate.role === 'screw_set');
        interbodyOnly = !screw && OPTIONAL_POSTERIOR_FIXATION_PROCEDURES.has(procedureId) && plan.constructVariant === 'interbody_only';
        if (!interbodyOnly) {
          const dims = isPlainRecord(screw?.dimensionsMm) ? screw.dimensionsMm : {};
          if (!catalog || screw?.catalogId !== catalog.id || !ownEntry(catalog.diameterLengths, String(dims.outerDiameter))?.includes(dims.length)) return null;
          rebuilt.push({
            role: 'screw_set', catalogId: catalog.id, catalogLabel: catalog.label, catalogRevision: catalog.revision,
            geometryTemplate: 'catalog_shaft_generic_head_envelope', dimensionSource: 'manufacturer_catalog',
            sourceUrl: catalog.sourceUrl, dimensionsMm: { outerDiameter: dims.outerDiameter, length: dims.length },
            provenance: { kind: 'manufacturer_catalog', listedDiameterLengthCombination: true, headGeometryVerified: false }
          });
          if (catalog.rodDiameters?.length && catalog.rodLengths?.length) {
            const rod = saved.find(candidate => candidate.role === 'rod_set');
            const rodDims = isPlainRecord(rod?.dimensionsMm) ? rod.dimensionsMm : {};
            if (!catalog.rodDiameters.includes(rodDims.diameter) || !catalog.rodLengths.includes(rodDims.length)) return null;
            rebuilt.push({
              role: 'rod_set', catalogId: catalog.id, catalogLabel: catalog.label, geometryTemplate: 'straight_rod_envelope',
              dimensionSource: 'manufacturer_catalog', sourceUrl: catalog.sourceUrl,
              dimensionsMm: { diameter: rodDims.diameter, length: rodDims.length },
              provenance: { kind: 'manufacturer_catalog', listedDimensionValues: true, contouringVerified: false }
            });
          }
        }
      }
      let graft = null;
      if (base.graft) {
        const catalog = ownEntry(IMPLANT_CATALOGS.grafts, plan.graft?.catalogId);
        if (!catalog || !catalog.volumesCc.includes(plan.graft.packageVolumeCc)) return null;
        graft = {
          catalogId: catalog.id, catalogLabel: catalog.label, sourceUrl: catalog.sourceUrl, packageVolumeCc: plan.graft.packageVolumeCc,
          placedVolumeInferred: false, provenance: { kind: 'manufacturer_catalog', listedPackageQuantity: true }
        };
      }
      const note = interbodyOnly
        ? [base.note, 'Interbody-only construct authored; supplemental posterior fixation is not included.'].filter(Boolean).join(' ')
        : base.note || null;
      return deepFreezeSnapshot({
        schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'catalog', catalogRevision: IMPLANT_CATALOG_REVISION,
        sizingSource: plan.sizingSource === 'comparison_default_listed_dimensions' ? 'comparison_default_listed_dimensions' : 'explicit_user_selected_catalog_dimensions',
        automaticSizing: false, catalogMatch: 'listed_dimension_values_only', clinicalSuitability: 'not_assessed',
        fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed', renderStatus: 'catalog_dimensions_available',
        constructVariant: constructVariantForComponents(rebuilt), note, components: rebuilt, graft
      });
    }

    // User-entered dimensions go back through the same bounds as the form.
    function rebuildLoadedCustomPlan(plan, procedureId, levelId) {
      const base = implantProfileFor(procedureId, levelId);
      const saved = (Array.isArray(plan.components) ? plan.components : []).filter(isPlainRecord);
      const cage = saved.find(candidate => ['fusion_cage', 'arthroplasty'].includes(candidate.role));
      const screw = saved.find(candidate => candidate.role === 'screw_set');
      const rod = saved.find(candidate => candidate.role === 'rod_set');
      const profile = !screw && OPTIONAL_POSTERIOR_FIXATION_PROCEDURES.has(procedureId) && plan.constructVariant === 'interbody_only'
        ? { ...base, screwCatalogId: null }
        : base;
      const custom = normalizeCustomImplantSelection(profile, {
        label: saved.find(candidate => typeof candidate.catalogLabel === 'string')?.catalogLabel,
        cage: cage ? { ap: cage.dimensionsMm?.ap, ml: cage.dimensionsMm?.ml, anteriorHeight: cage.dimensionsMm?.anteriorHeight, posteriorHeight: cage.dimensionsMm?.posteriorHeight } : null,
        screw: screw ? { outerDiameter: screw.dimensionsMm?.outerDiameter, length: screw.dimensionsMm?.length } : null,
        rod: rod ? { diameter: rod.dimensionsMm?.diameter, length: rod.dimensionsMm?.length } : null,
        graft: isPlainRecord(plan.graft) ? { label: plan.graft.catalogLabel, quantityCc: plan.graft.declaredQuantityCc ?? plan.graft.packageVolumeCc } : null
      });
      return deepFreezeSnapshot({
        schemaVersion: IMPLANT_PLAN_SCHEMA_VERSION, dimensionMode: 'custom', catalogRevision: null,
        sizingSource: 'user_entered_dimensions', automaticSizing: false, catalogMatch: false,
        clinicalSuitability: 'not_assessed', fitAssessment: 'not_performed', trajectoryAssessment: 'not_performed',
        renderStatus: 'custom_dimensions_available', constructVariant: constructVariantForComponents(custom.components),
        note: profile.note || 'User-entered dimensional envelope; catalog availability and clinical suitability are not established.',
        components: custom.components, graft: custom.graft
      });
    }

    function sanitizeLoadedImplantPlan(plan, procedureId, levelId, where, warnings) {
      let rebuilt = null;
      try {
        if (isPlainRecord(plan) && plan.schemaVersion === IMPLANT_PLAN_SCHEMA_VERSION) {
          if (plan.dimensionMode === 'catalog') rebuilt = rebuildLoadedCatalogPlan(plan, procedureId, levelId);
          else if (plan.dimensionMode === 'custom') rebuilt = rebuildLoadedCustomPlan(plan, procedureId, levelId);
          else rebuilt = buildDefaultSuggestedImplantPlan(procedureId, levelId);
        }
      } catch (_) {
        rebuilt = null;
      }
      if (rebuilt) return rebuilt;
      warnings.push(`${where}: the saved implant sizes could not be verified against this build's catalogs, so the default listed configuration is shown.`);
      return buildDefaultSuggestedImplantPlan(procedureId, levelId);
    }

    function sanitizeLoadedPrefill(prefill) {
      if (!isPlainRecord(prefill)) return null;
      const text = value => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 160) : null);
      return deepFreezeSnapshot({
        optionId: text(prefill.optionId), optionTitle: text(prefill.optionTitle),
        branchId: text(prefill.branchId), branchLabel: text(prefill.branchLabel), stepLabel: text(prefill.stepLabel),
        autoAddedPrerequisite: prefill.autoAddedPrerequisite === true,
        evidenceIds: (Array.isArray(prefill.evidenceIds) ? prefill.evidenceIds : [])
          .filter(id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(CONSTRUCT_EVIDENCE_SOURCES, id))
      });
    }

    function caseGlobalLimits() {
      const limits = { secondaryFlexibility: [0, 1] };
      const widen = (key, input) => {
        const min = Number(input?.min);
        const max = Number(input?.max);
        if (!input || input.min === '' || input.max === '' || !Number.isFinite(min) || !Number.isFinite(max)) return;
        limits[key] = limits[key] ? [Math.min(limits[key][0], min), Math.max(limits[key][1], max)] : [min, max];
      };
      LAB_GLOBAL_RANGES.forEach(field => widen(field.stateKey, labEls[field.inputKey]));
      THREE_PLANE_CASE_FIELDS.forEach(field => widen(field.stateKey, els[field.elementKey]));
      return limits;
    }

    /* Parses and validates a case file. Everything is checked against the same
       domains the controls enforce, and the itinerary is replayed through the
       add-procedure checks. Returns { ok, errors, warnings, snapshot }. */
    function parseCaseFile(text) {
      const errors = [];
      const warnings = [];
      const fail = message => ({ ok: false, errors: [message], warnings, snapshot: null });
      if (typeof text !== 'string' || !text.trim()) return fail('The file is empty.');
      if (text.length > CASE_FILE_MAX_BYTES) return fail('The file is larger than any case file (512 KB limit).');
      let raw;
      let reservedKey = false;
      try {
        // Defence in depth: reserved property names are dropped while parsing and
        // the file is refused, so nothing can reach Object.prototype.
        raw = JSON.parse(text, (key, value) => {
          if (CASE_FILE_RESERVED_KEYS.has(key)) { reservedKey = true; return undefined; }
          return value;
        });
      } catch (_) { return fail('The file is not valid JSON.'); }
      if (reservedKey) return fail('The file contains reserved property names (__proto__, constructor or prototype), so it was not opened.');
      if (!isPlainRecord(raw) || (raw.schema !== CASE_FILE_SCHEMA && !LEGACY_CASE_FILE_SCHEMAS.includes(raw.schema))) return fail('This is not a DeformitySim case file.');
      if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) return fail('The case-file format version is missing or invalid.');
      if (raw.schemaVersion > CASE_FILE_SCHEMA_VERSION) {
        return fail(`This case file uses format version ${raw.schemaVersion}; this build reads version ${CASE_FILE_SCHEMA_VERSION}. Open it in a newer build.`);
      }
      const source = raw.case;
      if (!isPlainRecord(source)) return fail('The case file has no case section.');
      const savedModel = typeof raw.app?.modelVersion === 'string' ? raw.app.modelVersion.slice(0, 32) : null;
      if (savedModel !== MODEL_MANIFEST.modelVersion) {
        warnings.push(`Saved with model ${savedModel ? `v${savedModel.replace(/[^0-9A-Za-z.+-]/g, '')}` : 'of unknown version'}; modeled outputs are recomputed with v${MODEL_MANIFEST.modelVersion} and can differ from the saved session.`);
      }
      const labels = { pi: 'PI', ll: 'LL', tk: 'TK', cl: 'CL', pt: 'PT', measuredSva: 'Measured SVA' };

      const params = {};
      for (const [key, [min, max]] of Object.entries(CASE_ALIGNMENT_LIMITS)) {
        const value = source.params?.[key];
        if (key === 'measuredSva' && (value === null || value === undefined)) { params.measuredSva = null; continue; }
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) errors.push(`${labels[key]} must be a number from ${min} to ${max}.`);
        else params[key] = value;
      }
      if (Number.isFinite(params.pi) && Number.isFinite(params.pt) && params.pt >= params.pi) {
        warnings.push('PT is at or above PI (sacral slope ≤ 0), so modeled alignment will be withheld until it is corrected.');
      }

      const provenance = {};
      if (isPlainRecord(source.provenance)) {
        Object.entries(source.provenance).forEach(([key, value]) => {
          if (Object.prototype.hasOwnProperty.call(labels, key) && typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value)) provenance[key] = value;
        });
      }
      if (!Number.isFinite(params.measuredSva)) provenance.measuredSva = 'not_provided';
      else if (!provenance.measuredSva || provenance.measuredSva === 'not_provided') provenance.measuredSva = 'user_measured';

      const assumptions = {
        applyReciprocalResponse: source.assumptions?.applyReciprocalResponse,
        applyCoronalCompensation: source.assumptions?.applyCoronalCompensation
      };
      if (typeof assumptions.applyReciprocalResponse !== 'boolean' || typeof assumptions.applyCoronalCompensation !== 'boolean') {
        errors.push('The response assumptions must be true or false.');
      }

      const globalDeformity = createDefaultGlobalDeformity();
      const globalLimits = caseGlobalLimits();
      const savedGlobal = isPlainRecord(source.globalDeformity) ? source.globalDeformity : {};
      Object.keys(globalDeformity).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(savedGlobal, key)) return;
        const value = savedGlobal[key];
        if (key === 'preset') {
          if (typeof value === 'string' && (value === 'custom' || Object.prototype.hasOwnProperty.call(DEFORMITY_PRESETS, value))) globalDeformity.preset = value;
          else globalDeformity.preset = 'custom';
        } else if (key === 'coronalProfileId') {
          globalDeformity.coronalProfileId = typeof value === 'string' && typeof CORONAL_DISPLAY_PROFILES !== 'undefined'
            && Object.prototype.hasOwnProperty.call(CORONAL_DISPLAY_PROFILES, value) ? value : null;
        } else if (key === 'coronalDirection') {
          if (value === 'left' || value === 'right') globalDeformity.coronalDirection = value;
          else errors.push('The coronal curve direction must be left or right.');
        } else if (key === 'lowerExtremitiesVisible') {
          globalDeformity.lowerExtremitiesVisible = value !== false;
        } else if (typeof globalDeformity[key] === 'number') {
          const limits = globalLimits[key];
          if (typeof value !== 'number' || !Number.isFinite(value) || (limits && (value < limits[0] || value > limits[1]))) {
            errors.push(`Three-plane input ${key} must be a number${limits ? ` from ${limits[0]} to ${limits[1]}` : ''}.`);
          } else {
            globalDeformity[key] = value;
          }
        }
      });

      const levelFactors = createDefaultLevelFactors();
      const savedLevels = isPlainRecord(source.levelFactors) ? source.levelFactors : {};
      Object.entries(savedLevels).forEach(([levelId, factors]) => {
        if (!ownEntry(levelFactors, levelId) || !isPlainRecord(factors)) { errors.push(`Unknown anatomy level ${String(levelId).slice(0, 12)}.`); return; }
        Object.entries(factors).forEach(([key, value]) => {
          if (key === 'morphologyVariant') {
            if (MORPHOLOGY_VARIANTS.includes(value)) levelFactors[levelId].morphologyVariant = value;
            else errors.push(`${levelId}: unknown morphology variant.`);
            return;
          }
          const limits = ownEntry(CASE_LEVEL_LIMITS, key);
          if (!Array.isArray(limits)) { errors.push(`${levelId}: unknown anatomy field ${String(key).slice(0, 24)}.`); return; }
          if (typeof value !== 'number' || !Number.isFinite(value) || value < limits[0] || value > limits[1]) {
            errors.push(`${levelId} ${key} must be a number from ${limits[0]} to ${limits[1]}.`);
            return;
          }
          levelFactors[levelId][key] = value;
        });
      });

      const allowedSources = new Set(['user_planned', 'evidence_comparison_prefill', 'procedure_default_assumption', 'not_applicable']);
      const savedItinerary = source.itinerary === undefined ? [] : source.itinerary;
      const itinerary = [];
      if (!Array.isArray(savedItinerary)) errors.push('The procedure list must be a list.');
      else if (savedItinerary.length > 80) errors.push('The procedure list is longer than any supported scenario (80 items).');
      else {
        const usedIds = new Set();
        savedItinerary.forEach((item, index) => {
          const where = `Procedure ${index + 1}`;
          if (!isPlainRecord(item)) { errors.push(`${where} is not a procedure record.`); return; }
          const level = LEVEL_BY_ID.get(item.levelId);
          const procedure = ownEntry(PROCEDURES, item.procedureId);
          if (!level || !procedure || !isProcedureCompatible(procedure, level)) {
            errors.push(`${where}: unknown or incompatible level and procedure.`);
            return;
          }
          const name = `${where} (${procedure.name} at ${displayLevel(level.id)})`;
          const policy = correctionPolicyFor(procedure, level);
          const plannedAngle = policy.enabled ? item.plannedAngle : 0;
          if (typeof plannedAngle !== 'number' || !Number.isFinite(plannedAngle) || plannedAngle < policy.minDeg || plannedAngle > policy.maxDeg) {
            errors.push(`${name}: planned correction must be ${policy.minDeg}° to ${policy.maxDeg}°.`);
            return;
          }
          const planePolicy = procedureThreePlanePolicyFor(item.procedureId, level);
          const plane = (value, axis, label) => {
            const numeric = value === undefined || value === null ? 0 : value;
            if (typeof numeric !== 'number' || !Number.isFinite(numeric) || (!axis.enabled && numeric !== 0) || numeric < axis.min || numeric > axis.max) {
              throw new RangeError(`${name}: ${label} is outside its scenario domain.`);
            }
            return axis.enabled ? numeric : 0;
          };
          let plannedCoronal;
          let plannedAxialRotation;
          let plannedTranslationMm;
          try {
            plannedCoronal = plane(item.plannedCoronal, planePolicy.coronal, 'the coronal change');
            plannedAxialRotation = plane(item.plannedAxialRotation, planePolicy.axial, 'the axial rotation change');
            plannedTranslationMm = plane(item.plannedTranslationMm, planePolicy.translation, 'the translation change');
          } catch (error) {
            errors.push(error.message);
            return;
          }
          const id = Number.isInteger(item.id) && item.id > 0 && item.id < 1e6 && !usedIds.has(item.id) ? item.id : null;
          if (id !== null) usedIds.add(id);
          itinerary.push({
            id,
            levelId: level.id,
            procedureId: item.procedureId,
            plannedAngle,
            plannedAngleSource: !policy.enabled ? 'not_applicable'
              : allowedSources.has(item.plannedAngleSource) && item.plannedAngleSource !== 'not_applicable' ? item.plannedAngleSource : 'user_planned',
            plannedCoronal,
            plannedAxialRotation,
            plannedTranslationMm,
            implantPlan: sanitizeLoadedImplantPlan(item.implantPlan, item.procedureId, level.id, name, warnings),
            comparisonPrefill: sanitizeLoadedPrefill(item.comparisonPrefill),
            ...(item.procedureId === 'laminectomy' && item.autoLinkedFor === 'tops' ? { autoLinkedFor: 'tops' } : {})
          });
        });
        let nextFreeId = Math.max(0, ...usedIds) + 1;
        itinerary.forEach(item => { if (item.id === null) { item.id = nextFreeId; nextFreeId += 1; } });
      }

      if (!errors.length) {
        const checked = [];
        try {
          itinerary.forEach(item => {
            if (checked.some(existing => existing.levelId === item.levelId && existing.procedureId === item.procedureId)) {
              throw new RangeError(`${PROCEDURES[item.procedureId].name} at ${displayLevel(item.levelId)} appears twice.`);
            }
            const conflict = findProcedureConflict(item.procedureId, item.levelId, checked, item.implantPlan);
            if (conflict) throw new RangeError(conflict);
            checked.push(item);
          });
          checked.forEach(item => {
            const requirement = findProcedureRequirement(item.procedureId, item.levelId, checked);
            if (requirement) throw new RangeError(requirement);
          });
        } catch (error) {
          errors.push(`The procedure list does not pass the itinerary checks: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!errors.length) {
        const evaluate = list => {
          calculateBiomechanics(params, list, assumptions);
          computeThreePlaneScenario(globalDeformity, list, assumptions);
        };
        try {
          evaluate(itinerary);
        } catch (error) {
          let baseFails = false;
          try { evaluate([]); } catch (_) { baseFails = true; }
          if (baseFails) warnings.push('The saved inputs are outside the engineering domain, so modeled alignment will be withheld.');
          else errors.push(`The procedure list cannot be evaluated: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const exampleId = isPlainRecord(ownEntry(CASE_EXAMPLES, source.caseContext?.exampleId))
        ? source.caseContext.exampleId
        : null;
      const example = exampleId ? ownEntry(CASE_EXAMPLES, exampleId) : null;
      const caseContext = example
        ? {
            exampleId,
            label: example.label,
            featureTags: example.featureTags.map(tag => ({ ...tag })),
            reportedContext: { ...example.reportedContext },
            limitations: [...example.limitations]
          }
        : { exampleId: null, label: null, featureTags: [], reportedContext: {}, limitations: [] };
      const age = source.demographics?.ageYears;
      const demographics = { ageYears: Number.isInteger(age) && age >= 18 && age <= 100 ? age : null };
      if (age !== null && age !== undefined && demographics.ageYears === null) warnings.push('The saved age was outside 18 to 100 years and was not loaded.');
      const highestId = itinerary.reduce((maximum, item) => Math.max(maximum, item.id), 0);
      const savedNext = Number.isInteger(source.nextProcedureId) && source.nextProcedureId > 0 && source.nextProcedureId < 1e6 ? source.nextProcedureId : 1;

      if (errors.length) return { ok: false, errors: errors.slice(0, 8), warnings, snapshot: null };
      return {
        ok: true,
        errors: [],
        warnings,
        snapshot: {
          params, provenance, assumptions, globalDeformity, levelFactors, itinerary,
          nextProcedureId: Math.max(savedNext, highestId + 1), caseContext, demographics
        }
      };
    }

    // Every parse failure, including an unexpected exception, becomes a reported
    // refusal instead of a silently rejected promise.
    function safeParseCaseFile(text) {
      try {
        return parseCaseFile(text);
      } catch (_) {
        return { ok: false, errors: ['The file could not be read as a case file.'], warnings: [], snapshot: null };
      }
    }

    // Applies a validated case file. Imaging does not travel with a case, so a
    // loaded case starts without any, exactly like a loaded example.
    function applyLoadedCase(snapshot) {
      checkpointCaseHistory();
      const hadImaging = Boolean(state.patientImaging.status !== 'none'
        || patientImagingSession.frontal || patientImagingSession.lateral || patientImagingSession.ctFiles.length);
      if (hadImaging) clearPatientImagingSession();
      applyCaseSnapshot(snapshot);
      setView('pre', false);
      if (sceneReady) {
        applyModelTargets(true);
        resetCameraView({ announceChange: false });
      }
      checkpointCaseHistory();
      markCaseBaseline();
      return hadImaging;
    }

    // Reads a File (picker or drop) and loads it. Resolves to the parse result.
    async function openCaseFile(file) {
      if (!file) return null;
      if (file.size > CASE_FILE_MAX_BYTES) {
        const result = { ok: false, errors: ['The file is larger than any case file (512 KB limit).'], warnings: [] };
        reportCaseFileResult(result);
        return result;
      }
      let text;
      try {
        text = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        });
      } catch (_) {
        const result = { ok: false, errors: ['The file could not be read.'], warnings: [] };
        reportCaseFileResult(result);
        return result;
      }
      const result = safeParseCaseFile(text);
      if (!result.ok) {
        reportCaseFileResult(result);
        return result;
      }
      if (!(await confirmCaseReplacement('Open case file'))) {
        announce('Case file not opened. The current case is unchanged.');
        return { ...result, cancelled: true };
      }
      result.clearedImaging = applyLoadedCase(result.snapshot);
      reportCaseFileResult(result);
      return result;
    }

    function reportCaseFileResult(result) {
      if (!result.ok) {
        showToast('Case file not opened');
        announce(`Case file not opened: ${result.errors.join(' ')}`);
        const status = $('caseFileStatus');
        if (status) { status.hidden = false; status.dataset.state = 'error'; status.textContent = `Not opened: ${result.errors.join(' ')}`; }
        return;
      }
      const notes = [...result.warnings, result.clearedImaging ? 'Local imaging references were released; imaging is never stored in a case file.' : ''].filter(Boolean);
      showToast('Case file opened', caseHistoryUndoAction());
      announce(`Case file opened with ${state.itinerary.length} procedure${state.itinerary.length === 1 ? '' : 's'}. ${notes.join(' ')}`.trim());
      const status = $('caseFileStatus');
      if (status) {
        status.hidden = notes.length === 0;
        status.dataset.state = 'warning';
        status.textContent = notes.join(' ');
      }
    }

    /* ---- Plain-text case summary (for notes, abstracts and slides) ---- */
    function buildCaseSummaryText() {
      const p = state.prediction;
      const withheld = !p || p.applicabilityStatus !== 'within_engineering_domain';
      const g = state.globalDeformity || {};
      const deg = value => (Number.isFinite(value) ? `${Math.round(value * 10) / 10}°` : '—');
      const sdeg = value => (Number.isFinite(value) ? signedDegree(value) : '—');
      const lines = [
        `DeformitySim · case summary · model v${MODEL_MANIFEST.modelVersion} (${MODEL_MANIFEST.buildId}, alpha)`,
        'Research and education scenario. Not a surgical plan, not patient-specific, and not a prediction of achieved correction.',
        '',
        `Case: ${state.caseContext?.label ? `${state.caseContext.label} (example${caseDirtySummary().edited ? ', edited' : ''})` : 'custom case'}`,
        `Sagittal inputs: PI ${deg(state.params.pi)} · LL ${deg(state.params.ll)} · TK (T4–T12) ${deg(state.params.tk)} · CL ${deg(state.params.cl)} · PT ${deg(state.params.pt)} · PI–LL ${sdeg(state.params.pi - state.params.ll)}`,
        `Measured SVA: ${Number.isFinite(state.params.measuredSva) ? `${signedNumber(state.params.measuredSva, 1)} cm` : 'not entered'}`,
        `Coronal / axial inputs: primary Cobb ${deg(Math.abs(Number(g.coronalMagnitude) || 0))} apex ${g.coronalDirection === 'left' ? 'left' : 'right'} · secondary Cobb ${deg(Math.abs(Number(g.compensatoryCobb) || 0))} · apical translation ${signedNumber(Number(g.trunkShift) || 0, 0)} mm · apical rotation ${sdeg(Number(g.axialRotation) || 0)}`,
        `Assumptions: reciprocal thoracic kyphosis response ${state.assumptions.applyReciprocalResponse ? 'on' : 'off'} (the pelvic balance response is always applied) · secondary-curve response ${state.assumptions.applyCoronalCompensation ? 'on' : 'off'}`
      ];
      if (Number.isFinite(state.demographics?.ageYears)) lines.push(`Age (display-only reference, no model effect): ${state.demographics.ageYears} years`);
      lines.push('', `Procedures (${state.itinerary.length}):`);
      if (!state.itinerary.length) lines.push('  none');
      state.itinerary.forEach((item, index) => {
        const procedure = PROCEDURES[item.procedureId];
        const angle = Number(item.plannedAngle) || 0;
        const planes = [
          Number(item.plannedCoronal) ? `coronal ${signedDegree(Number(item.plannedCoronal))}` : '',
          Number(item.plannedAxialRotation) ? `axial ${signedDegree(Number(item.plannedAxialRotation))}` : '',
          Number(item.plannedTranslationMm) ? `translation ${signedNumber(Number(item.plannedTranslationMm), 0)} mm` : ''
        ].filter(Boolean);
        lines.push(`  ${String(index + 1).padStart(2, '0')}. ${displayLevel(item.levelId)} ${procedure?.name || item.procedureId} · ${angle ? `scenario ${signedDegree(angle)}` : 'no angular change'}${planes.length ? ` · ${planes.join(' · ')}` : ''} · ${implantPlanSummary(item.implantPlan)}`);
      });
      lines.push('');
      if (withheld) {
        lines.push(`Modeled alignment: withheld${p?.reason ? ` (${p.reason})` : ''}.`);
      } else {
        lines.push('Modeled alignment (pre → modeled post):');
        [['LL', state.params.ll, p.newLL], ['TK (T4–T12)', state.params.tk, p.newTK], ['CL', state.params.cl, p.newCL], ['PT', state.params.pt, p.newPT]]
          .forEach(([label, before, after]) => lines.push(`  ${label}: ${deg(before)} → ${deg(after)} (Δ ${sdeg(after - before)})`));
        lines.push(`  PI–LL: ${sdeg(state.params.pi - state.params.ll)} → ${sdeg(state.params.pi - p.newLL)}`);
        const scenario = state.threePlanePrediction;
        if (scenario && (scenario.baseline.primaryCobb || scenario.outputs.primaryCobb)) {
          lines.push(`  Primary Cobb: ${deg(scenario.baseline.primaryCobb)} → ${deg(scenario.outputs.primaryCobb)} · secondary Cobb: ${deg(scenario.baseline.secondaryCobb)} → ${deg(scenario.outputs.secondaryCobb)}`);
        }
      }
      lines.push('', 'Modeled values are scenario outputs of a reference model, not measurements. No imaging is included.');
      return lines.join('\n');
    }

    async function copyCaseSummary() {
      const text = buildCaseSummaryText();
      const dialog = $('caseSummaryDialog');
      const area = $('caseSummaryText');
      const status = $('caseSummaryStatus');
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch (_) {
        copied = false;
      }
      // The dialog always opens: it is the fallback when the clipboard is
      // unavailable (file:// in some browsers) and lets the text be checked.
      if (area) area.value = text;
      if (status) status.textContent = copied ? 'Copied to the clipboard. The text is also shown below.' : 'Select the text below and copy it (Ctrl+C).';
      if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
      if (!copied && area) { area.focus(); area.select(); }
      announce(copied ? 'Case summary copied to the clipboard.' : 'Case summary shown; select and copy it.');
      return { text, copied };
    }

    /* ---- Measured SVA plausibility (F091/F099) ---- */
    function syncMeasuredSvaHint() {
      const hint = $('measuredSvaHint');
      if (!hint) return;
      const raw = els.measuredSvaInput.value.trim();
      const value = Number(raw);
      let message = '';
      if (raw !== '' && Number.isFinite(value) && Math.abs(value) > 20 && Math.abs(value) <= 300) {
        message = `${signedNumber(value, 1)} cm is a very large SVA. If you measured ${Math.abs(value)} mm, enter ${signedNumber(value / 10, 1)} cm.`;
      }
      hint.hidden = !message;
      hint.textContent = message;
    }

    /* ---- Optional age: display-only reference (F081) ----
       Lafage R, Schwab F, Challier V, et al. Defining spino-pelvic alignment
       thresholds: should operative goals in adult spinal deformity surgery
       account for age? Spine 2016;41(1):62–68 (PMID 26689395). The ideal
       (HRQOL-derived) PT, PI–LL and SVA values rise with age across six groups
       (<35, 35–44, 45–54, 55–64, 65–74, >75 years). Only the youngest- and
       oldest-group values are embedded, as restated in later reviews; for the
       middle groups the page shows that the group value lies between them and
       points to the source table rather than interpolating a number the paper
       did not report. Age changes no model output, modifier or suggestion. */
    const AGE_REFERENCE = Object.freeze({
      citation: 'Lafage R et al., Spine 2016;41(1):62–68 (PMID 26689395)',
      groups: Object.freeze(['under 35', '35–44', '45–54', '55–64', '65–74', '75 and over']),
      youngest: Object.freeze({ pt: 10.9, piLl: -10.5, svaMm: 4.1 }),
      oldest: Object.freeze({ pt: 28.5, piLl: 16.7, svaMm: 78.1 })
    });

    function ageReferenceGroupIndex(age) {
      return age < 35 ? 0 : age < 45 ? 1 : age < 55 ? 2 : age < 65 ? 3 : age < 75 ? 4 : 5;
    }

    function renderAgeReference() {
      const host = $('ageReference');
      if (!host) return;
      const age = state.demographics?.ageYears;
      if (!Number.isFinite(age)) {
        if (host.childNodes.length) host.replaceChildren();
        host.hidden = true;
        return;
      }
      const group = ageReferenceGroupIndex(age);
      const { youngest, oldest } = AGE_REFERENCE;
      const exact = group === 0 ? youngest : group === 5 ? oldest : null;
      const sva = state.params.measuredSva;
      const rows = [
        ['PT', `${Math.round(state.params.pt * 10) / 10}°`, exact ? `${exact.pt}°` : `${youngest.pt}°–${oldest.pt}°`],
        ['PI–LL', signedDegree(state.params.pi - state.params.ll), exact ? signedDegree(exact.piLl) : `${signedDegree(youngest.piLl)} to ${signedDegree(oldest.piLl)}`],
        ['SVA', Number.isFinite(sva) ? `${signedNumber(sva * 10, 0)} mm` : 'not entered', exact ? `${exact.svaMm} mm` : `${youngest.svaMm}–${oldest.svaMm} mm`]
      ];
      const heading = document.createElement('p');
      heading.className = 'age-reference-head';
      heading.textContent = `Age group ${AGE_REFERENCE.groups[group]} · ${exact ? 'published ideal value' : 'group value lies within the published range'}`;
      const table = document.createElement('dl');
      table.className = 'age-reference-rows';
      rows.forEach(([label, caseValue, reference]) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = `case ${caseValue} · reference ${reference}`;
        table.append(term, detail);
      });
      const note = document.createElement('p');
      note.className = 'age-reference-note';
      note.textContent = exact
        ? `${AGE_REFERENCE.citation}. Reference only; not a target for this case.`
        : `Ideal values rise with age from the under-35 to the 75-and-over group; see the table in ${AGE_REFERENCE.citation} for this group's value. Reference only; not a target for this case.`;
      host.replaceChildren(heading, table, note);
      host.hidden = false;
    }

