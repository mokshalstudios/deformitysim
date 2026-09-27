"""Run the original PyTorch SpineNet on the 8 sample radiographs using the repo's own
preprocessing (pre_proc.processing_test) and decoder (decoder.DecDecoder).
Writes out/reference_landmarks.json, out/overlays/<name>.png, and dumps
out/ref_<name>_{input,hm,reg,wh}.npy for later ONNX / TF.js comparisons."""
import os, sys, json, time, hashlib
import numpy as np
import cv2
import torch

M = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(M, 'repo')
sys.path.insert(0, REPO)
from models import spinal_net
import decoder as dec_mod
import pre_proc

IMG_DIR = r"C:\Users\moksh\Documents\App Projects\Spine Simulator V2"
NAMES = ['1', '1-1', '1-2', '1-3', '2', '2-1', '2-2', '2-3']
INPUT_H, INPUT_W, DOWN_RATIO = 1024, 512, 4
OUT = os.path.join(M, 'out')
os.makedirs(os.path.join(OUT, 'overlays'), exist_ok=True)

heads = {'hm': 1, 'reg': 2, 'wh': 8}
model = spinal_net.SpineNet(heads=heads, pretrained=False, down_ratio=DOWN_RATIO,
                            final_kernel=1, head_conv=256)
ckpt_path = os.path.join(M, 'weights', 'model_last.pth')
ckpt = torch.load(ckpt_path, map_location='cpu', weights_only=False)
print('checkpoint keys:', list(ckpt.keys()), 'epoch:', ckpt.get('epoch'))
sd = ckpt['state_dict']
# strip possible DataParallel prefix
sd = {k[7:] if k.startswith('module.') else k: v for k, v in sd.items()}
res = model.load_state_dict(sd, strict=True)
print('strict load result:', res)
model.eval()

decoder = dec_mod.DecDecoder(K=100, conf_thresh=0.2)  # K is hardcoded to 17 inside

