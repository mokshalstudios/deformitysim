# DeformitySim — open-source alpha v0.23.1

Research and education use only; not a medical device.

One file, `spine_simulator.html`. Open it in a browser — that is the whole application.
It runs fully offline and makes no network requests.

---

## What this is

An educational three-plane spine modelling workspace. You enter a hypothetical case
(PI, LL, TK, CL, PT, plus coronal/axial inputs), inspect the reference anatomy in 3D,
build a procedure itinerary, and see the modelled alignment plus a non-causal
cross-sectional gait-cohort interpolation.

## What this is not

- **Not surgical planning.** It does not select treatment, establish eligibility, or
  predict an achieved correction.
- **Not patient-specific.** The 3D anatomy is a single CT-derived reference atlas posed
  to your numbers. It is not the patient's bone.
- **Not a measurement device.** Imported radiographs are a teaching aid for landmark
  practice, not a calibrated measurement pipeline.

**Do not enter identifiable patient information.** Any imaging you load stays on your
device for the session and is never transmitted.

---

## Getting in

Open the file; the workspace opens directly with a short intro. The public alpha has
no launch code (`LAUNCH_GATE_ENABLED = false` in `src/js/00-launch-gate.js`).

An internal gated build can re-enable the launch-code prompt at build time. That prompt
is an access gate, **not** a security boundary: the whole application has to reach the
browser in order to run, so anyone determined can read the source. Gated builds use a
code that is never published; see `deploy/DEPLOY.md` for the server-authenticated deploy.

---

## Worth trying

| Area | Where |
|---|---|
| Guided demo | ▶ in the header — cycles deformities and construct responses, loops |
| Showcase summary | ✦ in the header — pre-op vs post-op alignment, construct, gait deltas |
| Gait | **Gait** in the viewport toolbar; then switch Pre-Op / Modeled Post-Op |
| Suggested constructs | Step 3, "Suggested fixes" — apply a branch and watch the residual |
| Immersive view | ⤢ in the viewport toolbar; Esc exits. Panels also fold from the edge tabs |
| Level isolation | Click a level, isolate it; the on-canvas pill or Esc restores the full model |
| Radiograph landmarks | Step 1 → Examples & import → automatic calibration, or manual calibration |
| DICOM film + neural frontal model | Stage a `.dcm` standing pair (uncompressed); spacing auto-fills; the frontal engine and any rejection reason are named in the status line |

Manual calibration goes full-screen and strips every overlay. Any landmark that is
unreadable on the film can be **skipped** — measurements that needed it are omitted
rather than estimated from a guess.

---

## Procedure coverage

28 procedures. Alongside the interbody, decompression, fixation and pelvic families:

- **Corpectomy** — ACCF (C3–C7) and thoracolumbar corpectomy with vertebral body
  replacement. These target a vertebral **body**, not a disc, so they appear under a
  separate "vertebral bodies" group in the level list and each option names the two discs
  it spans. Adjacent complete body resections are rejected because a continuous
  multilevel reconstruction model has not been implemented.
- **Full Schwab osteotomy ladder** — grade 1 partial facet, grade 2 (SPO/Ponte), grade 3
  (PSO), grade 4 extended PSO, grade 5 VCR. Grade 6 is deliberately withheld: composing
  adjacent grade-5 resections would create a disconnected and clinically misleading
  short-strut reconstruction in the current renderer.
- **ACR** (anterior column realignment) as its own entry rather than a bigger XLIF —
  a standard lateral interbody does not include an ALL release and must not inherit its range.
- **Laminoplasty**, **C1–C2 fusion**, **lumbar disc replacement**, **kyphoplasty**.

Two things the ladder is built to teach, both sourced: ACCF's default correction is **zero**
(corpectomy is a decompression, not a lordosing operation — pooled data slightly favour
ACDF), and grade 4 vs grade 5 achieved **statistically similar** segmental correction in a
matched comparison for markedly more operative time and blood loss. Climbing the ladder
does not buy correction linearly.

**Deliberately excluded**, and the app says so rather than silently lacking it: paediatric
growth modulation (tethering, growing rods), oncologic staging and en-bloc planning (the
mechanical reconstruction after resection *is* modelled), pain/neuromodulation procedures,
AxiaLIF, sacrectomy, and occipitocervical spanning constructs.

## Known limits, stated up front

