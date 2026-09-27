/* test.js -- Node test suite for dicom_radiograph.js (no framework).
 * Usage: node test.js            (exit code 1 on any failure)
 *        node test.js --quick    (smaller mutation fuzz)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var vm = require('vm');

var HERE = __dirname;
var FIX = path.join(HERE, 'fixtures');
var LIB_PATH = path.join(HERE, '..', 'assets', 'dicom_radiograph.js');
var api = require(LIB_PATH);
var QUICK = process.argv.indexOf('--quick') >= 0;

var failures = 0, passes = 0;
function check(cond, msg) {
  if (cond) { passes++; return true; }
  failures++;
  console.log('    FAIL: ' + msg);
  return false;
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps); }

function toArrayBuffer(buf) {
  // Fresh ArrayBuffer so byteOffset is 0 (Node Buffers may be pooled slices).
  var ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}
function sha1(bytes) { return crypto.createHash('sha1').update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex'); }
function sameBytes(a, b) {
  if (!a || !b) return a === b;
  return a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
}

// Deep-compare an expectation object against a subset of the result.
function expectSubset(res, exp, prefix) {
  Object.keys(exp).forEach(function (k) {
    var want = exp[k], got = res ? res[k] : undefined;
    var label = (prefix || '') + k;
    if (want !== null && typeof want === 'object' && !Array.isArray(want)) {
      if (!check(got !== null && typeof got === 'object', label + ' should be an object, got ' + JSON.stringify(got))) return;
      expectSubset(got, want, label + '.');
    } else if (typeof want === 'number' && typeof got === 'number') {
      check(approx(got, want, 1e-6 * Math.max(1, Math.abs(want))), label + ' expected ' + want + ' got ' + got);
    } else {
      check(got === want, label + ' expected ' + JSON.stringify(want) + ' got ' + JSON.stringify(got));
    }
  });
}

// Checks shared by the sync result and an `async` expectation block.
function checkOutcome(res, c, tag) {
  var p = tag ? tag + ': ' : '';
  check(typeof res.ok === 'boolean', p + 'ok is boolean');
  check(typeof res.message === 'string', p + 'message is string');
  check(res.privacy && res.privacy.identityTagsRead === false, p + 'privacy.identityTagsRead === false');
  check(Array.isArray(res.warnings), p + 'warnings is array');
  check(res.reason !== 'parse_error', p + 'no unexpected exception (' + res.message + ')');
  if (c.ok !== undefined) check(res.ok === c.ok, p + 'ok expected ' + c.ok + ' got ' + res.ok + ' (' + res.reason + ': ' + res.message + ')');
  if (c.reason !== undefined && c.reason !== null) check(res.reason === c.reason, p + 'reason expected ' + c.reason + ' got ' + res.reason);
  if (c.ok === true) check(res.reason === null, p + 'reason null on success');
  if (c.expect) expectSubset(res, c.expect, p);
  if (c.noWarnings) check(res.warnings.length === 0, p + 'no warnings expected, got ' + JSON.stringify(res.warnings));
  if (c.warningsInclude) c.warningsInclude.forEach(function (w) {
    check(res.warnings.indexOf(w) >= 0, p + 'warning ' + w + ' expected, got ' + JSON.stringify(res.warnings));
  });
  if (c.messageIncludes) check(res.message.indexOf(c.messageIncludes) >= 0, p + 'message should include "' + c.messageIncludes + '": ' + res.message);
  if (res.ok) {
    var n = res.rows * res.columns;
    check(res.gray8 instanceof Uint8ClampedArray && res.gray8.length === n, p + 'gray8 is Uint8ClampedArray of rows*columns');
    check((res.raw16 instanceof Int32Array || res.raw16 instanceof Float32Array) && res.raw16.length === n, p + 'raw16 typed array of rows*columns');
    var lutWindow = res.window.source === 'voi_lut_sequence';
    check(lutWindow ? res.window.function === 'LUT' : ['LINEAR', 'LINEAR_EXACT'].indexOf(res.window.function) >= 0,
      p + 'window.function applied is LINEAR/LINEAR_EXACT (or LUT for a VOI LUT Sequence)');
    check(res.frameDecoded === 1, p + 'frameDecoded is 1');
  } else {
    check(res.gray8 === null && res.raw16 === null, p + 'gray8/raw16 null on failure');
  }
  if (c.raw16Type) check(res.raw16 && res.raw16.constructor.name === c.raw16Type, p + 'raw16 type ' + c.raw16Type);
  if (c.raw16 && res.raw16) {
    var bad = -1;
    for (var i = 0; i < c.raw16.length; i++) if (res.raw16[i] !== c.raw16[i]) { bad = i; break; }
    check(bad < 0, p + 'raw16 prefix matches (first mismatch at ' + bad + ': ' + (bad >= 0 ? res.raw16[bad] + ' vs ' + c.raw16[bad] : '') + ')');
  }
  if (c.raw16Sha1 && res.raw16) check(sha1(res.raw16) === c.raw16Sha1, p + 'raw16 (every pixel) matches the source image exactly');
  if (c.gray8 && res.ok) {
    var exp = fs.readFileSync(path.join(FIX, c.gray8));
    if (check(exp.length === res.gray8.length, p + 'expected gray8 length ' + exp.length + ' got ' + res.gray8.length)) {
      var maxDiff = 0, diffCount = 0, firstBad = -1;
      for (var j = 0; j < exp.length; j++) {
        var d = Math.abs(exp[j] - res.gray8[j]);
        if (d > maxDiff) maxDiff = d;
        if (d > 1) { diffCount++; if (firstBad < 0) firstBad = j; }
      }
      check(maxDiff <= 1, p + 'gray8 within +-1 of pydicom/reference (maxDiff=' + maxDiff + ', ' + diffCount + ' pixels off, first at ' + firstBad + ')');
      console.log('    ' + p + 'gray8 max abs diff vs reference: ' + maxDiff);
    }
  }
}

function sameResult(a, b) {
  return a.ok === b.ok && a.reason === b.reason && a.message === b.message && JSON.stringify(a.warnings) === JSON.stringify(b.warnings) &&
    sameBytes(a.gray8, b.gray8) && sameBytes(a.raw16, b.raw16) && JSON.stringify(a.window) === JSON.stringify(b.window) &&
    JSON.stringify(a.orientation) === JSON.stringify(b.orientation) && JSON.stringify(a.calibration) === JSON.stringify(b.calibration) &&
    a.rows === b.rows && a.columns === b.columns && a.pixelCodec === b.pixelCodec && a.displayInverted === b.displayInverted;
}

async function main() {
  // -------------------------------------------------------------------------
  // 0. Static checks on the library source (inlining / sandbox constraints)
  // -------------------------------------------------------------------------
  console.log('== source constraints');
  (function () {
    var src = fs.readFileSync(LIB_PATH, 'utf8');
    var closeScript = '<' + '/script>';
    check(src.indexOf(closeScript) < 0, 'source must not contain a script close tag');
    check(src.indexOf('<!' + '--') < 0, 'source must not contain an HTML comment opener');
    var banned = ['eval', 'new Function', 'fetch', 'XMLHttpRequest', 'Worker', 'localStorage', 'postMessage', 'BigInt', 'import(', 'require(',
      'WebAssembly', 'createObjectURL', 'importScripts'];
    banned.forEach(function (b) {
      var re = new RegExp('\\b' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      check(!re.test(src), 'source must not use ' + b);
    });
    check(!/\.at\(/.test(src), 'source must not use TypedArray.prototype.at');
    check(/window\.__SPINE_DICOM__\s*=\s*api/.test(src), 'assigns window.__SPINE_DICOM__');
    check(/module\.exports\s*=\s*api/.test(src), 'assigns module.exports');
    check(typeof api.decodeRadiograph === 'function', 'exports decodeRadiograph');
    check(typeof api.decodeRadiographAsync === 'function', 'exports decodeRadiographAsync');
    // Simulate a browser global and re-evaluate the IIFE in a sandbox.
    var sandbox = { window: {} };
    vm.runInNewContext(src, sandbox);
    check(sandbox.window.__SPINE_DICOM__ && typeof sandbox.window.__SPINE_DICOM__.decodeRadiograph === 'function', 'browser global assigned under window');
    console.log('  size of dicom_radiograph.js: ' + Buffer.byteLength(src, 'utf8') + ' bytes');
  })();

  // -------------------------------------------------------------------------
  // 1. Fixture cases from expected.json (sync, then async)
  // -------------------------------------------------------------------------
  var cases = JSON.parse(fs.readFileSync(path.join(FIX, 'expected.json'), 'utf8'));
  var realFacts = null, skipped = [];

  for (var ci = 0; ci < cases.length; ci++) {
    var c = cases[ci];
    var file = path.join(FIX, c.file);
    if (!fs.existsSync(file)) {
      console.log('== ' + c.file + ' (missing, skipped)');
      skipped.push(c.file);
      continue;
    }
    console.log('== ' + c.file + '  [' + c.label + ']');
    var buf = fs.readFileSync(file);
    var ab = toArrayBuffer(buf);
    var t0 = process.hrtime.bigint();
    var res = api.decodeRadiograph(ab);
    var ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log('    ok=' + res.ok + ' reason=' + res.reason + ' ' + ms.toFixed(1) + ' ms' +
      (res.warnings.length ? ' warnings=' + JSON.stringify(res.warnings) : ''));
    checkOutcome(res, c, '');

    // Async entry point: identical to sync unless the case says otherwise.
    if (c.jpegReference) {
      var plain = await api.decodeRadiographAsync(toArrayBuffer(buf));
      check(plain.ok === false && plain.reason === 'jpeg_decoder_unavailable' && plain.message.indexOf('Re-export') >= 0,
        'async without a browser image decoder fails closed (' + plain.reason + ')');
      var rgb = fs.readFileSync(path.join(FIX, c.jpegReference));
      var seen = [];
      var stub = function (bytes, info) {
        seen.push(sha1(bytes));
        var npx = info.rows * info.columns, rgba = new Uint8ClampedArray(npx * 4);
        for (var q = 0; q < npx; q++) { rgba[4 * q] = rgb[3 * q]; rgba[4 * q + 1] = rgb[3 * q + 1]; rgba[4 * q + 2] = rgb[3 * q + 2]; rgba[4 * q + 3] = 255; }
        return Promise.resolve({ width: info.columns, height: info.rows, data: rgba });
      };
      var viaStub = await api.decodeRadiographAsync(toArrayBuffer(buf), { jpegDecoder: stub });
      check(seen.length === 1 && seen[0] === c.jpegStreamSha1, 'the browser decoder receives the reassembled JPEG stream (fragments concatenated)');
      checkOutcome(viaStub, c.async, 'async');
      console.log('    async (injected decoder): ok=' + viaStub.ok + ' reason=' + viaStub.reason);
    } else if (c.async) {
      var ares = await api.decodeRadiographAsync(toArrayBuffer(buf));
      console.log('    async: ok=' + ares.ok + ' reason=' + ares.reason + (ares.warnings.length ? ' warnings=' + JSON.stringify(ares.warnings) : ''));
      checkOutcome(ares, c.async, 'async');
    } else {
      var same = await api.decodeRadiographAsync(toArrayBuffer(buf));
      check(sameResult(same, res), 'decodeRadiographAsync gives the same result as decodeRadiograph');
    }

    if (c.canaries) {
      // (a) no canary string anywhere in the JSON form of the result
      var json = JSON.stringify(res, function (k, v) {
        if (v && ArrayBuffer.isView(v)) return Array.prototype.slice.call(v, 0, 4096);
        return v;
      });
      c.canaries.forEach(function (s) {
        check(json.indexOf(s) < 0, 'output JSON must not contain "' + s + '"');
      });
      check(json.indexOf('SHOULD') < 0 && json.indexOf('CANARY') < 0, 'output JSON has no canary fragments');
      // (b) output must be byte-for-byte independent of the identity/private value bytes
      var mutated = Buffer.from(buf);
      c.canarySpans.forEach(function (sp) {
        for (var q = sp[0]; q < sp[0] + sp[1]; q++) mutated[q] = 0x58; // 'X'
      });
      var res2 = api.decodeRadiograph(toArrayBuffer(mutated));
      var sameC = res2.ok === res.ok && res2.reason === res.reason && JSON.stringify(res2.warnings) === JSON.stringify(res.warnings) &&
        res2.gray8.length === res.gray8.length && Buffer.compare(Buffer.from(res2.gray8.buffer), Buffer.from(res.gray8.buffer)) === 0 &&
        JSON.stringify(res2.window) === JSON.stringify(res.window) && res2.rows === res.rows && res2.columns === res.columns;
      check(sameC, 'result is independent of identity/private tag value bytes (' + c.canarySpans.length + ' spans overwritten)');
      console.log('    privacy: ' + c.canaries.length + ' canary strings absent; output invariant under ' + c.canarySpans.length + ' overwritten spans');
    }

    if (c.timingMaxMs) {
      // warm-up already done above; take the best of 3 runs
      var best = ms;
      for (var k = 0; k < 2; k++) {
        var t1 = process.hrtime.bigint();
        api.decodeRadiograph(ab);
        var m2 = Number(process.hrtime.bigint() - t1) / 1e6;
        if (m2 < best) best = m2;
      }
      check(best < c.timingMaxMs, 'decode time ' + best.toFixed(1) + ' ms must be < ' + c.timingMaxMs + ' ms');
      console.log('    timing: best of 3 = ' + best.toFixed(1) + ' ms for ' + res.rows + 'x' + res.columns);
    }

    if (c.real) {
      realFacts = {
        file: c.file, bytes: ab.byteLength, ok: res.ok, reason: res.reason,
        transferSyntaxUID: res.transferSyntaxUID, sopClassUID: res.sopClassUID, modality: res.modality,
        photometric: res.photometric, rows: res.rows, columns: res.columns, bitsAllocated: res.bitsAllocated,
        bitsStored: res.bitsStored, pixelRepresentation: res.pixelRepresentation,
        pixelSpacingMm: res.pixelSpacingMm, window: res.window, rescale: res.rescale, stats: res.stats,
        orientation: res.orientation, calibration: res.calibration,
        warnings: res.warnings, decodeMs: +ms.toFixed(1), pydicomLoadMs: c.pydicomLoadMs, pydicomMaxDiff: c.pydicomMaxDiff
      };
      if (res.ok) {
        var t2 = process.hrtime.bigint();
        api.decodeRadiograph(ab);
        realFacts.decodeMsSecondRun = +(Number(process.hrtime.bigint() - t2) / 1e6).toFixed(1);
        // the real file carries a PatientName; make sure nothing from group 0010 leaks
        var rj = JSON.stringify(res, function (k, v) { return (v && ArrayBuffer.isView(v)) ? undefined : v; });
        check(rj.indexOf('PatientName') < 0 && !/"patient/i.test(rj), 'no patient fields in real-file result');
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. API robustness: bad inputs, options
  // -------------------------------------------------------------------------
  console.log('== api robustness');
  var big = fs.readFileSync(path.join(FIX, 'f01_implicit_mono2_16.dcm'));
  (function () {
    var r;
    r = api.decodeRadiograph(null); check(r.ok === false && r.reason === 'invalid_input', 'null input -> invalid_input');
    r = api.decodeRadiograph('string'); check(r.ok === false, 'string input -> ok:false');
    r = api.decodeRadiograph(new ArrayBuffer(0)); check(r.ok === false && r.reason === 'not_dicom', 'empty -> not_dicom');
    r = api.decodeRadiograph(new Uint8Array(200)); check(r.ok === false && r.reason === 'not_dicom', 'zeros -> not_dicom');
    // too_large by bytes
    r = api.decodeRadiograph(toArrayBuffer(big), { maxBytes: 1000 });
    check(r.ok === false && r.reason === 'too_large', 'maxBytes -> too_large');
    r = api.decodeRadiograph(toArrayBuffer(big), { maxPixels: 100 });
    check(r.ok === false && r.reason === 'too_large' && r.rows === 96, 'maxPixels -> too_large (metadata kept)');
    // Node Buffer (pooled slice with byteOffset) works too
    r = api.decodeRadiograph(big);
    check(r.ok === true, 'Node Buffer input accepted');
    // custom percentiles on an auto-window fixture
    var f3 = fs.readFileSync(path.join(FIX, 'f03_explicit_mono2_8bit.dcm'));
    var a = api.decodeRadiograph(toArrayBuffer(f3));
    var b = api.decodeRadiograph(toArrayBuffer(f3), { autoWindowPercentiles: [5, 95] });
    check(b.window.source === 'auto_percentile' && b.window.width < a.window.width, 'custom autoWindowPercentiles narrow the window');
    // no-preamble variants of a valid file: 'DICM' at offset 0, and raw file meta at offset 0
    var ref = api.decodeRadiograph(toArrayBuffer(big));
    var v1 = api.decodeRadiograph(toArrayBuffer(big.subarray(128)));
    check(v1.ok && v1.warnings.indexOf('no_preamble') >= 0 && Buffer.compare(Buffer.from(v1.gray8.buffer), Buffer.from(ref.gray8.buffer)) === 0, 'DICM without preamble decodes identically with no_preamble warning');
    var v2 = api.decodeRadiograph(toArrayBuffer(big.subarray(132)));
    check(v2.ok && v2.warnings.indexOf('no_preamble') >= 0 && v2.transferSyntaxUID === '1.2.840.10008.1.2' && Buffer.compare(Buffer.from(v2.gray8.buffer), Buffer.from(ref.gray8.buffer)) === 0, 'raw file meta without preamble decodes identically');
    // truncation at random points must never throw nor hit an unexpected exception
    var threw = false, okCount = 0, parseErrors = 0;
    for (var cut = 0; cut < big.length; cut += 97) {
      try {
        var rr = api.decodeRadiograph(toArrayBuffer(big.subarray(0, cut)));
        if (rr.ok) okCount++;
        if (rr.reason === 'parse_error') parseErrors++;
      } catch (e) { threw = true; break; }
    }
    check(!threw, 'random truncations never throw');
    check(okCount === 0, 'truncated files never report ok');
    check(parseErrors === 0, 'truncated files never hit an unexpected exception (parse_error), got ' + parseErrors);
    // bit-flip fuzz on headers. decodeRadiograph catches everything, so "never
    // throws" alone is vacuous: the real signal is reason 'parse_error' (an
    // exception escaped the parser's own checks) and the decode time.
    var rng = 12345;
    var rnd = function () { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng; };
    threw = false; parseErrors = 0;
    var slowest = 0;
    for (var it = 0; it < 300; it++) {
      var m = Buffer.from(big);
      for (var f = 0; f < 8; f++) { var p = rnd() % 1400; m[p] = rnd() & 0xff; }
      try {
        var t3 = process.hrtime.bigint();
        var fr = api.decodeRadiograph(toArrayBuffer(m));
        var took = Number(process.hrtime.bigint() - t3) / 1e6;
        for (var again = 0; again < 2 && took >= 1000; again++) { // re-time outliers (busy machine)
          var t4 = process.hrtime.bigint(); api.decodeRadiograph(toArrayBuffer(m)); took = Math.min(took, Number(process.hrtime.bigint() - t4) / 1e6);
        }
        slowest = Math.max(slowest, took);
        if (fr.reason === 'parse_error') { parseErrors++; if (parseErrors < 3) console.log('    parse_error: ' + fr.message); }
      } catch (e) { threw = true; console.log('    threw: ' + e.stack); break; }
    }
    check(!threw, 'header bit-flip fuzz never throws');
    check(parseErrors === 0, 'header bit-flip fuzz never hits an unexpected exception (parse_error), got ' + parseErrors);
    check(slowest < 1000, 'header bit-flip fuzz: slowest decode ' + slowest.toFixed(1) + ' ms < 1000 ms');
  })();

  // -------------------------------------------------------------------------
  // 3. Codec / API specifics
  // -------------------------------------------------------------------------
  console.log('== codec specifics');
  (function () {
    var internal = api._internal;
    // Classification of transfer syntaxes that must fail closed with guidance
    [['1.2.840.10008.1.2.4.90', 'jpeg2000_unsupported'], ['1.2.840.10008.1.2.4.91', 'jpeg2000_unsupported'],
      ['1.2.840.10008.1.2.4.201', 'jpeg2000_unsupported'], ['1.2.840.10008.1.2.4.80', 'jpeg_ls_unsupported'],
      ['1.2.840.10008.1.2.4.81', 'jpeg_ls_unsupported'], ['1.2.840.10008.1.2.4.100', 'video_transfer_syntax_unsupported'],
      ['1.2.840.10008.1.2.4.110', 'jpeg_xl_unsupported'], ['1.2.840.10008.1.2.8.1', 'compressed_transfer_syntax_unsupported']
    ].forEach(function (t) {
      var cl = internal.classifyTS(t[0]);
      check(cl && cl.kind === 'unsupported' && cl.reason === t[1], 'transfer syntax ' + t[0] + ' -> ' + t[1] + ' (got ' + JSON.stringify(cl) + ')');
    });
    ['1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.51', '1.2.840.10008.1.2.4.57', '1.2.840.10008.1.2.4.70'].forEach(function (ts) {
      check(internal.classifyTS(ts).kind === 'jpeg', ts + ' is routed to the JPEG path');
    });
    check(internal.classifyTS('1.2.840.10008.1.2.5').kind === 'rle', 'RLE Lossless is routed to the RLE path');
    // A lossless stream with a Huffman symbol > 16 is rejected like libjpeg-turbo does
    var bad = new Uint8Array([0xFF, 0xD8, 0xFF, 0xC4, 0x00, 0x14, 0x00, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0xD9]);
    var threw = null;
    try { internal.decodeJpegLossless(bad); } catch (e) { threw = e; }
    check(threw && threw.reason === 'jpeg_stream_invalid', 'Huffman symbol 255 in a lossless table -> jpeg_stream_invalid');
    // RLE output bound: a 64-byte header claiming big segments cannot force a big allocation
    var hdr = new Uint8Array(80); new DataView(hdr.buffer).setUint32(0, 1, true); new DataView(hdr.buffer).setUint32(4, 64, true);
    threw = null;
    try { internal.decodeRle(hdr, 4000, 4000, 1, 1); } catch (e) { threw = e; }
    check(threw && threw.reason === 'rle_data_corrupt', 'RLE segment too short for the image is rejected before allocating');
    check(Array.isArray(api.capabilities.sync) && api.capabilities.asyncOnly.indexOf('1.2.840.10008.1.2.1.99') >= 0, 'capabilities lists sync and async-only transfer syntaxes');
  })();
  // maxInflatedBytes bounds a deflate bomb
  var defl = fs.readFileSync(path.join(FIX, 'f43_deflated_padded.dcm'));
  var capped = await api.decodeRadiographAsync(toArrayBuffer(defl), { maxInflatedBytes: 4096 });
  check(capped.ok === false && capped.reason === 'too_large', 'maxInflatedBytes caps the inflated dataset (' + capped.reason + ')');
  var corrupt = Buffer.from(defl); for (var z = corrupt.length - 600; z < corrupt.length - 300; z++) corrupt[z] ^= 0x5A;
  var cres = await api.decodeRadiographAsync(toArrayBuffer(corrupt));
  check(cres.ok === false && cres.reason !== 'parse_error', 'a corrupt deflate stream fails closed (' + cres.reason + ')');

  // -------------------------------------------------------------------------
  // 4. Mutation fuzz with allocation tracking: truncation, byte flips, huge
  //    lengths. No throw, no parse_error, bounded time and bounded allocation.
  // -------------------------------------------------------------------------
  console.log('== mutation fuzz' + (QUICK ? ' (quick)' : ''));
  await mutationFuzz();

  // -------------------------------------------------------------------------
  console.log('');
  if (realFacts) console.log('REAL test.dcm facts: ' + JSON.stringify(realFacts, null, 1));
  if (skipped.length) console.log('SKIPPED (fixture file not present): ' + skipped.join(', ') + ' -- no real vendor file was exercised');
  console.log(passes + ' checks passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
}

// The decoder re-evaluated in a sandbox whose typed-array constructors count
// every byte they allocate (views over existing buffers are not counted).
function trackedDecoder() {
  var counter = { bytes: 0 };
  function wrap(Base) {
    return class extends Base {
      constructor(a, b, c) {
        if (typeof a === 'number') { super(a); counter.bytes += a * Base.BYTES_PER_ELEMENT; }
        else if (a instanceof ArrayBuffer) super(a, b, c);
        else { super(a); counter.bytes += this.byteLength; }
      }
    };
  }
  var sandbox = {
    window: {}, ArrayBuffer: ArrayBuffer, DataView: DataView, Blob: Blob, DecompressionStream: DecompressionStream,
    Uint8Array: wrap(Uint8Array), Uint8ClampedArray: wrap(Uint8ClampedArray), Uint16Array: wrap(Uint16Array),
    Int32Array: wrap(Int32Array), Uint32Array: wrap(Uint32Array), Float32Array: wrap(Float32Array)
  };
  vm.runInNewContext(fs.readFileSync(LIB_PATH, 'utf8'), sandbox);
  return { api: sandbox.window.__SPINE_DICOM__, counter: counter };
}

async function mutationFuzz() {
  var T = trackedDecoder();
  var seed = 0x2468ACE1;
  function rnd() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; }
  var stats = { runs: 0, threw: 0, parseErrors: 0, slowest: { ms: 0, label: '' }, worstAlloc: { ratio: 0, label: '' }, overAlloc: 0, reasons: {} };
  var TIME_LIMIT_MS = 1000;
  function allocLimit(len) { return 256 * len + 2 * 1024 * 1024; }

  async function run(label, bytes, asyncToo) {
    var ab = toArrayBuffer(bytes);
    T.counter.bytes = 0;
    var t0 = process.hrtime.bigint(), r;
    try {
      r = asyncToo ? await T.api.decodeRadiographAsync(ab, { maxInflatedBytes: 4 * 1024 * 1024 }) : T.api.decodeRadiograph(ab);
    } catch (e) {
      stats.threw++; console.log('    THREW ' + label + ': ' + (e && e.stack)); return;
    }
    var ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // The inputs are deterministic, so a slow outlier is re-timed: a real
    // pathology stays slow, a scheduler / GC pause on a busy machine does not.
    for (var retry = 0; retry < 2 && ms > TIME_LIMIT_MS; retry++) {
      var t1 = process.hrtime.bigint();
      if (asyncToo) await T.api.decodeRadiographAsync(toArrayBuffer(bytes), { maxInflatedBytes: 4 * 1024 * 1024 }); else T.api.decodeRadiograph(toArrayBuffer(bytes));
      ms = Math.min(ms, Number(process.hrtime.bigint() - t1) / 1e6);
    }
    stats.runs++;
    stats.reasons[r.reason] = (stats.reasons[r.reason] || 0) + 1;
    if (r.reason === 'parse_error') { stats.parseErrors++; if (stats.parseErrors <= 5) console.log('    parse_error ' + label + ': ' + r.message); }
    if (ms > stats.slowest.ms) stats.slowest = { ms: ms, label: label };
    var ratio = T.counter.bytes / Math.max(1, bytes.length);
    if (ratio > stats.worstAlloc.ratio) stats.worstAlloc = { ratio: ratio, bytes: T.counter.bytes, label: label };
    if (T.counter.bytes > allocLimit(bytes.length)) { stats.overAlloc++; if (stats.overAlloc <= 5) console.log('    over-allocation ' + label + ': ' + T.counter.bytes + ' bytes for a ' + bytes.length + '-byte input'); }
  }

  // Offsets of element headers (explicit VR LE walk of the top level, best effort),
  // encapsulated item headers, and JPEG / RLE header bytes.
  function targets(u8) {
    var out = [], dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var p = u8.length > 132 && u8[128] === 0x44 && u8[129] === 0x49 ? 132 : 0;
    while (p + 8 <= u8.length && out.length < 120) {
      var g = dv.getUint16(p, true), vr = String.fromCharCode(u8[p + 4], u8[p + 5]);
      var long = /^(OB|OW|OF|SQ|UT|UN|OD|OL|OV|UC|UR)$/.test(vr), shortVR = /^[A-Z]{2}$/.test(vr) && !long;
      var lenPos = long ? p + 8 : shortVR ? p + 6 : p + 4, size = shortVR ? 2 : 4;
      var len = size === 2 ? dv.getUint16(lenPos, true) : dv.getUint32(lenPos, true);
      out.push({ at: lenPos, size: size });
      if (g === 0x7FE0) {
        var q = lenPos + 4; // encapsulated items
        for (var k = 0; k < 8 && q + 8 <= u8.length && dv.getUint16(q, true) === 0xFFFE; k++) {
          var il = dv.getUint32(q + 4, true);
          out.push({ at: q + 4, size: 4 });
          if (k === 0 && il >= 4) out.push({ at: q + 8, size: 4, bot: true });
          if (k === 1) out.push({ at: q + 8, size: 32, codecHeader: true });
          q += 8 + il;
        }
        break;
      }
      if (len === 0xFFFFFFFF) break;
      p = lenPos + size + len;
    }
    return out;
  }

  var names = ['f01_implicit_mono2_16.dcm', 'f11_privacy.dcm', 'f21_jpeg_lossless_sv1_12bit.dcm', 'f22_jpeg_lossless_p16_pred6_rst_mono1.dcm',
    'f23_jpeg_lossless_pred2_p8.dcm', 'f25_jpeg_lossless_pred4_p12_signed.dcm', 'f27_jpeg_lossless_pred7_p16.dcm', 'f28_jpeg_lossless_rgb.dcm',
    'f29_jpeg_lossless_2frames_bot.dcm', 'f30_jpeg_lossless_2frames_nobot.dcm', 'f32_rle_16bit_lateral.dcm', 'f33_rle_rgb.dcm',
    'f34_rle_2frames.dcm', 'f36_native_rgb_planar1.dcm', 'f37_native_ybr_full_422.dcm', 'f40_voi_lut_16bit.dcm',
    'f41_voi_lut_implicit_signed.dcm', 'f42_voi_lut_8bit_bytes.dcm', 'f44_jpeg_baseline_mono.dcm', 'f51_encapsulated_uncompressed.dcm'];
  var scale = QUICK ? 0.25 : 1;
  var T0 = Date.now();
  for (var ni = 0; ni < names.length; ni++) {
    var name = names[ni];
    var buf = fs.readFileSync(path.join(FIX, name));
    // 1. truncation: dense over the first 2 KiB, sparse over the rest
    for (var cut = 0; cut < Math.min(buf.length, 2048); cut += QUICK ? 61 : 17) await run(name + ' trunc ' + cut, buf.subarray(0, cut));
    for (var t = 0; t < 40 * scale; t++) { var c2 = rnd() % buf.length; await run(name + ' trunc ' + c2, buf.subarray(0, c2)); }
    // 2. byte flips: half in the header area, half anywhere (codec bitstreams)
    for (var it = 0; it < 160 * scale; it++) {
      var m = Buffer.from(buf), flips = 1 + rnd() % 8, where = it & 1 ? buf.length : Math.min(buf.length, 2048);
      for (var f = 0; f < flips; f++) m[rnd() % where] = rnd() & 0xFF;
      await run(name + ' flip#' + it, m);
    }
    // 3. huge / odd length fields and codec header corruption
    var tg = targets(buf);
    var vals4 = [0, 1, 3, 0x7FFFFFFF, 0xFFFFFFFE, 0xFFFFFFFF, 0x80000000, buf.length], vals2 = [0, 1, 3, 0xFFFF, 0xFFFE];
    for (var ti = 0; ti < tg.length; ti++) {
      var h = tg[ti];
      if (h.codecHeader) {
        for (var z = 0; z < 24; z++) { var mc = Buffer.from(buf); mc[h.at + (rnd() % h.size)] = [0, 0xFF, 0x7F, 0x80, rnd() & 0xFF][z % 5]; await run(name + ' codec@' + h.at, mc); }
        continue;
      }
      var vals = h.size === 4 ? vals4 : vals2;
      for (var vi = 0; vi < vals.length; vi++) {
        if (h.at + h.size > buf.length) continue;
        var mm = Buffer.from(buf);
        if (h.size === 4) mm.writeUInt32LE(vals[vi] >>> 0, h.at); else mm.writeUInt16LE(vals[vi], h.at);
        await run(name + ' len@' + h.at + '=' + vals[vi], mm);
      }
    }
  }
  // 4. the async paths (deflate, browser JPEG without a decoder) under mutation
  var asyncNames = ['f17_deflated.dcm', 'f43_deflated_padded.dcm', 'f44_jpeg_baseline_mono.dcm'];
  for (var ai = 0; ai < asyncNames.length; ai++) {
    var abuf = fs.readFileSync(path.join(FIX, asyncNames[ai]));
    for (var at = 0; at < 60 * scale; at++) {
      var am = Buffer.from(abuf), nf = 1 + rnd() % 6;
      for (var af = 0; af < nf; af++) am[rnd() % am.length] = rnd() & 0xFF;
      await run(asyncNames[ai] + ' async flip#' + at, am, true);
      await run(asyncNames[ai] + ' async trunc', abuf.subarray(0, rnd() % abuf.length), true);
    }
  }
  // 5. crafted: an 8000x8000 RLE / JPEG header over a few hundred bytes
  (function () {
    var f = fs.readFileSync(path.join(FIX, 'f34_rle_2frames.dcm'));
    var m = Buffer.from(f), rowsAt = m.indexOf(Buffer.from([0x28, 0x00, 0x10, 0x00, 0x55, 0x53, 0x02, 0x00]));
    m.writeUInt16LE(8000, rowsAt + 8); m.writeUInt16LE(8000, rowsAt + 18);
    return run('RLE header claims 8000x8000', m.subarray(0, 2000));
  })();
  console.log('    ' + stats.runs + ' mutated decodes in ' + ((Date.now() - T0) / 1000).toFixed(1) + ' s; reasons: ' + JSON.stringify(stats.reasons));
  console.log('    slowest ' + stats.slowest.ms.toFixed(1) + ' ms (' + stats.slowest.label + '); worst allocation ' + stats.worstAlloc.ratio.toFixed(1) +
    ' x input (' + stats.worstAlloc.bytes + ' bytes, ' + stats.worstAlloc.label + ')');
  check(stats.threw === 0, 'mutation fuzz: no exception escapes (' + stats.threw + ')');
  check(stats.parseErrors === 0, 'mutation fuzz: no unexpected internal exception (parse_error) (' + stats.parseErrors + ')');
  check(stats.slowest.ms < TIME_LIMIT_MS, 'mutation fuzz: every decode < ' + TIME_LIMIT_MS + ' ms (slowest ' + stats.slowest.ms.toFixed(1) + ' ms)');
  check(stats.overAlloc === 0, 'mutation fuzz: allocation stays within 256 x input + 2 MiB (' + stats.overAlloc + ' over)');
  check(stats.runs > (QUICK ? 1000 : 5000), 'mutation fuzz ran enough cases (' + stats.runs + ')');
}

main().catch(function (e) { console.log('FATAL ' + (e && e.stack)); process.exit(2); });
