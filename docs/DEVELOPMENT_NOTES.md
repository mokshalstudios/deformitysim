# Guided auto-landmark beta notes (v0.19.1)

> Audit note (2026-07-28): this file is a development chronology. Statements in
> older sections describe the build at that point in time and are not a current
> validation claim. The current executable contract and regression counts are in
> `TESTING_README.md` and the automated harnesses. In particular, gait values are
> cross-sectional cohort interpolations—not causal treatment responses—and signed
> C2–C7/C7 SVA are withheld until lateral orientation is explicitly declared.

## Showcase mode
- **Intro screen** on load: what the tool is, three capability cards, a prominent research-only / not-a-medical-device disclaimer, and two paths — *Start guided demo* or *Explore on my own*. Re-openable any time from the ▶ button in the header.
- **Guided demo**: 12 auto-advancing chapters covering reference anatomy → flatback case → suggested fixes → applied construct → modeled post-op → degenerative scoliosis → three-plane construct → post-op construct review → cervical deformity → local radiograph landmarks → handover. Includes a cinematic camera orbit, play/pause, prev/next, progress bar, Esc/Space/arrow keys, and Exit.
- Captions resolve **live metrics** as the model updates (e.g. flatback shows "PI–LL +25°", then the post-op chapter reads "PI–LL is now +4°"), so the numbers on screen always match the narration.
- The tour drives only the public `__SPINE_TEST__` surface — the same actions a presenter would click — so it can never display a result the UI cannot itself produce. Chapters are idempotent, making prev/next jumping safe.
- Scriptable for rehearsal via `window.__SPINE_DEMO__` (`start`, `exit`, `goTo`, `setPlaying`, `state`).

## Standing vs supine positional change

Optional supine slot accepting a supine lateral radiograph, a CT scout/topogram, or a **CT sagittal reformat** — labelled *Highly experimental* throughout. Landmarks are placed manually on both films (the supine image is never auto-analysed), then regional sagittal angles are compared.

Per region (T4–T12, L1–S1, sacral slope) it reports both values, the change, and the fraction of the standing magnitude that did not persist supine — banded as *largely positional* (≥35%), *partly positional* (≥15%) or *little change*. The lumbar fraction can be written into the case flexibility field, where it lands as an editable proposal rather than an applied fact.

Verified against constructed geometry: standing LL 50° → supine 30° reports 20° change / 40% / "largely positional"; TK 45° → 30° reports 33% / "partly positional"; an unchanged sacral slope is flagged "little change". The flexibility field moved 0 → 40.

**Deliberate boundaries.** This compares two *positions*, so it measures positional change under gravity — not segmental stiffness and not fusion. Nothing is ever labelled "autofused": ankylosis is a diagnosis needing CT and clinical correlation, so a low-change segment is flagged for review only. Formal structural assessment uses side-bending films, which this does not replace. A sagittal source never yields a coronal Cobb.

## Source audit (2026-07-27)

**Mobi-C — two errors found and corrected.**
- The cited PMA was **wrong**: the app referenced P110009, which is a different device, and that URL returns 404. Mobi-C is **P110002**. Corrected.
- Heights were listed as 5/6/7 mm. The published range is **4.5/5/6/7 mm** — the 4.5 mm option was missing. It has been available in Europe since 2006 and FDA-approved for the US in 2023. Corrected.
- The seven-footprint count matches published descriptions, but the individual depth × width pairs **could not be confirmed** from any accessible primary source. Marked `sourceVerification: heights_and_option_count_verified_individual_footprints_unverified` rather than left implying they were checked.

That a cited regulatory reference was both the wrong number and a dead link is worth noting on its own — the remaining catalog citations should be treated as unverified until each is opened, not assumed sound because they look specific.

## Prior-hardware detection — built, validated, gate closed

Implemented as intensity thresholding plus connected-component analysis, with a bone-peak contrast test to separate metal from well-exposed bone.

**It does not work well enough to show.** Measured against four real clinical images plus synthetic controls: it flagged **1 of 3** films that genuinely contained instrumentation, and **false-positived on a clean synthetic spine** (the bone-peak denominator degenerates on mostly-dark images). Intensity alone does not separate metal from bone across real films.

The result is computed and exposed on the analysis object and via `HARDWARE_DETECTION_GATE` for future work, but is **never surfaced to the user**. A flag that misses two thirds of real hardware is worse than no flag, because its absence would be read as confirmation that no hardware is present. Same fail-closed posture as CT intake.

In its place, every staged case now carries a standing caution to check the traced path by hand over any previous instrumentation, since metal is the strongest edge on a radiograph and pulls the corridor toward it.

Revisiting this needs either a trained detector or DICOM pixel values, where metal sits at an unambiguous HU range rather than in a rescaled 8-bit raster.

## Sign conventions settled

"Clockwise viewed cranially" was inherently viewpoint-dependent, so it has been replaced throughout with unambiguous anatomical wording and aligned to the right-positive rule every other signed input already used.

**Every positive value now acts toward the patient's right**, except AP translation which is anterior:

- Axial rotation — positive turns the vertebral body toward the patient's right. Previously turned it left. Negated in `deformityState` for the global value and at the level/planned application point, which bypasses it.
- Pelvic obliquity — positive drops the patient's right side. Previously dropped the left.
- Sagittal wedge — positive is kyphosing (anteriorly wedged), negative lordosing. Behaviour unchanged; it was simply undeclared, and matches the existing "positive Z creates kyphosis" chain convention.

Verified anatomically rather than by inspection, by reading where each vertebra's anterior aspect points after rotation: global axial +20 and level axial +25 both turn the body toward patient-right; obliquity +15 drops patient-right.

## Gait flag wording and range

- Bands relabelled to **within control / below control / well below control**. They measure distance from the published cohort control and are not clinical severity grades.
- Pelvic tilt outside the published cohort span (13–24°) now carries an explicit notice that the figures are extrapolated beyond the source data rather than interpolated within it. Verified: the notice appears at PT 40 and is absent at PT 20.

## Foot–ground inverse kinematics

The foot path is now prescribed — planted through stance, arcing through swing — and a planar two-link solve recovers hip and knee. Femur and tibia lengths are measured from the rest pose, never assumed.

