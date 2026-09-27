/* ---------------------------------------------------------------------------
   Showcase intro screen and guided auto-play demo.

   The tour drives the same public surface a presenter would click by hand
   (__SPINE_TEST__), so it can never show a result the UI cannot itself produce.
   Every chapter is idempotent: it fully re-establishes the state it needs, which
   makes arbitrary prev/next jumping safe.
--------------------------------------------------------------------------- */
(function () {
  'use strict';

  const byId = id => document.getElementById(id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const appShell = document.querySelector('.app-shell');

  const intro = {
    dialog: byId('introDialog'),
    start: byId('introStartDemo'),
    explore: byId('introExplore'),
    version: byId('introVersion'),
    build: byId('introBuild')
  };

  const bar = {
    root: byId('demoBar'),
    chapter: byId('demoChapter'),
    title: byId('demoTitle'),
    body: byId('demoBody'),
    fill: byId('demoProgressFill'),
    prev: byId('demoPrev'),
    next: byId('demoNext'),
    playPause: byId('demoPlayPause'),
    exit: byId('demoExit')
  };

  if (!intro.dialog || !bar.root) return;

  const api = () => window.__SPINE_TEST__ || null;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const scale = ms => reducedMotion.matches ? Math.min(ms, 1400) : ms;

  /* ---- small helpers over the app's public surface ---- */

  function goToStep(step) {
    const link = document.querySelector(`.workflow-nav a[data-step="${step}"]`);
    if (link) link.click();
  }

  function openPanelTab(panelId, tab) {
    const button = document.querySelector(`#${panelId} .panel-tab[data-tab="${tab}"]`);
    if (button) button.click();
  }

  function loadCase(caseId) {
    const test = api();
    if (!test?.applyCaseExample) return false;
    const select = byId('demoCaseSelect');
    if (select) {
      select.value = caseId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    try { test.applyCaseExample(caseId); return true; }
    catch (_) { return false; }
  }

  function setView(view) {
    const test = api();
    if (test?.setView) test.setView(view, false);
  }

  function orbit(on) {
    const controls = api()?.getControls?.();
    if (!controls) return;
    controls.autoRotate = Boolean(on) && !reducedMotion.matches;
    controls.autoRotateSpeed = 1.15;
  }

  function frameCamera() {
    try { api()?.resetCameraView?.({ announceChange: false }); } catch (_) { /* pre-scene */ }
  }

  // Applies the first suggested construct scenario that has a valid branch.
  // Returns a description of what was applied so the caption can name it.
  function applyFirstSuggestion() {
    const test = api();
    const options = test?.getState?.()?.constructComparisons || [];
    for (const option of options) {
      const branch = (option.branches || []).find(candidate => candidate.evaluation?.valid);
      if (!branch) continue;
      if (test.applyConstructComparisonBranch(option.id, branch.id)) {
        return { title: option.title, branch: branch.label, steps: branch.steps?.length || 0 };
      }
    }
    return null;
  }

  function metric(id) {
    return byId(id)?.textContent?.trim() || '—';
  }

  function procedureSummary() {
    const items = api()?.getState?.()?.itinerary || [];
    if (!items.length) return 'no procedures';
    const names = items.map(item => {
      const procedure = api()?.PROCEDURES?.[item.procedureId];
      return `${(procedure?.name || item.procedureId)} at ${String(item.levelId).replace('-', '–')}`;
    });
    return names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  }

  /* ---- chapter script ---- */

  const chapters = [
    {
      title: 'CT-derived reference anatomy',
      body: 'The scene is a parented kinematic chain from the feet to the skull, built from de-identified CT segmentation surfaces. Every joint below responds to the case measurements you author.',
      hold: 9000,
      async run() {
        goToStep('2');
        loadCase('neutral-reference');
        setView('pre');
        frameCamera();
        orbit(true);
      }
    },
    {
      title: 'A flatback case, entered as measurements',
      body: 'Loading a marked flatback pattern with lumbar collapse. Nothing is inferred from an image — pelvic incidence, lordosis, kyphosis, and tilt are explicit inputs that drive the geometry.',
      hold: 9500,
      async run() {
        goToStep('2');
        loadCase('flatback');
        setView('pre');
        orbit(true);
        await wait(scale(1200));
        this.body = `Marked flatback with lumbar collapse. The header now reads PI–LL ${metric('metricMismatch')}, well outside the reference band — the spine has lost the lordosis its pelvis requires.`;
        renderCaption();
      }
    },
    {
      title: 'Where the deformity shows up',
      body: 'Reference modifier bands grade PI–LL, measured SVA, and pelvic tilt separately. They describe the pattern; the app never fuses them into a diagnosis or a correction target.',
      hold: 8500,
      async run() {
        goToStep('2');
        orbit(false);
        frameCamera();
      }
    },
    {
      title: 'Suggested fixes appear automatically',
      body: 'The case pattern is matched to unranked construct scenarios, each carrying its own supporting study, study population, and stated limitations.',
      hold: 9500,
      async run() {
        goToStep('3');
        openPanelTab('surgicalItinerary', 'build');
        const card = document.querySelector('.construct-comparison-card');
        if (card) {
          card.open = true;
          card.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
        }
        const count = Number(metric('constructComparisonCount')) || 0;
        this.body = `${count} evidence-linked scenario${count === 1 ? '' : 's'} matched this flatback pattern. Each one shows why it surfaced, what it would change, and which clinical inputs are deliberately not evaluated here.`;
        renderCaption();
      }
    },
    {
      title: 'Applying a construct scenario',
      body: 'Applying a branch commits its whole sequence atomically, including any linked prerequisite the procedure requires.',
      hold: 10000,
      async run() {
        goToStep('3');
        openPanelTab('surgicalItinerary', 'build');
        const applied = applyFirstSuggestion();
        await wait(scale(700));
        this.body = applied
          ? `Applied “${applied.title}” — ${applied.branch}, ${applied.steps} step${applied.steps === 1 ? '' : 's'}. The itinerary now holds ${procedureSummary()}, each with catalog-dimensioned implants.`
          : `The itinerary now holds ${procedureSummary()}.`;
        renderCaption();
      }
    },
    {
      title: 'The modeled post-operative result',
      body: 'Switching to the modeled view rebuilds the chain with the planned corrections and renders the implants at their real catalog millimetre dimensions.',
      hold: 10500,
      async run() {
        goToStep('2');
        setView('post');
        frameCamera();
        orbit(true);
        await wait(scale(1400));
        this.body = `Modeled post-op: PI–LL is now ${metric('metricMismatch')}. Rods, screws and interbody cages are drawn from selected catalog sizes — a display of the authored plan, never a predicted surgical outcome.`;
        renderCaption();
      }
    },
    {
      title: 'Adult degenerative scoliosis',
      body: 'A three-plane case: coronal Cobb, apical translation, and axial rotation alongside multilevel disc-height loss and facet enlargement.',
      hold: 10000,
      async run() {
        goToStep('2');
        openPanelTab('surgicalItinerary', 'build');
        loadCase('degenerative-scoliosis');
        setView('pre');
        frameCamera();
        orbit(true);
        await wait(scale(1400));
        this.body = `Lumbar-major coronal asymmetry with a ${metric('contextCobb')} primary Cobb input and PI–LL ${metric('metricMismatch')}. Rotate the model and the curve reads in all three planes at once, not just on the front view.`;
        renderCaption();
      }
    },
    {
      title: 'A three-plane construct answer',
      body: 'Lateral interbody scenarios surface for coronal and axial patterns. Applying one seeds the level-specific coronal, axial, and translational changes it is authored to represent.',
      hold: 10500,
      async run() {
        goToStep('3');
        openPanelTab('surgicalItinerary', 'build');
        const applied = applyFirstSuggestion();
        await wait(scale(600));
        setView('post');
        this.body = applied
          ? `Applied “${applied.title}”. Modeled residual Cobb is now ${metric('contextCobb')} with ${procedureSummary()} in the construct.`
          : `Modeled residual Cobb is now ${metric('contextCobb')}.`;
        renderCaption();
      }
    },
    {
      title: 'Post-op construct review',
      body: 'The tool flags fusion boundaries, levels spanned by fixation, and unspanned posterior disruptions. These are topology and factor-presence labels — never probabilities, and never a prediction of failure.',
      hold: 10000,
      async run() {
        goToStep('3');
        openPanelTab('surgicalItinerary', 'review');
        setView('post');
        const details = document.querySelector('.review-disclosure');
        if (details) {
          details.open = true;
          details.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
        }
        const count = metric('surveillanceCount');
        this.body = `${count} construct review point${count === '1' ? '' : 's'} identified from the modeled topology. Implant stress, subsidence, and adjacent-segment risk stay locked behind a validation gate — a render mesh is never treated as a finite-element model.`;
        renderCaption();
      }
    },
    {
      title: 'Cervical deformity',
      body: 'The same engine covers the cervical spine, with C2–C7 measured separately from C1–C2 and its own Ames-style modifier bands.',
      hold: 9500,
      async run() {
        goToStep('2');
        openPanelTab('surgicalItinerary', 'build');
        loadCase('cervical-kyphosis');
        setView('pre');
        frameCamera();
        orbit(true);
      }
    },
    {
      title: 'Radiographs, measured locally',
      body: 'Standing images can be analysed in-browser: a paired-wall corridor tracer follows the vertebral column, regional endplate lines are fitted along it, and every point stays draggable for review. Files never leave the device, and CT intake is blocked as untested.',
      hold: 11000,
      async run() {
        goToStep('1');
        openPanelTab('patientParameters', 'library');
        orbit(false);
        const button = byId('openPatientImaging');
        if (button) button.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
      }
    },
    {
      title: 'Your turn',
      body: 'Every value here is an explicit, editable input. This is a research and teaching prototype — it does not diagnose, recommend treatment, or predict patient-specific outcomes. Exit the demo to start authoring your own case.',
      hold: 12000,
      async run() {
        goToStep('1');
        openPanelTab('patientParameters', 'cases');
        loadCase('neutral-reference');
        setView('pre');
        frameCamera();
        orbit(true);
      }
    }
  ];

  /* ---- tour runtime ---- */

  const tour = { index: 0, playing: false, active: false, timer: null, token: 0 };

  function renderCaption() {
    const chapter = chapters[tour.index];
    if (!chapter) return;
    bar.chapter.textContent = `Chapter ${tour.index + 1} / ${chapters.length}`;
    bar.title.textContent = chapter.title;
    bar.body.textContent = chapter.body;
    bar.fill.style.width = `${Math.round(((tour.index + 1) / chapters.length) * 100)}%`;
    bar.prev.disabled = tour.index === 0;
    bar.next.disabled = tour.index === chapters.length - 1;
    syncDemoBarHeight();
  }

  function clearTimer() {
    if (tour.timer) { clearTimeout(tour.timer); tour.timer = null; }
  }

  async function runChapter(index) {
    if (!tour.active) return;
    tour.index = Math.max(0, Math.min(chapters.length - 1, index));
    const chapter = chapters[tour.index];
    // Chapters mutate their own body text as measurements resolve; restore the
    // authored copy first so replays never show a previous run's numbers.
    if (chapter.defaultBody === undefined) chapter.defaultBody = chapter.body;
    chapter.body = chapter.defaultBody;

    clearTimer();
    const token = ++tour.token;
    renderCaption();
    try { await chapter.run(); } catch (_) { /* a failed chapter must not stall the tour */ }
    if (!tour.active || token !== tour.token) return;
    renderCaption();
    if (tour.playing) scheduleAdvance(scale(chapter.hold), token);
  }

  function scheduleAdvance(delay, token) {
    clearTimer();
    tour.timer = setTimeout(() => {
      if (!tour.active || token !== tour.token || !tour.playing) return;
      // Autoplay wraps so the tour can run unattended on a booth screen.
      // Manual prev/next stay bounded, so a presenter always knows where the
      // start and end are.
      runChapter(tour.index >= chapters.length - 1 ? 0 : tour.index + 1);
    }, delay);
  }

  function setPlaying(playing) {
    tour.playing = playing;
    bar.playPause.textContent = playing ? '❚❚' : '▶';
    bar.playPause.setAttribute('aria-label', playing ? 'Pause demo' : 'Resume demo');
    if (playing) scheduleAdvance(scale(chapters[tour.index]?.hold || 9000), tour.token);
    else clearTimer();
  }

  // The demo loads its own examples. A dirty case is confirmed first (the same
  // dialog as Load example), kept aside while the demo runs, and restored on
  // exit, so starting the demo never silently loses the user's work.
  async function startTour() {
    const test = api();
    if (!tour.active && test?.confirmCaseReplacement) {
      let accepted = true;
      try { accepted = await test.confirmCaseReplacement('Start guided demo', { restoresCase: true }); } catch (_) { accepted = true; }
      if (!accepted) return false;
    }
    if (!tour.active) {
      try { tour.savedCase = test?.captureCaseSession ? test.captureCaseSession() : null; } catch (_) { tour.savedCase = null; }
    }
    tour.active = true;
    tour.index = 0;
    bar.root.hidden = false;
    document.body.dataset.demoActive = 'true';
    if (appShell) appShell.dataset.demoActive = 'true';
    syncDemoBarHeight();
    setPlaying(true);
    runChapter(0);
    return true;
  }

  function exitTour() {
    tour.active = false;
    tour.playing = false;
    clearTimer();
    tour.token++;
    orbit(false);
    bar.root.hidden = true;
    delete document.body.dataset.demoActive;
    if (appShell) delete appShell.dataset.demoActive;
    const saved = tour.savedCase;
    tour.savedCase = null;
    if (saved) {
      try { api()?.restoreCaseSession?.(saved); } catch (_) { /* the demo case stays; Undo still reaches the user's case */ }
    }
    goToStep('1');
  }

  // Toasts are lifted above the demo bar, whose height changes with each
  // chapter's text, so they never cover the chapter copy or its controls.
  function syncDemoBarHeight() {
    const height = bar.root.hidden ? 0 : bar.root.offsetHeight;
    document.documentElement.style.setProperty('--demo-bar-height', `${height || 0}px`);
  }

  /* ---- wiring ---- */

  bar.playPause.addEventListener('click', () => setPlaying(!tour.playing));
  bar.next.addEventListener('click', () => { setPlaying(false); runChapter(tour.index + 1); });
  bar.prev.addEventListener('click', () => { setPlaying(false); runChapter(tour.index - 1); });
  bar.exit.addEventListener('click', exitTour);

  document.addEventListener('keydown', event => {
    if (!tour.active) return;
    // A dialog opened during the tour owns Escape, and Space/arrows belong to
    // whatever control has focus rather than to the chapter navigation.
    if (document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') { exitTour(); return; }
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, [contenteditable="true"], a[href]')) return;
    if (event.key === ' ') { event.preventDefault(); setPlaying(!tour.playing); }
    if (event.key === 'ArrowRight') { setPlaying(false); runChapter(tour.index + 1); }
    if (event.key === 'ArrowLeft') { setPlaying(false); runChapter(tour.index - 1); }
  });

  function dismissIntro() {
    if (intro.dialog.open) intro.dialog.close();
  }

  intro.start.addEventListener('click', () => { dismissIntro(); startTour(); });
  intro.explore.addEventListener('click', dismissIntro);

  function showIntro() {
    const manifest = window.__SPINE_TEST__?.MODEL_MANIFEST;
    if (manifest?.modelVersion && intro.version) intro.version.textContent = `v${manifest.modelVersion}`;
    if (manifest?.buildId && intro.build) intro.build.textContent = manifest.buildId;
    if (!intro.dialog.open) {
      try { intro.dialog.showModal(); } catch (_) { intro.dialog.setAttribute('open', ''); }
    }
    intro.start.focus({ preventScroll: true });
  }

  // Wait for the 3D scene so "Start guided demo" never lands on an empty viewport.
  function whenReady(callback) {
    let waited = 0;
    const poll = () => {
      if (window.__SPINE_TEST__ || waited >= 6000) { callback(); return; }
      waited += 120;
      setTimeout(poll, 120);
    };
    poll();
  }

  // A presenter can re-open the tour at any time from the header.
  function addRelaunchControl() {
    const help = byId('openHelp');
    if (!help || byId('openDemoTour')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'openDemoTour';
    button.className = 'help-button';
    button.title = 'Replay the guided demo';
    button.setAttribute('aria-label', 'Replay the guided demo');
    button.innerHTML = '<span aria-hidden="true">▶</span>';
    button.addEventListener('click', () => { if (tour.active) exitTour(); showIntro(); });
    help.insertAdjacentElement('beforebegin', button);
  }

  // The launch gate and the intro are both modal dialogs, and the top layer is
  // ordered by when showModal ran — so the intro has to wait for the unlock or
  // it would open on top of the gate.
  whenReady(() => {
    addRelaunchControl();
    const gate = window.__SPINE_GATE__;
    if (gate && !gate.isUnlocked()) { gate.onUnlock(showIntro); return; }
    showIntro();
  });

  window.__SPINE_DEMO__ = Object.freeze({
    chapters: chapters.map(chapter => chapter.title),
    start: startTour,
    exit: exitTour,
    goTo: index => { setPlaying(false); runChapter(index); },
    setPlaying,
    state: () => ({ index: tour.index, playing: tour.playing, active: tour.active }),
    showIntro
  });
})();
