  function percentile(values, q){
    if (!values.length) return 0;
    const copy = Array.from(values).filter(Number.isFinite).sort((a,b)=>a-b);
    if (!copy.length) return 0;
    const index = clampValue((copy.length - 1) * q, 0, copy.length - 1);
    const lower = Math.floor(index), upper = Math.ceil(index);
    if (lower === upper) return copy[lower];
    return copy[lower] + (copy[upper] - copy[lower]) * (index - lower);
  }

  const RASTER_LIMITS = Object.freeze({
    maxFileBytes: 64 * 1024 * 1024,
    maxMetadataBytes: 4 * 1024 * 1024,
    maxSourceDimension: 20000,
    maxSourcePixels: 80000000,
    maxDecodeWidth: 2048,
    maxDecodeHeight: 3072
  });

  const bytesEqual = (bytes, offset, expected) => expected.every((value, index) => bytes[offset + index] === value);
  const asciiAt = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const u16be = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
  const u24le = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  const u32be = (bytes, offset) => ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
  const u32le = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] * 0x1000000)) >>> 0;

  // EXIF Orientation (tag 0x0112) from an APP1 TIFF block, or 0 when absent.
  // Phone photographs of a film are stored sideways and flagged 6 or 8.
  function exifOrientation(bytes, tiff, end){
    if(tiff + 8 > end) return 0;
    const le = bytes[tiff] === 0x49 && bytes[tiff+1] === 0x49;
    if(!le && !(bytes[tiff] === 0x4d && bytes[tiff+1] === 0x4d)) return 0;
    const u16 = offset => le ? (bytes[offset] | (bytes[offset+1] << 8)) : u16be(bytes, offset);
    if(u16(tiff+2) !== 42) return 0;
    const ifd = tiff + (le ? u32le(bytes, tiff+4) : u32be(bytes, tiff+4));
    if(ifd + 2 > end) return 0;
    for(let i=0, count=u16(ifd); i<count; i++){
      const entry = ifd + 2 + i*12;
      if(entry + 12 > end) break;
      if(u16(entry) === 0x0112){ const value = u16(entry+8); return value >= 1 && value <= 8 ? value : 0; }
    }
    return 0;
  }

  async function readRasterDimensions(file){
    const byteCount = Math.min(file.size, RASTER_LIMITS.maxMetadataBytes);
    const bytes = new Uint8Array(await file.slice(0, byteCount).arrayBuffer());
    if(bytes.length < 12) throw new Error('The raster header is incomplete.');

    const pngSignature = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
    if(bytes.length >= 24 && bytesEqual(bytes, 0, pngSignature) && asciiAt(bytes, 12, 4) === 'IHDR'){
      return { format:'png', width:u32be(bytes,16), height:u32be(bytes,20) };
    }

    if(bytes[0] === 0xff && bytes[1] === 0xd8){
      const sofMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
      let offset = 2, orientation = 0;
      while(offset + 9 <= bytes.length){
        while(offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
        while(offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if(offset >= bytes.length) break;
        const marker = bytes[offset++];
        if(marker === 0xd9 || marker === 0xda) break;
        if(marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if(offset + 2 > bytes.length) break;
        const segmentLength = u16be(bytes, offset);
        if(segmentLength < 2 || offset + segmentLength > bytes.length) break;
        if(marker === 0xe1 && !orientation && segmentLength >= 16 && asciiAt(bytes, offset+2, 6) === 'Exif\0\0'){
          orientation = exifOrientation(bytes, offset+8, offset+segmentLength);
        }
        if(sofMarkers.has(marker) && segmentLength >= 7){
          const stored = { width:u16be(bytes,offset+5), height:u16be(bytes,offset+3) };
          // Orientations 5-8 transpose the stored raster. The browser decodes it
          // upright, so the displayed (swapped) size is what must be requested;
          // asking for the stored box squashed the spine anisotropically.
          const transposed = orientation >= 5 && orientation <= 8;
          return { format:'jpeg', width: transposed ? stored.height : stored.width, height: transposed ? stored.width : stored.height, orientation: orientation || 1 };
        }
        offset += segmentLength;
      }
      throw new Error('JPEG dimensions were not found inside the bounded metadata window.');
    }

    if(asciiAt(bytes,0,4) === 'RIFF' && asciiAt(bytes,8,4) === 'WEBP'){
      let offset = 12;
      while(offset + 8 <= bytes.length){
        const chunk = asciiAt(bytes,offset,4);
        const chunkSize = u32le(bytes,offset+4);
        const payload = offset + 8;
        if(chunk === 'VP8X' && payload + 10 <= bytes.length){
          return { format:'webp', width:1+u24le(bytes,payload+4), height:1+u24le(bytes,payload+7) };
        }
        if(chunk === 'VP8 ' && payload + 10 <= bytes.length
            && bytes[payload+3] === 0x9d && bytes[payload+4] === 0x01 && bytes[payload+5] === 0x2a){
          return {
            format:'webp',
            width:u16be(new Uint8Array([bytes[payload+7],bytes[payload+6]]),0)&0x3fff,
            height:u16be(new Uint8Array([bytes[payload+9],bytes[payload+8]]),0)&0x3fff
          };
        }
        if(chunk === 'VP8L' && payload + 5 <= bytes.length && bytes[payload] === 0x2f){
          const b1=bytes[payload+1],b2=bytes[payload+2],b3=bytes[payload+3],b4=bytes[payload+4];
          return { format:'webp', width:1+(b1|((b2&0x3f)<<8)), height:1+((b2>>6)|(b3<<2)|((b4&0x0f)<<10)) };
        }
        const next = payload + chunkSize + (chunkSize & 1);
        if(next <= offset || next > bytes.length) break;
        offset = next;
      }
      throw new Error('WebP dimensions were not found inside the bounded metadata window.');
    }
    throw new Error('The selected file is not a recognized PNG, JPEG, or WebP raster.');
  }

  // DICOM radiographs are decoded by the embedded parser (window.__SPINE_DICOM__)
  // through its asynchronous entry point: uncompressed, RLE and JPEG Lossless
  // locally, Deflated and 8-bit lossy JPEG through the browser's own decoders.
  // VOI window / LUT and MONOCHROME1 are applied, a multi-frame object uses
  // frame 1 and colour is converted to luminance, each with a warning. JPEG
  // 2000, JPEG-LS and other unsupported encodings fail closed; the reason is
  // turned into a plain-language message with re-export advice
  // (plainDicomFailure). Spacing, view, orientation and magnification header
  // values are kept for the app; identity tags are never read.
  const isDicomFile = file => {
    const type = (file?.type || '').toLowerCase();
    return type === 'application/dicom' || /\.(dcm|dicom)$/i.test(file?.name || '');
  };
  // One decode per selected File. Selecting, staging and running used to decode
  // every DICOM again each time (seven full decodes for one pair); only the
  // 8-bit display raster and header summary are kept, not the decoder's 16-bit
  // working arrays. A replaced or cleared File simply drops out of the map.
  const dicomDecodeCache = new WeakMap();
  async function dicomImageFromFile(file){
    const decoder = window.__SPINE_DICOM__;
    if (!decoder || typeof decoder.decodeRadiograph !== 'function') throw new Error('DICOM decoding is not available in this build.');
    let pending = dicomDecodeCache.get(file);
    if (!pending) {
      // The intake's check of the same File may already be decoding it
      // (decodeImagingDicom, page scope, same decoder and limits): join that
      // decode rather than start a second one.
      const shared = typeof decodeImagingDicom === 'function' ? decodeImagingDicom(file) : null;
      // The asynchronous entry point accepts everything the synchronous one
      // does, plus Deflated and 8-bit lossy JPEG files through browser built-ins.
      const decode = typeof decoder.decodeRadiographAsync === 'function' ? decoder.decodeRadiographAsync : decoder.decodeRadiograph;
      pending = (shared || file.arrayBuffer().then(buffer => decode.call(decoder, buffer, { maxBytes: RASTER_LIMITS.maxFileBytes, maxPixels: RASTER_LIMITS.maxSourcePixels }))).then(dicomCacheEntry);
      dicomDecodeCache.set(file, pending);
      // A failure is not remembered, so a retry decodes afresh.
      pending.catch(() => { if (dicomDecodeCache.get(file) === pending) dicomDecodeCache.delete(file); });
    }
    const cached = await pending;
    const { width, height, gray } = cached;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) { rgba[p] = rgba[p+1] = rgba[p+2] = gray[i]; rgba[p+3] = 255; }
    // Each raster gets its own header summary: spacingApplied is written onto it.
    return { imageData: new ImageData(rgba, width, height), width, height, dicom: { ...cached.dicom, warnings: cached.dicom.warnings.slice() } };
  }
  // The decoder's result reduced to what is cached per File: the 8-bit
  // display raster and a non-identifying header summary. A failed decode
  // throws with plain-language text.
  function dicomCacheEntry(decoded){
    if (!decoded.ok) {
      // The reason code and the decoder's technical text stay on the error
      // for the record; the message is what a clinician can act on.
      const error = new Error(plainDicomFailure(decoded));
      error.dicomReason = decoded.reason || 'decode_failed';
      error.dicomDetail = decoded.message || '';
      throw error;
    }
    // A decode without a display raster of the stated size, or larger than
    // this module's limits, is refused rather than drawn.
    if (!(Number.isInteger(decoded.columns) && Number.isInteger(decoded.rows) && decoded.columns > 0 && decoded.rows > 0)
      || !(decoded.columns * decoded.rows <= RASTER_LIMITS.maxSourcePixels)
      || !decoded.gray8 || decoded.gray8.length !== decoded.columns * decoded.rows) {
      const invalid = { ok: false, reason: decoded.columns * decoded.rows > RASTER_LIMITS.maxSourcePixels ? 'too_large' : 'dimensions_invalid' };
      const error = new Error(plainDicomFailure(invalid));
      error.dicomReason = invalid.reason;
      error.dicomDetail = 'decoded raster missing or inconsistent with its dimensions';
      throw error;
    }
    const spacing = decoded.pixelSpacingMm && Number.isFinite(decoded.pixelSpacingMm.row) && Number.isFinite(decoded.pixelSpacingMm.col)
      ? { row: decoded.pixelSpacingMm.row, col: decoded.pixelSpacingMm.col, source: decoded.pixelSpacingMm.source } : null;
    const orientation = decoded.orientation || {}, calibration = decoded.calibration || {};
    return {
      width: decoded.columns, height: decoded.rows, gray: decoded.gray8,
      dicom: {
        transferSyntaxUID: decoded.transferSyntaxUID, modality: decoded.modality || null, photometric: decoded.photometric,
        bitsStored: decoded.bitsStored, pixelSpacingMm: spacing,
        window: decoded.window ? { center: decoded.window.center, width: decoded.window.width, source: decoded.window.source } : null,
        warnings: Array.isArray(decoded.warnings) ? decoded.warnings.slice(0, 8) : [],
        pixelCodec: decoded.pixelCodec || null,
        numberOfFrames: Number.isFinite(decoded.numberOfFrames) ? decoded.numberOfFrames : null,
        displayInverted: typeof decoded.displayInverted === 'boolean' ? decoded.displayInverted : null,
        // Non-identifying acquisition geometry (PS3.3 DX/CR): the app uses
        // it for laterality, lateral orientation, slot checks and
        // magnification-corrected spacing.
        viewPosition: orientation.viewPosition || null,
        orientation: { rowDirection: orientation.rowDirection || null, columnDirection: orientation.columnDirection || null, imageLaterality: orientation.imageLaterality || null },
        calibration: {
          pixelSpacingCalibrationType: calibration.pixelSpacingCalibrationType || null,
          estimatedRadiographicMagnificationFactor: Number.isFinite(calibration.estimatedRadiographicMagnificationFactor) ? calibration.estimatedRadiographicMagnificationFactor : null,
          distanceSourceToDetectorMm: Number.isFinite(calibration.distanceSourceToDetectorMm) ? calibration.distanceSourceToDetectorMm : null,
          distanceSourceToPatientMm: Number.isFinite(calibration.distanceSourceToPatientMm) ? calibration.distanceSourceToPatientMm : null
        },
        identityTagsRead: Boolean(decoded.privacy && decoded.privacy.identityTagsRead)
      }
    };
  }
  // The intake decodes each DICOM once when it is chosen (decodability, header
  // summary, thumbnail) with the same decoder and limits. It hands that result
  // over here so staging and the run reuse it instead of decoding the file a
  // second time. Only a successful decode inside this module's own limits is
  // taken; anything else is decoded here as before and fails closed as before.
  function primeDicomDecode(file, decoded){
    if (!file || typeof file !== 'object' || !decoded || decoded.ok !== true) return false;
    if (dicomDecodeCache.has(file)) return true;
    if (!(file.size <= RASTER_LIMITS.maxFileBytes)) return false;
    let entry;
    try { entry = dicomCacheEntry(decoded); } catch (_) { return false; }
    dicomDecodeCache.set(file, Promise.resolve(entry));
    return true;
  }
  // A File the intake re-wrapped (same bytes, neutral name) shares the decode.
  function shareDicomDecode(from, to){
    const pending = from && typeof from === 'object' ? dicomDecodeCache.get(from) : null;
    if (!pending || !to || typeof to !== 'object' || to === from) return false;
    if (!dicomDecodeCache.has(to)) dicomDecodeCache.set(to, pending);
    return true;
  }

  /* Per-file view choices made on the review canvas. Rotation and mirroring are
     applied to the decoded pixels before anything else, so the analysis, the
     neural input and every landmark share the re-oriented frame; "full frame"
     switches the automatic exposed-field crop off for a film it got wrong. */
  const rasterViewState = new WeakMap(), rasterFileTokens = new WeakMap(), rasterViewCache = new WeakMap();
  const RASTER_VIEW_LONG_SIDE = 2048;
  const rasterOptionsFor = file => ({ rotate:0, flip:false, fullFrame:false, ...((file && rasterViewState.get(file)) || {}) });
  const rasterOptionsKey = options => `${options.rotate}|${options.flip ? 1 : 0}|${options.fullFrame ? 1 : 0}`;
  function setRasterOptions(file, patch){
    if (!file || typeof file !== 'object') return null;
    const next = { ...rasterOptionsFor(file), ...patch };
    next.rotate = ((Math.round(next.rotate / 90) * 90) % 360 + 360) % 360;
    rasterViewState.set(file, next);
    return next;
  }
  // Identity of the File a raster came from, without the raster holding the File.
  function rasterFileToken(file){
    if (!file || typeof file !== 'object') return null;
    let token = rasterFileTokens.get(file);
    if (!token) { token = {}; rasterFileTokens.set(file, token); }
    return token;
  }
  // Affine map (canvas setTransform order) from decoded pixels to the oriented
  // frame: mirror first, then rotate clockwise.
  function orientTransform(options, w, h){
    const r = options.rotate, f = options.flip ? -1 : 1, fx = options.flip ? w : 0;
    const [a,b,c,d,e,g] = r === 90 ? [0,1,-1,0,h,0] : r === 180 ? [-1,0,0,-1,w,h] : r === 270 ? [0,-1,1,0,0,w] : [1,0,0,1,0,0];
    return { matrix: [a*f, b*f, c, d, a*fx+e, b*fx+g], width: r % 180 ? h : w, height: r % 180 ? w : h };
  }
  const applyAffine = (m, p) => ({ x: m[0]*p.x + m[2]*p.y + m[4], y: m[1]*p.x + m[3]*p.y + m[5] });
  function invertAffine(m){
    const det = m[0]*m[3] - m[1]*m[2];
    return [m[3]/det, -m[1]/det, -m[2]/det, m[0]/det, (m[2]*m[5] - m[3]*m[4])/det, (m[1]*m[4] - m[0]*m[5])/det];
  }
  // Carries an analysis-frame point of one raster into another raster of the
  // same file through the shared decoded-pixel frame.
  function mapRasterPoint(point, from, to){
    const a = from && from.frame, b = to && to.frame;
    if (!point || !a || !b || a.decodedWidth !== b.decodedWidth || a.decodedHeight !== b.decodedHeight) return null;
    const oriented = { x: point.x / a.zoomX + a.region.sx, y: point.y / a.zoomY + a.region.sy };
    const decoded = applyAffine(invertAffine(a.matrix), oriented);
    const next = applyAffine(b.matrix, decoded);
    return { x: (next.x - b.region.sx) * b.zoomX, y: (next.y - b.region.sy) * b.zoomY };
  }

  async function rasterFromFile(file, options){
    if (!file) throw new Error('No raster file is available.');
    const type = (file.type || '').toLowerCase();
    const dicom = isDicomFile(file);
    const raster = dicom || type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name || '');
    if (!raster) throw new Error('The selected file is not a browser-decodable PNG, JPEG, WebP, or DICOM image.');
    if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('The selected raster is empty.');
    if (file.size > RASTER_LIMITS.maxFileBytes) throw new Error('The selected raster exceeds the 64 MiB local-analysis limit.');
    if (!('createImageBitmap' in window)) throw new Error('This browser cannot perform bounded local raster decoding.');

    const wantModelInput = Boolean(options && options.modelInput);
    const dicomImage = dicom ? await dicomImageFromFile(file) : null;
    const metadata = dicomImage ? { width: dicomImage.width, height: dicomImage.height } : await readRasterDimensions(file);
    let sourceWidth = metadata.width, sourceHeight = metadata.height;
    if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
      throw new Error('The image has invalid dimensions.');
    }
    if (sourceWidth > RASTER_LIMITS.maxSourceDimension || sourceHeight > RASTER_LIMITS.maxSourceDimension
        || sourceWidth * sourceHeight > RASTER_LIMITS.maxSourcePixels) {
      throw new Error('The raster dimensions exceed the bounded local-analysis pixel budget.');
    }

    const decodeBox = () => {
      const decodeScale = Math.min(1, RASTER_LIMITS.maxDecodeWidth / sourceWidth, RASTER_LIMITS.maxDecodeHeight / sourceHeight);
      return [Math.max(1, Math.round(sourceWidth * decodeScale)), Math.max(1, Math.round(sourceHeight * decodeScale))];
    };
    let [requestedWidth, requestedHeight] = decodeBox();
    // Files are decoded upright (EXIF orientation applied) with only the width
    // requested, so the height follows the image's true displayed aspect and an
    // orientation flag the header parser missed can never squash the film.
    const decode = () => dicomImage ? createImageBitmap(dicomImage.imageData, {
      resizeWidth: requestedWidth,
      resizeHeight: requestedHeight,
      resizeQuality: 'high'
    }) : createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: requestedWidth,
      resizeQuality: 'high'
    });
    let bitmap = null;
    try {
      bitmap = await decode();
      if (!dicomImage && bitmap.width && bitmap.height && Math.abs(bitmap.height / bitmap.width - requestedHeight / requestedWidth) > .02 * (requestedHeight / requestedWidth) + 2 / requestedWidth) {
        // The decoder transposed the raster (an orientation tag in a format the
        // header parser does not read): re-request the box for the swapped size.
        [sourceWidth, sourceHeight] = [sourceHeight, sourceWidth];
        [requestedWidth, requestedHeight] = decodeBox();
        if (typeof bitmap.close === 'function') bitmap.close();
        bitmap = await decode();
      }
      if (!bitmap.width || !bitmap.height
          || bitmap.width > RASTER_LIMITS.maxDecodeWidth
          || bitmap.height > RASTER_LIMITS.maxDecodeHeight
          || bitmap.width * bitmap.height > RASTER_LIMITS.maxDecodeWidth * RASTER_LIMITS.maxDecodeHeight) {
        throw new Error('The browser decoder exceeded the bounded raster allocation.');
      }
      // The user's rotate/flip is applied once, to the bounded decode.
      const viewOptions = rasterOptionsFor(file);
      const orient = orientTransform(viewOptions, bitmap.width, bitmap.height);
      let source = bitmap;
      if (viewOptions.rotate || viewOptions.flip) {
        source = document.createElement('canvas');
        source.width = orient.width; source.height = orient.height;
        const orientContext = source.getContext('2d');
        if (!orientContext) throw new Error('The local raster canvas could not be allocated.');
        orientContext.setTransform(...orient.matrix);
        orientContext.drawImage(bitmap, 0, 0);
        if (viewOptions.rotate % 180) [sourceWidth, sourceHeight] = [sourceHeight, sourceWidth];
      }
      const decodedWidth = orient.width, decodedHeight = orient.height;
      const maxWidth = 520, maxHeight = 840;

      const drawRegion = (sx, sy, sw, sh) => {
        // Never magnify beyond 3x: past that the pixels carry no new
        // information and the endplate search only gets slower.
        const zoom = Math.min(Math.min(maxWidth / sw, maxHeight / sh), 3);
        const width = Math.max(96, Math.round(sw * zoom));
        const height = Math.max(160, Math.round(sh * zoom));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if(!context) throw new Error('The local raster canvas could not be allocated.');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
        return { canvas, context, width, height, zoom };
      };

      const luminance = data => {
        const gray = new Uint8Array(data.width * data.height);
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
          gray[i] = Math.round(.2126 * data.data[p] + .7152 * data.data[p+1] + .0722 * data.data[p+2]);
        }
        return gray;
      };

      // Pass one locates the exposed field in the bounded decode. A PACS
      // screenshot otherwise spends most of the analysis budget on chrome.
      let render = drawRegion(0, 0, decodedWidth, decodedHeight);
      let probeData = render.context.getImageData(0, 0, render.width, render.height);
      const field = detectExposedField(luminance(probeData), render.width, render.height);
      const fieldArea = (field.x1 - field.x0 + 1) * (field.y1 - field.y0 + 1);
      const cropped = !viewOptions.fullFrame && field.cropped && fieldArea < render.width * render.height * .7;

      const sourcePerDecodedX = sourceWidth / decodedWidth;
      const sourcePerDecodedY = sourceHeight / decodedHeight;
      let sourceFieldWidth = sourceWidth, sourceFieldHeight = sourceHeight;
      let region = { sx: 0, sy: 0, sw: decodedWidth, sh: decodedHeight };
      if (cropped) {
        const pad = 4;
        const sx = Math.max(0, Math.floor((field.x0 - pad) / render.zoom));
        const sy = Math.max(0, Math.floor((field.y0 - pad) / render.zoom));
        const sw = Math.min(decodedWidth - sx, Math.ceil((field.x1 - field.x0 + 1 + pad * 2) / render.zoom));
        const sh = Math.min(decodedHeight - sy, Math.ceil((field.y1 - field.y0 + 1 + pad * 2) / render.zoom));
        if (sw >= 40 && sh >= 80) {
          render = drawRegion(sx, sy, sw, sh);
          probeData = render.context.getImageData(0, 0, render.width, render.height);
          sourceFieldWidth = Math.round(sw * sourcePerDecodedX);
          sourceFieldHeight = Math.round(sh * sourcePerDecodedY);
          region = { sx, sy, sw, sh };
        }
      }

      // The neural model sees exactly the region the analysis canvas shows,
      // stretched to its fixed input size, so its coordinates map back to the
      // analysis frame by a plain per-axis scale.
      let modelInput = null;
      const ai = wantModelInput ? window.__SPINE_AI__ : null;
      if (ai && ai.inputSize && ai.inputSize.width > 0 && ai.inputSize.height > 0) {
        const mw = ai.inputSize.width, mh = ai.inputSize.height;
        const modelCanvas = document.createElement('canvas');
        modelCanvas.width = mw; modelCanvas.height = mh;
        const modelContext = modelCanvas.getContext('2d', { willReadFrequently: true });
        if (modelContext) {
          modelContext.imageSmoothingEnabled = true;
          modelContext.imageSmoothingQuality = 'high';
          modelContext.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, mw, mh);
          modelInput = { canvas: modelCanvas, width: mw, height: mh, imageData: modelContext.getImageData(0, 0, mw, mh) };
        }
      }
      // A bounded higher-resolution copy of the same region lets a second pass
      // re-crop around the traced spine without re-decoding the file.
      let modelSource = null;
      if (modelInput) {
        const sourceZoom = Math.min(1, 1024 / region.sw, 2048 / region.sh);
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = Math.max(64, Math.round(region.sw * sourceZoom));
        sourceCanvas.height = Math.max(128, Math.round(region.sh * sourceZoom));
        const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
        if (sourceContext) {
          sourceContext.imageSmoothingEnabled = true;
          sourceContext.imageSmoothingQuality = 'high';
          sourceContext.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, sourceCanvas.width, sourceCanvas.height);
          modelSource = { canvas: sourceCanvas, width: sourceCanvas.width, height: sourceCanvas.height,
            perAnalysisX: sourceCanvas.width / render.width, perAnalysisY: sourceCanvas.height / render.height };
        }
      }

      // The analysis canvas stays small so the classical search keeps a sane
      // runtime, but landmarks are placed and reviewed on this bounded
      // full-resolution copy of the SAME region (long side up to 2048 decoded
      // pixels, never magnified). Both span the region exactly, so a point maps
      // between them by a plain per-axis scale; coordinates stay in the analysis
      // frame as floats and lose nothing. Cached per file for preview and run.
      let view = null;
      const viewZoom = Math.min(1, RASTER_VIEW_LONG_SIDE / Math.max(region.sw, region.sh));
      if (region.sw * viewZoom > render.width * 1.15) {
        const vw = Math.max(1, Math.round(region.sw * viewZoom)), vh = Math.max(1, Math.round(region.sh * viewZoom));
        const key = `${rasterOptionsKey(viewOptions)}|${region.sx},${region.sy},${region.sw},${region.sh}|${vw}x${vh}`;
        const cached = rasterViewCache.get(file);
        if (cached && cached.key === key) view = cached.view;
        else {
          const viewCanvas = document.createElement('canvas');
          viewCanvas.width = vw; viewCanvas.height = vh;
          const viewContext = viewCanvas.getContext('2d');
          if (viewContext) {
            viewContext.imageSmoothingEnabled = true;
            viewContext.imageSmoothingQuality = 'high';
            viewContext.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, vw, vh);
            view = { canvas: viewCanvas, width: vw, height: vh };
            rasterViewCache.set(file, { key, view });
          }
        }
      }

      return {
        canvas: render.canvas, imageData: probeData,
        width: render.width, height: render.height,
        sourceWidth, sourceHeight,
        sourceFieldWidth, sourceFieldHeight, fieldCropped: cropped,
        // Analysis pixels per original source pixel; mm/pixel conversions
        // remain correct even though decoding was bounded before drawing.
        scale: render.zoom / Math.max(sourcePerDecodedX, sourcePerDecodedY),
        modelInput, modelSource,
        dicom: dicomImage ? dicomImage.dicom : null,
        view,
        // Where this analysis frame sits in the decoded pixels, so landmarks
        // can follow a rotate, flip or crop change of the same file.
        frame: { decodedWidth: bitmap.width, decodedHeight: bitmap.height, matrix: orient.matrix,
          region: { ...region }, zoomX: render.width / region.sw, zoomY: render.height / region.sh },
        rasterOptions: { ...viewOptions }, fileToken: rasterFileToken(file)
      };
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
  }

  // Finds the span of rows/columns carrying real detail. Collimation and viewer
  // chrome only ever sit at the frame edges, so the span is trimmed inward from
  // each edge, and only across lines that look like a border: low-variance AND
  // black or burned-white (mean within 8% of either end of the 8-bit range),
  // or perfectly flat at any grey (a viewer panel). Soft tissue is mid-grey,
  // so the low-variance abdomen of a tightly collimated long film is never
  // trimmed, and the interior is never split on texture alone - cutting there
  // used to throw away the lumbar spine and pelvis (or the neck). An interior
  // gap splits the frame only when it is unmistakably empty - near-uniform,
  // black or white, and at least 5% of the frame wide - which is what
  // separates the viewports of a multi-image screenshot. The longest piece is
  // kept. Losing anatomy is the worse error, so every doubt keeps the line.
  function axisContentSpan(profile, floorRatio, means){
    const n = profile.length;
    let max = 0;
    for (let i=0;i<n;i++) if (profile[i] > max) max = profile[i];
    if (!(max > 0)) return { start: 0, end: n - 1 };
    const threshold = max * floorRatio;
    const extreme = i => !means || means[i] <= 20 || means[i] >= 235;
    const border = i => profile[i] < max * .001 || (profile[i] < threshold && extreme(i));
    let start = 0, end = n - 1;
    while (start < end && border(start)) start++;
    while (end > start && border(end)) end--;
    if (end - start < 1) return { start: 0, end: n - 1 };
    if (!means) return { start, end };
    const minGap = Math.max(3, Math.round(n * .05));
    const empty = i => profile[i] < max * .01 && extreme(i);
    let best = null, pieceStart = start;
    const close = pieceEnd => { if (pieceEnd - pieceStart >= 1 && (!best || pieceEnd - pieceStart > best.end - best.start)) best = { start: pieceStart, end: pieceEnd }; };
    for (let i=start;i<=end;){
      if (!empty(i)) { i++; continue; }
      let j = i;
      while (j <= end && empty(j)) j++;
      if (j - i >= minGap) { close(i - 1); pieceStart = j; }
      i = j;
    }
    close(end);
    return best || { start, end };
  }

  // Radiographs arrive collimated: large near-uniform borders sit outside the
  // exposed field. They flatten the display window, and the collimation edge is
  // a perfect vertical line that the paired-wall corridor scorer would happily
  // mistake for a vertebral body wall. Locate the exposed field first and keep
  // every later stage inside it. Variance is used rather than brightness so
  // both black and burned-white borders are excluded.
  // Screenshots of a PACS viewer carry a UI toolbar that spans the whole frame
  // width while the radiograph itself sits in a narrow strip. Those rows would
  // otherwise set the display window and drag the corridor bounds off the
  // anatomy, so they are trimmed before the field is measured. The guard is
  // deliberately narrow: it only engages when most rows are largely unexposed,
  // which is true of a screenshot and false of a properly exported film.
  function trimViewerChrome(raw, w, h){
    let peak = 0;
    for (let i=0;i<raw.length;i++) if (raw[i] > peak) peak = raw[i];
    const litLevel = Math.max(10, peak*.12);
    const litFraction = new Float32Array(h);
    for (let y=0;y<h;y++){
      const yw = y*w; let lit = 0;
      for (let x=0;x<w;x++) if (raw[yw+x] > litLevel) lit++;
      litFraction[y] = lit/w;
    }
    const median = percentile(Array.from(litFraction), .5);
    let top = 0, bottom = h-1;
    if (median < .6) {
      const limit = Math.floor(h*.15);
      while (top < limit && litFraction[top] > .9) top++;
      while ((h-1-bottom) < limit && litFraction[bottom] > .9) bottom--;
    }
    return { top, bottom, trimmed: top > 0 || bottom < h-1 };
  }

  function detectExposedField(raw, w, h){
    const chrome = trimViewerChrome(raw, w, h);
    const y0 = chrome.top, y1 = chrome.bottom;
    const rowsUsed = Math.max(1, y1-y0+1);
    const colSum = new Float64Array(w), colSumSq = new Float64Array(w);
    for (let y=y0;y<=y1;y++){
      const yw = y*w;
      for (let x=0;x<w;x++){ const v = raw[yw+x]; colSum[x] += v; colSumSq[x] += v*v; }
    }
    const colVar = new Float32Array(w), colMean = new Float32Array(w);
    // Column statistics cover only the untrimmed rows.
    for (let x=0;x<w;x++){ const m = colSum[x]/rowsUsed; colMean[x] = m; colVar[x] = Math.max(0, colSumSq[x]/rowsUsed - m*m); }
    const cx = axisContentSpan(colVar, .06, colMean);
    // Row statistics are taken inside the column span only. Black viewer side
    // bars inflate every row's variance in a screenshot, while a tightly
    // collimated film has no such help, so full-width rows judged the two
    // differently. Rows outside the chrome trim keep zero variance.
    const colsUsed = Math.max(1, cx.end-cx.start+1);
    const rowVar = new Float32Array(h), rowMean = new Float32Array(h);
    for (let y=y0;y<=y1;y++){
      const yw = y*w; let sum = 0, sumSq = 0;
      for (let x=cx.start;x<=cx.end;x++){ const v = raw[yw+x]; sum += v; sumSq += v*v; }
      const m = sum/colsUsed; rowMean[y] = m; rowVar[y] = Math.max(0, sumSq/colsUsed - m*m);
    }
    const cy = axisContentSpan(rowVar, .06, rowMean);
    const inset = 2;
    const box = {
      x0: clampValue(cx.start + inset, 0, w-1), x1: clampValue(cx.end - inset, 0, w-1),
      y0: clampValue(cy.start + inset, 0, h-1), y1: clampValue(cy.end - inset, 0, h-1)
    };
    // Sanity floor only. It is deliberately absolute rather than a fraction of
    // the frame: a viewer screenshot can legitimately place the radiograph in a
    // strip well under a quarter of the image width, and a proportional guard
    // would throw that correct detection away.
    if (box.x1 - box.x0 < 60 || box.y1 - box.y0 < 120) return { x0:0, y0:0, x1:w-1, y1:h-1, cropped:false };
    return { ...box, cropped: box.x0 > 0 || box.y0 > 0 || box.x1 < w-1 || box.y1 < h-1 };
  }

  // Contrast-limited adaptive histogram equalisation. A single global window
  // leaves the lumbar spine flat whenever the thorax dominates the histogram;
  // local equalisation recovers the endplate edges the tracer depends on.
  function applyClahe(gray, w, h, box, tilesX, tilesY, clipLimit){
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    if (bw < tilesX*4 || bh < tilesY*4) return gray;
    const tw = bw/tilesX, th = bh/tilesY;
    const luts = new Array(tilesX*tilesY);
    for (let ty=0; ty<tilesY; ty++){
      for (let tx=0; tx<tilesX; tx++){
        const x0 = box.x0 + Math.floor(tx*tw), x1 = box.x0 + Math.min(bw-1, Math.floor((tx+1)*tw) - 1);
        const y0 = box.y0 + Math.floor(ty*th), y1 = box.y0 + Math.min(bh-1, Math.floor((ty+1)*th) - 1);
        const hist = new Uint32Array(256);
        let count = 0;
        for (let y=y0;y<=y1;y++){ const yw=y*w; for (let x=x0;x<=x1;x++){ hist[clampValue(gray[yw+x]|0,0,255)]++; count++; } }
        if (!count) { luts[ty*tilesX+tx] = null; continue; }
        const limit = Math.max(1, Math.floor(clipLimit*count/256));
        let excess = 0;
        for (let i=0;i<256;i++) if (hist[i] > limit) { excess += hist[i]-limit; hist[i] = limit; }
        const share = Math.floor(excess/256);
        let remainder = excess - share*256;
        const lut = new Uint8Array(256);
        let cum = 0;
        for (let i=0;i<256;i++){
          let value = hist[i] + share;
          if (remainder > 0) { value++; remainder--; }
          cum += value;
          lut[i] = clampValue(Math.round(cum*255/count), 0, 255);
        }
        luts[ty*tilesX+tx] = lut;
      }
    }
    const out = new Float32Array(gray.length);
    out.set(gray);
    for (let y=box.y0; y<=box.y1; y++){
      const fy = clampValue((y-box.y0)/th - .5, 0, tilesY-1);
      const ty0 = Math.floor(fy), ty1 = Math.min(tilesY-1, ty0+1), wy = fy - ty0;
      const yw = y*w;
      for (let x=box.x0; x<=box.x1; x++){
        const fx = clampValue((x-box.x0)/tw - .5, 0, tilesX-1);
        const tx0 = Math.floor(fx), tx1 = Math.min(tilesX-1, tx0+1), wx = fx - tx0;
        const v = clampValue(gray[yw+x]|0, 0, 255);
        const a = luts[ty0*tilesX+tx0], b = luts[ty0*tilesX+tx1], c = luts[ty1*tilesX+tx0], d = luts[ty1*tilesX+tx1];
        if (!a || !b || !c || !d) continue;
        out[yw+x] = (a[v]*(1-wx) + b[v]*wx)*(1-wy) + (c[v]*(1-wx) + d[v]*wx)*wy;
      }
    }
    return out;
  }

  function grayToCanvas(gray, w, h){
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d');
    const image = context.createImageData(w, h);
    for (let i=0, p=0; i<gray.length; i++, p+=4) {
      const v = clampValue(Math.round(gray[i]), 0, 255);
      image.data[p] = v; image.data[p+1] = v; image.data[p+2] = v; image.data[p+3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  // The auto-windowed display at view resolution: the same field-windowed CLAHE
  // the analysis canvas gets, built once per view on first use and shared by
  // the preview and the run of the same file.
  function enhancedView(A){
    const view = A && A.view;
    if (!view) return A ? (A.display || A.canvas) : null;
    if (view.enhanced) return view.enhanced;
    const context = view.canvas.getContext('2d');
    if (!context) return A.display || A.canvas;
    const w = view.width, h = view.height, data = context.getImageData(0, 0, w, h).data;
    const kx = w / A.width, ky = h / A.height, c = A.content || { x0:0, y0:0, x1:A.width-1, y1:A.height-1 };
    const box = { x0: clampValue(Math.floor(c.x0*kx), 0, w-1), x1: clampValue(Math.ceil((c.x1+1)*kx)-1, 0, w-1),
      y0: clampValue(Math.floor(c.y0*ky), 0, h-1), y1: clampValue(Math.ceil((c.y1+1)*ky)-1, 0, h-1) };
    const gray = new Float32Array(w*h), histogram = new Uint32Array(256);
    for (let i=0, p=0; i<gray.length; i++, p+=4) gray[i] = Math.round(.2126*data[p] + .7152*data[p+1] + .0722*data[p+2]);
    let count = 0;
    for (let y=box.y0; y<=box.y1; y++) for (let x=box.x0, yw=y*w; x<=box.x1; x++){ histogram[gray[yw+x]]++; count++; }
    const level = q => { let seen = 0; for (let i=0;i<256;i++){ seen += histogram[i]; if (seen >= count*q) return i; } return 255; };
    const low = level(.005), high = Math.max(low + 12, level(.995));
    for (let i=0;i<gray.length;i++) gray[i] = clampValue((gray[i]-low)/(high-low), 0, 1)*255;
    view.enhanced = grayToCanvas(applyClahe(gray, w, h, box, 8, 8, 2.5), w, h);
    return view.enhanced;
  }

  /* Prior-hardware detection — BUILT AND VALIDATED, GATE CLOSED.

     Measured 2026-07-27 against four real clinical images plus synthetic
     controls: it flagged 1 of 3 films that genuinely contained instrumentation
     and false-positived on a clean synthetic spine (the bone-peak denominator
     degenerates on mostly-dark images). Intensity alone does not separate metal
     from well-exposed bone across real films.

     The result is therefore computed and exposed on the analysis object for
     future work, but never shown to the user. A flag that misses two thirds of
     real hardware is worse than none, because its ABSENCE would be read as
     confirmation that no hardware is present. Same fail-closed posture as CT.

     To revisit: this needs a trained detector, or DICOM pixel values where metal
     sits at an unambiguous HU range rather than a rescaled 8-bit raster.
  */
  const HARDWARE_DETECTION_GATE = Object.freeze({
    status: 'validated_insufficient_not_surfaced',
    truePositives: 1, testedPositives: 3, falsePositives: 1,
    reviewedOn: '2026-07-27'
  });

  /* Experimental prior-hardware flag.

     Metal implants attenuate far more than bone, so on a correctly windowed
     radiograph they sit at the very top of the intensity range in compact,
     sharply bounded regions. This looks for that signature. It is a PROMPT TO
     LOOK, not a detection: it cannot tell metal from a burned-in marker, a
     contrast column, a dense sclerotic block or a pacemaker, and it says so.
     Prior instrumentation matters twice over — clinically, and because its very
     high contrast is exactly what the corridor tracer latches onto. */
  function detectLikelyHardware(A){
    const field = A.content || { x0:0, y0:0, x1:A.width-1, y1:A.height-1 };
    const samples = [];
    for(let y=field.y0; y<=field.y1; y+=2)
      for(let x=field.x0; x<=field.x1; x+=2) samples.push(A.gray[y*A.width+x]);
    if(samples.length < 200) return { present:false };
    const bonePeak = percentile(samples, .90);
    const threshold = Math.max(238, percentile(samples, .995) * .97);
    const area = (field.x1-field.x0+1) * (field.y1-field.y0+1);

    // Scattered bright things — corner markers, laterality letters, burned-in
    // text — would wreck a global bounding box, so the image is segmented into
    // connected bright regions and each is judged on its own.
    const seen = new Uint8Array(A.width * A.height);
    const stack = [];
    let best = null;
    for(let y=field.y0; y<=field.y1; y++){
      for(let x=field.x0; x<=field.x1; x++){
        const start = y*A.width + x;
        if(seen[start] || A.gray[start] < threshold) continue;
        stack.length = 0; stack.push(start); seen[start] = 1;
        let count = 0, sum = 0, minX=x, maxX=x, minY=y, maxY=y;
        while(stack.length){
          const index = stack.pop();
          const py = (index / A.width) | 0, px = index - py*A.width;
          count++; sum += A.gray[index];
          if(px<minX) minX=px; if(px>maxX) maxX=px;
          if(py<minY) minY=py; if(py>maxY) maxY=py;
          for(const next of [index-1, index+1, index-A.width, index+A.width]){
            if(next < 0 || next >= seen.length || seen[next]) continue;
            const ny = (next / A.width) | 0, nx = next - ny*A.width;
            if(nx<field.x0 || nx>field.x1 || ny<field.y0 || ny>field.y1) continue;
            if(A.gray[next] < threshold) continue;
            seen[next] = 1; stack.push(next);
          }
        }
        if(!best || count > best.count) best = { count, mean: sum/count, minX, maxX, minY, maxY };
      }
    }
    if(!best) return { present:false, fraction:0 };

    const fraction = best.count / area;
    const boxArea = (best.maxX-best.minX+1) * (best.maxY-best.minY+1);
    const fill = best.count / Math.max(1, boxArea);
    // The decisive test: metal attenuates far more than bone, so it must be
    // clearly brighter than the bone peak. A bright structure that merely IS the
    // brightest anatomy present — a well-exposed spine — fails this and is not
    // reported, which is what separates a construct from a normal radiograph.
    const contrast = best.mean / Math.max(1, bonePeak);
    const present = best.count > 30
      && fraction > .0008 && fraction < .08
      && fill > .12
      && contrast > 1.12;
    if(!present) return { present:false, fraction:+fraction.toFixed(5), contrast:+contrast.toFixed(3) };
    return {
      present: true,
      fraction: +fraction.toFixed(5),
      contrast: +contrast.toFixed(3),
      bounds: { x0:best.minX, y0:best.minY, x1:best.maxX, y1:best.maxY },
      verticalSpanFraction: +((best.maxY-best.minY+1)/(field.y1-field.y0+1)).toFixed(3)
    };
  }

