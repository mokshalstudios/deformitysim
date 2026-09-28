    if (!window.THREE || !window.THREE.OrbitControls) {
      window.__spineModuleReady = true;
      window.__showSpine3dError('The embedded 3D runtime is unavailable. Reload the app and verify the file is complete.');
      throw new Error('DeformitySim: Three.js or OrbitControls failed to initialize.');
    }
    const OrbitControls = window.THREE.OrbitControls;

    /* ---------------------------------------------------------------------
       1) STRICT MODEL DATA DICTIONARIES
       Each selectable level represents the superior vertebra and the disc
       below it. UI order is cranial-to-caudal; the 3D chain reverses it.
    --------------------------------------------------------------------- */
    // Replaced at build time by the audited, quantized atlas payload. Keeping a
    // valid empty object makes a damaged or partial file fail closed to the
    // semantic procedural anatomy instead of breaking the numerical tools.
    /*__REFERENCE_ATLAS_START__*/
    /*@@INCLUDE data/reference_atlas.js@@*/
    /*__REFERENCE_ATLAS_END__*/
    const REFERENCE_ATLAS_SOURCE = Object.freeze(REFERENCE_ATLAS_DATA.manifest.source || {});
    /*__LOWER_LIMB_ATLAS_START__*/
    /*@@INCLUDE data/lower_limb_atlas.js@@*/
    /*__LOWER_LIMB_ATLAS_END__*/
    const LOWER_LIMB_ATLAS_SOURCE = Object.freeze(LOWER_LIMB_ATLAS_DATA.manifest.source || {});

    const MODEL_MANIFEST = Object.freeze({
      modelId: 'spine-alignment-scenario',
      modelVersion: '0.23.1',
      buildId: 'alpha-2026-09-28.1',
      // Public release channel shown in the header and intro. The open-source
      // alpha ships without the launch-code gate (see 00-launch-gate.js).
      releaseChannel: 'alpha',
      /* Stated exclusions. A learner needs to tell "not modelled" apart from
         "not applicable", so anything deliberately absent is named here rather
         than left as a silent gap. */
      scopeExclusions: Object.freeze([
        Object.freeze({ topic: 'Paediatric growth modulation (vertebral body tethering, growing rods, MCGR, Shilla)',
          reason: 'These work by modulating remaining spinal growth. This is an adult model with no growth axis and no time dimension, so building them would be a correctness liability rather than added coverage.' }),
        Object.freeze({ topic: 'Oncologic staging and en-bloc resection planning',
          reason: 'Margin and approach decisions follow tumour extent, which is outside a three-plane alignment model. The mechanical reconstruction after resection IS modelled — it is geometrically a corpectomy with vertebral body replacement plus posterior fixation.' }),
        Object.freeze({ topic: 'Pain and neuromodulation procedures (interspinous spacers, spinal cord stimulation, radiofrequency ablation, SI denervation)',
          reason: 'All are pain-directed with no meaningful alignment or gait effect this model could represent. Lumbar disc replacement is modelled by contrast, because it does affect segmental lordosis.' }),
        Object.freeze({ topic: 'AxiaLIF (presacral axial L5–S1)',
          reason: 'Places an axial rod through the sacrum rather than a lordotic cage in the disc space, so its lordosis contribution is minimal; negligible current practice.' }),
        Object.freeze({ topic: 'Sacrectomy and S1 body targets',
          reason: 'S1 is never the superior vertebra of a modelled motion segment, so no S1 body target is generated.' }),
        Object.freeze({ topic: 'C1 body target',
          reason: 'The atlas has no vertebral body. Excluded anatomically, not by policy.' }),
        Object.freeze({ topic: 'Occipitocervical spanning constructs (O–C2, O–C3)',
          reason: 'Not yet modelled — this needs a third target kind spanning several levels. The existing Occiput–C1 entry is a placeholder, not a modelled operation. C1–C2 fusion IS modelled.' }),
        Object.freeze({ topic: 'Schwab grade 6 (multilevel vertebral column resection)',
          reason: 'Not modeled. Adjacent grade-5 resections are rejected until a continuous multilevel defect reconstruction and fixation model is implemented; separate short struts would be anatomically misleading.' })
      ]),
      intendedUse: 'Educational and research scenario exploration',
      validationStatus: 'Not clinically validated',
      anatomy: Object.freeze({
        geometryTier: 'source_coherent_ct_millimetre_external_surfaces_with_semantic_surgical_fallback',
        source: 'TotalSegmentator-v2-small-subject-s1369',
        sourceLicense: 'CC BY 4.0',
        sourceBundleSha256: '2AD0DDCD3E3E0BDB41C982C784A2C392E5CE0749DC6C2FAFBEF6B768D9A4F3FC',
        lowerLimbSource: 'BodyParts3D-v4-PART-OF-99-percent-reduced',
        lowerLimbBundleSha256: 'F90D97457028B1CA6041795C1C4126FEB9CB14678F27CB4F8087281943FF4DE8',
        compositeReferenceAnatomy: true,
        independentBoneNormalization: false,
        sourceRelativeCentroidsPreserved: true,
        uniformSubjectDisplayScale: true,
        motionSegmentPivots: 'source_surface_anterior_central_proxies_not_validated_landmarks',
        discGeometry: 'level_specific_literature_informed_envelopes_not_subject_segmentations',
        atlasMorphologyPolicy: 'preserve_intact_ct_surface_for_degeneration_and_withhold_unsupported_component_shape_edits',
        unsupportedCtShapeEditPolicy: 'withhold_without_compatible_segmented_surface',
        visualIntegrityPolicy: 'finite_scene_graph_single_bone_representation_and_no_detached_schematic_overlays',
        ligamentPosePolicy: 'withhold_rigid_source_pose_pathways_when_live_attachment_continuity_is_not_preserved',
        constructKinematicPolicy: 'live_joint_binding_or_component_level_fail_closed',
        cameraFramingPolicy: 'visible_anatomy_bounds_with_fov_aspect_and_margin',
        appStoreLegalReviewRequired: true,
        patientSpecific: false,
        displayToleranceOnly: true,
        pathologyControlsAreIllustrative: true,
        occiputAndLowerExtremityContext: true,
        renderGeometryIsScrewPlanningModel: false,
        atlasManifest: REFERENCE_ATLAS_DATA.manifest,
        referencePoseCalibration: Object.freeze({ pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 }),
        pelvicIncidenceTransformPolicy: 'authored_sacral_base_morphology_about_l5_s1_with_fixed_hip_axis',
        pelvicOrientationTransformDriver: 'pelvic_tilt_delta_about_bicoxofemoral_proxy_plus_independent_pi_morphology_delta',
        pelvicIncidencePatientSpecific: false,
        pelvicIncidenceGeometryDisclosure: 'display_surrogate rotates source sacrum and spine about the L5-S1 proxy; away from the atlas PI the innominates, SI overlays and pelvic ligaments are reshaped schematically by an angle-blended field about the same pivot (sacroiliac band moves with the sacrum, acetabular zone fixed on the femoral-head axis) and pelvic hardware follows it rigidly; educational approximation, not patient anatomy; fails closed only without the CT pelvis'
      }),
      mechanics: Object.freeze({
        status: 'locked_pending_verification_and_validation',
        renderGeometryIsComputationalModel: false,
        surveillanceMode: 'transparent_factor_triggers_only',
        surveillanceProbabilityCalculated: false,
        enabledOutputs: Object.freeze(['ll', 'cl', 'tk', 'pt']),
        disabledOutputs: Object.freeze(['implant_stress', 'fatigue_life', 'screw_loosening', 'cage_subsidence', 'ligament_strain', 'adjacent_segment_degeneration', 'failure_probability'])
      }),
      implants: Object.freeze({
        catalogRevision: '2026-07-12',
        dimensions: 'millimetres_converted_only_by_shared_reference_scale',
        selectionMode: 'explicit_catalog_or_user_dimensional_envelope',
        planSchema: 'implant-plan-v2',
        automaticSizing: false,
        corridorValidation: false,
        customSuitabilityInference: false,
        unverifiedGeometryPolicy: 'fail_closed'
      }),
      patientImaging: Object.freeze({
        schema: 'patient-imaging-intake/v2',
        privacyMode: 'local_ephemeral_deidentified_research_only',
        networkTransferEnabled: false,
        persistenceEnabled: false,
        appliedToGeometry: false,
        rasterCapability: 'preview_plus_explicit_measurement_transfer',
        dicomRadiographCapability: 'selected_unparsed_plus_explicit_measurement_transfer',
        alignmentTransferCapability: 'user_entered_measurements_only',
        ctCapability: 'selected_unparsed_unsegmented',
        hybridRegistrationCapability: 'unavailable_pending_validation'
      }),
      inputProvenance: Object.freeze({
        sagittalParameters: 'user_entered',
        measuredSva: 'measured_optional',
        segmentalCorrection: 'explicit_source_required',
        threePlaneScenario: 'explicit_user_authored_rigid_transform',
        secondaryCurveFlexibility: 'explicit_user_entered_fraction',
        reciprocalResponse: 'assumption_derived'
      }),
      units: Object.freeze({ angles: 'degrees', measuredSva: 'centimeters' }),
      engineeringDomains: Object.freeze({
        inputAngles: Object.freeze({
          pi: Object.freeze({ min: 30, max: 80 }),
          ll: Object.freeze({ min: 10, max: 80 }),
          tk: Object.freeze({ min: 10, max: 70 }),
          cl: Object.freeze({ min: -50, max: 80 }),
          pt: Object.freeze({ min: 5, max: 45 })
        }),
        outputAngles: Object.freeze({
          ll: Object.freeze({ min: 0, max: 100 }),
          cl: Object.freeze({ min: -90, max: 120 }),
          tk: Object.freeze({ min: -90, max: 90 }),
          pt: Object.freeze({ min: 5, max: 50 })
        }),
        // Raised from 60 to 80 so a grade-5 VCR (ceiling 70 deg, sourced) is not
        // silently truncated by the global clamp. The real safety net is
        // signed outputAngles above, which also permits an explicitly authored
        // thoracic lordotic result after a high-grade thoracic osteotomy.
        plannedCorrection: Object.freeze({ min: -80, max: 80 })
      }),
      // Used when a coronal magnitude is authored without a declared curve
      // pattern, so the input is never silently ignored.
      defaultCoronalProfileId: 'degenerative-scoliosis',
      assumptions: Object.freeze({
        reciprocalResponseId: 'reciprocal-tk-pt-v1',
        reciprocalTkPerLumbarDegree: 0.2,
        // PT change per 1° of lordosis change, BY LEVEL: Lafage R et al.,
        // Global Spine J 2022 (PMID 33567927), 433 ASD patients. Their
        // simulated-correction regressions give about 0.5° PT per degree for
        // L4-S1 corrections (raw coefficient 0.456) but about 0.25° for L1-L4
        // (raw 0.346) and 0.25° for the thoracolumbar junction; the rounded
        // clinical rules of thumb are used. Earlier builds applied 0.5° at every
        // lumbar level and at T12-L1, which overstated the pelvic response of
        // proximal corrections by ~2x (e.g. PSO 30° at L3-L4: PT 30 -> 15 instead
        // of 30 -> 22.5). A level missing here gets no PT response.
        ptReductionPerDegreeByLevel: Object.freeze({
          'T12-L1': 0.25,
          'L1-L2': 0.25,
          'L2-L3': 0.25,
          'L3-L4': 0.25,
          'L4-L5': 0.5,
          'L5-S1': 0.5
        }),
        ptReductionSource: 'Lafage R et al., Global Spine J 2022 (PMID 33567927): ~0.5°/° at L4-S1, ~0.25°/° at L1-L4 and T12-L1 (rounded)',
        minimumModeledPt: 10,
        // A lordosing correction unwinds compensatory retroversion; it never
        // adds retroversion. The floor is the lower of 10° and the PI-relative
        // ideal PT from the GAP score (ideal SS = 0.59·PI + 9, so ideal PT =
        // 0.41·PI − 9; Yilgor C et al., JBJS Am 2017, PMID 28976431), so a
        // low-PI pelvis is not pushed above its own ideal, and it never goes
        // below the 5° modeled-output floor.
        minimumModeledPtPolicy: 'min(10°, max(5°, 0.41·PI − 9°)); never above the pre-op PT for a lordosing change',
        // The response follows the net lordosis change in either direction
        // (compensatory retroversion is the mechanism; Barrey C et al., "Compensatory
        // mechanisms contributing to keep the sagittal balance of the spine", Eur
        // Spine J 2013) and includes the T12-L1 thoracolumbar junction, which sits
        // between the TK and LL Cobb endpoints but levers the trunk the same way.
        pelvicBalanceScope: 'level-weighted L1-S1 lordosis change plus the T12-L1 thoracolumbar junction (0.5°/° L4-S1, 0.25°/° L1-L4 and T12-L1); symmetric for lordosis loss'
      }),
      angleConvention: Object.freeze({
        cervicalLordosis: 'Signed C2-C7 metric; positive lordosis, negative kyphosis; C0-C1, C1-C2 and C7-T1 are reported as local junction rotations',
        // T4-T12 matches the radiograph worksheet, which measures and transfers
        // TK as T4-T12. T1-T4 corrections are reported as upper-thoracic local
        // rotations, so they no longer change a TK value the user measured at T4.
        thoracicKyphosis: 'T4-T12 metric (radiograph-worksheet convention); T1-T4 segments are upper-thoracic local rotations; T12-L1 is the thoracolumbar junction. The 3D display profile still spreads the baseline curve over T1-T12.',
        lumbarLordosis: 'L1-S1 metric, displayed weighted toward distal lumbar segments',
        // A vertebral-body target spans two discs; its correction is split evenly
        // across them, which is how the 3D chain poses it, and each half is
        // reported in the metric (or local junction output) of its own disc.
        bodyTargets: 'Even split across both spanned discs, each share reported in that disc\'s metric or local junction output'
      })
    });

    function derivePelvicKinematicTargets(pi, pt, calibration = MODEL_MANIFEST.anatomy.referencePoseCalibration) {
      if (![pi, pt, calibration?.pi, calibration?.pt].every(Number.isFinite)) {
        throw new TypeError('Pelvic incidence, pelvic tilt, and reference calibration must be finite numbers.');
      }
      const morphologyDeltaDeg = pi - calibration.pi;
      const postureDeltaDeg = calibration.pt - pt;
      const sacralSlopeDeg = pi - pt;
      const referenceSacralSlopeDeg = calibration.pi - calibration.pt;
      return Object.freeze({
        pelvicIncidenceDeg: pi,
        pelvicTiltDeg: pt,
        sacralSlopeDeg,
        referenceSacralSlopeDeg,
        morphologyDeltaDeg,
        postureDeltaDeg,
        netSacralSlopeDeltaDeg: sacralSlopeDeg - referenceSacralSlopeDeg,
        identityResidualDeg: pi - (pt + sacralSlopeDeg),
        // PI = PT + SS, so PT >= PI means a sacral endplate at or past vertical.
        // The independent PI and PT inputs allow it; the engine withholds modeled
        // output for it and the UI flags it rather than posing it as valid.
        sacralSlopePlausible: sacralSlopeDeg > 0
      });
    }

    // metricRegion names the regional Cobb a segment belongs to. Segments
    // outside every regional Cobb carry a localGroup instead, so a correction
    // there is still reported (as a local junction/upper-thoracic rotation)
    // rather than silently vanishing from the numbers while the 3D chain poses it.
    const LEVELS = Object.freeze([
      { id: 'C0-C1', displayName: 'Occiput–C1', superior: 'C0', inferior: 'C1', region: 'cervical', metricRegion: null, localGroup: 'occipitocervical' },
      { id: 'C1-C2', superior: 'C1', inferior: 'C2', region: 'cervical', metricRegion: null, localGroup: 'atlantoaxial' },
      { id: 'C2-C3', superior: 'C2', inferior: 'C3', region: 'cervical', metricRegion: 'cervical' },
      { id: 'C3-C4', superior: 'C3', inferior: 'C4', region: 'cervical', metricRegion: 'cervical' },
      { id: 'C4-C5', superior: 'C4', inferior: 'C5', region: 'cervical', metricRegion: 'cervical' },
      { id: 'C5-C6', superior: 'C5', inferior: 'C6', region: 'cervical', metricRegion: 'cervical' },
      { id: 'C6-C7', superior: 'C6', inferior: 'C7', region: 'cervical', metricRegion: 'cervical' },
      { id: 'C7-T1', superior: 'C7', inferior: 'T1', region: 'cervical', metricRegion: null, localGroup: 'cervicothoracic' },
      // TK is the T4-T12 Cobb (see angleConvention.thoracicKyphosis): T1-T4
      // segments sit above its cranial endplate.
      { id: 'T1-T2', superior: 'T1', inferior: 'T2', region: 'thoracic', metricRegion: null, localGroup: 'upperThoracic' },
      { id: 'T2-T3', superior: 'T2', inferior: 'T3', region: 'thoracic', metricRegion: null, localGroup: 'upperThoracic' },
      { id: 'T3-T4', superior: 'T3', inferior: 'T4', region: 'thoracic', metricRegion: null, localGroup: 'upperThoracic' },
      { id: 'T4-T5', superior: 'T4', inferior: 'T5', region: 'thoracic', metricRegion: 'thoracic' },
      { id: 'T5-T6', superior: 'T5', inferior: 'T6', region: 'thoracic', metricRegion: 'thoracic' },
      { id: 'T6-T7', superior: 'T6', inferior: 'T7', region: 'thoracic', metricRegion: 'thoracic' },
      { id: 'T7-T8', superior: 'T7', inferior: 'T8', region: 'thoracic', metricRegion: 'thoracic' },
      { id: 'T8-T9', superior: 'T8', inferior: 'T9', region: 'thoracic', metricRegion: 'thoracic' },
      { id: 'T9-T10', superior: 'T9', inferior: 'T10', region: 'thoracic', metricRegion: 'thoracic' },
      { id: 'T10-T11', superior: 'T10', inferior: 'T11', region: 'thoracic', metricRegion: 'thoracic' },
      { id: 'T11-T12', superior: 'T11', inferior: 'T12', region: 'thoracic', metricRegion: 'thoracic' },
      { id: 'T12-L1', superior: 'T12', inferior: 'L1', region: 'thoracic', metricRegion: null, localGroup: 'thoracolumbar' },
      { id: 'L1-L2', superior: 'L1', inferior: 'L2', region: 'lumbar', metricRegion: 'lumbar' },
      { id: 'L2-L3', superior: 'L2', inferior: 'L3', region: 'lumbar', metricRegion: 'lumbar' },
      { id: 'L3-L4', superior: 'L3', inferior: 'L4', region: 'lumbar', metricRegion: 'lumbar' },
      { id: 'L4-L5', superior: 'L4', inferior: 'L5', region: 'lumbar', metricRegion: 'lumbar' },
      { id: 'L5-S1', superior: 'L5', inferior: 'S1', region: 'lumbar', metricRegion: 'lumbar' }
    ].map((level, displayIndex) => Object.freeze({ ...level, kind: 'motion_segment', displayIndex })));

    const PELVIS_TARGET = Object.freeze({
      id: 'PELVIS-SI', displayName: 'Pelvis / SI joints', superior: 'Pelvis', inferior: 'SI',
      region: 'pelvis', metricRegion: null, kind: 'pelvis', isChain: false, displayIndex: LEVELS.length
    });

    /* Vertebral-BODY targets.

       Every procedure above acts across a disc — a motion segment. A corpectomy
       or a vertebral column resection removes a vertebral BODY, which spans the
       two discs either side of it. Those need their own target identity.

       Derived from LEVELS rather than hand-authored, so the two can never drift.
       A body exists where a vertebra is both the `superior` of one segment and
       the `inferior` of another, i.e. it has a disc above and below.

       Deliberately NOT added to LEVELS. `displayIndex` there is load-bearing
       integer arithmetic — derivePlannedFusionIntervals does `index === end + 1`
       and LEVELS.slice(start, end + 1), computeFusionBoundarySegments does
       `start - 1` / `end + 1`, and CHAIN_LEVELS builds the 3D chain from it.
       Inserting body rows would silently renumber every fusion span in the app.
       `displayIndex: null` here fails loudly instead of plausibly. */
    const BODY_TARGET_EXCLUSIONS = Object.freeze(new Set([
      'C1'   // the atlas has no vertebral body; anatomic fact, not a policy choice
    ]));
    const BODY_TARGETS = Object.freeze(
      LEVELS
        .filter(level => !BODY_TARGET_EXCLUSIONS.has(level.superior)
          && LEVELS.some(other => other.inferior === level.superior))
        .map(level => {
          const cranial = LEVELS.find(other => other.inferior === level.superior);
          return Object.freeze({
            id: `BODY-${level.superior}`,
            kind: 'vertebral_body',
            bodyId: level.superior,
            displayName: `${level.superior} body`,
            cranialSegmentId: cranial.id,
            caudalSegmentId: level.id,
            // The 3D record for a segment owns the bone of its SUPERIOR vertebra,
            // so the caudal segment is also the record that holds this body.
            hostSegmentId: level.id,
            superior: level.superior, inferior: level.superior,
            region: level.region,
            // Only claim a single metric region when both spanned discs agree. A
            // body at a junction (C2, C7, T1, T4, T12, L1) straddles two metric
            // rows; correctionSharesFor splits its correction evenly across the
            // two discs, exactly as the 3D chain poses it, and reports each half
            // in its own disc's metric or local output.
            metricRegion: cranial.metricRegion === level.metricRegion ? level.metricRegion : null,
            localGroup: !cranial.metricRegion && !level.metricRegion && cranial.localGroup === level.localGroup ? level.localGroup : null,
            displayIndex: null, isChain: true
          });
        })
    );

    const SURGICAL_TARGETS = Object.freeze([...LEVELS, ...BODY_TARGETS, PELVIS_TARGET]);

    const PROCEDURES = Object.freeze({
      acdf: Object.freeze({
        // Reported per-level ACDF segmental lordosis change is a few degrees;
        // +/-15 bounds authored kyphosis correction without allowing a single
        // cervical level to absorb a whole-construct correction.
        name: 'ACDF', region: 'cervical', excludedLevels: Object.freeze(['C0-C1', 'C1-C2']), deltaAngle: 4, type: 'anterior_cage_plate',
        allowSignedCorrection: true, correctionMin: -15, correctionMax: 15,
        effect: 'Models an explicitly entered signed cervical segment change', hardware: 'Catalog interbody cage · plate withheld pending dimensioned catalog', fusion: true
      }),
      discReplacement: Object.freeze({
        // Motion-preserving arthroplasty aims to restore disc height and retain
        // motion, not to drive segmental correction; bounds stay tight.
        name: 'Disc Replacement (Arthroplasty)', region: 'cervical', allowedLevels: Object.freeze(['C3-C4', 'C4-C5', 'C5-C6', 'C6-C7']), deltaAngle: 2, type: 'motion_disc',
        allowSignedCorrection: true, correctionMin: -10, correctionMax: 10,
        effect: 'Models an explicitly entered signed cervical segment change', hardware: 'Metallic motion disc'
      }),
      pcf: Object.freeze({
        name: 'PCF (Posterior Cervical Fusion)', region: 'cervical', excludedLevels: Object.freeze(['C0-C1']), deltaAngle: 0, type: 'posterior_screws',
        allowSignedCorrection: true, correctionMin: -20, correctionMax: 20,
        effect: 'Fixation with an optional signed cervical segment scenario', hardware: 'Posterior rods · screws', fusion: true
      }),
      occipitalFusion: Object.freeze({
        name: 'Occiput–C1 Fusion (Reference)', region: 'cervical', allowedLevels: Object.freeze(['C0-C1']), deltaAngle: 0, type: 'occipital_fusion',
        effect: 'Adds a fusion scenario without unverified device geometry; no modeled angular change', hardware: 'Hardware withheld pending a dimensioned occipitocervical catalog', fusion: true
      }),
      laminectomy: Object.freeze({
        // Isolated decompression does not correct alignment, so no angular
        // output is offered at all. It still disrupts the posterior ligaments,
        // which is what drives the construct-review markers.
        name: 'Laminectomy', region: 'any', excludedLevels: Object.freeze(['C0-C1', 'C1-C2']), deltaAngle: 0, type: 'decompression',
        allowSignedCorrection: false,
        effect: 'Planned decompression envelope over intact CT reference; decompression alone produces no modeled angular correction', hardware: 'Planned bilateral lamina/spinous resection envelope · cut-margin overlays · no CT mesh subtraction', disruptsLigaments: Object.freeze(['ligamentum_flavum', 'interspinous', 'supraspinous'])
      }),
      tlifPlif: Object.freeze({
        // Posterior interbody segmental lordosis gain is modest in the reported
        // literature; the ceiling keeps a single level from absorbing a whole
        // construct's correction.
        name: 'TLIF', region: 'lumbar', deltaAngle: 5, type: 'posterior_cage_screws', interbodyApproach: 'tlif',
        correctionMin: 0, correctionMax: 15,
        effect: 'Adds an explicitly entered lumbar lordosis scenario', hardware: 'Transforaminal cage envelope · posterior screws/rods',
        fusion: true, defaultConstruct: 'interbody_plus_bilateral_posterior_screw_rod'
      }),
      plif: Object.freeze({
        name: 'PLIF', region: 'lumbar', deltaAngle: 5, type: 'posterior_cage_screws', interbodyApproach: 'plif',
        correctionMin: 0, correctionMax: 15,
        effect: 'Adds an explicitly entered lumbar lordosis scenario', hardware: 'Paired posterior cage envelopes · posterior screws/rods',
        fusion: true, defaultConstruct: 'interbody_plus_bilateral_posterior_screw_rod'
      }),
      alif: Object.freeze({
        // Anterior release plus a lordotic or hyperlordotic cage gives the
        // largest reported single-level interbody gain; 30 is a generous ceiling.
        name: 'ALIF', region: 'lumbar', deltaAngle: 15, type: 'anterior_cage_screws', interbodyApproach: 'alif',
        correctionMin: 0, correctionMax: 30,
        effect: 'Adds an explicitly entered lumbar lordosis scenario', hardware: 'Anterior cage envelope · bilateral posterior screws/rods · unverified anterior plate omitted',
        fusion: true, defaultConstruct: 'interbody_plus_bilateral_posterior_screw_rod'
      }),
      /* Lateral and oblique interbody without an anterior longitudinal ligament
         release. Reviews report mean segmental lordosis gains of only a few
         degrees per level for these approaches (Uribe JS et al., Spine 2016;
         Saigal R et al., Spine 2016), with gains of 10° and more reserved for
         anterior column realignment with ALL release (the separate acr entry).
         Default 5° and ceiling 15° keep these entries out of ACR territory; the
         previous 10° default and 25° ceiling were already ACR-scale. */
      llif: Object.freeze({
        name: 'Direct lateral interbody fusion', region: 'lumbar', allowedLevels: Object.freeze(['L1-L2', 'L2-L3', 'L3-L4', 'L4-L5']),
        deltaAngle: 5, type: 'lateral_cage_screws', interbodyApproach: 'llif', correctionMin: 0, correctionMax: 15,
        effect: 'Adds an explicitly entered lumbar lordosis scenario', hardware: 'Direct-lateral cage envelope · bilateral posterior screws/rods',
        fusion: true, defaultConstruct: 'interbody_plus_bilateral_posterior_screw_rod'
      }),
      xlif: Object.freeze({
        name: 'Transpsoas lateral interbody fusion', region: 'lumbar', allowedLevels: Object.freeze(['L1-L2', 'L2-L3', 'L3-L4', 'L4-L5']),
        deltaAngle: 5, type: 'lateral_cage_screws', interbodyApproach: 'xlif', correctionMin: 0, correctionMax: 15,
        effect: 'Adds an explicitly entered lumbar lordosis scenario', hardware: 'Transpsoas lateral cage envelope · bilateral posterior screws/rods',
        fusion: true, defaultConstruct: 'interbody_plus_bilateral_posterior_screw_rod'
      }),
      olif: Object.freeze({
        name: 'Oblique lateral interbody fusion', region: 'lumbar', allowedLevels: Object.freeze(['L2-L3', 'L3-L4', 'L4-L5']),
        deltaAngle: 5, type: 'oblique_cage_screws', interbodyApproach: 'olif', correctionMin: 0, correctionMax: 15,
        effect: 'Adds an explicitly entered lumbar lordosis scenario', hardware: 'Oblique-lateral cage envelope · bilateral posterior screws/rods',
        fusion: true, defaultConstruct: 'interbody_plus_bilateral_posterior_screw_rod'
      }),
      tops: Object.freeze({
        name: 'Posterior facet-replacement motion device (TOPS reference)', region: 'lumbar', allowedLevels: Object.freeze(['L3-L4', 'L4-L5']), deltaAngle: 0, type: 'posterior_motion',
        effect: 'Automatically adds the required same-level decompression, then models posterior motion stabilization without an angular correction',
        hardware: 'TOPS reference configuration · four polyaxial pedicle screws · lamina/facet/pars resection envelope',
        disruptsLigaments: Object.freeze(['ligamentum_flavum', 'interspinous', 'supraspinous'])
      }),
      spo: Object.freeze({
        // Schwab grade 2: complete facet joint and ligamentum flavum resection.
        // Published per-level correction clusters near 10 deg. The ceiling was 20,
        // which is twice every published figure and twice what this app's own
        // EVIDENCE.osteotomyCorrection.supportedClaim string tells the user
        // ("about 10 deg per SPO level") - a user-visible self-contradiction.
        // Reduced to 15 as an authoring ceiling above the mean but not double it.
        // The "roughly 1 deg per mm of resection" mnemonic is a rule of thumb, not
        // derived from any primary source, and cadaveric measurement (PMID
        // 21102277) puts the real per-level yield lower still.
        name: 'Posterior column osteotomy · complete facet (Schwab grade 2, Ponte-type)',
        region: 'thoracolumbar', deltaAngle: 10, type: 'osteotomy_post',
        schwabGrade: 2, approachModifier: 'P',
        correctionMin: 0, correctionMax: 15,
        effect: 'Adds localized lordosing correction', hardware: 'Source-bounded posterior closing footprint over intact CT · posterior screw/rod fusion construct',
        disruptsLigaments: Object.freeze(['ligamentum_flavum', 'interspinous', 'supraspinous']),
        fusion: true, defaultConstruct: 'posterior_osteotomy_plus_bilateral_screw_rod'
      }),
      pso: Object.freeze({
        // Schwab grade 3: pedicle plus a wedge of the vertebral body, discs intact.
        // Reported single-level correction is about 25-40 deg, thoracic at the
        // lower end and lumbar at the upper. Ceiling reduced 45 -> 40 to match the
        // upper bound of the app's own registered citation (Gill, PMID 18978421)
        // and the comment directly above it, which already said 25-40.
        // A PSO extending into an adjacent disc space is by definition a grade 4
        // resection - see osteotomyGrade4 - not a larger PSO.
        name: 'PSO (Pedicle Subtraction Osteotomy · Schwab grade 3)',
        region: 'thoracolumbar', deltaAngle: 30, type: 'osteotomy_wedge',
        schwabGrade: 3, approachModifier: 'P',
        correctionMin: 0, correctionMax: 40,
        effect: 'Adds sharp localized lordosing correction', hardware: 'Source-bounded translucent three-column wedge envelope over intact CT · posterior screw/rod fusion construct',
        // A PSO subsumes a complete facetectomy; the PLC token already placed this
        // in the tension band, so the added tokens change prose only.
        disruptsLigaments: Object.freeze(['ligamentum_flavum', 'interspinous', 'supraspinous', 'posterior_ligament_complex']),
        fusion: true, defaultConstruct: 'posterior_osteotomy_plus_bilateral_screw_rod'
      }),

      /* ---- Body-indexed resections -------------------------------------
         These target a vertebral BODY, not a disc, and span the two discs either
         side of it. targetKind gates them to BODY-* targets; resectsVertebralBody
         drives the conflict and topology rules. */
      accf: Object.freeze({
        // deltaAngle is 0 and that is the sourced finding, not an oversight.
        // Pooled meta-analysis puts segmental and C2-C7 angle change slightly in
        // ACDF's favour (MD 3.38 and 3.70 deg), and a 2023 cohort found the
        // corpectomy hybrid LOST lordosis (-2.12 vs +9.04 deg at 3 months).
        // Corpectomy is a decompression operation, not a lordosing one.
        // Bounds are authoring values: the ceiling is anchored on reported local
        // kyphosis correction of 21.7 +/- 1.7 deg in established fixed kyphosis;
        // the floor is unverified.
        name: 'ACCF (Anterior Cervical Corpectomy and Fusion)', region: 'cervical',
        type: 'anterior_corpectomy_vbr', targetKind: 'vertebral_body',
        resectsVertebralBody: true, wholeBodyResection: true, consumesAdjacentDiscs: true,
        anteriorColumnReconstruction: true,
        allowedLevels: Object.freeze(['BODY-C3', 'BODY-C4', 'BODY-C5', 'BODY-C6', 'BODY-C7']),
        deltaAngle: 0, allowSignedCorrection: true, correctionMin: -20, correctionMax: 25,
        correctionProvenance: 'authoring_bounds_partially_anchored',
        effect: 'Removes the vertebral body and both adjacent discs; reconstructs the anterior column',
        hardware: 'Expandable vertebral body replacement spanning both discs · anterior plate geometry withheld',
        // These anterior pathways are divided without implying posterior-tension-band
        // disruption; the visual layer now treats those concepts independently.
        disruptsLigaments: Object.freeze(['anterior_longitudinal_ligament', 'posterior_longitudinal_ligament']),
        fusion: true,
        supplementalPosteriorFixationByBodyCount: Object.freeze({ 1: 'optional', 2: 'strongly_recommended', 3: 'required' })
      }),
      thoracolumbarCorpectomy: Object.freeze({
        // 5.9 deg bi-segmental kyphotic correction in a 2024 expandable-VBR
        // cohort. The wider ~15 deg reported elsewhere comes from a posterior
        // reduction performed BEFORE anterior reconstruction in acute reducible
        // fractures, so it is not attributable to the corpectomy itself.
        name: 'Thoracolumbar corpectomy with vertebral body replacement', region: 'thoracolumbar',
        type: 'corpectomy_vbr', targetKind: 'vertebral_body',
        resectsVertebralBody: true, wholeBodyResection: true, consumesAdjacentDiscs: true,
        anteriorColumnReconstruction: true,
        deltaAngle: 6, allowSignedCorrection: true, correctionMin: -10, correctionMax: 30,
        correctionProvenance: 'anchored_upper_bound_authoring_floor',
        effect: 'Removes the vertebral body and both adjacent discs; reconstructs the anterior column',
        hardware: 'Expandable vertebral body replacement · mandatory posterior instrumented construct',
        // Both longitudinal ligaments are divided, but neither belongs to the
        // posterior tension band, so these appear in prose only.
        disruptsLigaments: Object.freeze(['anterior_longitudinal_ligament', 'posterior_longitudinal_ligament']),
        fusion: true, mandatorySupplementalFixation: true,
        labeledIndication: 'tumor or trauma; degenerative disease is not on the thoracolumbar device labels'
      }),
      osteotomyGrade4: Object.freeze({
        // Schwab grade 4: PSO extended into an adjacent disc and endplate. A PSO
        // that reaches the disc IS a grade 4 by definition, not a larger PSO.
        // 41 +/- 14 deg segmental lordosis in a 55-case series; the observed range
        // was 7-69 deg, so the spread matters more here than the mean.
        name: 'Extended PSO with disc and endplate resection (Schwab grade 4)', region: 'thoracolumbar',
        type: 'osteotomy_wedge_extended', targetKind: 'vertebral_body',
        resectsVertebralBody: true, wholeBodyResection: false, consumesAdjacentDiscs: true,
        adjacentDiscResection: 'cranial',
        schwabGrade: 4, approachModifier: 'P',
        deltaAngle: 40, correctionMin: 0, correctionMax: 60,
        correctionProvenance: 'sourced_default_authoring_ceiling',
        effect: 'Adds large three-column lordosing correction across the resected body',
        hardware: 'Three-column wedge with adjacent disc resection · posterior screw/rod construct; accessory rods evidence-supported',
        disruptsLigaments: Object.freeze([
          'anterior_longitudinal_ligament', 'posterior_longitudinal_ligament',
          'ligamentum_flavum', 'interspinous', 'supraspinous', 'posterior_ligament_complex'
        ]),
        fusion: true, mandatorySupplementalFixation: true
      }),
      vcr: Object.freeze({
        // Schwab grade 5. Default sits at the conservative end of the published
        // 45-70 deg band. Teaching point worth surfacing beside the slider: a
        // matched grade-4-vs-grade-5 comparison found segmental correction
        // statistically similar (51.1 vs 48.4 deg, p = 0.694) for ~145 min more
        // operative time and ~249 mL more blood loss. Climbing the ladder does not
        // buy correction linearly.
        name: 'Vertebral column resection (Schwab grade 5)', region: 'thoracolumbar',
        type: 'osteotomy_resection', targetKind: 'vertebral_body',
        resectsVertebralBody: true, wholeBodyResection: true, consumesAdjacentDiscs: true,
        anteriorColumnReconstruction: true,
        schwabGrade: 5, approachModifier: 'P',
        deltaAngle: 45, correctionMin: 0, correctionMax: 70,
        correctionProvenance: 'sourced_band_conservative_default',
        effect: 'Removes the entire vertebra and both discs; largest modeled single-level correction',
        hardware: 'Complete three-column resection · mandatory posterior construct; anterior support frequently applied',
        disruptsLigaments: Object.freeze([
          'anterior_longitudinal_ligament', 'posterior_longitudinal_ligament',
          'ligamentum_flavum', 'interspinous', 'supraspinous', 'posterior_ligament_complex'
        ]),
        fusion: true, mandatorySupplementalFixation: true
      }),
      kyphoplasty: Object.freeze({
        // Body-indexed, but the discs are left intact - consumesAdjacentDiscs is
        // false, so this never blocks an interbody at either adjacent level.
        // The small number IS the teaching point: reported wedge-angle improvement
        // is about 3 deg, near the resolution of the rest of this model.
        // Augmentation is not an alignment operation.
        name: 'Vertebral augmentation (kyphoplasty)', region: 'thoracolumbar',
        type: 'vertebral_augmentation', targetKind: 'vertebral_body',
        resectsVertebralBody: false, consumesAdjacentDiscs: false,
        deltaAngle: 3, correctionMin: 0, correctionMax: 10,
        correctionProvenance: 'sourced_default_authoring_ceiling',
        // The entered wedge change is posed across the body's two discs and is
        // counted in the regional metric those discs belong to, like any other
        // angular input, so LL and the pelvic balance response move with it.
        // The copy says so rather than claiming the region is untouched.
        effect: 'Small local wedge-angle change (about 3° reported); it is not an alignment operation, and regional angles move only by the entered local angle',
        hardware: 'Cement augmentation of the vertebral body · no instrumentation modeled',
        fusion: false
      }),

      /* ---- Disc-indexed additions --------------------------------------- */
      pcoGrade1: Object.freeze({
        // Schwab grade 1: partial facet resection, ligamentum flavum preserved.
        // Only the facet capsule is divided, which is NOT in the posterior tension
        // band - this entry is exactly why membership, not list length, drives
        // that flag. Schwab states 5-10 deg per level; a measured series reported
        // 10.2. Prerequisite worth surfacing: anterior column mobility. Applied to
        // an ankylosed anterior column this becomes an opening wedge.
        name: 'Posterior column osteotomy · partial facet (Schwab grade 1)', region: 'thoracolumbar',
        type: 'osteotomy_post_g1', schwabGrade: 1, approachModifier: 'P',
        deltaAngle: 8, correctionMin: 0, correctionMax: 12,
        correctionProvenance: 'sourced_default_authoring_ceiling',
        effect: 'Adds modest segmental lordosing correction where the anterior column is mobile',
        hardware: 'Partial facet resection footprint · posterior screw/rod fusion construct',
        disruptsLigaments: Object.freeze(['facet_capsule']),
        fusion: true, defaultConstruct: 'posterior_osteotomy_plus_bilateral_screw_rod'
      }),
      acr: Object.freeze({
        // Anterior column realignment: a lateral interbody with deliberate
        // anterior longitudinal ligament release and a hyperlordotic cage. Kept as
        // its own entry rather than a ceiling bump on llif/xlif/olif, because
        // those do not include an ALL release and must not inherit this range.
        name: 'ACR (Anterior Column Realignment)', region: 'lumbar',
        type: 'lateral_cage_screws', interbodyApproach: 'llif',
        allowedLevels: Object.freeze(['L1-L2', 'L2-L3', 'L3-L4', 'L4-L5']),
        deltaAngle: 20, correctionMin: 0, correctionMax: 35,
        correctionProvenance: 'sourced_default_authoring_ceiling',
        effect: 'Large segmental lordosing correction via ALL release and a hyperlordotic cage',
        hardware: 'Hyperlordotic lateral interbody · posterior screw/rod construct required',
        disruptsLigaments: Object.freeze(['anterior_longitudinal_ligament']),
        fusion: true, mandatorySupplementalFixation: true,
        defaultConstruct: 'interbody_plus_bilateral_posterior_screw_rod'
      }),
      laminoplasty: Object.freeze({
        // Distinct from laminectomy precisely because it PRESERVES the posterior
        // tension band and the spinous processes; reusing laminectomy as a proxy
        // would wrongly raise the posterior-disruption flag. No angular
        // correction: it is a decompression, and pre-op kyphosis is a relative
        // contraindication rather than something it corrects.
        name: 'Laminoplasty (open-door)', region: 'cervical', type: 'decompression_motion_sparing',
        allowedLevels: Object.freeze(['C2-C3', 'C3-C4', 'C4-C5', 'C5-C6', 'C6-C7']),
        deltaAngle: 0, allowSignedCorrection: false, correctionMin: 0, correctionMax: 0,
        correctionProvenance: 'not_applicable',
        effect: 'Posterior decompression preserving the tension band; no modeled angular correction',
        hardware: 'Hinged laminar opening · no fusion construct modeled',
        fusion: false
      }),
      c1c2Fusion: Object.freeze({
        // The C1-C2 row already exists in LEVELS, so this stays disc-indexed. The
        // teaching payload is reciprocal: change in the O-C2 angle correlates
        // negatively with change in subaxial lordosis (r = -0.47), so fusing C1-C2
        // in too much lordosis drives subaxial kyphotic drift. The bounds are a
        // set parameter, not a correction extracted from a deformity, and are
        // unverified as clinical limits.
        name: 'C1–C2 posterior fusion (Harms / Magerl)', region: 'cervical',
        type: 'atlantoaxial_fusion', allowedLevels: Object.freeze(['C1-C2']),
        deltaAngle: 0, allowSignedCorrection: true, correctionMin: -20, correctionMax: 30,
        correctionProvenance: 'authoring_bounds_unverified',
        // Nothing in the engine applies the reciprocal subaxial change, so the
        // copy must not promise it. The entered angle is reported as a local
        // atlantoaxial rotation; C2-C7 is unchanged.
        effect: 'Sets the atlantoaxial angle as a local rotation; the reciprocal subaxial change reported in the literature is not modeled, so the C2–C7 angle is unchanged',
        hardware: 'Posterior atlantoaxial fixation · implant geometry withheld',
        disruptsLigaments: Object.freeze(['interspinous', 'supraspinous']),
        fusion: true
      }),
      lumbarTdr: Object.freeze({
        // Closes an internal asymmetry: cervical arthroplasty was modeled and
        // lumbar was not. The segmental lordosis effect is explicitly unverified
        // and deliberately NOT copied across from the cervical device, which is a
        // different implant at a different level with different biomechanics.
        name: 'Lumbar total disc replacement', region: 'lumbar', type: 'motion_disc',
        allowedLevels: Object.freeze(['L3-L4', 'L4-L5', 'L5-S1']),
        deltaAngle: 0, allowSignedCorrection: true, correctionMin: -10, correctionMax: 10,
        correctionProvenance: 'authoring_bounds_unverified',
        effect: 'Motion-preserving anterior reconstruction; segmental lordosis effect unverified',
        hardware: 'Lumbar motion disc · implant geometry withheld',
        fusion: false
      }),

      pedicleScrews: Object.freeze({
        name: 'Posterior pedicle screw–rod construct', region: 'thoracolumbar', deltaAngle: 0, type: 'posterior_screws',
        effect: 'Fixation only; no modeled angular change', hardware: 'Posterior rods · screws'
      }),
      s2aiFixation: Object.freeze({
        name: 'S2AI Pelvic Fixation', region: 'pelvis', deltaAngle: 0, type: 'pelvic_s2ai',
        effect: 'Adds modeled bilateral S2AI pelvic anchors; connection span is not inferred', hardware: 'Bilateral S2AI reference trajectories · rod connectors'
      }),
      iliacFixation: Object.freeze({
        name: 'Traditional Iliac Fixation', region: 'pelvis', deltaAngle: 0, type: 'pelvic_iliac',
        effect: 'Adds modeled bilateral iliac anchors; connection span is not inferred', hardware: 'Bilateral iliac screw trajectories · offset connectors'
      }),
      siFusion: Object.freeze({
        name: 'Bilateral trans-SI fixation (generic)', region: 'pelvis', deltaAngle: 0, type: 'si_fusion',
        effect: 'Adds a bilateral generic trans-SI fixation scenario using explicitly entered dimensions', hardware: 'Generic shaft envelopes only · no catalog claim, corridor assessment, or fit assessment'
      })
    });

    const freezeList = values => Object.freeze([...values]);
    const IMPLANT_CATALOG_REVISION = '2026-07-12';
    const IMPLANT_PLAN_SCHEMA_VERSION = 'implant-plan-v2';
    const CUSTOM_IMPLANT_DOMAINS = Object.freeze({
      labelLength: Object.freeze({ min: 1, max: 80 }),
      cageApMm: Object.freeze({ min: 4, max: 80 }),
      cageMlMm: Object.freeze({ min: 4, max: 100 }),
      cageHeightMm: Object.freeze({ min: 2, max: 40 }),
      cageAngleDeg: Object.freeze({ min: -30, max: 60 }),
      screwDiameterMm: Object.freeze({ min: 1.5, max: 16 }),
      screwLengthMm: Object.freeze({ min: 5, max: 200 }),
      rodDiameterMm: Object.freeze({ min: 2, max: 8 }),
      rodLengthMm: Object.freeze({ min: 10, max: 600 }),
      graftQuantityCc: Object.freeze({ min: 0.1, max: 250 })
    });
    const IMPLANT_CATALOGS = Object.freeze({
      cages: Object.freeze({
        hedron_c: Object.freeze({
          // Source audit 2026-07-27: the HEDRON C size matrix is not published
          // in any primary document I could reach. Product-level facts are
          // confirmed (HEDRON C exists, cervical, indicated C2-T1); the
          // individual footprint, height and lordosis values below are NOT.
          id: 'hedron_c', label: 'HEDRON C · ACDF', kind: 'fusion_cage', revision: 'product family confirmed; size matrix unverified',
          sourceUrl: 'https://www.globusmedical.com/hedron/',
          sourceVerification: 'dimensions_unverified_against_primary_matrix',
          footprints: freezeList([{ ap: 12, ml: 14 }, { ap: 14, ml: 16 }, { ap: 15, ml: 18 }]),
          heights: freezeList([5, 6, 7, 8, 9, 10, 11, 12]), lordosis: freezeList([0, 7, 12, 15, 20])
        }),
        mobi_c: Object.freeze({
          // Source audit 2026-07-27: the previously cited PMA number was wrong
          // (P110009 is a different device and that URL 404s). Mobi-C is P110002.
          // Heights corrected to the four published options — 4.5 mm was missing;
          // it has been available in Europe since 2006 and FDA-approved in 2023.
          // Footprint pairs remain UNVERIFIED against the manufacturer matrix:
          // the option count (7) matches published descriptions but the
          // individual depth x width values could not be confirmed from an
          // accessible primary source.
          id: 'mobi_c', label: 'Mobi-C · cervical arthroplasty', kind: 'arthroplasty', revision: 'FDA PMA P110002 labeling',
          sourceUrl: 'https://www.accessdata.fda.gov/cdrh_docs/pdf11/p110002c.pdf',
          sourceVerification: 'heights_and_option_count_verified_individual_footprints_unverified',
          footprints: freezeList([{ ap: 13, ml: 15 }, { ap: 14, ml: 15 }, { ap: 15, ml: 15 }, { ap: 13, ml: 17 }, { ap: 14, ml: 17 }, { ap: 15, ml: 17 }, { ap: 15, ml: 19 }]),
          heights: freezeList([4.5, 5, 6, 7]), lordosis: freezeList([0])
        }),
        hedron_t: Object.freeze({
          // Source audit 2026-07-27: size matrix not reachable in a primary
          // document. Note the height list skips 14 and 16 mm, which no source
          // supports — treat the whole list as provisional, not as a published
          // option set.
          id: 'hedron_t', label: 'HEDRON T · TLIF', kind: 'fusion_cage', revision: 'product family confirmed; size matrix unverified',
          sourceUrl: 'https://www.globusmedical.com/hedron/',
          sourceVerification: 'dimensions_unverified_against_primary_matrix',
          footprintConvention: 'app_AP_by_ML_mapped_from_manufacturer_width_by_length',
          footprints: freezeList([{ ap: 28, ml: 10 }, { ap: 33, ml: 11 }]),
          heights: freezeList([7, 8, 9, 10, 11, 12, 13, 15, 17]), lordosis: freezeList([8, 15])
        }),
        hedron_p: Object.freeze({
          // Source audit 2026-07-27, checked against the Globus HEDRON P
          // technique guide (rev B). The guide publishes widths 8/10/12 mm,
          // lengths 22/26/30 mm, heights 7-17 mm in 1 mm increments, and two
          // lordotic profiles at 8 and 15 degrees. The heights and lordosis
          // below reproduce that exactly. The width x length availability grid
          // is a figure in the guide and could not be read reliably, so the six
          // pairs below are a subset of the published width and length sets
          // rather than a confirmed option list.
          id: 'hedron_p', label: 'HEDRON P · PLIF', kind: 'fusion_cage', revision: 'Globus HEDRON P technique guide rev B',
          sourceUrl: 'https://www.globusmedical.com/hedron/',
          sourceVerification: 'heights_and_lordosis_verified_footprint_pairs_unverified',
          footprintConvention: 'app_AP_by_ML_mapped_from_manufacturer_width_by_length',
          footprints: freezeList([{ ap: 22, ml: 8 }, { ap: 22, ml: 10 }, { ap: 26, ml: 10 }, { ap: 30, ml: 10 }, { ap: 26, ml: 12 }, { ap: 30, ml: 12 }]),
          heights: freezeList([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]), lordosis: freezeList([8, 15])
        }),
        hedron_a: Object.freeze({
          // Source audit 2026-07-27: size matrix not reachable in a primary
          // document. One related published constraint IS confirmed and is
          // respected here: hyperlordotic interbodies (>= 25 deg) require
          // supplemental fixation, and the 20 deg ceiling below stays under it.
          id: 'hedron_a', label: 'HEDRON A · ALIF', kind: 'fusion_cage', revision: 'product family confirmed; size matrix unverified',
          sourceUrl: 'https://www.globusmedical.com/hedron/',
          sourceVerification: 'dimensions_unverified_against_primary_matrix',
          footprints: freezeList([{ ap: 22, ml: 29 }, { ap: 24, ml: 35 }, { ap: 28, ml: 39 }]),
          heights: freezeList([9, 11, 13, 15, 17, 19, 21]), lordosis: freezeList([8, 15, 20])
        }),
        hedron_l: Object.freeze({
          // Source audit 2026-07-27: only the 40-60 mm length range is published;
          // heights, lordosis and the discrete length steps are unverified. That
          // range is already recorded in publishedLengthRangeMm below.
          id: 'hedron_l', label: 'HEDRON L · LLIF / XLIF / OLIF', kind: 'fusion_cage', revision: 'published length range only; rest of matrix unverified',
          sourceUrl: 'https://www.globusmedical.com/hedron/',
          sourceVerification: 'length_range_verified_heights_lordosis_and_steps_unverified',
          footprintConvention: 'app_AP_width_by_ML_length; official page publishes a 40_to_60_mm_length_range_without_discrete_steps',
          footprints: freezeList([{ ap: 18, ml: 40 }, { ap: 18, ml: 60 }, { ap: 22, ml: 40 }, { ap: 22, ml: 60 }]),
          publishedLengthRangeMm: Object.freeze({ min: 40, max: 60, discreteIntermediateLengthsVerified: false }),
          heights: freezeList([7, 9, 11, 13, 15]), lordosis: freezeList([10, 15])
        })
      }),
      motionDevices: Object.freeze({
        tops_motion: Object.freeze({
          id: 'tops_motion',
          label: 'TOPS Motion Implant',
          kind: 'posterior_motion_device',
          revision: 'FDA PMA P220002 SSED, approved 2023-06-15 (dimensions not re-checked)',
          sourceVerification: 'cited_document_specific_dimensions_not_rechecked',
          sourceUrl: 'https://www.accessdata.fda.gov/cdrh_docs/pdf22/P220002B.pdf',
          materials: Object.freeze(['titanium endplates', 'polycarbonate urethane boot', 'PEEK ribbon', 'titanium and polycarbonate urethane internal articulating parts']),
          ipdConfigurations: freezeList([
            Object.freeze({ ipdMm: 21, armAngleDeg: 0 }),
            Object.freeze({ ipdMm: 30, armAngleDeg: 14 }),
            Object.freeze({ ipdMm: 38, armAngleDeg: 26 })
          ]),
          plateLengthConfigurations: freezeList([
            Object.freeze({ id: 'S', label: 'Short', topPlateLengthMm: 67, bottomPlateLengthMm: 73 }),
            Object.freeze({ id: 'M', label: 'Medium', topPlateLengthMm: 77, bottomPlateLengthMm: 83 }),
            Object.freeze({ id: 'L', label: 'Long', topPlateLengthMm: 87, bottomPlateLengthMm: 93 })
          ]),
          labeledDesignMotionLimitsDeg: Object.freeze({
            lateralBendingPerSide: 5,
            axialRotationPerSide: 1.5,
            flexion: 8,
            extension: 2
          }),
          sagittalTranslationDesign: 'blocked',
          dimensionStatus: 'rounded_reference_dimensions_from_fda_ssed_table_1',
          internalMechanismGeometryVerified: false
        })
      }),
      screws: Object.freeze({
        tops_pedicle: Object.freeze({
          id: 'tops_pedicle', label: 'TOPS polyaxial pedicle screws', revision: 'FDA PMA P220002 SSED (dimensions not re-checked)',
          sourceVerification: 'cited_document_specific_dimensions_not_rechecked',
          sourceUrl: 'https://www.accessdata.fda.gov/cdrh_docs/pdf22/P220002B.pdf',
          diameterLengths: Object.freeze({
            '5.5': freezeList([25, 30, 35, 40, 45, 50, 55, 60]),
            '6.5': freezeList([25, 30, 35, 40, 45, 50, 55, 60]),
            '7.5': freezeList([25, 30, 35, 40, 45, 50, 55, 60])
          }),
          rodDiameters: freezeList([]), rodLengths: freezeList([]),
          headGeometryVerified: false
        }),
        neon3_lms: Object.freeze({
          id: 'neon3_lms', label: 'neon³ lateral-mass', revision: 'brochure R06/2023-12 (dimensions not re-checked)',
          sourceVerification: 'cited_document_specific_dimensions_not_rechecked',
          sourceUrl: 'https://www.ulrichmedical.com/03-spinal-surgery/03-02-products/03-02-03-neon3/rod-screw-system-neon3-brochure-ws3900-en.pdf',
          diameterLengths: Object.freeze({ '3.5': freezeList([10, 12, 14, 16, 18, 20]), '4': freezeList([10, 12, 14, 16, 18, 20]) }),
          rodDiameters: freezeList([4]), rodLengths: freezeList([20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 120, 140, 160, 200, 240])
        }),
        neon3_pedicle: Object.freeze({
          id: 'neon3_pedicle', label: 'neon³ cervical pedicle', revision: 'brochure R06/2023-12 (dimensions not re-checked)',
          sourceVerification: 'cited_document_specific_dimensions_not_rechecked',
          sourceUrl: 'https://www.ulrichmedical.com/03-spinal-surgery/03-02-products/03-02-03-neon3/rod-screw-system-neon3-brochure-ws3900-en.pdf',
          diameterLengths: Object.freeze({ '4': freezeList([20, 22, 24, 26, 28, 30, 32, 34, 36]) }),
          rodDiameters: freezeList([4]), rodLengths: freezeList([20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 120, 140, 160, 200, 240])
        }),
        ucentum_pedicle: Object.freeze({
          id: 'ucentum_pedicle', label: 'uCentum thoracolumbar', revision: 'product line confirmed; size matrix unverified',
          sourceVerification: 'dimensions_unverified_against_primary_matrix',
          sourceUrl: 'https://www.ulrichmedical.com/03-spinal-surgery/03-02-products/03-02-04-ucentum/rod-screw-system-ucentum-ubase-brochure-ws-3800-en.pdf',
          diameterLengths: Object.freeze({
            '4.5': freezeList([25, 30, 35, 40, 45, 50]), '5.5': freezeList([25, 30, 35, 40, 45, 50, 55]),
            '6.5': freezeList([30, 35, 40, 45, 50, 55, 60]), '7.5': freezeList([35, 40, 45, 50, 55, 60]),
            '8.5': freezeList([35, 40, 45, 50, 55, 60]), '10': freezeList([45, 50, 55, 60]), '11.5': freezeList([45, 50, 55])
          }),
          rodDiameters: freezeList([5.5, 6]), rodLengths: freezeList([30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110, 120, 132, 144, 156, 168, 180, 200, 300, 400, 500])
        }),
        ubase_s2ai: Object.freeze({
          id: 'ubase_s2ai', label: 'uBase iliosacral / S2AI', revision: 'product line confirmed; size matrix unverified',
          sourceVerification: 'dimensions_unverified_against_primary_matrix',
          sourceUrl: 'https://www.ulrichmedical.com/03-spinal-surgery/03-02-products/03-02-04-ucentum/rod-screw-system-ucentum-ubase-brochure-ws-3800-en.pdf',
          diameterLengths: Object.freeze({ '7.5': freezeList([40, 50, 60, 70, 80]), '8.5': freezeList([40, 50, 60, 70, 80, 90, 100, 110, 120]), '10': freezeList([80, 90, 100, 110, 120, 130, 140]) }),
          rodDiameters: freezeList([5.5, 6]), rodLengths: freezeList([60, 65, 70, 75, 80, 85, 90, 95, 100, 110, 120, 132, 144, 156, 168, 180, 200])
        }),
        ubase_iliac: Object.freeze({
          id: 'ubase_iliac', label: 'uBase iliac', revision: 'product line confirmed; size matrix unverified',
          sourceVerification: 'dimensions_unverified_against_primary_matrix',
          sourceUrl: 'https://www.ulrichmedical.com/en/spinal-surgery/products/rod-screw-systems/ubase',
          diameterLengths: Object.freeze({ '8.5': freezeList([80, 90, 100, 110, 120]), '10': freezeList([80, 90, 100, 110, 120]) }),
          rodDiameters: freezeList([5.5, 6]), rodLengths: freezeList([80, 85, 90, 95, 100, 110, 120, 132, 144, 156, 168, 180, 200])
        })
      }),
      grafts: Object.freeze({
        // Source audit 2026-07-27: graft package volumes were not re-verified
        // against the GUDID records / manufacturer pages cited below. They are
        // consumable pack sizes only and do not feed any geometry or correction
        // maths, so an error here changes the shopping list, not the model.
        mastergraft_putty: Object.freeze({ id: 'mastergraft_putty', label: 'MASTERGRAFT Putty', sourceVerification: 'package_volumes_not_rechecked', volumesCc: freezeList([0.75, 1.5, 3, 6, 9]), sourceUrl: 'https://accessgudid.nlm.nih.gov/devices/search?filters%5BBrand+Name%5D%5B%5D=MASTERGRAFT%C2%AEPutty&filters%5BCompany+Name%5D%5B%5D=MEDTRONIC+SOFAMOR+DANEK%2C+INC.&page_size=30' }),
        vivigen: Object.freeze({ id: 'vivigen', label: 'ViviGen', sourceVerification: 'package_volumes_not_rechecked', volumesCc: freezeList([1, 5, 10, 15]), sourceUrl: 'https://lifenethealth.org/trauma-and-extremities/cellular-bone-matrix/vivigenr-vivigen-formabler' }),
        infuse: Object.freeze({ id: 'infuse', label: 'Infuse kit', sourceVerification: 'package_volumes_not_rechecked', volumesCc: freezeList([0.7, 1.4, 2.8, 5.6, 8]), sourceUrl: 'https://www.medtronic.com/xg-en/healthcare-professionals/products/spinal-orthopaedic/bone-grafting/infuse-bone-graft.html' })
      })
    });

    const PROCEDURE_IMPLANT_PROFILES = Object.freeze({
      acdf: Object.freeze({ cageCatalogIds: freezeList(['hedron_c']), graft: true, note: 'Catalog cage shown; plate geometry is withheld until a dimensioned catalog is integrated.' }),
      discReplacement: Object.freeze({ cageCatalogIds: freezeList(['mobi_c']), graft: false }),
      pcf: Object.freeze({ screwCatalogId: 'neon3_lms', graft: true }),
      occipitalFusion: Object.freeze({ unsupported: true, preserveNativeAnatomy: true, note: 'Occipital plate and connector dimensions are not present in the verified catalog; hardware geometry is withheld.' }),
      laminectomy: Object.freeze({ anatomyOnly: true, note: 'No implant or graft is modeled for isolated decompression.' }),
      tlifPlif: Object.freeze({ cageCatalogIds: freezeList(['hedron_t']), screwCatalogId: 'ucentum_pedicle', graft: true, interbodyApproach: 'tlif' }),
      plif: Object.freeze({ cageCatalogIds: freezeList(['hedron_p']), screwCatalogId: 'ucentum_pedicle', graft: true, interbodyApproach: 'plif' }),
      alif: Object.freeze({ cageCatalogIds: freezeList(['hedron_a']), screwCatalogId: 'ucentum_pedicle', graft: true, note: 'Catalog cage and posterior construct shown; no unverified generic anterior plate is rendered.' }),
      llif: Object.freeze({ cageCatalogIds: freezeList(['hedron_l']), screwCatalogId: 'ucentum_pedicle', graft: true, interbodyApproach: 'llif', note: 'HEDRON L catalog-width and published length-range endpoints are shown; approach corridor, psoas, plexus, vessels, and containment are not modeled.' }),
      xlif: Object.freeze({ cageCatalogIds: freezeList(['hedron_l']), screwCatalogId: 'ucentum_pedicle', graft: true, interbodyApproach: 'xlif', note: 'Transpsoas approach orientation is a display convention only; psoas, lumbar plexus, neuromonitoring, access corridor, and containment are not modeled.' }),
      olif: Object.freeze({ cageCatalogIds: freezeList(['hedron_l']), screwCatalogId: 'ucentum_pedicle', graft: true, interbodyApproach: 'olif', note: 'Oblique approach orientation is a display convention only; psoas, lumbar plexus, vessels, access corridor, and containment are not modeled.' }),
      tops: Object.freeze({
        motionCatalogId: 'tops_motion', screwCatalogId: 'tops_pedicle', graft: false,
        note: 'FDA-listed rounded reference configurations are rendered as an external component-topology model. The proprietary internal articulation, patient fit, screw corridors, and device eligibility are not reconstructed.'
      }),
      spo: Object.freeze({ screwCatalogId: 'ucentum_pedicle', graft: true }),
      pso: Object.freeze({ screwCatalogId: 'ucentum_pedicle', graft: true }),
      accf: Object.freeze({ anteriorColumnReconstruction: true, graft: true, note: 'A source-bounded reconstruction envelope is shown; no verified VBR or anterior plate catalog dimensions are claimed.' }),
      thoracolumbarCorpectomy: Object.freeze({ anteriorColumnReconstruction: true, screwCatalogId: 'ucentum_pedicle', graft: true, note: 'The VBR is a source-bounded defect envelope; the posterior screw/rod components use selected catalog dimensions.' }),
      osteotomyGrade4: Object.freeze({ screwCatalogId: 'ucentum_pedicle', graft: true, note: 'The proximal-disc and partial-body wedge is source-bounded; no cage is inferred unless separately authored.' }),
      vcr: Object.freeze({ anteriorColumnReconstruction: true, screwCatalogId: 'ucentum_pedicle', graft: true, note: 'The anterior reconstruction is a source-bounded defect envelope; posterior screw/rod components use selected catalog dimensions.' }),
      kyphoplasty: Object.freeze({ anatomyOnly: true, note: 'Cement is a source-bounded augmentation envelope; fill pattern, leakage, pressure, and material mechanics are not simulated.' }),
      pcoGrade1: Object.freeze({ screwCatalogId: 'ucentum_pedicle', graft: true }),
      acr: Object.freeze({ cageCatalogIds: freezeList(['hedron_l']), screwCatalogId: 'ucentum_pedicle', graft: true, interbodyApproach: 'llif', note: 'Catalog lateral-cage dimensions and posterior fixation are shown. ALL release and achieved correction remain authored scenario inputs.' }),
      laminoplasty: Object.freeze({ anatomyOnly: true, note: 'A source-bounded hinge and opening cut envelope is shown; plate geometry and patient-specific canal expansion are withheld.' }),
      c1c2Fusion: Object.freeze({ screwCatalogId: 'neon3_pedicle', graft: true, note: 'Catalog shaft dimensions use a generic atlantoaxial posterior-construct envelope; C1/C2 corridor safety and connector geometry are not validated.' }),
      lumbarTdr: Object.freeze({ unsupported: true, preserveNativeAnatomy: true, note: 'No verified lumbar arthroplasty device catalog is loaded. The native disc remains visible rather than leaving an unsupported postoperative void.' }),
      pedicleScrews: Object.freeze({ screwCatalogId: 'ucentum_pedicle', graft: false }),
      s2aiFixation: Object.freeze({ screwCatalogId: 'ubase_s2ai', graft: false }),
      iliacFixation: Object.freeze({ screwCatalogId: 'ubase_iliac', graft: false }),
      siFusion: Object.freeze({
        customScrewOnly: true, customRequired: true, customRodRequired: false, graft: false,
        note: 'No verified SI-joint fixation implant catalog is loaded. Enter a generic shaft diameter and length explicitly; no corridor, laterality-specific fit, fixation count, indication, or safety is assessed.'
      })
    });

    const PROCEDURE_VISUALIZATION_CONTRACTS = Object.freeze({
      acdf: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['fusion_cage']) }),
      discReplacement: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['arthroplasty']) }),
      pcf: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      occipitalFusion: Object.freeze({ mode: 'withheld', requiredPlanRoles: freezeList([]) }),
      laminectomy: Object.freeze({ mode: 'anatomy_only', requiredPlanRoles: freezeList([]) }),
      tlifPlif: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['fusion_cage', 'screw_set', 'rod_set']) }),
      plif: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['fusion_cage', 'screw_set', 'rod_set']) }),
      alif: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['fusion_cage']) }),
      llif: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['fusion_cage']) }),
      xlif: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['fusion_cage']) }),
      olif: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['fusion_cage']) }),
      tops: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['posterior_motion_device', 'screw_set']) }),
      spo: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      pso: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      accf: Object.freeze({ mode: 'geometry_envelope', requiredPlanRoles: freezeList([]) }),
      thoracolumbarCorpectomy: Object.freeze({ mode: 'geometry_envelope', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      osteotomyGrade4: Object.freeze({ mode: 'geometry_envelope', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      vcr: Object.freeze({ mode: 'geometry_envelope', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      kyphoplasty: Object.freeze({ mode: 'anatomy_only', requiredPlanRoles: freezeList([]) }),
      pcoGrade1: Object.freeze({ mode: 'geometry_envelope', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      acr: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['fusion_cage', 'screw_set', 'rod_set']) }),
      laminoplasty: Object.freeze({ mode: 'anatomy_only', requiredPlanRoles: freezeList([]) }),
      c1c2Fusion: Object.freeze({ mode: 'geometry_envelope', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      lumbarTdr: Object.freeze({ mode: 'withheld', requiredPlanRoles: freezeList([]) }),
      pedicleScrews: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      s2aiFixation: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      iliacFixation: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['screw_set', 'rod_set']) }),
      siFusion: Object.freeze({ mode: 'implemented', requiredPlanRoles: freezeList(['screw_set']) })
    });
    const missingVisualizationContracts = Object.keys(PROCEDURES)
      .filter(procedureId => !PROCEDURE_VISUALIZATION_CONTRACTS[procedureId]);
    if (missingVisualizationContracts.length) {
      throw new Error(`Missing procedure visualization contracts: ${missingVisualizationContracts.join(', ')}.`);
    }
    const OPTIONAL_POSTERIOR_FIXATION_PROCEDURES = Object.freeze(new Set(['alif', 'llif', 'xlif', 'olif']));

    const LEVEL_BY_ID = new Map(SURGICAL_TARGETS.map(level => [level.id, level]));
    const displayLevel = levelId => LEVEL_BY_ID.get(levelId)?.displayName || String(levelId).replace('-', '–');
    const CHAIN_LEVELS = [...LEVELS].reverse();

    /* Which motion segments does a target occupy?

       A motion segment occupies itself. A vertebral body occupies the two discs
       either side of it. The pelvis occupies none. Every consumer that used to
       compare `item.levelId === levelId` must compare SPANS instead, or a
       corpectomy at L4 will not be seen to conflict with an interbody at L4-L5.

       Invariant, asserted in the self-test: for two motion-segment targets,
       spansOverlap(a, b) === (a === b). That is what makes every one of the
       procedures that predate body targets behave identically after this change.

       Spans are precomputed and frozen because applyModelTargets and
       updateSurgicalVisibility call this per level per frame. */
    // Every target spans itself by default - including the pelvis, so its
    // existing identity-based conflict rules keep working. Only bodies span
    // something other than themselves.
    const SEGMENT_SPANS = new Map(SURGICAL_TARGETS.map(target => [target.id, Object.freeze([target.id])]));
    BODY_TARGETS.forEach(body => {
      SEGMENT_SPANS.set(body.id, Object.freeze([body.cranialSegmentId, body.caudalSegmentId]));
    });
    const EMPTY_SPAN = Object.freeze([]);
    const spannedSegmentIdsFor = targetId => SEGMENT_SPANS.get(targetId) || EMPTY_SPAN;
    const spansOverlap = (a, b) => a.some(id => b.includes(id));

    /* Where does a planned angular correction land in the reported numbers?

       The 3D chain poses every correction on the motion segments its target
       spans, split evenly (collectLocalCorrections). The engine used to credit
       a correction to its TARGET's metric region only, and a body at a junction
       (T12, L1, T1, C7, C2) has none, so a T12 VCR or an L1 extended PSO
       rotated the chain while TK, LL and PT stayed put. Crediting each spanned
       disc's share to that disc's own metric region makes the reported angles
       equal the posed ones; a share on a disc outside every regional Cobb is
       reported as a local junction (or upper-thoracic) rotation instead of
       vanishing. The even split is the display convention, not a claim about
       where a resected body's correction physically occurs. */
    const LOCAL_GROUP_LABELS = Object.freeze({
      occipitocervical: Object.freeze({ long: 'occipitocervical (C0–C1)', short: 'O–C1' }),
      atlantoaxial: Object.freeze({ long: 'atlantoaxial (C1–C2)', short: 'C1–C2' }),
      cervicothoracic: Object.freeze({ long: 'cervicothoracic-junction (C7–T1)', short: 'C7–T1 junction' }),
      upperThoracic: Object.freeze({ long: 'upper-thoracic (T1–T4, above the T4–T12 TK endpoints)', short: 'T1–T4 upper thoracic' }),
      thoracolumbar: Object.freeze({ long: 'thoracolumbar-junction (T12–L1)', short: 'T12–L1 junction' })
    });
    const SEGMENT_SHARE_TEMPLATES = new Map(SURGICAL_TARGETS.map(target => {
      const span = target.isChain === false ? EMPTY_SPAN : spannedSegmentIdsFor(target.id);
      return [target.id, Object.freeze(span.map(segmentId => {
        const segment = LEVEL_BY_ID.get(segmentId);
        return Object.freeze({
          segmentId,
          fraction: 1 / span.length,
          metricRegion: segment?.metricRegion ?? null,
          localGroup: segment?.metricRegion ? null : (segment?.localGroup ?? null)
        });
      }))];
    }));
    const correctionSharesFor = (targetId, correction) => Object.freeze(
      (SEGMENT_SHARE_TEMPLATES.get(targetId) || EMPTY_SPAN).map(template => Object.freeze({
        ...template,
        degrees: correction * template.fraction
      }))
    );
    // Itinerary wording for what a correction does to the reported numbers
    // (F089): positive corrections are lordosing, so they raise LL and CL but
    // LOWER TK. A local-only share is named as such instead of being labelled
    // with the anatomic region's metric.
    const describeCorrectionMetricEffect = (targetId, correction) => {
      const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(Number(value.toFixed(1)))}°`;
      const totals = new Map();
      correctionSharesFor(targetId, correction).forEach(share => {
        const key = share.metricRegion || share.localGroup;
        if (key) totals.set(key, (totals.get(key) || 0) + share.degrees);
      });
      if (!correction || !totals.size) return 'no reported angular change';
      const parts = [...totals].map(([key, degrees]) => key === 'lumbar' ? `LL ${signed(degrees)}`
        : key === 'cervical' ? `CL ${signed(degrees)}`
        : key === 'thoracic' ? `TK ${signed(-degrees)}`
        : `${LOCAL_GROUP_LABELS[key]?.short || key} ${signed(degrees)} local`);
      const anyMetric = [...totals.keys()].some(key => ['lumbar', 'cervical', 'thoracic'].includes(key));
      return `${parts.join(' · ')}${anyMetric ? '' : ' · not in CL, TK or LL'}`;
    };
    const targetKindOf = targetId => LEVEL_BY_ID.get(targetId)?.kind || 'motion_segment';
    // Augmentation and odontoid fixation are body-indexed but leave both discs
    // intact, so they must not trigger the anterior-column conflict rules.
    const consumesAdjacentDiscs = procedure => procedure?.consumesAdjacentDiscs !== false;
    const consumedDiscSegmentIdsFor = (procedure, targetId) => {
      const target = LEVEL_BY_ID.get(targetId);
      if (target?.kind !== 'vertebral_body') return spannedSegmentIdsFor(targetId);
      if (!consumesAdjacentDiscs(procedure)) return EMPTY_SPAN;
      if (procedure?.adjacentDiscResection === 'cranial') return Object.freeze([target.cranialSegmentId]);
      if (procedure?.adjacentDiscResection === 'caudal') return Object.freeze([target.caudalSegmentId]);
      return spannedSegmentIdsFor(targetId);
    };

    /* Not every ligament a procedure divides is part of the posterior tension
       band. Consumers used to test `disruptsLigaments.length > 0`, which is fine
       while every listed procedure happens to be a posterior one — but it makes
       any anterior or capsule-only entry (a corpectomy dividing the ALL/PLL, a
       grade-1 facetectomy taking only the capsule) read as a posterior column
       disruption: it would raise the unspanned-disruption construct flag and
       visually cut the interspinous and supraspinous ligaments in the 3D view.
       Membership in this set, not list length, is what those consumers mean. */
    const POSTERIOR_TENSION_BAND_LIGAMENTS = Object.freeze(new Set([
      'interspinous', 'supraspinous', 'posterior_ligament_complex'
    ]));
    const disruptsPosteriorTensionBand = procedure =>
      (procedure?.disruptsLigaments || []).some(ligament => POSTERIOR_TENSION_BAND_LIGAMENTS.has(ligament));

    /* Anatomy Lab state is deliberately separate from the alignment calculator.
       Sign conventions are display coordinates: positive coronal/lateral values
       are patient-right, positive AP values are anterior, and positive sagittal
       wedge values are flexion/kyphotic. These are geometry inputs, not findings. */
    const ANATOMY_LEVEL_IDS = Object.freeze(LEVELS.map(level => level.id));
    const MORPHOLOGY_VARIANTS = Object.freeze(['typical', 'hemivertebra-left', 'hemivertebra-right', 'butterfly', 'block-fused', 'transitional']);
    const createDefaultGlobalDeformity = () => ({
      preset: 'neutral',
      coronalProfileId: null,
      coronalMagnitude: 0,
      coronalDirection: 'right',
      axialRotation: 0,
      compensatoryCobb: 0,
      secondaryFlexibility: 0,
      pelvicObliquity: 0,
      trunkShift: 0,
      cervicalSva: 20,
      t1Slope: 28,
      cbva: 5,
      hipFlexion: 0,
      kneeFlexion: 0,
      ankleFlexion: 0,
      pelvicShift: 0,
      lowerExtremitiesVisible: true
    });
    const createDefaultLevelFactor = () => ({
      discHeightLoss: 0,
      sagittalWedge: 0,
      coronalWedge: 0,
      axialRotation: 0,
      apTranslation: 0,
      lateralTranslation: 0,
      facetHypertrophy: 0,
      osteophyteBurden: 0,
      morphologyVariant: 'typical',
      bodyWidthScale: 1,
      bodyDepthScale: 1,
      pedicleScale: 1,
      canalScale: 1
    });
    const createDefaultLevelFactors = () => Object.fromEntries(ANATOMY_LEVEL_IDS.map(levelId => [levelId, createDefaultLevelFactor()]));

    const defineDeformityPreset = ({ description, alignment = {}, global = {}, levels = {} }) => Object.freeze({
      description,
      alignment: Object.freeze({ ...alignment }),
      global: Object.freeze({ ...global }),
      levels: Object.freeze(Object.fromEntries(
        Object.entries(levels).map(([levelId, factors]) => [levelId, Object.freeze({ ...factors })])
      ))
    });

    const DEFORMITY_PRESETS = Object.freeze({
      neutral: defineDeformityPreset({
        // PT 22° is the source CT subject's pose, which the SRS–Schwab PT band
        // grades '+'. It is kept because the 3D atlas is calibrated to it; the
        // description says so instead of implying a normative pelvis.
        description: 'Source-pose reference values with no authored three-plane deformity. PT 22° is the source CT pose (SRS–Schwab PT band +), not a normative target. This is not a normality determination.',
        alignment: { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22, measuredSva: null },
        global: { cervicalSva: 20, t1Slope: 28, cbva: 5 }
      }),
      'reference-roussouly-3': defineDeformityPreset({
        description: 'Roussouly type 3 reference morphology seed: sacral slope 39° (PI 52° minus PT 13°). Reference pattern only; not a target.',
        alignment: { pi: 52, ll: 58, tk: 42, cl: 18, pt: 13, measuredSva: 0 },
        global: { cervicalSva: 20, t1Slope: 28, cbva: 5 }
      }),
      'moderate-positive-sagittal': defineDeformityPreset({
        description: 'Authored SRS–Schwab + band demonstration: PI–LL 15°, PT 25° and C7 SVA 7.0 cm. Classification example only.',
        alignment: { pi: 52, ll: 37, tk: 40, cl: 25, pt: 25, measuredSva: 7 },
        global: { cervicalSva: 35, t1Slope: 32, cbva: 5 }
      }),
      flatback: defineDeformityPreset({
        description: 'Authored marked positive-sagittal pattern: PI–LL 25°, PT 32° and C7 SVA 11.0 cm, with separately editable disc-height loss.',
        alignment: { pi: 52, ll: 27, tk: 30, cl: 30, pt: 32, measuredSva: 11 },
        global: { cervicalSva: 45, t1Slope: 35, cbva: 5 },
        levels: {
          'L1-L2': { discHeightLoss: 10 }, 'L2-L3': { discHeightLoss: 18 },
          'L3-L4': { discHeightLoss: 28 }, 'L4-L5': { discHeightLoss: 42, facetHypertrophy: 25 },
          'L5-S1': { discHeightLoss: 52, facetHypertrophy: 30 }
        }
      }),
      'thoracic-hyperkyphosis': defineDeformityPreset({
        description: 'T4–T12-style thoracic kyphosis display seed at 65° with compensatory cervical/lumbar inputs. Etiology is intentionally unspecified.',
        alignment: { pi: 52, ll: 58, tk: 65, cl: 28, pt: 22, measuredSva: 4 },
        global: { cervicalSva: 35, t1Slope: 35, cbva: 8 }
      }),
      'cervical-kyphosis': defineDeformityPreset({
        description: 'Signed C2–C7 kyphosis seed (CL −20°) with cSVA 60 mm, CBVA +15° and T1S−CL 45°. Not a correction target.',
        alignment: { pi: 52, ll: 48, tk: 42, cl: -20, pt: 22, measuredSva: null },
        global: { cervicalSva: 60, t1Slope: 25, cbva: 15 },
        levels: {
          'C3-C4': { discHeightLoss: 12 }, 'C4-C5': { discHeightLoss: 22 },
          'C5-C6': { discHeightLoss: 28 }, 'C6-C7': { discHeightLoss: 18 }
        }
      }),
      'cervicothoracic-malalignment': defineDeformityPreset({
        description: 'Cervicothoracic positive-malalignment seed with CL 0°, T1 slope 40°, cSVA 85 mm and CBVA +20°.',
        alignment: { pi: 52, ll: 48, tk: 60, cl: 0, pt: 22, measuredSva: null },
        global: { cervicalSva: 85, t1Slope: 40, cbva: 20 }
      }),
      'degenerative-scoliosis': defineDeformityPreset({
        description: 'Authored lumbar-major coronal asymmetry with independent axial rotation and asymmetric multilevel degeneration controls; not a measured Cobb reconstruction.',
        alignment: { pi: 52, ll: 37, tk: 40, cl: 18, pt: 25, measuredSva: 6 },
        global: { coronalMagnitude: 32, coronalDirection: 'right', coronalProfileId: 'degenerative-scoliosis', axialRotation: 10, pelvicObliquity: 4, trunkShift: 26, cervicalSva: 30, t1Slope: 28, cbva: 5 },
        levels: {
          'L1-L2': { discHeightLoss: 24, osteophyteBurden: 25 },
          'L2-L3': { discHeightLoss: 42, lateralTranslation: 3, facetHypertrophy: 32, osteophyteBurden: 45 },
          'L3-L4': { discHeightLoss: 58, sagittalWedge: 3, apTranslation: 2, lateralTranslation: 5, facetHypertrophy: 48, osteophyteBurden: 58 },
          'L4-L5': { discHeightLoss: 46, sagittalWedge: 4, lateralTranslation: 3, facetHypertrophy: 52, osteophyteBurden: 54 }
        }
      }),
      'thoracic-major-curve': defineDeformityPreset({
        description: 'SRS–Schwab thoracic-major curve-family display seed (>30°) with authored, independently editable axial rotation.',
        alignment: { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22, measuredSva: 2 },
        global: { coronalMagnitude: 40, coronalDirection: 'right', coronalProfileId: 'thoracic-major-curve', axialRotation: 12, cervicalSva: 20, t1Slope: 28, cbva: 5 },
        levels: {
          'T5-T6': { coronalWedge: 4, axialRotation: 5 },
          'T6-T7': { coronalWedge: 6, axialRotation: 9 },
          'T7-T8': { coronalWedge: 6, axialRotation: 12 },
          'T8-T9': { coronalWedge: 4, axialRotation: 8 }
        }
      }),
      'double-major-curve': defineDeformityPreset({
        description: 'Opposed thoracic and thoracolumbar/lumbar curve-family seed. Display bends and rotations are authored inputs, not measured Cobb-to-rotation inference.',
        alignment: { pi: 52, ll: 50, tk: 42, cl: 18, pt: 18, measuredSva: 2 },
        global: { coronalMagnitude: 40, coronalDirection: 'right', coronalProfileId: 'double-major-curve', axialRotation: 0, cervicalSva: 20, t1Slope: 28, cbva: 5 },
        levels: {
          'T6-T7': { axialRotation: 6 }, 'T7-T8': { axialRotation: 12 }, 'T8-T9': { axialRotation: 8 },
          'L1-L2': { axialRotation: -6 }, 'L2-L3': { axialRotation: -10 }, 'L3-L4': { axialRotation: -6 }
        }
      }),
      'cervical-coronal-curve': defineDeformityPreset({
        description: 'Ames S-descriptor reference pattern with an authored C2–C7 coronal bend above 15° and independent axial rotation. Not a diagnosis.',
        alignment: { pi: 52, ll: 48, tk: 42, cl: 10, pt: 22, measuredSva: null },
        global: { coronalProfileId: 'cervical-coronal-curve', cervicalSva: 30, t1Slope: 25, cbva: 5 },
        levels: {
          'C2-C3': { coronalWedge: 3, axialRotation: 2 }, 'C3-C4': { coronalWedge: 5, axialRotation: 5 },
          'C4-C5': { coronalWedge: 5, axialRotation: 8 }, 'C5-C6': { coronalWedge: 4, axialRotation: 5 },
          'C6-C7': { coronalWedge: 3, axialRotation: 2 }
        }
      }),
      'junctional-kyphosis': defineDeformityPreset({
        description: 'Focal T11–L2 junctional kyphosis geometry seed. The focal wedge values are editable display inputs, not an etiology or risk estimate.',
        alignment: { pi: 52, ll: 40, tk: 55, cl: 18, pt: 25, measuredSva: 5 },
        global: { cervicalSva: 30, t1Slope: 30, cbva: 5 },
        levels: {
          'T11-T12': { sagittalWedge: 4 },
          'T12-L1': { sagittalWedge: 11, discHeightLoss: 25 },
          'L1-L2': { sagittalWedge: 4, discHeightLoss: 12 }
        }
      })
    });

    const defineCaseExample = ({
      id, label, category, region, description, basePresetId = 'neutral',
      alignment = {}, global = {}, levels = {}, assumptions = {}, focusLevelId = null,
      featureTags = [], reportedContext = {}, limitations = []
    }) => Object.freeze({
      id, label, category, region, description, basePresetId,
      alignment: Object.freeze({ ...alignment }),
      global: Object.freeze({ ...global }),
      levels: Object.freeze(Object.fromEntries(
        Object.entries(levels).map(([levelId, factors]) => [levelId, Object.freeze({ ...factors })])
      )),
      assumptions: Object.freeze({ ...assumptions }),
      focusLevelId,
      featureTags: Object.freeze(featureTags.map(tag => Object.freeze({ ...tag }))),
      reportedContext: Object.freeze({ ...reportedContext }),
      limitations: Object.freeze([...limitations])
    });

    const CASE_EXAMPLES = Object.freeze(Object.fromEntries([
      defineCaseExample({ id: 'neutral-reference', label: 'Neutral reference', category: 'reference', region: 'global', basePresetId: 'neutral', description: DEFORMITY_PRESETS.neutral.description, featureTags: [{ id: 'reference', label: 'Reference pose', status: 'authored_display' }] }),
      defineCaseExample({ id: 'roussouly-reference', label: 'Roussouly type 3 reference pattern', category: 'reference', region: 'global', basePresetId: 'reference-roussouly-3', description: DEFORMITY_PRESETS['reference-roussouly-3'].description, featureTags: [{ id: 'shape-reference', label: 'Shape reference', status: 'authored_display' }] }),
      defineCaseExample({ id: 'moderate-positive-sagittal', label: 'Moderate positive sagittal pattern', category: 'alignment', region: 'global', basePresetId: 'moderate-positive-sagittal', description: DEFORMITY_PRESETS['moderate-positive-sagittal'].description, featureTags: [{ id: 'sagittal', label: 'Sagittal inputs', status: 'authored_display' }] }),
      defineCaseExample({ id: 'flatback', label: 'Marked flatback with lumbar collapse', category: 'alignment', region: 'lumbar', basePresetId: 'flatback', description: DEFORMITY_PRESETS.flatback.description, focusLevelId: 'L4-L5', featureTags: [{ id: 'flatback', label: 'Flatback pattern', status: 'authored_display' }, { id: 'disc-collapse', label: 'Disc-height loss factors', status: 'authored_display' }] }),
      defineCaseExample({ id: 'thoracic-hyperkyphosis', label: 'Thoracic hyperkyphosis pattern', category: 'thoracic', region: 'thoracic', basePresetId: 'thoracic-hyperkyphosis', description: DEFORMITY_PRESETS['thoracic-hyperkyphosis'].description, focusLevelId: 'T7-T8', featureTags: [{ id: 'thoracic-kyphosis', label: 'Thoracic angle input', status: 'authored_display' }] }),
      defineCaseExample({ id: 'cervical-kyphosis', label: 'Cervical kyphosis pattern', category: 'cervical', region: 'cervical', basePresetId: 'cervical-kyphosis', description: DEFORMITY_PRESETS['cervical-kyphosis'].description, focusLevelId: 'C5-C6', featureTags: [{ id: 'cervical-angle', label: 'Signed cervical angle', status: 'authored_display' }, { id: 'cervical-collapse', label: 'Disc-height loss factors', status: 'authored_display' }] }),
      defineCaseExample({ id: 'cervicothoracic-malalignment', label: 'Cervicothoracic positive malalignment', category: 'cervical', region: 'cervicothoracic', basePresetId: 'cervicothoracic-malalignment', description: DEFORMITY_PRESETS['cervicothoracic-malalignment'].description, featureTags: [{ id: 'cervical-context', label: 'cSVA/T1 slope/CBVA inputs', status: 'authored_display' }] }),
      defineCaseExample({ id: 'degenerative-scoliosis', label: 'Adult degenerative lumbar scoliosis', category: 'deformity', region: 'lumbar', basePresetId: 'degenerative-scoliosis', description: DEFORMITY_PRESETS['degenerative-scoliosis'].description, focusLevelId: 'L3-L4', featureTags: [{ id: 'coronal', label: 'Coronal bend surrogate', status: 'authored_display' }, { id: 'degeneration', label: 'Multilevel degeneration factors', status: 'authored_display' }] }),
      defineCaseExample({ id: 'thoracic-major-curve', label: 'Thoracic-major curve pattern', category: 'deformity', region: 'thoracic', basePresetId: 'thoracic-major-curve', description: DEFORMITY_PRESETS['thoracic-major-curve'].description, focusLevelId: 'T7-T8', featureTags: [{ id: 'thoracic-curve', label: 'Thoracic-major surrogate', status: 'authored_display' }] }),
      defineCaseExample({ id: 'double-major-curve', label: 'Double-major curve pattern', category: 'deformity', region: 'global', basePresetId: 'double-major-curve', description: DEFORMITY_PRESETS['double-major-curve'].description, featureTags: [{ id: 'double-major', label: 'Opposed curve surrogates', status: 'authored_display' }] }),
      defineCaseExample({ id: 'cervical-coronal-curve', label: 'Cervical coronal curve pattern', category: 'cervical', region: 'cervical', basePresetId: 'cervical-coronal-curve', description: DEFORMITY_PRESETS['cervical-coronal-curve'].description, focusLevelId: 'C4-C5', featureTags: [{ id: 'cervical-coronal', label: 'Cervical coronal factors', status: 'authored_display' }] }),
      defineCaseExample({ id: 'junctional-kyphosis', label: 'Thoracolumbar junctional kyphosis', category: 'thoracic', region: 'thoracolumbar', basePresetId: 'junctional-kyphosis', description: DEFORMITY_PRESETS['junctional-kyphosis'].description, focusLevelId: 'T12-L1', featureTags: [{ id: 'junctional', label: 'Focal junctional wedge', status: 'authored_display' }] }),
      defineCaseExample({
        id: 'cervical-degeneration', label: 'Multilevel cervical degeneration factors', category: 'cervical', region: 'cervical',
        description: 'Authored C4-C7 disc-height loss, osteophyte, facet-enlargement, and canal-envelope factors. These are display screens, not a stenosis grade or diagnosis.', focusLevelId: 'C5-C6',
        levels: {
          'C4-C5': { discHeightLoss: 24, facetHypertrophy: 22, osteophyteBurden: 30, canalScale: .88 },
          'C5-C6': { discHeightLoss: 46, facetHypertrophy: 42, osteophyteBurden: 55, canalScale: .74 },
          'C6-C7': { discHeightLoss: 34, facetHypertrophy: 30, osteophyteBurden: 42, canalScale: .82 }
        },
        featureTags: [{ id: 'cervical-degeneration', label: 'Degeneration factors', status: 'authored_display' }, { id: 'stenosis', label: 'Neural compression', status: 'unmodeled' }]
      }),
      defineCaseExample({
        id: 'lumbar-degeneration', label: 'Multilevel lumbar degeneration factors', category: 'lumbar', region: 'lumbar',
        description: 'Authored L2-S1 asymmetric disc-height loss, facet enlargement, osteophyte, and canal-envelope factors. Symptoms and neural compression are not inferred.', focusLevelId: 'L4-L5',
        alignment: { ll: 35, pt: 27, measuredSva: 5 },
        levels: {
          'L2-L3': { discHeightLoss: 24, facetHypertrophy: 20, osteophyteBurden: 30, canalScale: .90 },
          'L3-L4': { discHeightLoss: 42, sagittalWedge: 2, facetHypertrophy: 38, osteophyteBurden: 48, canalScale: .78 },
          'L4-L5': { discHeightLoss: 58, sagittalWedge: 4, lateralTranslation: 3, facetHypertrophy: 55, osteophyteBurden: 65, canalScale: .68 },
          'L5-S1': { discHeightLoss: 48, facetHypertrophy: 44, osteophyteBurden: 54, canalScale: .76 }
        },
        featureTags: [{ id: 'lumbar-degeneration', label: 'Multilevel degeneration factors', status: 'authored_display' }, { id: 'neural', label: 'Symptoms/neural compression', status: 'unmodeled' }]
      }),
      defineCaseExample({
        id: 'l4-l5-translation', label: 'L4-L5 translation and narrowing factors', category: 'lumbar', region: 'lumbar',
        description: 'L4-L5 anterior-translation, collapse, facet-enlargement, and canal-envelope inputs. This does not assign a slip grade, dynamic instability, or stenosis diagnosis.', focusLevelId: 'L4-L5',
        alignment: { ll: 42, pt: 25, measuredSva: 4 },
        levels: { 'L4-L5': { discHeightLoss: 52, apTranslation: 6, facetHypertrophy: 58, osteophyteBurden: 44, canalScale: .66 } },
        featureTags: [{ id: 'translation', label: 'AP translation input', status: 'authored_display' }, { id: 'instability', label: 'Dynamic instability', status: 'unmodeled' }]
      }),
      defineCaseExample({
        id: 'compensated-thoracolumbar', label: 'Compensated thoracolumbar curve', category: 'deformity', region: 'global',
        description: 'Primary and secondary curve inputs with a user-declared 65% secondary flexibility. The modeled response is enabled explicitly and remains a bounded display assumption.',
        alignment: { ll: 44, tk: 48, pt: 24, measuredSva: 3 },
        global: { coronalMagnitude: 48, coronalDirection: 'right', coronalProfileId: 'compensated-thoracolumbar', compensatoryCobb: 30, secondaryFlexibility: .65, axialRotation: 14, trunkShift: 24, pelvicObliquity: 3 },
        assumptions: { applyCoronalCompensation: true }, focusLevelId: 'T12-L1',
        featureTags: [{ id: 'primary-curve', label: 'Primary curve input', status: 'authored_display' }, { id: 'secondary-flexibility', label: 'Declared secondary flexibility', status: 'authored_display' }],
        limitations: ['Flexibility is supplied by the example; it is not inferred from age, bending films, CT, degeneration, or treatment.']
      }),
      defineCaseExample({
        id: 'thoracic-wedge-variant', label: 'Focal unilateral thoracic wedge proportion', category: 'variant', region: 'thoracic',
        description: 'A schematic unilateral T10 proportion with local coronal wedge and rotation. This is not reconstructed congenital topology or a verified hemivertebra diagnosis.', focusLevelId: 'T10-T11',
        levels: { 'T10-T11': { morphologyVariant: 'hemivertebra-right', coronalWedge: 14, axialRotation: 8, bodyWidthScale: .78 } },
        featureTags: [{ id: 'wedge-variant', label: 'Schematic morphology transform', status: 'authored_display' }, { id: 'congenital-diagnosis', label: 'Congenital diagnosis', status: 'unmodeled' }]
      }),
      defineCaseExample({
        id: 'lumbosacral-transitional', label: 'Lumbosacral transitional proportion', category: 'variant', region: 'lumbosacral',
        description: 'A schematic L5-S1 transitional proportion. Enumeration, Castellvi type, articulation, and patient-specific anatomy remain unverified.', focusLevelId: 'L5-S1',
        levels: { 'L5-S1': { morphologyVariant: 'transitional', bodyWidthScale: 1.12 } },
        featureTags: [{ id: 'transitional', label: 'Transitional proportion', status: 'authored_display' }, { id: 'enumeration', label: 'Verified enumeration', status: 'unmodeled' }]
      }),
      defineCaseExample({
        id: 'cervical-block-variant', label: 'Cervical block-vertebra proportion', category: 'variant', region: 'cervical',
        description: 'A schematic C4-C5 block-fused proportion with a collapsed disc envelope. It is not a reconstructed congenital fusion, segmentation, or level-numbering result.', focusLevelId: 'C4-C5',
        levels: { 'C4-C5': { morphologyVariant: 'block-fused', discHeightLoss: 92, bodyWidthScale: 1.05 } },
        featureTags: [{ id: 'block-variant', label: 'Block-fused proportion', status: 'authored_display' }, { id: 'topology', label: 'True fused topology', status: 'unmodeled' }]
      }),
      defineCaseExample({
        id: 'reported-low-bone-quality', label: 'Reported low bone-quality context', category: 'context', region: 'global',
        description: 'Context-only example for a reported low bone-quality concern. Geometry, opacity, screw purchase, stress, loosening, fracture, and failure probability are intentionally unchanged.',
        reportedContext: { boneQuality: 'reported_low_unquantified' },
        featureTags: [{ id: 'bone-quality', label: 'Reported low bone quality', status: 'context_only' }, { id: 'mechanics', label: 'Strength/failure output', status: 'unmodeled' }]
      })
    ].map(example => [example.id, example])));

    const CASE_ALIGNMENT_LIMITS = Object.freeze({
      pi: [30, 80], ll: [10, 80], tk: [10, 70], cl: [-50, 80], pt: [5, 45], measuredSva: [-30, 30]
    });
    const CASE_LEVEL_LIMITS = Object.freeze({
      discHeightLoss: [0, 95], sagittalWedge: [-25, 25], coronalWedge: [-25, 25], axialRotation: [-45, 45],
      apTranslation: [-15, 15], lateralTranslation: [-15, 15], facetHypertrophy: [0, 100], osteophyteBurden: [0, 100],
      bodyWidthScale: [.5, 1.5], bodyDepthScale: [.5, 1.5], pedicleScale: [.5, 1.5], canalScale: [.5, 1.5]
    });

    function resolveCaseExampleSeed(caseId) {
      const example = CASE_EXAMPLES[caseId];
      if (!example) throw new RangeError(`Unknown example case: ${caseId}`);
      const preset = DEFORMITY_PRESETS[example.basePresetId];
      if (!preset) throw new RangeError(`Unknown example base preset: ${example.basePresetId}`);
      const params = { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22, measuredSva: null, ...preset.alignment, ...example.alignment };
      const globalDeformity = { ...createDefaultGlobalDeformity(), ...preset.global, ...example.global, preset: example.basePresetId };
      const levelFactors = createDefaultLevelFactors();
      [preset.levels, example.levels].forEach(source => Object.entries(source).forEach(([levelId, patch]) => {
        if (!levelFactors[levelId]) throw new RangeError(`Unknown example level: ${levelId}`);
        levelFactors[levelId] = { ...levelFactors[levelId], ...patch };
      }));
      return {
        example,
        params,
        globalDeformity,
        levelFactors,
        assumptions: { applyReciprocalResponse: true, applyCoronalCompensation: false, ...example.assumptions },
        provenance: { measuredSva: Number.isFinite(params.measuredSva) ? 'authored_example_case' : 'not_provided' }
      };
    }

    function validateCaseExampleSeed(seed) {
      if (!seed?.example || !CASE_EXAMPLES[seed.example.id]) return false;
      for (const [key, limits] of Object.entries(CASE_ALIGNMENT_LIMITS)) {
        const value = seed.params[key];
        if (key === 'measuredSva' && value === null) continue;
        if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) return false;
      }
      for (const [levelId, factors] of Object.entries(seed.levelFactors || {})) {
        if (!ANATOMY_LEVEL_IDS.includes(levelId) || !MORPHOLOGY_VARIANTS.includes(factors.morphologyVariant)) return false;
        if (Object.keys(factors).some(key => key !== 'morphologyVariant' && !Object.prototype.hasOwnProperty.call(CASE_LEVEL_LIMITS, key))) return false;
        for (const [key, limits] of Object.entries(CASE_LEVEL_LIMITS)) {
          if (!Object.prototype.hasOwnProperty.call(factors, key)) continue;
          const value = factors[key];
          if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) return false;
        }
      }
      return typeof seed.assumptions.applyReciprocalResponse === 'boolean'
        && typeof seed.assumptions.applyCoronalCompensation === 'boolean';
    }

    const PATIENT_IMAGING_MODEL = Object.freeze({
      schema: 'patient-imaging-intake/v2',
      privacyMode: 'local_ephemeral_deidentified_research_only',
      networkTransferEnabled: false,
      persistenceEnabled: false,
      cloudWorkspaceEnabled: false,
      maxSessionBytes: 2 * 1024 * 1024 * 1024,
      representations: Object.freeze({
        radiographs: Object.freeze({ source: 'standing_pair', capability: 'experimental_local_auto_landmark_plus_reviewed_measurement_transfer', exactBoneGeometry: false, clinicalValidation: false }),
        ct: Object.freeze({ source: 'ct_series', capability: 'segmentation_qa_required', standingAlignment: false }),
        hybrid: Object.freeze({ source: 'standing_pair_plus_ct', capability: 'per_vertebra_registration_required', recommended: true })
      }),
      disabledUntilValidated: Object.freeze(['patient_specific_mesh', 'screw_corridor', 'implant_fit', 'osteotomy_cut', 'navigation', 'finite_element_outputs', 'construct_recommendation'])
    });

    const CONSTRUCT_EVIDENCE_SOURCES = Object.freeze({
      alifPosteriorRegistry: Object.freeze({
        label: 'ALIF with/without posterior fixation · 1,377-patient registry',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37875244/',
        studyDesign: 'retrospective multicenter registry cohort',
        population: 'primary L4–S1 ALIF for degenerative lumbar pathology',
        supportedClaim: 'Posterior fixation is common and was associated with lower operative nonunion; stand-alone ALIF remains a selected construct.',
        limitation: 'Does not select treatment for an individual patient or establish immediate segmental motion.'
      }),
      lateralThreePlane: Object.freeze({
        label: 'LIF plus posterior fixation · three-plane correction study',
        url: 'https://pubmed.ncbi.nlm.nih.gov/31440649/',
        studyDesign: 'small clinical three-dimensional imaging cohort',
        population: 'adult degenerative scoliosis treated with lateral interbody fusion and posterior fixation',
        supportedClaim: 'Observed mean per-level changes included coronal, lordotic, and axial components.',
        limitation: 'Small cohort averages are broad scenario priors, not achieved-correction predictions.'
      }),
      lateralMetaAnalysis: Object.freeze({
        label: 'LLIF plus posterior fusion · ASD meta-analysis',
        url: 'https://pubmed.ncbi.nlm.nih.gov/35442824/',
        studyDesign: 'systematic review and meta-analysis',
        population: 'adult spinal deformity cohorts',
        supportedClaim: 'Lateral interbody reconstruction with posterior fusion can affect sagittal and coronal alignment.',
        limitation: 'Heterogeneous observational evidence with approach-specific complications.'
      }),
      osteotomyCorrection: Object.freeze({
        label: 'Corrective osteotomy review · SPO and PSO ranges',
        url: 'https://pubmed.ncbi.nlm.nih.gov/18978421/',
        studyDesign: 'clinical review',
        population: 'spinal deformity correction',
        supportedClaim: 'Approximate educational priors are about 10° per SPO level and 30°–40° per PSO level.',
        limitation: 'Correction depends on rigidity, disc mobility, level, technique, and construct; the app does not measure these.'
      }),
      cervicalOsteotomy: Object.freeze({
        label: 'Cervical deformity osteotomy comparison',
        url: 'https://pubmed.ncbi.nlm.nih.gov/25394319/',
        studyDesign: 'retrospective cervical deformity cohort',
        population: 'patients undergoing cervical deformity osteotomies',
        supportedClaim: 'Anterior, posterior, and combined strategies provide different correction patterns.',
        limitation: 'Level-IV evidence; this app does not model neurologic decompression, approach feasibility, or true rigidity.'
      }),
      cervicalApproachComparison: Object.freeze({
        label: 'Adult cervical deformity fusion approaches · national cohort',
        url: 'https://pubmed.ncbi.nlm.nih.gov/32875897/',
        studyDesign: 'retrospective administrative-database cohort',
        population: 'multilevel anterior, posterior, and circumferential fusion for adult cervical deformity',
        supportedClaim: 'Approach groups differed in complication, readmission, reoperation, and cost profiles.',
        limitation: 'Selection bias and absent deformity severity, flexibility, levels, neurologic findings, and indication prevent patient-level approach selection.'
      }),
      misdef2: Object.freeze({
        label: 'MISDEF2 extent-of-fusion outcomes study',
        url: 'https://pubmed.ncbi.nlm.nih.gov/35000336/',
        studyDesign: 'retrospective algorithm/outcomes cohort',
        population: 'adult spinal deformity surgery',
        supportedClaim: 'Focal and full-correction strategies have different burdens and may suit different deformity classes.',
        limitation: 'The required clinical inputs are not present here; no MISDEF2 class is assigned.'
      }),
      decompressionInstability: Object.freeze({
        label: 'Delayed instability after decompression · prospective grade-I DS cohort',
        url: 'https://pubmed.ncbi.nlm.nih.gov/23373567/',
        studyDesign: 'small prospective single-site cohort',
        population: 'grade-I degenerative spondylolisthesis treated with decompression alone',
        supportedClaim: 'Dynamic motion, disc height, and facet angle were associated with reoperation for instability in that narrow population.',
        limitation: 'Thresholds do not generalize to all decompressions and those measurements are not currently entered.'
      }),
      topsFacetArthroplasty: Object.freeze({
        label: 'TOPS facet arthroplasty versus fusion · randomized FDA IDE trial',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38713762/',
        studyDesign: 'prospective randomized controlled FDA IDE trial',
        population: 'single-level L3–L5 stenosis with grade-I degenerative spondylolisthesis',
        supportedClaim: 'Decompression plus facet arthroplasty was compared with decompression plus fusion in the narrow studied population.',
        limitation: 'This evidence does not support use for multilevel disease, scoliosis over 10°, higher-grade or nondegenerative slips, poor bone quality, or anatomy outside the approved labeling.'
      })
    });

    const CONSTRUCT_COMPARISON_MODEL = Object.freeze({
      modelId: 'evidence-linked-case-target-construct-comparisons-v3',
      validationStatus: 'educational_unranked_scenario_matching_not_treatment_selection',
      maximumDisplayedOptions: 6,
      /* The sagittal triggers are the SRS–Schwab modifier bands the header shows
         (Schwab F et al., Spine 2012, PMID 22045006): '+' from PI–LL 10°, PT 20°
         and SVA 4 cm; '++' above PI–LL 20°, PT 30° and SVA 9.5 cm. The T1S–CL
         trigger is the Ames '++' band, above 20° (Ames CP et al., J Neurosurg
         Spine 2015). deriveDeformityPhenotypes grades through classifyModifiers
         and classifyCervicalModifiers themselves, so the boundaries (inclusive
         or exclusive) cannot drift from the displayed bands. The earlier 25°/5
         cm/10 cm/30° set contradicted the header. A lordosis-adding branch
         additionally requires a PI–LL '+' grade: PT- or SVA-only departures are
         compensatory findings and are not converted into a lumbar procedure. */
      triggerThresholds: Object.freeze({
        positivePiLlDeg: 10,
        markedPiLlDeg: 20,
        positivePtDeg: 20,
        markedPtDeg: 30,
        positiveSvaCm: 4,
        markedSvaCm: 9.5,
        thoracicKyphosisDeg: 60,
        cervicalSvaMm: 40,
        cervicothoracicSvaMm: 60,
        t1SlopeMinusClDeg: 20,
        cbvaAbsoluteDeg: 15,
        majorCoronalDeg: 30,
        compensatoryCoronalDeg: 10,
        lumbarDiscHeightLossPercent: 20,
        topsFacetHypertrophyPercent: 20,
        levelTranslationMm: 3,
        levelAxialRotationDeg: 6,
        levelCoronalWedgeDeg: 3,
        junctionalKyphoticWedgeDeg: 8
      }),
      disclosure: 'Residual case-target construct comparisons with representative editor prefills and atomic branch application; no treatment rank, probability, confidence, or achieved correction.'
    });

    function deriveDeformityPhenotypes(params, globalDeformity, levelFactors = {}) {
      if (!params || typeof params !== 'object' || !globalDeformity || typeof globalDeformity !== 'object') {
        throw new TypeError('Construct comparisons require alignment and three-plane inputs.');
      }
      const factorFor = levelId => levelFactors instanceof Map
        ? (levelFactors.get(levelId) || {})
        : (levelFactors?.[levelId] || {});
      const piLl = Number(params.pi) - Number(params.ll);
      const svaCm = typeof params.measuredSva === 'number' && Number.isFinite(params.measuredSva)
        ? params.measuredSva
        : null;
      const coronal = Math.abs(Number(globalDeformity.coronalMagnitude) || 0);
      const cSva = Number(globalDeformity.cervicalSva);
      const t1MinusCl = Number(globalDeformity.t1Slope) - Number(params.cl);
      const thresholds = CONSTRUCT_COMPARISON_MODEL.triggerThresholds;
      const collapsedLevels = LEVELS
        .filter(level => level.region === 'lumbar' && Number(factorFor(level.id).discHeightLoss) >= thresholds.lumbarDiscHeightLossPercent)
        .map(level => level.id);
      const activeThreePlaneLevels = LEVELS.filter(level => {
        const factor = factorFor(level.id);
        return Math.abs(Number(factor.lateralTranslation) || 0) >= thresholds.levelTranslationMm
          || Math.abs(Number(factor.apTranslation) || 0) >= thresholds.levelTranslationMm
          || Math.abs(Number(factor.axialRotation) || 0) >= thresholds.levelAxialRotationDeg
          || Math.abs(Number(factor.coronalWedge) || 0) >= thresholds.levelCoronalWedgeDeg;
      });
      const activeLevelIdsForRegion = region => activeThreePlaneLevels
        .filter(level => level.region === region)
        .map(level => level.id);
      const lumbarThreePlaneLevels = activeLevelIdsForRegion('lumbar');
      const thoracicThreePlaneLevels = activeLevelIdsForRegion('thoracic');
      const cervicalThreePlaneLevels = activeLevelIdsForRegion('cervical');
      const lumbarApTranslationLevels = ['L3-L4', 'L4-L5'].filter(levelId =>
        Math.abs(Number(factorFor(levelId).apTranslation) || 0) >= thresholds.levelTranslationMm
      );
      const topsScreenLevels = lumbarApTranslationLevels.filter(levelId =>
        Number(factorFor(levelId).facetHypertrophy) >= thresholds.topsFacetHypertrophyPercent
      );
      const junctionalWedge = ['T11-T12', 'T12-L1', 'L1-L2']
        .reduce((sum, levelId) => sum + Math.max(0, Number(factorFor(levelId).sagittalWedge) || 0), 0);
      const phenotypes = [];
      const add = (id, label, reason) => phenotypes.push(Object.freeze({ id, label, reason }));
      // Grade through the same classifiers the header uses (see triggerThresholds).
      const schwab = classifyModifiers({ mismatch: piLl, measuredSva: svaCm === null ? NaN : svaCm, pt: Number(params.pt) });
      const schwabGrades = Object.values(schwab);
      const ames = classifyCervicalModifiers({ cervicalSva: cSva, cbva: Number(globalDeformity.cbva), t1Slope: Number(globalDeformity.t1Slope), cervicalLordosis: Number(params.cl) });
      if (schwabGrades.some(grade => grade === '+' || grade === '++')) {
        add('positive_sagittal', 'Positive sagittal pattern', `PI–LL ${signedNumber(piLl, 0)}°, PT ${Number(params.pt)}°${svaCm === null ? '' : `, entered SVA ${svaCm} cm`} (SRS–Schwab PI–LL ${schwab.mismatch}, PT ${schwab.pt}, SVA ${schwab.sva}).`);
      }
      if (schwabGrades.includes('++')) {
        add('marked_sagittal', 'Marked sagittal deficit', 'At least one SRS–Schwab modifier is ++; distributed and focal-correction constructs can be compared, and rigidity remains unknown.');
      }
      if (Number(params.tk) >= thresholds.thoracicKyphosisDeg) add('thoracic_hyperkyphosis', 'Thoracic hyperkyphosis pattern', `Authored TK is ${Number(params.tk)}°.`);
      if (Number(params.cl) < 0 || (Number.isFinite(cSva) && cSva >= thresholds.cervicalSvaMm)) {
        add('cervical_deformity', 'Cervical deformity pattern', `C2–C7 angle is ${Number(params.cl)}° and authored cSVA is ${Number.isFinite(cSva) ? cSva : 'unavailable'} mm.`);
      }
      if ((Number.isFinite(cSva) && cSva >= thresholds.cervicothoracicSvaMm) || ames.t1SlopeMinusCl === '2' || Math.abs(Number(globalDeformity.cbva) || 0) >= thresholds.cbvaAbsoluteDeg) {
        add('cervicothoracic_malalignment', 'Cervicothoracic malalignment pattern', `T1S–CL is ${Number(t1MinusCl.toFixed(1))}° with cSVA/CBVA context.`);
      }
      if (coronal >= thresholds.majorCoronalDeg) add('major_coronal', 'Major authored coronal pattern', `Primary Cobb surrogate is ${coronal}° with independent axial/translation inputs.`);
      if (Math.abs(Number(globalDeformity.compensatoryCobb) || 0) >= thresholds.compensatoryCoronalDeg) {
        add('compensatory_curve', 'Secondary compensatory curve present', `Secondary Cobb surrogate is ${Math.abs(Number(globalDeformity.compensatoryCobb))}°; declared flexibility is ${Math.round((Number(globalDeformity.secondaryFlexibility) || 0) * 100)}%.`);
      }
      if (Math.abs(Number(globalDeformity.axialRotation) || 0) >= thresholds.levelAxialRotationDeg) {
        add('global_axial_rotation', 'Global authored axial-rotation pattern', `Axial-rotation surrogate is ${signedNumber(Number(globalDeformity.axialRotation) || 0, 0)}°.`);
      }
      if (Math.abs(Number(globalDeformity.trunkShift) || 0) >= thresholds.levelTranslationMm) {
        add('global_trunk_shift', 'Global authored coronal translation pattern', `Apical-translation surrogate is ${signedNumber(Number(globalDeformity.trunkShift) || 0, 0)} mm.`);
      }
      if (collapsedLevels.length >= 2) add('multilevel_collapse', 'Multilevel authored lumbar disc collapse', `${collapsedLevels.map(displayLevel).join(', ')} have at least ${thresholds.lumbarDiscHeightLossPercent}% authored disc-height loss.`);
      if (junctionalWedge >= thresholds.junctionalKyphoticWedgeDeg) add('focal_junctional', 'Focal thoracolumbar junctional pattern', `Authored T11–L2 sagittal wedge sum is ${Number(junctionalWedge.toFixed(1))}°.`);
      if (lumbarThreePlaneLevels.length) add('lumbar_three_plane', 'Lumbar three-plane level factors', `${lumbarThreePlaneLevels.map(displayLevel).join(', ')} meet a transparent lumbar translation, rotation, or coronal-wedge display trigger.`);
      if (thoracicThreePlaneLevels.length) add('thoracic_three_plane', 'Thoracic three-plane level factors', `${thoracicThreePlaneLevels.map(displayLevel).join(', ')} meet a transparent thoracic translation, rotation, or coronal-wedge display trigger.`);
      if (cervicalThreePlaneLevels.length) add('cervical_three_plane', 'Cervical three-plane level factors', `${cervicalThreePlaneLevels.map(displayLevel).join(', ')} meet a transparent cervical translation, rotation, or coronal-wedge display trigger.`);
      if (lumbarApTranslationLevels.length) {
        add('lumbar_ap_translation', 'Eligible-level lumbar AP translation pattern', `${lumbarApTranslationLevels.map(displayLevel).join(', ')} meet the ${thresholds.levelTranslationMm} mm authored-display trigger; slip grade and dynamic motion remain unknown.`);
      }
      if (topsScreenLevels.length) {
        add('tops_screen_pattern', 'TOPS comparison screen pattern', `${topsScreenLevels.map(displayLevel).join(', ')} combine authored AP translation with at least ${thresholds.topsFacetHypertrophyPercent}% facet-hypertrophy display input. Stenosis, slip grade, symptoms, and FDA eligibility remain unverified.`);
      }
      return Object.freeze(phenotypes);
    }

    const CONSTRUCT_TARGET_MODEL = Object.freeze({
      modelId: 'educational-reference-targets-v1',
      validationStatus: 'reference_only_not_a_patient_specific_surgical_goal',
      /* Targets must not themselves fail the bands the app displays. The atlas
         pose (PT 22°, CL 18°) is a display calibration from a supine CT, and PT
         22° is graded SRS–Schwab '+'; with T1 slope 40°, CL 18° is Ames T1S–CL
         '++'. So:
         - PT: the PI-relative ideal from the GAP score, PI − (0.59·PI + 9)
           (Yilgor C et al., JBJS Am 2017, PMID 28976431); 12.3° at PI 52°.
           Above PI ≈ 71° this exceeds the fixed Schwab 20° band, which is not
           PI-adjusted.
         - CL: T1 slope minus 10°, inside the Ames T1S–CL '0' band (< 15°; Ames
           CP et al., J Neurosurg Spine 2015). 10° is the embedded reference
           pose's own mismatch (T1S 28° − CL 18°), so the default case keeps its
           18° target. Without a T1 slope input the reference CL is used.
         - LL: PI, i.e. PI–LL 0°, inside the Schwab '0' band.
         Age-adjusted thresholds (Lafage R et al., Spine 2016, PMID 26689395)
         need an age input the app does not collect, so none is applied. */
      cervicalMismatchTargetDeg: 10,
      disclosure: 'Targets are transparent educational reference points used to organize editable scenarios. They are not an indication, prescription, alignment goal, or predicted result.'
    });

    function derivePlanningTargets(params, globalDeformity = {}) {
      if (!params || typeof params !== 'object' || !globalDeformity || typeof globalDeformity !== 'object') {
        throw new TypeError('Planning targets require alignment and three-plane inputs.');
      }
      const required = ['pi', 'll', 'tk', 'cl', 'pt'];
      if (required.some(key => typeof params[key] !== 'number' || !Number.isFinite(params[key]))) {
        throw new TypeError('Planning-target alignment inputs must be finite numbers.');
      }
      const reference = MODEL_MANIFEST.anatomy.referencePoseCalibration;
      const pi = Number(params.pi);
      const rawT1Slope = globalDeformity.t1Slope;
      const t1Slope = rawT1Slope === null || rawT1Slope === undefined || rawT1Slope === '' || !Number.isFinite(Number(rawT1Slope))
        ? null
        : Number(rawT1Slope);
      return Object.freeze({
        modelId: CONSTRUCT_TARGET_MODEL.modelId,
        validationStatus: CONSTRUCT_TARGET_MODEL.validationStatus,
        lumbarLordosis: pi,
        thoracicKyphosis: Number(reference.tk),
        cervicalLordosis: t1Slope === null ? Number(reference.cl) : t1Slope - CONSTRUCT_TARGET_MODEL.cervicalMismatchTargetDeg,
        pelvicTilt: Number((pi - (0.59 * pi + 9)).toFixed(1)),
        primaryCobb: 0,
        secondaryCobb: 0,
        apicalTranslation: 0,
        axialRotation: 0,
        measuredSva: null,
        basis: Object.freeze({
          lumbarLordosis: 'PI–LL 0° educational reference (SRS–Schwab 0 band)',
          thoracicKyphosis: 'embedded reference-pose calibration (T4–T12 metric)',
          cervicalLordosis: t1Slope === null
            ? 'embedded reference-pose calibration (no T1 slope entered)'
            : `T1 slope − ${CONSTRUCT_TARGET_MODEL.cervicalMismatchTargetDeg}° (inside the Ames T1S–CL 0 band)`,
          pelvicTilt: 'PI-relative GAP ideal: PI − (0.59·PI + 9)',
          threePlane: 'zero-departure authored display reference'
        }),
        disclosure: CONSTRUCT_TARGET_MODEL.disclosure
      });
    }

    function deriveResidualDeficits(params, globalDeformity, itinerary = [], assumptions = {}, targets = null) {
      const resolvedTargets = targets || derivePlanningTargets(params, globalDeformity);
      const sagittal = calculateBiomechanics(params, itinerary, assumptions);
      const threePlane = computeThreePlaneScenario(globalDeformity, itinerary, assumptions);
      const projected = Object.freeze({
        lumbarLordosis: sagittal.newLL,
        thoracicKyphosis: sagittal.newTK,
        cervicalLordosis: sagittal.newCL,
        pelvicTilt: sagittal.newPT,
        primaryCobb: threePlane.outputs.primaryCobb,
        secondaryCobb: threePlane.outputs.secondaryCobb,
        apicalTranslation: threePlane.outputs.apicalTranslation,
        axialRotation: threePlane.outputs.axialRotation,
        measuredSva: null
      });
      const residual = Object.freeze({
        piLl: Number(params.pi) - projected.lumbarLordosis,
        lumbarLordosis: resolvedTargets.lumbarLordosis - projected.lumbarLordosis,
        thoracicKyphosis: projected.thoracicKyphosis - resolvedTargets.thoracicKyphosis,
        cervicalLordosis: resolvedTargets.cervicalLordosis - projected.cervicalLordosis,
        pelvicTilt: projected.pelvicTilt - resolvedTargets.pelvicTilt,
        primaryCobb: projected.primaryCobb - resolvedTargets.primaryCobb,
        secondaryCobb: projected.secondaryCobb - resolvedTargets.secondaryCobb,
        apicalTranslation: projected.apicalTranslation - resolvedTargets.apicalTranslation,
        axialRotation: projected.axialRotation - resolvedTargets.axialRotation
      });
      return Object.freeze({
        modelId: 'case-residual-deficits-v1',
        validationStatus: 'educational_scenario_arithmetic_not_clinical_optimization',
        targets: resolvedTargets,
        projected,
        residual,
        sagittal,
        threePlane,
        unaddressed: Object.freeze([
          'Patient-specific SVA target and postoperative SVA response',
          'Flexibility, neurologic decompression, bone quality, and approach feasibility',
          'Implant fit, trajectory, load sharing, fusion maturation, and complication probability'
        ])
      });
    }

    function expandSuggestionPrerequisites(steps = [], itinerary = []) {
      if (!Array.isArray(steps) || !Array.isArray(itinerary)) throw new TypeError('Suggestion steps and itinerary must be arrays.');
      const topsLevels = new Set(steps.filter(step => step?.procedureId === 'tops').map(step => step.levelId));
      const explicitLaminectomy = new Map(
        steps
          .filter(step => step?.procedureId === 'laminectomy' && topsLevels.has(step.levelId))
          .map(step => [step.levelId, step])
      );
      const linkedLaminectomy = new Set(
        itinerary
          .filter(item => item?.procedureId === 'laminectomy')
          .map(item => item.levelId)
      );
      const expanded = [];
      steps.forEach(step => {
        if (!step || typeof step !== 'object') throw new TypeError('Every suggestion step must be an object.');
        if (step.procedureId === 'laminectomy' && topsLevels.has(step.levelId)) return;
        if (step.procedureId === 'tops' && !linkedLaminectomy.has(step.levelId)) {
          const authored = explicitLaminectomy.get(step.levelId);
          expanded.push(Object.freeze({
            ...(authored || {
              label: `Automatic decompression for ${displayLevel(step.levelId)} TOPS`,
              levelId: step.levelId,
              procedureId: 'laminectomy',
              sagittal: 0,
              coronal: 0,
              axial: 0,
              translation: 0
            }),
            autoAddedPrerequisite: true,
            prerequisiteFor: 'tops'
          }));
          linkedLaminectomy.add(step.levelId);
        }
        expanded.push(Object.freeze({ ...step }));
      });
      return Object.freeze(expanded);
    }

    function materializeSuggestedCandidate(step, id, option, branch) {
      const procedure = PROCEDURES[step?.procedureId];
      const level = LEVEL_BY_ID.get(step?.levelId);
      if (!procedure || !level || !isProcedureCompatible(procedure, level)) {
        throw new RangeError(`The suggested ${step?.procedureId || 'procedure'} step is not compatible with ${step?.levelId || 'the selected level'}.`);
      }
      const correctionPolicy = correctionPolicyFor(procedure, level);
      const plannedAngle = correctionPolicy.enabled ? Number(step.sagittal ?? 0) : 0;
      if (!Number.isFinite(plannedAngle) || plannedAngle < correctionPolicy.minDeg || plannedAngle > correctionPolicy.maxDeg) {
        throw new RangeError(`${procedure.name} suggestion must remain within ${correctionPolicy.minDeg}° to ${correctionPolicy.maxDeg}°.`);
      }
      const planePolicy = procedureThreePlanePolicyFor(step.procedureId, level);
      const readPlane = (value, policy, label) => {
        const numeric = Number(value ?? 0);
        if (!Number.isFinite(numeric) || numeric < policy.min || numeric > policy.max || (!policy.enabled && numeric !== 0)) {
          throw new RangeError(`${procedure.name} ${label} suggestion is outside its authored scenario domain.`);
        }
        return numeric;
      };
      return Object.freeze({
        id,
        levelId: level.id,
        procedureId: step.procedureId,
        plannedAngle,
        plannedAngleSource: correctionPolicy.enabled ? 'evidence_comparison_prefill' : 'not_applicable',
        plannedCoronal: readPlane(step.coronal, planePolicy.coronal, 'coronal'),
        plannedAxialRotation: readPlane(step.axial, planePolicy.axial, 'axial'),
        plannedTranslationMm: readPlane(step.translation, planePolicy.translation, 'translation'),
        implantPlan: buildDefaultSuggestedImplantPlan(step.procedureId, level.id),
        autoLinkedFor: step.autoAddedPrerequisite === true ? step.prerequisiteFor || null : null,
        comparisonPrefill: deepFreezeSnapshot({
          optionId: option.id,
          optionTitle: option.title,
          branchId: branch.id,
          branchLabel: branch.label,
          stepLabel: step.label,
          autoAddedPrerequisite: step.autoAddedPrerequisite === true,
          evidenceIds: [...option.evidenceIds]
        })
      });
    }

    function planConstructComparisonBranch(params, globalDeformity, itinerary, assumptions, option, branch, startingId = 1, targets = null) {
      try {
        if (!option || !branch) throw new RangeError('The selected construct branch is unavailable.');
        const expandedSteps = expandSuggestionPrerequisites(branch.steps, itinerary);
        const candidates = expandedSteps.map((step, index) =>
          materializeSuggestedCandidate(step, startingId + index, option, branch)
        );
        const draft = [...itinerary];
        candidates.forEach(candidate => {
          if (draft.some(item => item.levelId === candidate.levelId && item.procedureId === candidate.procedureId)) {
            throw new RangeError(`${PROCEDURES[candidate.procedureId].name} at ${displayLevel(candidate.levelId)} is already in the itinerary.`);
          }
          const conflict = findProcedureConflict(candidate.procedureId, candidate.levelId, draft, candidate.implantPlan);
          if (conflict) throw new RangeError(conflict);
          draft.push(candidate);
        });
        candidates.forEach(candidate => {
          const requirement = findProcedureRequirement(candidate.procedureId, candidate.levelId, draft);
          if (requirement) throw new RangeError(requirement);
        });
        const resolvedTargets = targets || derivePlanningTargets(params, globalDeformity);
        const before = deriveResidualDeficits(params, globalDeformity, itinerary, assumptions, resolvedTargets);
        const after = deriveResidualDeficits(params, globalDeformity, draft, assumptions, resolvedTargets);
        return Object.freeze({
          valid: true,
          message: '',
          expandedSteps,
          candidates: Object.freeze(candidates),
          draftItinerary: Object.freeze(draft),
          before,
          after
        });
      } catch (error) {
        return Object.freeze({
          valid: false,
          message: error instanceof Error ? error.message : String(error),
          expandedSteps: Object.freeze([]),
          candidates: Object.freeze([]),
          draftItinerary: Object.freeze([...itinerary]),
          before: null,
          after: null
        });
      }
    }

    function computeConstructComparisons(params, globalDeformity, levelFactors = {}, itinerary = [], assumptions = {}) {
      const targets = derivePlanningTargets(params, globalDeformity);
      const currentResidual = deriveResidualDeficits(params, globalDeformity, itinerary, assumptions, targets);
      const projectedParams = {
        ...params,
        ll: currentResidual.projected.lumbarLordosis,
        tk: currentResidual.projected.thoracicKyphosis,
        cl: currentResidual.projected.cervicalLordosis,
        pt: currentResidual.projected.pelvicTilt
      };
      const projectedPrimary = currentResidual.projected.primaryCobb;
      const projectedGlobal = {
        ...globalDeformity,
        coronalMagnitude: Math.abs(projectedPrimary),
        coronalDirection: projectedPrimary < 0 ? 'left' : 'right',
        compensatoryCobb: Math.abs(currentResidual.projected.secondaryCobb),
        trunkShift: currentResidual.projected.apicalTranslation,
        axialRotation: currentResidual.projected.axialRotation
      };
      const phenotypes = deriveDeformityPhenotypes(projectedParams, projectedGlobal, levelFactors);
      const phenotypeIds = new Set(phenotypes.map(phenotype => phenotype.id));
      if (!phenotypes.length) return Object.freeze([]);
      const factorFor = levelId => levelFactors instanceof Map
        ? (levelFactors.get(levelId) || {})
        : (levelFactors?.[levelId] || {});
      const degenerationScore = levelId => {
        const factor = factorFor(levelId);
        return (Number(factor.discHeightLoss) || 0)
          + .45 * (Number(factor.facetHypertrophy) || 0)
          + .25 * (Number(factor.osteophyteBurden) || 0);
      };
      const threePlaneScore = levelId => {
        const factor = factorFor(levelId);
        return 3 * Math.abs(Number(factor.coronalWedge) || 0)
          + 2 * Math.abs(Number(factor.axialRotation) || 0)
          + Math.abs(Number(factor.lateralTranslation) || 0)
          + Math.abs(Number(factor.apTranslation) || 0)
          + .1 * degenerationScore(levelId);
      };
      /* Levels the construct already addresses. Suggestions are ranked by
         pathology, but among comparable levels an untreated one is preferred so
         successive suggestions extend one coherent construct instead of
         restacking the segment that is already being operated on. The ranking
         still wins if every candidate level is already treated. */
      const treatedLevels = new Set((itinerary || []).map(item => item?.levelId).filter(Boolean));
      const preferUntreated = ranked => ranked.find(id => !treatedLevels.has(id)) || ranked[0];
      /* With no authored level factors every score ties at 0 and the stable
         sort returned the first (most cranial) candidate, so the declared
         fallbacks (the curve apex) were unreachable and a thoracic kyphosis
         comparison landed at T4-T5. When nothing distinguishes the candidates,
         the fallback is ranked first; authored factors still win. */
      const rankWithFallback = (levelIds, score, fallback) => {
        const ranked = [...levelIds].sort((a, b) => score(b) - score(a));
        if (ranked.length && score(ranked[0]) <= 0 && ranked.includes(fallback)) {
          ranked.splice(ranked.indexOf(fallback), 1);
          ranked.unshift(fallback);
        }
        return ranked;
      };
      const chooseLevel = (levelIds, fallback) =>
        preferUntreated(rankWithFallback(levelIds, degenerationScore, fallback)) || fallback;
      const chooseThreePlaneLevel = (levelIds, fallback) =>
        preferUntreated(rankWithFallback(levelIds, threePlaneScore, fallback)) || fallback;
      // Coronal, axial and translation seeds oppose only the curve the chosen
      // level lies in (see coronalCurveMembershipFor): a lumbar step cannot
      // correct a thoracic primary curve.
      const curveRegions = resolveCoronalCurveRegions(projectedGlobal);
      const threePlaneSeedFor = (levelId, limits) => {
        const membership = coronalCurveMembershipFor(curveRegions, levelId);
        const oppose = (residual, limit) => residual ? -Math.sign(residual) * Math.min(limit, Math.abs(residual)) : 0;
        const inPrimary = membership.primary >= .5;
        const inSecondary = !inPrimary && membership.secondary >= .5;
        return {
          coronal: inPrimary ? oppose(currentResidual.residual.primaryCobb, limits.coronal)
            : inSecondary ? oppose(currentResidual.residual.secondaryCobb, limits.coronal) : 0,
          axial: inPrimary ? oppose(currentResidual.residual.axialRotation, limits.axial) : 0,
          translation: inPrimary ? oppose(currentResidual.residual.apicalTranslation, limits.translation) : 0
        };
      };
      const options = [];
      const addOption = option => {
        if (options.some(existing => existing.id === option.id)) return;
        const evidence = option.evidenceIds.map(id => CONSTRUCT_EVIDENCE_SOURCES[id]).filter(Boolean);
        if (evidence.length !== option.evidenceIds.length) return;
        const optionContext = {
          ...option,
          evidenceIds: Object.freeze([...option.evidenceIds])
        };
        const rawBranches = option.branches?.length
          ? option.branches
          : [{ id: 'scenario', label: 'Scenario', sequence: true, steps: option.steps || [] }];
        const branches = rawBranches
          .map((branch, branchIndex) => {
            const authoredSteps = branch.steps || [];
            if (!authoredSteps.length || authoredSteps.some(step =>
              !isProcedureCompatible(PROCEDURES[step.procedureId], LEVEL_BY_ID.get(step.levelId))
            )) return null;
            const steps = authoredSteps.map((step, sequenceIndex) => Object.freeze({
                ...step,
                branchId: branch.id || `branch-${branchIndex + 1}`,
                branchLabel: branch.label || `Branch ${branchIndex + 1}`,
                sequenceIndex
              }));
            const branchCore = {
              id: branch.id || `branch-${branchIndex + 1}`,
              label: branch.label || `Branch ${branchIndex + 1}`,
              sequence: branch.sequence !== false,
              steps: Object.freeze(steps)
            };
            const evaluation = planConstructComparisonBranch(
              params,
              globalDeformity,
              itinerary,
              assumptions,
              optionContext,
              branchCore,
              100000,
              targets
            );
            return Object.freeze({ ...branchCore, evaluation });
          })
          .filter(Boolean);
        const steps = branches.flatMap(branch => branch.steps);
        if (!steps.length) return;
        // An option with no applicable branch left is noise, not a suggestion.
        // The usual cause is that the construct already contains it, which is
        // what made "apply each suggestion in turn" dead-end on a scenario the
        // itinerary had already satisfied.
        if (!branches.some(branch => branch.evaluation?.valid === true)) return;
        options.push(Object.freeze({
          ...option,
          branches: Object.freeze(branches),
          steps: Object.freeze(steps),
          matchReasons: Object.freeze([...option.matchReasons]),
          evidenceIds: Object.freeze([...option.evidenceIds]),
          missingInputs: Object.freeze([...option.missingInputs])
        }));
      };
      const piLl = currentResidual.residual.piLl;
      const coronal = Math.abs(currentResidual.projected.primaryCobb);
      const positiveLumbarNeed = Math.max(0, currentResidual.residual.lumbarLordosis);
      // Lordosis-adding sagittal branches need a PI–LL '+' grade (SRS–Schwab,
      // Schwab F et al., Spine 2012). A PT- or SVA-only departure is a
      // compensatory finding, so it opens the sagittal phenotype without
      // manufacturing a lumbar correction, and sequential branches stop once
      // the residual PI–LL is back inside the '0' band.
      const schwabLumbarNeed = classifyModifiers({ mismatch: piLl, measuredSva: NaN, pt: NaN }).mismatch === '0'
        ? 0
        : positiveLumbarNeed;
      const thoracicKyphosisNeed = Math.max(0, currentResidual.residual.thoracicKyphosis);
      const junctionalKyphoticNeed = ['T11-T12', 'T12-L1', 'L1-L2']
        .reduce((sum, levelId) => sum + Math.max(0, Number(factorFor(levelId).sagittalWedge) || 0), 0);
      const correctionOccupiedLevels = new Set(
        itinerary
          .filter(item => ['tlifPlif', 'plif', 'alif', 'llif', 'xlif', 'olif', 'spo', 'pso', 'tops'].includes(item.procedureId))
          .map(item => item.levelId)
      );

      if ((phenotypeIds.has('positive_sagittal') && schwabLumbarNeed > 0) || phenotypeIds.has('multilevel_collapse')) {
        // Oblique/lateral capacities follow their 5° no-ALL-release default
        // (see PROCEDURES.llif); larger lateral gains belong to ACR.
        const distributedCandidates = [
          { levelId: 'L5-S1', procedureId: 'alif', capacity: 15, label: 'Distal anterior step', priority: 5 },
          { levelId: 'L4-L5', procedureId: 'alif', capacity: 15, label: 'Lower-lumbar anterior step', priority: 4 },
          { levelId: 'L3-L4', procedureId: 'olif', capacity: PROCEDURES.olif.deltaAngle, label: 'Mid-lumbar oblique step', priority: 3 },
          { levelId: 'L2-L3', procedureId: 'olif', capacity: PROCEDURES.olif.deltaAngle, label: 'Upper-lumbar oblique step', priority: 2 },
          { levelId: 'L1-L2', procedureId: 'llif', capacity: PROCEDURES.llif.deltaAngle, label: 'Upper-lumbar lateral step', priority: 1 }
        ]
          .filter(candidate => !correctionOccupiedLevels.has(candidate.levelId))
          .sort((a, b) => (degenerationScore(b.levelId) + b.priority) - (degenerationScore(a.levelId) + a.priority));
        let remainingLumbarNeed = schwabLumbarNeed;
        const distributedSteps = [];
        for (const candidate of distributedCandidates) {
          if (distributedSteps.length >= 4) break;
          if (remainingLumbarNeed <= 0 && distributedSteps.length) break;
          const sagittal = remainingLumbarNeed > 0 ? Math.min(candidate.capacity, remainingLumbarNeed) : 0;
          distributedSteps.push({
            label: candidate.label,
            levelId: candidate.levelId,
            procedureId: candidate.procedureId,
            sagittal,
            coronal: 0,
            axial: 0,
            translation: 0
          });
          remainingLumbarNeed = Math.max(0, remainingLumbarNeed - sagittal);
        }
        addOption({
          id: 'distributed-lumbar-interbody',
          title: 'Distributed lumbar interbody reconstruction + posterior fixation',
          constructSummary: `A level-by-level sequence allocates up to the current ${Number(schwabLumbarNeed.toFixed(1))}° educational LL residual across available anterior, oblique, and lateral interbody steps. Every applied step includes its explicit default cage plus bilateral posterior screw–rod plan; it remains an editable scenario, not an achieved correction.`,
          matchReasons: phenotypes.filter(value => ['positive_sagittal', 'multilevel_collapse'].includes(value.id)).map(value => value.reason),
          steps: distributedSteps,
          evidenceIds: ['alifPosteriorRegistry', 'lateralMetaAnalysis'],
          missingInputs: ['Standing/supine flexibility', 'Regional lordosis distribution and apex', 'Bone/endplate quality', 'Neural compression and approach feasibility']
        });
      }
      if (phenotypeIds.has('marked_sagittal') && schwabLumbarNeed > 0) {
        const psoLevel = ['L3-L4', 'L2-L3', 'L4-L5', 'L1-L2']
          .find(levelId => !correctionOccupiedLevels.has(levelId)) || 'L3-L4';
        addOption({
          id: 'focal-pso-comparison',
          title: 'Focal PSO construct comparison',
          constructSummary: 'A single posterior three-column osteotomy comparison with bundled posterior screw–rod fusion. The editor seed is capped at the authored positive PI–LL gap and at the literature-scale 30° comparison range; it is not an achieved result.',
          matchReasons: phenotypes.filter(value => value.id === 'marked_sagittal').map(value => value.reason),
          steps: [{ label: 'Focal posterior correction', levelId: psoLevel, procedureId: 'pso', sagittal: Math.min(30, schwabLumbarNeed), coronal: 0, axial: 0, translation: 0 }],
          evidenceIds: ['osteotomyCorrection', 'misdef2'],
          missingInputs: ['Rigidity and prior fusion mass', 'Neurologic anatomy', 'Bone quality/frailty', 'Exact correction target and physiologic reserve']
        });
      } else if (phenotypeIds.has('positive_sagittal') && schwabLumbarNeed > 0) {
        const spoLevel = ['L2-L3', 'L3-L4', 'L1-L2', 'L4-L5']
          .find(levelId => !correctionOccupiedLevels.has(levelId)) || 'L2-L3';
        addOption({
          id: 'multilevel-spo-comparison',
          title: 'Distributed posterior column osteotomy comparison',
          constructSummary: 'Compare a representative posterior column osteotomy with bundled posterior fixation. Actual correction requires a mobile anterior disc space and depends on the number and location of treated levels.',
          matchReasons: phenotypes.filter(value => value.id === 'positive_sagittal').map(value => value.reason),
          steps: [{ label: 'Representative SPO level', levelId: spoLevel, procedureId: 'spo', sagittal: Math.min(10, schwabLumbarNeed), coronal: 0, axial: 0, translation: 0 }],
          evidenceIds: ['osteotomyCorrection', 'misdef2'],
          missingInputs: ['Disc mobility/flexibility', 'Needed number of levels', 'Bone quality', 'Neural and vascular anatomy']
        });
      }
      if (['major_coronal', 'compensatory_curve', 'lumbar_three_plane', 'global_axial_rotation', 'global_trunk_shift']
          .some(id => phenotypeIds.has(id))) {
        const availableLateralLevels = ['L1-L2', 'L2-L3', 'L3-L4', 'L4-L5']
          .filter(levelId => !correctionOccupiedLevels.has(levelId));
        // Without authored level factors, default to the apex of whichever
        // declared curve has lateral-eligible levels (primary first).
        const lateralFallback = [curveRegions?.primaryApex, curveRegions?.secondaryApex, 'L3-L4']
          .find(levelId => availableLateralLevels.includes(levelId)) || availableLateralLevels[0] || 'L3-L4';
        const lateralLevel = chooseThreePlaneLevel(availableLateralLevels, lateralFallback);
        const lateralSeed = threePlaneSeedFor(lateralLevel, { coronal: 12, axial: 8, translation: 20 });
        // A lumbar lateral step is only a three-plane comparison if it can act
        // on something: an authored lumbar level factor, or a curve residual
        // that contains its level. A thoracic-major curve with no lumbar
        // secondary curve gets no lumbar "three-plane" suggestion.
        const lateralActs = phenotypeIds.has('lumbar_three_plane')
          || [lateralSeed.coronal, lateralSeed.axial, lateralSeed.translation].some(value => value !== 0);
        if (lateralActs) addOption({
          id: 'three-plane-lateral',
          title: 'Three-plane lateral/oblique interbody + posterior fixation comparison',
          constructSummary: 'A representative OLIF step with the app’s default bilateral posterior screw–rod construct. The prefill opposes the remaining signed coronal surrogate of the curve that contains the chosen level, and the axial and translation surrogates only when that is the primary curve, while staying inside the editor domains; cohort data provide context rather than achieved values.',
          matchReasons: phenotypes.filter(value => ['major_coronal', 'compensatory_curve', 'lumbar_three_plane', 'global_axial_rotation', 'global_trunk_shift'].includes(value.id)).map(value => value.reason),
          steps: [{
            label: 'Representative three-plane level',
            levelId: lateralLevel,
            procedureId: 'olif',
            sagittal: Math.min(PROCEDURES.olif.deltaAngle, positiveLumbarNeed),
            coronal: lateralSeed.coronal,
            axial: lateralSeed.axial,
            translation: lateralSeed.translation
          }],
          evidenceIds: ['lateralThreePlane', 'lateralMetaAnalysis'],
          missingInputs: ['Standing bending or traction flexibility', 'Curve end vertebrae', 'Psoas/plexus/vessel corridor', 'Fractional curve and pelvic obliquity strategy']
        });
      }
      /* A cervical branch only ever ADDS lordosis. cSVA can be raised by a
         thoracolumbar or global deformity while the neck is compensatorily
         hyperlordotic (the flatback example: CL 30°, T1S 35°); the old seed,
         clamp(18° − CL), then prefilled a kyphosing −12° ACDF/PCF, which would
         worsen cSVA and horizontal gaze. The shortfall is now measured against
         the T1-slope-based target (derivePlanningTargets), and when there is
         none the cervical lordosis is treated as reciprocal: no cervical branch
         is offered unless authored cervical three-plane factors ask for one. */
      const cervicalLordosisNeed = Math.max(0, currentResidual.residual.cervicalLordosis);
      const cervicalSagittalPhenotype = phenotypeIds.has('cervical_deformity') || phenotypeIds.has('cervicothoracic_malalignment');
      if ((cervicalSagittalPhenotype && cervicalLordosisNeed > 0) || phenotypeIds.has('cervical_three_plane')) {
        // C4-C5 is the apex of the displayed C2-C7 lordosis (CURVE_DISTRIBUTION).
        const cervicalLevel = chooseThreePlaneLevel(['C2-C3', 'C3-C4', 'C4-C5', 'C5-C6', 'C6-C7'], 'C4-C5');
        const correctionSeed = cervicalSagittalPhenotype ? Math.min(12, cervicalLordosisNeed) : 0;
        addOption({
          id: 'cervical-anterior-posterior',
          title: 'Anterior, posterior, and circumferential cervical comparisons',
          constructSummary: 'Prefill ACDF or PCF at the most affected rendered cervical level. The combined sequence is shown as two editor steps; arthroplasty is not surfaced for marked multilevel deformity.',
          matchReasons: phenotypes.filter(value => ['cervical_deformity', 'cervicothoracic_malalignment', 'cervical_three_plane'].includes(value.id)).map(value => value.reason),
          branches: [
            { id: 'anterior', label: 'Anterior-only branch', sequence: false, steps: [
              { label: 'ACDF comparison', levelId: cervicalLevel, procedureId: 'acdf', sagittal: correctionSeed, coronal: 0, axial: 0, translation: 0 }
            ] },
            { id: 'posterior', label: 'Posterior-only branch', sequence: false, steps: [
              { label: 'PCF comparison', levelId: cervicalLevel, procedureId: 'pcf', sagittal: correctionSeed, coronal: 0, axial: 0, translation: 0 }
            ] },
            { id: 'circumferential', label: 'Circumferential sequence', sequence: true, steps: [
              { label: 'Step 1 · ACDF', levelId: cervicalLevel, procedureId: 'acdf', sagittal: correctionSeed, coronal: 0, axial: 0, translation: 0 },
              { label: 'Step 2 · PCF', levelId: cervicalLevel, procedureId: 'pcf', sagittal: 0, coronal: 0, axial: 0, translation: 0 }
            ] }
          ],
          evidenceIds: ['cervicalApproachComparison'],
          missingInputs: ['Flexible versus fixed deformity', 'Compression location', 'Swallowing/airway and neurologic context', 'Prior fusion and bone quality']
        });
      }
      if (phenotypeIds.has('thoracic_hyperkyphosis') || phenotypeIds.has('thoracic_three_plane')) {
        // T7-T8 is the apex of the displayed thoracic kyphosis
        // (CURVE_DISTRIBUTION) and of the thoracic-major display curve; the old
        // 'T8-T9' fallback was unreachable, so ties fell to T4-T5.
        const thoracicLevel = chooseThreePlaneLevel(
          ['T4-T5', 'T5-T6', 'T6-T7', 'T7-T8', 'T8-T9', 'T9-T10', 'T10-T11'],
          'T7-T8'
        );
        const spoSeed = threePlaneSeedFor(thoracicLevel, { coronal: 8, axial: 6, translation: 0 });
        const psoSeed = threePlaneSeedFor(thoracicLevel, { coronal: 12, axial: 10, translation: 0 });
        const sagittalSeed = phenotypeIds.has('thoracic_hyperkyphosis') ? Math.min(10, thoracicKyphosisNeed) : 0;
        addOption({
          id: 'thoracic-osteotomy-comparison',
          title: 'Thoracic multilevel SPO versus focal PSO comparison',
          constructSummary: 'Compare a representative posterior column osteotomy and a focal three-column osteotomy. Both app procedures include a posterior fusion construct.',
          matchReasons: phenotypes.filter(value => ['thoracic_hyperkyphosis', 'thoracic_three_plane'].includes(value.id)).map(value => value.reason),
          branches: [
            { id: 'spo', label: 'Distributed SPO branch', sequence: false, steps: [
              { label: 'Representative SPO', levelId: thoracicLevel, procedureId: 'spo', sagittal: sagittalSeed, coronal: spoSeed.coronal, axial: spoSeed.axial, translation: 0 }
            ] },
            { id: 'pso', label: 'Focal PSO branch', sequence: false, steps: [
              { label: 'Representative PSO', levelId: thoracicLevel, procedureId: 'pso', sagittal: phenotypeIds.has('thoracic_hyperkyphosis') ? Math.min(30, thoracicKyphosisNeed) : 0, coronal: psoSeed.coronal, axial: psoSeed.axial, translation: 0 }
            ] }
          ],
          evidenceIds: ['osteotomyCorrection'],
          missingInputs: ['Curve rigidity and etiology', 'Neurologic risk and canal anatomy', 'Bone quality', 'UIV/LIV and junctional strategy']
        });
      }
      if (phenotypeIds.has('focal_junctional')) {
        const junctionalCorrection = Math.min(10, junctionalKyphoticNeed, thoracicKyphosisNeed);
        addOption({
          id: 'junctional-extension-comparison',
          title: 'Junctional extension and osteotomy comparison',
          constructSummary: 'Prefill a representative thoracolumbar SPO construct. Exact extension levels and transition strategy are intentionally not inferred.',
          matchReasons: phenotypes.filter(value => value.id === 'focal_junctional').map(value => value.reason),
          steps: [{ label: 'Representative junctional SPO', levelId: 'T11-T12', procedureId: 'spo', sagittal: junctionalCorrection, coronal: 0, axial: 0, translation: 0 }],
          evidenceIds: ['osteotomyCorrection'],
          missingInputs: ['Existing construct endpoints', 'Fracture/nonunion/infection evaluation', 'Bone quality', 'Dynamic imaging and neurologic status']
        });
      }
      if (phenotypeIds.has('tops_screen_pattern')
          && coronal <= 10
          && !phenotypeIds.has('marked_sagittal')) {
        const motionLevel = chooseLevel(
          ['L3-L4', 'L4-L5'].filter(levelId =>
            Math.abs(Number(factorFor(levelId).apTranslation) || 0) >= CONSTRUCT_COMPARISON_MODEL.triggerThresholds.levelTranslationMm
            && Number(factorFor(levelId).facetHypertrophy) >= CONSTRUCT_COMPARISON_MODEL.triggerThresholds.topsFacetHypertrophyPercent
          ),
          'L4-L5'
        );
        addOption({
          id: 'focal-fusion-vs-motion-preservation',
          title: 'Focal fusion versus posterior motion-preservation comparison',
          constructSummary: 'Compare a TLIF fusion construct with the FDA-configuration TOPS external component topology at an eligible displayed level. Applying the TOPS branch automatically inserts its linked same-level decompression before the device. This screen does not establish the FDA-labeled diagnosis, eligibility, implant fit, or patient-specific motion.',
          matchReasons: phenotypes.filter(value => value.id === 'tops_screen_pattern').map(value => value.reason),
          branches: [
            { id: 'fusion', label: 'Fusion branch', sequence: false, steps: [
              { label: 'TLIF comparison', levelId: motionLevel, procedureId: 'tlifPlif', sagittal: Math.min(5, positiveLumbarNeed / 3), coronal: 0, axial: 0, translation: 0 }
            ] },
            { id: 'motion-preservation', label: 'TOPS + automatic decompression', sequence: true, steps: [
              { label: 'TOPS composite step', levelId: motionLevel, procedureId: 'tops', sagittal: 0, coronal: 0, axial: 0, translation: 0 }
            ] }
          ],
          evidenceIds: ['decompressionInstability', 'topsFacetArthroplasty'],
          missingInputs: ['Confirmed single-level grade-I degenerative spondylolisthesis and dynamic motion', 'Moderate-to-severe stenosis and facet/ligament pathology', 'Cobb angle, bone density, BMI, age, and FDA-label exclusions', 'Symptoms, neurologic findings, and patient-specific device eligibility']
        });
      }
      return Object.freeze(options.slice(0, CONSTRUCT_COMPARISON_MODEL.maximumDisplayedOptions));
    }

    const isProcedureCompatible = (procedure, level) => {
      if (!procedure || !level) return false;
      // A disc procedure can never target a body, or vice versa. Procedures that
      // predate body targets omit targetKind; their kind is inferred from region
      // so the pelvic family keeps matching PELVIS_TARGET and everything else
      // stays disc-only.
      const levelKind = level.kind || 'motion_segment';
      const procedureKind = procedure.targetKind || (procedure.region === 'pelvis' ? 'pelvis' : 'motion_segment');
      if (procedureKind !== levelKind) return false;
      if (procedure.allowedLevels && !procedure.allowedLevels.includes(level.id)) return false;
      if (procedure.excludedLevels && procedure.excludedLevels.includes(level.id)) return false;
      if (procedure.region === 'any') return level.isChain !== false;
      if (procedure.region === 'thoracolumbar') return level.region === 'thoracic' || level.region === 'lumbar';
      return procedure.region === level.region;
    };

    const correctionPolicyFor = (procedure, level) => {
      const metricRegion = level?.metricRegion ?? null;
      const localSegmentSupported = Boolean(level && level.isChain !== false);
      const enabled = Boolean(procedure && localSegmentSupported && (procedure.deltaAngle !== 0 || procedure.allowSignedCorrection === true));
      // Attribution follows the spanned discs (correctionSharesFor), so a body
      // straddling a junction is local-only only if none of its discs is in a
      // regional metric.
      const segmentShares = enabled ? (SEGMENT_SHARE_TEMPLATES.get(level.id) || EMPTY_SPAN) : EMPTY_SPAN;
      const metricRegions = [...new Set(segmentShares.map(share => share.metricRegion).filter(Boolean))];
      const localGroups = [...new Set(segmentShares.filter(share => !share.metricRegion).map(share => share.localGroup).filter(Boolean))];
      const localOnly = enabled && metricRegions.length === 0;
      const globalDomain = MODEL_MANIFEST.engineeringDomains.plannedCorrection;
      const defaultDeg = Number(procedure?.deltaAngle || 0);
      const minDeg = enabled ? Math.max(globalDomain.min, procedure?.correctionMin ?? 0) : 0;
      const maxDeg = enabled ? Math.min(globalDomain.max, procedure?.correctionMax ?? globalDomain.max) : 0;
      const regionMeaning = region => region === 'cervical'
        ? 'increases C2–C7 lordosis'
        : region === 'lumbar'
          ? 'increases lumbar lordosis'
          : 'decreases T4–T12 thoracic kyphosis by adding local lordosing correction';
      const localMeaning = group => `adds a local ${LOCAL_GROUP_LABELS[group]?.long || 'segment'} rotation without changing aggregate CL, TK, or LL${group === 'thoracolumbar' ? '; it enters the pelvic balance response' : ''}`;
      const shareMeaning = share => share.metricRegion ? regionMeaning(share.metricRegion) : localMeaning(share.localGroup);
      const uniqueMeanings = [...new Set(segmentShares.map(shareMeaning))];
      const positiveMeaning = !segmentShares.length
        ? 'adds a local segment rotation without changing aggregate CL, TK, or LL'
        : uniqueMeanings.length === 1
          ? uniqueMeanings[0]
          : `is split evenly across the two spanned discs: ${segmentShares.map(share => `${Math.round(share.fraction * 100)}% ${shareMeaning(share)}`).join('; ')}`;
      return Object.freeze({
        enabled,
        metricRegion,
        metricRegions: Object.freeze(metricRegions),
        localGroups: Object.freeze(localGroups),
        segmentShares,
        localOnly,
        aggregateOutput: Boolean(enabled && metricRegions.length),
        defaultDeg: enabled ? defaultDeg : 0,
        minDeg,
        maxDeg,
        signed: enabled && minDeg < 0,
        positiveMeaning
      });
    };

    /* Which motion segments belong to the primary and secondary coronal curve
       of each declared curve pattern. The windows and apices are the same as
       the 3D display windows (CORONAL_DISPLAY_PROFILES in the scene); they are
       duplicated here because the engine and its load-time self-test run before
       the scene script. The WP6 regression test asserts the two stay equal.
       Without this, every planned coronal change was summed into the single
       primary Cobb, so an ACDF or an L4-L5 LLIF "corrected" a thoracic curve. */
    const CORONAL_CURVE_REGIONS = Object.freeze({
      'degenerative-scoliosis': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['L5-S1', 'L4-L5', 'L3-L4', 'L2-L3', 'L1-L2', 'T12-L1']), apex: 'L3-L4' }),
        secondary: Object.freeze({ ids: Object.freeze(['T12-L1', 'T11-T12', 'T10-T11', 'T9-T10', 'T8-T9', 'T7-T8']), apex: 'T9-T10' })
      }),
      'thoracic-major-curve': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['T12-L1', 'T11-T12', 'T10-T11', 'T9-T10', 'T8-T9', 'T7-T8', 'T6-T7', 'T5-T6', 'T4-T5', 'T3-T4', 'T2-T3', 'T1-T2']), apex: 'T7-T8' }),
        secondary: Object.freeze({ ids: Object.freeze(['L5-S1', 'L4-L5', 'L3-L4', 'L2-L3', 'L1-L2', 'T12-L1']), apex: 'L2-L3' })
      }),
      'double-major-curve': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['T12-L1', 'T11-T12', 'T10-T11', 'T9-T10', 'T8-T9', 'T7-T8', 'T6-T7', 'T5-T6', 'T4-T5', 'T3-T4', 'T2-T3', 'T1-T2']), apex: 'T7-T8' }),
        secondary: Object.freeze({ ids: Object.freeze(['L5-S1', 'L4-L5', 'L3-L4', 'L2-L3', 'L1-L2', 'T12-L1']), apex: 'L2-L3' })
      }),
      'cervical-coronal-curve': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['C6-C7', 'C5-C6', 'C4-C5', 'C3-C4', 'C2-C3']), apex: 'C4-C5' }),
        secondary: Object.freeze({ ids: Object.freeze(['T4-T5', 'T3-T4', 'T2-T3', 'T1-T2', 'C7-T1']), apex: 'T2-T3' })
      }),
      'compensated-thoracolumbar': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['L4-L5', 'L3-L4', 'L2-L3', 'L1-L2', 'T12-L1', 'T11-T12', 'T10-T11', 'T9-T10', 'T8-T9', 'T7-T8']), apex: 'T12-L1' }),
        secondary: Object.freeze({ ids: Object.freeze(['T8-T9', 'T7-T8', 'T6-T7', 'T5-T6', 'T4-T5', 'T3-T4', 'T2-T3', 'T1-T2', 'C7-T1']), apex: 'T5-T6' })
      })
    });

    // Same precedence as the scene: declared profile, then preset, then the
    // default profile when a primary magnitude is authored. null means no
    // curve is declared, and every level then counts toward the primary
    // surrogate (an authored change creates a coronal angle wherever it is).
    function resolveCoronalCurveRegions(globalDeformity = {}) {
      const declared = [globalDeformity?.coronalProfileId, globalDeformity?.preset]
        .find(candidate => typeof candidate === 'string' && CORONAL_CURVE_REGIONS[candidate]);
      const profileId = declared
        || (Math.abs(Number(globalDeformity?.coronalMagnitude) || 0) > .01 ? MODEL_MANIFEST.defaultCoronalProfileId : null);
      const profile = profileId ? CORONAL_CURVE_REGIONS[profileId] : null;
      if (!profile) return null;
      return Object.freeze({
        profileId,
        primary: new Set(profile.primary.ids),
        secondary: new Set(profile.secondary.ids),
        primaryApex: profile.primary.apex,
        secondaryApex: profile.secondary.apex
      });
    }

    // Fraction of a target's spanned discs inside the primary curve, inside
    // only the secondary curve (a disc in both, e.g. T12-L1 between two curves,
    // counts toward the primary), and outside both.
    function coronalCurveMembershipFor(regions, targetId) {
      if (!regions) return Object.freeze({ primary: 1, secondary: 0, outside: 0 });
      const span = spannedSegmentIdsFor(targetId).filter(id => LEVEL_BY_ID.get(id)?.kind === 'motion_segment');
      if (!span.length) return Object.freeze({ primary: 0, secondary: 0, outside: 1 });
      const primary = span.filter(id => regions.primary.has(id)).length / span.length;
      const secondary = span.filter(id => !regions.primary.has(id) && regions.secondary.has(id)).length / span.length;
      return Object.freeze({ primary, secondary, outside: 1 - primary - secondary });
    }

    const THREE_PLANE_SCENARIO_MODEL = Object.freeze({
      id: 'three-plane-kinematic-surrogate-v1',
      curveRegions: CORONAL_CURVE_REGIONS,
      validationStatus: 'not_validated_for_patient_prediction',
      mechanicsModeled: false,
      domains: Object.freeze({
        primaryCobbDeg: Object.freeze({ min: -120, max: 120 }),
        compensatoryCobbDeg: Object.freeze({ min: -100, max: 100 }),
        apicalTranslationMm: Object.freeze({ min: -150, max: 150 }),
        axialRotationDeg: Object.freeze({ min: -90, max: 90 }),
        flexibilityFraction: Object.freeze({ min: 0, max: 1 })
      }),
      sources: Object.freeze({
        structuralVsCompensatory: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3261243/',
        reciprocalChangeReview: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9827204/',
        lateralInterbodyReview: 'https://pubmed.ncbi.nlm.nih.gov/35442824/'
      }),
      disclosure: 'User-authored bounded rigid transforms and a flexibility-weighted secondary-curve surrogate; not real physics or a patient-specific prediction.'
    });

    const THREE_PLANE_POLICY_BY_PROCEDURE = Object.freeze({
      acdf: Object.freeze({ coronal: 15, axial: 10, translation: 12 }),
      pcf: Object.freeze({ coronal: 20, axial: 15, translation: 18 }),
      tlifPlif: Object.freeze({ coronal: 20, axial: 15, translation: 24 }),
      plif: Object.freeze({ coronal: 20, axial: 15, translation: 24 }),
      alif: Object.freeze({ coronal: 18, axial: 12, translation: 24 }),
      llif: Object.freeze({ coronal: 30, axial: 20, translation: 35 }),
      xlif: Object.freeze({ coronal: 30, axial: 20, translation: 35 }),
      olif: Object.freeze({ coronal: 30, axial: 20, translation: 35 }),
      spo: Object.freeze({ coronal: 20, axial: 12, translation: 20 }),
      pso: Object.freeze({ coronal: 30, axial: 20, translation: 30 }),
      // Entries below are declared at zero rather than omitted. Omission makes
      // computeThreePlaneScenario throw "has no scenario axis" the moment a user
      // enters a nonzero coronal, axial or translation value. Zero is also the
      // honest value: no coronal or axial allowance for any of these was found in
      // the literature, and the spo/pso numbers above are themselves authoring
      // headroom rather than sourced figures.
      pcoGrade1: Object.freeze({ coronal: 12, axial: 8, translation: 12 }),
      osteotomyGrade4: Object.freeze({ coronal: 30, axial: 20, translation: 30 }),
      vcr: Object.freeze({ coronal: 45, axial: 30, translation: 40 }),
      acr: Object.freeze({ coronal: 30, axial: 20, translation: 35 }),
      accf: Object.freeze({ coronal: 0, axial: 0, translation: 0 }),
      thoracolumbarCorpectomy: Object.freeze({ coronal: 0, axial: 0, translation: 0 }),
      kyphoplasty: Object.freeze({ coronal: 0, axial: 0, translation: 0 }),
      laminoplasty: Object.freeze({ coronal: 0, axial: 0, translation: 0 }),
      c1c2Fusion: Object.freeze({ coronal: 0, axial: 0, translation: 0 }),
      lumbarTdr: Object.freeze({ coronal: 0, axial: 0, translation: 0 })
    });

    const procedureThreePlanePolicyFor = (procedureOrId, level) => {
      const procedureId = typeof procedureOrId === 'string'
        ? procedureOrId
        : Object.entries(PROCEDURES).find(([, candidate]) => candidate === procedureOrId)?.[0];
      const procedure = typeof procedureOrId === 'string' ? PROCEDURES[procedureOrId] : procedureOrId;
      const authored = procedure?.threePlaneCorrection || procedure?.correctionAxes || THREE_PLANE_POLICY_BY_PROCEDURE[procedureId] || {};
      const compatible = Boolean(procedure && level?.isChain !== false && isProcedureCompatible(procedure, level));
      const normalizeAxis = (key, unit) => {
        const declaration = authored[key];
        const magnitude = typeof declaration === 'number'
          ? Math.abs(declaration)
          : Math.max(Math.abs(Number(declaration?.min) || 0), Math.abs(Number(declaration?.max) || 0));
        return Object.freeze({
          enabled: compatible && magnitude > 0,
          min: compatible && magnitude > 0 ? -magnitude : 0,
          max: compatible && magnitude > 0 ? magnitude : 0,
          defaultValue: 0,
          unit
        });
      };
      return Object.freeze({
        procedureId: procedureId || null,
        coronal: normalizeAxis('coronal', 'degrees'),
        axial: normalizeAxis('axial', 'degrees'),
        translation: normalizeAxis('translation', 'millimetres'),
        disclosure: THREE_PLANE_SCENARIO_MODEL.disclosure
      });
    };

    function computeThreePlaneScenario(globalDeformity = {}, itinerary = [], options = {}) {
      if (!Array.isArray(itinerary)) throw new TypeError('Three-plane itinerary must be an array.');
      const finite = (value, label) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
        return value;
      };
      const assertDomain = (value, domain, label) => {
        const numeric = finite(value, label);
        if (numeric < domain.min || numeric > domain.max) throw new RangeError(`${label} must be ${domain.min} to ${domain.max}.`);
        return numeric;
      };
      const direction = globalDeformity.coronalDirection === 'left' ? -1 : 1;
      const primaryMagnitude = Math.abs(finite(Number(globalDeformity.coronalMagnitude ?? 0), 'Primary Cobb surrogate'));
      const secondaryMagnitude = Math.abs(finite(Number(globalDeformity.compensatoryCobb ?? 0), 'Secondary Cobb surrogate'));
      const baselinePrimary = assertDomain(direction * primaryMagnitude, THREE_PLANE_SCENARIO_MODEL.domains.primaryCobbDeg, 'Primary Cobb surrogate');
      const baselineSecondary = assertDomain(-direction * secondaryMagnitude, THREE_PLANE_SCENARIO_MODEL.domains.compensatoryCobbDeg, 'Secondary Cobb surrogate');
      const baselineTranslation = assertDomain(finite(Number(globalDeformity.trunkShift ?? 0), 'Apical translation'), THREE_PLANE_SCENARIO_MODEL.domains.apicalTranslationMm, 'Apical translation');
      const baselineAxial = assertDomain(finite(Number(globalDeformity.axialRotation ?? 0), 'Axial rotation'), THREE_PLANE_SCENARIO_MODEL.domains.axialRotationDeg, 'Axial rotation');
      const flexibility = assertDomain(finite(Number(globalDeformity.secondaryFlexibility ?? 0), 'Secondary flexibility'), THREE_PLANE_SCENARIO_MODEL.domains.flexibilityFraction, 'Secondary flexibility');
      let coronalChange = 0;
      let axialChange = 0;
      let translationChange = 0;
      // A coronal change reaches the curve its level lies in. Axial rotation and
      // apical translation are primary-curve surrogates (the display applies
      // them with the primary-curve weights), so only in-curve changes move them.
      // Out-of-curve changes are still posed locally and reported separately.
      const curveRegions = resolveCoronalCurveRegions(globalDeformity);
      let secondaryCoronalChange = 0;
      const outsideCurve = { coronal: 0, axial: 0, translation: 0 };
      const byLevel = {};

      itinerary.forEach((item, index) => {
        if (!item || typeof item !== 'object') throw new TypeError(`Three-plane itinerary item ${index + 1} must be an object.`);
        const procedure = PROCEDURES[item.procedureId];
        const level = LEVEL_BY_ID.get(item.levelId);
        if (!procedure || !level || !isProcedureCompatible(procedure, level)) throw new RangeError(`Three-plane itinerary item ${index + 1} is incompatible or unknown.`);
        const policy = procedureThreePlanePolicyFor(item.procedureId, level);
        const readAxis = (field, axis, label) => {
          const raw = item[field] ?? 0;
          const value = finite(raw, `${label} for ${procedure.name} at ${level.id}`);
          if (!axis.enabled && value !== 0) throw new RangeError(`${procedure.name} at ${level.id} has no ${label.toLowerCase()} scenario axis.`);
          if (value < axis.min || value > axis.max) throw new RangeError(`${label} for ${procedure.name} at ${level.id} must be ${axis.min} to ${axis.max} ${axis.unit}.`);
          return value;
        };
        const local = Object.freeze({
          coronal: readAxis('plannedCoronal', policy.coronal, 'Coronal change'),
          axial: readAxis('plannedAxialRotation', policy.axial, 'Axial rotation change'),
          translation: readAxis('plannedTranslationMm', policy.translation, 'Apical translation change')
        });
        const membership = coronalCurveMembershipFor(curveRegions, level.id);
        coronalChange += local.coronal * membership.primary;
        secondaryCoronalChange += local.coronal * membership.secondary;
        axialChange += local.axial * membership.primary;
        translationChange += local.translation * membership.primary;
        outsideCurve.coronal += local.coronal * membership.outside;
        outsideCurve.axial += local.axial * (1 - membership.primary);
        outsideCurve.translation += local.translation * (1 - membership.primary);
        const prior = byLevel[level.id] || { coronal: 0, axial: 0, translation: 0 };
        byLevel[level.id] = Object.freeze({
          coronal: prior.coronal + local.coronal,
          axial: prior.axial + local.axial,
          translation: prior.translation + local.translation
        });
      });

      const primary = assertDomain(baselinePrimary + coronalChange, THREE_PLANE_SCENARIO_MODEL.domains.primaryCobbDeg, 'Modeled primary Cobb surrogate');
      const improvementFraction = Math.abs(baselinePrimary) > 1e-9
        ? Math.max(0, Math.min(1, (Math.abs(baselinePrimary) - Math.abs(primary)) / Math.abs(baselinePrimary)))
        : 0;
      const responseEnabled = options.applyCoronalCompensation === true;
      const responseFraction = responseEnabled ? improvementFraction * flexibility : 0;
      const secondary = assertDomain(baselineSecondary * (1 - responseFraction) + secondaryCoronalChange, THREE_PLANE_SCENARIO_MODEL.domains.compensatoryCobbDeg, 'Modeled secondary Cobb surrogate');
      const apicalTranslation = assertDomain(baselineTranslation + translationChange, THREE_PLANE_SCENARIO_MODEL.domains.apicalTranslationMm, 'Modeled apical translation');
      const axialRotation = assertDomain(baselineAxial + axialChange, THREE_PLANE_SCENARIO_MODEL.domains.axialRotationDeg, 'Modeled axial rotation');
      const allOutputs = [primary, secondary, apicalTranslation, axialRotation, improvementFraction, responseFraction];
      if (!allOutputs.every(Number.isFinite)) throw new Error('Three-plane surrogate generated a non-finite output.');
      return Object.freeze({
        modelId: THREE_PLANE_SCENARIO_MODEL.id,
        validationStatus: THREE_PLANE_SCENARIO_MODEL.validationStatus,
        mechanicsModeled: false,
        baseline: Object.freeze({ primaryCobb: baselinePrimary, secondaryCobb: baselineSecondary, apicalTranslation: baselineTranslation, axialRotation: baselineAxial }),
        changes: Object.freeze({
          coronal: coronalChange, axial: axialChange, translation: translationChange,
          secondaryCoronal: secondaryCoronalChange,
          outsideCurve: Object.freeze({ ...outsideCurve })
        }),
        curveProfileId: curveRegions?.profileId ?? null,
        outputs: Object.freeze({ primaryCobb: primary, secondaryCobb: secondary, apicalTranslation, axialRotation }),
        byLevel: Object.freeze({ ...byLevel }),
        flexibility: Object.freeze({ declaredFraction: flexibility, structuralFraction: 1 - flexibility, improvementFraction, responseFraction, enabled: responseEnabled }),
        disclosure: THREE_PLANE_SCENARIO_MODEL.disclosure
      });
    }

    const correctionFor = (item, procedure = PROCEDURES[item?.procedureId], level = LEVEL_BY_ID.get(item?.levelId)) => {
      const candidate = item?.plannedAngle;
      const policy = correctionPolicyFor(procedure, level);
      if (!policy.enabled) {
        if (candidate === undefined || candidate === null || candidate === 0) return 0;
        if (procedure?.deltaAngle !== 0 && level && !level.metricRegion) {
          throw new RangeError(`${procedure.name} at ${level.id} is outside the declared regional angle endpoints; plannedAngle must be 0 or omitted.`);
        }
        throw new RangeError(`${procedure.name} has no modeled angular correction; plannedAngle must be 0 or omitted.`);
      }
      if (candidate === undefined || candidate === null || candidate === '') {
        throw new TypeError('An explicit plannedAngle is required for every modeled angular correction.');
      }
      if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < policy.minDeg || candidate > policy.maxDeg) {
        throw new RangeError(`Planned correction for ${procedure.name} at ${level.id} must be a finite value from ${policy.minDeg}° to ${policy.maxDeg}°.`);
      }
      return candidate;
    };

    // Anterior-column occupants. A body resection that consumes its discs cannot
    // coexist with any of these on a shared disc.
    const ANTERIOR_COLUMN_PROCEDURES = Object.freeze(new Set([
      'tlifPlif', 'plif', 'alif', 'llif', 'xlif', 'olif', 'acr',
      'acdf', 'discReplacement', 'lumbarTdr'
    ]));

    function findProcedureConflict(procedureId, levelId, itinerary, candidateImplantPlan = null) {
      const candidateProcedure = PROCEDURES[procedureId];
      const candidateSpan = consumedDiscSegmentIdsFor(candidateProcedure, levelId);
      // Compare actual disc occupancy rather than the target label. Grade-4
      // extended PSO consumes one declared adjacent disc; a full corpectomy or VCR
      // consumes both. Motion-segment procedures continue to occupy themselves.
      const sameLevelItems = itinerary.filter(item => {
        if (item.levelId === levelId) return true;
        return spansOverlap(
          candidateSpan,
          consumedDiscSegmentIdsFor(PROCEDURES[item.procedureId], item.levelId)
        );
      });
      // Fixation and osteotomy footprints can span farther than the disc material
      // they remove. Keep construct overlap separate from anterior-column
      // occupancy so a partial body resection cannot accept a duplicate screw
      // pair through its preserved adjacent disc.
      const candidateConstructSpan = spannedSegmentIdsFor(levelId);
      const sameConstructItems = itinerary.filter(item => {
        if (item.levelId === levelId) return true;
        return spansOverlap(candidateConstructSpan, spannedSegmentIdsFor(item.levelId));
      });
      const sameConstruct = sameConstructItems.map(item => item.procedureId);
      const sameTargetItems = itinerary.filter(item => item.levelId === levelId);
      const sameLevel = sameLevelItems.map(item => item.procedureId);
      const existingTops = itinerary.find(item => item.procedureId === 'tops');
      const candidateLevel = LEVEL_BY_ID.get(levelId);

      if (candidateLevel?.kind === 'vertebral_body' || candidateProcedure?.targetKind === 'vertebral_body') {
        // One resection type per vertebra. A corpectomy and a VCR at the same body
        // describe two different operations on the same bone.
        const sameBodyResection = sameTargetItems.find(item => PROCEDURES[item.procedureId]?.resectsVertebralBody === true);
        if (sameBodyResection && candidateProcedure?.resectsVertebralBody === true) {
          return `${PROCEDURES[sameBodyResection.procedureId].name} is already modeled at ${displayLevel(levelId)}. Choose one body-resection type per vertebra.`;
        }
        const sameBodyAugmentation = sameTargetItems.find(item => item.procedureId === 'kyphoplasty');
        if ((procedureId === 'kyphoplasty' && sameBodyResection)
            || (candidateProcedure?.resectsVertebralBody === true && sameBodyAugmentation)) {
          return 'Vertebral augmentation cannot occupy a vertebral body that is also resected.';
        }
        if (candidateProcedure?.wholeBodyResection === true) {
          const adjacentWholeBodyResection = sameLevelItems.find(item =>
            item.levelId !== levelId && PROCEDURES[item.procedureId]?.wholeBodyResection === true
          );
          if (adjacentWholeBodyResection) {
            return 'Adjacent complete body resections require a continuous multilevel reconstruction model, which is not implemented; the scenario is withheld rather than rendered as disconnected short struts.';
          }
        }
        if (consumesAdjacentDiscs(candidateProcedure) && candidateProcedure?.resectsVertebralBody === true) {
          const blocking = sameLevelItems.find(item => ANTERIOR_COLUMN_PROCEDURES.has(item.procedureId));
          if (blocking) {
            return `${PROCEDURES[blocking.procedureId].name} at ${displayLevel(blocking.levelId)} already occupies a disc space this resection removes.`;
          }
        }
      } else if (ANTERIOR_COLUMN_PROCEDURES.has(procedureId)) {
        // Same rule with the roles reversed: adding a disc procedure into a space
        // an existing body resection has already removed.
        const resection = sameLevelItems.find(item => {
          const other = PROCEDURES[item.procedureId];
          return other?.resectsVertebralBody === true && consumesAdjacentDiscs(other);
        });
        if (resection) {
          return `${PROCEDURES[resection.procedureId].name} at ${displayLevel(resection.levelId)} already removes this disc space.`;
        }
      }
      if (procedureId === 'tops') {
        const additionalLumbarProcedure = itinerary.find(item => {
          const itemLevel = LEVEL_BY_ID.get(item.levelId);
          return itemLevel?.region === 'lumbar'
            && !(item.levelId === levelId && item.procedureId === 'laminectomy');
        });
        if (additionalLumbarProcedure) {
          return 'FDA-label mode limits TOPS to one lumbar level without another lumbar procedure. Remove the other lumbar item or use a separately labeled research/off-label scenario.';
        }
      } else if (existingTops && candidateLevel?.region === 'lumbar'
          && !(procedureId === 'laminectomy' && levelId === existingTops.levelId)) {
        return 'FDA-label mode does not combine TOPS with another lumbar procedure. Remove TOPS or author a separately labeled research/off-label scenario.';
      }
      const itemHasPosteriorFixation = item => {
        const roles = new Set((item?.implantPlan?.components || []).map(component => component?.role).filter(Boolean));
        if (roles.has('screw_set') && roles.has('rod_set')) return true;
        if (item?.implantPlan) return false;
        return Boolean(PROCEDURE_IMPLANT_PROFILES[item?.procedureId]?.screwCatalogId);
      };
      const candidateHasPosteriorFixation = (() => {
        if (candidateImplantPlan) return itemHasPosteriorFixation({ procedureId, implantPlan: candidateImplantPlan });
        return Boolean(PROCEDURE_IMPLANT_PROFILES[procedureId]?.screwCatalogId);
      })();
      if (procedureId === 'tops' && itinerary.some(item => item.procedureId === 'tops')) {
        return 'The TOPS scenario is limited to one modeled level.';
      }
      const interbody = new Set(['tlifPlif', 'plif', 'alif', 'llif', 'xlif', 'olif', 'acr', 'lumbarTdr']);
      if (interbody.has(procedureId) && sameLevel.some(id => interbody.has(id))) {
        return 'Choose one modeled lumbar interbody approach at this level.';
      }
      const osteotomies = new Set(['pcoGrade1', 'spo', 'pso', 'osteotomyGrade4', 'vcr']);
      if (osteotomies.has(procedureId) && sameConstruct.some(id => osteotomies.has(id))) {
        return 'Choose one modeled osteotomy type at this level.';
      }
      const motionDiscs = new Set(['discReplacement', 'lumbarTdr']);
      const candidateIsFusion = candidateProcedure?.fusion === true;
      const existingFusion = sameLevelItems.find(item => PROCEDURES[item.procedureId]?.fusion === true);
      const existingMotionDisc = sameLevelItems.find(item => motionDiscs.has(item.procedureId));
      if ((motionDiscs.has(procedureId) && existingFusion)
          || (candidateIsFusion && existingMotionDisc)) {
        return 'Motion-disc replacement cannot be combined with fusion at the same motion segment.';
      }
      const decompressions = new Set(['laminectomy', 'laminoplasty']);
      if (decompressions.has(procedureId)
          && sameLevel.some(id => decompressions.has(id) && id !== procedureId)) {
        return 'Choose either laminectomy or laminoplasty at this level; their posterior-element footprints cannot coexist.';
      }
      if ((procedureId === 'c1c2Fusion' && sameLevel.includes('pcf'))
          || (procedureId === 'pcf' && sameLevel.includes('c1c2Fusion'))) {
        return 'The dedicated C1–C2 fusion already occupies this atlantoaxial posterior construct; remove the generic PCF item.';
      }
      if (procedureId === 'tops' && sameLevel.some(id => interbody.has(id) || osteotomies.has(id))) {
        return 'TOPS cannot be combined with an interbody fusion or osteotomy at the same level.';
      }
      if ((interbody.has(procedureId) || osteotomies.has(procedureId)) && sameLevel.includes('tops')) {
        return 'This correction cannot be combined with TOPS at the same level.';
      }
      if ((procedureId === 'tops' && sameLevel.includes('pedicleScrews')) || (procedureId === 'pedicleScrews' && sameLevel.includes('tops'))) {
        return 'TOPS already includes pedicle-screw fixation; remove the separate transpedicular screw item at this level.';
      }
      const proceduresWithBundledPosteriorFixation = new Set([
        'tlifPlif', 'plif', 'alif', 'llif', 'xlif', 'olif', 'acr',
        'pcoGrade1', 'spo', 'pso', 'osteotomyGrade4', 'vcr',
        'thoracolumbarCorpectomy', 'c1c2Fusion'
      ]);
      if (procedureId === 'pedicleScrews' && sameConstructItems.some(item =>
        proceduresWithBundledPosteriorFixation.has(item.procedureId) && itemHasPosteriorFixation(item)
      )) {
        return 'The existing procedure already includes a modeled posterior fixation pair at this level.';
      }
      if (proceduresWithBundledPosteriorFixation.has(procedureId) && candidateHasPosteriorFixation && sameConstruct.includes('pedicleScrews')) {
        return `${PROCEDURES[procedureId].name} already includes a modeled posterior fixation pair; remove the separate transpedicular screw item at this level.`;
      }
      const pelvicAnchors = new Set(['s2aiFixation', 'iliacFixation']);
      if (pelvicAnchors.has(procedureId) && sameLevel.some(id => pelvicAnchors.has(id))) {
        return 'Choose one modeled pelvic anchor family for this construct.';
      }
      return '';
    }

    function findProcedureRequirement(procedureId, levelId, itinerary) {
      if (procedureId === 'tops' && !itinerary.some(item => item.levelId === levelId && item.procedureId === 'laminectomy')) {
        return 'TOPS requires a linked same-level decompression item. Use the atomic TOPS add or construct-branch workflow so it is inserted automatically.';
      }
      const procedure = PROCEDURES[procedureId];
      const item = itinerary.find(candidate => candidate.levelId === levelId && candidate.procedureId === procedureId);
      if (procedure?.mandatorySupplementalFixation === true && item?.implantPlan) {
        const roles = new Set((item.implantPlan.components || []).map(component => component?.role));
        if (!(roles.has('screw_set') && roles.has('rod_set'))) {
          return `${procedure.name} requires an explicit posterior screw-and-rod plan in this model.`;
        }
      }
      return '';
    }

    const CONSTRUCT_TOPOLOGY_MODEL = Object.freeze({
      modelId: 'construct-topology-v3',
      validationStatus: 'authored_construct_presence_only_not_fusion_maturation_or_measured_stability',
      sources: Object.freeze({
        alifPosteriorFixation: 'https://pubmed.ncbi.nlm.nih.gov/37875244/',
        lateralFixationBiomechanics: 'https://pubmed.ncbi.nlm.nih.gov/33722233/'
      })
    });

    function deriveConstructTopology(itinerary = []) {
      if (!Array.isArray(itinerary)) throw new TypeError('Itinerary must be an array.');
      const mutableByLevel = new Map(LEVELS.map(level => [level.id, {
        levelId: level.id,
        displayIndex: level.displayIndex,
        procedureIds: [],
        procedureNames: [],
        fusionIntent: false,
        posteriorFixationPlanned: false,
        interbodySupportPlanned: false,
        authoredAnteriorColumnReconstruction: false,
        motionPreservingDevice: false,
        motionPreservingStabilizationPlanned: false,
        posteriorDisruption: false,
        implantRoles: new Set(),
        implantPlanSnapshotsPresent: 0,
        implantPlanSnapshotsMissing: 0,
        bodyResectionPlanned: false,
        resectedBodyIds: new Set()
      }]));
      let pelvicFixationPresent = false;
      itinerary.forEach((item, index) => {
        if (!item || typeof item !== 'object') throw new TypeError(`Itinerary item ${index + 1} must be an object.`);
        const procedure = PROCEDURES[item.procedureId];
        const level = LEVEL_BY_ID.get(item.levelId);
        if (!procedure) throw new RangeError(`Unknown procedure: ${item.procedureId}.`);
        if (!level) throw new RangeError(`Unknown spinal level: ${item.levelId}.`);
        if (level.isChain === false) {
          if (['pelvic_s2ai', 'pelvic_iliac'].includes(procedure.type)) pelvicFixationPresent = true;
          return;
        }
        const hasImplantPlanSnapshot = Boolean(item.implantPlan && Array.isArray(item.implantPlan.components));
        const roles = new Set((hasImplantPlanSnapshot ? item.implantPlan.components : []).map(component => component?.role).filter(Boolean));
        const posteriorMotionComponentsPresent = roles.has('posterior_motion_device') && roles.has('screw_set');
        // A body resection is accumulated onto BOTH discs it spans. This used to
        // read mutableByLevel.get(item.levelId) directly, which is undefined for a
        // body id and threw on the next line - and because this runs from
        // computePostoperativeSurveillance, that was every refresh.
        spannedSegmentIdsFor(level.id).forEach(segmentId => {
          const segment = mutableByLevel.get(segmentId);
          if (!segment) return;
          if (hasImplantPlanSnapshot) segment.implantPlanSnapshotsPresent += 1;
          else segment.implantPlanSnapshotsMissing += 1;
          roles.forEach(role => segment.implantRoles.add(role));
          segment.procedureIds.push(item.procedureId);
          segment.procedureNames.push(procedure.name);
          segment.fusionIntent ||= procedure.fusion === true;
          segment.posteriorFixationPlanned ||= roles.has('screw_set') && roles.has('rod_set');
          // A strut reconstructing a corpectomy supports the anterior column just
          // as a cage does; without this the construct reads as unsupported and
          // falsely raises the adjacent-fusion marker.
          segment.authoredAnteriorColumnReconstruction ||= procedure.anteriorColumnReconstruction === true;
          segment.interbodySupportPlanned ||= roles.has('fusion_cage')
            || segment.authoredAnteriorColumnReconstruction;
          segment.motionPreservingDevice ||= roles.has('arthroplasty')
            || procedure.type === 'motion_disc'
            || posteriorMotionComponentsPresent;
          segment.motionPreservingStabilizationPlanned ||= posteriorMotionComponentsPresent;
          segment.posteriorDisruption ||= disruptsPosteriorTensionBand(procedure);
          if (procedure.resectsVertebralBody === true && level.bodyId) {
            segment.bodyResectionPlanned = true;
            segment.resectedBodyIds.add(level.bodyId);
          }
        });
      });

      const segments = [...mutableByLevel.values()].map(segment => {
        let state = 'unoperated_motion_segment';
        if (segment.motionPreservingDevice) state = 'motion_preserving';
        else if (segment.fusionIntent && segment.posteriorFixationPlanned) state = 'planned_fusion_posterior_supported';
        else if (segment.fusionIntent && segment.interbodySupportPlanned) state = 'planned_fusion_interbody_only';
        else if (segment.fusionIntent) state = 'planned_fusion_fixation_unverified';
        else if (segment.posteriorFixationPlanned) state = 'instrumented_without_fusion_inferred';
        else if (segment.posteriorDisruption) state = 'unspanned_posterior_disruption';
        else if (segment.procedureIds.length) state = 'operated_without_fixation';
        return Object.freeze({
          ...segment,
          procedureIds: Object.freeze([...segment.procedureIds]),
          procedureNames: Object.freeze([...segment.procedureNames]),
          implantRoles: Object.freeze([...segment.implantRoles].sort()),
          state,
          fixedForPlannedFusionSpan: segment.fusionIntent && !segment.motionPreservingDevice,
          constructSupportStatus: segment.posteriorFixationPlanned
            ? 'posterior_screw_rod_support_present'
            : segment.motionPreservingStabilizationPlanned
              ? 'motion_device_and_pedicle_screw_components_present'
            : segment.interbodySupportPlanned
              ? 'interbody_support_without_verified_posterior_fixation'
              : 'not_established',
          supportProvenance: segment.implantRoles.size
            ? 'explicit_implant_plan_components'
            : segment.authoredAnteriorColumnReconstruction
              ? 'source_bounded_anterior_reconstruction_envelope'
              : segment.implantPlanSnapshotsMissing
                ? 'implant_plan_snapshot_missing'
                : 'no_support_component_present'
        });
      });
      const byLevel = Object.freeze(Object.fromEntries(segments.map(segment => [segment.levelId, segment])));
      const fixedSegments = segments.filter(segment => segment.fixedForPlannedFusionSpan);
      return Object.freeze({
        modelId: CONSTRUCT_TOPOLOGY_MODEL.modelId,
        validationStatus: CONSTRUCT_TOPOLOGY_MODEL.validationStatus,
        segments: Object.freeze(segments),
        byLevel,
        fixedLevelIds: Object.freeze(fixedSegments.map(segment => segment.levelId)),
        posteriorSupportedFusionLevelIds: Object.freeze(fixedSegments.filter(segment => segment.posteriorFixationPlanned).map(segment => segment.levelId)),
        pelvicFixationPresent,
        pelvicConnectionStatus: pelvicFixationPresent ? 'not_inferred_without_explicit_connected_span' : 'not_present'
      });
    }

    function derivePlannedFusionIntervals(topology) {
      if (!topology || !Array.isArray(topology.segments)) throw new TypeError('Construct topology is required.');
      const sorted = topology.segments
        .filter(segment => segment.fixedForPlannedFusionSpan)
        .map(segment => segment.displayIndex)
        .sort((a, b) => a - b);
      if (!sorted.length) return Object.freeze([]);

      const intervals = [];
      let start = sorted[0];
      let end = sorted[0];
      sorted.slice(1).forEach(index => {
        if (index === end + 1) end = index;
        else {
          intervals.push(Object.freeze({
            start,
            end,
            segmentCount: end - start + 1,
            levelIds: Object.freeze(LEVELS.slice(start, end + 1).map(level => level.id))
          }));
          start = index;
          end = index;
        }
      });
      intervals.push(Object.freeze({
        start,
        end,
        segmentCount: end - start + 1,
        levelIds: Object.freeze(LEVELS.slice(start, end + 1).map(level => level.id))
      }));
      return Object.freeze(intervals);
    }

    function computeFusionBoundarySegments(itinerary = [], topology = null) {
      if (!Array.isArray(itinerary)) throw new TypeError('Itinerary must be an array.');
      const construct = topology || deriveConstructTopology(itinerary);
      const intervals = derivePlannedFusionIntervals(construct);
      if (!intervals.length) return Object.freeze([]);
      const adjacentByIndex = new Map();
      const addAdjacent = (index, relation) => {
        if (index < 0 || index >= LEVELS.length) return;
        if (!adjacentByIndex.has(index)) adjacentByIndex.set(index, new Set());
        adjacentByIndex.get(index).add(relation);
      };
      intervals.forEach(interval => {
        addAdjacent(interval.start - 1, 'cranial');
        addAdjacent(interval.end + 1, 'caudal');
      });

      const relationOrder = { cranial: 0, caudal: 1 };
      return Object.freeze([...adjacentByIndex.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, relationSet]) => {
          const relations = Object.freeze([...relationSet].sort((a, b) => relationOrder[a] - relationOrder[b]));
          return Object.freeze({
            levelId: LEVELS[index].id,
            displayIndex: index,
            relation: relations.length > 1 ? 'between_fused_intervals' : relations[0],
            relations
          });
        }));
    }
    const computeAdjacentMobileLevels = computeFusionBoundarySegments;

    const POSTOPERATIVE_SURVEILLANCE_MODEL = Object.freeze({
      modelId: 'postoperative-construct-review-v3',
      validationStatus: 'descriptive_factor_presence_only_not_clinically_validated',
      probabilityCalculated: false,
      scoreCalculated: false,
      displayThresholds: Object.freeze({ piLlDepartureDeg: 10, contiguousPlannedFusionSegments: 4 }),
      sources: Object.freeze({
        pjkFactors: Object.freeze({
          label: 'PJK factor systematic review and meta-analysis',
          url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9612636/'
        }),
        pjkPjf: Object.freeze({
          label: 'PJK/PJF surgical, radiographic, and patient-factor meta-analysis',
          url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6362551/'
        }),
        adjacentSegment: Object.freeze({
          label: 'Lumbar adjacent-segment systematic review and meta-analysis',
          url: 'https://pubmed.ncbi.nlm.nih.gov/34166276/'
        }),
        cervicalAdjacentSegment: Object.freeze({
          label: 'Cervical adjacent-segment risk-factor systematic review and meta-analysis',
          url: 'https://pubmed.ncbi.nlm.nih.gov/36321969/'
        }),
        laminectomy: Object.freeze({
          label: 'Human cadaver lumbar laminectomy shear study',
          url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3508235/'
        }),
        cervicalLaminectomy: Object.freeze({
          label: 'Cadaveric cervical laminectomy with progressive facetectomy study',
          url: 'https://pubmed.ncbi.nlm.nih.gov/8272949/'
        }),
        alifFixation: Object.freeze({
          label: '1,377-patient ALIF registry: stand-alone versus posterior fixation',
          url: 'https://pubmed.ncbi.nlm.nih.gov/37875244/'
        }),
        lateralFixation: Object.freeze({
          label: 'Multilevel LLIF supplemental-fixation cadaver study',
          url: 'https://pubmed.ncbi.nlm.nih.gov/33722233/'
        }),
        topsMotionPreservation: Object.freeze({
          label: 'FDA-approved TOPS indication and motion-preserving design',
          url: 'https://www.fda.gov/medical-devices/recently-approved-devices/tops-system-p220002'
        })
      }),
      unknownInputs: Object.freeze([
        'Age and frailty', 'BMI and paraspinal muscle quality', 'DXA or CT Hounsfield-unit bone quality',
        'Smoking, diabetes, and other clinical comorbidity', 'Patient-specific loads and activity',
        'Fusion maturation and follow-up imaging', 'Validated implant stress, strain, fatigue, and interface mechanics',
        'Dynamic flexion-extension motion and explicit cross-level rod/connector continuity'
      ])
    });

    function computePostoperativeSurveillance(params, itinerary = [], levelFactors = {}, prediction = null) {
      if (!params || typeof params !== 'object') throw new TypeError('Surveillance inputs require sagittal parameters.');
      if (!Array.isArray(itinerary)) throw new TypeError('Surveillance itinerary must be an array.');
      const sourceFor = key => POSTOPERATIVE_SURVEILLANCE_MODEL.sources[key];
      const topology = deriveConstructTopology(itinerary);
      const markerByLevel = new Map();
      const toneOrder = Object.freeze({ transition: 0, stabilized: 1, review: 2 });
      const ensureMarker = (levelId, relation, kind = 'construct_transition', tone = 'transition') => {
        if (!LEVEL_BY_ID.has(levelId) || LEVEL_BY_ID.get(levelId)?.isChain === false) return null;
        let marker = markerByLevel.get(levelId);
        if (!marker) {
          marker = { levelId, displayIndex: LEVEL_BY_ID.get(levelId).displayIndex, kind, tone, relations: [], factors: [] };
          markerByLevel.set(levelId, marker);
        }
        if (relation && !marker.relations.includes(relation)) marker.relations.push(relation);
        if (kind === 'operated_level') marker.kind = marker.kind === 'construct_transition' ? 'transition_and_operated' : kind;
        if ((toneOrder[tone] ?? 0) > (toneOrder[marker.tone] ?? 0)) marker.tone = tone;
        return marker;
      };
      const addFactor = (marker, id, label, detail, sourceKey) => {
        if (!marker || marker.factors.some(factor => factor.id === id)) return;
        const source = sourceFor(sourceKey);
        marker.factors.push(Object.freeze({ id, label, detail, evidenceLabel: source.label, sourceUrl: source.url }));
      };
      const fusedIndices = topology.segments
        .filter(segment => segment.fixedForPlannedFusionSpan)
        .map(segment => segment.displayIndex)
        .sort((a, b) => a - b);
      const fusionIntervals = derivePlannedFusionIntervals(topology);
      const fusedIndexSet = new Set(fusedIndices);
      const disruptiveItems = itinerary
        .filter(item => disruptsPosteriorTensionBand(PROCEDURES[item?.procedureId]))
        .flatMap(item => spannedSegmentIdsFor(item.levelId).map(levelId => ({
          ...item,
          sourceLevelId: item.levelId,
          levelId
        })));
      const factorForLevel = levelId => levelFactors instanceof Map
        ? (levelFactors.get(levelId) || {})
        : (levelFactors?.[levelId] || {});
      const modeledLl = prediction?.applicabilityStatus === 'within_engineering_domain' && Number.isFinite(prediction.newLL)
        ? prediction.newLL
        : null;
      const piLl = Number.isFinite(params.pi) && Number.isFinite(modeledLl) ? params.pi - modeledLl : null;
      const relationOrder = Object.freeze({ cranial: 0, caudal: 1, operated_level: 2 });

      computeFusionBoundarySegments(itinerary, topology).forEach(adjacent => {
        const marker = ensureMarker(adjacent.levelId, adjacent.relation, 'construct_transition', 'transition');
        const boundaryIndices = [];
        if (adjacent.relations.includes('cranial') && fusedIndexSet.has(adjacent.displayIndex + 1)) boundaryIndices.push(adjacent.displayIndex + 1);
        if (adjacent.relations.includes('caudal') && fusedIndexSet.has(adjacent.displayIndex - 1)) boundaryIndices.push(adjacent.displayIndex - 1);
        const boundaryLevelIds = boundaryIndices.map(index => LEVELS[index]?.id).filter(Boolean);
        const boundarySegments = boundaryLevelIds.map(levelId => topology.byLevel[levelId]).filter(Boolean);
        const boundaryRegions = new Set(boundaryLevelIds.map(levelId => LEVEL_BY_ID.get(levelId)?.region).filter(Boolean));
        const isCervicalBoundary = boundaryRegions.size === 1 && boundaryRegions.has('cervical');
        const hasLumbarBoundary = boundaryLevelIds.some(levelId => LEVEL_BY_ID.get(levelId)?.metricRegion === 'lumbar');
        const transitionSource = isCervicalBoundary ? 'cervicalAdjacentSegment' : hasLumbarBoundary ? 'adjacentSegment' : 'pjkFactors';
        const neighboringIntervals = fusionIntervals.filter(interval => boundaryIndices.some(index => index >= interval.start && index <= interval.end));
        const longestNeighboringInterval = neighboringIntervals.reduce((longest, interval) => Math.max(longest, interval.segmentCount), 0);
        const relationLabel = adjacent.relation === 'between_fused_intervals'
          ? 'This segment lies between two planned fusion intervals. Motion and instability are not measured.'
          : `This segment is immediately ${adjacent.relation} to a planned fusion interval. Motion and instability are not measured.`;
        addFactor(marker, 'construct_transition', 'Segment outside planned fusion span', relationLabel, transitionSource);
        if (adjacent.relation === 'between_fused_intervals') {
          addFactor(marker, 'between_constructs', 'Segment between planned fusion intervals', 'This level borders a planned fusion interval on both sides; it is not labeled unstable.', transitionSource);
        }
        const posteriorSupported = boundarySegments.filter(segment => segment.posteriorFixationPlanned);
        if (posteriorSupported.length) {
          const alifSupported = posteriorSupported.some(segment => segment.procedureIds.includes('alif'));
          const lateralSupported = posteriorSupported.some(segment => segment.procedureIds.some(id => ['llif', 'xlif', 'olif'].includes(id)));
          const constructDescription = posteriorSupported
            .map(segment => `${displayLevel(segment.levelId)} ${segment.procedureNames.join(' + ')}`)
            .join(', ');
          addFactor(
            marker,
            'adjacent_construct_supported',
            alifSupported ? 'Adjacent ALIF has posterior screw–rod support' : 'Adjacent fusion has posterior screw–rod support',
            `${constructDescription} has bilateral posterior screw–rod components in the saved implant plan; interbody or osteotomy support is reported separately from its actual saved components. The operated segment is not classified as mobile; this marker identifies only the neighboring transition.`,
            alifSupported ? 'alifFixation' : lateralSupported ? 'lateralFixation' : transitionSource
          );
        }
        const interbodyOnly = boundarySegments.filter(segment =>
          segment.fusionIntent && segment.interbodySupportPlanned && !segment.posteriorFixationPlanned
        );
        if (interbodyOnly.length) {
          const includesAlif = interbodyOnly.some(segment => segment.procedureIds.includes('alif'));
          addFactor(
            marker,
            'adjacent_construct_interbody_only',
            includesAlif ? 'Adjacent ALIF is authored as interbody-only' : 'Adjacent fusion is authored without posterior screw–rod support',
            `${interbodyOnly.map(segment => `${displayLevel(segment.levelId)} ${segment.procedureNames.join(' + ')}`).join(', ')} contains an interbody component without a same-level posterior screw–rod component in the saved implant plan. Motion, fusion success, and clinical suitability are not inferred.`,
            includesAlif ? 'alifFixation' : transitionSource
          );
        }
        if (longestNeighboringInterval >= POSTOPERATIVE_SURVEILLANCE_MODEL.displayThresholds.contiguousPlannedFusionSegments) {
          addFactor(marker, 'long_construct', 'Four or more contiguous planned fusion segments', `The neighboring planned fusion interval contains ${longestNeighboringInterval} contiguous segments. Four is a transparent app display trigger, not a clinical cutoff.`, isCervicalBoundary ? 'cervicalAdjacentSegment' : 'pjkPjf');
        }
        if (hasLumbarBoundary && Number.isFinite(piLl) && Math.abs(piLl) >= POSTOPERATIVE_SURVEILLANCE_MODEL.displayThresholds.piLlDepartureDeg) {
          const overcorrected = piLl < 0;
          addFactor(
            marker,
            'modeled_pi_ll_departure',
            overcorrected ? 'Modeled lordosis exceeds pelvic incidence' : 'Residual modeled PI–LL mismatch',
            `Modeled PI–LL is ${piLl > 0 ? '+' : ''}${Number(piLl.toFixed(1))}°. The ±10° trigger is a transparent display rule; no age-adjusted target or outcome is inferred.`,
            overcorrected ? 'pjkFactors' : 'adjacentSegment'
          );
        }
        const levelFactor = factorForLevel(adjacent.levelId);
        const activeDegeneration = [
          ['disc-height loss', levelFactor.discHeightLoss],
          ['facet hypertrophy', levelFactor.facetHypertrophy],
          ['osteophyte burden', levelFactor.osteophyteBurden]
        ].filter(([, value]) => Number(value) > 0);
        if (activeDegeneration.length) {
          addFactor(marker, 'authored_adjacent_degeneration', 'Authored adjacent-level degeneration factors', activeDegeneration.map(([label, value]) => `${label} ${Number(value)}%`).join(' · ') + '. These are display inputs, not imaging grades.', transitionSource);
        }
        const nearbyLevels = new Set([adjacent.levelId, ...boundaryLevelIds]);
        const nearbyUnspannedDisruption = disruptiveItems.filter(item => {
          if (!nearbyLevels.has(item.levelId)) return false;
          const segment = topology.byLevel[item.levelId];
          return !(segment?.posteriorFixationPlanned && segment?.fusionIntent)
            && !segment?.motionPreservingStabilizationPlanned;
        });
        if (nearbyUnspannedDisruption.length) {
          marker.tone = 'review';
          addFactor(marker, 'nearby_unspanned_posterior_disruption', 'Unspanned posterior disruption near this transition', `${nearbyUnspannedDisruption.map(item => `${PROCEDURES[item.procedureId].name} at ${displayLevel(item.levelId)}`).join(', ')} includes an authored posterior disruption footprint without same-level fusion support or a modeled motion-preserving device.`, isCervicalBoundary ? 'cervicalLaminectomy' : 'pjkFactors');
        }
        if (!isCervicalBoundary && adjacent.relations.includes('cranial')) {
          const cranialBoundary = boundaryIndices.find(index => index === adjacent.displayIndex + 1);
          const uivBone = cranialBoundary === undefined ? '' : LEVELS[cranialBoundary]?.superior;
          if (['T9', 'T10', 'T11', 'T12', 'L1', 'L2'].includes(uivBone)) {
            addFactor(marker, 'thoracolumbar_upper_transition', 'Upper construct transition in the T9–L2 zone', `The modeled upper instrumented transition begins at ${uivBone}. This is an anatomic-location flag, not a probability.`, 'pjkFactors');
          }
        }
      });

      disruptiveItems.forEach(item => {
        const segment = topology.byLevel[item.levelId];
        const fixationSpansFusion = Boolean(segment?.posteriorFixationPlanned && segment?.fusionIntent);
        const motionDeviceSpansDisruption = Boolean(segment?.motionPreservingStabilizationPlanned);
        const fixationOrDevicePresent = fixationSpansFusion || motionDeviceSpansDisruption;
        const marker = ensureMarker(
          item.levelId,
          'operated_level',
          'operated_level',
          fixationOrDevicePresent ? 'stabilized' : 'review'
        );
        if (!marker) return;
        const procedure = PROCEDURES[item.procedureId];
        const isCervicalLevel = LEVEL_BY_ID.get(item.levelId)?.region === 'cervical';
        if (fixationSpansFusion) {
          addFactor(
            marker,
            'posterior_disruption_spanned',
            'Posterior disruption is fixation-spanned in the authored construct',
            `${procedure.name} includes ${procedure.disruptsLigaments.join(', ').replaceAll('_', ' ')} disruption, while ${segment.procedureNames.join(' + ')} provides bilateral posterior screw–rod support at this level. Immediate segmental mobility is not inferred; fusion maturation and construct loading remain unknown.`,
            segment.procedureIds.includes('alif') ? 'alifFixation' : isCervicalLevel ? 'cervicalLaminectomy' : 'laminectomy'
          );
        } else if (motionDeviceSpansDisruption) {
          addFactor(
            marker,
            'posterior_disruption_with_motion_device',
            'Posterior disruption is paired with a planned motion-preserving device',
            `${procedure.name} includes ${procedure.disruptsLigaments.join(', ').replaceAll('_', ' ')} disruption and the same level contains ${segment.procedureNames.join(' + ')}. The TOPS procedure is authored as post-decompression motion-preserving stabilization; device geometry, actual motion, fixation integrity, and patient eligibility are not validated here.`,
            'topsMotionPreservation'
          );
        } else {
          addFactor(
            marker,
            'unspanned_posterior_disruption',
            'Posterior disruption without modeled posterior or motion-device support',
            `${procedure.name} includes ${procedure.disruptsLigaments.join(', ').replaceAll('_', ' ')} disruption. ${segment?.fusionIntent ? 'Fusion intent is authored, but' : 'No fusion is authored and'} no same-level posterior screw–rod support or motion-preserving stabilization component is present in the saved construct. This is a review trigger, not a diagnosis of instability.`,
            item.procedureId === 'laminectomy'
              ? isCervicalLevel ? 'cervicalLaminectomy' : 'laminectomy'
              : 'pjkFactors'
          );
        }
      });

      const markers = [...markerByLevel.values()]
        .sort((left, right) => left.displayIndex - right.displayIndex)
        .map(marker => Object.freeze({
          levelId: marker.levelId,
          displayIndex: marker.displayIndex,
          kind: marker.kind,
          tone: marker.tone,
          relations: Object.freeze([...marker.relations].sort((a, b) => (relationOrder[a] ?? 9) - (relationOrder[b] ?? 9))),
          factors: Object.freeze([...marker.factors])
        }));
      return Object.freeze({
        modelId: POSTOPERATIVE_SURVEILLANCE_MODEL.modelId,
        validationStatus: POSTOPERATIVE_SURVEILLANCE_MODEL.validationStatus,
        probabilityStatus: 'not_calculated',
        scoreStatus: 'not_calculated',
        plannedFusionSegmentCount: fusedIndices.length,
        plannedFusionIntervals: fusionIntervals,
        pelvicFixationPresent: topology.pelvicFixationPresent,
        pelvicConnectionStatus: topology.pelvicConnectionStatus,
        modeledPiLl: piLl,
        constructTopology: topology,
        markers: Object.freeze(markers),
        unknownInputs: POSTOPERATIVE_SURVEILLANCE_MODEL.unknownInputs
      });
    }

