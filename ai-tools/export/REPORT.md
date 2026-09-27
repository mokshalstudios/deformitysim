# Vertebra-Landmark-Detection -> TF.js conversion report

Source: https://github.com/yijingru/Vertebra-Landmark-Detection (ISBI 2020, MIT). Cloned to `repo/`.
Everything lives under `$M = scratchpad/model`; outputs in `$M/out`.

## 1. Model facts (read from the repo source)

| Item | Value | Where |
|---|---|---|
| Input size | h=1024, w=512 (`--input_h 1024 --input_w 512`) | main.py |
| Resize | `cv2.resize(image, (512, 1024))` - plain **stretch**, no aspect preservation, no padding | pre_proc.processing_test, transform.Resize |
| Color order | **BGR** (cv2.imread), then CHW | pre_proc.processing_test |
| Normalization | `x = img.astype(float32) / 255 - 0.5`; no mean/std, no per-image normalization; range [-0.5, 0.5] | pre_proc.processing_test |
| Backbone | ResNet34 (repo's own resnet.py, returns feature pyramid), `pretrained=True` only affects init | models/spinal_net.py |
| Decoder net | DecNet: 3 CombinationModules (bilinear `F.interpolate(align_corners=False)` + 3x3 conv+BN+ReLU, concat, 1x1 conv+BN+ReLU) | models/dec_net.py, model_parts.py |
| Heads | `{'hm': 1, 'reg': 2, 'wh': 8}`; hm: 3x3 conv(64->256)+ReLU+1x1 conv -> **sigmoid**; reg: same w/o sigmoid; wh: **7x7** conv(64->256)+ReLU+7x7 conv(256->8) | dec_net.py, test.py (`num_classes=1`, `final_kernel=1`, `head_conv=256`) |
| down_ratio | 4 -> heads are [1,C,256,128] (NCHW in PyTorch) | main.py default |
| NMS | `F.max_pool2d(hm, 3, stride=1, padding=1)`; keep = (hmax == hm); hm *= keep | decoder._nms |
| top-K | **17, hard-coded** (`self.K = 17` ignores `--K`, whose default is 100) | decoder.DecDecoder.__init__ |
| conf_thresh | `--conf_thresh 0.2` default, but **never applied** in `ctdet_decode`; test.py draws all 17 | decoder.py, test.py |
| Center | `xs = ix + reg[0]`, `ys = iy + reg[1]` (ix = ind % 128, iy = ind // 128) | decoder.ctdet_decode |
| Corners | `tl = (xs - wh[0], ys - wh[1])`, `tr = (xs - wh[2], ys - wh[3])`, `bl = (xs - wh[4], ys - wh[5])`, `br = (xs - wh[6], ys - wh[7])` (wh = center - corner, in heatmap cells). Training GT: corners ordered tl,tr,bl,br via x-sort then y-sort (pre_proc.rearrange_pts) | decoder.py, pre_proc.generate_ground_truth |
| Output row | `[cx, cy, tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y, score]` x 17, sorted by score desc | decoder.py |
| To input pixels | `pts[:, :10] *= down_ratio` (4) -> 512x1024 coordinates; test.py then sorts by cy ascending and draws on the *resized* image | test.py |
| To original pixels | `x * w / 512`, `y * h / 1024` (the commented-out lines in test.py; consistent with the stretch resize) | test.py |

## 2. Weights

* Google Drive id `1X9gsP9_tvjPrfFlFWKkb9oP9jb-XmN7S` -> `weights/weights.zip` (89,819,955 B, sha256 `1b088004614c09ad6605f444c39b160144b07704b58bae13f21dd19665d7a1d2`)
* Contains a single file `model_last.pth` (96,958,693 B), **sha256 `6a779e01b9a41601334e0a9541278fc557a95bd650c6c8de311204821509d19b`**, keys `['epoch', 'state_dict']`, epoch 25.
* Loaded into `SpineNet(heads={'hm':1,'reg':2,'wh':8}, pretrained=False, down_ratio=4, final_kernel=1, head_conv=256)` with `strict=True`: **All keys matched successfully** (no `module.` prefix, no missing/unexpected keys). No `.cuda()` patches were needed because I bypassed test.py and called the model directly; `torch.load(..., weights_only=False)` was required with torch 2.13.

## 3. Environment / install notes (venv at `$M/venv`, Python 3.13.5, Windows)

* `torch 2.13.0+cpu`, `torchvision 0.28.0+cpu` (CPU wheels index). `onnx 1.20.1`, `onnxruntime 1.26.0`, `onnxsim 0.6.5`, `opencv-python-headless`, `numpy 2.2.6`.
* `tensorflow 2.21.0`, `tf_keras 2.21.0`, `onnx2tf 2.6.8`, `onnx-graphsurgeon`, `sng4onnx`, `ai-edge-litert 2.1.2`, `psutil` upgraded 5.9.5 -> 7.2.2 (5.9.5 crashes on py3.13 `disk_usage`, which silently disabled onnx2tf's shape-estimation/accuracy check).
* `tensorflowjs 4.22.0`: normal install is **ResolutionImpossible** (pins `tensorflow-decision-forests 1.8.1` -> `tensorflow~=2.15`, no py3.13 wheel). What worked: `pip install tensorflowjs==4.22.0 --no-deps`, then `pip install importlib_resources tensorflow-hub packaging six jax jaxlib flax`, plus a **stub package** `venv/Lib/site-packages/tensorflow_decision_forests/__init__.py` (tfjs imports it at module top only to register TF-DF ops). `tensorflowjs_converter` then runs on TF 2.21 without `--skip_op_check`.
* Node 24, `@tensorflow/tfjs@4.22.0` (pure-JS CPU backend), `jpeg-js` installed (not needed in the end: validation feeds the exact PyTorch-preprocessed tensor dumped as .npy).

## 4. Pipeline and numeric validation

### PyTorch reference (`run_reference.py`)
* 8 images, all 951x779 (PACS-viewer screenshots). `out/reference_landmarks.json`, `out/overlays/*.png`, `out/ref_<name>_{input,hm,reg,wh}.npy`.
* CPU forward: 1.36-1.63 s first pass per image, **1.37 s warm mean** (8 threads, torch 2.13 CPU).

### ONNX (`export_onnx.py`) -> `out/spine_ap_landmarks.onnx` (96,824,431 B)
* opset 13, input `input` [1,3,1024,512] float32, outputs `hm` [1,1,256,128], `reg` [1,2,256,128], `wh` [1,8,256,128], no dynamic axes, `dynamo=False` exporter.
* onnxsim folded BN into convs and removed Shape/Slice; ops left: Add, Concat, Conv, MaxPool, Relu, Resize(linear, half_pixel), Sigmoid.
* onnxruntime vs PyTorch max |diff|: image 1: hm 1.18e-6, reg 7.27e-6, wh 1.15e-4; image 2: hm 1.67e-6, reg 7.57e-6, wh 1.11e-4; argmax identical. ORT CPU ~1.25-1.46 s.

### SavedModel (`onnx2tf`) -> `out/saved_model` (saved_model.pb 96,871,789 B + tiny variables; tflite files in the same dir are by-products: f32 96.8 MB, f16 48.4 MB)
* **Deviation:** the classic path `onnx2tf -osd -tb tf_converter` produced a *wrong* model (hm max err 0.33, wh 10.1). Per-op check (`-cotof`) showed every op through `layer4` and `dec_c4` matching, then `dec_c3/Concat_1` off by 5.8 although both its inputs matched: an NHWC layout-tracking ambiguity (at that level H = C = 128, and at dec_c2 W = C = 128) that makes onnx2tf mis-transpose one concat input. The Resize sizes were correct.
* **Fix:** onnx2tf 2.6.8's new default `flatbuffer_direct` backend with `-fdosm` (`onnx2tf -i spine_ap_landmarks.onnx -o saved_model -fdosm`) tracks layout correctly. SavedModel signature: input `input` [1,1024,512,3] float32; outputs **`hm` [1,256,128,1], `reg` [1,256,128,2], `wh` [1,256,128,8]** (NHWC, names preserved).
* TF vs PyTorch max |diff| (NHWC-transposed reference): image 1: hm 2.29e-6, reg 2.27e-5, wh 2.87e-4; image 2: hm 1.21e-6, reg 1.48e-5, wh 1.80e-4; argmax identical. (Eager signature call ~32 s - unoptimized path, irrelevant.)

### TF.js GraphModels (`tensorflowjs_converter --input_format=tf_saved_model --output_format=tfjs_graph_model`)
Graph ops: Const, Placeholder, Pad x4 (explicit PyTorch-style padding before the stride-2 convs), PadV2 x1 (-3.4e38 fill before the VALID 3x3/s2 MaxPool; becomes -inf in f16, harmless), _FusedConv2D x48, MaxPool, AddV2 x16, Relu x16, ResizeBilinear x3 (half_pixel_centers=true), ConcatV2 x3, Sigmoid, Identity x3. All are standard WebGL-backend ops.
Signature: input `input` (node `input`) [1,1024,512,3]; outputs `hm` = `Identity:0`, `reg` = `Identity_1:0`, `wh` = `Identity_2:0`. `model.execute(x)` returns them in that order (also distinguishable by last dim 1/2/8).

| Variant | Dir | Weight bytes (shards) | model.json | Validation in Node (tfjs 4.22 CPU backend, exact PyTorch input tensor) |
|---|---|---|---|---|
| **float16 (recommended)** | `tfjs_f16` (12 shards) | 48,394,204 | 78,215 B | img 1: hm 1.15e-3, reg 5.15e-3, wh 6.65e-2; decoded landmarks **max 0.03 px** (input space), scores within 1.0e-3, top-17 peak set & order identical. img 2-2: hm 3.1e-3, reg 7.5e-3, wh 6.1e-2; landmarks **max 0.11 px**, scores within 3.0e-3, identical peaks/order. |
| mixed (uint8 for 19 conv kernels >= 589,824 params = 21.45M of 24.19M params; f16 for the other 78 float tensors) | `tfjs_mixed` (7 shards) | 26,947,548 | 79,106 B | img 1: hm 3.1e-2, reg 6.3e-2, wh 0.62; argmaxes identical; order-insensitive match of the 12 detections with score>=0.2: max center err 8.25 px (= 2 heatmap cells; 10/12 within 1 cell), max score err 0.019. img 2-2: conf dets center 0.08 px / corner 0.58 px, but low-confidence peaks re-rank (max score err 0.08). |
| uint8 (`--quantize_uint8='*'`) as requested | `tfjs_uint8` (6 shards) | 24,197,200 | 83,228 B | img 1: hm **0.14**, reg 0.25, wh **6.5**; hm argmax differs (958 vs 12349); top-17 peak set differs; **not usable**. |
| float32 (no quantization) | `tfjs_f32` (24 shards) | 96,788,212 | - | base for `tfjs_mixed`; not separately validated (identical weights to SavedModel). |

Why uint8 fails: tfjs quantization is per-tensor affine (min/scale, 256 levels) applied to BN-folded kernels whose per-channel scales vary widely. Simulated with onnxruntime on all 8 images (`quant_sensitivity.py`, `quant_configs.py`): the first 7x7 conv alone (9,408 params) drives hm error to 0.46; each other backbone layer adds ~0.005-0.07; all-uint8 total hm error 0.52 with 0/17 peak overlap on some images. Keeping only the large layers uint8 (`tfjs_mixed`) gives hm error 0.03-0.04 but still shifts some peaks by 1-2 cells. Peak scores in these images are only 0.1-0.6, so a 0.03 perturbation re-ranks near-tied cells. Use `tfjs_f16` unless the 21 MB saving matters more than a 1-2 cell (4-8 px in the 512x1024 input) jitter.

Node pure-JS CPU run time: ~190-200 s per image (expected for a 24M-param model with 1024x512 input on the JS CPU backend; the WebGL backend is the target).

### JS decoder (`out/decode_reference.js`)
Plain ES2019, no modules, no `TypedArray.prototype.at`; exports via `module.exports` only if present. `decodeSpineLandmarks(hm, reg, wh, {layout:'NHWC'|'NCHW', topK:17, downRatio:4})` implements the 3x3 max-pool NMS, top-17 (score desc, index asc tie-break like torch.topk CPU), reg offset, and the 4 corners (`center - wh`) scaled by 4 -> 512x1024 input coordinates; `spineLandmarksToOriginal()` rescales by origW/512, origH/1024; `spinePreprocessRGBA()` does the BGR /255-0.5 packing. Checked against `reference_landmarks.json` on the exact PyTorch heads for all 8 images: max coordinate error 5.5e-5 px, score error 0.

## 5. Base64 deliverables (step 9)
* `out/weights_f16.b64` - 64,525,608 chars (48,394,204 B, sha256 of raw concat `b8a14fd800dd4affd00d0153aac0bec616a4dd25eefcc43006008167f2b15e7c`), topology `out/model_topology_f16.json` == `out/model_topology.json`.
* `out/weights_mixed.b64` - 35,930,064 chars (26,947,548 B, sha256 `a25b32524a885018cea63a8fb6a8255687db10b8fa3a3889107b195954be7368`), topology `out/model_topology_mixed.json`.
* `out/weights_uint8.b64` - 32,262,936 chars (24,197,200 B, sha256 `fc000ddeae2354af6f3dc333fed0577bba57f3ef96c8c0451c95581361082e38`), topology `out/model_topology_uint8.json`. **Unusable numerically** (kept only because it was requested).
Each is the concatenation of the shard binaries in `weightsManifest` order (single group). To load in the browser: `tf.loadGraphModel({load: async () => ({modelTopology: mj.modelTopology, weightSpecs: mj.weightsManifest.flatMap(g => g.weights), weightData: decodedArrayBuffer, format: mj.format, signature: mj.signature})})` - exactly what `validate_tfjs.js` does from files. The topology JSON for a variant must be paired with that variant's weights (weightSpecs carry the quantization metadata).

## 6. Quality of the detections on the 8 sample images (frank assessment)
All 8 files are 951x779 **screenshots of a PACS viewer** (UI bars, thick black borders, the radiograph occupies a narrow central strip). The model was trained on tightly cropped AP whole-spine radiographs (SpineWeb dataset 16, 17 thoracic+lumbar vertebrae, tall portrait images). Max heatmap scores here are 0.11-0.61 versus ~0.8-1.0 expected on in-domain images, so the domain shift is severe.

| Image | What it is | Result |
|---|---|---|
| 1 | AP whole-spine radiograph (with lumbar fixation hardware), very narrow strip inside black borders | 12/17 detections >= 0.2 (max 0.34). Detections cluster on the cervical/upper-thoracic part; lumbar region (hardware) mostly missed. Corner quads are plausible in size/orientation but it is not a clean set of 17 consecutive vertebrae. |
| 1-1 | Lateral whole-spine radiograph (not AP) | 5 detections >= 0.2, scattered (skull base and lumbar); not meaningful. |
| 1-2 | CT scout / lateral chest view inside a viewer window | 0 detections >= 0.2 (max 0.11). Nothing usable. |
| 1-3 | Sagittal CT reformat (not a radiograph) | 3 >= 0.2 in a mid-spine cluster; not a coherent 17-vertebra chain. |
| 2 | Lateral whole-spine radiograph (not AP) | 4 >= 0.2, scattered. |
| 2-1 | AP whole-spine radiograph with pelvis/hips, wider field | only 1 detection >= 0.2 (0.33); the thoracic/lumbar vertebrae are largely missed. Worse than image 1 despite being the most "AP" film - the viewer chrome and wide black margins leave the spine ~1/8 of the frame width after stretching. |
| 2-2 | Sagittal CT (thoracic) | best scores (max 0.61, 12 >= 0.2, 9 >= 0.3); the model follows the vertebral column in the sagittal slice, but this is an out-of-domain modality and the "corners" are not AP corners. |
| 2-3 | Sagittal CT (lumbar/pelvis) | 8 >= 0.2 along the lumbar column; same caveat. |

Only **1** and **2-1** are AP whole-spine films, and on neither does the model produce 17 sensible vertebrae. Expect far better behaviour if the app crops the image to the radiograph (remove viewer chrome/black margins) and ideally to the spine region before the 512x1024 stretch; the repo's test set images are ~ 500 x 1200-2500 px portrait crops containing T1-L5. A conf threshold of 0.2-0.3 is needed for display; the repo itself does no thresholding.

## 7. Files
* `out/spine_ap_landmarks.onnx` (96.8 MB), `out/onnx_validation.json`
* `out/saved_model/` (saved_model.pb 96.9 MB), `out/saved_model_validation.json`
* `out/tfjs_f16/`, `out/tfjs_mixed/`, `out/tfjs_uint8/`, `out/tfjs_f32/` (+ `out/tfjs_validation_<variant>_<img>.json`)
* `out/decode_reference.js`, `out/spec.json`, `out/reference_landmarks.json`, `out/overlays/*.png`, `out/overlays_grid.png`
* `out/weights_{f16,mixed,uint8}.b64`, `out/model_topology{,_f16,_mixed,_uint8}.json`
* `out/quant_sensitivity.json`, `out/quant_configs.json`, `out/tfjs_mixed_quant_map.json`
* Scripts: `run_reference.py`, `export_onnx.py`, `verify_saved_model.py`, `quant_sensitivity.py`, `quant_configs.py`, `make_mixed.py`, `make_spec.py`, `validate_tfjs.js`, `decoder_only_check.js`, `make_b64.js`; logs `*.log`.
* `out/saved_model_tfconv/` is the *incorrect* tf_converter-path SavedModel kept for reference (do not use).
