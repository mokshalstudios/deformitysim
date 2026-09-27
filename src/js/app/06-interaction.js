    /* ---------------------------------------------------------------------
       5) INPUT, VIEW, CAMERA, AND DIALOG INTERACTIONS
    --------------------------------------------------------------------- */
    document.querySelectorAll('input[type="range"][data-param]').forEach(input => {
      syncSliderVisual(input);
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        state.params[input.dataset.param] = value;
        markAnatomyPresetCustom();
        syncSliderVisual(input);
        if (input.dataset.param === 'cl') syncCervicalModifierSummary();
        refreshApplication({ markPrediction: true });
      });
      input.addEventListener('change', () => {
        const label = input.closest('.parameter-row').querySelector('label').childNodes[0].textContent.trim();
        announce(`${label} set to ${input.value} degrees.`);
      });
    });

    /* Measured SVA is bounded to the same −30…30 cm domain as the imaging
       worksheet (F099); an out-of-range or unparsable entry is shown as an
       error and is never graded. Large values also get a unit hint, because
       most literature reports SVA in mm (F091). */
    els.measuredSvaInput.addEventListener('input', () => {
      const raw = els.measuredSvaInput.value.trim();
      syncMeasuredSvaHint();
      if (raw === '') {
        // A lone "-" reads as empty with badInput; it is a value in progress.
        setFieldError(els.measuredSvaInput, null);
        state.params.measuredSva = null;
        state.provenance.measuredSva = 'not_provided';
        markAnatomyPresetCustom();
        refreshApplication();
        return;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || !els.measuredSvaInput.validity.valid) {
        setFieldError(els.measuredSvaInput, 'Enter −30 to 30 cm. SVA here is in centimetres (45 mm = 4.5 cm).');
        state.params.measuredSva = null;
        state.provenance.measuredSva = 'not_provided';
        markAnatomyPresetCustom();
        refreshApplication();
        return;
      }
      setFieldError(els.measuredSvaInput, null);
      state.params.measuredSva = value;
      state.provenance.measuredSva = 'user_measured';
      markAnatomyPresetCustom();
      refreshApplication();
    });
    els.measuredSvaInput.addEventListener('change', () => {
      if (els.measuredSvaInput.getAttribute('aria-invalid') === 'true') {
        announce('Measured SVA must be −30 to 30 centimeters. The SVA reference modifier is unavailable until it is corrected.');
      } else if (state.params.measuredSva === null) {
        announce('Measured SVA cleared. The SVA reference modifier is unavailable.');
      } else {
        announce(`Measured pre-operative SVA set to ${signedNumber(state.params.measuredSva, 1)} centimeters.`);
      }
    });

    /* F097/F098. An empty field or a lone "-" is a value in progress: nothing
       is committed and nothing is written back (the sync skips the focused
       field), so "-20" can be typed. A complete but invalid value shows an
       inline range/step message instead of being silently ignored. Leaving
       the field restores the committed value and says so. */
    const bindThreePlaneCaseNumber = (input, stateKey, transform = value => value) => {
      const field = THREE_PLANE_CASE_FIELDS.find(candidate => candidate.elementKey === Object.keys(els).find(key => els[key] === input));
      const unit = field?.unit || '';
      input.addEventListener('input', () => {
        const raw = input.value.trim();
        if (raw === '') {
          setFieldError(input, null);
          return;
        }
        const value = Number(raw);
        if (!Number.isFinite(value) || !input.validity.valid) {
          setFieldError(input, numberFieldProblem(input, unit));
          return;
        }
        setFieldError(input, null);
        state.globalDeformity[stateKey] = transform(value);
        markAnatomyPresetCustom();
        syncAnatomyLabControls();
        refreshApplication({ markPrediction: true });
      });
      input.addEventListener('change', () => {
        const raw = input.value.trim();
        const value = Number(raw);
        const valid = raw !== '' && Number.isFinite(value) && input.validity.valid;
        const committed = field ? field.display(state.globalDeformity) : value;
        const problem = valid ? '' : numberFieldProblem(input, unit);
        // Write back what the model holds. Cobb fields have min=0, so a typed
        // negative is refused like any other out-of-range entry; the curve
        // direction is its own control.
        input.value = String(committed);
        if (valid) { setFieldError(input, null); return; }
        // Like the SVA and Age fields, the refusal stays visible after the
        // field is left, together with the value that was kept. The restored
        // value itself is valid, so the field is not marked invalid.
        const kept = `${field?.label || 'Value'} kept at ${committed}${unit.trim() === 'mm' ? ' mm' : '°'}.`;
        setFieldError(input, `${raw ? `${raw.slice(0, 16)} was not accepted. ` : ''}${problem ? `${problem} ` : ''}${kept}`);
        input.removeAttribute('aria-invalid');
        announce(`${kept} ${problem}`);
      });
    };
    bindThreePlaneCaseNumber(els.primaryCobbInput, 'coronalMagnitude', value => Math.abs(value));
    bindThreePlaneCaseNumber(els.compensatoryCobbInput, 'compensatoryCobb', value => Math.abs(value));
    bindThreePlaneCaseNumber(els.apicalTranslationInput, 'trunkShift');
    bindThreePlaneCaseNumber(els.primaryAxialRotationInput, 'axialRotation');
    els.primaryCurveDirection.addEventListener('change', () => {
      state.globalDeformity.coronalDirection = els.primaryCurveDirection.value === 'left' ? 'left' : 'right';
      markAnatomyPresetCustom();
      syncAnatomyLabControls();
      refreshApplication({ markPrediction: true });
    });
    els.secondaryFlexibilityInput.addEventListener('input', () => {
      const percent = Number(els.secondaryFlexibilityInput.value);
      if (!Number.isFinite(percent)) return;
      state.globalDeformity.secondaryFlexibility = Math.max(0, Math.min(100, percent)) / 100;
      markAnatomyPresetCustom();
      syncThreePlaneCaseControls();
      refreshApplication({ markPrediction: true });
    });
    els.coronalCompensationInput.addEventListener('change', () => {
      state.assumptions.applyCoronalCompensation = els.coronalCompensationInput.checked;
      refreshApplication({ markPrediction: true });
      announce(`Flexibility-weighted secondary-curve scenario response ${els.coronalCompensationInput.checked ? 'enabled' : 'disabled'}. This remains an unvalidated surrogate.`);
    });

    els.reciprocalAssumptionInput.addEventListener('change', () => {
      state.assumptions.applyReciprocalResponse = els.reciprocalAssumptionInput.checked;
      refreshApplication({ markPrediction: true });
      announce(`Reciprocal thoracic kyphosis response ${els.reciprocalAssumptionInput.checked ? 'enabled' : 'disabled'}; the pelvic balance (PT) response is always applied.`);
    });

    els.levelSelect.addEventListener('change', () => {
      const prior = els.procedureSelect.value;
      populateProcedureSelect(prior);
      els.procedureError.textContent = '';
      if (!state.inspection.active && ANATOMY_LEVEL_IDS.includes(els.levelSelect.value)) {
        state.inspection.levelId = els.levelSelect.value;
        labEls.levelSelect.value = state.inspection.levelId;
        syncAnatomyLabControls();
      }
    });
    els.procedureSelect.addEventListener('change', () => {
      updateImpactPreview();
      els.procedureError.textContent = '';
    });
    implantEls.cageCatalog.addEventListener('change', populateCageDimensionOptions);
    implantEls.screwDiameter.addEventListener('change', populateScrewLengthOptions);
    implantEls.graftFamily.addEventListener('change', populateGraftVolumeOptions);
    implantEls.customMode.addEventListener('change', () => {
      syncImplantModeUI({ seedCustom: implantEls.customMode.checked });
      els.procedureError.textContent = '';
      announce(implantEls.customMode.checked
        ? 'Custom user-entered dimensional envelope enabled. Catalog availability and clinical suitability are not inferred.'
        : 'Verified catalog dimension selectors restored.');
    });
    implantEls.supplementalPosterior.addEventListener('change', () => {
      updateImpactPreview();
      els.procedureError.textContent = '';
      announce(implantEls.supplementalPosterior.checked
        ? 'Bilateral posterior screw–rod fixation included in this interbody construct.'
        : 'Interbody-only construct selected. Posterior fixation is not included, and construct review will distinguish it from a posterior-supported fusion.');
    });
    [
      implantEls.customLabel, implantEls.customCageAp, implantEls.customCageMl,
      implantEls.customCageAnterior, implantEls.customCagePosterior,
      implantEls.customScrewDiameter, implantEls.customScrewLength,
      implantEls.customRodDiameter, implantEls.customRodLength,
      implantEls.customGraftLabel, implantEls.customGraftVolume
    ].forEach(input => input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      els.procedureError.textContent = '';
    }));
    els.correctionInput.addEventListener('input', () => {
      els.correctionInput.removeAttribute('aria-invalid');
      els.procedureError.textContent = '';
      state.editorCorrectionSource = 'user_planned';
      state.editorComparisonPrefill = null;
    });
    [els.coronalCorrectionInput, els.axialCorrectionInput, els.translationCorrectionInput].forEach(input => {
      input.addEventListener('input', () => {
        input.removeAttribute('aria-invalid');
        els.procedureError.textContent = '';
        state.editorCorrectionSource = els.correctionInput.disabled ? 'not_applicable' : 'user_planned';
        state.editorComparisonPrefill = null;
      });
    });
    els.procedureForm.addEventListener('submit', event => {
      event.preventDefault();
      addProcedure();
    });
    // While an item is being edited its saved implant plan is kept unless an
    // implant control is actually changed.
    [implantEls.config].forEach(root => ['change', 'input'].forEach(type => root?.addEventListener(type, () => {
      if (procedureEdit.itemId !== null) procedureEdit.implantTouched = true;
    })));
    $('cancelProcedureEdit')?.addEventListener('click', () => {
      cancelProcedureEdit();
      $('addProcedure')?.focus();
    });
    els.procedureForm.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || procedureEdit.itemId === null) return;
      event.preventDefault();
      event.stopPropagation();
      cancelProcedureEdit();
    });

    els.preViewButton.addEventListener('click', () => setView('pre'));
    els.postViewButton.addEventListener('click', () => setView('post'));
    /* Panel collapse and immersive view. Both resize the canvas container, so
       each one has to hand the renderer a resize; the viewport is sized from its
       element box, not the window, and nothing else would tell it to re-measure. */
    function setPanelCollapsed(side, collapsed) {
      const key = side === 'patient' ? 'panelPatient' : 'panelItinerary';
      if (collapsed) document.body.dataset[key] = 'collapsed';
      else delete document.body.dataset[key];
      const button = $(side === 'patient' ? 'togglePatientPanel' : 'toggleItineraryPanel');
      if (button) {
        button.setAttribute('aria-expanded', String(!collapsed));
        button.innerHTML = side === 'patient'
          ? (collapsed ? '&#9654;' : '&#9664;')
          : (collapsed ? '&#9664;' : '&#9654;');
        button.setAttribute('aria-label', `${collapsed ? 'Show' : 'Collapse'} the ${side === 'patient' ? 'case parameters' : 'procedure'} panel`);
      }
      resizeRenderer();
    }

    function panelCollapsed(side) {
      return document.body.dataset[side === 'patient' ? 'panelPatient' : 'panelItinerary'] === 'collapsed';
    }

    function setImmersive(active) {
      if (active) document.body.dataset.immersive = 'true';
      else delete document.body.dataset.immersive;
      const button = $('toggleImmersive');
      if (button) {
        button.setAttribute('aria-pressed', String(active));
        button.innerHTML = `<i class="fa-solid fa-${active ? 'compress' : 'expand'}" aria-hidden="true"></i>`;
      }
      setPanelCollapsed('patient', active);
      setPanelCollapsed('itinerary', active);
      announce(active
        ? 'Immersive view on. Panels and reference chrome hidden. Press Escape to exit.'
        : 'Immersive view off.');
    }

    $('togglePatientPanel')?.addEventListener('click', () => setPanelCollapsed('patient', !panelCollapsed('patient')));
    $('toggleItineraryPanel')?.addEventListener('click', () => setPanelCollapsed('itinerary', !panelCollapsed('itinerary')));
    $('toggleImmersive')?.addEventListener('click', () => setImmersive(document.body.dataset.immersive !== 'true'));

    /* Immersive hides every panel, and in the stacked layout the viewport is the
       only region step 2 shows — so leaving step 2 while immersive (the on-canvas
       "Edit scenario" button does exactly that) renders nothing at all, with the
       toggle that would undo it living inside the viewport that just went away.
       There is no Escape key on a phone. Leaving step 2 leaves immersive. */
    const immersiveShell = document.querySelector('.app-shell');
    if (immersiveShell) {
      new MutationObserver(() => {
        if (document.body.dataset.immersive !== 'true') return;
        if (immersiveShell.dataset.workflowStep === '2') return;
        if (!window.matchMedia('(max-width: 980px)').matches) return;
        setImmersive(false);
      }).observe(immersiveShell, { attributes: true, attributeFilter: ['data-workflow-step'] });
    }
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || document.body.dataset.immersive !== 'true') return;
      if (document.body.dataset.manualFocus === 'true') return;
      if (document.querySelector('dialog[open]')) return;   // an open dialog owns its own Esc
      if (state.inspection?.active === true) return;   // isolation exit claims Esc first
      event.preventDefault();
      setImmersive(false);
    });

    $('resetCamera').addEventListener('click', resetCameraView);
    els.toggleSurveillance.addEventListener('click', () => {
      setSurveillanceVisibility(!state.surveillance.visible);
    });
    els.closeSurveillanceInspector.addEventListener('click', () => {
      closeSurveillanceInspector();
      els.toggleSurveillance.focus();
    });
    els.inspectSurveillanceLevel.addEventListener('click', () => {
      const levelId = els.inspectSurveillanceLevel.dataset.levelId;
      if (!levelId || !sceneReady || !setInspectionSelection(levelId, 'level', false)) {
        announce('The 3D anatomy must be available before this surveillance level can be isolated.');
        return;
      }
      closeSurveillanceInspector({ restoreHighlight: false });
      labEls.levelSelect.value = levelId;
      syncAnatomyLabControls();
      announce(`${displayLevel(levelId)} isolated for reference inspection. Measurements, containment, collision checks, and stability inference are disabled.`);
    });
    els.toggleImplantDetails.addEventListener('click', () => {
      const expanded = implantEls.config.dataset.collapsed === 'true';
      implantEls.config.dataset.collapsed = String(!expanded);
      els.toggleImplantDetails.setAttribute('aria-expanded', String(expanded));
      els.toggleImplantDetails.textContent = expanded ? 'Hide sizes' : 'Adjust sizes';
      announce(`Implant and graft size controls ${expanded ? 'expanded' : 'collapsed'}.`);
    });

    function setLayerPanelOpen(open, { shouldAnnounce = true } = {}) {
      if (layerEls.panel.hidden === !open) return;
      layerEls.panel.hidden = !open;
      layerEls.toggle.setAttribute('aria-expanded', String(open));
      /* On a phone the panel occupies most of the canvas, so CSS needs a state
         it can use to stand the competing readouts down. A preceding sibling
         cannot be selected from the panel itself. */
      document.body.dataset.layersOpen = open ? 'true' : 'false';
      if (open) {
        // One popover at a time (the More menu closes the other way round).
        const moreMenu = document.querySelector('.viewport-more-menu');
        if (moreMenu && !moreMenu.hidden) {
          moreMenu.hidden = true;
          document.querySelector('#viewportMoreButton')?.setAttribute('aria-expanded', 'false');
        }
      }
      if (shouldAnnounce) announce(`Viewport layer controls ${open ? 'opened' : 'closed'}.`);
    }
    layerEls.toggle.addEventListener('click', event => {
      event.stopPropagation();
      setLayerPanelOpen(layerEls.panel.hidden);
    });
    // Close like the More menu does: outside click or Escape (F111).
    layerEls.panel.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => setLayerPanelOpen(false, { shouldAnnounce: false }));
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || layerEls.panel.hidden || document.querySelector('dialog[open]')) return;
      setLayerPanelOpen(false);
      layerEls.toggle.focus();
    });

    /* The legend lists only what is on screen (F111): the plumb lines with the
       measurement layer, ligaments and SI joints with theirs, and implants only
       when the itinerary has hardware to show. */
    function syncLegendLayers() {
      const legend = $('canvasLegend');
      if (!legend) return;
      const visible = {
        measurements: state.layers.measurements === true,
        bone: ['skull', 'cervical', 'thoracic', 'lumbar', 'pelvis'].some(key => state.layers[key] !== false),
        discs: state.layers.discs !== false,
        ligaments: state.layers.ligaments === true,
        siJoints: state.layers.siJoints === true && state.layers.pelvis !== false,
        implants: state.layers.implants !== false && state.itinerary.length > 0
      };
      legend.querySelectorAll('[data-legend-layer]').forEach(item => {
        item.hidden = visible[item.dataset.legendLayer] !== true;
      });
    }
    const layerLabels = Object.freeze({
      skull: 'Skull and occiput', cervical: 'Cervical spine', thoracic: 'Thoracic spine',
      lumbar: 'Lumbar spine', pelvis: 'Pelvis and sacrum', lowerLimbs: 'Lower limbs',
      discs: 'Disc envelopes', ligaments: 'Ligament pathways', siJoints: 'SI joint surfaces',
      measurements: 'Alignment reference lines', implants: 'Modeled implants'
    });
    Object.keys(layerLabels).forEach(key => {
      layerEls[key].addEventListener('change', () => {
        state.layers[key] = layerEls[key].checked;
        if (key === 'lowerLimbs') {
          state.globalDeformity.lowerExtremitiesVisible = state.layers.lowerLimbs;
          labEls.lowerExtremitiesVisible.checked = state.layers.lowerLimbs;
          if (controls) controls.maxDistance = state.layers.lowerLimbs
            ? CAMERA_LIMITS.fullBodyMaxDistance
            : CAMERA_LIMITS.spineMaxDistance;
        }
        if (sceneReady) updateSurgicalVisibility();
        if (sceneReady && key === 'lowerLimbs') resetCameraView({ announceChange: false });
        syncLegendLayers();
        announce(`${layerLabels[key]} ${state.layers[key] ? 'shown' : 'hidden'}.`);
      });
    });

    $('toggleLegend').addEventListener('click', event => {
      const button = event.currentTarget;
      const visible = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(visible));
      $('canvasLegend').hidden = !visible;
      announce(`Viewport legend ${visible ? 'shown' : 'hidden'}.`);
    });

    // Provenance chips (F105): the full sentence is the tooltip, and a click,
    // Enter or Space expands the chip in place instead of it being clipped.
    [els.shapeChip, els.geometryChip].forEach(chip => {
      if (!chip) return;
      const syncTitle = () => { if (chip.title !== chip.textContent) chip.title = chip.textContent; };
      syncTitle();
      if (typeof MutationObserver === 'function') new MutationObserver(syncTitle).observe(chip, { childList: true, characterData: true, subtree: true });
      const toggle = () => {
        const expanded = chip.dataset.expanded !== 'true';
        chip.dataset.expanded = String(expanded);
        chip.setAttribute('aria-expanded', String(expanded));
      };
      chip.addEventListener('click', toggle);
      chip.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
      });
    });

    const syncInteractionHint = () => {
      els.interactionHint.textContent = coarsePointer.matches ? 'Drag to rotate · Pinch to zoom' : 'Drag to rotate · Scroll to zoom';
    };
    syncInteractionHint();
    if (coarsePointer.addEventListener) coarsePointer.addEventListener('change', syncInteractionHint);

    els.editScenarioButton.addEventListener('click', () => {
      const panel = $('patientParameters');
      /* Small screens show one workflow region at a time, and this button only
         appears at step 2 — where the case panel is display:none and
         scrollIntoView therefore silently does nothing. The control has to move
         the workflow first; the step link scrolls the panel into view itself. */
      if (window.getComputedStyle(panel).display === 'none') {
        document.querySelector('.workflow-nav a[data-step="1"]')?.click();
      } else {
        panel.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      }
      window.setTimeout(() => $('piSlider').focus({ preventScroll: true }), reducedMotion.matches ? 0 : 320);
      announce('Scenario inputs opened.');
    });

    let hintDismissed = false;
    const dismissHint = () => {
      if (hintDismissed) return;
      hintDismissed = true;
      els.interactionHint.classList.add('is-hidden');
    };
    $('viewport').addEventListener('pointerdown', dismissHint, { once: true });
    $('viewport').addEventListener('wheel', dismissHint, { once: true, passive: true });

    // View presets (F108): buttons and keys 1-4 while the viewport has focus.
    const VIEW_PRESET_KEYS = Object.freeze({ 1: 'lateral', 2: 'ap', 3: 'pa', 4: 'oblique' });
    document.querySelectorAll('[data-view-preset]').forEach(button => {
      button.addEventListener('click', () => setCameraViewPreset(button.dataset.viewPreset));
    });

    $('viewport').addEventListener('keydown', event => {
      if (!camera || !controls) return;
      if (event.target?.closest?.('input:not([type="checkbox"]):not([type="radio"]), select, textarea, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'r' || key === '0') {
        event.preventDefault();
        resetCameraView();
        return;
      }
      if (VIEW_PRESET_KEYS[key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setCameraViewPreset(VIEW_PRESET_KEYS[key]);
        return;
      }
      const recognized = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', '+', '=', '-', '_'].includes(key);
      if (!recognized) return;
      event.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (key === 'arrowleft') spherical.theta -= .07;
      if (key === 'arrowright') spherical.theta += .07;
      if (key === 'arrowup') spherical.phi = Math.max(controls.minPolarAngle, spherical.phi - .06);
      if (key === 'arrowdown') spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + .06);
      if (key === '+' || key === '=') {
        zoomCameraByFactor(.76);
        return;
      }
      if (key === '-' || key === '_') {
        zoomCameraByFactor(1.32);
        return;
      }
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      controls.update();
    });

    $('toggleGait').addEventListener('click', () => setGaitActive(!gait.active));
    demoEls.select.addEventListener('change', syncCaseExamplePreview);
    // Reset and Load example replace the whole case: they confirm first when
    // there is something to lose (F094), and Undo brings the case back.
    demoEls.reset.addEventListener('click', async () => {
      if (!(await confirmCaseReplacement('Reset to neutral reference'))) {
        announce('Reset cancelled. The current case is unchanged.');
        return;
      }
      demoEls.select.value = 'neutral-reference';
      applyCaseExample('neutral-reference');
      demoEls.reset.blur();
    });
    demoEls.load.addEventListener('click', async () => {
      // Capture the selection at click time; the deferred load must not pick up a
      // different case if the dropdown changes during the loading delay.
      const requestedCaseId = demoEls.select.value;
      if (!(await confirmCaseReplacement('Load example'))) {
        announce('Example not loaded. The current case is unchanged.');
        return;
      }
      demoEls.load.disabled = true;
      demoEls.loadText.textContent = 'Loading selected example...';
      window.setTimeout(() => {
        try {
          applyCaseExample(requestedCaseId);
        } catch (_) {
          showToast('Example case could not be loaded');
          announce('The selected example failed its state validation and no example was applied.');
        } finally {
          demoEls.load.disabled = false;
          demoEls.loadText.textContent = 'Load selected example';
        }
      }, reducedMotion.matches ? 0 : 160);
    });

    const helpDialog = $('helpDialog');
    $('openHelp').addEventListener('click', () => helpDialog.showModal());
    $('closeHelp').addEventListener('click', () => helpDialog.close());
    helpDialog.addEventListener('click', event => {
      // A keyboard activation reports detail 0 and clientX/Y 0, which reads as a
      // click far outside the dialog; native <select> popups report their
      // coordinates the same way. Only a real pointer press on the backdrop
      // (target is the dialog itself) closes it.
      if (event.target !== helpDialog || event.detail === 0) return;
      const bounds = helpDialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) helpDialog.close();
    });

    /* ---- Case history, case files and case summary (F094/F095) ---- */
    ['undoCase', 'undoCaseMenu'].forEach(id => $(id)?.addEventListener('click', () => undoCaseEdit()));
    ['redoCase', 'redoCaseMenu'].forEach(id => $(id)?.addEventListener('click', () => redoCaseEdit()));
    // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y). Text fields keep their own
    // native text undo, and an open dialog owns the keyboard.
    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (event.target?.closest?.('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) redoCaseEdit();
      else undoCaseEdit();
    });

    const caseFileButton = $('caseFileButton');
    const caseFileMenu = $('caseFileMenu');
    const caseFileInput = $('caseFileInput');
    function setCaseFileMenuOpen(open) {
      if (!caseFileMenu || !caseFileButton) return;
      caseFileMenu.hidden = !open;
      caseFileButton.setAttribute('aria-expanded', String(open));
    }
    caseFileButton?.addEventListener('click', event => {
      event.stopPropagation();
      const open = caseFileMenu.hidden;
      if (open) {
        const status = $('caseFileStatus');
        if (status && status.dataset.state !== 'error') status.hidden = true;
      }
      setCaseFileMenuOpen(open);
      if (open) caseFileMenu.querySelector('button:not(:disabled)')?.focus();
    });
    caseFileMenu?.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => { if (caseFileMenu && !caseFileMenu.hidden) setCaseFileMenuOpen(false); });
    caseFileMenu?.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setCaseFileMenuOpen(false);
      caseFileButton.focus();
    });
    $('saveCaseButton')?.addEventListener('click', () => {
      setCaseFileMenuOpen(false);
      saveCaseFile();
    });
    $('openCaseButton')?.addEventListener('click', () => {
      if (caseFileInput) {
        caseFileInput.value = '';
        caseFileInput.click();
      }
    });
    caseFileInput?.addEventListener('change', async () => {
      const file = caseFileInput.files?.[0];
      if (!file) return;
      const result = await openCaseFile(file);
      caseFileInput.value = '';
      setCaseFileMenuOpen(Boolean(result && !result.ok));
    });
    $('copyCaseSummaryButton')?.addEventListener('click', () => {
      setCaseFileMenuOpen(false);
      copyCaseSummary();
    });
    $('closeCaseSummary')?.addEventListener('click', () => $('caseSummaryDialog')?.close());
    [$('caseSummaryDialog'), $('confirmCaseDialog')].forEach(dialog => dialog?.addEventListener('click', event => {
      if (event.target !== dialog || event.detail === 0) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }));

    // A .json case file can be dropped anywhere on the workspace. Other files
    // are refused here (imaging goes through its own dialog), and a stray drop
    // no longer navigates away and discards the session.
    const workspaceDragHasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
    const isCaseFileCandidate = file => Boolean(file) && (/\.json$/i.test(file.name || '') || file.type === 'application/json');
    const imagingDialogOpen = () => $('patientImagingDialog')?.open === true;
    document.addEventListener('dragover', event => {
      if (!workspaceDragHasFiles(event) || imagingDialogOpen()) return;
      event.preventDefault();
      const blocked = Boolean(document.querySelector('dialog[open]'));
      event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
      if (!blocked) document.body.dataset.caseDrop = 'true';
    });
    document.addEventListener('dragleave', event => {
      if (event.relatedTarget && document.documentElement.contains(event.relatedTarget)) return;
      delete document.body.dataset.caseDrop;
    });
    document.addEventListener('drop', async event => {
      delete document.body.dataset.caseDrop;
      if (!workspaceDragHasFiles(event) || imagingDialogOpen()) return;
      event.preventDefault();
      if (document.querySelector('dialog[open]')) return;
      const files = Array.from(event.dataTransfer.files || []);
      const caseFile = files.find(isCaseFileCandidate);
      if (!caseFile) {
        showToast('Drop a .json case file here');
        announce('Only saved .json case files can be dropped on the workspace. Load radiographs or CT from Examples & import.');
        return;
      }
      const result = await openCaseFile(caseFile);
      if (result && !result.ok) setCaseFileMenuOpen(true);
    });

    // Optional age (F081): display-only Lafage 2016 reference, no model input.
    const ageInput = $('ageInput');
    ageInput?.addEventListener('input', () => {
      const raw = ageInput.value.trim();
      const value = Number(raw);
      if (raw === '') {
        setFieldError(ageInput, null);
        state.demographics = { ageYears: null };
      } else if (!Number.isFinite(value) || !ageInput.validity.valid) {
        setFieldError(ageInput, 'Enter a whole-number age from 18 to 100 years.');
        state.demographics = { ageYears: null };
      } else {
        setFieldError(ageInput, null);
        state.demographics = { ageYears: value };
      }
      renderAgeReference();
      scheduleCaseCheckpoint();
    });

    demoEls.openImaging.addEventListener('click', () => {
      syncPatientImagingControls();
      if (!imagingEls.dialog.open) imagingEls.dialog.showModal();
    });
    imagingEls.close.addEventListener('click', () => imagingEls.dialog.close());
    imagingEls.dialog.addEventListener('click', event => {
      if (event.target !== imagingEls.dialog || event.detail === 0) return;
      const bounds = imagingEls.dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) imagingEls.dialog.close();
    });
    document.querySelectorAll('input[name="imagingPath"]').forEach(input => input.addEventListener('change', syncPatientImagingControls));
    imagingEls.authorization.addEventListener('change', syncPatientImagingControls);
    imagingEls.frontalInput.addEventListener('change', () => handleImagingInputChange('frontal'));
    imagingEls.lateralInput.addEventListener('change', () => handleImagingInputChange('lateral'));
    imagingEls.ctInput.addEventListener('change', () => {
      patientImagingSession.ctFiles = Array.from(imagingEls.ctInput.files || []);
      renderImagingFileStatus();
    });
    if (imagingEls.supineInput) imagingEls.supineInput.addEventListener('change', () => {
      handleImagingInputChange('supine');
      // Landmarks belong to the film they were placed on; a new supine image
      // must not inherit the previous one's points or flexibility comparison.
      window.__SPINE_AUTOCAL__?.resetSupineLandmarks?.();
      window.__SPINE_AUTOCAL__?.refreshSupine?.();
    });
    [imagingEls.removeFrontal, imagingEls.removeLateral].forEach(button => button?.addEventListener('click', () => {
      assignImagingFile(button.dataset.removeSlot, null);
      setImagingAssignNote('');
    }));
    imagingEls.swap?.addEventListener('click', swapImagingViews);
    imagingEls.laterality?.addEventListener('change', () => {
      applyFrontalLaterality(imagingEls.laterality.value, 'user');
      refreshImagingPreflight();
    });
    imagingEls.frontalProjection.addEventListener('change', mirrorFrontalProjection);
    document.querySelectorAll('.imaging-coverage-input').forEach(input => input.addEventListener('change', () => { input.dataset.userSet = 'true'; }));
    imagingEls.autoRun?.addEventListener('change', () => {
      imagingEls.stage.textContent = imagingEls.autoRun.checked ? 'Stage & analyze' : 'Stage films';
      refreshImagingPreflight();
    });

    // Drag-and-drop and clipboard paste. Nothing is read before the statement
    // in step 1 is ticked, and no file ever leaves the page.
    const dragHasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
    imagingEls.dialog.addEventListener('dragover', event => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = imagingEls.authorization.checked ? 'copy' : 'none';
      if (imagingEls.dropZone) imagingEls.dropZone.dataset.dragging = 'true';
    });
    imagingEls.dialog.addEventListener('dragleave', event => {
      if (event.relatedTarget && imagingEls.dialog.contains(event.relatedTarget)) return;
      if (imagingEls.dropZone) delete imagingEls.dropZone.dataset.dragging;
    });
    imagingEls.dialog.addEventListener('drop', event => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      if (imagingEls.dropZone) delete imagingEls.dropZone.dataset.dragging;
      acceptImagingFiles(event.dataTransfer.files, { targetSlot: imagingSlotFromElement(event.target), origin: 'drop' });
    });
    // A file dropped beside the dialog would otherwise make the browser
    // navigate to it and discard the whole session.
    ['dragover', 'drop'].forEach(type => window.addEventListener(type, event => {
      if (imagingEls.dialog.open && dragHasFiles(event)) event.preventDefault();
    }));
    let lastImagingSlot = null;
    imagingEls.dialog.addEventListener('focusin', event => { lastImagingSlot = imagingSlotFromElement(event.target) || lastImagingSlot; });
    imagingEls.dialog.addEventListener('pointerdown', event => { lastImagingSlot = imagingSlotFromElement(event.target) || lastImagingSlot; });
    document.addEventListener('paste', event => {
      if (!imagingEls.dialog.open) return;
      const files = Array.from(event.clipboardData?.files || []);
      if (!files.length) return;
      event.preventDefault();
      acceptImagingFiles(files.slice(0, 1), { targetSlot: lastImagingSlot, origin: 'paste' });
    });

    imagingEls.stage.addEventListener('click', stagePatientImagingFromSession);
    imagingEls.measurementPrefill.addEventListener('click', prefillImagingMeasurementsFromCurrentCase);
    imagingEls.measurementApply.addEventListener('click', applyImagingMeasurementsToModel);
    RADIOGRAPHIC_MEASUREMENT_FIELDS.forEach(field => imagingEls[field.elementKey].addEventListener('input', () => {
      imagingEls[field.elementKey].removeAttribute('aria-invalid');
      // PT >= PI is flagged while typing, not only when Apply refuses it.
      const pelvicError = ['pi', 'pt'].includes(field.key) ? imagingPelvicConsistencyError() : null;
      if (pelvicError) {
        imagingEls.measurementPt.setAttribute('aria-invalid', 'true');
        setImagingMeasurementStatus(pelvicError, 'error');
        return;
      }
      if (['pi', 'pt'].includes(field.key)) imagingEls.measurementPt.removeAttribute('aria-invalid');
      setImagingMeasurementStatus('Measurement edits are not applied until you choose Apply measurements & review model.', 'idle');
    }));
    imagingEls.measurementPrimaryDirection.addEventListener('change', () => setImagingMeasurementStatus('Measurement edits are not applied until you choose Apply measurements & review model.', 'idle'));
    imagingEls.requestClear?.addEventListener('click', requestPatientImagingClear);
    imagingEls.cancelClear?.addEventListener('click', cancelPatientImagingClear);
    imagingEls.clear.addEventListener('click', () => {
      clearPatientImagingSession();
      imagingEls.requestClear?.focus?.();
      announce('All app-held local imaging references were released. Browser and operating-system secure erasure cannot be guaranteed.');
    });
    // The statement in step 1 lasts for the page session only.
    window.addEventListener('pagehide', () => {
      clearPatientImagingSession();
      imagingEls.authorization.checked = false;
      imagingEls.pixelReview.checked = false;
    });
    const autoLandmarkStatus = document.getElementById('autoLandmarkStatus');
    if (autoLandmarkStatus && typeof MutationObserver === 'function') {
      new MutationObserver(syncImagingRunBar).observe(autoLandmarkStatus, { attributes: true, attributeFilter: ['data-state'], childList: true, characterData: true, subtree: true });
    }
    syncPatientImagingControls();

    const openAnatomyLab = () => {
      if (!labEls.levelSelect.options.length) populateAnatomyLevelSelect();
      if (!state.inspection.active && ANATOMY_LEVEL_IDS.includes(els.levelSelect.value)) {
        state.inspection.levelId = els.levelSelect.value;
        labEls.levelSelect.value = state.inspection.levelId;
      }
      syncAnatomyLabControls();
      if (!labEls.dialog.open) labEls.dialog.showModal();
    };
    const closeAnatomyLab = () => {
      if (labEls.dialog.open) labEls.dialog.close();
    };

    labEls.open.addEventListener('click', openAnatomyLab);
    labEls.close.addEventListener('click', closeAnatomyLab);
    labEls.dialog.addEventListener('click', event => {
      if (event.target !== labEls.dialog || event.detail === 0) return;
      const bounds = labEls.dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeAnatomyLab();
    });

    labEls.preset.addEventListener('change', () => applyAnatomyPreset(labEls.preset.value));
    labEls.coronalDirection.addEventListener('change', () => {
      state.globalDeformity.coronalDirection = labEls.coronalDirection.value === 'left' ? 'left' : 'right';
      markAnatomyPresetCustom();
      syncThreePlaneCaseControls();
      refreshApplication({ markPrediction: true });
      announce(`Coronal curve direction set to apex ${state.globalDeformity.coronalDirection}.`);
    });
    labEls.lowerExtremitiesVisible.addEventListener('change', () => {
      const visible = labEls.lowerExtremitiesVisible.checked;
      state.globalDeformity.lowerExtremitiesVisible = visible;
      state.layers.lowerLimbs = visible;
      layerEls.lowerLimbs.checked = visible;
      markAnatomyPresetCustom();
      if (typeof setLowerExtremityVisibility === 'function' && sceneReady) setLowerExtremityVisibility(visible, true);
      else invokePathologyHook();
      announce(`Lower-extremity reference context ${visible ? 'shown' : 'hidden'}. Posture values remain manually authored.`);
    });
    LAB_GLOBAL_RANGES.forEach(field => {
      labEls[field.inputKey].addEventListener('input', () => updateGlobalAnatomyFactor(field));
    });

    labEls.levelSelect.addEventListener('change', () => {
      state.inspection.levelId = labEls.levelSelect.value;
      if (state.inspection.active && typeof setInspectionSelection === 'function') {
        setInspectionSelection(state.inspection.levelId, state.inspection.scope, state.inspection.explode);
      }
      syncAnatomyLabControls();
    });
    labEls.morphologyVariant.addEventListener('change', () => {
      const levelId = labEls.levelSelect.value;
      if (!state.levelFactors[levelId]) return;
      state.levelFactors[levelId].morphologyVariant = MORPHOLOGY_VARIANTS.includes(labEls.morphologyVariant.value)
        ? labEls.morphologyVariant.value
        : 'typical';
      markAnatomyPresetCustom();
      summarizeCurrentLevel();
      invokePathologyHook();
      announce(`${labLevelLabel(levelId)} reference shape transformed. Topology, enumeration, and diagnosis remain unverified.`);
    });
    LAB_LEVEL_RANGES.forEach(field => {
      labEls[field.inputKey].addEventListener('input', () => updateCurrentLevelFactor(field));
    });

    document.querySelectorAll('input[name="inspectionScope"]').forEach(input => {
      input.addEventListener('change', () => {
        state.inspection.scope = selectedInspectionScope();
        syncInspectionSummary();
        if (state.inspection.active && typeof setInspectionSelection === 'function') {
          setInspectionSelection(state.inspection.levelId, state.inspection.scope, state.inspection.explode);
        }
      });
    });
    labEls.inspectionExplode.addEventListener('change', () => {
      state.inspection.explode = labEls.inspectionExplode.checked;
      syncInspectionSummary();
      if (state.inspection.active && typeof setInspectionSelection === 'function') {
        setInspectionSelection(state.inspection.levelId, state.inspection.scope, state.inspection.explode);
      }
    });
    labEls.inspect.addEventListener('click', () => {
      const levelId = labEls.levelSelect.value;
      const scope = selectedInspectionScope();
      const explode = labEls.inspectionExplode.checked;
      const applied = typeof setInspectionSelection === 'function' && setInspectionSelection(levelId, scope, explode);
      if (!applied) {
        announce('The 3D anatomy must be available before a level can be isolated.');
        return;
      }
      syncAnatomyLabControls();
      closeAnatomyLab();
      const isolatedLabel = scope === 'body' ? `${LEVEL_BY_ID.get(levelId)?.superior || labLevelLabel(levelId)} only` : `${labLevelLabel(levelId)} motion segment`;
      announce(`${isolatedLabel} isolated. ${explode ? 'Non-anatomic inspection layout; measurements, containment and collisions are disabled.' : 'Reference placement only; containment is not assessed.'}`);
    });
    $('inspectExitButton')?.addEventListener('click', () => {
      if (typeof exitInspectionMode === 'function') exitInspectionMode();
      syncAnatomyLabControls();
      announce('Full reference construct restored.');
    });

    // Esc is the reflex for "get me out of this focused view". Manual calibration
    // focus mode owns Esc while it is up, so isolation only claims it otherwise.
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (document.body.dataset.manualFocus === 'true') return;
      if (document.querySelector('dialog[open]')) return;   // an open dialog owns its own Esc
      if (state.inspection?.active !== true) return;
      event.preventDefault();
      exitInspectionMode();
      syncAnatomyLabControls();
      announce('Full reference construct restored.');
    });

    labEls.restore.addEventListener('click', () => {
      if (typeof exitInspectionMode === 'function') exitInspectionMode();
      else state.inspection.active = false;
      syncAnatomyLabControls();
      closeAnatomyLab();
      announce('Full reference construct restored in its authored pose.');
    });
    labEls.resetCurrent.addEventListener('click', resetCurrentAnatomyLevel);
    labEls.resetAll.addEventListener('click', resetAllAnatomyFactors);

    function auditSceneStructure() {
      const errors = [];
      const counts = {
        objects: 0,
        meshes: 0,
        vertices: 0,
        indices: 0,
        records: segmentRecords.size,
        visibleBoneRepresentations: 0
      };
      const finiteArray = values => Array.from(values || []).every(Number.isFinite);
      const descendantOf = (object, ancestor) => {
        let current = object;
        while (current) {
          if (current === ancestor) return true;
          current = current.parent;
        }
        return false;
      };
      const push = (condition, message) => {
        if (!condition) errors.push(message);
      };

      if (!scene || !worldRoot || !pelvisGroup) {
        return { passed: false, errors: ['The root scene has not been initialized.'], counts };
      }
      worldRoot.updateMatrixWorld(true);
      scene.traverse(object => {
        counts.objects += 1;
        push(finiteArray(object.position?.toArray?.()), `${object.name || object.type}: non-finite position`);
        push(finiteArray(object.quaternion?.toArray?.()), `${object.name || object.type}: non-finite quaternion`);
        push(finiteArray(object.scale?.toArray?.()), `${object.name || object.type}: non-finite scale`);
        push(finiteArray(object.matrixWorld?.elements), `${object.name || object.type}: non-finite world matrix`);
        if (object.scale?.isVector3) {
          push(object.scale.toArray().every(value => value > 0), `${object.name || object.type}: zero or negative display scale`);
        }
        push(!String(object.name || '').startsWith('marginalOsteophyte:'), `${object.name}: retired detached osteophyte solid remains in scene`);
        if (!object.isMesh) return;
        counts.meshes += 1;
        const position = object.geometry?.getAttribute?.('position');
        push(Boolean(position && position.count > 0), `${object.name || 'mesh'}: missing position geometry`);
        if (!position) return;
        counts.vertices += position.count;
        push(finiteArray(position.array), `${object.name || 'mesh'}: non-finite vertex buffer`);
        const index = object.geometry.getIndex?.();
        if (index) {
          counts.indices += index.count;
          push(finiteArray(index.array), `${object.name || 'mesh'}: non-finite index buffer`);
          let maximumIndex = -1;
          for (let cursor = 0; cursor < index.array.length; cursor += 1) {
            if (index.array[cursor] > maximumIndex) maximumIndex = index.array[cursor];
          }
          push(maximumIndex < position.count, `${object.name || 'mesh'}: geometry index exceeds vertex count`);
        }
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        push(Boolean(box && !box.isEmpty() && finiteArray([...box.min.toArray(), ...box.max.toArray()])),
          `${object.name || 'mesh'}: invalid local bounding box`);
      });

      segmentRecords.forEach((record, levelId) => {
        push(record.group?.parent != null, `${levelId}: kinematic group is detached`);
        push(record.anatomyRoot?.parent === record.group, `${levelId}: anatomy root is not owned by its kinematic group`);
        [
          record.referenceLayer, record.topsPostoperativeReferenceLayer,
          record.disc, record.body, record.endplates, record.posteriorElement,
          record.ligaments?.layer, record.cutSurfaces, record.decompressionVoid,
          record.interbodyResectionEnvelope, record.osteotomyRemnants,
          record.hardwareLayer, record.osteophytes
        ].filter(Boolean).forEach(root => {
          push(descendantOf(root, record.anatomyRoot) || root === record.disc && descendantOf(root, record.group),
            `${levelId}: ${root.name || root.type} escaped its record hierarchy`);
        });
        const intactVisible = objectVisibleInHierarchy(record.referenceLayer);
        const postoperativeVisible = objectVisibleInHierarchy(record.topsPostoperativeReferenceLayer);
        const semanticVisible = [record.body, record.endplates, record.posteriorElement]
          .some(root => objectVisibleInHierarchy(root));
        const visibleRepresentations = [intactVisible, postoperativeVisible, semanticVisible].filter(Boolean).length;
        counts.visibleBoneRepresentations += visibleRepresentations;
        push(visibleRepresentations <= 1, `${levelId}: multiple bone representations are visible simultaneously`);
        if (record.referenceLayer?.children?.length) {
          const sourceBoundedCompleteBodyResection = state.view === 'post'
            && record.bodyResected === true
            && record.geometryMode === 'schematic_morph_fallback';
          push(sourceBoundedCompleteBodyResection
              || !['procedural_fallback', 'semantic_surgical_fallback', 'schematic_morph_fallback'].includes(record.geometryMode),
            `${levelId}: a CT-backed level was replaced by unsupported schematic geometry`);
        }
        push(record.osteophytes?.children?.length === 0 && record.osteophytes?.visible === false,
          `${levelId}: invented osteophyte geometry is present`);
        if (record.ligaments?.layer?.visible) {
          push(record.ligaments.layer.userData.liveContinuityValid !== false,
            `${levelId}: a discontinuous ligament layer is visible`);
        }
        if (record.decompressionVoid?.userData?.authoredCanalShapeWithheld) {
          const surgical = state.view === 'post' && (
            record.decompressed || record.topsReconstruction || record.topsAdjacentResection
            || ['osteotomy_post', 'osteotomy_wedge'].includes(record.osteotomyType)
          );
          push(!record.decompressionVoid.visible || surgical,
            `${levelId}: canal factor is incorrectly displayed as a surgical resection solid`);
        }
        record.hardwareLayer?.traverse(object => {
          if (object.userData?.liveBindingValid === false) {
            push(object.visible === false, `${levelId}: a construct with a failed live binding remains visible`);
          }
        });
      });

      push(pelvisGroup.parent === worldRoot, 'Pelvis group is detached from the world root');
      push(sacralMorphologyRoot?.parent === pelvisGroup, 'Sacral morphology root is detached from the pelvis');
      if (lowerExtremityContext) push(lowerExtremityContext.parent === worldRoot, 'Lower-extremity context is detached from the world root');
      if (pelvisGroup.userData.pelvicReferenceContextWithheld) {
        [siJointLayer, pelvisLigamentLayer, pelvicHardwareLayer].forEach(root => {
          push(!objectVisibleInHierarchy(root), `${root?.name || 'pelvic overlay'} remains visible during unsupported PI morphology`);
        });
      }
      return { passed: errors.length === 0, errors, counts };
    }

