/*
 * dicom_radiograph.js
 *
 * Self-contained, dependency-free DICOM radiograph decoder for single-file
 * offline web apps. Plain ES2019, no modules, no network, no storage, no
 * wasm, no workers.
 *
 * Scope (synchronous decodeRadiograph):
 *   - Implicit / Explicit VR Little Endian, and Encapsulated Uncompressed
 *     Explicit VR Little Endian (1.2.840.10008.1.2.1.98)
 *   - RLE Lossless (1.2.840.10008.1.2.5, PS3.5 Annex G)
 *   - JPEG Lossless, process 14 (1.2.840.10008.1.2.4.57) and its first-order
 *     predictor subset SV1 (1.2.840.10008.1.2.4.70): ITU-T T.81 Annex H,
 *     Huffman coded, predictors 1-7, point transform, restart intervals
 *   - MONOCHROME1 / MONOCHROME2 with 8 or 16 bits allocated; RGB, YBR_FULL and
 *     YBR_FULL_422 are converted to luminance (Y = 0.299 R + 0.587 G + 0.114 B)
 *   - multi-frame objects: frame 1 is decoded and a warning says so
 *   - Rescale, Window Center/Width, VOI LUT Sequence, Presentation LUT Shape
 * Additionally (asynchronous decodeRadiographAsync, which needs a browser):
 *   - Deflated Explicit VR Little Endian (1.2.840.10008.1.2.1.99) through
 *     DecompressionStream('deflate-raw')
 *   - 8-bit lossy JPEG (1.2.840.10008.1.2.4.50 / .51) through the browser's
 *     own image decoder (createImageBitmap on a Blob of the JPEG stream)
 * Everything else (JPEG 2000, JPEG-LS, 12-bit lossy JPEG, big endian, video,
 * PALETTE COLOR, ...) fails closed: ok:false, a machine-readable reason and a
 * message that says how to re-export the image. Metadata that could be parsed
 * is still returned.
 *
 * Privacy: the parser only decodes the values of a small whitelist of tags
 * (transfer syntax, SOP class, modality, image geometry / pixel description,
 * window / rescale / VOI LUT, Presentation LUT Shape, view position, patient
 * orientation codes, image laterality, magnification / calibration geometry,
 * pixel data). Patient identity tags (group 0010), institution / physician
 * tags, private (odd group) tags and the contents of every sequence except the
 * LUT Descriptor / LUT Data of the first VOI LUT Sequence item are skipped
 * using only their element headers; their value bytes are never decoded and
 * never appear in the returned object.
 *
 * Usage:
 *   var api = window.__SPINE_DICOM__;           // browser
 *   var api = module.exports of this file;       // node (CommonJS)
 *   var r = api.decodeRadiograph(arrayBuffer, { maxBytes, maxPixels, autoWindowPercentiles });
 *   api.decodeRadiographAsync(arrayBuffer, options).then(function (r) { ... });
 *   if (r.ok) { r.gray8 (Uint8ClampedArray rows*columns), r.raw16, r.rows, r.columns, ... }
 * decodeRadiographAsync accepts every input decodeRadiograph accepts and gives
 * the same result for it; it only differs for Deflated and lossy JPEG files,
 * which the synchronous call reports as deflated_requires_async /
 * jpeg_lossy_requires_async. Extra async options: maxInflatedBytes (default
 * 2 x maxBytes) and jpegDecoder (function (bytes, {rows, columns}) returning a
 * Promise of {width, height, data: RGBA}) to replace createImageBitmap.
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';

  var DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
  var DEFAULT_MAX_PIXELS = 80e6;
  var DEFAULT_PERCENTILES = [0.5, 99.5];
  var UNDEFINED_LENGTH = 0xFFFFFFFF;
  var MAX_DEPTH = 64;
  var MAX_WANTED_STRING = 1024;

  var TS_IMPLICIT_LE = '1.2.840.10008.1.2';
  var TS_EXPLICIT_LE = '1.2.840.10008.1.2.1';
  var TS_ENCAPSULATED_UNCOMPRESSED_LE = '1.2.840.10008.1.2.1.98';
  var TS_DEFLATED_LE = '1.2.840.10008.1.2.1.99';
  var TS_EXPLICIT_BE = '1.2.840.10008.1.2.2';
  var TS_GE_IMPLICIT_BE_PIXELS = '1.2.840.113619.5.2';
  var TS_RLE = '1.2.840.10008.1.2.5';
  var TS_JPEG_PREFIX = '1.2.840.10008.1.2.4.';

  var REEXPORT = ' Re-export the image from the PACS or viewer as uncompressed DICOM (Explicit VR Little Endian) or as a PNG, then load that file.';

  var PLATFORM_LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

  // Explicit VR: VRs that use the 4-byte length form (2 reserved bytes + UL).
  var LONG_VRS = { OB: 1, OW: 1, OF: 1, SQ: 1, UT: 1, UN: 1, UC: 1, UR: 1, OD: 1, OL: 1, OV: 1, SV: 1, UV: 1 };
  // VRs that use the 2-byte length form.
  var SHORT_VRS = { AE: 1, AS: 1, AT: 1, CS: 1, DA: 1, DS: 1, DT: 1, FL: 1, FD: 1, IS: 1, LO: 1, LT: 1, PN: 1, SH: 1, SL: 1, SS: 1, ST: 1, TM: 1, UI: 1, UL: 1, US: 1 };

  // Tag numbers as group * 0x10000 + element (always positive).
  var TAG = {
    MEDIA_SOP_CLASS: 0x00020002,
    TRANSFER_SYNTAX: 0x00020010,
    SOP_CLASS: 0x00080016,
    MODALITY: 0x00080060,
    DISTANCE_SOURCE_TO_DETECTOR: 0x00181110,
    DISTANCE_SOURCE_TO_PATIENT: 0x00181111,
    ESTIMATED_MAGNIFICATION: 0x00181114,
    IMAGER_PIXEL_SPACING: 0x00181164,
    VIEW_POSITION: 0x00185101,
    PATIENT_ORIENTATION: 0x00200020,
    IMAGE_LATERALITY: 0x00200062,
    SAMPLES_PER_PIXEL: 0x00280002,
    PHOTOMETRIC: 0x00280004,
    PLANAR_CONFIGURATION: 0x00280006,
    NUMBER_OF_FRAMES: 0x00280008,
    ROWS: 0x00280010,
    COLUMNS: 0x00280011,
    PIXEL_SPACING: 0x00280030,
    PIXEL_SPACING_CALIBRATION_TYPE: 0x00280A02,
    BITS_ALLOCATED: 0x00280100,
    BITS_STORED: 0x00280101,
    HIGH_BIT: 0x00280102,
    PIXEL_REPRESENTATION: 0x00280103,
    PIXEL_PADDING_VALUE: 0x00280120,
    PIXEL_PADDING_RANGE_LIMIT: 0x00280121,
    WINDOW_CENTER: 0x00281050,
    WINDOW_WIDTH: 0x00281051,
    RESCALE_INTERCEPT: 0x00281052,
    RESCALE_SLOPE: 0x00281053,
    VOI_LUT_FUNCTION: 0x00281056,
    MODALITY_LUT_SEQUENCE: 0x00283000,
    LUT_DESCRIPTOR: 0x00283002,
    LUT_DATA: 0x00283006,
    VOI_LUT_SEQUENCE: 0x00283010,
    PRESENTATION_LUT_SHAPE: 0x20500020,
    PIXEL_DATA: 0x7FE00010
  };
  var ITEM_TAG = 0xFFFEE000;
  var ITEM_DELIM_TAG = 0xFFFEE00D;
  var SEQ_DELIM_TAG = 0xFFFEE0DD;

  // Whitelist of tags whose VALUE may be decoded, with the VR used in
  // implicit-VR files. Anything not listed here is skipped by header only.
  // (LUT Descriptor / LUT Data are read only inside the first VOI LUT item.)
  var WANTED_VR = {};
  WANTED_VR[TAG.MEDIA_SOP_CLASS] = 'UI';
  WANTED_VR[TAG.TRANSFER_SYNTAX] = 'UI';
  WANTED_VR[TAG.SOP_CLASS] = 'UI';
  WANTED_VR[TAG.MODALITY] = 'CS';
  WANTED_VR[TAG.DISTANCE_SOURCE_TO_DETECTOR] = 'DS';
  WANTED_VR[TAG.DISTANCE_SOURCE_TO_PATIENT] = 'DS';
  WANTED_VR[TAG.ESTIMATED_MAGNIFICATION] = 'DS';
  WANTED_VR[TAG.IMAGER_PIXEL_SPACING] = 'DS';
  WANTED_VR[TAG.VIEW_POSITION] = 'CS';
  WANTED_VR[TAG.PATIENT_ORIENTATION] = 'CS';
  WANTED_VR[TAG.IMAGE_LATERALITY] = 'CS';
  WANTED_VR[TAG.SAMPLES_PER_PIXEL] = 'US';
  WANTED_VR[TAG.PHOTOMETRIC] = 'CS';
  WANTED_VR[TAG.PLANAR_CONFIGURATION] = 'US';
  WANTED_VR[TAG.NUMBER_OF_FRAMES] = 'IS';
  WANTED_VR[TAG.ROWS] = 'US';
  WANTED_VR[TAG.COLUMNS] = 'US';
  WANTED_VR[TAG.PIXEL_SPACING] = 'DS';
  WANTED_VR[TAG.PIXEL_SPACING_CALIBRATION_TYPE] = 'CS';
  WANTED_VR[TAG.BITS_ALLOCATED] = 'US';
  WANTED_VR[TAG.BITS_STORED] = 'US';
  WANTED_VR[TAG.HIGH_BIT] = 'US';
  WANTED_VR[TAG.PIXEL_REPRESENTATION] = 'US';
  WANTED_VR[TAG.PIXEL_PADDING_VALUE] = 'US';
  WANTED_VR[TAG.PIXEL_PADDING_RANGE_LIMIT] = 'US';
  WANTED_VR[TAG.WINDOW_CENTER] = 'DS';
  WANTED_VR[TAG.WINDOW_WIDTH] = 'DS';
  WANTED_VR[TAG.RESCALE_INTERCEPT] = 'DS';
  WANTED_VR[TAG.RESCALE_SLOPE] = 'DS';
  WANTED_VR[TAG.VOI_LUT_FUNCTION] = 'CS';
  WANTED_VR[TAG.MODALITY_LUT_SEQUENCE] = 'SQ';
  WANTED_VR[TAG.VOI_LUT_SEQUENCE] = 'SQ';
  WANTED_VR[TAG.PRESENTATION_LUT_SHAPE] = 'CS';

  // Errors thrown by the codecs carry a machine-readable reason.
  function codecError(reason, message) {
    var e = new Error(message);
    e.reason = reason;
    return e;
  }

  // ---------------------------------------------------------------------
  // Byte reader
  // ---------------------------------------------------------------------

  function Reader(input) {
    var buffer, offset, length;
    if (input instanceof ArrayBuffer) {
      buffer = input; offset = 0; length = input.byteLength;
    } else if (input && input.buffer instanceof ArrayBuffer && typeof input.byteLength === 'number') {
      buffer = input.buffer; offset = input.byteOffset || 0; length = input.byteLength;
    } else {
      throw new Error('input must be an ArrayBuffer or an ArrayBuffer view');
    }
    this.buffer = buffer;
    this.base = offset;
    this.len = length;
    this.dv = new DataView(buffer, offset, length);
    this.u8 = new Uint8Array(buffer, offset, length);
  }
  Reader.prototype.u16 = function (p, little) { return this.dv.getUint16(p, little); };
  Reader.prototype.i16 = function (p, little) { return this.dv.getInt16(p, little); };
  Reader.prototype.u32 = function (p, little) { return this.dv.getUint32(p, little); };
  Reader.prototype.i32 = function (p, little) { return this.dv.getInt32(p, little); };
  Reader.prototype.f32 = function (p, little) { return this.dv.getFloat32(p, little); };
  Reader.prototype.f64 = function (p, little) { return this.dv.getFloat64(p, little); };
  Reader.prototype.ascii = function (p, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += String.fromCharCode(this.u8[p + i]);
    return s;
  };
  // Latin-1 string with leading spaces and trailing spaces / NULs removed.
  Reader.prototype.str = function (p, n) {
    if (n > MAX_WANTED_STRING) n = MAX_WANTED_STRING;
    var u8 = this.u8;
    var end = p + n;
    if (end > this.len) end = this.len;
    while (end > p && (u8[end - 1] === 0 || u8[end - 1] === 32)) end--;
    var start = p;
    while (start < end && u8[start] === 32) start++;
    var s = '';
    for (var i = start; i < end; i++) s += String.fromCharCode(u8[i]);
    return s;
  };

  function isUpper(c) { return c >= 65 && c <= 90; }

  // ---------------------------------------------------------------------
  // Element header parsing
  // ---------------------------------------------------------------------

  // Returns {tag, group, vr, length, valuePos, error} or null when fewer than
  // 8 bytes remain. Item / delimiter tags (group FFFE) never carry a VR.
  function readHeader(r, pos, explicit, little) {
    if (pos + 8 > r.len) return null;
    var g = r.u16(pos, little);
    var e = r.u16(pos + 2, little);
    var h = { tag: g * 0x10000 + e, group: g, vr: null, length: 0, valuePos: 0, error: false };
    if (g === 0xFFFE || !explicit) {
      h.length = r.u32(pos + 4, little);
      h.valuePos = pos + 8;
      return h;
    }
    var c1 = r.u8[pos + 4], c2 = r.u8[pos + 5];
    if (!isUpper(c1) || !isUpper(c2)) { h.error = true; return h; }
    var vr = String.fromCharCode(c1, c2);
    h.vr = vr;
    if (LONG_VRS[vr] === 1 || SHORT_VRS[vr] !== 1) {
      // Known long VRs and unknown (future) VRs use the 4-byte length form.
      if (pos + 12 > r.len) return null;
      h.length = r.u32(pos + 8, little);
      h.valuePos = pos + 12;
    } else {
      h.length = r.u16(pos + 6, little);
      h.valuePos = pos + 8;
    }
    return h;
  }

  // Skip an undefined-length sequence starting at its first item header.
  // Returns the position after the sequence delimiter, or -1 when malformed
  // or truncated.
  function skipSequence(r, pos, explicit, little, depth, ctx) {
    if (depth > MAX_DEPTH) { ctx.warn('sequence_nesting_too_deep'); return -1; }
    for (;;) {
      var h = readHeader(r, pos, explicit, little);
      if (!h || h.error) return -1;
      if (h.tag === SEQ_DELIM_TAG) return h.valuePos;
      if (h.tag !== ITEM_TAG) { ctx.warn('malformed_sequence'); return -1; }
      if (h.length === UNDEFINED_LENGTH) {
        pos = skipItem(r, h.valuePos, explicit, little, depth + 1, ctx);
        if (pos < 0) return -1;
      } else {
        pos = h.valuePos + h.length;
        if (pos > r.len) return -1;
      }
    }
  }

  // Skip the elements of an undefined-length item. Returns the position after
  // the item delimiter, or -1 when malformed or truncated.
  function skipItem(r, pos, explicit, little, depth, ctx) {
    if (depth > MAX_DEPTH) { ctx.warn('sequence_nesting_too_deep'); return -1; }
    for (;;) {
      var h = readHeader(r, pos, explicit, little);
      if (!h || h.error) return -1;
      if (h.tag === ITEM_DELIM_TAG) return h.valuePos;
      if (h.length === UNDEFINED_LENGTH) {
        // Undefined-length UN elements hold Implicit VR Little Endian content.
        var innerExplicit = explicit && h.vr !== 'UN';
        var innerLittle = h.vr === 'UN' ? true : little;
        pos = skipSequence(r, h.valuePos, innerExplicit, innerLittle, depth + 1, ctx);
        if (pos < 0) return -1;
      } else {
        pos = h.valuePos + h.length;
        if (pos > r.len) return -1;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Value decoding for whitelisted tags only
  // ---------------------------------------------------------------------

  function parseNumberString(s) {
    var parts = s.split('\\');
    var v = parseFloat(parts[0]);
    return isFinite(v) ? v : null;
  }

  function readNumber(r, h, dictVR, little) {
    var vr = h.vr || dictVR;
    if (vr === 'UN' || vr === 'OB' || vr === 'OW') vr = dictVR;
    switch (vr) {
      case 'US': return h.length >= 2 ? r.u16(h.valuePos, little) : null;
      case 'SS': return h.length >= 2 ? r.i16(h.valuePos, little) : null;
      case 'UL': return h.length >= 4 ? r.u32(h.valuePos, little) : null;
      case 'SL': return h.length >= 4 ? r.i32(h.valuePos, little) : null;
      case 'FL': return h.length >= 4 ? r.f32(h.valuePos, little) : null;
      case 'FD': return h.length >= 8 ? r.f64(h.valuePos, little) : null;
      default: return h.length > 0 ? parseNumberString(r.str(h.valuePos, h.length)) : null;
    }
  }

  function readNumberList(r, h, little) {
    var vr = h.vr;
    if (vr === 'US' || vr === 'SS' || vr === 'UL' || vr === 'SL' || vr === 'FL' || vr === 'FD') {
      var v = readNumber(r, h, vr, little);
      return v === null ? [] : [v];
    }
    if (h.length <= 0) return [];
    var parts = r.str(h.valuePos, h.length).split('\\');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var f = parseFloat(parts[i]);
      if (isFinite(f)) out.push(f);
    }
    return out;
  }

  // Code String value (upper case). Returns null unless it looks like a CS
  // (letters, digits, space, underscore, backslash between values).
  function readCodeString(r, h) {
    var s = r.str(h.valuePos, h.length).toUpperCase();
    return /^[A-Z0-9_ \\]{1,64}$/.test(s) ? s : null;
  }

  function readWanted(r, h, dictVR, little, meta) {
    switch (h.tag) {
      case TAG.TRANSFER_SYNTAX: meta.transferSyntaxUID = r.str(h.valuePos, h.length); break;
      case TAG.MEDIA_SOP_CLASS: meta.mediaSopClassUID = r.str(h.valuePos, h.length); break;
      case TAG.SOP_CLASS: meta.sopClassUID = r.str(h.valuePos, h.length); break;
      case TAG.MODALITY: meta.modality = r.str(h.valuePos, h.length).toUpperCase(); break;
      case TAG.PHOTOMETRIC: meta.photometric = r.str(h.valuePos, h.length).toUpperCase(); break;
      case TAG.VOI_LUT_FUNCTION: meta.voiLutFunction = r.str(h.valuePos, h.length).toUpperCase(); break;
      case TAG.VOI_LUT_SEQUENCE: meta.voiLutSequencePresent = true; break;
      case TAG.MODALITY_LUT_SEQUENCE: meta.modalityLutSequencePresent = true; break;
      case TAG.NUMBER_OF_FRAMES: meta.numberOfFrames = readNumber(r, h, dictVR, little); break;
      case TAG.SAMPLES_PER_PIXEL: meta.samplesPerPixel = readNumber(r, h, dictVR, little); break;
      case TAG.PLANAR_CONFIGURATION: meta.planarConfiguration = readNumber(r, h, dictVR, little); break;
      case TAG.ROWS: meta.rows = readNumber(r, h, dictVR, little); break;
      case TAG.COLUMNS: meta.columns = readNumber(r, h, dictVR, little); break;
      case TAG.BITS_ALLOCATED: meta.bitsAllocated = readNumber(r, h, dictVR, little); break;
      case TAG.BITS_STORED: meta.bitsStored = readNumber(r, h, dictVR, little); break;
      case TAG.HIGH_BIT: meta.highBit = readNumber(r, h, dictVR, little); break;
      case TAG.PIXEL_REPRESENTATION: meta.pixelRepresentation = readNumber(r, h, dictVR, little); break;
      case TAG.PIXEL_PADDING_VALUE:
        // Stored as the raw 16-bit pattern; sign is resolved later from PixelRepresentation.
        if (h.length >= 2) meta.pixelPaddingRaw = r.u16(h.valuePos, little);
        break;
      case TAG.PIXEL_PADDING_RANGE_LIMIT:
        if (h.length >= 2) meta.pixelPaddingLimitRaw = r.u16(h.valuePos, little);
        break;
      case TAG.PIXEL_SPACING: meta.pixelSpacing = readNumberList(r, h, little); break;
      case TAG.IMAGER_PIXEL_SPACING: meta.imagerPixelSpacing = readNumberList(r, h, little); break;
      case TAG.WINDOW_CENTER: meta.windowCenter = readNumber(r, h, dictVR, little); break;
      case TAG.WINDOW_WIDTH: meta.windowWidth = readNumber(r, h, dictVR, little); break;
      case TAG.RESCALE_INTERCEPT: meta.rescaleIntercept = readNumber(r, h, dictVR, little); break;
      case TAG.RESCALE_SLOPE: meta.rescaleSlope = readNumber(r, h, dictVR, little); break;
      case TAG.PRESENTATION_LUT_SHAPE: meta.presentationLutShape = readCodeString(r, h); break;
      case TAG.VIEW_POSITION: meta.viewPosition = readCodeString(r, h); break;
      case TAG.PATIENT_ORIENTATION: meta.orientationCodes = readCodeString(r, h); break;
      case TAG.IMAGE_LATERALITY: meta.imageLaterality = readCodeString(r, h); break;
      case TAG.PIXEL_SPACING_CALIBRATION_TYPE: meta.pixelSpacingCalibrationType = readCodeString(r, h); break;
      case TAG.ESTIMATED_MAGNIFICATION: meta.estimatedMagnification = readNumber(r, h, dictVR, little); break;
      case TAG.DISTANCE_SOURCE_TO_DETECTOR: meta.distanceSourceToDetector = readNumber(r, h, dictVR, little); break;
      case TAG.DISTANCE_SOURCE_TO_PATIENT: meta.distanceSourceToPatient = readNumber(r, h, dictVR, little); break;
      default: break;
    }
  }

  // Reads only the LUT Descriptor (0028,3002) and LUT Data (0028,3006) of the
  // FIRST item of a top-level VOI LUT Sequence; every other element of the
  // item (LUT Explanation, anything nested) is skipped by header. `end` is the
  // end of a defined-length sequence, or -1 for an undefined-length one.
  function readVoiLutSequence(r, pos, end, explicit, little, ctx) {
    var meta = ctx.meta;
    meta.voiLutSequencePresent = true;
    var limit = end < 0 ? r.len : Math.min(end, r.len);
    var item = readHeader(r, pos, explicit, little);
    if (!item || item.error || item.tag !== ITEM_TAG) { ctx.warn('voi_lut_sequence_unreadable'); return; }
    var itemEnd = item.length === UNDEFINED_LENGTH ? limit : Math.min(limit, item.valuePos + item.length);
    var p = item.valuePos, desc = null, descVR = null, dataPos = -1, dataLength = 0, guard = 0;
    while (p + 8 <= itemEnd && guard++ < 256) {
      var h = readHeader(r, p, explicit, little);
      if (!h || h.error || h.tag === ITEM_DELIM_TAG) break;
      if (h.length === UNDEFINED_LENGTH) {
        p = skipSequence(r, h.valuePos, explicit && h.vr !== 'UN', h.vr === 'UN' ? true : little, 2, ctx);
        if (p < 0) break;
        continue;
      }
      var next = h.valuePos + h.length;
      if (next > r.len) break;
      if (h.tag === TAG.LUT_DESCRIPTOR && h.length >= 6) {
        desc = [r.u16(h.valuePos, little), r.u16(h.valuePos + 2, little), r.u16(h.valuePos + 4, little)];
        descVR = h.vr;
      } else if (h.tag === TAG.LUT_DATA) {
        dataPos = h.valuePos; dataLength = h.length;
      }
      p = next;
    }
    if (desc && dataPos >= 0) meta.voiLut = { desc: desc, descVR: descVR, dataPos: dataPos, dataLength: dataLength, little: little };
    else ctx.warn('voi_lut_sequence_unreadable');
  }

  // ---------------------------------------------------------------------
  // Dataset walking
  // ---------------------------------------------------------------------

  // Looks at the bytes of an element header and guesses whether the dataset
  // is explicit VR (true), implicit VR (false) or unreadable (null).
  function sniffExplicit(r, pos) {
    if (pos + 8 > r.len) return null;
    var c1 = r.u8[pos + 4], c2 = r.u8[pos + 5];
    if (isUpper(c1) && isUpper(c2)) {
      var vr = String.fromCharCode(c1, c2);
      if (SHORT_VRS[vr] === 1 || LONG_VRS[vr] === 1) return true;
    }
    return false;
  }

  // Heuristic for raw datasets without the 128-byte preamble + 'DICM'.
  function looksLikeDataset(r, pos) {
    if (pos + 8 > r.len) return false;
    var g = r.u16(pos, true);
    if (g !== 0x0002 && g !== 0x0008 && g !== 0x0010 && g !== 0x0018 && g !== 0x0020 && g !== 0x0028) return false;
    var e = r.u16(pos + 2, true);
    if (e > 0x4000) return false;
    if (sniffExplicit(r, pos)) return true;
    var len = r.u32(pos + 4, true);
    return len === UNDEFINED_LENGTH || len <= r.len - pos - 8;
  }

  // Parses the File Meta Information (group 0002). Returns position of the
  // first dataset element.
  function parseFileMeta(r, pos, ctx) {
    var meta = ctx.meta;
    var explicit = sniffExplicit(r, pos);
    if (explicit === false) { ctx.warn('file_meta_implicit_vr'); }
    if (explicit === null) return pos;
    var guard = 0;
    while (pos + 8 <= r.len && guard++ < 256) {
      var g = r.u16(pos, true);
      if (g !== 0x0002) break;
      var h = readHeader(r, pos, explicit, true);
      if (!h || h.error) { ctx.warn('malformed_file_meta'); break; }
      if (h.length === UNDEFINED_LENGTH) {
        var innerExplicit = explicit && h.vr !== 'UN';
        pos = skipSequence(r, h.valuePos, innerExplicit, true, 1, ctx);
        if (pos < 0) { ctx.warn('malformed_file_meta'); return r.len; }
        continue;
      }
      var next = h.valuePos + h.length;
      if (next > r.len) { ctx.warn('truncated_file_meta'); return r.len; }
      if (WANTED_VR[h.tag] !== undefined) readWanted(r, h, WANTED_VR[h.tag], true, meta);
      pos = next;
    }
    return pos;
  }

  // Walks top-level dataset elements until Pixel Data or end of input.
  function parseDataset(r, pos, explicit, little, ctx) {
    var meta = ctx.meta;
    while (pos + 8 <= r.len) {
      var h = readHeader(r, pos, explicit, little);
      if (!h) break;
      if (h.error) { ctx.warn('malformed_element'); break; }
      if (h.tag === TAG.PIXEL_DATA) {
        meta.pixelDataPos = h.valuePos;
        meta.pixelDataLength = h.length;
        meta.pixelDataVR = h.vr;
        meta.pixelDataUndefined = (h.length === UNDEFINED_LENGTH);
        break;
      }
      if (h.group === 0xFFFE) {
        // Stray item/delimiter at top level: structurally broken, stop here.
        ctx.warn('stray_item_tag');
        break;
      }
      var innerExplicit = explicit && h.vr !== 'UN';
      var innerLittle = h.vr === 'UN' ? true : little;
      if (h.length === UNDEFINED_LENGTH) {
        if (h.tag === TAG.VOI_LUT_SEQUENCE) readVoiLutSequence(r, h.valuePos, -1, innerExplicit, innerLittle, ctx);
        if (h.tag === TAG.MODALITY_LUT_SEQUENCE) meta.modalityLutSequencePresent = true;
        pos = skipSequence(r, h.valuePos, innerExplicit, innerLittle, 1, ctx);
        if (pos < 0) { ctx.warn('truncated_or_malformed_sequence'); break; }
        continue;
      }
      var next = h.valuePos + h.length;
      if (next > r.len) { ctx.warn('truncated_element'); break; }
      // Privacy guard: private groups (odd) and the patient group (0010) are
      // skipped by header only, even if a tag in them were ever whitelisted.
      if ((h.group & 1) === 1 || h.group === 0x0010) { pos = next; continue; }
      if (h.tag === TAG.VOI_LUT_SEQUENCE && (h.vr === 'SQ' || h.vr === 'UN' || h.vr === null)) {
        if (h.length > 0) readVoiLutSequence(r, h.valuePos, next, innerExplicit, innerLittle, ctx);
        pos = next;
        continue;
      }
      if (h.vr === 'SQ') {
        if (h.tag === TAG.MODALITY_LUT_SEQUENCE) meta.modalityLutSequencePresent = true;
        pos = next;
        continue;
      }
      var dictVR = WANTED_VR[h.tag];
      if (dictVR !== undefined) readWanted(r, h, dictVR, little, meta);
      pos = next;
    }
    return pos;
  }

  // ---------------------------------------------------------------------
  // Encapsulated pixel data (PS3.5 A.4)
  // ---------------------------------------------------------------------

  // Returns the bytes of frame 1 of an encapsulated Pixel Data element: the
  // Basic Offset Table item is skipped (or used to find where frame 1 ends in
  // a multi-frame object) and the fragments of frame 1 are concatenated.
  function encapsulatedFrame1(r, pos, frames, codec) {
    var bad = 'pixel_data_encapsulation_invalid';
    var h = readHeader(r, pos, false, true);
    if (!h || h.tag !== ITEM_TAG || h.length === UNDEFINED_LENGTH || (h.length & 3) !== 0 || h.valuePos + h.length > r.len) {
      throw codecError(bad, 'Encapsulated Pixel Data does not start with a valid Basic Offset Table item.');
    }
    var bot = [];
    for (var k = 0; k + 4 <= h.length && k < 16; k += 4) bot.push(r.u32(h.valuePos + k, true));
    var first = h.valuePos + h.length, p = first, frags = [], truncated = false;
    for (;;) {
      var f = readHeader(r, p, false, true);
      if (!f || f.tag === SEQ_DELIM_TAG) break;
      if (f.tag !== ITEM_TAG || f.length === UNDEFINED_LENGTH) throw codecError(bad, 'Encapsulated Pixel Data contains a malformed fragment item.');
      if (f.valuePos + f.length > r.len) { truncated = true; break; }
      frags.push({ offset: p - first, pos: f.valuePos, len: f.length });
      p = f.valuePos + f.length;
      // Frame 1 of a multi-frame object is complete: stop collecting.
      if (frames > 1 && frame1Complete(r, frags, bot, codec)) break;
    }
    var chosen;
    if (frames === 1) {
      if (truncated) throw codecError('pixel_data_truncated', 'An encapsulated Pixel Data fragment runs past the end of the file.');
      chosen = frags;
    } else {
      chosen = frame1Fragments(r, frags, bot, codec);
      if (!chosen) {
        if (truncated) throw codecError('pixel_data_truncated', 'An encapsulated Pixel Data fragment runs past the end of the file.');
        throw codecError(bad, 'The fragments of frame 1 could not be delimited (no usable Basic Offset Table and no end-of-image marker).');
      }
    }
    if (!chosen.length) throw codecError(bad, 'Encapsulated Pixel Data contains no fragments.');
    if (chosen.length === 1) return r.u8.subarray(chosen[0].pos, chosen[0].pos + chosen[0].len);
    var total = 0, i;
    for (i = 0; i < chosen.length; i++) total += chosen[i].len;
    var out = new Uint8Array(total), o = 0;
    for (i = 0; i < chosen.length; i++) { out.set(r.u8.subarray(chosen[i].pos, chosen[i].pos + chosen[i].len), o); o += chosen[i].len; }
    return out;
  }

  function endsWithEOI(r, f) {
    var e = f.pos + f.len;
    while (e > f.pos && r.u8[e - 1] === 0) e--; // even-length padding
    return e - f.pos >= 2 && r.u8[e - 2] === 0xFF && r.u8[e - 1] === 0xD9;
  }

  function frame1Complete(r, frags, bot, codec) {
    if (bot.length >= 2) return frags[frags.length - 1].offset + frags[frags.length - 1].len + 8 >= bot[1];
    if (codec !== 'jpeg') return true; // RLE and uncompressed: one fragment per frame
    return endsWithEOI(r, frags[frags.length - 1]);
  }

  // Fragments of frame 1 in a multi-frame object, or null when undetermined.
  function frame1Fragments(r, frags, bot, codec) {
    if (!frags.length) return null;
    var out = [], i;
    if (bot.length >= 2 && bot[0] < bot[1]) {
      for (i = 0; i < frags.length; i++) if (frags[i].offset >= bot[0] && frags[i].offset < bot[1]) out.push(frags[i]);
      if (!out.length) return null;
      var last = out[out.length - 1];
      return last.offset + last.len + 8 === bot[1] ? out : null;
    }
    // PS3.5 A.4: an RLE frame is exactly one fragment; so is an uncompressed one.
    if (codec !== 'jpeg') return [frags[0]];
    for (i = 0; i < frags.length; i++) {
      out.push(frags[i]);
      if (endsWithEOI(r, frags[i])) return out;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // RLE Lossless (PS3.5 Annex G)
  // ---------------------------------------------------------------------

  // 64-byte header (segment count + 15 offsets), one PackBits-coded byte plane
  // per segment: for each sample (R, G, B) its bytes, most significant first.
  // Returns the samples as little-endian bytes, one plane per sample
  // (planar layout, like Planar Configuration 1).
  function decodeRle(frag, rows, cols, spp, bytesPerSample) {
    var bad = 'rle_data_corrupt';
    if (frag.length < 64) throw codecError(bad, 'The RLE fragment is shorter than its 64-byte header.');
    var dv = new DataView(frag.buffer, frag.byteOffset, frag.byteLength);
    var nseg = dv.getUint32(0, true), want = spp * bytesPerSample, n = rows * cols;
    if (nseg !== want) throw codecError(bad, 'The RLE header lists ' + nseg + ' segments; ' + want + ' were expected.');
    var starts = [], ends = [], s;
    for (s = 0; s < nseg; s++) {
      starts.push(dv.getUint32(4 + 4 * s, true));
      ends.push(s + 1 < nseg ? dv.getUint32(8 + 4 * s, true) : frag.length);
      if (starts[s] < 64 || starts[s] > ends[s] || ends[s] > frag.length) throw codecError(bad, 'RLE segment ' + (s + 1) + ' has an invalid offset.');
      // A PackBits byte pair expands to at most 128 bytes: bound the output
      // before allocating anything for it.
      if ((ends[s] - starts[s]) * 64 < n) throw codecError(bad, 'RLE segment ' + (s + 1) + ' is too short for ' + rows + 'x' + cols + ' pixels.');
    }
    var out = new Uint8Array(n * want);
    for (s = 0; s < nseg; s++) {
      var sample = (s / bytesPerSample) | 0;
      var byteIndex = bytesPerSample - 1 - (s % bytesPerSample);
      var base = sample * n * bytesPerSample + byteIndex;
      var p = starts[s], end = ends[s], i = 0, k, c;
      while (i < n && p < end) {
        var hdr = frag[p++];
        if (hdr < 128) {
          c = hdr + 1;
          if (p + c > end) throw codecError(bad, 'RLE segment ' + (s + 1) + ' ends inside a literal run.');
          if (c > n - i) c = n - i;
          for (k = 0; k < c; k++) out[base + (i++) * bytesPerSample] = frag[p++];
        } else if (hdr > 128) {
          if (p >= end) throw codecError(bad, 'RLE segment ' + (s + 1) + ' ends inside a replicate run.');
          var v = frag[p++];
          c = 257 - hdr;
          if (c > n - i) c = n - i;
          for (k = 0; k < c; k++) out[base + (i++) * bytesPerSample] = v;
        }
      }
      if (i < n) throw codecError(bad, 'RLE segment ' + (s + 1) + ' decodes to ' + i + ' of ' + n + ' bytes.');
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // JPEG (ITU-T T.81): frame header sniffing and lossless decoding
  // ---------------------------------------------------------------------

  function isSOF(m) { return m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC; }
  function hex2(m) { return (m < 16 ? '0' : '') + m.toString(16).toUpperCase(); }

  // Reads the marker segments up to the first frame header (SOFn).
  function jpegFrameHeader(u8) {
    var bad = 'jpeg_stream_invalid';
    if (u8.length < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) throw codecError(bad, 'The JPEG stream does not start with a start-of-image marker.');
    var p = 2;
    while (p + 4 <= u8.length) {
      if (u8[p] !== 0xFF) throw codecError(bad, 'Expected a JPEG marker at byte ' + p + '.');
      var m = u8[p + 1];
      if (m === 0xFF) { p++; continue; }
      p += 2;
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) continue;
      if (m === 0xD8 || m === 0xD9 || m === 0xDA) throw codecError(bad, 'The JPEG stream has no frame header.');
      var len = (u8[p] << 8) | u8[p + 1];
      if (len < 2 || p + len > u8.length) throw codecError(bad, 'JPEG marker segment FF' + hex2(m) + ' has an invalid length.');
      if (isSOF(m)) {
        if (len < 8 || len < 8 + 3 * u8[p + 7]) throw codecError(bad, 'The JPEG frame header is too short.');
        var comps = [];
        for (var c = 0; c < u8[p + 7]; c++) {
          var q = p + 8 + 3 * c;
          comps.push({ id: u8[q], h: u8[q + 1] >> 4, v: u8[q + 1] & 15 });
        }
        return { sof: m, precision: u8[p + 2], rows: (u8[p + 3] << 8) | u8[p + 4], cols: (u8[p + 5] << 8) | u8[p + 6], components: comps };
      }
      p += len;
    }
    throw codecError(bad, 'The JPEG stream ends before its frame header.');
  }

  // 16-bit code prefix -> (code length << 8 | symbol); 0 marks an invalid code.
  function buildHuffmanLut(counts, symbols) {
    var lut = new Uint16Array(65536), code = 0, k = 0;
    for (var l = 1; l <= 16; l++) {
      for (var c = 0; c < counts[l - 1]; c++) {
        if (code >= (1 << l)) throw codecError('jpeg_stream_invalid', 'A JPEG Huffman table is over-subscribed.');
        var sym = symbols[k++];
        if (sym > 16) throw codecError('jpeg_stream_invalid', 'A lossless JPEG Huffman table holds category ' + sym + ' (maximum 16).');
        var shift = 16 - l;
        lut.fill((l << 8) | sym, code << shift, (code + 1) << shift);
        code++;
      }
      code <<= 1;
    }
    return lut;
  }

  // ITU-T T.81 Annex H, process 14: lossless, Huffman coded (SOF3); 1 to 4
  // components with sampling factors 1x1 (one interleaved scan or one scan per
  // component); predictors 1-7; point transform; restart intervals that are a
  // whole number of lines. Returns {precision, rows, cols, components, samples}
  // with samples = one Uint16Array plane per component, planes concatenated.
  function decodeJpegLossless(u8) {
    var bad = 'jpeg_stream_invalid';
    var len = u8.length, p = 2, frame = null, tables = [null, null, null, null], restart = 0, samples = null, decoded = [];
    if (len < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) throw codecError(bad, 'The JPEG stream does not start with a start-of-image marker.');
    for (;;) {
      if (p + 2 > len) {
        // A missing end-of-image marker is tolerated once every scan decoded
        // completely (the scan decoder has already checked for truncation).
        if (frame && decoded.length === frame.ids.length) break;
        throw codecError('jpeg_data_corrupt', 'The JPEG stream ends before its end-of-image marker.');
      }
      if (u8[p] !== 0xFF) throw codecError(bad, 'Expected a JPEG marker at byte ' + p + '.');
      var m = u8[p + 1];
      if (m === 0xFF) { p++; continue; }
      p += 2;
      if (m === 0xD9) break;
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) continue;
      if (m === 0xD8) throw codecError(bad, 'Unexpected start-of-image marker inside the JPEG stream.');
      if (p + 2 > len) throw codecError(bad, 'Truncated JPEG marker segment FF' + hex2(m) + '.');
      var segLen = (u8[p] << 8) | u8[p + 1], seg = p + 2, end = p + segLen;
      if (segLen < 2 || end > len) throw codecError(bad, 'JPEG marker segment FF' + hex2(m) + ' has an invalid length.');
      if (m === 0xC4) {
        var q = seg;
        while (q < end) {
          var tc = u8[q] >> 4, th = u8[q] & 15;
          q++;
          if (th > 3 || q + 16 > end) throw codecError(bad, 'Malformed JPEG Huffman table segment.');
          var counts = u8.subarray(q, q + 16), total = 0;
          for (var i = 0; i < 16; i++) total += counts[i];
          q += 16;
          if (q + total > end) throw codecError(bad, 'Malformed JPEG Huffman table segment.');
          if (tc === 0) tables[th] = buildHuffmanLut(counts, u8.subarray(q, q + total));
          q += total;
        }
      } else if (m === 0xDD) {
        if (segLen < 4) throw codecError(bad, 'Malformed JPEG restart interval segment.');
        restart = (u8[seg] << 8) | u8[seg + 1];
      } else if (m === 0xC3) {
        if (frame) throw codecError(bad, 'The JPEG stream has more than one frame header.');
        var nf = segLen >= 8 ? u8[seg + 5] : 0;
        if (nf < 1 || nf > 4 || segLen < 8 + 3 * nf) throw codecError(bad, 'Malformed lossless JPEG frame header.');
        frame = { precision: u8[seg], rows: (u8[seg + 1] << 8) | u8[seg + 2], cols: (u8[seg + 3] << 8) | u8[seg + 4], ids: [] };
        if (frame.precision < 2 || frame.precision > 16) throw codecError(bad, 'Lossless JPEG precision ' + frame.precision + ' is outside 2-16 bits.');
        if (frame.rows === 0) throw codecError('jpeg_unsupported', 'JPEG streams that define their height in a DNL marker are not supported.' + REEXPORT);
        if (frame.cols === 0) throw codecError(bad, 'The JPEG frame header has zero columns.');
        for (var c = 0; c < nf; c++) {
          frame.ids.push(u8[seg + 6 + 3 * c]);
          if (u8[seg + 7 + 3 * c] !== 0x11) throw codecError('jpeg_unsupported', 'Subsampled lossless JPEG components are not supported.' + REEXPORT);
        }
        var n = frame.rows * frame.cols;
        // At least one bit per sample: bound the allocation by the input size.
        if (n * nf > 8 * len) throw codecError('jpeg_data_corrupt', 'The JPEG stream is too short for a ' + frame.rows + 'x' + frame.cols + ' image.');
        samples = new Uint16Array(n * nf);
      } else if (isSOF(m)) {
        throw codecError('jpeg_unsupported', 'JPEG frame type FF' + hex2(m) + ' is not lossless process 14.');
      } else if (m === 0xDA) {
        if (!frame) throw codecError(bad, 'The JPEG scan comes before its frame header.');
        var ns = u8[seg];
        if (ns < 1 || ns > frame.ids.length || segLen < 6 + 2 * ns) throw codecError(bad, 'Malformed JPEG scan header.');
        var comps = [], np = frame.rows * frame.cols;
        for (var s = 0; s < ns; s++) {
          var ci = frame.ids.indexOf(u8[seg + 1 + 2 * s]), td = u8[seg + 2 + 2 * s] >> 4;
          if (ci < 0 || decoded.indexOf(ci) >= 0 || td > 3 || !tables[td]) throw codecError(bad, 'The JPEG scan references an unknown component or Huffman table.');
          decoded.push(ci);
          comps.push({ plane: samples.subarray(ci * np, (ci + 1) * np), lut: tables[td] });
        }
        var predictor = u8[seg + 1 + 2 * ns], pt = u8[seg + 3 + 2 * ns] & 15;
        if (predictor < 1 || predictor > 7) throw codecError(bad, 'Lossless JPEG predictor ' + predictor + ' is not 1-7.');
        if (pt >= frame.precision) throw codecError(bad, 'Invalid lossless JPEG point transform.');
        p = decodeLosslessScan(u8, end, frame, comps, predictor, pt, restart);
        continue;
      }
      p = end;
    }
    if (!frame || decoded.length !== frame.ids.length) throw codecError(bad, 'The JPEG stream is missing a scan for one of its components.');
    return { precision: frame.precision, rows: frame.rows, cols: frame.cols, components: frame.ids.length, samples: samples };
  }

  // Decodes one scan starting at `start`; returns the position of the marker
  // that ends its entropy-coded data. Bits past the end of the data are read as
  // zeros but must never be consumed: that would mean truncated data.
  function decodeLosslessScan(u8, start, frame, comps, predictor, pt, ri) {
    var len = u8.length, rows = frame.rows, cols = frame.cols, nc = comps.length;
    var p = start, buf = 0, bits = 0, stop = false, pad = 0;
    if (ri && ri % cols !== 0) throw codecError('jpeg_unsupported', 'Lossless JPEG restart interval ' + ri + ' is not a whole number of lines.' + REEXPORT);
    var linesPerInterval = ri ? ri / cols : 0, rst = 0;
    var initPred = 1 << (frame.precision - pt - 1);
    function fill() {
      while (bits <= 24) {
        var b = 0;
        if (!stop) {
          if (p >= len) stop = true;
          else if ((b = u8[p]) === 0xFF) {
            if (p + 1 < len && u8[p + 1] === 0) p += 2;
            else { stop = true; b = 0; }
          } else p++;
        }
        if (stop) pad++;
        buf = ((buf << 8) | b) >>> 0;
        bits += 8;
      }
    }
    function checkEnd(where) {
      if (pad * 8 > bits) throw codecError('jpeg_data_corrupt', 'The JPEG entropy-coded data ends early (' + where + ').');
    }
    var firstLine = 0;
    for (var y = 0; y < rows; y++) {
      if (linesPerInterval && y > 0 && y % linesPerInterval === 0) {
        checkEnd('line ' + y);
        buf = 0; bits = 0; stop = false; pad = 0;
        // Skip what the bit reader did not load (at most the final padded
        // byte in a conforming stream) and fill bytes, up to the marker.
        var skipped = 0;
        while (p + 1 < len) {
          if (u8[p] === 0xFF) {
            if (u8[p + 1] === 0xFF) { p++; continue; }
            if (u8[p + 1] !== 0) break;
            p += 2; skipped++; continue;
          }
          p++; skipped++;
        }
        if (skipped > 4 || p + 1 >= len || u8[p + 1] !== (0xD0 | (rst & 7))) throw codecError('jpeg_data_corrupt', 'Restart marker ' + (rst & 7) + ' is missing before line ' + y + '.');
        p += 2; rst++;
        firstLine = y;
      }
      var row = y * cols, isFirst = y === firstLine;
      for (var x = 0; x < cols; x++) {
        var i = row + x;
        for (var c = 0; c < nc; c++) {
          var out = comps[c].plane;
          if (bits < 16) fill();
          var e = comps[c].lut[(buf >>> (bits - 16)) & 0xFFFF];
          if (e === 0) throw codecError('jpeg_data_corrupt', 'Invalid Huffman code in line ' + y + '.');
          bits -= e >>> 8;
          var ssss = e & 0xFF, diff = 0;
          if (ssss === 16) diff = 32768;
          else if (ssss) {
            if (bits < ssss) fill();
            var v = (buf >>> (bits - ssss)) & ((1 << ssss) - 1);
            bits -= ssss;
            diff = v < (1 << (ssss - 1)) ? v - (1 << ssss) + 1 : v;
          }
          var pred;
          if (x === 0) pred = isFirst ? initPred : out[i - cols];
          else if (isFirst) pred = out[i - 1];
          else {
            var ra = out[i - 1], rb = out[i - cols], rc = out[i - cols - 1];
            switch (predictor) {
              case 1: pred = ra; break;
              case 2: pred = rb; break;
              case 3: pred = rc; break;
              case 4: pred = ra + rb - rc; break;
              case 5: pred = ra + ((rb - rc) >> 1); break;
              case 6: pred = rb + ((ra - rc) >> 1); break;
              default: pred = (ra + rb) >> 1; break;
            }
          }
          out[i] = (pred + diff) & 0xFFFF;
        }
      }
    }
    checkEnd('end of scan');
    if (pt) {
      for (var k = 0; k < nc; k++) {
        var pl = comps[k].plane;
        for (var j = 0; j < pl.length; j++) pl[j] = (pl[j] << pt) & 0xFFFF;
      }
    }
    // Position of the next marker (skip any bytes the bit reader did not reach).
    while (p + 1 < len && !(u8[p] === 0xFF && u8[p + 1] !== 0 && !(u8[p + 1] >= 0xD0 && u8[p + 1] <= 0xD7))) p++;
    return p;
  }

  // ---------------------------------------------------------------------
  // Deflate and browser JPEG (asynchronous, browser built-ins only)
  // ---------------------------------------------------------------------

  async function inflateRaw(bytes, cap) {
    if (typeof DecompressionStream !== 'function' || typeof Blob !== 'function' || typeof Blob.prototype.stream !== 'function') {
      throw codecError('deflate_unavailable', 'This browser has no DecompressionStream, so a Deflated DICOM file cannot be read here.' + REEXPORT);
    }
    var ds;
    try { ds = new DecompressionStream('deflate-raw'); } catch (e) {
      throw codecError('deflate_unavailable', 'This browser cannot inflate raw deflate data.' + REEXPORT);
    }
    var reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
    var chunks = [], total = 0;
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > cap) {
        try { reader.cancel().catch(function () {}); } catch (e) { /* ignore */ }
        throw codecError('too_large', 'The inflated dataset is larger than the ' + cap + ' byte limit.');
      }
      chunks.push(step.value);
    }
    var out = new Uint8Array(total), o = 0;
    for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].byteLength; }
    return out;
  }

  // Deflated Explicit VR Little Endian (PS3.5 A.5): everything after the file
  // meta is one raw deflate stream, possibly followed by a 0x00 pad byte.
  async function inflateDataset(job, options) {
    var r = job.r, head = r.u8.subarray(0, job.datasetPos), body = r.u8.subarray(job.datasetPos);
    var cap = typeof options.maxInflatedBytes === 'number' && options.maxInflatedBytes > 0 ? options.maxInflatedBytes : 2 * job.maxBytes;
    var inflated;
    try {
      inflated = await inflateRaw(body, cap);
    } catch (e) {
      if (e && e.reason) throw e;
      if (body.length > 1 && body[body.length - 1] === 0) {
        try { inflated = await inflateRaw(body.subarray(0, body.length - 1), cap); } catch (e2) { if (e2 && e2.reason) throw e2; }
      }
      if (!inflated) throw codecError('deflate_corrupt', 'The Deflated dataset could not be inflated (' + (e && e.message ? e.message : String(e)) + ').');
    }
    var all = new Uint8Array(head.length + inflated.length);
    all.set(head, 0);
    all.set(inflated, head.length);
    return { bytes: all, cap: cap };
  }

  // Lossy 8-bit JPEG through the browser's own decoder. Returns RGBA bytes.
  async function browserJpegRgba(bytes, rows, cols, options) {
    var img = null;
    if (typeof options.jpegDecoder === 'function') {
      img = await options.jpegDecoder(bytes, { rows: rows, columns: cols });
    } else {
      if (typeof createImageBitmap !== 'function' || typeof Blob !== 'function') {
        throw codecError('jpeg_decoder_unavailable', 'Lossy JPEG DICOM is decoded by the browser image decoder, which is not available here.' + REEXPORT);
      }
      var bmp;
      try {
        bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      } catch (e) {
        throw codecError('jpeg_browser_decode_failed', 'The browser could not decode the JPEG pixel data (' + (e && e.message ? e.message : String(e)) + ').' + REEXPORT);
      }
      try {
        if (bmp.width !== cols || bmp.height !== rows) {
          throw codecError('jpeg_dimensions_mismatch', 'The JPEG stream decodes to ' + bmp.width + 'x' + bmp.height + ' but the header says ' + cols + 'x' + rows + '.');
        }
        var canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(cols, rows)
          : (typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null);
        if (!canvas) throw codecError('jpeg_decoder_unavailable', 'No canvas is available to read the decoded JPEG.');
        canvas.width = cols; canvas.height = rows;
        var g = canvas.getContext('2d', { willReadFrequently: true });
        if (!g) throw codecError('jpeg_decoder_unavailable', 'No 2D canvas context is available to read the decoded JPEG.');
        g.drawImage(bmp, 0, 0);
        img = { width: cols, height: rows, data: g.getImageData(0, 0, cols, rows).data };
      } finally {
        if (bmp && typeof bmp.close === 'function') bmp.close();
      }
    }
    if (!img || img.width !== cols || img.height !== rows || !img.data || img.data.length < rows * cols * 4) {
      throw codecError('jpeg_dimensions_mismatch', 'The decoded JPEG does not match the ' + cols + 'x' + rows + ' image in the header.');
    }
    return img.data;
  }

  // ---------------------------------------------------------------------
  // Pixel decoding
  // ---------------------------------------------------------------------

  // n little-endian 16-bit samples from the start of a byte array.
  function u16View(u8, n) {
    if ((u8.byteOffset & 1) === 0 && PLATFORM_LE) {
      return new Uint16Array(u8.buffer, u8.byteOffset, n);
    }
    var copy = u8.slice(0, n * 2);
    if (!PLATFORM_LE) {
      for (var i = 0; i < copy.length; i += 2) {
        var t = copy[i]; copy[i] = copy[i + 1]; copy[i + 1] = t;
      }
    }
    return new Uint16Array(copy.buffer, 0, n);
  }

  // Decodes stored pixel values (after masking to BitsStored and sign
  // extension) into an Int32Array. `src` holds the bytes of the native pixel
  // layout (Uint8Array) or already-decoded 16-bit samples (Uint16Array).
  function decodeStored(src, n, bitsAllocated, bitsStored, highBit, signed) {
    var stored = new Int32Array(n);
    var shift = highBit + 1 - bitsStored;
    var mask = bitsStored >= 32 ? 0xFFFFFFFF : ((1 << bitsStored) - 1);
    var signBit = 1 << (bitsStored - 1);
    var signRange = signBit * 2;
    var i, v;
    if (bitsAllocated === 8) {
      var src8 = src.subarray(0, n);
      if (shift === 0 && mask === 0xFF && !signed) {
        stored.set(src8);
      } else {
        for (i = 0; i < n; i++) {
          v = (src8[i] >>> shift) & mask;
          if (signed && (v & signBit)) v -= signRange;
          stored[i] = v;
        }
      }
    } else {
      var src16 = src instanceof Uint16Array ? src : u16View(src, n);
      if (shift === 0 && mask === 0xFFFF && !signed) {
        stored.set(src16.subarray(0, n));
      } else if (shift === 0 && mask === 0xFFFF && signed) {
        for (i = 0; i < n; i++) {
          v = src16[i];
          stored[i] = v >= 0x8000 ? v - 0x10000 : v;
        }
      } else {
        for (i = 0; i < n; i++) {
          v = (src16[i] >>> shift) & mask;
          if (signed && (v & signBit)) v -= signRange;
          stored[i] = v;
        }
      }
    }
    return stored;
  }

  // Colour samples -> luminance. PS3.3 C.7.6.3.1.2 defines the Y of YBR_FULL
  // as 0.299 R + 0.587 G + 0.114 B, so RGB uses those weights (rounded half
  // up) and YBR_FULL / YBR_FULL_422 use Y directly. `planar` is true when the
  // samples of each component are stored together (Planar Configuration 1,
  // RLE, JPEG planes); YBR_FULL_422 is always Y1 Y2 Cb Cr.
  function lumaFromSamples(src, n, bitsAllocated, bitsStored, highBit, photometric, planar) {
    var count = (photometric === 'YBR_FULL_422' ? 2 : 3) * n;
    var s = bitsAllocated === 8 ? src : (src instanceof Uint16Array ? src : u16View(src, count));
    var shift = highBit + 1 - bitsStored, mask = (1 << bitsStored) - 1;
    var out = new Int32Array(n), i, k, a, b, c;
    if (photometric === 'YBR_FULL_422') {
      for (i = 0; i < n; i++) out[i] = (s[4 * (i >> 1) + (i & 1)] >>> shift) & mask;
      return out;
    }
    var step = planar ? 1 : 3, g1 = planar ? n : 1, g2 = planar ? 2 * n : 2;
    if (photometric === 'YBR_FULL') {
      for (i = 0; i < n; i++) out[i] = (s[i * step] >>> shift) & mask;
      return out;
    }
    for (i = 0; i < n; i++) {
      k = i * step;
      a = (s[k] >>> shift) & mask; b = (s[k + g1] >>> shift) & mask; c = (s[k + g2] >>> shift) & mask;
      out[i] = (a === b && b === c) ? a : Math.floor((299 * a + 587 * b + 114 * c + 500) / 1000);
    }
    return out;
  }

  // RGBA from the browser decoder -> 8-bit luminance (grey JPEGs give R = G = B).
  function lumaFromRgba(data, n) {
    var out = new Uint8Array(n);
    for (var i = 0, q = 0; i < n; i++, q += 4) {
      var a = data[q], b = data[q + 1], c = data[q + 2];
      out[i] = (a === b && b === c) ? a : Math.floor((299 * a + 587 * b + 114 * c + 500) / 1000);
    }
    return out;
  }

  // Computes min/max and a histogram of stored values, excluding the padding
  // range [padLo, padHi] when hasPad is true.
  function storedStats(stored, hasPad, padLo, padHi) {
    var n = stored.length;
    var i, v;
    var min = 0x7FFFFFFF, max = -0x80000000;
    var count = 0;
    var padCount = 0;
    for (i = 0; i < n; i++) {
      v = stored[i];
      if (hasPad && v >= padLo && v <= padHi) { padCount++; continue; }
      if (v < min) min = v;
      if (v > max) max = v;
      count++;
    }
    if (count === 0) return { min: 0, max: 0, count: 0, padCount: padCount, hist: null, histMin: 0 };
    var range = max - min + 1;
    var hist = new Int32Array(range);
    for (i = 0; i < n; i++) {
      v = stored[i];
      if (hasPad && v >= padLo && v <= padHi) continue;
      hist[v - min]++;
    }
    return { min: min, max: max, count: count, padCount: padCount, hist: hist, histMin: min };
  }

  // Nearest-rank percentile: smallest value v with count(x <= v) >= ceil(p/100 * N).
  function histPercentile(stats, p) {
    if (!stats.hist || stats.count === 0) return 0;
    var target = Math.ceil((p / 100) * stats.count);
    if (target < 1) target = 1;
    if (target > stats.count) target = stats.count;
    var hist = stats.hist;
    var cum = 0;
    for (var i = 0; i < hist.length; i++) {
      cum += hist[i];
      if (cum >= target) return stats.histMin + i;
    }
    return stats.max;
  }

  // Applies the VOI window (PS3.3 C.11.2.1.2 LINEAR / C.11.2.1.3 LINEAR_EXACT)
  // to produce 8-bit output. `invert` handles MONOCHROME1 / INVERSE.
  function applyWindow(raw, out, center, width, fn, invert) {
    var n = raw.length;
    var lo, k;
    if (fn === 'LINEAR_EXACT') {
      lo = center - width / 2;
      k = 255 / width;
    } else {
      lo = center - 0.5 - (width - 1) / 2;
      k = 255 / (width - 1); // Infinity when width === 1 -> threshold at lo
    }
    var i;
    if (!isFinite(k)) {
      for (i = 0; i < n; i++) {
        var y = raw[i] > lo ? 255 : 0;
        out[i] = invert ? 255 - y : y;
      }
      return;
    }
    if (invert) {
      for (i = 0; i < n; i++) out[i] = 255 - (raw[i] - lo) * k;
    } else {
      for (i = 0; i < n; i++) out[i] = (raw[i] - lo) * k;
    }
  }

  // VOI LUT (PS3.3 C.11.2.1.1): the first Descriptor value is the number of
  // entries (0 = 65536), the second the first input value mapped (US or SS),
  // the third the bits per entry; the output range is 0 .. 2^bits - 1.
  // Returns null (with a warning) when the LUT cannot be used.
  function buildVoiLut(r, lut, signedInput, ctx) {
    var d = lut.desc, entries = d[0] === 0 ? 65536 : d[0], first = d[1], bits = d[2];
    if (lut.descVR === 'SS' || (lut.descVR !== 'US' && signedInput)) { if (first >= 0x8000) first -= 0x10000; }
    if (!(bits >= 1 && bits <= 16)) { ctx.warn('voi_lut_descriptor_invalid'); return null; }
    var available = Math.min(lut.dataLength, r.len - lut.dataPos), table = new Uint16Array(entries), mask = (1 << bits) - 1, i;
    if (available >= 2 * entries) {
      for (i = 0; i < entries; i++) table[i] = r.u16(lut.dataPos + 2 * i, lut.little) & mask;
    } else if (bits <= 8 && available >= entries) {
      for (i = 0; i < entries; i++) table[i] = r.u8[lut.dataPos + i] & mask;
    } else {
      ctx.warn('voi_lut_data_too_short');
      return null;
    }
    return { entries: entries, first: first, bits: bits, table: table };
  }

  function applyVoiLut(raw, out, lut, invert) {
    var t8 = new Uint8ClampedArray(lut.entries), scale = 255 / ((1 << lut.bits) - 1), i;
    for (i = 0; i < lut.entries; i++) t8[i] = lut.table[i] * scale;
    var first = lut.first, last = lut.entries - 1;
    for (i = 0; i < raw.length; i++) {
      var idx = Math.round(raw[i]) - first;
      if (idx < 0) idx = 0; else if (idx > last) idx = last;
      out[i] = invert ? 255 - t8[idx] : t8[idx];
    }
  }

  // ---------------------------------------------------------------------
  // Transfer syntax classification
  // ---------------------------------------------------------------------

  // Returns null for the native syntaxes, {kind:'jpeg'|'rle'|'encapsulated'},
  // or {kind:'unsupported', reason, name} for compressed data we cannot decode.
  function classifyTS(ts) {
    if (ts === TS_RLE) return { kind: 'rle', label: 'RLE Lossless' };
    if (ts === TS_ENCAPSULATED_UNCOMPRESSED_LE) return { kind: 'encapsulated', label: 'Encapsulated Uncompressed' };
    if (ts.indexOf(TS_JPEG_PREFIX) === 0 && /^\d+$/.test(ts.slice(TS_JPEG_PREFIX.length))) {
      var k = +ts.slice(TS_JPEG_PREFIX.length);
      if (k >= 50 && k <= 70) {
        return { kind: 'jpeg', label: k === 50 ? 'JPEG Baseline' : k === 51 ? 'JPEG Extended' : k === 57 ? 'JPEG Lossless' : k === 70 ? 'JPEG Lossless SV1' : 'JPEG (retired process)' };
      }
      if (k === 80 || k === 81) return { kind: 'unsupported', reason: 'jpeg_ls_unsupported', name: 'JPEG-LS' };
      if ((k >= 90 && k <= 93) || (k >= 201 && k <= 204)) return { kind: 'unsupported', reason: 'jpeg2000_unsupported', name: k > 200 ? 'High-Throughput JPEG 2000' : 'JPEG 2000' };
      if (k === 94 || k === 95) return { kind: 'unsupported', reason: 'jpip_unsupported', name: 'JPIP (referenced pixel data)' };
      if (k >= 100 && k <= 108) return { kind: 'unsupported', reason: 'video_transfer_syntax_unsupported', name: 'MPEG / HEVC video' };
      if (k >= 110 && k <= 112) return { kind: 'unsupported', reason: 'jpeg_xl_unsupported', name: 'JPEG XL' };
    }
    if (ts.indexOf('1.2.840.10008.1.2.4') === 0 || ts.indexOf('1.2.840.10008.1.2.5') === 0 ||
        ts.indexOf('1.2.840.10008.1.2.6') === 0 || ts.indexOf('1.2.840.10008.1.2.7') === 0 ||
        ts.indexOf('1.2.840.10008.1.2.8') === 0) {
      return { kind: 'unsupported', reason: 'compressed_transfer_syntax_unsupported', name: 'This compressed' };
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Main entry points
  // ---------------------------------------------------------------------

  function baseResult() {
    return {
      ok: false,
      reason: null,
      message: '',
      transferSyntaxUID: null,
      sopClassUID: null,
      modality: null,
      photometric: null,
      samplesPerPixel: null,
      bitsAllocated: null,
      bitsStored: null,
      highBit: null,
      pixelRepresentation: null,
      rows: null,
      columns: null,
      numberOfFrames: null,
      frameDecoded: null,
      pixelCodec: null,
      pixelSpacingMm: { row: null, col: null, source: null },
      orientation: { viewPosition: null, rowDirection: null, columnDirection: null, imageLaterality: null },
      calibration: { pixelSpacingCalibrationType: null, estimatedRadiographicMagnificationFactor: null, distanceSourceToDetectorMm: null, distanceSourceToPatientMm: null },
      rescale: { slope: 1, intercept: 0, applied: false },
      window: null,
      presentationLutShape: null,
      displayInverted: null,
      gray8: null,
      raw16: null,
      stats: null,
      pixelPadding: null,
      preamble: false,
      byteLength: 0,
      warnings: [],
      privacy: { identityTagsRead: false },
      version: VERSION
    };
  }

  function failResult(res, reason, message) {
    res.ok = false;
    res.reason = reason;
    res.message = message;
    res.gray8 = null;
    res.raw16 = null;
    return res;
  }

  function absorbError(res, e) {
    res.ok = false;
    res.gray8 = null;
    res.raw16 = null;
    if (e && e.reason) {
      res.reason = e.reason;
      res.message = e.message;
    } else {
      if (res.reason === null) {
        res.reason = 'parse_error';
        res.message = 'Failed to parse DICOM data: ' + (e && e.message ? e.message : String(e));
      }
      res.warnings.push('exception:' + (e && e.message ? e.message : String(e)));
    }
  }

  function decodeRadiograph(input, options) {
    var res = baseResult();
    try {
      var job = prepare(input, options || {}, res, null);
      if (job && job.kind === 'deflated') {
        failResult(res, 'deflated_requires_async', 'Deflated Explicit VR Little Endian data is inflated with the DecompressionStream of the browser, which only decodeRadiographAsync uses.' + REEXPORT);
      } else if (job && job.kind === 'jpeg_browser') {
        failResult(res, 'jpeg_lossy_requires_async', 'Lossy JPEG pixel data (' + job.codecLabel + ') is decoded by the image decoder of the browser, which only decodeRadiographAsync uses.' + REEXPORT);
      } else if (job) {
        finish(job, decodePixels(job), res);
      }
    } catch (e) {
      absorbError(res, e);
    }
    return res;
  }

  async function decodeRadiographAsync(input, options) {
    options = options || {};
    var res = baseResult();
    try {
      var job = prepare(input, options, res, null);
      if (job && job.kind === 'deflated') {
        var inflated = await inflateDataset(job, options);
        res = baseResult();
        job = prepare(inflated.bytes, options, res, { maxBytes: inflated.cap + job.datasetPos, byteLength: job.r.len });
      }
      if (job && job.kind === 'jpeg_browser') {
        var rgba = await browserJpegRgba(job.bytes, job.rows, job.cols, options);
        var luma = lumaFromRgba(rgba, job.n);
        finish(job, job.color ? Int32Array.from(luma) : decodeStored(luma, job.n, 8, job.bitsStored, job.bitsStored - 1, job.signed), res);
      } else if (job) {
        finish(job, decodePixels(job), res);
      }
    } catch (e) {
      absorbError(res, e);
    }
    return res;
  }

  // Parses the file, validates the image description and locates the bytes of
  // frame 1. Returns a job for decodePixels / finish, or null after filling
  // `res` with a failure. `inner` is set when re-parsing an inflated dataset.
  function prepare(input, options, res, inner) {
    var warnings = res.warnings;
    var ctx = {
      meta: {
        transferSyntaxUID: null, mediaSopClassUID: null, sopClassUID: null, modality: null,
        photometric: null, samplesPerPixel: null, planarConfiguration: null, numberOfFrames: null, rows: null, columns: null,
        bitsAllocated: null, bitsStored: null, highBit: null, pixelRepresentation: null,
        pixelPaddingRaw: null, pixelPaddingLimitRaw: null, pixelSpacing: null, imagerPixelSpacing: null,
        windowCenter: null, windowWidth: null, rescaleIntercept: null, rescaleSlope: null,
        voiLutFunction: null, voiLutSequencePresent: false, voiLut: null, modalityLutSequencePresent: false,
        presentationLutShape: null, viewPosition: null, orientationCodes: null, imageLaterality: null,
        pixelSpacingCalibrationType: null, estimatedMagnification: null, distanceSourceToDetector: null, distanceSourceToPatient: null,
        pixelDataPos: null, pixelDataLength: null, pixelDataVR: null, pixelDataUndefined: false
      },
      warn: function (w) { if (warnings.indexOf(w) < 0) warnings.push(w); }
    };
    var meta = ctx.meta;

    function fail(reason, message) {
      failResult(res, reason, message);
      return null;
    }

    var maxBytes = typeof options.maxBytes === 'number' && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_BYTES;
    var maxPixels = typeof options.maxPixels === 'number' && options.maxPixels > 0 ? options.maxPixels : DEFAULT_MAX_PIXELS;
    var percentiles = options.autoWindowPercentiles;
    if (!percentiles || percentiles.length !== 2 || !isFinite(percentiles[0]) || !isFinite(percentiles[1])) {
      percentiles = DEFAULT_PERCENTILES;
    }
    var fileMaxBytes = maxBytes;
    if (inner) maxBytes = inner.maxBytes;

    var r;
    try {
      r = new Reader(input);
    } catch (e) {
      return fail('invalid_input', 'Input must be an ArrayBuffer or typed array.');
    }
    res.byteLength = inner ? inner.byteLength : r.len;
    if (r.len > maxBytes) {
      return fail('too_large', 'File is ' + r.len + ' bytes, larger than the ' + maxBytes + ' byte limit.');
    }
    if (r.len < 8) return fail('not_dicom', 'File is too small to be a DICOM dataset.');

    // --- Locate the dataset ------------------------------------------------
    var pos = 0;
    if (r.len >= 132 && r.ascii(128, 4) === 'DICM') {
      pos = 132;
      res.preamble = true;
    } else if (r.ascii(0, 4) === 'DICM') {
      pos = 4;
      ctx.warn('no_preamble');
    } else if (looksLikeDataset(r, 0)) {
      pos = 0;
      ctx.warn('no_preamble');
    } else {
      return fail('not_dicom', 'No DICM marker and the first bytes do not look like a DICOM element.');
    }

    // --- File meta (group 0002), always explicit VR little endian ----------
    if (pos + 8 <= r.len && r.u16(pos, true) === 0x0002) {
      pos = parseFileMeta(r, pos, ctx);
    } else {
      ctx.warn('file_meta_missing');
    }

    // --- Transfer syntax ---------------------------------------------------
    var ts = meta.transferSyntaxUID;
    res.transferSyntaxUID = ts;
    var sniffed = sniffExplicit(r, pos);
    var explicit, little = true;
    var codec = null, bigEndian = false;
    if (ts === null || ts === '') {
      ctx.warn('transfer_syntax_missing');
      explicit = sniffed === true;
    } else if (ts === TS_DEFLATED_LE) {
      if (!inner) {
        res.sopClassUID = meta.mediaSopClassUID || null;
        return { kind: 'deflated', r: r, datasetPos: pos, maxBytes: fileMaxBytes };
      }
      explicit = true;
    } else if (ts === TS_EXPLICIT_BE) {
      explicit = true; little = false; bigEndian = true;
    } else if (ts === TS_GE_IMPLICIT_BE_PIXELS) {
      explicit = false; little = true; bigEndian = true;
    } else if (ts === TS_IMPLICIT_LE) {
      explicit = false;
    } else if (ts === TS_EXPLICIT_LE) {
      explicit = true;
    } else if ((codec = classifyTS(ts)) !== null) {
      explicit = true;
    } else {
      ctx.warn('transfer_syntax_unknown');
      explicit = sniffed === true;
    }
    if (little && sniffed !== null && sniffed !== explicit && !bigEndian) {
      ctx.warn('transfer_syntax_mismatch_using_' + (sniffed ? 'explicit' : 'implicit') + '_vr');
      explicit = sniffed;
    }

    // --- Walk the dataset --------------------------------------------------
    parseDataset(r, pos, explicit, little, ctx);

    // --- Copy metadata into the result -------------------------------------
    res.sopClassUID = meta.sopClassUID || meta.mediaSopClassUID || null;
    res.modality = meta.modality || null;
    res.photometric = meta.photometric || null;
    res.samplesPerPixel = meta.samplesPerPixel;
    res.bitsAllocated = meta.bitsAllocated;
    res.bitsStored = meta.bitsStored;
    res.highBit = meta.highBit;
    res.pixelRepresentation = meta.pixelRepresentation;
    res.rows = meta.rows;
    res.columns = meta.columns;
    res.numberOfFrames = meta.numberOfFrames;
    copyAcquisition(meta, res, ctx);

    var ps = meta.pixelSpacing, ips = meta.imagerPixelSpacing;
    var psOk = ps && ps.length >= 2 && ps[0] > 0 && ps[1] > 0;
    var ipsOk = ips && ips.length >= 2 && ips[0] > 0 && ips[1] > 0;
    if (psOk) {
      res.pixelSpacingMm = { row: ps[0], col: ps[1], source: 'PixelSpacing' };
      if (ipsOk && (Math.abs(ps[0] - ips[0]) > 1e-6 || Math.abs(ps[1] - ips[1]) > 1e-6)) {
        ctx.warn('pixel_spacing_differs_from_imager_pixel_spacing');
      }
    } else if (ipsOk) {
      res.pixelSpacingMm = { row: ips[0], col: ips[1], source: 'ImagerPixelSpacing' };
      if (ps && ps.length) ctx.warn('pixel_spacing_invalid_using_imager_pixel_spacing');
    } else {
      res.pixelSpacingMm = { row: null, col: null, source: null };
      if ((ps && ps.length) || (ips && ips.length)) ctx.warn('pixel_spacing_invalid');
    }

    var slope = meta.rescaleSlope, intercept = meta.rescaleIntercept;
    var rescalePresent = slope !== null || intercept !== null;
    if (slope === null || !isFinite(slope) || slope === 0) {
      if (slope !== null) ctx.warn('rescale_slope_invalid');
      slope = 1;
    }
    if (intercept === null || !isFinite(intercept)) {
      if (intercept !== null) ctx.warn('rescale_intercept_invalid');
      intercept = 0;
    }
    res.rescale = { slope: slope, intercept: intercept, applied: false };

    // --- Reject what we cannot decode, keeping the metadata ----------------
    if (bigEndian) {
      return fail('big_endian_unsupported', 'Big endian transfer syntax ' + ts + ' is not supported.' + REEXPORT);
    }
    if (codec && codec.kind === 'unsupported') {
      return fail(codec.reason, codec.name + ' DICOM (transfer syntax ' + ts + ') cannot be decoded in this offline app.' + REEXPORT);
    }
    if (meta.pixelDataPos === null) {
      return fail('pixel_data_missing', 'No Pixel Data (7FE0,0010) element was found.');
    }
    if (meta.pixelDataUndefined && !codec) {
      return fail('pixel_data_encapsulated_unsupported', 'Pixel Data has undefined length (encapsulated) but the transfer syntax is not a compressed one.');
    }
    if (codec && !meta.pixelDataUndefined) {
      return fail('pixel_data_not_encapsulated', 'Transfer syntax ' + ts + ' requires encapsulated Pixel Data, but the element has a defined length.');
    }

    var photometric = meta.photometric;
    if (photometric === null || photometric === '') {
      ctx.warn('photometric_missing_assumed_monochrome2');
      photometric = 'MONOCHROME2';
      res.photometric = photometric;
    }
    var color = photometric === 'RGB' || photometric === 'YBR_FULL' || photometric === 'YBR_FULL_422';
    if (!color && photometric !== 'MONOCHROME1' && photometric !== 'MONOCHROME2') {
      return fail('photometric_unsupported', 'Photometric interpretation ' + photometric + ' is not supported; MONOCHROME1, MONOCHROME2, RGB, YBR_FULL and YBR_FULL_422 are.');
    }
    var spp = meta.samplesPerPixel === null ? (color ? 3 : 1) : meta.samplesPerPixel;
    if (spp !== (color ? 3 : 1)) {
      return fail('samples_per_pixel_unsupported', 'Samples per pixel is ' + spp + ' with photometric interpretation ' + photometric + '.');
    }
    var frames = meta.numberOfFrames === null ? 1 : meta.numberOfFrames;
    if (!Number.isInteger(frames) || frames < 1) {
      return fail('number_of_frames_invalid', 'Number of frames is ' + frames + '.');
    }
    var bitsAllocated = meta.bitsAllocated;
    if (bitsAllocated !== 8 && bitsAllocated !== 16) {
      return fail('bits_unsupported', 'Bits allocated is ' + bitsAllocated + '; only 8 or 16 are supported.');
    }
    var rows = meta.rows, cols = meta.columns;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 65535 || cols > 65535) {
      return fail('dimensions_invalid', 'Rows/Columns are missing or invalid (' + rows + ' x ' + cols + ').');
    }
    var n = rows * cols;
    if (n > maxPixels) {
      return fail('too_large', 'Image has ' + n + ' pixels, more than the ' + maxPixels + ' pixel limit.');
    }
    var bitsStored = meta.bitsStored;
    if (bitsStored === null || !Number.isInteger(bitsStored) || !(bitsStored >= 1) || bitsStored > bitsAllocated) {
      if (bitsStored !== null) ctx.warn('bits_stored_invalid_assumed_bits_allocated');
      bitsStored = bitsAllocated;
    }
    var highBit = meta.highBit;
    if (highBit === null || !Number.isInteger(highBit) || highBit < bitsStored - 1 || highBit >= bitsAllocated) {
      if (highBit !== null) ctx.warn('high_bit_invalid_assumed_bits_stored_minus_1');
      highBit = bitsStored - 1;
    }
    var signed = meta.pixelRepresentation === 1;
    if (meta.pixelRepresentation !== null && meta.pixelRepresentation !== 0 && meta.pixelRepresentation !== 1) {
      ctx.warn('pixel_representation_invalid_assumed_unsigned');
    }
    if (color && signed) {
      ctx.warn('signed_colour_samples_read_as_unsigned');
      signed = false;
    }
    var planar = meta.planarConfiguration === 1;
    // Native YBR_FULL_422 is stored as Y1 Y2 Cb Cr pairs within each row.
    if (photometric === 'YBR_FULL_422' && (!codec || codec.kind === 'encapsulated') && (planar || (cols & 1))) {
      return fail('photometric_unsupported', 'Uncompressed YBR_FULL_422 needs Planar Configuration 0 and an even number of columns.');
    }
    res.bitsStored = bitsStored;
    res.highBit = highBit;
    if (frames > 1) ctx.warn('multi_frame_first_frame_used');

    var job = {
      kind: 'native', r: r, ctx: ctx, meta: meta, bytes: null, rows: rows, cols: cols, n: n, color: color, photometric: photometric,
      planar: planar, spp: spp, bitsAllocated: bitsAllocated, bitsStored: bitsStored, highBit: highBit, signed: signed, frames: frames,
      slope: slope, intercept: intercept, rescalePresent: rescalePresent, percentiles: percentiles,
      codecLabel: codec ? codec.label : (ts === TS_DEFLATED_LE ? 'Deflated' : null), jpeg: null
    };
    var bytesPerPixel = bitsAllocated / 8 * (photometric === 'YBR_FULL_422' ? 2 : spp);
    var frameBytes = n * bytesPerPixel;

    // --- Locate frame 1 ----------------------------------------------------
    if (!codec) {
      var available = Math.min(meta.pixelDataLength, r.len - meta.pixelDataPos);
      if (available < frameBytes) {
        return fail('pixel_data_truncated', 'Pixel Data holds ' + available + ' bytes but ' + frameBytes + ' are required for ' + rows + 'x' + cols + ' at ' + bitsAllocated + ' bits' + (spp > 1 ? ' x ' + spp + ' samples' : '') + '.');
      }
      if (meta.pixelDataLength > frameBytes * frames + 1) ctx.warn('pixel_data_longer_than_expected');
      else if (meta.pixelDataLength < frameBytes * frames) ctx.warn('pixel_data_shorter_than_number_of_frames');
      job.bytes = r.u8.subarray(meta.pixelDataPos, meta.pixelDataPos + frameBytes);
      job.pixelCodec = 'native';
      return job;
    }
    job.bytes = encapsulatedFrame1(r, meta.pixelDataPos, frames, codec.kind);
    if (codec.kind === 'encapsulated') {
      if (job.bytes.length < frameBytes) return fail('pixel_data_truncated', 'Frame 1 holds ' + job.bytes.length + ' bytes but ' + frameBytes + ' are required.');
      job.pixelCodec = 'encapsulated_uncompressed';
      return job;
    }
    if (codec.kind === 'rle') {
      if (photometric === 'YBR_FULL_422') return fail('photometric_unsupported', 'YBR_FULL_422 is not a valid photometric interpretation for RLE.');
      job.kind = 'rle';
      job.pixelCodec = 'rle_lossless';
      return job;
    }
    // JPEG family: route by the frame header actually present in the stream.
    var hdr = jpegFrameHeader(job.bytes);
    job.jpeg = hdr;
    if (hdr.rows !== rows || hdr.cols !== cols) {
      return fail('jpeg_dimensions_mismatch', 'The JPEG frame is ' + hdr.cols + 'x' + hdr.rows + ' but the DICOM header says ' + cols + 'x' + rows + '.');
    }
    if (hdr.components.length !== (color ? 3 : 1)) {
      return fail('jpeg_components_mismatch', 'The JPEG frame has ' + hdr.components.length + ' components but the photometric interpretation is ' + photometric + '.');
    }
    if (hdr.sof === 0xC3) {
      if (photometric === 'YBR_FULL_422') return fail('photometric_unsupported', 'YBR_FULL_422 is not valid for lossless JPEG.');
      job.kind = 'jpeg_lossless';
      job.pixelCodec = 'jpeg_lossless';
      return job;
    }
    if (hdr.sof === 0xC0 || hdr.sof === 0xC1 || hdr.sof === 0xC2) {
      if (hdr.precision !== 8) {
        return fail('jpeg_12bit_lossy_unsupported', hdr.precision + '-bit lossy JPEG (transfer syntax ' + ts + ') cannot be decoded by the browser image decoder.' + REEXPORT);
      }
      if (bitsStored !== 8) ctx.warn('jpeg_precision_differs_from_bits_stored');
      job.bitsStored = 8;
      res.bitsStored = 8;
      res.highBit = 7;
      job.kind = 'jpeg_browser';
      job.pixelCodec = 'jpeg_browser';
      return job;
    }
    if (hdr.sof >= 0xC9) return fail('jpeg_arithmetic_unsupported', 'Arithmetic-coded JPEG (frame type FF' + hex2(hdr.sof) + ') cannot be decoded in this offline app.' + REEXPORT);
    return fail('jpeg_hierarchical_unsupported', 'Hierarchical / differential JPEG (frame type FF' + hex2(hdr.sof) + ') cannot be decoded in this offline app.' + REEXPORT);
  }

  // View / orientation / geometry tags, exposed for the caller (never shown
  // as-is). Patient Orientation (PS3.3 C.7.6.1.1.1): the first code is the
  // direction of the rows (towards the last column), the second the direction
  // of the columns (towards the last row); A/P/R/L/H/F letters.
  function copyAcquisition(meta, res, ctx) {
    var o = res.orientation, c = res.calibration;
    if (meta.viewPosition) o.viewPosition = meta.viewPosition.split('\\')[0].trim() || null;
    if (meta.imageLaterality) o.imageLaterality = /^[RLUB]$/.test(meta.imageLaterality) ? meta.imageLaterality : null;
    if (meta.orientationCodes) {
      var parts = meta.orientationCodes.split('\\');
      if (parts.length === 2 && /^[APRLHF]{1,3}$/.test(parts[0].trim()) && /^[APRLHF]{1,3}$/.test(parts[1].trim())) {
        o.rowDirection = parts[0].trim();
        o.columnDirection = parts[1].trim();
      } else ctx.warn('orientation_codes_unrecognized');
    }
    if (meta.pixelSpacingCalibrationType) c.pixelSpacingCalibrationType = meta.pixelSpacingCalibrationType.trim();
    var m = meta.estimatedMagnification, sid = meta.distanceSourceToDetector, sod = meta.distanceSourceToPatient;
    if (m !== null) { if (m >= 1 && m < 4) c.estimatedRadiographicMagnificationFactor = m; else ctx.warn('estimated_magnification_invalid'); }
    if (sid !== null && sid > 0) c.distanceSourceToDetectorMm = sid;
    if (sod !== null && sod > 0) c.distanceSourceToPatientMm = sod;
  }

  // Synchronous pixel decoding of frame 1 into stored values (grey) or
  // luminance (colour), as an Int32Array of rows*columns.
  function decodePixels(job) {
    var n = job.n;
    if (job.kind === 'rle') {
      var dec = decodeRle(job.bytes, job.rows, job.cols, job.spp, job.bitsAllocated / 8);
      return job.color ? lumaFromSamples(dec, n, job.bitsAllocated, job.bitsStored, job.highBit, job.photometric, true)
        : decodeStored(dec, n, job.bitsAllocated, job.bitsStored, job.highBit, job.signed);
    }
    if (job.kind === 'jpeg_lossless') {
      var out = decodeJpegLossless(job.bytes);
      if (out.rows !== job.rows || out.cols !== job.cols) throw codecError('jpeg_dimensions_mismatch', 'The JPEG frame does not match the DICOM image size.');
      var P = out.precision;
      if (P !== job.bitsStored) job.ctx.warn('jpeg_precision_differs_from_bits_stored');
      if (job.color) return lumaFromSamples(out.samples, n, 16, P, P - 1, job.photometric, true);
      // Decoded samples are right-aligned. Unsigned data keeps all P bits;
      // signed data is two's complement in Bits Stored (PS3.5 8.2.1).
      if (!job.signed) {
        var max = 0, s = out.samples;
        for (var i = 0; i < n; i++) if (s[i] > max) max = s[i];
        if (job.bitsStored < 16 && max >= (1 << job.bitsStored)) job.ctx.warn('jpeg_values_exceed_bits_stored');
        return decodeStored(s, n, 16, 16, 15, false);
      }
      return decodeStored(out.samples, n, 16, job.bitsStored, job.bitsStored - 1, true);
    }
    // native (also encapsulated uncompressed)
    return job.color ? lumaFromSamples(job.bytes, n, job.bitsAllocated, job.bitsStored, job.highBit, job.photometric, job.planar)
      : decodeStored(job.bytes, n, job.bitsAllocated, job.bitsStored, job.highBit, job.signed);
  }

  // Display pipeline: padding, statistics, Modality (rescale), VOI (window or
  // VOI LUT) and Presentation LUT for greyscale; identity for luminance.
  function finish(job, stored, res) {
    var ctx = job.ctx, meta = job.meta, n = job.n, i;
    res.frameDecoded = 1;
    res.pixelCodec = job.pixelCodec;
    var codecNote = job.codecLabel ? job.codecLabel : '';
    if (job.frames > 1) codecNote += (codecNote ? '; ' : '') + 'frame 1 of ' + job.frames + ' used';

    if (job.color) {
      var cstats = storedStats(stored, false, 0, 0);
      res.raw16 = stored;
      res.stats = { min: cstats.min, max: cstats.max, storedMin: cstats.min, storedMax: cstats.max, count: cstats.count };
      var top = Math.pow(2, job.bitsStored);
      res.window = { center: top / 2, width: top, source: 'identity', function: 'LINEAR', functionTag: null, percentiles: null };
      res.rescale.applied = false;
      res.displayInverted = false;
      ctx.warn('colour_converted_to_luminance');
      var cgray = new Uint8ClampedArray(n);
      applyWindow(stored, cgray, top / 2, top, 'LINEAR', false);
      res.gray8 = cgray;
      res.ok = true;
      res.reason = null;
      res.message = 'Decoded ' + job.rows + 'x' + job.cols + ' ' + job.bitsAllocated + '-bit ' + job.photometric + ' image as luminance' + (codecNote ? ' (' + codecNote + ')' : '') + '.';
      return res;
    }

    var signed = job.signed, slope = job.slope, intercept = job.intercept;
    // Pixel padding (stored-value space)
    var hasPad = meta.pixelPaddingRaw !== null;
    var padLo = 0, padHi = 0;
    if (hasPad) {
      var pv = meta.pixelPaddingRaw;
      if (signed && pv >= 0x8000) pv -= 0x10000;
      padLo = padHi = pv;
      var rangeLimit = null;
      if (meta.pixelPaddingLimitRaw !== null) {
        rangeLimit = meta.pixelPaddingLimitRaw;
        if (signed && rangeLimit >= 0x8000) rangeLimit -= 0x10000;
        padLo = Math.min(pv, rangeLimit);
        padHi = Math.max(pv, rangeLimit);
      }
      res.pixelPadding = { value: pv, rangeLimit: rangeLimit, lo: padLo, hi: padHi, count: 0 };
    }

    var stats = storedStats(stored, hasPad, padLo, padHi);
    if (hasPad) res.pixelPadding.count = stats.padCount;
    if (stats.count === 0) ctx.warn('all_pixels_are_padding');

    // --- Rescale -----------------------------------------------------------
    if (meta.modalityLutSequencePresent) ctx.warn('modality_lut_sequence_ignored');
    var raw;
    var integerRescale = Number.isInteger(slope) && Number.isInteger(intercept);
    if (slope === 1 && intercept === 0) {
      raw = stored;
    } else if (integerRescale) {
      raw = stored;
      for (i = 0; i < n; i++) raw[i] = raw[i] * slope + intercept;
    } else {
      raw = new Float32Array(n);
      for (i = 0; i < n; i++) raw[i] = stored[i] * slope + intercept;
    }
    res.rescale.applied = job.rescalePresent;
    res.raw16 = raw;

    var rMinA = stats.min * slope + intercept, rMaxA = stats.max * slope + intercept;
    res.stats = {
      min: Math.min(rMinA, rMaxA),
      max: Math.max(rMinA, rMaxA),
      storedMin: stats.min,
      storedMax: stats.max,
      count: stats.count
    };

    // --- Presentation LUT Shape ---------------------------------------------
    // PS3.3 C.8.11.3 / C.7.6.1: INVERSE "shall be used if MONOCHROME1" and
    // IDENTITY if MONOCHROME2, i.e. both attributes describe the SAME single
    // inversion. The display is inverted once when either calls for it (never
    // twice); a disagreement is reported.
    var mono1 = job.photometric === 'MONOCHROME1', plut = meta.presentationLutShape, invert = mono1;
    if (plut === 'INVERSE' && !mono1) { invert = true; ctx.warn('presentation_lut_inverse_applied_to_monochrome2'); }
    else if (plut === 'IDENTITY' && mono1) ctx.warn('presentation_lut_identity_ignored_for_monochrome1');
    else if (plut !== null && plut !== 'IDENTITY' && plut !== 'INVERSE') ctx.warn('presentation_lut_shape_unknown_ignored');
    res.presentationLutShape = plut;
    res.displayInverted = invert;

    // --- Window / VOI LUT ------------------------------------------------------
    var fnTag = meta.voiLutFunction;
    var fn = 'LINEAR';
    if (fnTag === 'LINEAR_EXACT') fn = 'LINEAR_EXACT';
    else if (fnTag === 'SIGMOID') { ctx.warn('sigmoid_voi_lut_function_unsupported_using_linear'); }
    else if (fnTag !== null && fnTag !== '' && fnTag !== 'LINEAR') { ctx.warn('voi_lut_function_unknown_using_linear'); }

    var center = meta.windowCenter, width = meta.windowWidth;
    var windowSource = 'tag';
    var minWidth = fn === 'LINEAR_EXACT' ? 0 : 1;
    var haveTagWindow = center !== null && width !== null && isFinite(center) && isFinite(width);
    if (haveTagWindow && !(width >= minWidth && width > 0)) {
      ctx.warn('window_width_invalid_using_auto_window');
      haveTagWindow = false;
    }
    var gray = new Uint8ClampedArray(n);
    var voiLut = null;
    if (!haveTagWindow && meta.voiLut) {
      voiLut = buildVoiLut(job.r, meta.voiLut, signed || (job.rescalePresent && Math.min(rMinA, rMaxA) < 0), ctx);
    }
    if (voiLut) {
      if ((center !== null) !== (width !== null)) ctx.warn('window_center_width_incomplete');
      res.window = {
        center: null, width: null, source: 'voi_lut_sequence', function: 'LUT', functionTag: fnTag, percentiles: null,
        lut: { entries: voiLut.entries, firstValueMapped: voiLut.first, bitsPerEntry: voiLut.bits }
      };
      applyVoiLut(raw, gray, voiLut, invert);
    } else {
      if (!haveTagWindow) {
        if ((center !== null) !== (width !== null)) ctx.warn('window_center_width_incomplete');
        if (meta.voiLutSequencePresent) ctx.warn('voi_lut_sequence_ignored');
        windowSource = 'auto_percentile';
        var loS = histPercentile(stats, job.percentiles[0]);
        var hiS = histPercentile(stats, job.percentiles[1]);
        var loR = loS * slope + intercept, hiR = hiS * slope + intercept;
        if (loR > hiR) { var tmp = loR; loR = hiR; hiR = tmp; }
        center = (loR + hiR) / 2;
        width = (hiR - loR) + 1;
        fn = 'LINEAR';
      } else if (meta.voiLutSequencePresent) {
        ctx.warn('voi_lut_sequence_ignored_window_tag_used');
      }
      res.window = {
        center: center,
        width: width,
        source: windowSource,
        function: fn,
        functionTag: fnTag,
        percentiles: windowSource === 'auto_percentile' ? [job.percentiles[0], job.percentiles[1]] : null
      };
      applyWindow(raw, gray, center, width, fn, invert);
    }
    res.gray8 = gray;

    res.ok = true;
    res.reason = null;
    res.message = 'Decoded ' + job.rows + 'x' + job.cols + ' ' + job.bitsAllocated + '-bit ' + job.photometric + ' image' + (codecNote ? ' (' + codecNote + ')' : '') + '.';
    return res;
  }

  var api = {
    decodeRadiograph: decodeRadiograph,
    decodeRadiographAsync: decodeRadiographAsync,
    version: VERSION,
    // What each entry point can decode (transfer syntax UIDs).
    capabilities: {
      sync: [TS_IMPLICIT_LE, TS_EXPLICIT_LE, TS_ENCAPSULATED_UNCOMPRESSED_LE, TS_RLE, '1.2.840.10008.1.2.4.57', '1.2.840.10008.1.2.4.70'],
      asyncOnly: [TS_DEFLATED_LE, '1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.51']
    },
    // exposed for tests / diagnostics
    _internal: {
      histPercentile: histPercentile, applyWindow: applyWindow, decodeJpegLossless: decodeJpegLossless,
      decodeRle: decodeRle, jpegFrameHeader: jpegFrameHeader, classifyTS: classifyTS
    }
  };

  if (typeof window !== 'undefined') { window.__SPINE_DICOM__ = api; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();
