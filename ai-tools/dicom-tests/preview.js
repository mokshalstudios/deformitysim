/* preview.js -- decode a DICOM with dicom_radiograph.js and write gray8 to a
 * PGM (P5) or PNG (8-bit grayscale, via Node's built-in zlib) so a human can
 * look at it.
 *
 * Usage: node preview.js <input.dcm> <output.pgm|output.png> [--scale N]
 *   --scale N   integer box-downsample factor (default 1)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var api = require(path.join(__dirname, '..', 'assets', 'dicom_radiograph.js'));

function downsample(gray, w, h, s) {
  if (s <= 1) return { data: gray, w: w, h: h };
  var ow = Math.floor(w / s), oh = Math.floor(h / s);
  var out = new Uint8Array(ow * oh);
  for (var y = 0; y < oh; y++) {
    for (var x = 0; x < ow; x++) {
      var sum = 0;
      for (var dy = 0; dy < s; dy++) {
        var row = (y * s + dy) * w + x * s;
        for (var dx = 0; dx < s; dx++) sum += gray[row + dx];
      }
      out[y * ow + x] = Math.round(sum / (s * s));
    }
  }
  return { data: out, w: ow, h: oh };
}

function writePGM(file, data, w, h) {
  var header = Buffer.from('P5\n' + w + ' ' + h + '\n255\n', 'ascii');
  fs.writeFileSync(file, Buffer.concat([header, Buffer.from(data.buffer, data.byteOffset, data.length)]));
}

var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, data, w, h) {
  var raw = Buffer.alloc((w + 1) * h);
  for (var y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit grayscale
  var png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

async function main() {
  var args = process.argv.slice(2);
  var scale = 1;
  var si = args.indexOf('--scale');
  if (si >= 0) { scale = parseInt(args[si + 1], 10) || 1; args.splice(si, 2); }
  if (args.length < 2) {
    console.error('usage: node preview.js <input.dcm> <output.pgm|output.png> [--scale N]');
    process.exit(2);
  }
  var buf = fs.readFileSync(args[0]);
  var ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  var t0 = Date.now();
  // Async entry point: also inflates Deflated files (lossy JPEG needs a browser).
  var r = await api.decodeRadiographAsync(ab);
  var ms = Date.now() - t0;
  if (!r.ok) {
    console.error('decode failed: ' + r.reason + ' - ' + r.message);
    process.exit(1);
  }
  var img = downsample(r.gray8, r.columns, r.rows, scale);
  var out = args[1];
  if (/\.png$/i.test(out)) writePNG(out, img.data, img.w, img.h);
  else writePGM(out, img.data, img.w, img.h);
  console.log('decoded ' + r.rows + 'x' + r.columns + ' ' + r.photometric + ' ' + r.bitsAllocated + '-bit in ' + ms + ' ms; ' +
    'window ' + r.window.center + '/' + r.window.width + ' (' + r.window.source + ', ' + r.window.function + '); codec ' + r.pixelCodec + '; ' +
    'spacing ' + r.pixelSpacingMm.row + 'x' + r.pixelSpacingMm.col + ' mm (' + r.pixelSpacingMm.source + '); ' +
    'wrote ' + out + ' (' + img.w + 'x' + img.h + ', ' + fs.statSync(out).size + ' bytes)' +
    (r.warnings.length ? '; warnings: ' + r.warnings.join(',') : ''));
}

main().catch(function (e) { console.error(e && e.stack); process.exit(1); });