**Pelvis height is derived, not prescribed.** The supporting leg has a fixed length, so the further the planted foot sits from under the hip, the lower the hip must be. Rise and fall falls out of that geometry, and because the height and the IK target come from the same source, the foot stays put.

That turned out to be the fix for a real bug in the first attempt: I had prescribed a 2 cm bob, which pushed the required leg length past full reach at mid-stance and silently clamped, dragging the foot 32 mm through stance.

Measured over a full cycle:

| | neutral (PT 22) | flatback (PT 32) |
|---|---|---|
| Stance foot drift | **1.7 mm** | 1.5 mm |
| Pelvis vertical excursion | **50.4 mm** | 38.4 mm |
| Knee range | 5.1–47.9° | 11.7–47.9° |

The 50 mm excursion is worth noting: published centre-of-mass excursion in normal walking is 40–50 mm, and this was **not** tuned to match — it emerged from leg length and step length. The flatback case also settles into a higher minimum knee flexion (11.7° vs 5.1°), consistent with the crouch pattern described in the ASD gait literature, again without being coded for.

Step length is driven by the published stride fit (1.29 m control → 1.08 m at PT 24).

## Gait deviation flags

While gait runs, each parameter is shown against its published control value and banded by distance from it — normal within 5%, mild to 15%, marked beyond. Bands are distance from the cohort control, **not** clinical severity grades. Each flag names the authored cohort index used by the interpolation; it does not identify a causal driver or predict what changing that measurement will do for an individual.

Scenario contrast reads clearly through the flags: a flatback input indexes four *marked* differences from the control cohort; a separately authored post-op alignment indexes values closer to the control cohort. This is a display comparison, not evidence that the construct caused an individual gait response.

## Gait couplings — literature-derived, not guessed