results = {}
timings = []
for name in NAMES:
    path = os.path.join(IMG_DIR, name + '.jpg')
    ori = cv2.imread(path)  # BGR
    h, w, c = ori.shape
    inp = pre_proc.processing_test(ori, INPUT_H, INPUT_W)  # [1,3,1024,512], BGR, /255-0.5
    t0 = time.perf_counter()
    with torch.no_grad():
        out = model(inp)
    dt = time.perf_counter() - t0
    timings.append(dt)
    hm, reg, wh = out['hm'], out['reg'], out['wh']
    print(f'{name}: ori {w}x{h}, hm {tuple(hm.shape)} reg {tuple(reg.shape)} wh {tuple(wh.shape)}  fwd {dt*1000:.0f} ms')
    np.save(os.path.join(OUT, f'ref_{name}_input.npy'), inp.numpy())
    np.save(os.path.join(OUT, f'ref_{name}_hm.npy'), hm.numpy())
    np.save(os.path.join(OUT, f'ref_{name}_reg.npy'), reg.numpy())
    np.save(os.path.join(OUT, f'ref_{name}_wh.npy'), wh.numpy())

    pts2 = decoder.ctdet_decode(hm, wh, reg)  # [17, 11] in heatmap (down_ratio) coords
    pts_in = pts2.copy()
    pts_in[:, :10] *= DOWN_RATIO  # -> 1024x512 input pixel coords (what test.py draws)
    pts_ori = pts_in.copy()
    pts_ori[:, 0:10:2] = pts_in[:, 0:10:2] / INPUT_W * w
    pts_ori[:, 1:10:2] = pts_in[:, 1:10:2] / INPUT_H * h
    # heatmap peak values at the (integer) NMS'd centers
    hm_np = hm[0, 0].numpy()
    dets = []
    for k in range(pts2.shape[0]):
        cx_hm, cy_hm = pts2[k, 0], pts2[k, 1]
        # integer cell index = center minus reg offset; reconstruct from decoder internals
        dets.append({
            'score': float(pts2[k, 10]),
            'center_hm': [float(cx_hm), float(cy_hm)],
            'center_input': [float(pts_in[k, 0]), float(pts_in[k, 1])],
            'center': [float(pts_ori[k, 0]), float(pts_ori[k, 1])],
            'corners_input': {
                'tl': [float(pts_in[k, 2]), float(pts_in[k, 3])],
                'tr': [float(pts_in[k, 4]), float(pts_in[k, 5])],
                'bl': [float(pts_in[k, 6]), float(pts_in[k, 7])],
                'br': [float(pts_in[k, 8]), float(pts_in[k, 9])],
            },
            'corners': {
                'tl': [float(pts_ori[k, 2]), float(pts_ori[k, 3])],
                'tr': [float(pts_ori[k, 4]), float(pts_ori[k, 5])],
                'bl': [float(pts_ori[k, 6]), float(pts_ori[k, 7])],
                'br': [float(pts_ori[k, 8]), float(pts_ori[k, 9])],
            },
        })
    # sort top-to-bottom like test.py does
    order = np.argsort([d['center'][1] for d in dets])
    dets_sorted = [dets[i] for i in order]
    # NMS'd heatmap peak values (top 17 after NMS) for reference
    heat = decoder._nms(hm)
    topv, topi = torch.topk(heat.view(-1), 17)
    peaks = [{'value': float(v), 'index': int(i), 'y': int(i) // 128, 'x': int(i) % 128} for v, i in zip(topv, topi)]
    results[name] = {
        'original_size': {'w': int(w), 'h': int(h)},
        'input_size': {'w': INPUT_W, 'h': INPUT_H},
        'hm_max': float(hm_np.max()),
        'forward_ms': dt * 1000,
        'heatmap_peaks_nms_top17': peaks,
        'detections_sorted_top_to_bottom': dets_sorted,
        'detections_decoder_order': dets,
    }
    # overlay on original image
    vis = ori.copy()
    n_conf = 0
    for i, d in enumerate(dets_sorted):
        col = (0, 255, 0) if d['score'] >= 0.2 else (0, 0, 255)
        if d['score'] >= 0.2:
            n_conf += 1
        cx, cy = int(round(d['center'][0])), int(round(d['center'][1]))
        cv2.circle(vis, (cx, cy), 4, col, -1)
        cs = d['corners']
        quad = [cs['tl'], cs['tr'], cs['br'], cs['bl']]
        for a, b in zip(quad, quad[1:] + quad[:1]):
            cv2.line(vis, (int(round(a[0])), int(round(a[1]))), (int(round(b[0])), int(round(b[1]))), col, 1)
        for key, cc in [('tl', (255, 0, 0)), ('tr', (0, 255, 255)), ('bl', (255, 0, 255)), ('br', (0, 128, 255))]:
            cv2.circle(vis, (int(round(cs[key][0])), int(round(cs[key][1]))), 2, cc, -1)
        cv2.putText(vis, f'{i+1}:{d["score"]:.2f}', (cx + 6, cy + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, col, 1)
    cv2.imwrite(os.path.join(OUT, 'overlays', name + '.png'), vis)
    results[name]['num_score_ge_0.2'] = n_conf
    print(f'   scores: {[round(d["score"],3) for d in dets_sorted]}')

# timing: extra warm runs on one image
inp = torch.from_numpy(np.load(os.path.join(OUT, 'ref_1_input.npy')))
with torch.no_grad():
    model(inp)
    ts = []
    for _ in range(3):
        t0 = time.perf_counter(); model(inp); ts.append(time.perf_counter() - t0)
results['_meta'] = {
    'checkpoint': 'weights/model_last.pth',
    'checkpoint_sha256': hashlib.sha256(open(ckpt_path, 'rb').read()).hexdigest(),
    'checkpoint_epoch': int(ckpt.get('epoch', -1)),
    'torch_version': torch.__version__,
    'cpu_forward_ms_first_pass_per_image': [t * 1000 for t in timings],
    'cpu_forward_ms_warm_mean': float(np.mean(ts) * 1000),
    'torch_threads': torch.get_num_threads(),
}
json.dump(results, open(os.path.join(OUT, 'reference_landmarks.json'), 'w'), indent=1)
print('warm forward ms:', [round(t*1000) for t in ts])
