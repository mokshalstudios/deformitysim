    /* ---------------------------------------------------------------------
       2) DETERMINISTIC BIOMECHANICAL ENGINE
       Planned corrections change regional angles directly, credited per
       spanned disc (correctionSharesFor). The unvalidated reciprocal thoracic
       kyphosis rule is explicit opt-in; the pelvic balance (PT) response is
       always applied. Both read their coefficients from the versioned manifest.
    --------------------------------------------------------------------- */
    function assertEngineeringDomain(values, domains, domainLabel) {
      Object.entries(values).forEach(([key, value]) => {
        const domain = domains[key];
        if (!domain) throw new Error(`No engineering domain is declared for ${key}.`);
        if (value < domain.min || value > domain.max) {
          throw new RangeError(`${key.toUpperCase()} ${value}° is outside the ${domainLabel} engineering domain (${domain.min}° to ${domain.max}°).`);
        }
      });
    }

    function calculateBiomechanics(params, itinerary = [], options = {}) {
      if (!params || typeof params !== 'object') throw new TypeError('Sagittal parameters must be supplied as an object.');
      const safe = {
        pi: params.pi, ll: params.ll, tk: params.tk,
        cl: params.cl, pt: params.pt
      };
      if (Object.values(safe).some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new TypeError('All sagittal parameters must be actual finite number values.');
      }
      assertEngineeringDomain(safe, MODEL_MANIFEST.engineeringDomains.inputAngles, 'input');
      // PI = PT + SS. The PI and PT inputs have independent domains, so PT can
      // be entered at or above PI, which is a sacral slope of zero or less: an
      // implausible pelvis. Withhold modeled output rather than pose it as valid.
      if (safe.pi - safe.pt <= 0) {
        throw new RangeError(`Implausible pelvic geometry: PT ${safe.pt}° is not below PI ${safe.pi}°, so the derived sacral slope (PI − PT) would be ${safe.pi - safe.pt}°.`);
      }
      if (!Array.isArray(itinerary)) throw new TypeError('Itinerary must be an array.');

      let lumbarGain = 0;
      // Level-weighted PT change owed to the lumbar and T12-L1 shares.
      let pelvicTiltReduction = 0;
      let cervicalGain = 0;
      let thoracicLocalGain = 0;
      // Shares on discs outside every regional Cobb (junctions, T1-T4) are
      // reported here instead of silently disappearing from the numbers.
      const localGains = { occipitocervical: 0, atlantoaxial: 0, cervicothoracic: 0, upperThoracic: 0, thoracolumbar: 0 };
      const correctionSources = { lumbar: new Set(), cervical: new Set(), thoracic: new Set() };
      const segmentStacks = new Map();
      const normalizedItinerary = [];
      const allowedSources = new Set(['user_planned', 'evidence_comparison_prefill', 'procedure_default_assumption', 'not_applicable']);

      for (const [index, item] of itinerary.entries()) {
        if (!item || typeof item !== 'object') throw new TypeError(`Itinerary item ${index + 1} must be an object.`);
        const procedure = PROCEDURES[item.procedureId];
        const level = LEVEL_BY_ID.get(item.levelId);
        if (!procedure) throw new RangeError(`Unknown procedure: ${item.procedureId}.`);
        if (!level) throw new RangeError(`Unknown spinal level: ${item.levelId}.`);
        if (!isProcedureCompatible(procedure, level)) {
          throw new RangeError(`${procedure.name} is not compatible with ${level.id}.`);
        }
        const correctionPolicy = correctionPolicyFor(procedure, level);
        const correctionApplicable = correctionPolicy.enabled;
        const source = item.plannedAngleSource ?? (correctionApplicable ? null : 'not_applicable');
        if (!allowedSources.has(source)) {
          throw new TypeError(`Itinerary item ${index + 1} requires an explicit plannedAngleSource.`);
        }
        if (!correctionApplicable && source !== 'not_applicable') {
          throw new TypeError(`${procedure.name} has no modeled angular correction at ${level.id}; use plannedAngleSource "not_applicable".`);
        }
        if (correctionApplicable && source === 'not_applicable') {
          throw new TypeError(`${procedure.name} requires a correction source.`);
        }
        if (normalizedItinerary.some(existing => existing.levelId === item.levelId && existing.procedureId === item.procedureId)) {
          throw new RangeError(`${procedure.name} at ${level.id} is duplicated.`);
        }
        const conflict = findProcedureConflict(item.procedureId, item.levelId, normalizedItinerary, item.implantPlan || null);
        if (conflict) throw new RangeError(conflict);
        const correction = correctionFor(item, procedure, level);
        if (source === 'procedure_default_assumption' && correction !== correctionPolicy.defaultDeg) {
          throw new RangeError(`${procedure.name} default-assumption correction must equal its declared ${correctionPolicy.defaultDeg}° default.`);
        }
        const correctionShares = correctionSharesFor(level.id, correction);
        if (correctionApplicable) {
          const stack = segmentStacks.get(level.id) || { total: 0, minDeg: Infinity, maxDeg: -Infinity, parts: [] };
          stack.total += correction;
          stack.minDeg = Math.min(stack.minDeg, correctionPolicy.minDeg);
          stack.maxDeg = Math.max(stack.maxDeg, correctionPolicy.maxDeg);
          stack.parts.push(`${procedure.name.split(' (')[0]} ${correction}°`);
          segmentStacks.set(level.id, stack);
        }
        normalizedItinerary.push(Object.freeze({
          id: item.id ?? `item-${index + 1}`,
          levelId: level.id,
          procedureId: item.procedureId,
          plannedAngle: correction,
          plannedAngleSource: source,
          implantPlan: item.implantPlan || null,
          comparisonPrefill: item.comparisonPrefill ? Object.freeze({
            ...item.comparisonPrefill,
            evidenceIds: Object.freeze([...(item.comparisonPrefill.evidenceIds || [])])
          }) : null,
          region: level.region,
          metricRegion: level.metricRegion,
          localOnly: correctionPolicy.localOnly,
          correctionShares
        }));
        correctionShares.forEach(share => {
          if (share.metricRegion) correctionSources[share.metricRegion].add(source);
          if (share.metricRegion === 'lumbar' || share.localGroup === 'thoracolumbar') {
            const coefficient = MODEL_MANIFEST.assumptions.ptReductionPerDegreeByLevel[share.segmentId];
            // Fail closed: a lumbar or junction share with no declared
            // coefficient would silently drop its pelvic response.
            if (!Number.isFinite(coefficient)) throw new Error(`No pelvic-tilt response coefficient is declared for ${share.segmentId}.`);
            pelvicTiltReduction += coefficient * share.degrees;
          }
          if (share.metricRegion === 'lumbar') lumbarGain += share.degrees;
          else if (share.metricRegion === 'cervical') cervicalGain += share.degrees;
          else if (share.metricRegion === 'thoracic') thoracicLocalGain += share.degrees;
          else if (share.localGroup) localGains[share.localGroup] += share.degrees;
        });
      }
      normalizedItinerary.forEach(item => {
        const requirement = findProcedureRequirement(item.procedureId, item.levelId, normalizedItinerary);
        if (requirement) throw new RangeError(requirement);
      });
      // Conflicts stop two interbodies or two osteotomies at one segment, but an
      // interbody plus an osteotomy summed freely (TLIF 15° + SPO 15° = 30° at
      // one disc). A TLIF/PLIF already includes a facetectomy, i.e. a posterior
      // release, so stacked corrections at one target are capped at the largest
      // single-procedure range allowed there.
      segmentStacks.forEach((stack, levelId) => {
        if (stack.parts.length < 2) return;
        if (stack.total > stack.maxDeg || stack.total < stack.minDeg) {
          throw new RangeError(`Stacked corrections at ${displayLevel(levelId)} (${stack.parts.join(' + ')} = ${stack.total}°) exceed the ${stack.total > stack.maxDeg ? `${stack.maxDeg}° largest` : `${stack.minDeg}° lowest`} single-procedure limit there. Stacked procedures at one segment are not additive beyond that limit in this model (a TLIF/PLIF facetectomy is itself a posterior release).`);
        }
      });
      const inputSnapshot = Object.freeze({ ...safe });
      const itinerarySnapshot = Object.freeze([...normalizedItinerary]);

      const assumption = MODEL_MANIFEST.assumptions;
      const applyReciprocalResponse = options.applyReciprocalResponse === true;
      const newLL = safe.ll + lumbarGain;
      const newCL = safe.cl + cervicalGain;
      const newTK = safe.tk + (applyReciprocalResponse ? assumption.reciprocalTkPerLumbarDegree * lumbarGain : 0) - thoracicLocalGain;
      // Pelvic response is kinematic bookkeeping, not the optional thoracic
      // assumption. Compensatory retroversion is the posture a hypolordotic
      // lumbar spine forces; holding that retroversion after modeled lordosis is
      // restored levers the whole trunk backward into a stance no standing person
      // could hold, and holding it after lordosis is lost levers the trunk
      // forward. It therefore follows the net lordosis change in either
      // direction, weighted by level: ~0.5° PT per degree at L4-S1 and ~0.25°
      // at L1-L4 and T12-L1 (Lafage R et al., Global Spine J 2022, PMID
      // 33567927; MODEL_MANIFEST.assumptions.ptReductionPerDegreeByLevel). The
      // T12-L1 junction is outside both the TK and LL Cobb endpoints but levers
      // the trunk like an upper lumbar segment, so its share is included;
      // cervical and thoracic corrections are not.
      const pelvicBalanceGain = lumbarGain + localGains.thoracolumbar;
      const pelvicBalanceApplies = pelvicTiltReduction !== 0;
      // Floor: the lower of the fixed 10° and the PI-relative GAP ideal PT
      // (PI − (0.59·PI + 9); Yilgor C et al., JBJS Am 2017), kept inside the
      // modeled-output domain. A lordosing change can never RAISE PT: the old
      // Math.max(10, …) lifted a low-PI patient standing at PT 6° to 10° after an
      // ALIF and labelled it a balance response.
      const idealPt = safe.pi - (0.59 * safe.pi + 9);
      const ptFloor = Math.min(assumption.minimumModeledPt, Math.max(MODEL_MANIFEST.engineeringDomains.outputAngles.pt.min, idealPt));
      // The direction test uses the level-weighted reduction, so a mixed plan
      // (lordosing distally, kyphosing proximally) is floored only when its net
      // pelvic effect is a reduction.
      const unconstrainedPT = safe.pt - pelvicTiltReduction;
      const ptFloorApplied = pelvicTiltReduction > 0 && unconstrainedPT < ptFloor;
      const newPT = pelvicTiltReduction > 0 ? Math.min(safe.pt, Math.max(ptFloor, unconstrainedPT))
        : pelvicTiltReduction < 0 ? unconstrainedPT
        : safe.pt;
      assertEngineeringDomain({ ll: newLL, cl: newCL, tk: newTK, pt: newPT }, MODEL_MANIFEST.engineeringDomains.outputAngles, 'modeled-output');
      if (safe.pi - newPT <= 0) {
        throw new RangeError(`Implausible modeled pelvic geometry: modeled PT ${newPT}° is not below PI ${safe.pi}°, so the derived sacral slope would be ${safe.pi - newPT}°.`);
      }
      const assumptionSnapshot = Object.freeze({
        id: assumption.reciprocalResponseId,
        enabled: applyReciprocalResponse,
        reciprocalTkPerLumbarDegree: assumption.reciprocalTkPerLumbarDegree,
        ptReductionPerDegreeByLevel: assumption.ptReductionPerDegreeByLevel,
        minimumModeledPt: assumption.minimumModeledPt,
        modeledPtFloor: ptFloor,
        pelvicTiltReduction,
        pelvicBalanceResponseAlwaysApplied: true,
        pelvicBalanceApplied: pelvicBalanceApplies,
        pelvicBalanceGain,
        pelvicBalanceIncludesThoracolumbarJunction: true,
        pelvicBalanceSymmetric: true
      });
      const output = (value, provenance, sourceInputs, equationId) => Object.freeze({
        value,
        unit: 'degrees',
        provenance,
        sourceInputs,
        equationId,
        assumptionSnapshot,
        uncertaintyStatus: 'not_established',
        applicabilityStatus: 'within_engineering_domain',
        modelId: MODEL_MANIFEST.modelId,
        modelVersion: MODEL_MANIFEST.modelVersion,
        buildId: MODEL_MANIFEST.buildId,
        validationStatus: MODEL_MANIFEST.validationStatus
      });
      const tkUsesAssumption = applyReciprocalResponse && lumbarGain !== 0;
      const correctionProvenance = (gain, sources) => gain === 0 ? 'input_passthrough'
        : sources.size > 1 ? 'mixed_correction_sources'
        : sources.has('evidence_comparison_prefill') ? 'evidence_comparison_prefill_derived'
        : sources.has('procedure_default_assumption') ? 'procedure_default_assumption_derived'
        : 'user_planned_derived';
      const llProvenance = correctionProvenance(lumbarGain, correctionSources.lumbar);
      const clProvenance = correctionProvenance(cervicalGain, correctionSources.cervical);
      const thoracicCorrectionProvenance = correctionProvenance(thoracicLocalGain, correctionSources.thoracic);
      const tkProvenance = thoracicLocalGain !== 0 && tkUsesAssumption
        ? 'mixed_correction_and_reciprocal_assumption_derived'
        : thoracicLocalGain !== 0 ? thoracicCorrectionProvenance
        : tkUsesAssumption ? 'assumption_derived' : 'input_passthrough';
      const hasShareIn = (item, metricRegion) => item.correctionShares.some(share => share.metricRegion === metricRegion);
      const itemsForMetricRegion = metricRegion => Object.freeze(itinerarySnapshot.filter(item => hasShareIn(item, metricRegion)));
      const sourceSnapshot = (key, value, corrections, derivation) => Object.freeze({
        baseline: Object.freeze({ key, value }),
        corrections,
        derivation: Object.freeze(derivation)
      });
      const lumbarItems = itemsForMetricRegion('lumbar');
      const cervicalItems = itemsForMetricRegion('cervical');
      const thoracicItems = itemsForMetricRegion('thoracic');
      const tkItems = Object.freeze(itinerarySnapshot.filter(item => hasShareIn(item, 'thoracic') || (tkUsesAssumption && hasShareIn(item, 'lumbar'))));
      const pelvicBalanceItems = Object.freeze(itinerarySnapshot.filter(item =>
        hasShareIn(item, 'lumbar') || item.correctionShares.some(share => share.localGroup === 'thoracolumbar')));
      const outputs = Object.freeze({
        ll: output(newLL, llProvenance, sourceSnapshot('params.ll', safe.ll, lumbarItems, { lumbarGain }), 'll-additive-v1'),
        cl: output(newCL, clProvenance, sourceSnapshot('params.cl', safe.cl, cervicalItems, { cervicalGain }), 'cl-additive-v1'),
        tk: output(newTK, tkProvenance, sourceSnapshot('params.tk', safe.tk, tkItems, { thoracicLocalGain, reciprocalLumbarGain: tkUsesAssumption ? lumbarGain : 0, reciprocalAssumptionId: tkUsesAssumption ? assumption.reciprocalResponseId : null }), 'tk-local-plus-optional-reciprocal-v1'),
        pt: output(newPT, pelvicBalanceApplies ? 'pelvic_balance_response_derived' : 'input_passthrough', sourceSnapshot('params.pt', safe.pt, pelvicBalanceApplies ? pelvicBalanceItems : Object.freeze([]), { pelvicBalanceLumbarGain: pelvicBalanceApplies ? lumbarGain : 0, pelvicBalanceThoracolumbarGain: pelvicBalanceApplies ? localGains.thoracolumbar : 0, ptReductionPerDegreeByLevel: assumption.ptReductionPerDegreeByLevel, pelvicTiltReduction, modeledPtFloor: ptFloor }), 'pt-pelvic-balance-level-weighted-floor-v3')
      });
      const enabledOutputs = new Set(MODEL_MANIFEST.mechanics.enabledOutputs);
      const unauthorizedOutputs = Object.keys(outputs).filter(key => !enabledOutputs.has(key));
      if (unauthorizedOutputs.length) throw new Error(`Output policy violation: ${unauthorizedOutputs.join(', ')} is not enabled.`);

      return Object.freeze({
        newLL, newCL, newTK, newPT,
        lumbarGain, cervicalGain, thoracicLocalGain,
        localGains: Object.freeze({ ...localGains }),
        pelvicBalanceGain,
        inputSnapshot,
        itinerarySnapshot,
        outputs,
        constraintsApplied: Object.freeze(ptFloorApplied ? ['minimumModeledPt'] : []),
        assumptions: assumptionSnapshot,
        applicabilityStatus: 'within_engineering_domain',
        modelId: MODEL_MANIFEST.modelId,
        modelVersion: MODEL_MANIFEST.modelVersion,
        buildId: MODEL_MANIFEST.buildId,
        validationStatus: MODEL_MANIFEST.validationStatus
      });
    }

    function classifyModifiers({ mismatch, measuredSva, pt }) {
      // Published SRS–Schwab sagittal modifiers are separate 0 / + / ++
      // reference bands, not an aggregate diagnosis. Negative values are not
      // converted to positive pathology with Math.abs().
      const band = (value, moderateStart, severeStart) => !Number.isFinite(value)
        ? '—'
        : value < moderateStart ? '0' : value <= severeStart ? '+' : '++';
      return Object.freeze({
        mismatch: band(mismatch, 10, 20),
        sva: band(measuredSva, 4, 9.5),
        pt: band(pt, 20, 30)
      });
    }

    function classifyCervicalModifiers({ cervicalSva, cbva, t1Slope, cervicalLordosis }) {
      // Ames-style radiographic modifiers are displayed independently as
      // reference bands. They do not establish a diagnosis, correction target,
      // or patient-specific normal range.
      const unavailable = '—';
      const cSvaGrade = !Number.isFinite(cervicalSva) ? unavailable
        : cervicalSva < 40 ? '0' : cervicalSva <= 80 ? '1' : '2';
      const cbvaGrade = !Number.isFinite(cbva) ? unavailable
        : cbva >= 1 && cbva <= 10 ? '0'
        : cbva >= -10 && cbva <= 25 ? '1' : '2';
      const mismatch = Number.isFinite(t1Slope) && Number.isFinite(cervicalLordosis)
        ? t1Slope - cervicalLordosis
        : null;
      const mismatchGrade = !Number.isFinite(mismatch) ? unavailable
        : mismatch < 15 ? '0' : mismatch <= 20 ? '1' : '2';
      return Object.freeze({
        cervicalSva: cSvaGrade,
        cbva: cbvaGrade,
        t1SlopeMinusCl: mismatchGrade,
        mismatch
      });
    }

    function runModelSelfTest() {
      const failures = [];
      let assertions = 0;
      const check = (condition, label) => {
        assertions += 1;
        if (!condition) failures.push(label);
      };
      const expectThrows = (operation, label) => {
        assertions += 1;
        try { operation(); failures.push(label); } catch (_) { /* expected */ }
      };

      try {
        const base = { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 };
        const lumbar10 = [{ id: 'self-lumbar', procedureId: 'alif', levelId: 'L4-L5', plannedAngle: 10, plannedAngleSource: 'user_planned' }];
        const off = calculateBiomechanics(base, lumbar10);
        const on = calculateBiomechanics(base, lumbar10, { applyReciprocalResponse: true });
        const coronalBaseline = { coronalMagnitude: 40, coronalDirection: 'right', compensatoryCobb: 20, trunkShift: 20, axialRotation: 12, secondaryFlexibility: .5 };
        const coronalPlan = [{ procedureId: 'alif', levelId: 'L4-L5', plannedCoronal: -16, plannedAxialRotation: -4, plannedTranslationMm: -8 }];
        const coronalOff = computeThreePlaneScenario(coronalBaseline, coronalPlan, { applyCoronalCompensation: false });
        const coronalPartial = computeThreePlaneScenario(coronalBaseline, coronalPlan, { applyCoronalCompensation: true });
        const coronalRigid = computeThreePlaneScenario({ ...coronalBaseline, secondaryFlexibility: 0 }, coronalPlan, { applyCoronalCompensation: true });
        const coronalFlexible = computeThreePlaneScenario({ ...coronalBaseline, secondaryFlexibility: 1 }, coronalPlan, { applyCoronalCompensation: true });
        check(MODEL_MANIFEST.modelVersion === '0.23.1'
          && MODEL_MANIFEST.buildId === 'alpha-2026-09-28.1',
        'versioned build identity');
        const pelvicReference = derivePelvicKinematicTargets(52, 22);
        const pelvicPiOnly = derivePelvicKinematicTargets(61, 22);
        const pelvicCombined = derivePelvicKinematicTargets(61, 30);
        check(pelvicReference.morphologyDeltaDeg === 0
          && pelvicReference.postureDeltaDeg === 0
          && pelvicReference.sacralSlopeDeg === 30,
        'reference pelvic kinematics are neutral');
        check(pelvicPiOnly.morphologyDeltaDeg === 9
          && pelvicPiOnly.postureDeltaDeg === 0
          && pelvicPiOnly.netSacralSlopeDeltaDeg === 9
          && pelvicPiOnly.identityResidualDeg === 0,
        'PI-only edits drive the authored sacral-base morphology delta');
        check(pelvicCombined.morphologyDeltaDeg === 9
          && pelvicCombined.postureDeltaDeg === -8
          && pelvicCombined.netSacralSlopeDeltaDeg === 1
          && pelvicCombined.identityResidualDeg === 0,
        'PI and PT compose to preserve PI equals PT plus SS');
        check(Object.keys(IMPLANT_CATALOGS.cages).length === 6
          && Object.keys(IMPLANT_CATALOGS.screws).length === 6
          && Object.keys(IMPLANT_CATALOGS.motionDevices).length === 1,
        'versioned implant catalogs loaded');
        check(Object.values(IMPLANT_CATALOGS.screws).every(catalog => Object.entries(catalog.diameterLengths).every(([diameter, lengths]) => Number(diameter) > 0 && lengths.length > 0 && lengths.every(length => length > 0))), 'screw catalog combinations are positive and nonempty');
        check(Object.values(IMPLANT_CATALOGS.cages).every(catalog => catalog.footprints.every(size => size.ap > 0 && size.ml > 0) && catalog.heights.every(height => height > 0)), 'cage catalog dimensions are positive');
        check(MODEL_MANIFEST.anatomy.sourceLicense === 'CC BY 4.0' && REFERENCE_ATLAS_SOURCE.license === 'CC BY 4.0', 'reference atlas source and redistribution license declared');
        check(/^[A-F0-9]{64}$/.test(MODEL_MANIFEST.anatomy.sourceBundleSha256), 'reference atlas bundle digest declared');
        check(/^[A-F0-9]{64}$/.test(MODEL_MANIFEST.anatomy.lowerLimbBundleSha256) && LOWER_LIMB_ATLAS_DATA.manifest.coverage?.complete === true, 'lower-limb atlas coverage and digest declared');
        check(LOWER_LIMB_ATLAS_DATA.manifest.coverage?.objectCount === 32 && LOWER_LIMB_ATLAS_SOURCE.distributionLegalReview?.requiredBeforeAppStoreOrPlayStoreDistribution === true, 'lower-limb source coverage and store legal-review gate declared');
        check(REFERENCE_ATLAS_DATA.manifest.coverage?.all_requested_nonempty === true && REFERENCE_ATLAS_DATA.manifest.coverage?.nonempty_structure_count === 31, 'reference atlas requested-mask coverage verified');
        check(MODEL_MANIFEST.anatomy.renderGeometryIsScrewPlanningModel === false && MODEL_MANIFEST.mechanics.renderGeometryIsComputationalModel === false, 'reference surface validation gates fail closed');
        check(MODEL_MANIFEST.mechanics.status === 'locked_pending_verification_and_validation' && MODEL_MANIFEST.mechanics.renderGeometryIsComputationalModel === false, 'mechanics fail-closed gate');
        // "off" means the thoracic assumption is switched off for this call; the
        // app's own default is ON (state.assumptions). PT responds either way.
        check(off.newLL === 58 && off.newTK === 42 && off.newPT === 17 && off.assumptions.enabled === false, 'thoracic reciprocal switched-off arithmetic');
        check(on.newTK === 44 && on.newPT === 17 && on.assumptions.enabled === true, 'thoracic reciprocal opt-in arithmetic');
        // Pelvic balance is not gated on the optional thoracic assumption: a
        // restored lumbar lordosis must unwind compensatory retroversion or the
        // modeled trunk levers backward out of a standing posture.
        check(off.newPT === on.newPT
          && off.outputs.pt.provenance === 'pelvic_balance_response_derived'
          && off.assumptions.pelvicBalanceApplied === true,
        'pelvic balance response applies independently of the thoracic assumption');
        const noLumbar = calculateBiomechanics(base, [{ id: 'self-cervical', procedureId: 'acdf', levelId: 'C5-C6', plannedAngle: 4, plannedAngleSource: 'user_planned' }]);
        check(noLumbar.newPT === base.pt
          && noLumbar.outputs.pt.provenance === 'input_passthrough'
          && noLumbar.assumptions.pelvicBalanceApplied === false,
        'pelvic tilt passes through untouched without lumbar gain');
        check(coronalOff.outputs.primaryCobb === 24 && coronalOff.outputs.secondaryCobb === -20 && coronalOff.flexibility.responseFraction === 0, 'three-plane compensation default off');
        check(coronalPartial.outputs.secondaryCobb === -16 && coronalPartial.flexibility.responseFraction === .2, 'partly flexible secondary response is bounded by primary improvement');
        check(coronalRigid.outputs.secondaryCobb === -20 && coronalFlexible.outputs.secondaryCobb === -12, 'structural and fully flexible secondary endpoints');
        check([coronalPartial.outputs.primaryCobb, coronalPartial.outputs.secondaryCobb, coronalPartial.outputs.apicalTranslation, coronalPartial.outputs.axialRotation].every(Number.isFinite), 'three-plane outputs remain finite');
        const thoracicCurve = { coronalMagnitude: 40, coronalDirection: 'right', compensatoryCobb: 20, coronalProfileId: 'thoracic-major-curve' };
        const cervicalOutOfCurve = computeThreePlaneScenario(thoracicCurve, [{ procedureId: 'acdf', levelId: 'C5-C6', plannedCoronal: -15 }]);
        const lumbarSecondary = computeThreePlaneScenario(thoracicCurve, [{ procedureId: 'llif', levelId: 'L3-L4', plannedCoronal: 10 }]);
        check(cervicalOutOfCurve.outputs.primaryCobb === 40 && cervicalOutOfCurve.outputs.secondaryCobb === -20
          && cervicalOutOfCurve.changes.outsideCurve.coronal === -15
          && lumbarSecondary.outputs.primaryCobb === 40 && lumbarSecondary.outputs.secondaryCobb === -10,
        'coronal changes reach only the declared curve that contains their level');
        check(on.outputs.ll.sourceInputs.corrections[0].plannedAngle === 10, 'actual correction snapshot');
        check(on.outputs.ll.sourceInputs.corrections[0].plannedAngleSource === 'user_planned', 'explicit correction source snapshot');
        check(Object.isFrozen(on.inputSnapshot) && Object.isFrozen(on.itinerarySnapshot) && Object.isFrozen(on.outputs.ll.sourceInputs), 'frozen traceability snapshots');
        check(on.outputs.tk.assumptionSnapshot.reciprocalTkPerLumbarDegree === MODEL_MANIFEST.assumptions.reciprocalTkPerLumbarDegree, 'manifest coefficient binding');
        check(on.outputs.tk.sourceInputs.corrections.some(item => item.procedureId === 'alif'), 'reciprocal TK retains lumbar procedure provenance');
        const floored = calculateBiomechanics({ ...base, pt: 12 }, lumbar10, { applyReciprocalResponse: true });
        check(floored.newPT === 10 && floored.constraintsApplied.includes('minimumModeledPt'), 'PT floor disclosure');

        /* ---- Pelvic balance: floor never raises PT; symmetric; junction ---- */
        const alif = (levelId, plannedAngle) => ({ procedureId: 'alif', levelId, plannedAngle, plannedAngleSource: 'user_planned' });
        const lowPtAlif = calculateBiomechanics({ pi: 40, ll: 40, tk: 35, cl: 15, pt: 6 }, [alif('L4-L5', 5)]);
        check(lowPtAlif.newPT <= 6 && lowPtAlif.outputs.pt.provenance === 'pelvic_balance_response_derived',
        'a lordosing correction never raises pelvic tilt above its pre-op value');
        const lowPiFloor = calculateBiomechanics({ pi: 40, ll: 30, tk: 35, cl: 15, pt: 20 }, [alif('L4-L5', 30)]);
        check(Math.abs(lowPiFloor.newPT - (40 - (0.59 * 40 + 9))) < 1e-9 && lowPiFloor.constraintsApplied.includes('minimumModeledPt'),
        'low-PI PT floor follows the PI-relative ideal instead of a fixed 10°');
        const lordosisLoss = calculateBiomechanics(base, [{ procedureId: 'lumbarTdr', levelId: 'L4-L5', plannedAngle: -10, plannedAngleSource: 'user_planned' }]);
        check(lordosisLoss.newLL === 38 && lordosisLoss.newPT === 27 && lordosisLoss.outputs.pt.provenance === 'pelvic_balance_response_derived',
        'lordosis loss raises compensatory PT symmetrically');
        expectThrows(() => calculateBiomechanics({ ...base, pi: 30, pt: 45 }, []), 'implausible pelvic geometry (PT at or above PI) withheld');

        /* ---- Per-disc attribution: junctions and body targets ------------ */
        const shareScenario = (procedureId, levelId, plannedAngle) => calculateBiomechanics(base, [{ procedureId, levelId, plannedAngle, plannedAngleSource: 'user_planned' }]);
        const tlJunctionPso = shareScenario('pso', 'T12-L1', 20);
        check(tlJunctionPso.newTK === base.tk && tlJunctionPso.newLL === base.ll
          && tlJunctionPso.localGains.thoracolumbar === 20 && tlJunctionPso.newPT === 17,
        'thoracolumbar-junction correction is reported locally and enters the pelvic balance response at 0.25°/°');
        // Level-dependent pelvic response (Lafage R 2022): 0.5°/° at L4-S1,
        // 0.25°/° at L1-L4, so the same 10° lowers PT by 5° distally, 2.5° proximally.
        const distalPt = shareScenario('pso', 'L4-L5', 10);
        const proximalPt = shareScenario('pso', 'L2-L3', 10);
        check(distalPt.newPT === base.pt - 5 && proximalPt.newPT === base.pt - 2.5
          && distalPt.newLL === proximalPt.newLL,
        'pelvic tilt response is level-dependent: 0.5°/° at L4-S1, 0.25°/° at L1-L4');
        const l1Body = shareScenario('osteotomyGrade4', 'BODY-L1', 40);
        const t12Body = shareScenario('vcr', 'BODY-T12', 40);
        check(l1Body.newLL === 68 && l1Body.localGains.thoracolumbar === 20 && l1Body.newPT === 12
          && t12Body.newTK === 22 && t12Body.localGains.thoracolumbar === 20 && t12Body.newPT === 17,
        'junction body corrections split across both spanned discs as the 3D chain poses them');
        const c7Body = shareScenario('accf', 'BODY-C7', 10);
        const upperThoracic = shareScenario('spo', 'T2-T3', 10);
        check(c7Body.newCL === base.cl + 5 && c7Body.localGains.cervicothoracic === 5
          && upperThoracic.newTK === base.tk && upperThoracic.localGains.upperThoracic === 10
          && shareScenario('spo', 'T8-T9', 10).newTK === base.tk - 10,
        'T1-T4 corrections sit outside the T4-T12 TK metric; cervical body shares reach CL');
        expectThrows(() => calculateBiomechanics(base, [
          { procedureId: 'tlifPlif', levelId: 'L4-L5', plannedAngle: 15, plannedAngleSource: 'user_planned' },
          { procedureId: 'spo', levelId: 'L4-L5', plannedAngle: 15, plannedAngleSource: 'user_planned' }
        ]), 'stacked same-segment corrections are capped at the largest single-procedure ceiling');
        check(calculateBiomechanics(base, [
          { procedureId: 'tlifPlif', levelId: 'L4-L5', plannedAngle: 10, plannedAngleSource: 'user_planned' },
          { procedureId: 'spo', levelId: 'L4-L5', plannedAngle: 5, plannedAngleSource: 'user_planned' }
        ]).newLL === 63, 'stacked same-segment corrections inside the cap remain additive');
        check(['llif', 'xlif', 'olif'].every(id => PROCEDURES[id].deltaAngle <= 5 && PROCEDURES[id].correctionMax < PROCEDURES.acr.correctionMax && PROCEDURES[id].correctionMax <= 15),
        'lateral interbody without ALL release stays below ACR-scale correction');
        const displayedTargets = derivePlanningTargets(base, { t1Slope: 40 });
        check(classifyModifiers({ mismatch: 0, measuredSva: 0, pt: displayedTargets.pelvicTilt }).pt === '0'
          && classifyCervicalModifiers({ cervicalSva: 20, cbva: 5, t1Slope: 40, cervicalLordosis: displayedTargets.cervicalLordosis }).t1SlopeMinusCl === '0'
          && derivePlanningTargets(base, { t1Slope: 28 }).cervicalLordosis === 18,
        'planning targets sit inside the SRS-Schwab and Ames bands the app displays');
        expectThrows(() => calculateBiomechanics(base, [{ procedureId: 'alif', levelId: 'L4-L5', plannedAngle: 10 }]), 'missing correction source rejected');
        expectThrows(() => calculateBiomechanics({ ...base, pi: true }, lumbar10), 'boolean base input rejected');
        expectThrows(() => calculateBiomechanics({ ...base, pt: null }, lumbar10), 'null base input rejected');
        expectThrows(() => calculateBiomechanics(base, [{ procedureId: 'alif', levelId: 'L4-L5', plannedAngle: false, plannedAngleSource: 'user_planned' }]), 'boolean correction rejected');
        expectThrows(() => calculateBiomechanics(base, [{ procedureId: 'alif', levelId: 'L4-L5', plannedAngle: '10', plannedAngleSource: 'user_planned' }]), 'string correction rejected');
        expectThrows(() => calculateBiomechanics(base, [{ procedureId: 'laminectomy', levelId: 'L4-L5', plannedAngle: 10, plannedAngleSource: 'not_applicable' }]), 'signed correction requires explicit provenance');
        const cervicalKyphosisScenario = calculateBiomechanics(base, [{ procedureId: 'pcf', levelId: 'C4-C5', plannedAngle: -8, plannedAngleSource: 'user_planned' }]);
        check(cervicalKyphosisScenario.newCL === 10 && cervicalKyphosisScenario.outputs.cl.sourceInputs.corrections[0].plannedAngle === -8, 'signed cervical correction retained');
        expectThrows(() => calculateBiomechanics(base, [{ procedureId: 'pcf', levelId: 'C4-C5', plannedAngle: -21, plannedAngleSource: 'user_planned' }]), 'procedure-specific signed correction domain enforced');
        expectThrows(() => calculateBiomechanics(base, [{ procedureId: 'alif', levelId: 'L4-L5', plannedAngle: 10, plannedAngleSource: 'procedure_default_assumption' }]), 'false default-assumption provenance rejected');
        expectThrows(() => calculateBiomechanics(base, [
          { procedureId: 'alif', levelId: 'L4-L5', plannedAngle: 10, plannedAngleSource: 'user_planned' },
          { procedureId: 'tlifPlif', levelId: 'L4-L5', plannedAngle: 5, plannedAngleSource: 'user_planned' }
        ]), 'conflicting itinerary rejected');
        const boundary = classifyModifiers({ mismatch: 20.001, measuredSva: 9.5, pt: 30.001 });
        check(boundary.mismatch === '++' && boundary.sva === '+' && boundary.pt === '++', 'modifier boundary arithmetic');
        const unavailable = classifyModifiers({ mismatch: NaN, measuredSva: NaN, pt: Infinity });
        check(unavailable.mismatch === '—' && unavailable.sva === '—' && unavailable.pt === '—', 'nonfinite modifiers unavailable');
        const cervicalReference = classifyCervicalModifiers({ cervicalSva: 20, cbva: 5, t1Slope: 28, cervicalLordosis: 18 });
        check(cervicalReference.cervicalSva === '0' && cervicalReference.cbva === '0' && cervicalReference.t1SlopeMinusCl === '0' && cervicalReference.mismatch === 10, 'Ames-style cervical reference bands');
        const cervicalMarked = classifyCervicalModifiers({ cervicalSva: 81, cbva: 26, t1Slope: 25, cervicalLordosis: -20 });
        check(cervicalMarked.cervicalSva === '2' && cervicalMarked.cbva === '2' && cervicalMarked.t1SlopeMinusCl === '2' && cervicalMarked.mismatch === 45, 'Ames-style marked cervical bands retain signed CL');
        const cervicalUnavailable = classifyCervicalModifiers({ cervicalSva: NaN, cbva: Infinity, t1Slope: 25, cervicalLordosis: NaN });
        check(cervicalUnavailable.cervicalSva === '—' && cervicalUnavailable.cbva === '—' && cervicalUnavailable.t1SlopeMinusCl === '—', 'nonfinite cervical modifiers unavailable');
        check(Object.keys(DEFORMITY_PRESETS).length === 12 && DEFORMITY_PRESETS['cervical-kyphosis'].alignment.cl < 0, 'versioned deformity pattern catalog loaded');
        check(Object.keys(CASE_EXAMPLES).length === 20
          && Object.keys(CASE_EXAMPLES).every(caseId => validateCaseExampleSeed(resolveCaseExampleSeed(caseId))),
        'versioned example pathology library validates');
        check(PATIENT_IMAGING_MODEL.networkTransferEnabled === false
          && PATIENT_IMAGING_MODEL.persistenceEnabled === false
          && PATIENT_IMAGING_MODEL.representations.hybrid.recommended === true
          && PATIENT_IMAGING_MODEL.representations.radiographs.capability === 'experimental_local_auto_landmark_plus_reviewed_measurement_transfer'
          && PATIENT_IMAGING_MODEL.representations.radiographs.clinicalValidation === false
          && MODEL_MANIFEST.patientImaging.appliedToGeometry === false,
        'patient imaging intake fails closed');
        check(!('newBalanceScore' in on) && !('preBalanceScore' in on), 'synthetic score absent');
        check(Object.values(on.outputs).every(item => item.modelVersion === MODEL_MANIFEST.modelVersion && item.uncertaintyStatus === 'not_established'), 'output version and uncertainty metadata');
        const pelvic = calculateBiomechanics(base, [{ procedureId: 's2aiFixation', levelId: 'PELVIS-SI', plannedAngle: 0, plannedAngleSource: 'not_applicable' }]);
        check(pelvic.newLL === base.ll && pelvic.newTK === base.tk && pelvic.newCL === base.cl && pelvic.newPT === base.pt, 'pelvic constructs do not alter alignment');
        check(isProcedureCompatible(PROCEDURES.siFusion, PELVIS_TARGET) && !isProcedureCompatible(PROCEDURES.siFusion, LEVEL_BY_ID.get('L5-S1')), 'pelvic target compatibility');
        check(Boolean(findProcedureConflict('iliacFixation', 'PELVIS-SI', [{ procedureId: 's2aiFixation', levelId: 'PELVIS-SI' }])), 'pelvic anchor conflict');

        /* ---- Body-indexed targets -------------------------------------- */
        check(BODY_TARGETS.length === 23
          && !BODY_TARGETS.some(target => target.id === 'BODY-C1' || target.id === 'BODY-S1')
          && BODY_TARGETS.every(target => target.displayIndex === null),
        'body target derivation');
        // The guarantee that every pre-existing procedure is unaffected: for two
        // motion segments, span overlap is exactly identity.
        check(LEVELS.every(a => LEVELS.every(b =>
          spansOverlap(spannedSegmentIdsFor(a.id), spannedSegmentIdsFor(b.id)) === (a.id === b.id))),
        'span overlap reduces to identity for motion segments');
        check(spannedSegmentIdsFor('BODY-C5').join() === 'C4-C5,C5-C6', 'body spans both adjacent discs');
        check(isProcedureCompatible(PROCEDURES.accf, LEVEL_BY_ID.get('BODY-C5'))
          && !isProcedureCompatible(PROCEDURES.accf, LEVEL_BY_ID.get('C5-C6'))
          && !isProcedureCompatible(PROCEDURES.acdf, LEVEL_BY_ID.get('BODY-C5')),
        'target kind gates disc and body procedures apart');
        check(Boolean(findProcedureConflict('accf', 'BODY-C5', [{ procedureId: 'acdf', levelId: 'C4-C5' }]))
          && Boolean(findProcedureConflict('accf', 'BODY-C5', [{ procedureId: 'acdf', levelId: 'C5-C6' }]))
          && !findProcedureConflict('accf', 'BODY-C5', [{ procedureId: 'acdf', levelId: 'C6-C7' }]),
        'body resection conflicts across both spanned discs only');
        check(Boolean(findProcedureConflict('accf', 'BODY-C6', [{ procedureId: 'accf', levelId: 'BODY-C5' }])),
        'contiguous complete-body resections fail closed without a continuous reconstruction model');
        check(Boolean(findProcedureConflict('vcr', 'BODY-L2', [{ procedureId: 'thoracolumbarCorpectomy', levelId: 'BODY-L2' }])),
        'one body-resection type per vertebra');
        // Augmentation leaves the discs alone and must not block them.
        check(!findProcedureConflict('tlifPlif', 'L4-L5', [{ procedureId: 'kyphoplasty', levelId: 'BODY-L4' }]),
        'disc-preserving body procedure does not block adjacent interbody');
        const corpectomyTopology = deriveConstructTopology([{ id: 1, levelId: 'BODY-L2', procedureId: 'thoracolumbarCorpectomy', plannedAngle: 6, plannedAngleSource: 'user_planned' }]);
        const corpectomyIntervals = derivePlannedFusionIntervals(corpectomyTopology);
        check(corpectomyIntervals.length === 1 && corpectomyIntervals[0].segmentCount === 2,
        'body resection yields one fusion interval spanning two segments');

        /* ---- Ligament vocabulary ---------------------------------------- */
        check(disruptsPosteriorTensionBand(PROCEDURES.laminectomy)
          && !disruptsPosteriorTensionBand(PROCEDURES.laminoplasty)
          && !disruptsPosteriorTensionBand(PROCEDURES.pcoGrade1)
          && !disruptsPosteriorTensionBand(PROCEDURES.thoracolumbarCorpectomy),
        'posterior tension band membership, not ligament list length');

        /* ---- Bounds agree with the evidence the app itself states -------- */
        check(PROCEDURES.spo.correctionMax <= 15 && PROCEDURES.pso.correctionMax <= 40,
        'osteotomy ceilings do not exceed the registered evidence claim');
        check(PROCEDURES.vcr.correctionMax <= MODEL_MANIFEST.engineeringDomains.plannedCorrection.max,
        'largest correction ceiling fits inside the global domain');
        check(PROCEDURES.accf.deltaAngle === 0, 'ACCF default correction is zero as sourced');
        const junctionalAcdfPolicy = correctionPolicyFor(PROCEDURES.acdf, LEVEL_BY_ID.get('C7-T1'));
        const junctionalSpoPolicy = correctionPolicyFor(PROCEDURES.spo, LEVEL_BY_ID.get('T12-L1'));
        const junctionalScenario = calculateBiomechanics(base, [{ procedureId: 'acdf', levelId: 'C7-T1', plannedAngle: 4, plannedAngleSource: 'procedure_default_assumption' }]);
        check(isProcedureCompatible(PROCEDURES.acdf, LEVEL_BY_ID.get('C7-T1'))
          && isProcedureCompatible(PROCEDURES.spo, LEVEL_BY_ID.get('T12-L1'))
          && junctionalAcdfPolicy.localOnly === true && junctionalSpoPolicy.localOnly === true
          && junctionalScenario.newCL === base.cl && junctionalScenario.itinerarySnapshot[0].plannedAngle === 4,
        'junctional angular procedures retain local rotation without changing aggregate regional endpoints');
        expectThrows(() => computeThreePlaneScenario({ coronalMagnitude: 121 }, []), 'three-plane baseline domain fails closed rather than clamping');
        expectThrows(() => computeThreePlaneScenario({ coronalMagnitude: 115 }, [{ procedureId: 'llif', levelId: 'L4-L5', plannedCoronal: 30 }]), 'three-plane modeled output domain fails closed rather than clamping');
        const siDefaultPlan = buildDefaultSuggestedImplantPlan('siFusion', 'PELVIS-SI');
        check(siDefaultPlan.renderStatus === 'withheld_pending_user_dimensions' && siDefaultPlan.components.length === 0, 'SI fixation does not borrow an S2AI catalog or invent default dimensions');
        expectThrows(() => calculateBiomechanics({ ...base, pi: 81 }, []), 'input engineering domain enforced');
        expectThrows(() => calculateBiomechanics(base, [
          { procedureId: 'pso', levelId: 'L1-L2', plannedAngle: 60, plannedAngleSource: 'user_planned' },
          { procedureId: 'pso', levelId: 'L2-L3', plannedAngle: 60, plannedAngleSource: 'user_planned' },
          { procedureId: 'pso', levelId: 'L3-L4', plannedAngle: 60, plannedAngleSource: 'user_planned' }
        ]), 'aggregate modeled-output domain enforced');
        expectThrows(() => calculateBiomechanics(base, [{ procedureId: 'tops', levelId: 'L4-L5', plannedAngle: 0, plannedAngleSource: 'not_applicable' }]), 'TOPS decompression prerequisite enforced');
        const topsScenario = calculateBiomechanics(base, [
          { procedureId: 'laminectomy', levelId: 'L4-L5', plannedAngle: 0, plannedAngleSource: 'not_applicable' },
          { procedureId: 'tops', levelId: 'L4-L5', plannedAngle: 0, plannedAngleSource: 'not_applicable' }
        ]);
        check(topsScenario.newLL === base.ll && topsScenario.newTK === base.tk, 'TOPS has no categorical angular correction');
        const topsDefaultPlan = buildDefaultSuggestedImplantPlan('tops', 'L4-L5');
        const topsDefaultRoles = new Set(topsDefaultPlan.components.map(component => component.role));
        check(topsDefaultRoles.has('posterior_motion_device') && topsDefaultRoles.has('screw_set') && !topsDefaultRoles.has('rod_set'), 'TOPS default plan contains motion device and four-screw component without rods');
        const expandedTops = expandSuggestionPrerequisites([
          { label: 'TOPS', procedureId: 'tops', levelId: 'L4-L5', sagittal: 0, coronal: 0, axial: 0, translation: 0 }
        ], []);
        check(expandedTops.length === 2 && expandedTops[0].procedureId === 'laminectomy' && expandedTops[1].procedureId === 'tops' && expandedTops[0].autoAddedPrerequisite === true, 'TOPS suggestions auto-expand decompression before device');
        const planningTargets = derivePlanningTargets({ ...base }, { coronalMagnitude: 30 });
        const planningResidual = deriveResidualDeficits(
          { ...base, ll: 25 },
          { coronalMagnitude: 30, coronalDirection: 'right', compensatoryCobb: 10, trunkShift: 12, axialRotation: 8, secondaryFlexibility: .5 },
          [],
          {}
        );
        check(planningTargets.lumbarLordosis === base.pi
          && planningResidual.residual.lumbarLordosis === 27
          && planningResidual.residual.primaryCobb === 30,
        'case targets and residual deficits are deterministic');
        const selfOption = {
          id: 'self-tops', title: 'Self-test TOPS branch', evidenceIds: ['topsFacetArthroplasty']
        };
        const selfBranch = {
          id: 'motion', label: 'Motion branch', steps: [
            { label: 'TOPS', procedureId: 'tops', levelId: 'L4-L5', sagittal: 0, coronal: 0, axial: 0, translation: 0 }
          ]
        };
        const plannedTopsBranch = planConstructComparisonBranch(
          base,
          { coronalMagnitude: 0, coronalDirection: 'right', compensatoryCobb: 0, trunkShift: 0, axialRotation: 0, secondaryFlexibility: 0 },
          [],
          {},
          selfOption,
          selfBranch,
          50
        );
        check(plannedTopsBranch.valid
          && plannedTopsBranch.candidates.length === 2
          && plannedTopsBranch.candidates[0].id === 50
          && plannedTopsBranch.candidates[1].id === 51,
        'construct branch plans atomically without consuming external identifiers');
        const adjacent = computeFusionBoundarySegments([
          { procedureId: 'acdf', levelId: 'C3-C4' },
          { procedureId: 'acdf', levelId: 'C5-C6' }
        ]);
        check(adjacent.length === 3 && adjacent[1].levelId === 'C4-C5' && adjacent[1].relation === 'between_fused_intervals', 'skip-level adjacency de-duplicated and sorted');
        check(MODEL_MANIFEST.mechanics.disabledOutputs.every(key => !(key in on) && !(key in on.outputs)), 'disabled mechanics outputs absent');
      } catch (error) {
        failures.push(`unexpected self-test exception: ${error instanceof Error ? error.message : String(error)}`);
      }

      return Object.freeze({
        passed: failures.length === 0,
        assertions,
        failures: Object.freeze(failures),
        modelVersion: MODEL_MANIFEST.modelVersion,
        buildId: MODEL_MANIFEST.buildId
      });
    }

    const MODEL_SELF_TEST = runModelSelfTest();
    document.getElementById('modelCardVersion').textContent = `v${MODEL_MANIFEST.modelVersion}`;
    document.getElementById('modelSelfTestStatus').textContent = MODEL_SELF_TEST.passed
      ? `passed · ${MODEL_SELF_TEST.assertions} checks · ${MODEL_SELF_TEST.buildId}`
      : `failed · ${MODEL_SELF_TEST.failures.join('; ')}`;
    if (!MODEL_SELF_TEST.passed) {
      window.__spineModuleReady = true;
      window.__showSpine3dError(`Model integrity check failed (${MODEL_SELF_TEST.failures.join('; ')}). Reload this file before using the simulator.`);
      throw new Error(`DeformitySim model self-test failed: ${MODEL_SELF_TEST.failures.join('; ')}`);
    }

