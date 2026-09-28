    /* ---------------------------------------------------------------------
       Illustrative gait animation.

       This is a KINEMATIC display: a walk cycle whose amplitudes are a linear
       cross-sectional interpolation between published cohort means, indexed by
       the authored pelvic tilt. A changed scenario is re-indexed; the display is
       not a causal treatment response. It computes no forces, moments, muscle
       activity, or ground reaction and must never be read as a dynamics simulation.
    --------------------------------------------------------------------- */
    // Cadence is derived per case from the published fit, not fixed here.
    const gait = { active: false, phase: 0, params: null };
    gaitModuleReady = true;
    const GAIT_TAU = Math.PI * 2;

    // Wrap-aware Gaussian, so a peak near the start or end of the cycle blends
    // across the boundary instead of clipping.
    function gaitBump(t, centre, width) {
      let d = t - centre;
      if (d > .5) d -= 1;
      if (d < -.5) d += 1;
      return Math.exp(-(d * d) / (2 * width * width));
    }

    /* Normative sagittal joint angles through one cycle, t = 0 at heel strike.
       Hip is near-sinusoidal (~30 deg flexion at contact, ~10 deg extension at
       toe-off). Knee has the characteristic double peak: a small loading-response
       bump early in stance, then a large peak through swing — it is close to
       extension while bearing weight, which is exactly what the previous
       single-hump version got backwards. Ankle carries the push-off spike. */
    /* Normative amplitudes are the CONTROL-group means from the adult spinal
       deformity gait cohort below, so the unaffected walk starts from measured
       values rather than invented ones. Shapes stay as described above. */
    const GAIT_NORMATIVE = Object.freeze({
      hipRomDeg: 46.17,
      kneeRomDeg: 63.61,
      cadenceStepsPerMin: 118.24,
      pelvicObliquityDeg: 10.69,
      trunkLateroflexionDeg: 10.50,
      strideLengthM: 1.29,
      walkingSpeedMs: 1.30
    });
    const GAIT_HIP   = t => 10 + (GAIT_NORMATIVE.hipRomDeg / 2) * Math.cos(GAIT_TAU * t);
    const GAIT_KNEE  = t => 4 + 17 * gaitBump(t, .15, .10) + 63.6 * gaitBump(t, .72, .13);
    const GAIT_ANKLE = t => -6 * gaitBump(t, .07, .06) + 10 * gaitBump(t, .45, .14) - 20 * gaitBump(t, .62, .07);

    /* ---------------------------------------------------------------------
       Cross-sectional cohort interpolation.

       Every coefficient below is a straight-line interpolation through TWO
       PUBLISHED COHORT summaries and their matched controls:

         controls        hip ROM 46.17 deg · knee ROM 63.61 deg
                         cadence 118.24 steps/min · pelvic obliquity 10.69 deg
         idiopathic ASD  (median PT 13 deg, Cobb 46 deg) — coronal-dominant
         degenerative ASD(median PT 24 deg, SVA 88 mm)  — sagittal-dominant

       The cohorts differ in both alignment and gait; this ecological comparison
       cannot establish that sagittal malalignment caused the gait differences or
       that changing pelvic tilt in one patient will change gait. Coronal magnitude
       is not used to index sagittal gait values here; it only indexes the displayed
       trunk-lateroflexion factor observed at about 0.80 of control in both cohorts.

       Source: Gait alterations in patients with adult spinal deformity,
       North American Spine Society Journal (NASSJ) 2023;
       https://pmc.ncbi.nlm.nih.gov/articles/PMC10825775/

       Within PT 13–24 degrees these values are linear cross-sectional
       interpolations between cohort summaries. Outside that span they are
       extrapolations. Neither is a patient-specific or causal prediction.
    --------------------------------------------------------------------- */
    const GAIT_COUPLING = Object.freeze({
      source: 'nassj-2023-asd-gait',
      hip:      Object.freeze({ intercept: 1.0715, perDegPt: -0.00873, floor: .55 }),
      // Stride 1.29 m control, 1.25 m idiopathic (PT 13), 1.08 m degenerative (PT 24).
      stride:   Object.freeze({ intercept: 1.0923, perDegPt: -0.01064, floor: .5 }),
      knee:     Object.freeze({ intercept: 1.1012, perDegPt: -0.00909, floor: .55 }),
      cadence:  Object.freeze({ intercept: 1.0981, perDegPt: -0.00755, floor: .65 }),
      obliquity:Object.freeze({ intercept: 1.2185, perDegPt: -0.02873, floor: .25 }),
      // Both cohorts sat near 0.80 of control regardless of pelvic tilt, so this
      // is tied to the presence of a structural curve rather than to PT.
      trunkLateroflexionFloor: .80,
      trunkCobbReference: 29
    });

    const gaitFraction = (rule, pelvicTilt) =>
      THREE.MathUtils.clamp(rule.intercept + rule.perDegPt * pelvicTilt, rule.floor, 1);

    /* ---------------------------------------------------------------------
       Foot-ground inverse kinematics.

       Rather than prescribing joint angles and letting the feet float, the FOOT
       path is prescribed — planted through stance, arcing through swing — and a
       planar two-link solve recovers hip and knee. The stance foot therefore
       holds its world height while the pelvis rises and falls over it, which is
       what actually produces a walk rather than a march.

       Segment lengths are measured from the rest pose, never assumed.
    --------------------------------------------------------------------- */
    function measureLegSegments() {
      if (!lowerExtremityContext?.children?.length) return null;
      const hip = lowerExtremityContext.children[0];
      const knee = hip.children.find(child => child.name.startsWith('kneePivot:'));
      const ankle = knee?.children.find(child => child.name.startsWith('anklePivot:'));
      if (!knee || !ankle) return null;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      hip.getWorldPosition(a); knee.getWorldPosition(b); ankle.getWorldPosition(c);
      const femur = a.distanceTo(b), tibia = b.distanceTo(c);
      if (!(femur > 0) || !(tibia > 0)) return null;
      // Slightly short of full extension so the solve never sits on its
      // singularity and the knee keeps a few degrees of flexion.
      return { femur, tibia, reach: (femur + tibia) * .97 };
    }

    /* Pelvis height is DERIVED, not prescribed: the supporting leg has a fixed
       length, so the further the planted foot is from under the hip, the lower
       the hip must sit. The rise and fall of gait falls out of that geometry
       instead of being an invented amplitude, and the foot stays planted
       because the height and the IK target are computed from the same source. */
    function gaitPelvisHeight(phase, p) {
      const reach = p.legs.reach;
      let height = Infinity;
      [0, .5].forEach(offset => {
        const t = (phase + offset) % 1;
        if (t >= GAIT_TOE_OFF) return;            // a swinging limb constrains nothing
        const foot = gaitFootTarget(t, p);
        height = Math.min(height, Math.sqrt(Math.max(1e-6, reach * reach - foot.anterior * foot.anterior)));
      });
      return Number.isFinite(height) ? height : reach;
    }

    // Returns hip and knee FLEXION angles (radians, both positive = flexion)
    // that place the ankle at the requested anterior/downward offset.
    function solveLegIk(anterior, down, femur, tibia) {
      const reach = femur + tibia;
      let distance = Math.hypot(anterior, down);
      distance = THREE.MathUtils.clamp(distance, Math.abs(femur - tibia) + 1e-4, reach * .999);
      const cosKnee = THREE.MathUtils.clamp((femur*femur + tibia*tibia - distance*distance) / (2*femur*tibia), -1, 1);
      const kneeFlexion = Math.PI - Math.acos(cosKnee);
      const cosOffset = THREE.MathUtils.clamp((femur*femur + distance*distance - tibia*tibia) / (2*femur*distance), -1, 1);
      // The knee bends posteriorly, so the femur sits anterior of the hip-ankle
      // line by this offset.
      const hipFlexion = Math.atan2(anterior, down) + Math.acos(cosOffset);
      return { hipFlexion, kneeFlexion };
    }

    // Foot path relative to the hip, in the sagittal plane. Stance runs 0 to
    // GAIT_TOE_OFF; the planted foot travels backward as the body passes over it.
    const GAIT_TOE_OFF = .62;
    function gaitFootTarget(t, p) {
      const half = p.stepScene / 2;
      let anterior, lift;
      if (t < GAIT_TOE_OFF) {
        const s = t / GAIT_TOE_OFF;
        anterior = half - p.stepScene * s;
        lift = 0;                                   // planted
      } else {
        const s = (t - GAIT_TOE_OFF) / (1 - GAIT_TOE_OFF);
        anterior = -half + p.stepScene * s;
        lift = p.clearanceScene * Math.sin(Math.PI * s);
      }
      return { anterior, lift };
    }

    function computeGaitParams() {
      const deformity = deformityState();
      const post = state.view === 'post' && state.prediction?.applicabilityStatus === 'within_engineering_domain';
      const pelvicTilt = post ? state.prediction.newPT : state.params.pt;
      const coronal = Math.abs(finiteOr(deformity.coronalMagnitude));
      const axial = Math.abs(finiteOr(deformity.axialRotation));
      // Every scale below comes from the published cohort fits in GAIT_COUPLING.
      const hipScale = gaitFraction(GAIT_COUPLING.hip, pelvicTilt);
      const kneeScale = gaitFraction(GAIT_COUPLING.knee, pelvicTilt);
      const cadenceScale = gaitFraction(GAIT_COUPLING.cadence, pelvicTilt);
      const obliquityScale = gaitFraction(GAIT_COUPLING.obliquity, pelvicTilt);
      // Trunk lateroflexion fell to ~0.80 of control once a structural curve was
      // present, in both cohorts and independently of pelvic tilt.
      const curvePresence = THREE.MathUtils.clamp(coronal / GAIT_COUPLING.trunkCobbReference, 0, 1);
      const trunkScale = 1 - (1 - GAIT_COUPLING.trunkLateroflexionFloor) * curvePresence;
      // Capture the authored axial targets once so trunk counter-rotation can be
      // layered on each frame without accumulating.
      const trunkSegments = [];
      segmentRecords.forEach(record => {
        const region = record.level?.region;
        if (region === 'thoracic' || region === 'cervical') {
          trunkSegments.push({ record, baseY: finiteOr(record.group.userData.targetRotationY) });
        }
      });
      const strideScale = gaitFraction(GAIT_COUPLING.stride, pelvicTilt);
      const legs = measureLegSegments();
      // Step length is half a stride; the published control stride is 1.29 m.
      const stepScene = legs
        ? (GAIT_NORMATIVE.strideLengthM * 1000 / 2) * REFERENCE_MM_TO_SCENE * strideScale
        : 0;
      const animatedExcursion = sampleAnimatedJointExcursion({
        legs, stepScene, clearanceScene: 45 * REFERENCE_MM_TO_SCENE, hipScale, kneeScale
      });
      return {
        animatedHipRomDeg: animatedExcursion.hipRomDeg,
        animatedKneeRomDeg: animatedExcursion.kneeRomDeg,
        animatedExcursionSource: animatedExcursion.source,
        hipScale, kneeScale, cadenceScale, obliquityScale, trunkScale, pelvicTilt, strideScale,
        legs,
        stepScene,
        clearanceScene: 45 * REFERENCE_MM_TO_SCENE,   // ~4.5 cm swing-foot clearance
        // Lowest hip height in the cycle — the datum the rise is measured from.
        baseHipHeight: legs ? Math.sqrt(Math.max(1e-6, legs.reach*legs.reach - (stepScene/2)*(stepScene/2))) : 0,
        cadenceCyclesPerSecond: (GAIT_NORMATIVE.cadenceStepsPerMin * cadenceScale) / 120,
        // Frontal-plane pelvic drop, reported as a range and halved to an amplitude.
        pelvisObliquityDeg: (GAIT_NORMATIVE.pelvicObliquityDeg / 2) * obliquityScale,
        trunkCounterDeg: (GAIT_NORMATIVE.trunkLateroflexionDeg / 2) * trunkScale,
        // Transverse pelvic rotation is not reported by the cohort; it stays a
        // declared display value scaled by authored axial rotation.
        pelvisTransverseDeg: THREE.MathUtils.clamp(4 + axial / 6, 2, 10),
        // Whole-body rise and fall, twice per stride, ~2 cm at reference scale,
        // shortening with the stride.
        baseHip: finiteOr(deformity.hipFlexion),
        baseKnee: finiteOr(deformity.kneeFlexion),
        baseAnkle: finiteOr(deformity.ankleFlexion),
        basePelvisY: targetPelvisPosition.y,
        trunkSegments,
        coronal
      };
    }

    /* The walk is driven by foot-path inverse kinematics on the stride, so the
       hip and knee ranges it animates are set by stride and leg length, not by
       the cohort-interpolated excursions (e.g. PT 22: animated knee ~43 deg vs
       cohort-indexed 57 deg). The readout used to show only the cohort value
       next to an animation that did something else. The animated range is now
       sampled from the same IK over one cycle and shown as the headline, with
       the cohort-indexed value labelled beside it. */
    function sampleAnimatedJointExcursion({ legs, stepScene, clearanceScene, hipScale, kneeScale }) {
      const samples = 360;
      let hipMin = Infinity, hipMax = -Infinity, kneeMin = Infinity, kneeMax = -Infinity;
      for (let i = 0; i < samples; i += 1) {
        const t = i / samples;
        let hip, knee;
        if (legs) {
          const p = { legs, stepScene, clearanceScene };
          const foot = gaitFootTarget(t, p);
          const solved = solveLegIk(foot.anterior, gaitPelvisHeight(t, p) - foot.lift, legs.femur, legs.tibia);
          hip = THREE.MathUtils.radToDeg(solved.hipFlexion);
          knee = THREE.MathUtils.radToDeg(solved.kneeFlexion);
        } else {
          hip = hipScale * GAIT_HIP(t);
          knee = kneeScale * GAIT_KNEE(t);
        }
        hipMin = Math.min(hipMin, hip); hipMax = Math.max(hipMax, hip);
        kneeMin = Math.min(kneeMin, knee); kneeMax = Math.max(kneeMax, knee);
      }
      return {
        hipRomDeg: hipMax - hipMin,
        kneeRomDeg: kneeMax - kneeMin,
        source: legs ? 'foot-path IK over one cycle' : 'prescribed angle curves (no measurable limb chain)'
      };
    }

    function applyGaitTargets(deltaSeconds) {
      if (!gait.active || !lowerExtremityContext || !lowerExtremityContext.visible) return;
      if (!gait.params) gait.params = computeGaitParams();
      const p = gait.params;
      // Cadence itself is a published outcome, so a malaligned case walks slower.
      gait.phase = (gait.phase + deltaSeconds * p.cadenceCyclesPerSecond) % 1;
      const phase = gait.phase;

      // Hip height comes from the supporting leg's geometry; the rise is simply
      // how far that sits above the lowest point of the cycle.
      const hipHeight = p.legs ? gaitPelvisHeight(phase, p) : 0;
      const rise = p.legs ? hipHeight - p.baseHipHeight : 0;

      lowerExtremityContext.children.forEach((hip, index) => {
        // The two limbs run half a cycle apart.
        const t = (phase + (index === 0 ? 0 : .5)) % 1;
        const knee = hip.children.find(child => child.name.startsWith('kneePivot:'));
        const ankle = knee?.children.find(child => child.name.startsWith('anklePivot:'));
        if (!knee) return;

        if (p.legs) {
          const foot = gaitFootTarget(t, p);
          // The ground holds still: the ankle sits exactly the current hip height
          // below the hip, less any swing-phase clearance.
          const down = hipHeight - foot.lift;
          const solved = solveLegIk(foot.anterior, down, p.legs.femur, p.legs.tibia);
          // Measured conventions: hip flexion negative about Z, knee positive.
          hip.userData.targetRotationZ = -(THREE.MathUtils.degToRad(p.baseHip) + solved.hipFlexion);
          knee.userData.targetRotationZ = THREE.MathUtils.degToRad(p.baseKnee) + solved.kneeFlexion;
        } else {
          // No measurable limb chain; fall back to the prescribed angle curves.
          hip.userData.targetRotationZ = THREE.MathUtils.degToRad(-(p.baseHip + p.hipScale * GAIT_HIP(t)));
          knee.userData.targetRotationZ = THREE.MathUtils.degToRad(p.baseKnee + p.kneeScale * GAIT_KNEE(t));
        }
        // The ankle joint's own angle does not move the ankle centre, so it keeps
        // following the published profile.
        if (ankle) ankle.userData.targetRotationZ = THREE.MathUtils.degToRad(p.baseAnkle + p.kneeScale * GAIT_ANKLE(t));
      });

      // Frontal-plane pelvic drop toward the swing limb.
      targetPelvisRotationX = THREE.MathUtils.degToRad(p.pelvisObliquityDeg * Math.sin(GAIT_TAU * phase));

      // applyModelTargets leaves transverse pelvic rotation at zero, so the gait
      // owns it outright and cannot fight the authored posture.
      targetPelvisRotationY = THREE.MathUtils.degToRad(p.pelvisTransverseDeg * Math.sin(GAIT_TAU * phase));

      // Pelvis and hip pivots rise together; the IK above keeps the planted foot
      // at a constant world height while they do.
      targetPelvisPosition.y = p.basePelvisY + rise;
      lowerExtremityContext.userData.targetPositionY = rise;

      // Shoulders counter-rotate against the pelvis; distributing the angle over
      // the trunk segments accumulates it up the chain, so the head leads least.
      if (p.trunkSegments.length) {
        const counter = THREE.MathUtils.degToRad(-p.trunkCounterDeg * Math.sin(GAIT_TAU * phase)) / p.trunkSegments.length;
        p.trunkSegments.forEach(entry => {
          entry.record.group.userData.targetRotationY = entry.baseY + counter;
        });
      }
    }

    /* Each row states the modelled value, the published control value, how far
       short it falls, and which authored measurement indexes it — so a deficit
       always points at something the user can actually change. Bands are simply
       distance from control, not clinical severity grades. */
    // Bands are distance from the published cohort control, not clinical
    // severity grades, and the labels say exactly that.
    const GAIT_BAND_LABEL = Object.freeze({
      normal: 'within control', mild: 'below control', marked: 'well below control'
    });

    function gaitDeviationRows() {
      const p = gait.params;
      if (!p) return [];
      const band = fraction => fraction >= .95 ? 'normal' : fraction >= .85 ? 'mild' : 'marked';
      const rows = [
        // value = what the figure animates; cohortValue = the interpolation the
        // band is judged on. They differ, so both are shown and labelled.
        { key:'hip', label:'Hip excursion', value: p.animatedHipRomDeg, animated: true,
          cohortValue: GAIT_NORMATIVE.hipRomDeg * p.hipScale,
          control: GAIT_NORMATIVE.hipRomDeg, unit:'°', fraction: p.hipScale },
        { key:'knee', label:'Knee excursion', value: p.animatedKneeRomDeg, animated: true,
          cohortValue: GAIT_NORMATIVE.kneeRomDeg * p.kneeScale,
          control: GAIT_NORMATIVE.kneeRomDeg, unit:'°', fraction: p.kneeScale },
        { key:'cadence', label:'Cadence', value: GAIT_NORMATIVE.cadenceStepsPerMin * p.cadenceScale,
          control: GAIT_NORMATIVE.cadenceStepsPerMin, unit:'/min', fraction: p.cadenceScale },
        { key:'stride', label:'Stride length', value: GAIT_NORMATIVE.strideLengthM * p.strideScale,
          control: GAIT_NORMATIVE.strideLengthM, unit:' m', fraction: p.strideScale, digits:2 },
        { key:'obliquity', label:'Pelvic obliquity', value: GAIT_NORMATIVE.pelvicObliquityDeg * p.obliquityScale,
          control: GAIT_NORMATIVE.pelvicObliquityDeg, unit:'°', fraction: p.obliquityScale },
        { key:'trunk', label:'Trunk lateroflexion', value: GAIT_NORMATIVE.trunkLateroflexionDeg * p.trunkScale,
          control: GAIT_NORMATIVE.trunkLateroflexionDeg, unit:'°', fraction: p.trunkScale }
      ];
      const piLl = state.params.pi - (state.view === 'post' ? state.prediction.newLL : state.params.ll);
      return rows.map(row => ({
        ...row,
        band: band(row.fraction),
        cohortIndex: row.key === 'trunk'
          ? 'authored coronal curve magnitude'
          : `authored pelvic tilt ${p.pelvicTilt.toFixed(0)}°${Math.abs(piLl) >= 10 ? ` · displayed PI–LL ${piLl > 0 ? '+' : ''}${piLl.toFixed(0)}°` : ''}`
      }));
    }

    function syncGaitExpanded() {
      const chip = $('gaitChip');
      const expanded = Boolean(gait.active && chip && !chip.hidden && chip.dataset.collapsed === 'false');
      if (expanded) document.body.dataset.gaitExpanded = 'true';
      else delete document.body.dataset.gaitExpanded;
    }

    function renderGaitFlags() {
      const host = $('gaitFlags');
      if (!host) return;
      /* Wire the collapse once. Starts collapsed at every width: expanded, the
         readout covers the pelvis and legs, the part of the model being watched.
         While it is expanded the geometry chips stand down so nothing stacks. */
      const chip = $('gaitChip');
      if (chip && !chip.dataset.collapseWired) {
        chip.dataset.collapseWired = 'true';
        chip.dataset.collapsed = 'true';
        const heading = chip.querySelector('strong');
        if (heading) {
          heading.setAttribute('role', 'button');
          heading.setAttribute('tabindex', '0');
          const toggle = () => {
            chip.dataset.collapsed = chip.dataset.collapsed === 'true' ? 'false' : 'true';
            heading.setAttribute('aria-expanded', String(chip.dataset.collapsed !== 'true'));
            syncGaitExpanded();
          };
          heading.addEventListener('click', toggle);
          heading.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
          });
          heading.setAttribute('aria-expanded', String(chip.dataset.collapsed !== 'true'));
        }
      }
      // Name the view the figures belong to. Without it the panel looks static
      // when the numbers happen to move only slightly between pre and post.
      const viewLabel = $('gaitViewLabel');
      if (viewLabel) {
        const post = state.view === 'post';
        const suppressed = post && state.prediction?.applicabilityStatus !== 'within_engineering_domain';
        viewLabel.textContent = !gait.active ? ''
          : suppressed ? ' · Pre-Op values (post-op alignment suppressed)'
          : post ? ' · Modeled Post-Op' : ' · Pre-Op';
      }
      if (!gait.active || !gait.params) { host.replaceChildren(); return; }
      const rows = gaitDeviationRows();
      const flagged = rows.filter(row => row.band !== 'normal');
      // The couplings are straight-line fits between two published cohorts
      // (PT 13 and PT 24). Outside that span the figures are extrapolation and
      // must say so rather than reading as measured values.
      const pt = gait.params.pelvicTilt;
      const extrapolated = pt < 13 || pt > 24;
      host.innerHTML = rows.map(row => {
        const digits = row.digits ?? 0;
        if (row.animated) {
          return `<span class="gait-flag" data-band="${row.band}" data-animated="true" title="Animated range from the foot-path IK; the band compares the cohort-indexed value with control">`
            + `<small>${row.label} · animated</small>`
            + `<b>${row.value.toFixed(digits)}${row.unit}</b>`
            + `<i>cohort-indexed ${row.cohortValue.toFixed(digits)}${row.unit} of ${row.control.toFixed(digits)}${row.unit} · ${GAIT_BAND_LABEL[row.band]}</i></span>`;
        }
        return `<span class="gait-flag" data-band="${row.band}" title="${GAIT_BAND_LABEL[row.band]}">`
          + `<small>${row.label}</small>`
          + `<b>${row.value.toFixed(digits)}${row.unit}</b>`
          + `<i>of ${row.control.toFixed(digits)}${row.unit} · ${GAIT_BAND_LABEL[row.band]}</i></span>`;
      }).join('')
        + `<span class="gait-driver">Hip and knee show the range the figure animates (${gait.params.animatedExcursionSource}, set by stride and leg length). The cohort-indexed value is the published-cohort interpolation the band is judged on; the animation does not reproduce it.</span>`
        + (flagged.length
          ? `<span class="gait-driver">Below control: ${flagged.map(f=>f.label.toLowerCase()).join(', ')}. `
            + `Cross-sectional cohort interpolation indexed by ${flagged[0].cohortIndex}. This is not evidence that changing alignment causes an individual gait response.</span>`
          : `<span class="gait-driver">All displayed interpolations are within 5% of the published control-cohort means; this is not an individual prediction.</span>`)
        + (extrapolated
          ? `<span class="gait-driver gait-extrapolated">Pelvic tilt ${pt.toFixed(0)}° lies outside the published cohort span (13–24°). These figures are extrapolated beyond the source data, not interpolated within it.</span>`
          : '')
        // Gait used to be unavailable at any PI other than the atlas 52°. The
        // limbs walk on the unchanged femoral-head axis; say how the pelvis is
        // shown (withheld only when the CT pelvis is unavailable).
        + (pelvisGroup?.userData?.pelvicIncidenceSchematicReshaping
          ? `<span class="gait-driver">PI ${state.params.pi.toFixed(0)}° differs from the atlas PI (${MODEL_MANIFEST.anatomy.referencePoseCalibration.pi}°): the pelvis shape is adjusted schematically to the entered PI (an educational approximation, not patient anatomy), and the legs walk on the unchanged femoral-head axis that PI and PT are measured to.</span>`
          : pelvisGroup?.userData?.pelvicReferenceContextWithheld
            ? `<span class="gait-driver">PI ${state.params.pi.toFixed(0)}° differs from the atlas PI (${MODEL_MANIFEST.anatomy.referencePoseCalibration.pi}°): the legs walk on the unchanged femoral-head axis that PI and PT are measured to; the schematic pelvis is withheld because the CT pelvis is unavailable.</span>`
            : '');
    }

    /* Re-derive the gait coupling from whatever the model currently shows.
       Called from refreshApplication, so switching Pre-Op/Modeled Post-Op or
       editing any case parameter updates the panel and the animation together
       instead of leaving both pinned to the state gait was started in. */
    function refreshGaitDerivedState() {
      if (!gaitModuleReady || !gait.active) return;
      gait.params = computeGaitParams();
      renderGaitFlags();
    }

    /* ---- Showcase -------------------------------------------------------
       A single presentable screen: what the case was, what construct was
       applied, and what the model says changed — including gait, which is
       otherwise only visible while the walk animation is running.

       Direction colouring is deliberately limited to the measures that have an
       unambiguous direction: PI-LL and PT toward zero, and each gait amplitude
       toward its published control. Whether a given LL, TK or CL is "better" is
       a function of the target, not the number, so those stay neutral. */
    const SHOWCASE_GAIT_ROWS = Object.freeze([
      // Cohort-interpolated values, not the animated IK range (see the gait panel).
      { key: 'hip', label: 'Hip excursion (cohort-indexed)', coupling: 'hip', control: 'hipRomDeg', unit: '°' },
      { key: 'knee', label: 'Knee excursion (cohort-indexed)', coupling: 'knee', control: 'kneeRomDeg', unit: '°' },
      { key: 'cadence', label: 'Cadence', coupling: 'cadence', control: 'cadenceStepsPerMin', unit: '/min' },
      { key: 'stride', label: 'Stride length', coupling: 'stride', control: 'strideLengthM', unit: ' m', digits: 2 },
      { key: 'obliquity', label: 'Pelvic obliquity', coupling: 'obliquity', control: 'pelvicObliquityDeg', unit: '°' }
    ]);

    function showcaseMetric({ label, before, after, unit = '°', digits = 0, direction = null, available = true }) {
      const fmt = value => `${Number(value).toFixed(digits)}${unit}`;
      const delta = after - before;
      let dir = '';
      if (available && direction && Math.abs(delta) >= (digits ? .005 : .5)) {
        dir = direction === 'toward-zero'
          ? (Math.abs(after) < Math.abs(before) ? 'better' : 'worse')
          : (after > before ? 'better' : 'worse');
      }
      const deltaText = !available ? '—'
        : Math.abs(delta) < (digits ? .005 : .5) ? 'no change'
        : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(digits)}${unit.trim()}`;
      return `<div class="showcase-metric"><small>${label}</small><div class="showcase-values">`
        + `<span class="showcase-before">${fmt(before)}</span>`
        + `<span class="showcase-arrow" aria-hidden="true">&rarr;</span>`
        + `<strong class="showcase-after">${available ? fmt(after) : '—'}</strong>`
        + `<span class="showcase-delta"${dir ? ` data-dir="${dir}"` : ''}>${deltaText}</span>`
        + `</div></div>`;
    }

    function renderShowcase() {
      const p = state.params;
      const prediction = state.prediction || {};
      const available = prediction.applicabilityStatus === 'within_engineering_domain';
      const post = {
        ll: available ? prediction.newLL : p.ll,
        tk: available ? prediction.newTK : p.tk,
        cl: available ? prediction.newCL : p.cl,
        pt: available ? prediction.newPT : p.pt
      };

      const suppressed = $('showcaseSuppressed');
      if (suppressed) {
        suppressed.hidden = available;
        if (!available) {
          suppressed.textContent = `Modeled post-operative alignment is suppressed: ${prediction.reason || 'the current case falls outside the modeled engineering domain.'} Pre-operative values are shown alone.`;
        }
      }

      const subtitle = $('showcaseSubtitle');
      if (subtitle) {
        subtitle.textContent = state.itinerary.length
          ? `${state.itinerary.length} procedure${state.itinerary.length === 1 ? '' : 's'} applied to the authored pre-operative case.`
          : 'No procedures have been added yet, so the modeled post-operative state matches the pre-operative case.';
      }

      const alignment = $('showcaseAlignment');
      if (alignment) {
        alignment.innerHTML = [
          showcaseMetric({ label: 'Pelvic incidence', before: p.pi, after: p.pi }),
          showcaseMetric({ label: 'Lumbar lordosis', before: p.ll, after: post.ll, available }),
          showcaseMetric({ label: 'Thoracic kyphosis', before: p.tk, after: post.tk, available }),
          showcaseMetric({ label: 'Cervical lordosis', before: p.cl, after: post.cl, available }),
          showcaseMetric({ label: 'Pelvic tilt', before: p.pt, after: post.pt, direction: 'toward-zero', available }),
          showcaseMetric({ label: 'PI–LL mismatch', before: p.pi - p.ll, after: p.pi - post.ll, direction: 'toward-zero', available })
        ].join('');
      }
      // Modeled values beyond the ranges accepted for inputs and imaging are
      // extrapolated scenario values and are named as such.
      const domainNote = $('showcaseDomainNote');
      if (domainNote) {
        const outside = available
          ? [['LL', 'll'], ['TK', 'tk'], ['CL', 'cl'], ['PT', 'pt']].filter(([, key]) => {
              const limits = CASE_ALIGNMENT_LIMITS[key];
              return Number.isFinite(post[key]) && (post[key] < limits[0] || post[key] > limits[1]);
            })
          : [];
        domainNote.hidden = outside.length === 0;
        domainNote.textContent = outside.length
          ? `Modeled ${outside.map(([label, key]) => `${label} ${post[key].toFixed(0)}° (accepted range ${CASE_ALIGNMENT_LIMITS[key][0]}–${CASE_ALIGNMENT_LIMITS[key][1]}°)`).join(', ')} ${outside.length === 1 ? 'lies' : 'lie'} outside the range accepted for inputs and imaging. Treat ${outside.length === 1 ? 'it' : 'them'} as extrapolated scenario output.`
          : '';
      }

      const construct = $('showcaseConstruct');
      const count = $('showcaseConstructCount');
      if (count) count.textContent = String(state.itinerary.length);
      if (construct) {
        construct.innerHTML = state.itinerary.length
          ? state.itinerary.map(item => {
              const procedure = PROCEDURES[item.procedureId];
              const angle = Number(item.plannedAngle);
              const detail = Number.isFinite(angle) && angle !== 0 ? ` <span>· ${angle > 0 ? '+' : '−'}${Math.abs(angle)}° planned</span>` : '';
              return `<li>${procedure ? procedure.name : item.procedureId} at ${displayLevel(item.levelId)}${detail}</li>`;
            }).join('')
          : '<li class="showcase-empty">No procedures in the itinerary.</li>';
      }

      // Same cohort span as the gait panel: outside PT 13–24° the couplings are
      // extrapolated, so the rows lose their direction colouring and say why.
      const outsideCohort = value => Number.isFinite(value) && (value < 13 || value > 24);
      const extrapolatedPts = [p.pt, available ? post.pt : null].filter(outsideCohort);
      const gaitExtrapolated = extrapolatedPts.length > 0;
      const gaitHost = $('showcaseGait');
      if (gaitHost) {
        gaitHost.innerHTML = SHOWCASE_GAIT_ROWS.map(row => {
          const control = GAIT_NORMATIVE[row.control];
          const coupling = GAIT_COUPLING[row.coupling];
          return showcaseMetric({
            label: row.label,
            before: control * gaitFraction(coupling, p.pt),
            after: control * gaitFraction(coupling, post.pt),
            unit: row.unit, digits: row.digits ?? 0,
            direction: gaitExtrapolated ? null : 'toward-control', available
          });
        }).join('');
      }
      const gaitCaveat = $('showcaseGaitCaveat');
      if (gaitCaveat) {
        const values = [...new Set(extrapolatedPts.map(value => `${value.toFixed(0)}°`))];
        gaitCaveat.hidden = !gaitExtrapolated;
        gaitCaveat.textContent = gaitExtrapolated
          ? `Pelvic tilt ${values.join(' and ')} lies outside the published cohort span (13–24°). These gait figures are extrapolated beyond the source data, not interpolated within it, so no improvement or worsening is shown.`
          : '';
      }
    }

    function openShowcase() {
      const dialog = $('showcaseDialog');
      if (!dialog) return;
      renderShowcase();
      if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
      announce('Showcase summary opened.');
    }

    $('openShowcase')?.addEventListener('click', openShowcase);
    $('closeShowcase')?.addEventListener('click', () => $('showcaseDialog')?.close());

    function setGaitActive(active) {
      const button = $('toggleGait');
      const chip = $('gaitChip');
      const canWalk = Boolean(lowerExtremityContext && lowerExtremityContext.visible);
      if (active && !canWalk) {
        showToast('Enable the lower-extremity chain to animate gait');
        return;
      }
      gait.active = Boolean(active);
      gait.params = gait.active ? computeGaitParams() : null;
      if (!gait.active) {
        gait.phase = 0;
        targetPelvisRotationY = 0;
        if (lowerExtremityContext) lowerExtremityContext.userData.targetPositionY = 0;
        applyModelTargets(false);
      }
      if (button) button.setAttribute('aria-pressed', String(gait.active));
      if (chip) chip.hidden = !gait.active;
      if (gait.active) document.body.dataset.gaitActive = 'true';
      else delete document.body.dataset.gaitActive;
      renderGaitFlags();
      syncGaitExpanded();
      announce(gait.active
        ? 'Illustrative gait animation started. This is a kinematic display; no forces or muscle activity are modeled.'
        : 'Gait animation stopped.');
    }

    function animate(frameTime = 0) {
      window.requestAnimationFrame(animate);
      if (!renderer || !scene || !camera) return;
      if (document.hidden) {
        clock.getDelta();
        return;
      }
      const frameInterval = window.matchMedia('(max-width: 640px)').matches ? (1000 / 30) : 0;
      if (frameInterval && (frameTime - lastRenderedFrame) < frameInterval) return;
      lastRenderedFrame = frameTime;
      const dt = Math.min(clock.getDelta(), .05);
      applyGaitTargets(dt);
      const lambda = reducedMotion.matches ? 1000 : 9;
      pelvisGroup.rotation.x = dampValue(pelvisGroup.rotation.x, targetPelvisRotationX, lambda, dt);
      pelvisGroup.rotation.y = dampValue(pelvisGroup.rotation.y, targetPelvisRotationY, lambda, dt);
      pelvisGroup.rotation.z = dampValue(pelvisGroup.rotation.z, targetPelvisRotation, lambda, dt);
      if (sacralMorphologyRoot) {
        sacralMorphologyRoot.rotation.z = dampValue(
          sacralMorphologyRoot.rotation.z,
          targetSacralMorphologyRotation,
          lambda,
          dt
        );
        applySacralReferenceMorphologyTransform(sacralMorphologyRoot.rotation.z);
      }
      pelvisGroup.position.x = dampValue(pelvisGroup.position.x, targetPelvisPosition.x, lambda, dt);
      pelvisGroup.position.y = dampValue(pelvisGroup.position.y, targetPelvisPosition.y, lambda, dt);
      pelvisGroup.position.z = dampValue(pelvisGroup.position.z, targetPelvisPosition.z, lambda, dt);
      segmentRecords.forEach(record => {
        record.group.rotation.x = dampValue(record.group.rotation.x, record.group.userData.targetRotationX, lambda, dt);
        record.group.rotation.y = dampValue(record.group.rotation.y, record.group.userData.targetRotationY, lambda, dt);
        record.group.rotation.z = dampValue(record.group.rotation.z, record.group.userData.targetRotationZ, lambda, dt);
        record.group.position.x = dampValue(record.group.position.x, record.group.userData.targetPositionX, lambda, dt);
        record.group.position.z = dampValue(record.group.position.z, record.group.userData.targetPositionZ, lambda, dt);
        record.anatomyRoot.position.y = dampValue(record.anatomyRoot.position.y, record.anatomyRoot.userData.targetPositionY || 0, lambda, dt);
        updateDiscJointTransform(record);
      });
      lowerExtremityContext?.traverse(object => {
        if (object.userData?.targetRotationZ !== undefined) {
          object.rotation.z = dampValue(object.rotation.z, object.userData.targetRotationZ, lambda, dt);
        }
      });
      if (lowerExtremityContext) {
        lowerExtremityContext.position.x = dampValue(
          lowerExtremityContext.position.x,
          finiteOr(lowerExtremityContext.userData.targetPositionX),
          lambda,
          dt
        );
        lowerExtremityContext.rotation.x = dampValue(
          lowerExtremityContext.rotation.x,
          finiteOr(lowerExtremityContext.userData.targetRotationX),
          lambda,
          dt
        );
        // Gait raises and lowers the whole figure; zero at rest.
        lowerExtremityContext.position.y = dampValue(
          lowerExtremityContext.position.y,
          finiteOr(lowerExtremityContext.userData.targetPositionY),
          lambda,
          dt
        );
      }
      if (!stepCameraViewTween()) controls.update();
      syncCameraOrientationLabel();
      worldRoot.updateMatrixWorld(true);
      updateKinematicConstructBindings();
      worldRoot.updateMatrixWorld(true);
      updateReferenceLigamentContinuity();
      updateReferenceLines();
      positionPostoperativeSurveillanceMarkers();
      renderer.render(scene, camera);
    }

    function createCompatibleRenderer(canvas) {
      try {
        return new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      } catch (primaryError) {
        // A lower-cost context is more reliable on older phones, virtualized
        // desktops, and devices recovering from GPU pressure.
        try {
          const fallback = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'default' });
          fallback.domElement.dataset.quality = 'compatibility';
          return fallback;
        } catch (fallbackError) {
          fallbackError.message = `${fallbackError.message} (compatibility retry also failed)`;
          throw fallbackError;
        }
      }
    }

    function initializeThree() {
      try {
        const canvas = $('threeCanvas');
        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x07111f, .016);

        camera = new THREE.PerspectiveCamera(32, 1, CAMERA_LIMITS.near, CAMERA_LIMITS.far);
        renderer = createCompatibleRenderer(canvas);
        renderer.domElement.dataset.engine = `three.js r${THREE.REVISION}`;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = .075;
        controls.enablePan = true;
        controls.minDistance = CAMERA_LIMITS.minDistance;
        controls.maxDistance = CAMERA_LIMITS.spineMaxDistance;
        controls.zoomSpeed = 1.15;
        controls.zoomToCursor = true;
        if (controls.touches) {
          controls.touches.ONE = THREE.TOUCH.ROTATE;
          controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
        }
        controls.minPolarAngle = Math.PI * .24;
        controls.maxPolarAngle = Math.PI * .76;
        resetCameraView({ announceChange: false });

        const hemisphere = new THREE.HemisphereLight(0xdcecff, 0x142033, 1.35);
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(-8, 20, 15);
        const rim = new THREE.DirectionalLight(0x5ba7ff, 1.5);
        rim.position.set(10, 9, -10);
        scene.add(hemisphere, key, rim);

        worldRoot = new THREE.Group();
        worldRoot.name = 'kinematicSpineRoot';
        scene.add(worldRoot);
        inspectionRoot = new THREE.Group();
        inspectionRoot.name = 'inspectionRoot';
        inspectionRoot.visible = false;
        inspectionRoot.userData = { warning: 'Non-anatomic inspection layout—measurements, containment and collisions disabled.' };
        worldRoot.add(inspectionRoot);

        pelvisGroup = new THREE.Group();
        pelvisGroup.name = 'pelvis';
        pelvisGroup.userData.sacralSlope = 0;
        worldRoot.add(pelvisGroup);
        createPelvis();
        createLowerExtremityContext();

        const sacrumSourceAnchor = referenceAnchorFor('sacrum') || new THREE.Vector3();
        const spinalBaseSourceAnchor = createSacralMorphologyRoot(sacrumSourceAnchor);
        let parent = sacralMorphologyRoot;
        let parentSourceAnchor = spinalBaseSourceAnchor;
        CHAIN_LEVELS.forEach((level, chainIndex) => {
          const record = createVertebralSegment(level);
          installRecordRegionLayer(record);
          record.group.userData.chainIndex = chainIndex;
          record.group.traverse(object => { object.userData.levelId = level.id; });
          const sourceAnchor = motionSegmentPivotFor(level.id, level.superior);
          if (sourceAnchor) {
            record.group.position.copy(sourceAnchor).sub(parentSourceAnchor).multiplyScalar(REFERENCE_MM_TO_SCENE);
            parentSourceAnchor = sourceAnchor;
            record.group.userData.sourceAnchorAppMm = sourceAnchor.toArray();
            record.group.userData.millimetresToScene = REFERENCE_MM_TO_SCENE;
          } else {
            record.group.position.y = record.group.userData.chainIndex === 0 ? 0 : record.height;
          }
          record.group.userData.basePosition = record.group.position.clone();
          record.group.userData.targetPositionX = record.group.position.x;
          record.group.userData.targetPositionZ = record.group.position.z;
          record.group.userData.basePositionY = record.group.position.y;
          parent.add(record.group);
          segmentRecords.set(level.id, record);
          parent = record.anatomyRoot;
        });

        configurePelvicPosturePivot();
        createReferenceSystem();
        rebuildHardware();
        sceneReady = true;
        resizeRenderer();
        applyModelTargets(true);
        const startupIntegrity = auditSceneStructure();
        if (!startupIntegrity.passed) {
          throw new Error(`Scene integrity audit failed: ${startupIntegrity.errors.slice(0, 3).join(' | ')}`);
        }
        scene.userData.startupIntegrityAudit = startupIntegrity;
        resetCameraView({ announceChange: false });
        updateShapeStatus();
        updateCanvasDescription();

        renderer.domElement.addEventListener('dblclick', event => {
          const levelId = selectLevelAtClientPoint(event.clientX, event.clientY, 'level');
          if (levelId) announce(`${displayLevel(levelId)} isolated for inspection. Measurements, containment, and collision checks are disabled in inspection mode.`);
        });

        if ('ResizeObserver' in window) {
          const resizeObserver = new ResizeObserver(resizeRenderer);
          resizeObserver.observe($('viewport'));
        } else {
          window.addEventListener('resize', resizeRenderer, { passive: true });
        }
        renderer.domElement.addEventListener('webglcontextlost', event => {
          event.preventDefault();
          window.__showSpine3dError('The graphics context was interrupted. Keep the app visible and retry; mobile builds will restore after backgrounding when the device permits.');
          announce('The 3D context was lost. Numerical modeling remains available.');
        });
        renderer.domElement.addEventListener('webglcontextrestored', () => {
          els.canvasError.hidden = true;
          resizeRenderer();
          applyModelTargets(true);
          announce('The 3D visualization was restored.');
        });

        els.loadingState.hidden = true;
        els.canvasError.hidden = true;
        els.c7Label.hidden = state.layers?.measurements !== true;
        els.plumbLabel.hidden = state.layers?.measurements !== true;
        window.__spineModuleReady = true;
        animate();
      } catch (error) {
        sceneReady = false;
        window.__spineLastError = error instanceof Error ? error.message : String(error);
        console.error('[DeformitySim 3D initialization]', error);
        window.__showSpine3dError(`WebGL could not start on this device (${window.__spineLastError}). Numerical modeling remains available.`);
        window.__spineModuleReady = true;
      }
    }