Every deformity→gait coefficient is now a straight-line fit through two published cohorts and their matched controls, taken from *Gait alterations in patients with adult spinal deformity*, North American Spine Society Journal 2023 ([PMC10825775](https://pmc.ncbi.nlm.nih.gov/articles/PMC10825775/)).

| | controls | idiopathic ASD (PT 13°, Cobb 46°) | degenerative ASD (PT 24°, SVA 88 mm) |
|---|---|---|---|
| Hip ROM | 46.17° | 41.60° | 39.81° |
| Knee ROM | 63.61° | 62.56° | 56.16° |
| Cadence | 118.24 steps/min | not significant | 108.40 |
| Pelvic obliquity | 10.69° | 10.22° | 5.65° |
| Trunk lateroflexion | 10.50° | ×0.80 | ×0.80 |

**The data contradicted the obvious guess.** The coronal-dominant cohort walked at essentially normal speed and stride *despite the larger Cobb angle*; the observed gait differences covaried more strongly with sagittal malalignment in these cohorts. That cross-sectional association does not establish causation. Coronal magnitude now only indexes the displayed trunk-lateroflexion comparison, which both cohorts showed at ~0.80 of control independently of pelvic tilt.

Cadence is itself derived, so a malaligned case genuinely walks slower rather than merely moving less.

**Reproduction check** (model vs published):

- PT 24 — hip 39.8 vs 39.81, knee 56.2 vs 56.16, cadence 108.4 vs 108.40, obliquity 5.7 vs 5.65. Exact.
- PT 13 — knee 62.5 vs 62.56 and cadence unchanged, both exact; hip 44.2 vs 41.60 is 2.6° high because the two cohorts had *different* control groups (43.43° vs 46.17°) and the model normalises to one. The ratio is right; the absolute carries that residual.
- Monotonic across the domain: PT 8 → 40 gives hip 46.2 → 33.3, cadence 118.2 → 94.1.
- Scenario comparison: changing the authored PT index from 32 to 19.5 moves the displayed interpolation from hip ROM 36.6 to 41.6 and cadence 101.3 to 112.4; this is not a predicted response.

The on-screen chip now states the derived values against control, so the coupling is visible rather than buried.

**Current boundary after the later inverse-kinematics pass:** a prescribed display foot path and planar two-link solve are present, but there is still no force, contact, ground-reaction, muscle, or patient-specific dynamics model. The gait view therefore remains cohort-level illustration only.

## Spinal axis verification

Every axis measured against the rig rather than trusted from comments. Frame anchored empirically: the right hip pivot sits at z −1.26, so **patient right = −Z**; anterior = −X.

| Axis | Declared convention | Measured | Verdict |
|---|---|---|---|
| Level lateral translation | positive → patient right | dz −0.156 | correct |
| Level coronal wedge | positive → patient right | dz −0.271 | correct |
| Level AP translation | positive → anterior | dx −0.156 | correct |
| Global trunk shift | positive → patient right | dz −0.499 | correct |
| Coronal direction right/left | apex to that side | dz −1.467 / +1.490, mirrored | correct |
| Authored scoliosis case | apex right | apex measured patient-right | correct |
| Level sagittal wedge | *none declared* | positive tips chain anterior (kyphosing) | undeclared |
| Level axial rotation | "clockwise viewed cranially" | maps 1:1 to `rotation.y` (+20° → +20°) | ambiguous |
| Pelvic obliquity | *none declared* | positive → +Z (patient left), 1.35 units | undeclared |

**Bug found and fixed — coronal magnitude was a silent no-op.** The coronal curve only rendered when a `coronalProfileId` resolved. On any case without a declared curve pattern (neutral reference included), dragging the Primary Cobb surrogate produced **exactly zero** displacement. A declared `defaultCoronalProfileId` now backs the input so it always has a visible effect; zero magnitude still renders flat, and authored cases are untouched. Current startup self-test: 78 assertions.

**Two conventions need your decision, not mine.** Axial rotation maps directly to `rotation.y`, which is *counter*-clockwise viewed from above in this right-handed Y-up frame. The documented wording is "clockwise viewed cranially" — if that means viewed from the head down, the sign is inverted. I did not flip it: it would reverse the rotation direction of every authored example case, so it needs an explicit call. Sagittal wedge and pelvic obliquity have no declared convention at all; their measured behaviour is recorded above.

## Joint sign conventions — a real bug in the app's own code

The knees rendered hyperextended. Measuring the rig rather than assuming showed **two inverted sign conventions, both pre-existing in the authored posture code, not only in the gait**:

- A **positive** hip rotation about Z swings the knee *posteriorly* (2.83 units) — that is extension. The code applied `+hipFlexion`, so the "Hip flexion / extension" slider produced extension for positive values, contradicting its own note that positive means flexion.
- A **positive** knee rotation carries the ankle *posteriorly* (4.18 units, heel toward buttock) — that is flexion. The code applied `-kneeFlexion`, hyperextending the knee.

The two were inverted in opposite directions, which is likely why it went unnoticed: a static posture with both set looks odd but not obviously wrong. Under gait amplitudes it became unmistakable.

Fixed at source, so the Anatomy Lab posture sliders are corrected too, not just the animation. Ankle was verified correct as-is (positive = dorsiflexion, forefoot rises). After the fix, knee angle through a full gait cycle stays between **6.5° and 56.8° — always flexed, never hyperextending**, matching normative walking.

**Method note for future work:** the correct hyperextension test is the joint angle, not the ankle's world position relative to the knee. During swing the whole thigh is forward, so the shin legitimately sits anterior in world space while the joint is properly flexed. An earlier world-position metric produced a false positive.

## Pre-testing verification sweep

The historical 14 targeted checks remain covered; the current startup self-test contains 78 assertions:

- PI = PT + SS identity holds to 0 residual across PI 35–70 and PT 8–40
- SRS–Schwab PI–LL and PT bands correct at every boundary (9.9/10/20/20.1, 19.9/20/30/30.1)
- Ames cSVA, CBVA and T1S−CL grade correctly
- Pelvic balance response applies independently of the thoracic assumption; PT floors at 10; PT passes through untouched with no lumbar gain
- Correction bounds currently enforced: SPO 0–15, PSO 0–40, ALIF 0–30, laminectomy 0–0
- Manual landmark TK/LL remain exact against hand-computed truth; signed CL additionally requires an explicit lateral orientation. PI = PT + SS residual 0.00
- All 20 example cases still yield 27 comparison options with zero invalid branches

## Manual calibration — full-screen focus mode

Starting a manual sequence now takes the working image full screen and **suppresses every automatic overlay** — corridor, centreline dots, endplate lines, drag handles and guide dots all stop drawing for the plane being calibrated. Only the radiograph and the user's own points remain. The prompt pins to the top, a fixed Undo/Done bar sits at the bottom, and Escape or Done exits while keeping all placed points.

Verified: focus flags set on body and figure, figcaption hidden, prompt switches to fixed positioning, control bar shown, points survive Done — and the corridor overlay drops to 30 stray pixels on the canvas where a drawn corridor is 1200+.

## Illustrative gait animation

A **kinematic** walk cycle — no forces, moments, muscle activity or ground reaction are computed, and an on-screen chip says so while it runs. Toggled from the viewport; requires the lower-extremity chain to be visible.

Amplitudes derive from the case, so a corrected scenario visibly walks differently from a deformed one: hip swing shrinks as pelvic tilt rises above 20° (a retroverted pelvis has already spent its hip-extension range), and transverse pelvic rotation scales with authored axial rotation. Knee flexion peaks through swing rather than oscillating sinusoidally, and the limbs run half a cycle apart. Gait owns transverse pelvic rotation outright, which `applyModelTargets` leaves at zero, so it cannot fight the authored posture; case edits invalidate the cached amplitudes.

**Corrected to normative kinematics.** The first version flexed the knee ~52° through *stance* — the leg was maximally bent while bearing weight, which is what made the figure look like it was kicking rather than walking. The cause was a single sinusoidal hump whose positive half-cycle covered stance, not swing.

Joint angles now follow normative sagittal curves through the cycle (t = 0 at heel strike):
- **Hip** near-sinusoidal, `10 + 20·cos(2πt)` — ~30° flexion at contact, ~10° extension at toe-off.
- **Knee** with its characteristic double peak: a small loading-response bump around 15% and the large peak through swing at ~72%. Close to extension while weight-bearing.
- **Ankle** carrying the push-off plantarflexion spike near 62%.

Measured over a full cycle: **knee peaks at phase 0.70 at 56°**, hip ranges −9.5° to 28.5°, ankle −13.9° to 8.8° — all inside published normative bands.

Also added, because the previous version left the upper body static: whole-figure rise and fall twice per stride (pelvis and limbs together, so the hips stay articulated), pelvic obliquity, and trunk counter-rotation distributed across 20 thoracic and cervical segments so the shoulders counter-rotate against the pelvis and the head moves. Foot–ground contact is not simulated; there is no ground plane and no inverse kinematics.

Verified deterministically via a `stepGait` hook, since the browser pane backgrounds `requestAnimationFrame` and the render loop cannot be relied on in test.

## Manual rapid landmark calibration

The accurate route when a source image is small, compressed, or a screen capture — it bypasses detection entirely.

- **Lateral, 14 taps**: C2 and C7 inferior endplates, T4 superior, T12 inferior, L1 superior, S1 superior (two corners each), then both femoral head centres. Yields C2–C7, T4–T12 kyphosis, L1–S1 lordosis, sacral slope, pelvic tilt and pelvic incidence.
- **Frontal, 5 taps**: end-vertebra endplate corners plus the apex centre. Yields Cobb and apex direction.
- Sequenced prompts with progress, undo and reset; each tap auto-advances. Placed points and the forming endplate lines are drawn live, with the femoral-head axis and its sacral connection shown once available.
- Manual values **supersede** detector output for the same measurement in the results list and flow through the existing transfer/apply path.

**PI = PT + SS is computed as an independent self-check, not assumed.** All three come from the placed points via their standard definitions, and the residual is displayed. Verified against hand-built geometry: a consistent configuration returns SS 40°, PT 20°, PI 60° with a **0.00° residual**; a deliberately inconsistent one returns PI 20° and is flagged with a 40° residual. That residual is the safeguard against a mis-placed point producing a plausible-looking wrong PI, since the acute-angle convention alone cannot detect it.

Cobb verified at 25.0° against 25.0° true; orientation-declared CL and TK/LL/SS/PT are exact against hand-computed truth. CL and SVA fail closed while orientation is Auto.

## Detector hardening — shape constraints

The literature is unanimous that every state-of-the-art method is deep learning: CNN landmark/heatmap regression, vertebra detection plus corner regression, or segmentation, trained on AASCE2019 (609 annotated frontal radiographs). SG-LRA reports 5.05% SMAPE on maximum Cobb; human manual measurement varies 2.8–8°. **A classical pipeline cannot reach that**, and this build ships no model.

What *is* transferable is the underlying principle. SG-LRA's own diagnosis of why naive methods fail is that point-wise landmark prediction "lacks geometric constraints — each vertex can be predicted independently". Our endplate lines had exactly that flaw. Two analytic stand-ins for the learned shape prior were added:

- **Vertebral pitch detection.** Bone/disc alternation makes the intensity profile down the centreline quasi-periodic. The profile is detrended, autocorrelated over a plausible 9–24 vertebra range, and the phase chosen so sample points land on the darker disc rows. Samples then sit on real vertebrae rather than arbitrary even fractions of the corridor. It only engages when the periodicity is convincing (autocorrelation strength > 0.18) and the implied count is anatomically sane, otherwise it falls back to even spacing.
- **Endplate-angle regularisation.** Adjacent endplate angles vary smoothly on a real spine. Each line is compared with a 5-point median trend; outliers beyond a robust MAD-based cutoff are pulled back toward the trend and have their confidence cut proportionally, so a rib crossing or hardware edge can no longer set a Cobb angle.

**Measured on synthetic ground truth** (rib-laden, collimated, known curve): Cobb error fell from ~28° to **0.7°** (24.4° measured vs 25.1° true) and confidence rose 0.22 → 0.69. Pitch detection recovered 16 vertebrae from a 34 px synthetic rhythm. The straight-spine control still yields a 5.9° residual but correctly reports low confidence (0.34).

**On the supplied clinical screenshots the hardening changes nothing** — pitch detection declines to fire because the vertebral rhythm is not recoverable at 769 px with heavy JPEG compression, and confidence stays at 29%/20%. That contrast is the point: the pipeline now performs well when the image supports it and degrades honestly when it does not.

Sources: [SG-LRA](https://arxiv.org/html/2411.12604v1) · [shape-constrained cascaded CNNs](https://pmc.ncbi.nlm.nih.gov/articles/PMC11670676/) · [vertebra detector + corner regression](https://arxiv.org/pdf/1910.14202) · [CNN Cobb measurement in AIS](https://pmc.ncbi.nlm.nih.gov/articles/PMC8871012/)

## Screenshot / PACS-capture handling

Testing against the supplied clinical images exposed that all four were **PACS viewer screen captures**, not exports: 951×779 frames with a toolbar strip, in which the radiograph occupied only ~18% of the frame.

- **Viewer chrome is trimmed.** The toolbar spans the full frame width while the radiograph sits in a narrow strip, so rows that are almost fully lit at the top/bottom edge are removed before the field is measured — but only when most rows are largely unexposed, so a properly exported film is untouched.
- **The proportional sanity guard was rejecting correct detections.** A 165 px strip inside a 951 px frame is 17%, below the old 25% floor, so the field detection was silently falling back to the whole frame. Replaced with an absolute floor (60×120 px).
- **Two-pass rasterisation.** The decoder now locates the exposed field on a probe pass, then re-renders *just that field* into the analysis budget (max 3× magnification). Previously a 165 px strip was downsampled to ~90 px along with all the surrounding black; now it gets the full 520×840 budget. Measured on the supplied frontal: 176×769 source field → 192×840 analysis.
- **Diagnostics name the cause.** A low-confidence result now reports the screenshot ("only about 18% of the frame is actually radiograph"), the true radiograph height in original pixels, and cropped femoral heads — instead of leaving the user to guess.

## Access management

`admin.php` (admins only, linked bottom-left of the simulator) adds/disables/deletes testers, resets passwords and grants admin, rewriting `private/config.php` for you. Only the first admin is hand-created.

Guards, all verified: writes go via temp file + parse check + atomic rename so a bad write can never brick the login; the last enabled admin cannot be removed or demoted; disabled accounts still run the password verify so disabling is not detectable by timing; usernames are validated and duplicates rejected; passwords are bcrypt cost 12 with a 12-character minimum.

## Laminectomy

Now declares no angular output at all (`allowSignedCorrection: false`) rather than permitting ±20°, since isolated decompression does not correct alignment. Its provenance became `not_applicable`, which also required updating the TOPS auto-linked decompression path and one self-test. Verified: TOPS scenarios still evaluate, and all 20 example cases still produce their 27 comparison options with zero invalid branches.

## Mobile/tablet-first build

Primary target is tablet/phone; browser testing is secondary.

- **Installable**: `manifest.webmanifest` (standalone display, any orientation, theme colours) plus 180/192/512 and a maskable 512 icon. Icons are generated by `deploy/tools/make-icons.php`, which writes real PNGs through a minimal built-in encoder because DreamHost's CLI PHP has no GD.
- The manifest and icons are the only assets served without a session — they carry no clinical content.
- **Touch behaviour**: tap-highlight suppressed and text selection disabled on controls (prose stays selectable); `overscroll-behavior: none` so a pull-to-refresh mid-slider-drag can't discard an edit; every control forced to 16px on coarse pointers so iOS never zooms on focus; safe-area padding under `display-mode: standalone`.

## Source-image guidance

Detection quality is limited far more by the source image than by the algorithm, so the intake now says so explicitly and the app diagnoses it at runtime.

- New **"What makes a good source image"** panel in the imaging intake, ordered by how often each problem is the actual cause: too small, femoral heads cropped, heavy JPEG compression, screenshot-of-a-viewer, burned-in annotation.
- `sourceQualityWarnings()` inspects each staged image and, when confidence lands below the medium band, appends the most likely cause to the status line instead of leaving the user guessing. Verified across three tiers: 560px → "cannot be fitted reliably", 1000px → "marginal", 1600px → silent. A missing pelvic point is separately reported as cropped femoral heads.

## Worksheet copy

The measurement worksheet's "enter at least one reviewed measurement / blank fields preserve the current case" wording did not say what to actually do. Rewritten in all three places (section intro, empty-submit error, staged idle state) to name the two ways to fill it — transfer from the beta, or type directly — and to explain that blank fields are how you update one measurement without disturbing the rest.

## Clinical-data review (historical v0.19.0 snapshot)

**Verified correct against the published classifications — no change needed:**
- SRS–Schwab sagittal modifiers: PI–LL 0/<10°, +/10–20°, ++/>20°; SVA 0/<4 cm, +/4–9.5 cm, ++/>9.5 cm; PT 0/<20°, +/20–30°, ++/>30°. Band edges inclusive in the right places.
- Ames cervical modifiers: cSVA <40/40–80/>80 mm; CBVA 1–10° / −10–0° and 11–25° / outside; T1S−CL <15/15–20/>20°.
- PI = PT + SS identity holds through the pelvic kinematics (self-test asserts a zero residual).
- Procedure default corrections all sit inside reported ranges: SPO 10°, PSO 30°, ALIF 15°, LLIF/XLIF/OLIF 10°, TLIF/PLIF 5°, ACDF 4°, arthroplasty 2°, and 0° for laminectomy, pedicle screws, S2AI, iliac and SI fixation.

**Corrected — permissive authoring bounds tightened to literature ranges.** Several procedures declared no `correctionMax`, so they silently inherited the global ±60° ceiling, letting a user author a clinically impossible single-level correction:

| Procedure | Was | Now |
|---|---|---|
| SPO | 0–60° | 0–20° |
| PSO | 0–60° | 0–45° |
| ALIF | 0–60° | 0–30° |
| LLIF / XLIF / OLIF | 0–60° | 0–25° |
| TLIF / PLIF | 0–60° | 0–15° |
| ACDF | −20–30° | ±15° |
| Cervical arthroplasty | −20–30° | ±10° |

Verified safe: every authored comparison branch seeds well inside the new bounds (PSO ≤30, SPO ≤10, cervical ±12), and all 20 example cases still produce their 27 comparison options with zero invalidated branches.

**Resolved in the current build:** laminectomy has no angular output and accepts only 0°. TOPS inserts its required decompression atomically without borrowing an angular correction from laminectomy.

**Compliance sweep:** no unlabelled inputs or buttons, no images without alt text, `lang` set, two skip links, all 37 external links carry `rel="noopener noreferrer"`, and zero external network requests at runtime (only the file itself and its own `blob:` URLs) — the "nothing leaves the device" claim holds.

**Layout defect fixed:** the centred Pre-Op/Post-Op switch overlapped the Anatomy Lab button whenever the centre column was narrow (measured: 625 px column at 1035 px page width). The existing guard keyed off *page* width and so could not see it; replaced with a `@container` query on the viewport, which reverts correctly at wide columns and degrades to the old behaviour on browsers without support.

## Real-radiograph import fixes
Testing against real films exposed a root cause the synthetic tests never hit: **collimation**. Clinical radiographs arrive with large near-uniform borders outside the exposed field, and those borders were breaking three things at once — they flattened the display window, and the collimation edge is a perfect vertical line that the paired-wall corridor scorer happily mistook for a vertebral body wall.

- **Exposed-field detection.** The analysable field is now located first, from per-row/per-column variance (so both black and burned-white borders are excluded). Windowing, the corridor search bounds, the centre prior, the band prior, the jump limit, the search radii and the endplate half-length are all now measured against that field rather than the padded frame.
- **The decisive fix:** both sampled walls must fall inside the exposed field. Previously a wide radius could pair the spine's own edge against the chest wall or the collimation border and outscore the vertebral body. On a collimated test film this cut corridor error from **23.5 px to 0.56 px**.
- **Auto-windowing.** CLAHE (8×8 tiles, clip 2.5) with bilinear tile blending now produces an auto-windowed image, plus a global percentile window computed on the exposed field only. An "Image window" control switches between *Auto-windowed* and *Original exposure*; the staged preview shows the windowed image before detection runs.
  - Measured, then deliberately scoped: CLAHE applied to the *detection* data made things far worse (0.48 px → 23 px error) because it equalises away the very local contrast the paired-wall scorer measures. **CLAHE is display-only; detection runs on the globally windowed field data.**
- **Honest confidence.** Confidence is now multiplied by how well the fitted endplate lines agree with the tangent of the traced corridor. A case that traced perfectly but produced a noisy Cobb now reports **low · 21%** instead of a misleading medium.

## Draggable centreline
Every blue dot on the traced spine path is now a drag handle (17 frontal + 23 lateral, 62 handles in total with the existing line/apex/hip handles).
- Dragging reshapes the corridor live — it is rebuilt by interpolation straight through the user's points, so what they drag is exactly what later measurements are fitted to. Point `y` is clamped between its neighbours to keep the path single-valued.
- **On release the endplate search re-runs along the corrected path** and the measurements recalculate. Verified end to end through real pointer events: a 30 px drag moved the point, corridor and line together and recomputed Cobb 38.4° → 22.1°.
- Handle hit radius scales with the displayed canvas size, so the dots stay grabbable on phones.

## Post-op pose fix
The modeled post-op view was producing an anatomically impossible standing posture: the whole trunk levered **18.6° backward** on the flatback case, throwing the head far behind the hips even though the numbers read a clean PI–LL 0°.

**Cause.** In a bottom-up kinematic chain, adding +25° of lordosis at L4–S1 rigidly rotates everything above it backward by 25°. Nothing absorbed that, because pelvic tilt was held at its pre-op compensatory value (32°). But compensatory pelvic retroversion *is* the posture a hypolordotic lumbar spine forces — holding it after the lordosis is restored models a stance nobody could stand in.

**Fix.** The reciprocal response was split into its two genuinely different halves:
- **Pelvic balance response (PT −0.5°/° of lumbar gain, floored at 10°) now always applies** when lumbar lordosis is gained. This is kinematic bookkeeping for a standing chain, not an outcome prediction, and the pelvic-tilt row is tagged `balance response` so it is never mistaken for a passthrough input.
- **Thoracic reciprocal response (TK +0.2°/°) stays opt-in**, since that literature is genuinely heterogeneous.

**Result** (trunk tilt, negative = leaning forward):

| Case | Pre-op | Post-op before | Post-op after |
|---|---|---|---|
| Flatback | −5.7° | **+18.6°** | +6.1° |
| Moderate positive sagittal | −8.0° | — | −0.5° |
| Degenerative scoliosis | −18.0° | — | −11.3° |

Two self-test checks were added at that stage: pelvic balance applies independently of the thoracic assumption, and pelvic tilt passes through untouched when there is no lumbar gain. The current startup self-test has 78 checks.

**Verified not a bug:** regional curve rendering is exact. The reference CT pose carries the calibration angles (LL 48 / TK 42 / CL 18), and cases render precise deltas from it — flatback's TK 30 renders exactly −12°, and its −21° lumbar renders −14.1° across L1→L5 because L5–S1 sits below that span and carries 0.33 of the distribution weight. The apparent "excess kyphosis" in the screenshots was the trunk lever, not the regional curves.

## New in this build
- **Rebuilt spine-corridor detector.** The corridor score now requires *paired* left/right vertical walls (min of the two, with a symmetry bonus) instead of a summed edge response, so single strong edges from ribs or the chest wall no longer attract the trace. A global dominant-vertical-band prior is computed first and the dynamic-programming path is softly penalized for leaving it, with a much tighter per-row lateral jump. This fixes the corridor wandering across ribs on frontal images.
- **Cobb pairing confidence floor.** End-vertebra pairing now searches confident endplate lines first and only falls back to the full set, preventing noise-driven inflated Cobb angles.
- **Apex anchor steers the corridor.** The frontal apex guide point now bends the guided corridor through a quadratic path (top → apex → bottom); previously it only moved the apex marker. All explicit anchors now dominate the detected path (80/20 blend).
- **Assist mode is now styled and discoverable**: numbered-feel guide card, active-button highlight, target-figure glow, auto-scroll to the matching preview, and larger touch-scaled drag handles.
- **Suggested fixes surfaced.** The construct-comparison panel is renamed "Suggested fixes · construct scenarios", auto-opens when scenarios appear, glows when populated, and a persistent "Suggested fixes" chip in the step-context bar jumps straight to it from any step.
- **CT and hybrid intake are blocked and labelled untested.** This build never decoded CT DICOM pixels (files were only counted), so the CT and hybrid routes are now disabled at the radio, file-input, and validation layers with explicit "Blocked · untested" badges until a validated decoder exists.
- Fixed a performance bug where the pelvic radial-point detector ran twice when a hip guide anchor was set.
- Fixed the analysis hanging forever when the tab is backgrounded (`requestAnimationFrame` never fires; now raced against a timer).
- Fixed a load-example race where changing the dropdown within 160 ms of clicking Load applied the wrong case.
- Fixed the mobile flow bar stacking underneath the demo bar (it is appended to `body`, so it could not be matched through `.app-shell`).
- Readability pass: minimum UI copy sizes raised across the app; new large-desktop, tablet, and landscape-phone breakpoints.

## Current boundary
- This remains an experimental, heuristic browser-only beta.
- Distance outputs still require user-supplied mm-per-pixel scaling.
- DICOM pixel decoding is still not included in this standalone file; CT/hybrid stay blocked as untested.
- Lateral vertebral-level labels (C2/C7/T4/T12/L1) are fixed fractions of the detected corridor span; anchor C2 and S1 in assist mode for reliable regional angles.

## Implant catalog source audit — 2026-07-27 (final)

Instruction: "Verify all the cited sources." Every cage family was re-checked against a
primary document rather than assumed correct. Two of six are now backed by a real source;
four are labelled as unverified rather than left implying they had been checked.

### HEDRON P — verified against the Globus HEDRON P technique guide (rev B)

Extracted from the guide text, not inferred:

| Property | Published | App | Verdict |
|---|---|---|---|
| Heights | 7–17 mm, 1 mm increments | 7,8,9,10,11,12,13,14,15,16,17 | exact match |
| Lordotic profiles | two: 8° and 15° | [8, 15] | exact match |
| Widths | 8, 10, 12 mm | all app ML values within set | consistent |
| Lengths | 22, 26, 30 mm | all app AP values within set | consistent |

The width x length availability grid is a figure, not a table, and could not be read
reliably from the extracted text. The app's six pairs are therefore a *subset of the
published ranges*, not a confirmed option list — recorded as
`sourceVerification: 'heights_and_lordosis_verified_footprint_pairs_unverified'`.

Also confirmed from the same search and respected by the app: hyperlordotic interbodies
(>= 25°) require supplemental fixation. HEDRON A's 20° ceiling stays below that line.

### Unverified — now labelled as such

`hedron_c`, `hedron_t`, `hedron_a` carry `dimensions_unverified_against_primary_matrix`;
`hedron_l` carries `length_range_verified_heights_lordosis_and_steps_unverified` (only the
40–60 mm range is published). The product families themselves are confirmed to exist with
the stated approaches; the size matrices are not published anywhere reachable.

`hedron_t`'s height list skips 14 and 16 mm, which no source supports. Flagged in a comment
as provisional. If any HEDRON list is wrong, that one is the most likely.

### Surfacing

`revision` is rendered in the implant panel (`implantCatalogLabel`), so selecting a family
now displays e.g. "HEDRON T · TLIF · product family confirmed; size matrix unverified".
The static placeholder previously read "Verified catalog values" — an overclaim for four of
six families — and is now "Catalog values — verification status shown per family".

### Precedent

This is the same remedy applied to Mobi-C earlier the same day, where the originally cited
PMA number was simply wrong (P110009 is a different device; the URL 404s) and a height was
missing. That error is why every remaining entry was opened rather than trusted.

### Audit extended to the rest of the catalog

The same "accessed <date>" phrasing that proved to be an overclaim on the cages also
appeared on uCentum and uBase. All 16 catalog entries (6 cages, 6 screws, 1 motion device,
3 grafts) now carry an explicit `sourceVerification` value. Three tiers are in use:

- verified against a primary document (HEDRON P heights/lordosis, Mobi-C heights/count)
- `cited_document_specific_dimensions_not_rechecked` — neon3 R06/2023-12, TOPS P220002 SSED;
  the citation names a real, specific document but the numbers were not re-read in this pass
- `dimensions_unverified_against_primary_matrix` — uCentum, uBase, HEDRON C/T/A

Graft package volumes are marked `package_volumes_not_rechecked`. They are consumable pack
sizes and feed no geometry or correction maths, so an error there changes the shopping list
rather than the model.

Regression after all catalog edits: model self-test passed, autocal and demo surfaces present,
implant plan builds, 16/16 entries labelled.

## Feedback round — 2026-07-27 (eight reported items)

### 1. Manual calibration banner covered C2; no way to skip a landmark
The focus-mode prompt is a fixed full-width overlay while the image filled the
whole viewport, so the very first landmark asked for (C2 inferior endplate, top
of the film) sat behind it. The focused figure now reserves the measured heights
of the prompt and the control bar via `--manual-prompt-height` /
`--manual-bar-height`, re-measured on every prompt change (a zero measurement is
ignored so a pre-layout read cannot wipe the reserve).

Added `skipManualPoint()` plus a **Skip point** button. Landmarks are routinely
unreadable — collimated off, obscured by the shoulder girdle or bowel gas,
destroyed by hardware — and forcing a guess writes a fabricated point into the
measurement. Skipping advances without recording. Every derived value in
`manualLateralValues` was already presence-guarded, so skipping drops exactly the
measurements that needed that landmark: verified by skipping T4 and confirming TK
is absent while CL, LL, PT and PI still compute.

### 2. Guide points — do they do anything?
Yes, but not for manual calibration, which is the source of the confusion. They
constrain the **automatic** detector only: `guides.c2`/`guides.s1` clamp the
corridor ends, `guides.s1` overrides the S1 centre, `guides.hip` replaces the
femoral-head point and raises its confidence floor, `guides.apex` fixes the
frontal apex. The hint copy now leads with that distinction.

### 3. Text clutter / collapsible panels / fullscreen
Either workspace column can now be folded from a slim edge toggle, and an
immersive button hides the header, workflow nav, provenance chips and legend.
The app already had a per-workflow-step two-column layout (`min-width: 981px`)
that sets `grid-template-columns` per step, so the collapse rules had to
out-specify those and come after them. Verified at 1440 px: step 1 goes
`410px 1030px` → `1440px`, steps 2–3 go `1010px 430px` → `1440px`, immersive
gives `1440px` on its own, and the toggles are hidden below 960 px where the
layout stacks.

Scope note: this addresses the structural half — the model can now be seen
unobstructed. A line-by-line prose reduction across the panels was not done.

### 4. Reciprocal thoracic kyphosis now ON by default
It is a documented reciprocal change, and the pelvic half of the same response
was already applied unconditionally — leaving the thoracic half opt-in modelled a
spine that gains lordosis with a rigid thorax. Also fixed a real desync: the
checkbox was never synced from state, so an example that set the assumption left
the control disagreeing with the model driving the numbers.

### 5. Suggestions proposing what the construct already contains
Two changes. Level selection now prefers a level the itinerary has not already
addressed (ranking still wins if all candidates are treated), and an option with
no applicable branch left is dropped rather than shown with a red "already in the
itinerary" error and a disabled Apply. Verified by applying suggestions in a loop
across three cases: 4/10/8 rounds, **zero dead-ends**, each terminating cleanly.

### 6. No way out of level isolation
The only exit was a button inside the Anatomy Lab, which vanishes with the panel.
Added an on-canvas exit pill plus Esc, driven by `syncInspectionChrome()` called
from both transitions so the control can never disagree with the state. It takes
over the mode-chip slot while isolated so nothing overlaps.

### 7. Gait box not updating on pre/post switch
`gait.params` was computed only inside `setGaitActive`. `applyModelTargets`
already invalidated it on every case edit and the animation recovered lazily on
the next frame, but `renderGaitFlags` was never called again — so the readout
stayed pinned to whatever the case looked like when gait was switched on. Now
re-derived at the end of `refreshApplication` (after `applyModelTargets`, which
rewrites the pose values the amplitudes are derived from). The panel also names
its view. Verified: PT 22 → hip 41°, PT 40 → 33°, PT 10 → 45°.

### 8. Pre-op vs post-op showcase
New dialog: alignment before/after with deltas, the construct applied, and the
modeled gait-cohort interpolation. Direction colouring is limited to measures with an
unambiguous direction — PI-LL and PT toward zero, gait amplitudes toward the
published control. Whether a given LL, TK or CL is "better" depends on the
target, so those stay neutral.

Flatback + two ALIFs (+15° L5–S1, +10° L4–L5) reads: LL 27→52, PI–LL 25→0,
PT 32→20, TK 30→35, and every gait measure up. The TK move is exactly
0.2 × 25° of lumbar gain, which independently confirms item 4.

Regression after all eight: 12/12 targeted checks and the model self-test pass.

## v0.20.0 — internal test build, 2026-07-28

Launch code (not recorded here; retired before the public release) stored as a SHA-256
digest rather than plaintext. Pure-JS SHA-256, not `crypto.subtle`, because
`file://` is not a secure context and `crypto.subtle` is undefined there. The gate is a
`<dialog>` with an opaque `::backdrop`, and `showIntro()` is queued behind the unlock —
both are modal dialogs and the top layer is ordered by `showModal` call order, so an
unqueued intro would have opened *above* the gate. `sessionStorage` access is guarded
throughout; if it throws, the gate simply asks again next load.

This is an access gate, not a security boundary, and the code says so in a comment.

### The systemic bug the audit found

**There was no global `[hidden] { display: none }` rule.** The UA rule sits at specificity
(0,1,0), so *any* component class declaring its own `display` silently beat it and
`element.hidden = true` did nothing. Four confirmed instances, each double-verified:

| Component | Symptom |
|---|---|
| `.viewport-guided-cta` | stayed painted at step 3, on top of `.interaction-hint` |
| `.lab-button` | "Supine: 14 taps" offered with no supine film → blank full-screen mode |
| `.canvas-legend` | legend toggle reported a state it could not apply |
| `.clinical-notice` | empty bordered strip at the top of every showcase |

Fixed globally with `[hidden] { display: none !important; }` — the normalize.css remedy
for exactly this. Safe here: all 17 hand-written `[hidden]` rules in the file already
resolve to `display: none`, so nothing relied on the old behaviour. Piecemeal per-class
rules would have kept missing the next one.

### `updateContext` never ran after init

`setWorkflowStep` and `updateContext` live in **separate IIFEs**. `updateContext` owns the
step-context copy, the mobile flow bar, and the guided CTA's label and hidden state, but
was only ever called once at init — so all of it froze at its step-1 values the moment the
user navigated. The CTA kept saying "Review anatomy" at step 3 and never hid.

A direct call from `setWorkflowStep` throws `ReferenceError` (different scope; the dataset
write happens first, which is why the step changed while nothing else did). Fixed with a
`MutationObserver` on `data-workflow-step` inside `updateContext`'s own scope — no coupling
between the two IIFEs.

Note for future testing: that observer is **asynchronous**. A synchronous read straight
after a nav click sees stale DOM; it is not a bug.

### Also fixed

- `.fa-expand` / `.fa-compress` had no `::before` content rule, so the immersive button
  painted as an empty pill. The app maps FA class names to plain Unicode; added `⤢` / `⤡`.
- `.viewport-bottom` now reserves `--viewport-cta-space`, measured from the CTA in JS
  because its label changes per step and it is `display:none` on mobile.
- Phone clipping: `.viewport` carried `min-height: 400px` inside a `.viewport-shell` that
  resolves to `clamp(320px, 42dvh, 430px)` with `overflow: hidden`. On any phone under
  ~952px tall the bottom row — including the only mobile control for reopening case
  inputs — was cut off. `.viewport { min-height: 0 }` at ≤900px.
- Supine manual calibration completion said "Frontal landmarks done"; three planes are
  reachable but the label was a two-way ternary.
- `startManual('supine')` now refuses without a raster rather than blacking out the screen
  over an empty canvas.

### Regression trap worth remembering

Bumping `modelVersion`/`buildId` trips `check(... 'versioned build identity')` in the model
self-test, which **halts the whole app** behind "Model integrity check failed". Both the
manifest and that assertion must be updated together.

Final: 17/17 targeted checks pass, model self-test passes, 455 element ids with no
duplicates. Audit ran 32 agents; 10 verify agents died on a session limit, so a few
lower-severity layout claims went unrefuted and were not acted on.

## Corpectomy actually resecting and reconstructing — 2026-07-28

Reported: the corpectomy neither removed the vertebral body nor showed a cage.
Two independent causes, both confirmed live before changing anything.

**1. The body flag worked; it was set on the wrong mesh.** `record.bodyResected` was
true and `record.body.visible` was false — but `record.body` is *fallback primitive*
geometry that is hidden whenever the CT atlas is loaded. The bone actually rendered is
`referenceLayer > ctReferenceSurface:L2`, and that is ONE mesh covering the whole
vertebra, body and posterior elements together. Hiding `record.body` changed nothing on
screen.

The fix belongs in the geometry-mode pass that owns `showReference` — which also runs
*after* `updateSurgicalVisibility` and was overwriting it. A resected body now forces the
same fallback-to-primitives path the TOPS decompression already uses, which is what makes
it possible to hide the body and endplates while keeping the posterior elements. Whether
they are kept is derived from `disruptsPosteriorTensionBand`: an anterior corpectomy
spares the posterior column, a VCR or grade-4 takes it. No new flag was needed for that
distinction — the ligament vocabulary already encodes it.

**2. No geometry was built at all.** `createHardware` returns early whenever
`renderStatus` starts with `withheld_`, and with no VBR catalog mapped the corpectomy hit
that return. `corpectomy_vbr` also had no case in the switch.

Body resections now build *before* the catalog check, because none of their geometry comes
from a catalog: the resection envelope is the record's own body bounding box and the strut
is sized to that defect. Verified in world space — envelope Y 2.030–2.521 exactly matches
the removed body, strut centred inside it at 2.275 vs the body's 2.276.

This keeps the evidence discipline rather than bending it. Published VBR dimension tables
could not be verified, so the app still reports the *catalog* as withheld; what it draws is
a reconstruction envelope derived from the patient's own geometry, labelled
`'geometry-derived resection and reconstruction envelope; not a dimensioned implant'`.
That is the same convention the PSO wedge already follows.

Regression: self-test green, 28 procedures / 23 body targets / 25 levels, kyphoplasty
still resects nothing and preserves both discs, gait and prior work unaffected.

## HANDOFF — continuous multilevel reconstruction (attempted, reverted)

Shipping build is v0.21.1 `internal-test-2026-07-28.3-audit`, SHA-256
`E654FB3B…768D`. Adjacent whole-body resections are **rejected** in this build and
the tester README says so; the two agree. Do not change one without the other.

An attempt to make them continuous was reverted. The design was right and is worth
resuming; the implementation was not finished.

**What was correct**
- Removing the rejection in `findProcedureConflict` works — two-level corpectomy is
  accepted and the resection renders correctly (both bodies removed, neighbours intact).
- `contiguousResectionRun(item, itinerary)` walks a run of adjacent resections by their
  shared disc: two bodies are contiguous when the upper one's `caudalSegmentId` equals the
  lower one's `cranialSegmentId`. Ordering is by the caudal segment's `displayIndex`.
- Span maths: measure top-of-topmost-body to bottom-of-bottommost in source millimetres,
  then add ONLY the outer disc spaces. A disc between two resected bodies is already
  inside that span and must not be counted twice. That yields the true defect — intact
  endplate above to intact endplate below.
- The caudal-most member should own the reconstruction so the strut is built once, in one
  frame, as one piece; other members draw their resection but no strut.

**Why it was reverted.** Generalising `addBodyResectionReconstruction` from one body to a
run left stale references below the rewritten section: `bodyHeight` (renamed to
`spanHeight`) threw a ReferenceError, and `consumedSegments` became a Set so `.length` was
silently `undefined`. Both were fixed, but a third fault remained — after the fixes even a
SINGLE-level corpectomy produced no hardware root, so something still throws before the
root is attached. Contained to that one function; needs a debugging pass, not a guess.

**Resume order**
1. try/catch around the builder call, add a corpectomy at BODY-L2, read the exception.
2. Audit every consumer below the rewritten block for `bodyHeight` / `consumedSegments`.
3. Verify: exactly one strut per run; its top within tolerance of the intact endplate
   above and bottom of the one below; span > 2 body heights for a two-level run.
4. Re-apply the self-test change from `'contiguous complete-body resections fail closed'`
   to `'contiguous complete-body resections are permitted'` — it reverted with the file.
5. Update TESTING_README's procedure-coverage paragraph in the same commit.

**Open design question, decide before building further.** A rigid strut and the model's
per-level correction distribution disagree. A real multilevel strut fixes the spanned
vertebrae as one block, but `collectLocalCorrections` currently spreads correction evenly
across the spanned segments, which rotates them relative to a rigid strut. Making this
genuinely realistic means treating a resected run as a single rigid body for correction
purposes — a larger change than the geometry, and one to decide deliberately rather than
discover visually. The same question governs the single-level strut seam noted earlier.
