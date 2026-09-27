# Offline imaging assets (DICOM decoder + neural AP landmark model)

Everything in this directory is embedded into `spine_simulator.html` between the
`<!--__SPINE_AI_ASSETS_START__-->` / `<!--__SPINE_AI_ASSETS_END__-->` markers by
`embed_ai_assets.js`. The application still makes no network requests: the
TensorFlow.js runtime, the model topology, the base64 weights, and the DICOM
decoder all travel inside the single HTML file.

## What is embedded

| Asset | Purpose | Origin / licence |
|---|---|---|
| `assets/dicom_radiograph.js` | Pure-JS DICOM radiograph decoder (no wasm, workers or network). `decodeRadiograph` (sync): implicit/explicit VR LE, encapsulated uncompressed, **RLE Lossless**, **JPEG Lossless** (process 14 / SV1: predictors 1-7, point transform, restarts); 8/16-bit MONOCHROME1/2; RGB / YBR_FULL / YBR_FULL_422 converted to luminance; multi-frame decodes frame 1 with a warning; Rescale, Window, **VOI LUT Sequence**, **Presentation LUT Shape**. `decodeRadiographAsync` also handles **Deflated** (DecompressionStream) and **8-bit lossy JPEG** (the browser's decoder). JPEG 2000, JPEG-LS, 12-bit lossy JPEG, big endian and PALETTE COLOR fail closed with a named reason and re-export advice. Also returns `orientation` (ViewPosition, PatientOrientation, ImageLaterality) and `calibration` (PixelSpacingCalibrationType, magnification factor, SID/SOD) for the app to use; the decoder never acts on them. Identity tags (group 0010, institution, physician, private tags) are skipped, never read. Tests: `node ai-tools/dicom-tests/test.js`; fixtures from `ai-tools/dicom-tests/make_fixtures.py`. | Written for this project |
| `assets/tf.min.js` | TensorFlow.js 4.22.0 **ES2017** bundle (`dist/tf.es2017.min.js`; the default ES5 bundle embeds core-js polyfills that call `Function("return this")` and is blocked by the no-`unsafe-eval` CSP). WebGL backend only — the pure-JS CPU backend needs minutes per film and is not offered. | Google, Apache-2.0 |
| `assets/model_topology.json`, `assets/weights.b64`, `assets/spec.json` | Vertebra-corner detector (ResNet34 + decoder; centre heatmap, centre offset, 8-channel corner offsets) converted from PyTorch to a TF.js graph model, float16-quantized (uint8 was validated as unusable: per-tensor affine quantization of the BN-folded kernels destroys the heatmap) | Yi et al., "Vertebra-Focused Landmark Detection for Scoliosis Assessment", ISBI 2020 — code MIT (`yijingru/Vertebra-Landmark-Detection`); weights published by the authors without an explicit licence, trained on AASCE 2019 / SpineWeb dataset 16 (AP whole-spine, research use). **Research/education use only.** |
| `assets/decode_reference.js` | Plain-JS heatmap decoder validated against the authors' PyTorch decoder | Written for this project |
| `assets/selftest_pattern.js` | Deterministic synthetic radiograph used for the GPU numeric self-test | Written for this project |
| `assets/spine_ai_module.js` | Browser runtime: loads the embedded model, preprocesses the model-input canvas, decodes vertebra quads, maps them to analysis coordinates (`window.__SPINE_AI__`) | Written for this project |

## Rebuilding the HTML

```powershell
node tools/build.js              # full build: DICOM decoder + neural model (needs assets/weights.b64)
node tools/build.js --no-model   # DICOM decoder only (public build, ~4 MB)
node tools/build.js --strip      # no imaging assets
# tools/build.js assembles src/ and then calls ai-tools/embed_ai_assets.js
```

Re-run the audit tools afterwards (`audit-tools/check_html.js`, `v2_static_probe.js`,
`interaction_harness.js`, `scene_harness.js`). Both static tools now validate the
typed data blocks (`application/json` must parse, `application/octet-stream` must be
strict base64) instead of trying to execute them.

## How the model is used

- Frontal plane only. The radiograph module renders the same exposed-field region
  it analyses into a 512×1024 canvas, runs the network, and receives 4 corners per
  vertebra. Each vertebra becomes a tilt line through the midpoints of its left and
  right borders (the convention the training labels' Cobb angles used), so the
  existing Cobb pairing, overlay and drag editor work unchanged.
- Output is gated: at least 10 vertebrae above the confidence threshold, monotonic
  top-to-bottom order, plausible spacing, inside the exposed field. Anything else
  is rejected with a named reason and the classical corridor search runs instead.
- The model was trained on full-resolution AP EOS-style scoliosis films of
  T1–L5. Cropped, lateral, cervical-only, heavily instrumented or low-resolution
  screenshots are out of distribution; expect rejection or poor corners there.
- Provenance: `state.patientImaging.autoCalibration.algorithm` becomes
  `frontal_neural_ap_corner_v1+lateral_…` when the neural result was accepted;
  `engines`, `neural` and `dicom` sub-objects record what ran. `clinicallyValidated`
  remains `false`.

## GPU numeric self-test and execution modes

`spec.json` carries a `selfTest` block: the heat map, centre-offset and corner-offset
values at 8 detected peaks plus a fixed 24-cell grid, computed on the TensorFlow.js
**CPU** backend at build time by `ai-tools/make_selftest_reference.js` from the
deterministic pattern in `assets/selftest_pattern.js`.

At load time the runtime pushes the same pattern through the network on the user's GPU
and compares **all three output heads** with that reference (a known-answer test). GPU
back ends differ between devices, drivers and browsers, and a failure can leave one head
wrong while the others - including the heat map that drives the overlay - look normal, so
checking a single head is not sufficient.

`ensureLoaded()` tries the execution modes in order and uses the first that passes:

1. `packed-expconv` - packed textures with `WEBGL_EXP_CONV` (fast);
2. `unpacked` - `WEBGL_PACK=false` (slower fallback).

If no mode passes, the neural engine is disabled on that device and the classical search
runs instead; the status line says which mode ran (`__SPINE_AI__.status().mode` and
`.attempts`). TF.js's default packed mode is deliberately not offered: for the final 7x7
convolution of the corner-offset head its im2col path requests a single texture larger
than some GPUs will allocate, and that failure does not surface as an exception.
`tf.engine().reset()` also resets the environment, so the flags are set *after* the reset.

To regenerate the reference after changing the model:

```powershell
node ai-tools/make_selftest_reference.js   # needs @tensorflow/tfjs on NODE_PATH; minutes on CPU
node tools/build.js
```

## Public builds do not contain the model weights

The authors' weights carry no licence statement, so `assets/weights.b64` is not part of
the public repository and public builds are made with `node tools/build.js --no-model`
(classical engine + DICOM decoder, ~4 MB). Anyone who obtains the weights from the authors
can reproduce the conversion with the pipeline in `export/` (see `export/REPORT.md`), place
`weights.b64` in `assets/`, and run `node tools/build.js` for a full build.

Two passes run on the frontal film: if the first (exposed-field crop) is rejected, a second
pass runs on a crop around the classical corridor and is accepted only if it passes the
same gates. Duplicate peaks on one vertebra (closer than 45% of the median spacing) are
merged before gating.

## Regenerating the model assets

The export pipeline (PyTorch → ONNX → onnx2tf SavedModel → tensorflowjs_converter
`--quantize_uint8`) and its numeric validation log are in `export/REPORT.md`.
