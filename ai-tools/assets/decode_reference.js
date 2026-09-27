/* decode_reference.js — plain ES2019 port of decoder.DecDecoder.ctdet_decode from
 * yijingru/Vertebra-Landmark-Detection (ISBI 2020). No modules, no TypedArray.prototype.at.
 *
 * Inputs are the three raw head outputs as flat Float32Array (or plain arrays) in NHWC
 * layout as produced by the TF.js GraphModel (onnx2tf converts NCHW->NHWC):
 *   hm : [1, H, W, 1]   sigmoid heatmap, H = inputH/4 = 256, W = inputW/4 = 128
 *   reg: [1, H, W, 2]   sub-pixel center offset (dx, dy) in heatmap cells
 *   wh : [1, H, W, 8]   (ctr - corner) vectors, channel order:
 *                       [tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y]
 * If you have NCHW data instead, pass opts.layout = 'NCHW'.
 *
 * Algorithm (exactly as the PyTorch decoder):
 *   1. NMS: 3x3 max-pool (stride 1, pad 1) on hm; keep cells equal to their local max.
 *   2. top-K (K = 17, hard-coded in DecDecoder.__init__) by score over the NMS'd map.
 *      Ties: torch.topk on CPU returns lower flat index first; we sort by score desc,
 *      index asc to mirror that.
 *   3. center = (x + reg[0], y + reg[1]) in heatmap cells; corner_i = center - wh[2i:2i+2].
 *   4. Multiply everything by downRatio (4) -> coordinates in the 512x1024 network input.
 *      The repo's conf_thresh (0.2 default) is NEVER applied inside ctdet_decode; test.py
 *      draws all 17. We return all 17 with scores; the caller may filter by score.
 *   5. To map to original image pixels: x * origW / inputW, y * origH / inputH
 *      (the resize is a plain stretch, no letterbox).
 *
 * Returns an array of K objects, in descending score order (decoder order):
 *   { score, cx, cy, ix, iy, tl:[x,y], tr:[x,y], bl:[x,y], br:[x,y] }
 * where all coordinates are in network-input pixels (multiplied by downRatio) and
 * ix, iy are the integer heatmap cell indices.
 */
function decodeSpineLandmarks(hm, reg, wh, opts) {
  opts = opts || {};
  var H = opts.height || 256;
  var W = opts.width || 128;
  var K = opts.topK || 17;
  var downRatio = opts.downRatio || 4;
  var nchw = opts.layout === 'NCHW';
  var HW = H * W;

  function regAt(i, c) { return nchw ? reg[c * HW + i] : reg[i * 2 + c]; }
  function whAt(i, c) { return nchw ? wh[c * HW + i] : wh[i * 8 + c]; }

  // 1. NMS via 3x3 max-pool (same padding); keep == local max
  var cand = [];
  for (var y = 0; y < H; y++) {
    var y0 = y > 0 ? y - 1 : 0;
    var y1 = y < H - 1 ? y + 1 : H - 1;
    for (var x = 0; x < W; x++) {
      var i = y * W + x;
      var v = hm[i];
      var x0 = x > 0 ? x - 1 : 0;
      var x1 = x < W - 1 ? x + 1 : W - 1;
      var m = -Infinity;
      for (var yy = y0; yy <= y1; yy++) {
        var row = yy * W;
        for (var xx = x0; xx <= x1; xx++) {
          var u = hm[row + xx];
          if (u > m) m = u;
        }
      }
      // heat * keep: non-maxima become 0 (still eligible for top-K if fewer than K peaks)
      cand.push({ s: m === v ? v : 0, i: i });
    }
  }

  // 2. top-K (score desc, then index asc to mimic torch.topk CPU tie order)
  cand.sort(function (a, b) { return b.s !== a.s ? b.s - a.s : a.i - b.i; });

  var out = [];
  for (var k = 0; k < K && k < cand.length; k++) {
    var idx = cand[k].i;
    var iy = Math.floor(idx / W);
    var ix = idx - iy * W;
    var cx = ix + regAt(idx, 0);
    var cy = iy + regAt(idx, 1);
    var r = downRatio;
    out.push({
      score: cand[k].s,
      ix: ix, iy: iy,
      cx: cx * r, cy: cy * r,
      tl: [(cx - whAt(idx, 0)) * r, (cy - whAt(idx, 1)) * r],
      tr: [(cx - whAt(idx, 2)) * r, (cy - whAt(idx, 3)) * r],
      bl: [(cx - whAt(idx, 4)) * r, (cy - whAt(idx, 5)) * r],
      br: [(cx - whAt(idx, 6)) * r, (cy - whAt(idx, 7)) * r]
    });
  }
  return out;
}

/* Map a decoded detection (input-pixel coords, 512x1024) to original image pixels. */
function spineLandmarksToOriginal(dets, origW, origH, inputW, inputH) {
  inputW = inputW || 512; inputH = inputH || 1024;
  var sx = origW / inputW, sy = origH / inputH;
  function p(q) { return [q[0] * sx, q[1] * sy]; }
  var res = [];
  for (var k = 0; k < dets.length; k++) {
    var d = dets[k];
    res.push({ score: d.score, cx: d.cx * sx, cy: d.cy * sy,
      tl: p(d.tl), tr: p(d.tr), bl: p(d.bl), br: p(d.br) });
  }
  return res;
}

/* Preprocess helper for reference: given RGBA pixel data of an image already drawn/resized
 * to inputW x inputH (plain stretch), produce the NHWC float32 input with the repo's
 * normalization. The PyTorch code reads with cv2 (BGR) and does x/255 - 0.5, so channel
 * order in the network input is B, G, R. */
function spinePreprocessRGBA(rgba, inputW, inputH) {
  inputW = inputW || 512; inputH = inputH || 1024;
  var n = inputW * inputH;
  var outArr = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) {
    outArr[i * 3 + 0] = rgba[i * 4 + 2] / 255 - 0.5; // B
    outArr[i * 3 + 1] = rgba[i * 4 + 1] / 255 - 0.5; // G
    outArr[i * 3 + 2] = rgba[i * 4 + 0] / 255 - 0.5; // R
  }
  return outArr;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeSpineLandmarks: decodeSpineLandmarks,
    spineLandmarksToOriginal: spineLandmarksToOriginal,
    spinePreprocessRGBA: spinePreprocessRGBA };
}
