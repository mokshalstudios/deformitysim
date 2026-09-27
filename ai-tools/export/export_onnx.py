"""Export SpineNet to ONNX with fixed [1,3,1024,512] input and outputs hm, reg, wh; verify with onnxruntime."""
import os, sys, json, time
import numpy as np
import torch

M = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(M, 'repo'))
from models import spinal_net

OUT = os.path.join(M, 'out')
heads = {'hm': 1, 'reg': 2, 'wh': 8}
model = spinal_net.SpineNet(heads=heads, pretrained=False, down_ratio=4, final_kernel=1, head_conv=256)
ckpt = torch.load(os.path.join(M, 'weights', 'model_last.pth'), map_location='cpu', weights_only=False)
sd = {k[7:] if k.startswith('module.') else k: v for k, v in ckpt['state_dict'].items()}
model.load_state_dict(sd, strict=True)
model.eval()


class Wrapped(torch.nn.Module):
    def __init__(self, m):
        super().__init__(); self.m = m
    def forward(self, x):
        d = self.m(x)
        return d['hm'], d['reg'], d['wh']


wrapped = Wrapped(model).eval()
dummy = torch.zeros(1, 3, 1024, 512, dtype=torch.float32)
onnx_path = os.path.join(OUT, 'spine_ap_landmarks.onnx')
opset = int(os.environ.get('OPSET', '13'))
torch.onnx.export(wrapped, dummy, onnx_path, opset_version=opset, input_names=['input'],
                  output_names=['hm', 'reg', 'wh'], dynamic_axes=None, do_constant_folding=True,
                  dynamo=False)
print('exported', onnx_path, os.path.getsize(onnx_path), 'bytes, opset', opset)

import onnx
m = onnx.load(onnx_path)
onnx.checker.check_model(m)
print('inputs:', [(i.name, [d.dim_value for d in i.type.tensor_type.shape.dim]) for i in m.graph.input])
print('outputs:', [(o.name, [d.dim_value for d in o.type.tensor_type.shape.dim]) for o in m.graph.output])
print('ops:', sorted(set(n.op_type for n in m.graph.node)))

# simplify
try:
    import onnxsim
    ms, ok = onnxsim.simplify(m)
    if ok:
        onnx.save(ms, onnx_path)
        print('onnxsim ok; size now', os.path.getsize(onnx_path), 'ops:', sorted(set(n.op_type for n in ms.graph.node)))
    else:
        print('onnxsim check failed; kept original')
except Exception as e:
    print('onnxsim unavailable/failed:', repr(e))

import onnxruntime as ort
sess = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
report = {}
for name in ['1', '2']:
    inp = np.load(os.path.join(OUT, f'ref_{name}_input.npy'))
    t0 = time.perf_counter()
    o = sess.run(None, {'input': inp})
    dt = time.perf_counter() - t0
    diffs = {}
    for key, arr in zip(['hm', 'reg', 'wh'], o):
        ref = np.load(os.path.join(OUT, f'ref_{name}_{key}.npy'))
        diffs[key] = {'max_abs_diff': float(np.abs(arr - ref).max()), 'shape': list(arr.shape),
                      'argmax_onnx': int(arr.argmax()), 'argmax_torch': int(ref.argmax())}
    report[name] = {'diffs': diffs, 'ort_ms': dt * 1000}
    print(name, json.dumps(diffs), f'ort {dt*1000:.0f} ms')
json.dump(report, open(os.path.join(OUT, 'onnx_validation.json'), 'w'), indent=1)