- **Implant catalogue.** HEDRON P heights and lordosis are verified against the Globus
  technique guide; Mobi-C heights against FDA PMA P110002. The HEDRON C/T/A size
  matrices and the uCentum/uBase screw dimensions could **not** be verified against a
  primary source and are labelled as such in the implant panel. Do not treat any
  dimension as an ordering reference.
- **Gait couplings** are straight-line fits between two published cohorts (pelvic tilt
  13 and 24). Outside that span the figures are extrapolation, and the panel says so.
  Bands are distance from the published control, not clinical severity grades.
- **No forces or causal gait prediction.** Gait is a kinematic display indexed from
  cross-sectional cohort means — no loads, muscle activity, treatment response, or
  patient-specific walking outcome is predicted.
- **CT / hybrid intake is blocked** and labelled untested.
- **Prior hardware detection** exists but is gated off: it caught 1 of 3 instrumented
  films in testing, which is not good enough to surface. Instrumented films get a
  standing caution instead.
- **Correction bounds on the new procedures.** Defaults are sourced where a figure exists
  (grade 1 ≈8°, grade 4 41±14°, VCR 45–70°, thoracolumbar corpectomy 5.9°, kyphoplasty ≈3°).
  The **ceilings and negative floors are authoring bounds, not published limits** — they cap
  the slider, they do not assert an achievable correction. C1–C2 and lumbar disc replacement
  bounds are entirely unverified and labelled as such in code. Grade 6 has no published
  per-level figure at all, so none is offered.
- **SPO and PSO ceilings were reduced** (20°→15°, 45°→40°). The old SPO ceiling was twice
  every published figure and twice what the app's own evidence text told the user.
- **Automatic landmark detection on the lateral plane** is classical image processing,
  not deep learning. It has a real accuracy ceiling. Check every line it draws, and use
  manual calibration when it drifts. Signed C2–C7 and C7 SVA are withheld until the user
  explicitly declares which side of the lateral image is anterior.
- **Frontal plane (2026-08-23 build): an embedded neural vertebra-corner model** can replace
  the classical corridor search. It is the ISBI 2020 "Vertebra-Focused Landmark Detection"
  network (MIT code; author-published weights with no explicit licence, trained on AASCE
  2019 AP whole-spine scoliosis films — research/education use only), converted to
  TensorFlow.js and embedded as base64 in full builds only (the public build does not
  contain the weights). It runs in this browser only. Its output is gated
  (≥10 confident vertebrae, monotonic order, plausible spacing, inside the exposed field);
  when rejected, the status names the reason and the classical search runs instead. It was
  trained on full-resolution T1–L5 AP films: cropped, lateral, cervical-only, heavily
  instrumented or low-resolution screenshots are out of distribution. The toggle
  "Frontal: use the embedded neural vertebra-corner model" turns it off. It is **not**
  clinically validated; the provenance string records which engine produced each plane.
- **The model checks its own arithmetic on your GPU before it is used.** A fixed synthetic
  radiograph is pushed through the network at load time and all three network outputs are
  compared against a reference computed on the CPU when the build was made. GPUs, drivers and
  browsers differ, and a failure can leave one output wrong while the heat map that drives the
  overlay still looks normal, so every output is checked. The fastest mode that passes is
  used; if no mode passes, the neural engine is switched off on that device and the classical
  search runs instead, and the status line says which mode ran. A wrong number is worse than
  no number.
- **DICOM radiographs** are decoded locally: uncompressed, JPEG Lossless, RLE Lossless,
  baseline JPEG and deflated transfer syntaxes; 8/16-bit MONOCHROME1/2 (colour captures are
  converted to luminance; multi-frame objects use frame 1) with the header window, VOI LUT,
  Presentation LUT Shape and Rescale. PixelSpacing or ImagerPixelSpacing fills an empty
  mm/px field (never overriding a typed value); detector-plane ImagerPixelSpacing is divided
  by the header's radiographic magnification factor when one is present, and the note says
  which was used. JPEG 2000, JPEG-LS and big-endian objects fail closed with a named reason
  and re-export advice. Identity tags are never read.
  CT/hybrid intake remains blocked.

---

## Reporting

Useful bug reports include: the browser and device, the case (or example name), the
exact steps, and what you expected instead. The build id is shown on the intro screen
and in the showcase footer — please include it.

Screenshots of anything overlapping, unreadable, or cut off on your device are
especially useful; layout on real tablets is the least-tested surface.
