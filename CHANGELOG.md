# Changelog

## 0.23.1-alpha — 2026-09-28

### Fixed
- **The hip bones no longer disappear when pelvic incidence is changed.** At any PI other
  than the atlas value, the iliac bones (and, when switched on, the SI-joint surfaces, the
  pelvic ligaments and pelvic fixation hardware) used to be hidden. They now stay visible
  across the whole PI range: the pelvis shape is adjusted schematically to the entered PI.
  The part of each hip bone that meets the sacrum moves with it, so the sacroiliac joints
  stay in contact; the hip sockets stay on the femoral heads; the bone in between blends
  smoothly. Pelvic implants stay rigid, anchored at their entry point. This is an
  educational approximation, not patient anatomy, and the scene, the geometry chip, the gait
  readout and Help say so.
- Every measured and reported value is unchanged: PI, PT, sacral slope and all modeled
  outputs still come from the same sacrum, spine and femoral-head axis as before.

## 0.23.0-alpha — 2026-09-27 — first open-source alpha

The project is renamed **DeformitySim** (previously Spine Scenario Studio). Case files saved under
the old name still open.

A full audit of the application (six scoped code audits, more than 100 findings) followed by
seven implementation packages and a release QA pass. All regression suites pass.

### Radiograph workflow (the biggest change)
- **Much simpler intake.** One attestation instead of five; drag-and-drop one or two films,
  or paste a screenshot with Ctrl/Cmd+V; a frontal-only or lateral-only study can be analysed;
  DICOM files are recognised by content (extension-less PACS/CD exports work) with a header
  summary and thumbnail at selection; "Stage & analyze" runs straight away with a sticky
  progress bar; a Swap frontal ⇄ lateral button.
- **Review tools.** Zoom and pan, a magnifier loupe, window/level, invert, rotate and flip;
  manual landmarks can be dragged after placement, with undo/redo and keyboard placement;
  manual calibration no longer traps the user behind the dialog (its controls were
  unclickable, fatally so on touch devices); clicks map exactly onto the film.
- **Full-resolution landmarking** (up to 2048 px, previously capped at 520 × 840 px).
- **Automatic deskew.** A film taken or scanned at an angle is straightened to the spine axis
  before the neural engine runs (only when it improves the result); the notes say "deskewed by
  X°".
- **Faster neural engine.** The on-device model now runs in a fast execution mode instead of
  falling back to the slow mode on affected GPUs; the numeric self-test still gates every mode.
- **Measurement correctness.** Signed C2–C7 angle fixed (lordosis was reported as kyphosis);
  lumbar lordosis, thoracic kyphosis and pelvic tilt are signed; Cobb angles above 90° are no
  longer folded; the automatic femoral-head search actually runs; EXIF-rotated photos of films
  are no longer squashed; collimated DICOM films keep the lumbar spine and pelvis; guide
  anchors refine the trace instead of replacing it; the automatic primary Cobb is always the
  larger curve.
- **Honest outputs.** Patient-side laterality is explicit ("Patient right is on the image:
  not confirmed / left / right", filled from DICOM when available) and side-dependent values
  are withheld until it is confirmed; automatic lateral level values are labelled as
  low-confidence estimates and never pre-selected; confidence is no longer inflated by
  unrelated edits; each applied value records whether it was typed, manually landmarked, or
  automatic (accepted or adjusted).
- **DICOM.** JPEG Lossless, RLE Lossless, baseline JPEG and deflated transfer syntaxes;
  multi-frame (frame 1) and colour secondary captures; VOI LUT and Presentation LUT Shape;
  magnification-corrected spacing; orientation and view tags pre-fill the anterior side and
  patient side and flag swapped films; unsupported codecs are named with re-export advice.
- **Export.** "Copy measurements" and a local "Download review" (annotated overlay PNGs +
  JSON + text) with no file names or DICOM identifiers, behind a burned-in-identifier warning.

### Modelling
- Coronal curves are drawn convex toward the labelled apex side and the trunk is balanced over
  the pelvis (previously some scoliosis examples leaned far to one side in AP view); the drawn
  apex offset equals the entered apical translation.
- The pelvic-tilt response to lordosis correction is level-dependent (Lafage et al. 2022:
  larger at L4–S1 than proximally).
- Gait is available at any pelvic incidence (it was previously limited to the reference PI),
  and the gait readout shows the animated hip and knee ranges.
- Junction osteotomies, corpectomies and VCRs now change the reported TK/LL/CL; TK is the
  T4–T12 value throughout; the pelvic-tilt response no longer rises after a lordosing
  correction in low-PI cases; construct comparisons no longer suggest kyphosing cervical
  surgery for compensatory hyperlordosis and use the curve apex level; lateral interbody
  defaults follow published gains without ALL release; stacked per-level corrections are
  bounded; the app no longer freezes after an out-of-domain correction; optional age field
  with Lafage 2016 age-adjusted reference values (display only).

### Workspace
- Save and open cases as JSON files (parameters and procedures only), undo/redo, confirmation
  before replacing an edited case; procedures can be edited in place; view presets
  (Lat/AP/PA/Obl); inputs, model and outputs visible together at ≥1440 px; larger minimum
  text with projector scaling; consistent built-in icons; quick start in Help; the
  Pre-Op/Post-Op switch no longer covers the model; clearer input validation (negative values
  can be typed; SVA units checked).
- Guided demo asks before replacing an edited case and restores it on exit.
- The launch-code gate is off in the open-source build (the internal hosted build can turn it
  back on; see deploy/DEPLOY.md).

### Engineering
- Source split into `src/` fragments with a byte-identical build (`tools/build.js`).
- Real-browser test driver (`audit-tools/cdp.js`) and ~800 new regression checks across nine
  new suites, including crafted malicious case files (prototype pollution) and DICOM fuzzing.

## 0.22.0 — 2026-08-23 (internal)
Local DICOM decoding and the embedded neural frontal landmark model with a GPU numeric
self-test. See `archive/` in the internal repository.
