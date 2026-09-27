/* selftest_pattern.js — deterministic synthetic "spine" radiograph used to check
 * that the embedded network computes the same numbers in this browser as the
 * reference CPU run made at build time. Pure arithmetic, no randomness, so the
 * browser and Node produce identical input bytes. Plain ES2019, no modules.
 *
 * Returns an RGBA Uint8ClampedArray of width*height*4 (grey image replicated to
 * R=G=B, alpha 255) - the same shape the model-input canvas produces. */
function spineSelfTestPattern(width, height) {
  var out = new Uint8ClampedArray(width * height * 4);
  var cx0 = width * 0.5;
  var bodies = 17;
  var top = height * 0.1, bottom = height * 0.92;
  var pitch = (bottom - top) / bodies;
  for (var y = 0; y < height; y++) {
    var t = (y - top) / (bottom - top);
    // Gentle S-curve so the vertebrae are not perfectly aligned.
    var cx = cx0 + Math.sin(t * Math.PI * 1.5) * width * 0.06;
    for (var x = 0; x < width; x++) {
      var v = 38;                                  // film background
      var dx = Math.abs(x - cx);
      // Soft "torso" gradient so the column is not the only structure.
      var torso = Math.max(0, 1 - Math.abs(x - cx0) / (width * 0.45));
      v += torso * 34 * (0.6 + 0.4 * Math.sin(y * 0.02));
      if (y >= top && y <= bottom) {
        var k = Math.floor((y - top) / pitch);
        var fy = (y - top - k * pitch) / pitch;     // 0..1 within one body+disc
        var halfW = width * (0.07 + 0.045 * (k / bodies));  // bodies widen caudally
        var inBody = fy > 0.12 && fy < 0.88 && dx < halfW;
        if (inBody) {
          var edge = Math.min(halfW - dx, Math.min(fy - 0.12, 0.88 - fy) * pitch);
          v += 120 + (edge < 3 ? 35 : 0);          // cortical rim is brighter
          // Faint endplate concavity.
          v -= Math.abs(fy - 0.5) < 0.08 ? 10 : 0;
        } else if (dx < halfW * 1.55 && fy > 0.2 && fy < 0.8) {
          v += 55;                                  // pedicles / posterior elements
        }
      }
      var i = (y * width + x) * 4;
      var g = v > 255 ? 255 : v < 0 ? 0 : v;
      out[i] = g; out[i + 1] = g; out[i + 2] = g; out[i + 3] = 255;
    }
  }
  return out;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { spineSelfTestPattern: spineSelfTestPattern };
