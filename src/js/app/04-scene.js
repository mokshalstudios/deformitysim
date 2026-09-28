    /* ---------------------------------------------------------------------
       4) THREE.JS PROCEDURAL KINEMATIC CHAIN
       Positive Z rotation creates kyphosis; negative Z creates lordosis.
       Every segment is parented to the immediately inferior level, so a low
       level rotation moves every vertebra above it.
    --------------------------------------------------------------------- */
    let scene, camera, renderer, controls, worldRoot, pelvisGroup, s1Landmark;
    let sacralMorphologyRoot, pelvicIncidenceGuide, sacralReferenceSurface, pelvicIncidenceRadiusLine;
    let pelvisAnatomyLayer, pelvisReferenceLayer, siJointLayer, pelvisLigamentLayer, pelvicHardwareLayer;
    let lowerExtremityContext, inspectionRoot;
    const CAMERA_LIMITS = Object.freeze({
      near: .025, far: 320,
      minDistance: .45, spineMaxDistance: 140, fullBodyMaxDistance: 220,
      inspectionMinDistance: .16, inspectionMaxDistance: 80
    });
    let plumbLine, cogLine, svaConnector, c7Marker;
    const segmentRecords = new Map();
    const clock = new THREE.Clock();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const c7World = new THREE.Vector3();
    const s1World = new THREE.Vector3();
    const plumbTopWorld = new THREE.Vector3();
    const hipAxisWorld = new THREE.Vector3();
    const sacralBaseWorld = new THREE.Vector3();
    let targetPelvisRotation = 0;
    let targetSacralMorphologyRotation = 0;
    let targetPelvisRotationX = 0;
    let targetPelvisRotationY = 0;
    const targetPelvisPosition = new THREE.Vector3();
    const pelvisPosturePivot = new THREE.Vector3();
    const sacralMorphologyPivotAppMm = new THREE.Vector3();
    const sacralMorphologyPivotScene = new THREE.Vector3();
    const sacralReferenceRestPosition = new THREE.Vector3();
    // PI display field for the hip bones and pelvic overlays; built lazily from
    // the rest geometry the first time PI leaves the atlas value (see
    // buildPelvicIncidenceField).
    let pelvicIncidenceField = null;
    let firstTargetApplication = true;
    let highlightedLevel = null;
    let inspectionApplying = false;
    let inspectionCameraState = null;
    const inspectionRaycaster = new THREE.Raycaster();
    const inspectionPointer = new THREE.Vector2();

    const materials = {
      bone: new THREE.MeshStandardMaterial({ color: 0xd8cab7, roughness: .72, metalness: .03 }),
      boneDark: new THREE.MeshStandardMaterial({ color: 0xa99986, roughness: .78, metalness: .02 }),
      cortical: new THREE.MeshStandardMaterial({ color: 0xeadfce, roughness: .66, metalness: .02 }),
      referenceBone: new THREE.MeshStandardMaterial({ color: 0xe2d4c2, roughness: .70, metalness: .02 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x5c7892, roughness: .62, transparent: true, opacity: .82 }),
      plate: new THREE.MeshStandardMaterial({ color: 0x2f7df4, roughness: .28, metalness: .58 }),
      cage: new THREE.MeshStandardMaterial({ color: 0x2fcf91, roughness: .45, metalness: .18, emissive: 0x063b2a, emissiveIntensity: .35 }),
      graft: new THREE.MeshStandardMaterial({ color: 0xd5ad71, roughness: .95, metalness: 0, transparent: true, opacity: .78 }),
      screw: new THREE.MeshStandardMaterial({ color: 0xf06eb6, roughness: .28, metalness: .68 }),
      amber: new THREE.MeshStandardMaterial({ color: 0xf3ad26, roughness: .34, metalness: .55, emissive: 0x432300, emissiveIntensity: .25 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xaab8c8, roughness: .18, metalness: .9 }),
      motion: new THREE.MeshStandardMaterial({ color: 0x68c5d8, roughness: .24, metalness: .72 }),
      topsBoot: new THREE.MeshStandardMaterial({ color: 0xb7c0c4, roughness: .62, metalness: .04 }),
      ligamentAnterior: new THREE.MeshStandardMaterial({ color: 0xe7c86b, roughness: .86, transparent: true, opacity: .58 }),
      ligamentPosterior: new THREE.MeshStandardMaterial({ color: 0x74c7d8, roughness: .82, transparent: true, opacity: .56 }),
      ligamentInterrupted: new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: .92 }),
      siJoint: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: .72, transparent: true, opacity: .42, side: THREE.DoubleSide }),
      cutSurface: new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: .82, emissive: 0x3b1e00, emissiveIntensity: .2 }),
      osteotomyEnvelope: new THREE.MeshStandardMaterial({
        color: 0xf59e0b, roughness: .66, emissive: 0x3b1e00, emissiveIntensity: .18,
        transparent: true, opacity: .30, depthWrite: false, side: THREE.DoubleSide
      }),
      canalVoid: new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: .55 }),
      decompression: new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: .85 }),
      highlight: new THREE.MeshBasicMaterial({ color: 0x60a5fa, wireframe: true, transparent: true, opacity: .62 }),
      degenerativeDisc: new THREE.MeshStandardMaterial({ color: 0x6f5362, roughness: .78, transparent: true, opacity: .88 })
    };

    // Normalized, morphometry-informed proportions for an illustrative generic
    // adult skeleton. Scene units are intentionally not patient dimensions.
    const VERTEBRAL_PROFILES = Object.freeze({
      C0: Object.freeze({ kind: 'occiput', height: .86, width: 1.48, depth: 1.72 }),
      C1: Object.freeze({ kind: 'atlas', height: .62, width: 1.12, depth: 1.02 }),
      C2: Object.freeze({ kind: 'axis', height: .72, width: .98, depth: .86 }),
      C3: Object.freeze({ kind: 'subaxial', height: .64, width: .84, depth: .74 }),
      C4: Object.freeze({ kind: 'subaxial', height: .65, width: .87, depth: .76 }),
      C5: Object.freeze({ kind: 'subaxial', height: .67, width: .90, depth: .79 }),
      C6: Object.freeze({ kind: 'subaxial', height: .69, width: .94, depth: .82 }),
      C7: Object.freeze({ kind: 'subaxial', height: .72, width: .99, depth: .87 }),
      T1: Object.freeze({ kind: 'thoracic', zone: 'upper', height: .78, width: 1.05, depth: .94 }),
      T2: Object.freeze({ kind: 'thoracic', zone: 'upper', height: .79, width: 1.07, depth: .96 }),
      T3: Object.freeze({ kind: 'thoracic', zone: 'upper', height: .80, width: 1.09, depth: .98 }),
      T4: Object.freeze({ kind: 'thoracic', zone: 'upper', height: .82, width: 1.11, depth: 1.00 }),
      T5: Object.freeze({ kind: 'thoracic', zone: 'mid', height: .84, width: 1.14, depth: 1.02 }),
      T6: Object.freeze({ kind: 'thoracic', zone: 'mid', height: .85, width: 1.17, depth: 1.04 }),
      T7: Object.freeze({ kind: 'thoracic', zone: 'mid', height: .87, width: 1.20, depth: 1.07 }),
      T8: Object.freeze({ kind: 'thoracic', zone: 'mid', height: .89, width: 1.23, depth: 1.09 }),
      T9: Object.freeze({ kind: 'thoracic', zone: 'mid', height: .91, width: 1.26, depth: 1.11 }),
      T10: Object.freeze({ kind: 'thoracic', zone: 'lower', height: .93, width: 1.29, depth: 1.14 }),
      T11: Object.freeze({ kind: 'thoracic', zone: 'lower', height: .95, width: 1.32, depth: 1.16 }),
      T12: Object.freeze({ kind: 'thoracic', zone: 'lower', height: .97, width: 1.35, depth: 1.19 }),
      L1: Object.freeze({ kind: 'lumbar', height: 1.02, width: 1.42, depth: 1.25 }),
      L2: Object.freeze({ kind: 'lumbar', height: 1.06, width: 1.49, depth: 1.31 }),
      L3: Object.freeze({ kind: 'lumbar', height: 1.10, width: 1.56, depth: 1.37 }),
      L4: Object.freeze({ kind: 'lumbar', height: 1.14, width: 1.63, depth: 1.43 }),
      L5: Object.freeze({ kind: 'lumbar', height: 1.10, width: 1.69, depth: 1.49 })
    });

    // Each regional map sums to one. C1-C2 and C7-T1 are intentionally zero
    // because the displayed cervical input uses a C2-C7 visual convention.
    // TK is the T4-T12 Cobb angle (engine v0.23), so the thoracic change from
    // the reference pose is distributed over T4-T5..T11-T12 only and T1-T4
    // keeps its upper-thoracic reference pose. A measured T4-T12 TK is then
    // posed at full magnitude instead of about 82% of it (v1 spread it T1-T12).
    const CURVE_DISTRIBUTION = Object.freeze({
      id: 'illustrative-sagittal-distribution-v2',
      validationStatus: 'Visualization profile; not a patient measurement',
      cervical: Object.freeze({ 'C0-C1': 0, 'C1-C2': 0, 'C2-C3': .16, 'C3-C4': .22, 'C4-C5': .24, 'C5-C6': .22, 'C6-C7': .16, 'C7-T1': 0 }),
      thoracic: Object.freeze({ 'T1-T2': 0, 'T2-T3': 0, 'T3-T4': 0, 'T4-T5': .10828, 'T5-T6': .127388, 'T6-T7': .146497, 'T7-T8': .152866, 'T8-T9': .146497, 'T9-T10': .127388, 'T10-T11': .10828, 'T11-T12': .082804, 'T12-L1': 0 }),
      lumbar: Object.freeze({ 'L1-L2': .08, 'L2-L3': .12, 'L3-L4': .20, 'L4-L5': .27, 'L5-S1': .33 })
    });

    function profileFor(level) {
      return VERTEBRAL_PROFILES[level.superior] || VERTEBRAL_PROFILES.C7;
    }

    function mesh(geometry, material, name) {
      const value = new THREE.Mesh(geometry, material);
      value.name = name;
      value.castShadow = false;
      value.receiveShadow = false;
      return value;
    }

    const referenceGeometryCache = new Map();
    const topsPostDecompressionGeometryCache = new Map();
    const referenceAtlasDiagnostics = { decoded: new Set(), failures: new Map() };
    const lowerLimbGeometryCache = new Map();
    const lowerLimbAtlasDiagnostics = { decoded: new Set(), failures: new Map() };

    function sharedReferenceScale() {
      const sideAnchors = ['left', 'right'].map(side => LOWER_LIMB_ATLAS_DATA.manifest.anchors?.[side]);
      const femurLengths = sideAnchors.map(anchors => anchors
        ? new THREE.Vector3().fromArray(anchors.hip).distanceTo(new THREE.Vector3().fromArray(anchors.knee))
        : NaN);
      if (femurLengths.every(length => Number.isFinite(length) && length >= 300 && length <= 600)) {
        return 5.68 / ((femurLengths[0] + femurLengths[1]) * .5);
      }
      return 0.012984923602214081;
    }

    // Every CT surface is decoded in the source subject's single app-mm frame.
    // A single uniform display scale preserves skull, condyle, vertebral, sacral,
    // pelvic and proximal-femoral proportions. Individual bones are never fitted.
    const REFERENCE_MM_TO_SCENE = sharedReferenceScale();

    function sourceBoundedProceduralProfile(level) {
      const nominal = { ...profileFor(level) };
      const bounds = referenceBoundsFor(level.superior);
      if (!bounds) return nominal;
      const sourceSize = bounds.size.clone().multiplyScalar(REFERENCE_MM_TO_SCENE);
      // The semantic mesh spans about 1.55 profile-widths AP and 1.45
      // profile-depths ML once its posterior and transverse processes are added.
      // Calibrating those generating dimensions to the exact source-bone box
      // prevents an Anatomy Lab morph fallback from becoming the large generic
      // slabs previously mistaken for an ALIF implant.
      return {
        ...nominal,
        width: Math.max(.18, sourceSize.x / 1.55),
        height: Math.max(.18, sourceSize.y),
        depth: Math.max(.18, sourceSize.z / 1.45),
        sourceBoundedFallback: true,
        sourceBoundsScene: sourceSize.toArray()
      };
    }

    function referenceBoundsFor(boneKey) {
      const entry = REFERENCE_ATLAS_DATA.bones?.[boneKey];
      const boundsMin = entry?.bboxMin || entry?.boundsMin;
      const boundsMax = entry?.bboxMax || entry?.boundsMax;
      if (!Array.isArray(boundsMin) || !Array.isArray(boundsMax)) return null;
      const min = new THREE.Vector3().fromArray(boundsMin);
      const max = new THREE.Vector3().fromArray(boundsMax);
      return {
        min, max,
        center: min.clone().add(max).multiplyScalar(.5),
        size: max.clone().sub(min)
      };
    }

    function referenceAnchorFor(boneKey) {
      return referenceBoundsFor(boneKey)?.center || null;
    }

    // Anterior-central endplate / articular proxies extracted from this exact
    // s1369 surface set. These are kinematic display pivots, not validated
    // patient landmarks or subject-matched disc segmentations.
    const MOTION_SEGMENT_PIVOTS_APP_MM = Object.freeze({
      'C0-C1': Object.freeze([-59.2711, 549.3422, 3.2466]),
      'C1-C2': Object.freeze([-61.3926, 537.1788, -1.1244]),
      'C2-C3': Object.freeze([-55.3137, 523.4318, 4.0742]),
      'C3-C4': Object.freeze([-47.8390, 509.8597, 5.1874]),
      'C4-C5': Object.freeze([-41.2248, 497.8640, 4.0874]),
      'C5-C6': Object.freeze([-34.0531, 486.6683, 3.0004]),
      'C6-C7': Object.freeze([-25.5913, 474.4067, 3.9297]),
      'C7-T1': Object.freeze([-15.9520, 462.3354, 2.7005]),
      'T1-T2': Object.freeze([-5.1823, 445.8245, -0.0357]),
      'T2-T3': Object.freeze([2.0048, 427.8382, -0.1724]),
      'T3-T4': Object.freeze([6.6906, 409.3489, -1.4825]),
      'T4-T5': Object.freeze([8.5015, 387.3299, -3.9655]),
      'T5-T6': Object.freeze([9.8347, 366.3993, -3.7114]),
      'T6-T7': Object.freeze([10.3809, 345.7564, -2.4386]),
      'T7-T8': Object.freeze([9.1087, 323.0013, -1.6849]),
      'T8-T9': Object.freeze([9.5542, 300.3785, -0.7460]),
      'T9-T10': Object.freeze([9.0690, 277.6565, 1.2051]),
      'T10-T11': Object.freeze([4.1274, 253.5016, 4.8224]),
      'T11-T12': Object.freeze([-2.7219, 228.6779, 5.5910]),
      'T12-L1': Object.freeze([-9.8116, 203.4155, 3.6387]),
      'L1-L2': Object.freeze([-17.5227, 175.2864, 5.8901]),
      'L2-L3': Object.freeze([-30.3201, 146.4508, 3.4353]),
      'L3-L4': Object.freeze([-44.3769, 115.1009, 0.0167]),
      'L4-L5': Object.freeze([-50.1741, 79.5971, -1.6819]),
      'L5-S1': Object.freeze([-37.2506, 48.8085, -4.0048])
    });

    function motionSegmentPivotFor(levelId, fallbackBoneKey = null) {
      const value = MOTION_SEGMENT_PIVOTS_APP_MM[levelId];
      return value ? new THREE.Vector3().fromArray(value) : referenceAnchorFor(fallbackBoneKey);
    }

    function decodeAtlasBytes(encoded, label) {
      if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 12000000) {
        throw new RangeError(`${label} is missing or exceeds the per-object atlas payload guardrail.`);
      }
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }

    function decodeQuantizedAtlasGeometry(atlasData, atlasSource, cache, diagnostics, boneKey, geometryTier) {
      if (cache.has(boneKey)) return cache.get(boneKey).clone();
      const entry = atlasData.bones?.[boneKey];
      if (!entry) return null;
      try {
        const vertexCount = Number(entry.vertexCount);
        const triangleCount = Number(entry.triangleCount);
        if (!Number.isInteger(vertexCount) || vertexCount < 4 || vertexCount > 200000) throw new RangeError('invalid vertex count');
        if (!Number.isInteger(triangleCount) || triangleCount < 4 || triangleCount > 400000) throw new RangeError('invalid triangle count');
        const boundsMin = entry.bboxMin || entry.boundsMin;
        const boundsMax = entry.bboxMax || entry.boundsMax;
        if (!Array.isArray(boundsMin) || !Array.isArray(boundsMax) || boundsMin.length !== 3 || boundsMax.length !== 3) throw new TypeError('invalid source bounds');
        const positionBytes = decodeAtlasBytes(entry.positions || entry.positionsBase64 || entry.qpos, `${boneKey} positions`);
        if (positionBytes.byteLength !== vertexCount * 3 * 2) throw new RangeError('position payload length does not match manifest');
        const quantized = new Uint16Array(positionBytes.buffer, positionBytes.byteOffset, positionBytes.byteLength / 2);
        const positions = new Float32Array(vertexCount * 3);
        for (let axis = 0; axis < 3; axis += 1) {
          const low = Number(boundsMin[axis]);
          const span = Number(boundsMax[axis]) - low;
          if (!Number.isFinite(low) || !Number.isFinite(span) || span <= 0) throw new RangeError('non-finite or empty source bounds');
          for (let vertex = 0; vertex < vertexCount; vertex += 1) positions[vertex * 3 + axis] = low + quantized[vertex * 3 + axis] * span / 65535;
        }
        const indexBytes = decodeAtlasBytes(entry.index || entry.indices || entry.indexBase64, `${boneKey} indices`);
        const usesUint32 = entry.indexType === 'uint32' || entry.indexComponentType === 'uint32' || vertexCount > 65535;
        const componentBytes = usesUint32 ? 4 : 2;
        if (indexBytes.byteLength !== triangleCount * 3 * componentBytes) throw new RangeError('index payload length does not match manifest');
        const indices = usesUint32
          ? new Uint32Array(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength / 4)
          : new Uint16Array(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength / 2);
        for (let index = 0; index < indices.length; index += 1) {
          if (indices[index] >= vertexCount) throw new RangeError('triangle index exceeds vertex count');
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.userData = {
          geometryTier, boneKey,
          sourceDataset: atlasSource.dataset,
          sourceSubject: atlasSource.subject || atlasSource.referenceModel || atlasSource.subjectDescription,
          sourceLicense: atlasSource.license,
          sourceSha256: entry.sha256 || 'not-recorded'
        };
        cache.set(boneKey, geometry);
        diagnostics.decoded.add(boneKey);
        return geometry.clone();
      } catch (error) {
        diagnostics.failures.set(boneKey, error instanceof Error ? error.message : String(error));
        return null;
      }
    }

    function decodeReferenceGeometry(boneKey) {
      return decodeQuantizedAtlasGeometry(
        REFERENCE_ATLAS_DATA, REFERENCE_ATLAS_SOURCE,
        referenceGeometryCache, referenceAtlasDiagnostics,
        boneKey, 'ct_derived_reference_surface'
      );
    }

    function decodeLowerLimbGeometry(boneKey) {
      return decodeQuantizedAtlasGeometry(
        LOWER_LIMB_ATLAS_DATA, LOWER_LIMB_ATLAS_SOURCE,
        lowerLimbGeometryCache, lowerLimbAtlasDiagnostics,
        boneKey, 'bodyparts3d_reference_surface'
      );
    }

    function createReferenceSurface(boneKey, dims, levelId) {
      const layer = new THREE.Group();
      layer.name = `ctReferenceLayer:${boneKey}`;
      layer.userData = { boneKey, levelId, geometryMode: 'procedural_fallback' };
      const geometry = decodeReferenceGeometry(boneKey);
      if (!geometry?.boundingBox) return layer;
      const surface = mesh(geometry, materials.referenceBone, `ctReferenceSurface:${boneKey}`);
      const sourceAnchor = motionSegmentPivotFor(levelId, boneKey);
      const boneBboxCenter = referenceAnchorFor(boneKey);
      if (!sourceAnchor) return layer;
      surface.scale.setScalar(REFERENCE_MM_TO_SCENE);
      surface.position.copy(sourceAnchor).multiplyScalar(-REFERENCE_MM_TO_SCENE);
      surface.userData = {
        ...geometry.userData, levelId,
        normalizedForKinematicDisplay: false,
        sourceRelativeCoordinatesPreserved: true,
        sourceAnchorAppMm: sourceAnchor.toArray(),
        boneBboxCenterAppMm: boneBboxCenter?.toArray() || null,
        kinematicPivotMethod: 'source-surface anterior-central joint proxy',
        kinematicPivotValidated: false,
        millimetresToScene: REFERENCE_MM_TO_SCENE,
        uniformScaleOnly: true,
        screwPlanningValidated: false
      };
      layer.userData = {
        ...layer.userData,
        geometryMode: 'ct_reference',
        sourceAnchorAppMm: sourceAnchor.toArray(),
        millimetresToScene: REFERENCE_MM_TO_SCENE,
        independentBoneNormalization: false
      };
      layer.add(surface);
      return layer;
    }

    const TOPS_RESECTION_SOURCE_SHA256 = Object.freeze({
      L3: 'bbe0338db2b3339c6151489ce4071ab7e2c3177005715d5200598f0cd8fa53b9',
      L4: 'de229d410e502327715ef88c2715cb05260ff5383f7d384fb7dbb571c9b09089',
      L5: '4171d9db625d3714e90fc831038070c5a7d1ef600032a3d1121b2907e06e8d81'
    });

    function pointToSegmentDistanceSquared(point, start, end) {
      const segment = end.clone().sub(start);
      const denominator = segment.lengthSq();
      if (denominator < 1e-12) return point.distanceToSquared(start);
      const fraction = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / denominator, 0, 1);
      return point.distanceToSquared(start.clone().addScaledVector(segment, fraction));
    }

    function buildTopsPostDecompressionGeometry(context) {
      if (!context || !['superior', 'inferior'].includes(context.role)) return null;
      const expectedSha = TOPS_RESECTION_SOURCE_SHA256[context.boneKey];
      const entry = REFERENCE_ATLAS_DATA.bones?.[context.boneKey];
      if (!expectedSha || entry?.sha256 !== expectedSha) return null;
      const source = decodeReferenceGeometry(context.boneKey);
      const position = source?.getAttribute('position');
      const index = source?.getIndex();
      const bounds = referenceBoundsFor(context.boneKey);
      const treatedPivot = MOTION_SEGMENT_PIVOTS_APP_MM[context.treatedLevelId];
      if (!position || !index || !bounds || !treatedPivot) return null;

      const cacheKey = [
        context.boneKey, context.treatedLevelId, context.role,
        finiteOr(context.screwOuterDiameterMm, 6.5).toFixed(1), expectedSha
      ].join(':');
      if (topsPostDecompressionGeometryCache.has(cacheKey)) {
        return topsPostDecompressionGeometryCache.get(cacheKey).clone();
      }

      const screwTrajectories = [-1, 1]
        .map(side => sourceScrewTrajectoryAppMm(context.boneKey, side))
        .filter(Boolean);
      if (screwTrajectories.length !== 2) return null;

      const jointY = Number(treatedPivot[1]);
      const yMin = context.role === 'superior'
        ? jointY - bounds.size.y * .20
        : jointY - bounds.size.y * .28;
      const yMax = context.role === 'superior'
        ? jointY + bounds.size.y * .45
        : jointY + bounds.size.y * .20;
      const corridorRadiusMm = Math.max(6, finiteOr(context.screwOuterDiameterMm, 6.5) * .5 + 3);
      const corridorRadiusSq = corridorRadiusMm ** 2;
      const vertex = indexValue => new THREE.Vector3().fromBufferAttribute(position, indexValue);
      const retainedSourceIndices = [];
      let removedTriangles = 0;

      for (let offset = 0; offset < index.count; offset += 3) {
        const sourceIndices = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
        const triangle = sourceIndices.map(vertex);
        const centroid = triangle[0].clone().add(triangle[1]).add(triangle[2]).multiplyScalar(1 / 3);
        const allPosterior = triangle.every(point => (point.x - bounds.min.x) / bounds.size.x >= .60);
        const allWithinLateralResection = triangle.every(point => Math.abs(point.z - bounds.center.z) / bounds.size.z <= .38);
        const normalizedCentroidX = (centroid.x - bounds.min.x) / bounds.size.x;
        const normalizedCentroidZ = Math.abs(centroid.z - bounds.center.z) / bounds.size.z;
        const inTreatedJointWindow = centroid.y >= yMin && centroid.y <= yMax;
        const inLaminaOrFacetMask = normalizedCentroidZ <= .22
          || (normalizedCentroidX <= .84 && normalizedCentroidZ <= .34);
        const intersectsProtectedScrewCorridor = [...triangle, centroid].some(point =>
          screwTrajectories.some(trajectory =>
            pointToSegmentDistanceSquared(point, trajectory.startAppMm, trajectory.targetAppMm) <= corridorRadiusSq
          )
        );
        if (allPosterior && allWithinLateralResection && inTreatedJointWindow
          && inLaminaOrFacetMask && !intersectsProtectedScrewCorridor) {
          removedTriangles += 1;
        } else {
          retainedSourceIndices.push(...sourceIndices);
        }
      }

      const originalTriangleCount = index.count / 3;
      const retainedTriangleCount = retainedSourceIndices.length / 3;
      const retainedFraction = retainedTriangleCount / originalTriangleCount;
      if (removedTriangles < 1 || retainedFraction < .55 || retainedFraction > .98) return null;

      const remap = new Map();
      const compactPositions = [];
      const compactIndices = retainedSourceIndices.map(sourceIndex => {
        if (!remap.has(sourceIndex)) {
          remap.set(sourceIndex, remap.size);
          compactPositions.push(position.getX(sourceIndex), position.getY(sourceIndex), position.getZ(sourceIndex));
        }
        return remap.get(sourceIndex);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(compactPositions, 3));
      geometry.setIndex(compactIndices);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const sourceBox = source.boundingBox || new THREE.Box3().setFromBufferAttribute(position);
      const sourceSize = sourceBox.getSize(new THREE.Vector3());
      const derivedSize = geometry.boundingBox.getSize(new THREE.Vector3());
      const anteriorPreserved = Math.abs(geometry.boundingBox.min.x - sourceBox.min.x) <= .5;
      const ccPreserved = derivedSize.y >= sourceSize.y * .65;
      const mlPreserved = derivedSize.z >= sourceSize.z * .65;
      if (!anteriorPreserved || !ccPreserved || !mlPreserved) return null;

      geometry.userData = {
        ...source.userData,
        geometryTier: 'ct_derived_open_post_decompression_surface',
        sourceSha256: expectedSha,
        treatedLevelId: context.treatedLevelId,
        resectionRole: context.role,
        originalTriangleCount,
        retainedTriangleCount,
        removedTriangleCount: removedTriangles,
        openSurface: true,
        watertight: false,
        patientSpecificCutValidated: false,
        cutSafetyValidated: false,
        pedicleCorridorsValidated: false,
        protectedScrewCorridorRadiusMm: corridorRadiusMm,
        resectionMethod: 'source-bounded posterior triangle mask around treated joint with screw-corridor keep-outs'
      };
      topsPostDecompressionGeometryCache.set(cacheKey, geometry.clone());
      return geometry;
    }

    function createCoherentReferenceGroup(boneKeys, name) {
      const layer = new THREE.Group();
      layer.name = name;
      layer.userData = { geometryMode: 'procedural_fallback', boneKeys: [...boneKeys] };
      boneKeys.forEach(boneKey => {
        const geometry = decodeReferenceGeometry(boneKey);
        if (!geometry) return;
        const surface = mesh(geometry, materials.referenceBone, `ctReferenceSurface:${boneKey}`);
        surface.userData = {
          ...geometry.userData,
          normalizedForKinematicDisplay: false,
          sourceRelativeCoordinatesPreserved: true,
          millimetresToScene: REFERENCE_MM_TO_SCENE,
          uniformScaleOnly: true
        };
        layer.add(surface);
      });
      if (layer.children.length !== boneKeys.length) {
        layer.clear();
        return layer;
      }
      layer.scale.setScalar(REFERENCE_MM_TO_SCENE);
      layer.userData = {
        ...layer.userData,
        geometryMode: 'ct_reference',
        sourceFrameOrigin: 'sacrum_bbox_center',
        millimetresToScene: REFERENCE_MM_TO_SCENE,
        independentBoneNormalization: false
      };
      return layer;
    }

    function createLongBoneReference(boneKey, name, targetHeight) {
      const layer = new THREE.Group();
      layer.name = name;
      const geometry = decodeReferenceGeometry(boneKey);
      if (!geometry?.boundingBox) return layer;
      const surface = mesh(geometry, materials.referenceBone, `ctReferenceSurface:${boneKey}`);
      const size = geometry.boundingBox.getSize(new THREE.Vector3());
      const center = geometry.boundingBox.getCenter(new THREE.Vector3());
      const scale = REFERENCE_MM_TO_SCENE;
      surface.scale.setScalar(scale);
      surface.position.copy(center).multiplyScalar(-scale);
      surface.userData = { ...geometry.userData, normalizedForKinematicDisplay: false, uniformScaleOnly: true, fieldOfViewTruncated: true };
      layer.userData = { geometryMode: 'ct_reference', fieldOfViewTruncated: true, millimetresToScene: scale };
      layer.add(surface);
      return layer;
    }

    const LOCAL_Y_AXIS = new THREE.Vector3(0, 1, 0);
    const LOCAL_Z_AXIS = new THREE.Vector3(0, 0, 1);

    function cylinderBetween(start, end, radius, material, name, radialSegments = 10) {
      const direction = end.clone().sub(start);
      const length = Math.max(direction.length(), .001);
      const value = mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material, name);
      value.position.copy(start).add(end).multiplyScalar(.5);
      value.quaternion.setFromUnitVectors(LOCAL_Y_AXIS, direction.normalize());
      value.userData.baseAxisLengthScene = length;
      value.geometry.userData.baseAxisLengthScene = length;
      return value;
    }

    function updateCylinderMeshBetween(value, start, end) {
      if (!value?.isMesh || !start?.isVector3 || !end?.isVector3) return false;
      const direction = end.clone().sub(start);
      const length = Math.max(direction.length(), .001);
      const baseLength = Math.max(finiteOr(
        value.userData?.baseAxisLengthScene,
        finiteOr(value.geometry?.userData?.baseAxisLengthScene, length)
      ), .001);
      value.position.copy(start).add(end).multiplyScalar(.5);
      value.quaternion.setFromUnitVectors(LOCAL_Y_AXIS, direction.normalize());
      value.scale.y = length / baseLength;
      return true;
    }

    function boxBeamBetween(start, end, width, depth, material, name) {
      const direction = end.clone().sub(start);
      const length = Math.max(direction.length(), .001);
      const value = mesh(new THREE.BoxGeometry(width, length, depth), material, name);
      value.position.copy(start).add(end).multiplyScalar(.5);
      value.quaternion.setFromUnitVectors(LOCAL_Y_AXIS, direction.normalize());
      return value;
    }

    function tubeThrough(points, radius, material, name, tubularSegments = 12) {
      return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), tubularSegments, radius, 7, false), material, name);
    }

    function extrudedProfileGeometry(points, depth, bevel = .025) {
      const shape = new THREE.Shape();
      points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y));
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth, steps: 1, bevelEnabled: true, bevelSegments: 1,
        bevelSize: bevel, bevelThickness: bevel * .7
      });
      geometry.translate(0, 0, -depth * .5);
      geometry.computeVertexNormals();
      return geometry;
    }

    const DISC_MORPHOMETRY_MM = Object.freeze({
      'C2-C3': Object.freeze({ anterior: 2.9, middle: 3.2, posterior: 1.9, ap: 16, lr: 30 }),
      'C3-C4': Object.freeze({ anterior: 3.0, middle: 3.5, posterior: 2.1, ap: 16.5, lr: 31 }),
      'C4-C5': Object.freeze({ anterior: 3.2, middle: 3.8, posterior: 2.3, ap: 17, lr: 32 }),
      'C5-C6': Object.freeze({ anterior: 3.3, middle: 4.1, posterior: 2.5, ap: 17.5, lr: 33 }),
      'C6-C7': Object.freeze({ anterior: 3.4, middle: 4.0, posterior: 2.7, ap: 18, lr: 34 }),
      'C7-T1': Object.freeze({ anterior: 3.3, middle: 3.8, posterior: 2.5, ap: 19, lr: 35 }),
      'L1-L2': Object.freeze({ anterior: 5.68, middle: 6.61, posterior: 3.11, ap: 32, lr: 48 }),
      'L2-L3': Object.freeze({ anterior: 6.53, middle: 7.90, posterior: 4.02, ap: 34, lr: 51 }),
      'L3-L4': Object.freeze({ anterior: 7.72, middle: 8.83, posterior: 4.66, ap: 36, lr: 54 }),
      'L4-L5': Object.freeze({ anterior: 9.27, middle: 9.31, posterior: 4.88, ap: 38, lr: 57 }),
      'L5-S1': Object.freeze({ anterior: 10.76, middle: 8.14, posterior: 3.80, ap: 39, lr: 59 })
    });

    function discMorphometryFor(level) {
      if (DISC_MORPHOMETRY_MM[level.id]) return DISC_MORPHOMETRY_MM[level.id];
      if (level.region === 'thoracic') {
        const thoracicIndex = Math.max(0, Number(level.superior.slice(1)) - 1);
        const middle = 3.4 + thoracicIndex * .17;
        return { anterior: middle * .92, middle, posterior: middle * .78, ap: 21 + thoracicIndex * .65, lr: 35 + thoracicIndex * 1.05 };
      }
      return { anterior: 3.4, middle: 3.8, posterior: 2.5, ap: 19, lr: 35 };
    }

    function sourceLocalPoint(level, appMmPoint) {
      const pivot = motionSegmentPivotFor(level.id, level.superior) || new THREE.Vector3();
      return appMmPoint.clone().sub(pivot).multiplyScalar(REFERENCE_MM_TO_SCENE);
    }

    function createSourceJointPad(name, centerAppMm, dimensionsMm, level) {
      const pad = mesh(new THREE.SphereGeometry(.5, 18, 10), materials.disc, name);
      pad.scale.set(
        dimensionsMm.x * REFERENCE_MM_TO_SCENE,
        dimensionsMm.y * REFERENCE_MM_TO_SCENE,
        dimensionsMm.z * REFERENCE_MM_TO_SCENE
      );
      pad.position.copy(sourceLocalPoint(level, centerAppMm));
      pad.userData = {
        representation: 'source-frame articular-cartilage envelope',
        intervertebralDisc: false,
        dimensionsMm: dimensionsMm.toArray()
      };
      return pad;
    }

    const CRANIOVERTEBRAL_FACET_CENTERS_APP_MM = Object.freeze({
      'C0-C1': Object.freeze({
        right: Object.freeze([-54.338, 547.466, -21.829]),
        left: Object.freeze([-64.204, 551.218, 28.322])
      }),
      'C1-C2': Object.freeze({
        right: Object.freeze([-59.171, 534.849, -18.449]),
        left: Object.freeze([-63.614, 539.508, 16.200])
      })
    });

    function createCraniovertebralJoint(level) {
      const joint = new THREE.Group();
      const superiorBounds = referenceBoundsFor(level.superior);
      const inferiorBounds = referenceBoundsFor(level.inferior);
      if (!superiorBounds || !inferiorBounds) return joint;
      const centers = CRANIOVERTEBRAL_FACET_CENTERS_APP_MM[level.id];
      if (!centers) return joint;
      if (level.id === 'C0-C1') {
        joint.name = 'atlantoOccipitalJoint:noIntervertebralDisc';
        ['right', 'left'].forEach(label => {
          const center = new THREE.Vector3().fromArray(centers[label]);
          joint.add(createSourceJointPad(
            `atlantoOccipitalCartilage:${label}`,
            center, new THREE.Vector3(22.22, 1.0, 12.12), level
          ));
        });
      } else {
        joint.name = 'atlantoAxialJoint:noIntervertebralDisc';
        ['right', 'left'].forEach(label => {
          const center = new THREE.Vector3().fromArray(centers[label]);
          joint.add(createSourceJointPad(
            `atlantoAxialFacetCartilage:${label}`,
            center, new THREE.Vector3(15, 1.2, 12), level
          ));
        });
      }
      joint.userData = {
        intervertebralDisc: false,
        sourceFramePreserved: true,
        note: 'C0-C1 and C1-C2 are synovial articulations, not disc spaces.'
      };
      return joint;
    }

    const DISC_CONTAINMENT_MODEL = Object.freeze({
      bodyApFraction: Object.freeze([.02, .43]),
      bodyMlFraction: Object.freeze([.17, .83]),
      facingSurfaceFraction: .25,
      requestedInsetMm: .8,
      surfaceClearanceMm: .20,
      minimumLoftThicknessMm: .35,
      minimumFootprintScale: .22,
      contourSegments: 32,
      raySpanMm: 120,
      method: 'adjacent CT vertebral-body facing-patch convex intersection + inset ellipse + bidirectional surface-ray loft',
      validationStatus: 'visual containment against this processed reference atlas; not subject disc segmentation or a clinical measurement'
    });
    const SOURCE_DISC_CLEARANCE_EXCLUSIONS = Object.freeze({
      'C5-C6': 'The processed adjacent CT bone surfaces do not provide a continuous closed footprint with positive bidirectional clearance; a solid disc is withheld rather than drawn through bone.'
    });
    const APP_POSTERIOR_AXIS = new THREE.Vector3(1, 0, 0);
    const centralBodySourceCache = new Map();

    function quantileSorted(values, fraction) {
      if (!values.length) return NaN;
      const position = THREE.MathUtils.clamp(fraction, 0, 1) * (values.length - 1);
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      return THREE.MathUtils.lerp(values[lower], values[upper], position - lower);
    }

    function medianCoordinate(points, key) {
      const values = points.map(point => point[key]).sort((a, b) => a - b);
      return quantileSorted(values, .5);
    }

    function centralBodySourceData(boneKey) {
      if (centralBodySourceCache.has(boneKey)) return centralBodySourceCache.get(boneKey);
      const geometry = decodeReferenceGeometry(boneKey);
      const position = geometry?.getAttribute('position');
      if (!geometry?.boundingBox || !position) return null;
      const bounds = geometry.boundingBox;
      const size = bounds.getSize(new THREE.Vector3());
      const points = [];
      for (let index = 0; index < position.count; index += 1) {
        const point = new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
        const apFraction = size.x > 0 ? (point.x - bounds.min.x) / size.x : .5;
        const mlFraction = size.z > 0 ? (point.z - bounds.min.z) / size.z : .5;
        if (apFraction < DISC_CONTAINMENT_MODEL.bodyApFraction[0]
          || apFraction > DISC_CONTAINMENT_MODEL.bodyApFraction[1]
          || mlFraction < DISC_CONTAINMENT_MODEL.bodyMlFraction[0]
          || mlFraction > DISC_CONTAINMENT_MODEL.bodyMlFraction[1]) continue;
        points.push(point);
      }
      if (points.length < 20) return null;
      const triangleOffsets = [];
      const indices = geometry.getIndex()?.array;
      if (indices) {
        for (let cursor = 0; cursor < indices.length; cursor += 3) {
          const ax = position.getX(indices[cursor]);
          const az = position.getZ(indices[cursor]);
          const bx = position.getX(indices[cursor + 1]);
          const bz = position.getZ(indices[cursor + 1]);
          const cx = position.getX(indices[cursor + 2]);
          const cz = position.getZ(indices[cursor + 2]);
          const apFraction = size.x > 0 ? ((ax + bx + cx) / 3 - bounds.min.x) / size.x : .5;
          const mlFraction = size.z > 0 ? ((az + bz + cz) / 3 - bounds.min.z) / size.z : .5;
          if (apFraction >= 0 && apFraction <= .55 && mlFraction >= .10 && mlFraction <= .90) triangleOffsets.push(cursor);
        }
      }
      const median = new THREE.Vector3(
        medianCoordinate(points, 'x'),
        medianCoordinate(points, 'y'),
        medianCoordinate(points, 'z')
      );
      const value = Object.freeze({ geometry, points: Object.freeze(points), median, triangleOffsets: Object.freeze(triangleOffsets) });
      centralBodySourceCache.set(boneKey, value);
      return value;
    }

    function sourceDiscFrameFor(level) {
      const superior = centralBodySourceData(level.superior);
      const inferior = centralBodySourceData(level.inferior);
      const pivot = motionSegmentPivotFor(level.id, level.superior);
      if (!superior || !inferior || !pivot) return null;
      const cranial = superior.median.clone().sub(inferior.median);
      if (cranial.lengthSq() < 1e-8) return null;
      cranial.normalize();
      const posterior = APP_POSTERIOR_AXIS.clone().addScaledVector(cranial, -APP_POSTERIOR_AXIS.dot(cranial));
      if (posterior.lengthSq() < 1e-8) posterior.set(1, 0, 0);
      posterior.normalize();
      const patientLeft = posterior.clone().cross(cranial).normalize();
      const basis = new THREE.Matrix4().makeBasis(posterior, cranial, patientLeft);
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
      return { superior, inferior, pivot, posterior, cranial, patientLeft, quaternion };
    }

    function projectedFacingPatch(bodyData, frame, superiorSide) {
      const projected = bodyData.points.map(point => {
        const delta = point.clone().sub(frame.pivot);
        return {
          x: delta.dot(frame.posterior),
          y: delta.dot(frame.cranial),
          z: delta.dot(frame.patientLeft)
        };
      });
      const axial = projected.map(point => point.y).sort((a, b) => a - b);
      const threshold = quantileSorted(
        axial,
        superiorSide ? DISC_CONTAINMENT_MODEL.facingSurfaceFraction : 1 - DISC_CONTAINMENT_MODEL.facingSurfaceFraction
      );
      return projected.filter(point => superiorSide ? point.y <= threshold : point.y >= threshold);
    }

    function cross2(a, b, c) {
      return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    }

    function convexHull2(points) {
      const sorted = points.map(point => ({ x: point.x, z: point.z }))
        .sort((a, b) => a.x - b.x || a.z - b.z)
        .filter((point, index, list) => index === 0
          || Math.abs(point.x - list[index - 1].x) > 1e-6
          || Math.abs(point.z - list[index - 1].z) > 1e-6);
      if (sorted.length < 3) return [];
      const lower = [];
      sorted.forEach(point => {
        while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-7) lower.pop();
        lower.push(point);
      });
      const upper = [];
      for (let index = sorted.length - 1; index >= 0; index -= 1) {
        const point = sorted[index];
        while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-7) upper.pop();
        upper.push(point);
      }
      lower.pop(); upper.pop();
      return lower.concat(upper);
    }

    function lineIntersection2(start, end, clipStart, clipEnd) {
      const ray = { x: end.x - start.x, z: end.z - start.z };
      const edge = { x: clipEnd.x - clipStart.x, z: clipEnd.z - clipStart.z };
      const denominator = ray.x * edge.z - ray.z * edge.x;
      if (Math.abs(denominator) < 1e-9) return { ...end };
      const offset = { x: clipStart.x - start.x, z: clipStart.z - start.z };
      const fraction = (offset.x * edge.z - offset.z * edge.x) / denominator;
      return { x: start.x + ray.x * fraction, z: start.z + ray.z * fraction };
    }

    function intersectConvexPolygons(subject, clip) {
      let output = subject.map(point => ({ ...point }));
      for (let edgeIndex = 0; edgeIndex < clip.length && output.length; edgeIndex += 1) {
        const clipStart = clip[edgeIndex];
        const clipEnd = clip[(edgeIndex + 1) % clip.length];
        const input = output;
        output = [];
        let start = input[input.length - 1];
        for (const end of input) {
          const startInside = cross2(clipStart, clipEnd, start) >= -1e-7;
          const endInside = cross2(clipStart, clipEnd, end) >= -1e-7;
          if (endInside) {
            if (!startInside) output.push(lineIntersection2(start, end, clipStart, clipEnd));
            output.push(end);
          } else if (startInside) {
            output.push(lineIntersection2(start, end, clipStart, clipEnd));
          }
          start = end;
        }
      }
      return output.filter((point, index, list) => !index
        || Math.abs(point.x - list[index - 1].x) > 1e-6
        || Math.abs(point.z - list[index - 1].z) > 1e-6);
    }

    function polygonCentroid2(polygon) {
      let twiceArea = 0;
      let x = 0;
      let z = 0;
      for (let index = 0; index < polygon.length; index += 1) {
        const a = polygon[index];
        const b = polygon[(index + 1) % polygon.length];
        const cross = a.x * b.z - b.x * a.z;
        twiceArea += cross;
        x += (a.x + b.x) * cross;
        z += (a.z + b.z) * cross;
      }
      if (Math.abs(twiceArea) < 1e-7) {
        return polygon.reduce((sum, point) => ({ x: sum.x + point.x / polygon.length, z: sum.z + point.z / polygon.length }), { x: 0, z: 0 });
      }
      return { x: x / (3 * twiceArea), z: z / (3 * twiceArea) };
    }

    function minimumInsetDistance2(point, polygon) {
      let minimum = Infinity;
      for (let index = 0; index < polygon.length; index += 1) {
        const start = polygon[index];
        const end = polygon[(index + 1) % polygon.length];
        const length = Math.hypot(end.x - start.x, end.z - start.z) || 1;
        minimum = Math.min(minimum, cross2(start, end, point) / length);
      }
      return minimum;
    }

    function ellipseFitsInsidePolygon(dimensions, polygon) {
      if (polygon.length < 3) return [];
      const centroid = polygonCentroid2(polygon);
      const candidates = [0, .25, .5, .75, 1].map(fraction => ({ x: centroid.x * fraction, z: centroid.z * fraction }));
      polygon.forEach(point => candidates.push({
        x: THREE.MathUtils.lerp(point.x, centroid.x, .55),
        z: THREE.MathUtils.lerp(point.z, centroid.z, .55)
      }));
      const bounds = polygon.reduce((value, point) => ({
        minX: Math.min(value.minX, point.x), maxX: Math.max(value.maxX, point.x),
        minZ: Math.min(value.minZ, point.z), maxZ: Math.max(value.maxZ, point.z)
      }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
      for (let xIndex = 1; xIndex < 5; xIndex += 1) {
        for (let zIndex = 1; zIndex < 5; zIndex += 1) {
          candidates.push({
            x: THREE.MathUtils.lerp(bounds.minX, bounds.maxX, xIndex / 5),
            z: THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, zIndex / 5)
          });
        }
      }
      const uniqueCandidates = candidates.filter((point, index, list) => index === list.findIndex(value => Math.hypot(value.x - point.x, value.z - point.z) < .05));
      const fitsFound = [];
      uniqueCandidates.forEach(center => {
        const centerDistance = minimumInsetDistance2(center, polygon);
        if (!(centerDistance > .05)) return;
        const insetMm = Math.min(DISC_CONTAINMENT_MODEL.requestedInsetMm, centerDistance * .45);
        const fits = scale => {
          for (let index = 0; index < 64; index += 1) {
            const angle = index / 64 * Math.PI * 2;
            const point = {
              x: center.x + Math.cos(angle) * dimensions.ap * .5 * scale,
              z: center.z + Math.sin(angle) * dimensions.lr * .5 * scale
            };
            if (minimumInsetDistance2(point, polygon) < insetMm - 1e-5) return false;
          }
          return true;
        };
        let low = 0;
        let high = 1;
        for (let iteration = 0; iteration < 28; iteration += 1) {
          const middle = (low + high) * .5;
          if (fits(middle)) low = middle;
          else high = middle;
        }
        if (low >= DISC_CONTAINMENT_MODEL.minimumFootprintScale) fitsFound.push({ center, scale: low, insetMm });
      });
      return fitsFound.sort((a, b) => b.scale - a.scale || Math.hypot(a.center.x, a.center.z) - Math.hypot(b.center.x, b.center.z));
    }

    function firstTriangleRayDistance(sourceData, origin, direction) {
      const geometry = sourceData?.geometry;
      const position = geometry?.getAttribute('position');
      const index = geometry?.getIndex();
      if (!position || !index) return null;
      let nearest = Infinity;
      const indices = index.array;
      const triangleOffsets = sourceData.triangleOffsets?.length
        ? sourceData.triangleOffsets
        : Array.from({ length: indices.length / 3 }, (_, triangleIndex) => triangleIndex * 3);
      for (const cursor of triangleOffsets) {
        const ia = indices[cursor];
        const ib = indices[cursor + 1];
        const ic = indices[cursor + 2];
        const ax = position.getX(ia); const ay = position.getY(ia); const az = position.getZ(ia);
        const e1x = position.getX(ib) - ax; const e1y = position.getY(ib) - ay; const e1z = position.getZ(ib) - az;
        const e2x = position.getX(ic) - ax; const e2y = position.getY(ic) - ay; const e2z = position.getZ(ic) - az;
        const px = direction.y * e2z - direction.z * e2y;
        const py = direction.z * e2x - direction.x * e2z;
        const pz = direction.x * e2y - direction.y * e2x;
        const determinant = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(determinant) < 1e-9) continue;
        const inverse = 1 / determinant;
        const tx = origin.x - ax; const ty = origin.y - ay; const tz = origin.z - az;
        const u = (tx * px + ty * py + tz * pz) * inverse;
        if (u < -1e-7 || u > 1.0000001) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (direction.x * qx + direction.y * qy + direction.z * qz) * inverse;
        if (v < -1e-7 || u + v > 1.0000001) continue;
        const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
        if (distance >= 0 && distance < nearest) nearest = distance;
      }
      return Number.isFinite(nearest) ? nearest : null;
    }

    function desiredDiscHeightMm(dimensions, normalizedAp) {
      const value = THREE.MathUtils.clamp(normalizedAp, -1, 1);
      return value <= 0
        ? THREE.MathUtils.lerp(dimensions.middle, dimensions.anterior, -value)
        : THREE.MathUtils.lerp(dimensions.middle, dimensions.posterior, value);
    }

    function solveDiscSurfacePoint(frame, dimensions, xMm, zMm, normalizedAp) {
      const base = frame.pivot.clone()
        .addScaledVector(frame.posterior, xMm)
        .addScaledVector(frame.patientLeft, zMm);
      const span = DISC_CONTAINMENT_MODEL.raySpanMm;
      const superiorOrigin = base.clone().addScaledVector(frame.cranial, -span);
      const inferiorOrigin = base.clone().addScaledVector(frame.cranial, span);
      const superiorDistance = firstTriangleRayDistance(frame.superior, superiorOrigin, frame.cranial);
      const inferiorDistance = firstTriangleRayDistance(frame.inferior, inferiorOrigin, frame.cranial.clone().negate());
      if (!Number.isFinite(superiorDistance) || !Number.isFinite(inferiorDistance)) return null;
      const superiorY = -span + superiorDistance;
      const inferiorY = span - inferiorDistance;
      const rawGapMm = superiorY - inferiorY;
      const availableMm = rawGapMm - DISC_CONTAINMENT_MODEL.surfaceClearanceMm * 2;
      if (availableMm < DISC_CONTAINMENT_MODEL.minimumLoftThicknessMm) return null;
      const thicknessMm = Math.min(desiredDiscHeightMm(dimensions, normalizedAp), availableMm);
      const centerY = (superiorY + inferiorY) * .5;
      return {
        topY: centerY + thicknessMm * .5,
        bottomY: centerY - thicknessMm * .5,
        centerY,
        thicknessMm,
        rawGapMm,
        superiorClearanceMm: superiorY - (centerY + thicknessMm * .5),
        inferiorClearanceMm: (centerY - thicknessMm * .5) - inferiorY
      };
    }

    function createContainedDiscGeometry(frame, dimensions, fit) {
      const segmentCount = DISC_CONTAINMENT_MODEL.contourSegments;
      let fittedScale = fit.scale;
      let samples = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const trial = [];
        const radii = [0, .5, 1];
        let valid = true;
        radii.forEach(radius => {
          const count = radius === 0 ? 1 : segmentCount;
          for (let index = 0; index < count; index += 1) {
            const angle = radius === 0 ? 0 : index / segmentCount * Math.PI * 2;
            const localX = Math.cos(angle) * dimensions.ap * .5 * fittedScale * radius;
            const localZ = Math.sin(angle) * dimensions.lr * .5 * fittedScale * radius;
            const xMm = fit.center.x + localX;
            const zMm = fit.center.z + localZ;
            const surface = solveDiscSurfacePoint(
              frame, dimensions, xMm, zMm,
              dimensions.ap * fittedScale > 0 ? localX / (dimensions.ap * .5 * fittedScale) : 0
            );
            if (!surface) valid = false;
            trial.push({ localX, localZ, xMm, zMm, surface });
          }
        });
        if (valid) { samples = trial; break; }
        fittedScale *= .92;
      }
      if (!samples || fittedScale < DISC_CONTAINMENT_MODEL.minimumFootprintScale) return null;

      const centerSample = samples[0];
      const centerY = centerSample.surface.centerY;
      const innerSamples = samples.slice(1, 1 + segmentCount);
      const outerSamples = samples.slice(1 + segmentCount);
      const positions = [];
      const pushSurfaceVertex = (sample, surfaceKey) => {
        positions.push(
          sample.localX * REFERENCE_MM_TO_SCENE,
          (sample.surface[surfaceKey] - centerY) * REFERENCE_MM_TO_SCENE,
          sample.localZ * REFERENCE_MM_TO_SCENE
        );
      };
      pushSurfaceVertex(centerSample, 'topY');
      innerSamples.forEach(sample => pushSurfaceVertex(sample, 'topY'));
      outerSamples.forEach(sample => pushSurfaceVertex(sample, 'topY'));
      const bottomCenter = positions.length / 3;
      pushSurfaceVertex(centerSample, 'bottomY');
      innerSamples.forEach(sample => pushSurfaceVertex(sample, 'bottomY'));
      outerSamples.forEach(sample => pushSurfaceVertex(sample, 'bottomY'));
      const topInner = 1;
      const topOuter = 1 + segmentCount;
      const bottomInner = bottomCenter + 1;
      const bottomOuter = bottomCenter + 1 + segmentCount;
      const indices = [];
      for (let index = 0; index < segmentCount; index += 1) {
        const next = (index + 1) % segmentCount;
        indices.push(0, topInner + next, topInner + index);
        indices.push(topInner + index, topInner + next, topOuter + next);
        indices.push(topInner + index, topOuter + next, topOuter + index);
        indices.push(bottomCenter, bottomInner + index, bottomInner + next);
        indices.push(bottomInner + index, bottomOuter + next, bottomInner + next);
        indices.push(bottomInner + index, bottomOuter + index, bottomOuter + next);
        indices.push(topOuter + index, topOuter + next, bottomOuter + index);
        indices.push(topOuter + next, bottomOuter + next, bottomOuter + index);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const surfaceSamples = samples.map(sample => sample.surface);
      return {
        geometry,
        centerY,
        fittedScale,
        apMm: dimensions.ap * fittedScale,
        mlMm: dimensions.lr * fittedScale,
        minGapMm: Math.min(...surfaceSamples.map(value => value.rawGapMm)),
        maxGapMm: Math.max(...surfaceSamples.map(value => value.rawGapMm)),
        centerHeightMm: centerSample.surface.thicknessMm,
        minSurfaceClearanceMm: Math.min(...surfaceSamples.flatMap(value => [value.superiorClearanceMm, value.inferiorClearanceMm]))
      };
    }

    function createSourceIntervertebralDisc(level) {
      const dimensions = discMorphometryFor(level);
      const frame = sourceDiscFrameFor(level);
      const withheld = reason => {
        const group = new THREE.Group();
        group.name = 'disc:withheld-no-contained-source-fit';
        group.userData = {
          intervertebralDisc: true,
          containmentAssessed: false,
          geometryWithheld: true,
          withheldReason: reason,
          morphometryMm: { ...dimensions },
          requestedMorphometryMm: { ...dimensions },
          sourceSubjectDiscSegmentation: false
        };
        return group;
      };
      if (SOURCE_DISC_CLEARANCE_EXCLUSIONS[level.id]) return withheld(SOURCE_DISC_CLEARANCE_EXCLUSIONS[level.id]);
      if (!frame) return withheld('Adjacent CT vertebral-body source frame unavailable.');
      const superiorHull = convexHull2(projectedFacingPatch(frame.superior, frame, true));
      const inferiorHull = convexHull2(projectedFacingPatch(frame.inferior, frame, false));
      const sharedFootprint = intersectConvexPolygons(superiorHull, inferiorHull);
      if (sharedFootprint.length < 3) return withheld('Adjacent CT endplate proxy footprints do not have a valid shared intersection.');
      const fits = ellipseFitsInsidePolygon(dimensions, sharedFootprint)
        .filter(candidate => solveDiscSurfacePoint(frame, dimensions, candidate.center.x, candidate.center.z, 0));
      if (!fits.length) return withheld('No inset literature-prior footprint fits inside the shared CT endplate proxy intersection.');
      let fit = null;
      let contained = null;
      for (const candidate of fits) {
        const candidateGeometry = createContainedDiscGeometry(frame, dimensions, candidate);
        if (!candidateGeometry) continue;
        fit = candidate;
        contained = candidateGeometry;
        break;
      }
      if (!contained) return withheld('Bidirectional CT surface rays could not produce a positive-clearance loft.');

      const disc = mesh(contained.geometry, materials.disc, 'disc:ct-endplate-contained-ray-loft');
      const centerAppMm = frame.pivot.clone()
        .addScaledVector(frame.posterior, fit.center.x)
        .addScaledVector(frame.cranial, contained.centerY)
        .addScaledVector(frame.patientLeft, fit.center.z);
      disc.position.copy(sourceLocalPoint(level, centerAppMm));
      disc.quaternion.copy(frame.quaternion);
      const maximumOutside = Math.max(0, ...Array.from({ length: 64 }, (_, index) => {
        const angle = index / 64 * Math.PI * 2;
        const point = {
          x: fit.center.x + Math.cos(angle) * contained.apMm * .5,
          z: fit.center.z + Math.sin(angle) * contained.mlMm * .5
        };
        return -minimumInsetDistance2(point, sharedFootprint);
      }));
      disc.userData = {
        intervertebralDisc: true,
        sourceRelativeCenterPreserved: false,
        sourceMotionSegmentFramePreserved: true,
        sourceSubjectDiscSegmentation: false,
        centerMethod: 'inset shared adjacent-endplate proxy footprint centroid with bidirectional source-surface ray loft',
        centerValidated: false,
        morphometryMm: { ...dimensions },
        requestedMorphometryMm: { ...dimensions },
        renderedFootprintMm: { ap: contained.apMm, ml: contained.mlMm },
        footprintScale: contained.fittedScale,
        footprintCenterOffsetMm: { ap: fit.center.x, ml: fit.center.z },
        endplateConstraintMethod: DISC_CONTAINMENT_MODEL.method,
        endplateConstraintPolygonMm: sharedFootprint.map(point => [point.x, point.z]),
        containmentAssessed: true,
        maxOutsideEndplateMm: maximumOutside,
        appliedInsetMm: fit.insetMm,
        minSourceSurfaceGapMm: contained.minGapMm,
        maxSourceSurfaceGapMm: contained.maxGapMm,
        renderedCenterHeightMm: contained.centerHeightMm,
        minSurfaceClearanceMm: contained.minSurfaceClearanceMm,
        surfaceRayClearanceMm: DISC_CONTAINMENT_MODEL.surfaceClearanceMm,
        sourceFrameAxes: {
          posterior: frame.posterior.toArray(),
          cranial: frame.cranial.toArray(),
          patientLeft: frame.patientLeft.toArray()
        },
        sourcePivotAppMm: frame.pivot.toArray(),
        baseLocalPosition: disc.position.toArray(),
        baseLocalQuaternion: disc.quaternion.toArray(),
        measurementMode: 'literature morphometry is an upper-bound shape prior; displayed loft is clipped to this CT source subject',
        validationStatus: DISC_CONTAINMENT_MODEL.validationStatus
      };
      return disc;
    }

    function createInterbodyResectionEnvelope(level, disc) {
      const root = new THREE.Group();
      root.name = 'interbodyResectionEnvelope';
      root.visible = false;
      if (!level?.metricRegion || ['C0-C1', 'C1-C2'].includes(level.id)) return root;
      if (!disc?.isMesh || disc.userData?.containmentAssessed !== true) {
        root.userData = {
          geometryWithheld: true,
          withheldReason: 'A planned discectomy envelope is unavailable because this level has no contained source-disc loft.',
          ctBoneSubtracted: false,
          endplatePreparationModeled: false,
          cutSafetyValidated: false
        };
        return root;
      }
      const dimensions = disc.userData?.renderedFootprintMm || discMorphometryFor(level);
      const renderedAp = dimensions.ap;
      const renderedMl = dimensions.ml ?? dimensions.lr;
      const sourceDimensions = discMorphometryFor(level);
      const envelope = mesh(
        disc.isMesh && disc.geometry
          ? disc.geometry.clone()
          : new THREE.BoxGeometry(sceneFromMm(renderedAp * .75), sceneFromMm(1), sceneFromMm(renderedMl * .75)),
        materials.canalVoid,
        'plannedInterbodyDiscectomyEnvelope'
      );
      envelope.scale.set(.82, .72, .82);
      envelope.userData = {
        representation: 'source-disc-bounded planned discectomy envelope; disc mesh is hidden but CT vertebral surfaces are not subtracted',
        sourceDiscEnvelopeMm: { ap: renderedAp, ml: renderedMl },
        requestedLiteratureEnvelopeMm: { ap: sourceDimensions.ap, ml: sourceDimensions.lr },
        ctBoneSubtracted: false, endplatePreparationModeled: false,
        neuralAndVascularCorridorsModeled: false, cutSafetyValidated: false
      };
      root.position.copy(disc.position);
      root.quaternion.copy(disc.quaternion);
      root.userData = { ...envelope.userData };
      root.add(envelope);
      return root;
    }

    const PATHOLOGY_VISUALIZATION = Object.freeze({
      validationStatus: 'Illustrative geometric factors only; no diagnostic grading or mechanics inference',
      maxDiscCollapse: .95,
      translationScale: REFERENCE_MM_TO_SCENE,
      trunkShiftScale: REFERENCE_MM_TO_SCENE,
      maxFacetScale: .72
    });

    // A Cobb-like input is regional. Earlier builds normalized one sine lobe
    // across the entire caudal-to-cranial chain, so a preset explicitly named
    // "lumbar-major" placed most of its bend in the thoracic and cervical spine.
    // These authored windows keep the display deformation in its declared
    // region. They are visualization profiles, not measured end vertebrae.
    const CORONAL_DISPLAY_PROFILES = Object.freeze({
      'degenerative-scoliosis': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['L5-S1', 'L4-L5', 'L3-L4', 'L2-L3', 'L1-L2', 'T12-L1']), apex: 'L3-L4' }),
        secondary: Object.freeze({ ids: Object.freeze(['T12-L1', 'T11-T12', 'T10-T11', 'T9-T10', 'T8-T9', 'T7-T8']), apex: 'T9-T10' })
      }),
      'thoracic-major-curve': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['T12-L1', 'T11-T12', 'T10-T11', 'T9-T10', 'T8-T9', 'T7-T8', 'T6-T7', 'T5-T6', 'T4-T5', 'T3-T4', 'T2-T3', 'T1-T2']), apex: 'T7-T8' }),
        secondary: Object.freeze({ ids: Object.freeze(['L5-S1', 'L4-L5', 'L3-L4', 'L2-L3', 'L1-L2', 'T12-L1']), apex: 'L2-L3' })
      }),
      'double-major-curve': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['T12-L1', 'T11-T12', 'T10-T11', 'T9-T10', 'T8-T9', 'T7-T8', 'T6-T7', 'T5-T6', 'T4-T5', 'T3-T4', 'T2-T3', 'T1-T2']), apex: 'T7-T8' }),
        secondary: Object.freeze({ ids: Object.freeze(['L5-S1', 'L4-L5', 'L3-L4', 'L2-L3', 'L1-L2', 'T12-L1']), apex: 'L2-L3' })
      }),
      'cervical-coronal-curve': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['C6-C7', 'C5-C6', 'C4-C5', 'C3-C4', 'C2-C3']), apex: 'C4-C5' }),
        secondary: Object.freeze({ ids: Object.freeze(['T4-T5', 'T3-T4', 'T2-T3', 'T1-T2', 'C7-T1']), apex: 'T2-T3' })
      }),
      'compensated-thoracolumbar': Object.freeze({
        primary: Object.freeze({ ids: Object.freeze(['L4-L5', 'L3-L4', 'L2-L3', 'L1-L2', 'T12-L1', 'T11-T12', 'T10-T11', 'T9-T10', 'T8-T9', 'T7-T8']), apex: 'T12-L1' }),
        secondary: Object.freeze({ ids: Object.freeze(['T8-T9', 'T7-T8', 'T6-T7', 'T5-T6', 'T4-T5', 'T3-T4', 'T2-T3', 'T1-T2', 'C7-T1']), apex: 'T5-T6' })
      })
    });

    function normalizedRegionalCurveWeights(records, profile) {
      const weights = new Array(records.length).fill(0);
      if (!profile?.ids?.length || !profile.ids.includes(profile.apex)) return weights;
      const apexIndex = profile.ids.indexOf(profile.apex);
      const caudalSpan = Math.max(1, apexIndex);
      const cranialSpan = Math.max(1, profile.ids.length - apexIndex - 1);
      profile.ids.forEach((levelId, profileIndex) => {
        const recordIndex = records.findIndex(record => record.level.id === levelId);
        if (recordIndex < 0) return;
        const phase = profileIndex <= apexIndex
          ? (profileIndex / caudalSpan) * Math.PI * .5
          : ((profile.ids.length - 1 - profileIndex) / cranialSpan) * Math.PI * .5;
        weights[recordIndex] = Math.max(0, Math.sin(phase));
      });
      const denominator = weights.reduce((sum, value) => sum + Math.abs(value), 0);
      return denominator > 0 ? weights.map(value => value / denominator) : weights;
    }

    function finiteOr(value, fallback = 0) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }

    function levelFactorFor(levelId) {
      const source = state.levelFactors instanceof Map
        ? state.levelFactors.get(levelId)
        : state.levelFactors?.[levelId];
      const normalized = { ...createDefaultLevelFactor(), ...(source && typeof source === 'object' ? source : {}) };
      if (source && Object.prototype.hasOwnProperty.call(source, 'discHeightLoss')) normalized.discCollapse = source.discHeightLoss;
      if (source && Object.prototype.hasOwnProperty.call(source, 'osteophyteBurden')) normalized.osteophytes = source.osteophyteBurden;
      return normalized;
    }

    function deformityState() {
      const source = state.globalDeformity || {};
      const authorDirection = source.coronalDirection === 'left' ? -1 : 1;
      const threePlane = state.view === 'post' ? state.threePlanePrediction : null;
      return {
        coronalMagnitude: THREE.MathUtils.clamp(Math.abs(finiteOr(source.coronalMagnitude)), 0, 120),
        // Scene +Z is patient-left and a positive X rotation turns the chain
        // toward +Z. An apex-right (convex-right) curve turns the chain LEFT as
        // it ascends, so its curvature is +X; see applyPathologyTargets.
        coronalDirection: source.coronalDirection === 'left' ? -1 : 1,
        primaryCobbSigned: authorDirection * THREE.MathUtils.clamp(Math.abs(finiteOr(source.coronalMagnitude)), 0, 120),
        secondaryCobbSigned: threePlane
          ? THREE.MathUtils.clamp(finiteOr(threePlane.outputs.secondaryCobb), -100, 100)
          : -authorDirection * THREE.MathUtils.clamp(Math.abs(finiteOr(source.compensatoryCobb)), 0, 100),
        // "Clockwise viewed cranially" is viewpoint-dependent and was ambiguous.
        // Restated unambiguously and aligned with every other signed input here:
        // POSITIVE axial rotation turns the vertebral body toward the patient's
        // RIGHT. A positive rotation about scene +Y turns the body's anterior
        // aspect toward +Z (patient left), so the author-facing value is negated.
        axialRotation: -THREE.MathUtils.clamp(finiteOr(source.axialRotation), -90, 90),
        // POSITIVE pelvic obliquity drops the patient's RIGHT side, matching the
        // right-positive convention used by coronal wedge, lateral translation
        // and trunk shift. Previously positive rendered toward patient left.
        pelvicObliquity: -THREE.MathUtils.clamp(finiteOr(source.pelvicObliquity), -35, 35),
        trunkShift: THREE.MathUtils.clamp(finiteOr(source.trunkShift), -100, 100),
        pelvicShift: THREE.MathUtils.clamp(finiteOr(source.pelvicShift), -100, 100),
        hipFlexion: THREE.MathUtils.clamp(finiteOr(source.hipFlexion), -30, 90),
        kneeFlexion: THREE.MathUtils.clamp(finiteOr(source.kneeFlexion), 0, 120),
        ankleFlexion: THREE.MathUtils.clamp(finiteOr(source.ankleFlexion), -45, 45),
        lowerExtremitiesVisible: source.lowerExtremitiesVisible === true
      };
    }

    function createOcciputBaseGeometry(dims) {
      const shape = new THREE.Shape();
      shape.moveTo(-dims.width * .62, 0);
      shape.bezierCurveTo(-dims.width * .54, dims.depth * .52, dims.width * .38, dims.depth * .60, dims.width * .62, dims.depth * .12);
      shape.bezierCurveTo(dims.width * .55, -dims.depth * .44, -dims.width * .43, -dims.depth * .51, -dims.width * .62, 0);
      const foramen = new THREE.Path();
      foramen.absellipse(dims.width * .08, 0, dims.width * .19, dims.depth * .22, 0, Math.PI * 2, true, 0);
      shape.holes.push(foramen);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: dims.height * .16, steps: 1, bevelEnabled: true,
        bevelSegments: 1, bevelSize: dims.height * .018, bevelThickness: dims.height * .012
      });
      geometry.center();
      geometry.rotateX(Math.PI / 2);
      geometry.computeVertexNormals();
      return geometry;
    }

    function createEmptyLigamentSet() {
      const layer = new THREE.Group();
      layer.name = 'craniovertebralLigamentReference';
      layer.userData = { representation: 'attachment/pathway proxies only; not segmented tissue', mechanicsModeled: false };
      const placeholder = name => { const value = new THREE.Group(); value.name = name; return value; };
      const all = placeholder('anteriorLongitudinalLigament');
      const pll = placeholder('posteriorLongitudinalLigament');
      const flavum = { left: placeholder('ligamentumFlavum:left'), right: placeholder('ligamentumFlavum:right') };
      const capsular = { left: placeholder('facetCapsule:left'), right: placeholder('facetCapsule:right') };
      const intertransverse = { left: placeholder('intertransverseLigament:left'), right: placeholder('intertransverseLigament:right') };
      const interspinous = placeholder('interspinousLigament');
      const supraspinous = placeholder('supraspinousLigament');
      const disruptionMarkers = placeholder('illustrativeLigamentInterruption');
      layer.add(all, pll, flavum.left, flavum.right, capsular.left, capsular.right, intertransverse.left, intertransverse.right, interspinous, supraspinous, disruptionMarkers);
      return { layer, all, pll, flavum, capsular, intertransverse, interspinous, supraspinous, disruptionMarkers };
    }

    function createOcciputSegment(level) {
      const dims = { ...profileFor(level) };
      const group = new THREE.Group();
      group.name = 'segment:C0';
      group.userData = {
        levelId: level.id, region: level.region,
        targetRotationX: 0, targetRotationY: 0, targetRotationZ: 0,
        targetPositionX: 0, targetPositionZ: 0,
        morphologyProfile: 'C0',
        representation: 'illustrative skull-base and occipital-condyle reference; not patient-specific'
      };
      const anatomyRoot = new THREE.Group();
      anatomyRoot.name = 'vertebraRoot:C0';
      group.add(anatomyRoot);
      const referenceLayer = createReferenceSurface('C0', dims, level.id);
      anatomyRoot.add(referenceLayer);

      const disc = createCraniovertebralJoint(level);
      group.add(disc);
      const interbodyResectionEnvelope = createInterbodyResectionEnvelope(level, disc);
      anatomyRoot.add(interbodyResectionEnvelope);

      const body = new THREE.Group();
      body.name = 'occiputReferenceAnatomy';
      const skullBase = mesh(createOcciputBaseGeometry(dims), materials.bone, 'skullBaseWithForamenMagnum');
      skullBase.position.y = dims.height * .46;
      body.add(skullBase);
      [-1, 1].forEach(side => {
        const condyle = mesh(new THREE.SphereGeometry(dims.height * .145, 18, 12), materials.cortical, `occipitalCondyle:${side > 0 ? 'left' : 'right'}`);
        condyle.scale.set(1.55, .62, .82);
        condyle.position.set(-dims.width * .03, dims.height * .22, side * dims.depth * .21);
        condyle.rotation.x = side * .12;
        body.add(condyle);
      });
      const clivus = mesh(extrudedProfileGeometry([
        [-dims.width * .34, -.08], [dims.width * .02, -.10], [dims.width * .18, .09], [-dims.width * .22, .14]
      ], dims.depth * .38, .012), materials.boneDark, 'clivus');
      clivus.position.set(-dims.width * .24, dims.height * .62, 0);
      clivus.rotation.z = -.20;
      const squama = mesh(new THREE.SphereGeometry(dims.width * .42, 24, 14, 0, Math.PI * 2, 0, Math.PI * .48), materials.bone, 'occipitalSquamaReference');
      squama.scale.set(.82, .72, 1.08);
      squama.position.set(dims.width * .30, dims.height * .83, 0);
      squama.rotation.z = -.30;
      body.add(clivus, squama);
      anatomyRoot.add(body);

      const ligaments = createEmptyLigamentSet();
      const alarLeft = cylinderBetween(new THREE.Vector3(.02, dims.height * .18, dims.depth * .13), new THREE.Vector3(-.12, dims.height * .55, dims.depth * .25), dims.height * .022, materials.ligamentAnterior, 'alarLigament:left', 8);
      const alarRight = cylinderBetween(new THREE.Vector3(.02, dims.height * .18, -dims.depth * .13), new THREE.Vector3(-.12, dims.height * .55, -dims.depth * .25), dims.height * .022, materials.ligamentAnterior, 'alarLigament:right', 8);
      const tectorial = mesh(new THREE.BoxGeometry(dims.width * .035, dims.height * .48, dims.depth * .30), materials.ligamentPosterior, 'tectorialMembrane');
      tectorial.position.set(dims.width * .20, dims.height * .36, 0);
      ligaments.layer.add(alarLeft, alarRight, tectorial);
      anatomyRoot.add(ligaments.layer);

      const endplates = new THREE.Group();
      endplates.name = 'occipitalEndplateReference';
      endplates.visible = false;
      anatomyRoot.add(endplates);
      const posteriorElement = new THREE.Group(); posteriorElement.name = 'occipitalPosteriorReference'; anatomyRoot.add(posteriorElement);
      const emptyPair = prefix => ({ left: new THREE.Group(), right: new THREE.Group() });
      const pedicles = emptyPair('pedicle');
      const laminae = emptyPair('lamina');
      const facets = emptyPair('facet');
      const pars = emptyPair('pars');
      const transverseProcesses = emptyPair('transverse');
      const spinous = new THREE.Group(); spinous.name = 'externalOccipitalProtuberance';
      const protuberance = mesh(new THREE.SphereGeometry(dims.height * .08, 12, 8), materials.cortical, 'externalOccipitalProtuberance');
      protuberance.position.set(dims.width * .48, dims.height * .76, 0); spinous.add(protuberance); posteriorElement.add(spinous);

      const hardwareLayer = new THREE.Group(); hardwareLayer.name = 'hardwareLayer'; anatomyRoot.add(hardwareLayer);
      const cutSurfaces = new THREE.Group(); cutSurfaces.name = 'craniovertebralCutSurfaces'; cutSurfaces.visible = false;
      const decompressionVoid = new THREE.Group(); decompressionVoid.name = 'craniovertebralDecompressionVoid'; decompressionVoid.visible = false;
      const osteotomyRemnants = new THREE.Group(); osteotomyRemnants.name = 'craniovertebralOsteotomyRemnants'; osteotomyRemnants.visible = false;
      anatomyRoot.add(cutSurfaces, decompressionVoid, osteotomyRemnants);
      const highlight = mesh(new THREE.BoxGeometry(dims.width * 1.35, dims.height * 1.2, dims.depth * 1.2), materials.highlight, 'levelHighlight');
      highlight.position.y = dims.height * .5; highlight.visible = false; anatomyRoot.add(highlight);
      const osteophytes = new THREE.Group(); osteophytes.name = 'osteophytes'; anatomyRoot.add(osteophytes);

      return {
        level, group, anatomyRoot, referenceLayer, body, disc, endplates, posteriorElement,
        anatomy: { body, pedicles, laminae, facets, pars, transverseProcesses, spinous }, ligaments,
        decompressionTargets: [], cutSurfaces, decompressionVoid, interbodyResectionEnvelope, osteotomyRemnants,
        hardwareLayer, highlight, osteophytes, dims, height: dims.height,
        baseAnatomyY: 0, decompressed: false, osteotomyType: null, ligamentDisrupted: false,
        discReplaced: false, discExcised: false, interbodyApproach: null, topsReconstruction: false,
        geometryMode: referenceLayer.children.length ? 'ct_reference' : 'procedural_fallback'
      };
    }

    function createBodyGeometry(profile) {
      const w = profile.width;
      const h = profile.height * .52;
      if (profile.kind === 'thoracic') {
        return extrudedProfileGeometry([
          [-w * .53, -h * .30], [-w * .38, -h * .5], [w * .22, -h * .48],
          [w * .50, -h * .15], [w * .43, h * .34], [0, h * .5], [-w * .46, h * .34]
        ], profile.depth, h * .045);
      }
      if (profile.kind === 'lumbar') {
        return extrudedProfileGeometry([
          [-w * .58, -h * .32], [-w * .42, -h * .5], [w * .37, -h * .48],
          [w * .56, -h * .18], [w * .51, h * .35], [w * .27, h * .5], [-w * .48, h * .42]
        ], profile.depth, h * .05);
      }
      return extrudedProfileGeometry([
        [-w * .53, -h * .38], [-w * .42, -h * .5], [w * .40, -h * .48],
        [w * .51, -h * .15], [w * .46, h * .46], [-w * .46, h * .48], [-w * .55, 0]
      ], profile.depth, h * .045);
    }

    const LIGAMENT_PATHWAY_PROFILES = Object.freeze({
      all: Object.freeze({ xFraction: .07, zFraction: 0, radiusMm: .90, material: 'anterior' }),
      pll: Object.freeze({ xFraction: .34, zFraction: 0, radiusMm: .70, material: 'posterior' }),
      flavum: Object.freeze({ xFraction: .59, zFraction: .17, radiusMm: .68, material: 'posterior' }),
      capsular: Object.freeze({ xFraction: .61, zFraction: .31, radiusMm: .50, material: 'anterior' }),
      intertransverse: Object.freeze({ xFraction: .52, zFraction: .48, radiusMm: .48, material: 'posterior' }),
      interspinous: Object.freeze({ xFraction: .79, zFraction: 0, radiusMm: .58, material: 'posterior' }),
      supraspinous: Object.freeze({ xFraction: .96, zFraction: 0, radiusMm: .68, material: 'anterior' })
    });

    function cranialMotionLevelFor(level) {
      return LEVELS.find(candidate => candidate.inferior === level.superior) || null;
    }

    function ligamentAttachmentProxyAppMm(motionLevel, pathway, side = 0) {
      const profile = LIGAMENT_PATHWAY_PROFILES[pathway];
      const pivot = motionSegmentPivotFor(motionLevel.id, motionLevel.superior) || new THREE.Vector3();
      const superiorBounds = referenceBoundsFor(motionLevel.superior);
      const inferiorBounds = referenceBoundsFor(motionLevel.inferior);
      // The whole-skull C0 bounds are not a valid local envelope for the
      // atlanto-occipital attachment zone. C1 alone provides the conservative
      // reference envelope at this joint; every other joint blends its two
      // adjacent CT-derived bone envelopes.
      const bounds = motionLevel.superior === 'C0'
        ? [inferiorBounds].filter(Boolean)
        : [superiorBounds, inferiorBounds].filter(Boolean);
      if (!profile || !bounds.length) {
        const disc = discMorphometryFor(motionLevel);
        return pivot.clone().add(new THREE.Vector3(
          (profile?.xFraction || .5) * disc.ap - disc.ap * .5,
          0,
          side * (profile?.zFraction || 0) * disc.lr
        ));
      }
      const anteriorX = bounds.reduce((sum, value) => sum + value.min.x, 0) / bounds.length;
      const posteriorX = bounds.reduce((sum, value) => sum + value.max.x, 0) / bounds.length;
      const centerZ = bounds.reduce((sum, value) => sum + value.center.z, 0) / bounds.length;
      const widthZ = bounds.reduce((sum, value) => sum + value.size.z, 0) / bounds.length;
      return new THREE.Vector3(
        THREE.MathUtils.lerp(anteriorX, posteriorX, profile.xFraction),
        pivot.y,
        centerZ + side * widthZ * profile.zFraction
      );
    }

    function createReferenceLigamentPath(level, pathway, side, name) {
      const cranialLevel = cranialMotionLevelFor(level);
      const profile = LIGAMENT_PATHWAY_PROFILES[pathway];
      const group = new THREE.Group();
      group.name = name;
      group.userData = {
        representation: 'CT-envelope-guided attachment/pathway proxy; not a segmented ligament or force-bearing solid',
        mechanicsModeled: false,
        anchorSource: 'adjacent CT-derived surface bounds and source-frame motion-segment pivots',
        radiusMm: profile.radiusMm,
        interruptionGapFraction: .18,
        caudalLevelId: level.id,
        cranialLevelId: cranialLevel?.id || null
      };
      if (!cranialLevel) return group;

      const cranialAnchor = ligamentAttachmentProxyAppMm(cranialLevel, pathway, side);
      const caudalAnchor = ligamentAttachmentProxyAppMm(level, pathway, side);
      const start = sourceLocalPoint(level, cranialAnchor);
      const end = sourceLocalPoint(level, caudalAnchor);
      const middle = start.clone().lerp(end, .5);
      const material = profile.material === 'anterior' ? materials.ligamentAnterior : materials.ligamentPosterior;
      const radius = profile.radiusMm * REFERENCE_MM_TO_SCENE;
      const continuous = tubeThrough([start, middle, end], radius, material, `${name}:continuous`, 10);
      continuous.userData = { pathwayRole: 'continuous_reference', radiusMm: profile.radiusMm };

      const preservedEnd = start.clone().lerp(end, .82);
      const preservedMiddle = start.clone().lerp(preservedEnd, .5);
      const preserved = tubeThrough([start, preservedMiddle, preservedEnd], radius, material, `${name}:preserved`, 9);
      preserved.userData = { pathwayRole: 'preserved_after_planned_interruption', radiusMm: profile.radiusMm };
      preserved.visible = false;
      group.add(continuous, preserved);
      group.userData.cranialAnchorAppMm = cranialAnchor.toArray();
      group.userData.caudalAnchorAppMm = caudalAnchor.toArray();
      group.userData.renderedStartLocal = start.toArray();
      group.userData.renderedEndLocal = end.toArray();
      return group;
    }

    function setReferenceLigamentInterrupted(pathway, interrupted) {
      if (!pathway) return;
      if (!pathway.isGroup) {
        pathway.visible = interrupted !== true;
        pathway.userData = { ...(pathway.userData || {}), interrupted: interrupted === true };
        return;
      }
      const continuous = pathway.children.find(child => child.userData?.pathwayRole === 'continuous_reference');
      const preserved = pathway.children.find(child => child.userData?.pathwayRole === 'preserved_after_planned_interruption');
      if (continuous) continuous.visible = !interrupted;
      if (preserved) preserved.visible = interrupted;
      pathway.userData.interrupted = interrupted === true;
    }

    function updateReferenceLigamentContinuity() {
      if (!worldRoot) return { valid: 0, withheld: 0 };
      worldRoot.updateMatrixWorld(true);
      let valid = 0;
      let withheld = 0;
      let statusChanged = false;
      segmentRecords.forEach(record => {
        const pathways = [
          record.ligaments.all, record.ligaments.pll,
          record.ligaments.flavum.left, record.ligaments.flavum.right,
          record.ligaments.intertransverse.left, record.ligaments.intertransverse.right,
          record.ligaments.interspinous, record.ligaments.supraspinous
        ].filter(pathway => pathway?.children?.length && pathway.userData?.cranialLevelId);
        let layerValid = true;
        let maximumGapMm = 0;
        pathways.forEach(pathway => {
          const cranialRecord = segmentRecords.get(pathway.userData.cranialLevelId);
          const caudalRecord = segmentRecords.get(pathway.userData.caudalLevelId);
          const cranialAnchor = new THREE.Vector3().fromArray(pathway.userData.cranialAnchorAppMm);
          const caudalAnchor = new THREE.Vector3().fromArray(pathway.userData.caudalAnchorAppMm);
          const renderedStart = pathway.localToWorld(
            new THREE.Vector3().fromArray(pathway.userData.renderedStartLocal)
          );
          const renderedEnd = pathway.localToWorld(
            new THREE.Vector3().fromArray(pathway.userData.renderedEndLocal)
          );
          const expectedStart = cranialRecord?.anatomyRoot.localToWorld(
            sourceLocalPoint(cranialRecord.level, cranialAnchor)
          );
          const expectedEnd = caudalRecord?.anatomyRoot.localToWorld(
            sourceLocalPoint(caudalRecord.level, caudalAnchor)
          );
          const finite = [renderedStart, renderedEnd, expectedStart, expectedEnd]
            .every(point => point?.isVector3 && point.toArray().every(Number.isFinite));
          const gapMm = finite
            ? Math.max(renderedStart.distanceTo(expectedStart), renderedEnd.distanceTo(expectedEnd)) / REFERENCE_MM_TO_SCENE
            : Infinity;
          const toleranceMm = Math.max(1, 2 * finiteOr(pathway.userData.radiusMm, .5));
          const pathValid = finite && gapMm <= toleranceMm;
          maximumGapMm = Math.max(maximumGapMm, gapMm);
          pathway.visible = pathValid;
          pathway.userData.liveAttachmentGapMm = gapMm;
          pathway.userData.liveContinuityToleranceMm = toleranceMm;
          pathway.userData.geometryWithheld = !pathValid;
          pathway.userData.withheldReason = pathValid
            ? null
            : 'The rigid source-pose pathway no longer meets both live attachment proxies; deformable ligament geometry is unavailable.';
          if (pathValid) valid += 1;
          else {
            withheld += 1;
            layerValid = false;
          }
        });
        statusChanged ||= record.ligaments.layer.userData.liveContinuityValid !== layerValid;
        record.ligaments.layer.userData.liveContinuityValid = layerValid;
        record.ligaments.layer.userData.maximumLiveAttachmentGapMm = maximumGapMm;
        record.ligaments.layer.userData.geometryWithheld = !layerValid;
        record.ligaments.layer.userData.withheldReason = layerValid
          ? null
          : 'One or more rigid source-pose pathways detached from a live attachment proxy, so this level’s ligament overlay is withheld.';
      });
      const globalContinuityValid = [...segmentRecords.values()]
        .every(record => record.ligaments.layer.userData.liveContinuityValid !== false);
      segmentRecords.forEach(record => {
        const layer = record.ligaments.layer;
        layer.userData.globalContinuityValid = globalContinuityValid;
        layer.visible = recordRegionVisible(record)
          && state.layers?.ligaments === true
          && !state.inspection?.active
          && globalContinuityValid;
      });
      if (statusChanged && typeof updateGeometryStatus === 'function') updateGeometryStatus();
      return { valid, withheld };
    }

    function createFacetCapsuleProxy(level, side, name) {
      const center = ligamentAttachmentProxyAppMm(level, 'capsular', side);
      const value = mesh(
        new THREE.TorusGeometry(2.8 * REFERENCE_MM_TO_SCENE, .48 * REFERENCE_MM_TO_SCENE, 6, 14),
        materials.ligamentAnterior,
        name
      );
      value.position.copy(sourceLocalPoint(level, center));
      value.rotation.y = Math.PI / 2;
      value.userData = {
        representation: 'CT-envelope-guided facet-capsule location proxy; not segmented tissue',
        mechanicsModeled: false,
        radiusMm: .48,
        anchorAppMm: center.toArray()
      };
      return value;
    }

    function createLigamentBands(level) {
      const layer = new THREE.Group();
      layer.name = 'referenceLigamentPathwayLayer';
      layer.userData = {
        representation: 'thin CT-envelope-guided attachment/pathway proxies; not anatomical solids',
        mechanicsModeled: false,
        continuityMode: 'one rigid vertebral span between shared source-frame motion pivots'
      };

      const all = createReferenceLigamentPath(level, 'all', 0, 'anteriorLongitudinalLigament');
      const pll = createReferenceLigamentPath(level, 'pll', 0, 'posteriorLongitudinalLigament');
      const flavum = {};
      const capsular = {};
      const intertransverse = {};
      [-1, 1].forEach(side => {
        const key = side > 0 ? 'left' : 'right';
        flavum[key] = createReferenceLigamentPath(level, 'flavum', side, `ligamentumFlavum:${key}`);
        capsular[key] = createFacetCapsuleProxy(level, side, `facetCapsule:${key}`);
        intertransverse[key] = createReferenceLigamentPath(level, 'intertransverse', side, `intertransverseLigament:${key}`);
      });
      const interspinous = createReferenceLigamentPath(level, 'interspinous', 0, 'interspinousLigament');
      const supraspinous = createReferenceLigamentPath(level, 'supraspinous', 0, 'supraspinousLigament');

      const disruptionMarkers = new THREE.Group();
      disruptionMarkers.name = 'illustrativeLigamentInterruption';
      disruptionMarkers.userData = {
        representation: 'planned interruption endpoints on attachment/pathway proxies',
        mechanicsModeled: false
      };
      ['flavum', 'interspinous', 'supraspinous'].forEach((pathway, index) => {
        const sides = pathway === 'flavum' ? [-1, 1] : [0];
        sides.forEach(side => {
          const anchor = ligamentAttachmentProxyAppMm(level, pathway, side);
          const marker = mesh(
            new THREE.SphereGeometry(.85 * REFERENCE_MM_TO_SCENE, 9, 7),
            materials.ligamentInterrupted,
            `interruptionEndpoint:${index + 1}:${side}`
          );
          marker.position.copy(sourceLocalPoint(level, anchor));
          disruptionMarkers.add(marker);
        });
      });
      disruptionMarkers.visible = false;
      layer.add(
        all, pll, flavum.left, flavum.right,
        capsular.left, capsular.right, intertransverse.left, intertransverse.right,
        interspinous, supraspinous, disruptionMarkers
      );
      return { layer, all, pll, flavum, capsular, intertransverse, interspinous, supraspinous, disruptionMarkers };
    }

    function createVertebralSegment(level) {
      if (level.superior === 'C0') return createOcciputSegment(level);
      const dims = sourceBoundedProceduralProfile(level);
      const group = new THREE.Group();
      group.name = `segment:${level.superior}`;
      group.userData = {
        levelId: level.id, region: level.region,
        targetRotationX: 0, targetRotationY: 0, targetRotationZ: 0,
        targetPositionX: 0, targetPositionZ: 0,
        morphologyProfile: level.superior,
        representation: 'illustrative procedural anatomy; not patient-specific'
      };
      const anatomyRoot = new THREE.Group();
      anatomyRoot.name = `vertebraRoot:${level.superior}`;
      anatomyRoot.userData.baseY = 0;
      group.add(anatomyRoot);
      const referenceLayer = createReferenceSurface(level.superior, dims, level.id);
      anatomyRoot.add(referenceLayer);
      const topsPostoperativeReferenceLayer = new THREE.Group();
      topsPostoperativeReferenceLayer.name = `topsPostoperativeReferenceLayer:${level.superior}`;
      topsPostoperativeReferenceLayer.visible = false;
      topsPostoperativeReferenceLayer.userData = {
        geometryMode: 'not_active',
        representation: 'derived open postoperative display surface; not a Boolean surgical solid'
      };
      anatomyRoot.add(topsPostoperativeReferenceLayer);

      const disc = level.id === 'C1-C2'
        ? createCraniovertebralJoint(level)
        : createSourceIntervertebralDisc(level);
      group.add(disc);
      const interbodyResectionEnvelope = createInterbodyResectionEnvelope(level, disc);
      anatomyRoot.add(interbodyResectionEnvelope);

      let body;
      const endplates = new THREE.Group();
      endplates.name = 'endplates';
      if (dims.kind === 'atlas') {
        body = new THREE.Group();
        body.name = 'atlasAnteriorArchAndLateralMasses';
        body.add(cylinderBetween(
          new THREE.Vector3(-dims.width * .38, dims.height * .48, -dims.depth * .30),
          new THREE.Vector3(-dims.width * .38, dims.height * .48, dims.depth * .30),
          dims.height * .09, materials.bone, 'atlasAnteriorArch', 10
        ));
        [-1, 1].forEach(side => {
          const mass = mesh(new THREE.SphereGeometry(dims.height * .19, 14, 10), materials.cortical, `atlasLateralMass:${side > 0 ? 'left' : 'right'}`);
          mass.scale.set(1.15, .78, 1.05);
          mass.position.set(0, dims.height * .48, side * dims.depth * .32);
          body.add(mass);
        });
        anatomyRoot.add(body);
      } else {
        body = mesh(createBodyGeometry(dims), materials.bone, 'vertebralBody');
        body.position.y = dims.height * .48;
        anatomyRoot.add(body);
        const upperPlate = mesh(new THREE.BoxGeometry(dims.width * .94, dims.height * .055, dims.depth * .94), materials.cortical, 'superiorEndplate');
        upperPlate.position.y = dims.height * .76;
        const lowerPlate = upperPlate.clone();
        lowerPlate.name = 'inferiorEndplate';
        lowerPlate.position.y = dims.height * .20;
        endplates.add(upperPlate, lowerPlate);
        anatomyRoot.add(endplates);
        if (dims.kind === 'axis') {
          const dens = mesh(new THREE.CylinderGeometry(dims.width * .09, dims.width * .12, dims.height * .45, 16), materials.cortical, 'dens');
          dens.position.set(-dims.width * .02, dims.height * .91, 0);
          const densTip = mesh(new THREE.SphereGeometry(dims.width * .095, 14, 10), materials.cortical, 'densTip');
          densTip.position.y = dims.height * .23;
          dens.add(densTip);
          anatomyRoot.add(dens);
        }
      }

      if (!endplates.parent) anatomyRoot.add(endplates);
      const posteriorElement = new THREE.Group();
      posteriorElement.name = 'posteriorElement';
      const pedicles = {};
      const laminae = {};
      const facets = {};
      const pars = {};
      const transverseProcesses = {};
      [-1, 1].forEach(side => {
        const key = side > 0 ? 'left' : 'right';
        pedicles[key] = cylinderBetween(
          new THREE.Vector3(dims.width * .34, dims.height * .48, side * dims.depth * .25),
          new THREE.Vector3(dims.width * .59, dims.height * .50, side * dims.depth * .24),
          dims.height * .075, materials.cortical, `pedicle:${key}`, 10
        );
        laminae[key] = dims.kind === 'atlas'
          ? cylinderBetween(
              new THREE.Vector3(dims.width * .46, dims.height * .48, 0),
              new THREE.Vector3(dims.width * .06, dims.height * .48, side * dims.depth * .32),
              dims.height * .075, materials.bone, `lamina:${key}`, 10
            )
          : mesh(new THREE.BoxGeometry(dims.width * .25, dims.height * .26, dims.depth * .19), materials.bone, `lamina:${key}`);
        if (dims.kind !== 'atlas') laminae[key].position.set(dims.width * .63, dims.height * .50, side * dims.depth * .13);
        facets[key] = mesh(new THREE.SphereGeometry(dims.height * .105, 12, 8), materials.cortical, `articularFacet:${key}`);
        facets[key].scale.set(.70, 1, .78);
        facets[key].position.set(dims.width * .61, dims.height * .66, side * dims.depth * .27);
        pars[key] = cylinderBetween(
          new THREE.Vector3(dims.width * .54, dims.height * .50, side * dims.depth * .23),
          new THREE.Vector3(dims.width * .64, dims.height * .62, side * dims.depth * .23),
          dims.height * .050, materials.boneDark, `parsInterarticularis:${key}`, 9
        );
        transverseProcesses[key] = cylinderBetween(
          new THREE.Vector3(dims.width * .50, dims.height * .50, side * dims.depth * .27),
          new THREE.Vector3(dims.width * .49, dims.height * .48, side * dims.depth * (dims.kind === 'lumbar' ? .72 : .66)),
          dims.height * (dims.kind === 'lumbar' ? .055 : .045), materials.bone, `transverseProcess:${key}`, 8
        );
        posteriorElement.add(pedicles[key], laminae[key], facets[key], pars[key], transverseProcesses[key]);
      });

      const spinous = new THREE.Group();
      spinous.name = 'spinousProcess';
      let spinousTipX = dims.width * .96;
      if (dims.kind === 'thoracic') {
        spinousTipX = dims.width * (dims.zone === 'mid' ? 1.08 : 1.00);
        spinous.add(cylinderBetween(
          new THREE.Vector3(dims.width * .64, dims.height * .55, 0),
          new THREE.Vector3(spinousTipX, dims.height * (dims.zone === 'mid' ? .16 : .25), 0),
          dims.height * .06, materials.bone, 'thoracicSpinousBlade', 9
        ));
      } else if (dims.kind === 'lumbar') {
        spinousTipX = dims.width * .98;
        const blade = mesh(new THREE.BoxGeometry(dims.width * .46, dims.height * .32, dims.depth * .18), materials.bone, 'lumbarSpinousBlade');
        blade.position.set(dims.width * .79, dims.height * .50, 0);
        blade.rotation.z = -.08;
        spinous.add(blade);
      } else if (dims.kind === 'atlas') {
        spinousTipX = dims.width * .49;
        const tubercle = mesh(new THREE.SphereGeometry(dims.height * .10, 12, 8), materials.cortical, 'posteriorTubercle');
        tubercle.position.set(spinousTipX, dims.height * .48, 0);
        spinous.add(tubercle);
      } else {
        spinousTipX = dims.width * (dims.kind === 'axis' ? 1.06 : .96);
        spinous.add(cylinderBetween(
          new THREE.Vector3(dims.width * .64, dims.height * .51, 0),
          new THREE.Vector3(spinousTipX, dims.height * .48, 0),
          dims.height * .065, materials.bone, 'cervicalSpinousStem', 9
        ));
        [-1, 1].forEach(side => {
          spinous.add(cylinderBetween(
            new THREE.Vector3(spinousTipX - dims.width * .05, dims.height * .48, 0),
            new THREE.Vector3(spinousTipX + dims.width * .05, dims.height * .46, side * dims.depth * .11),
            dims.height * .045, materials.cortical, `bifidProng:${side > 0 ? 'left' : 'right'}`, 8
          ));
        });
      }
      posteriorElement.add(spinous);

      if (dims.kind === 'subaxial') {
        [-1, 1].forEach(side => {
          const ring = mesh(new THREE.TorusGeometry(dims.height * .10, dims.height * .022, 7, 14), materials.boneDark, `transverseForamen:${side > 0 ? 'left' : 'right'}`);
          ring.position.set(dims.width * .37, dims.height * .49, side * dims.depth * .47);
          posteriorElement.add(ring);
        });
      }
      if (dims.kind === 'thoracic') {
        [-1, 1].forEach(side => {
          const facetPatch = mesh(new THREE.SphereGeometry(dims.height * .075, 10, 7), materials.boneDark, `costalFacet:${side > 0 ? 'left' : 'right'}`);
          facetPatch.scale.set(.50, .80, .32);
          facetPatch.position.set(dims.width * .33, dims.height * .52, side * dims.depth * .50);
          posteriorElement.add(facetPatch);
        });
      }
      anatomyRoot.add(posteriorElement);

      const ligaments = createLigamentBands(level);
      anatomyRoot.add(ligaments.layer);

      // Surgical markers use the source surface's own millimetre bounding frame
      // whenever that surface exists. This keeps a planned resection footprint
      // local to the operated vertebra without claiming semantic CT subtraction.
      const sourceBounds = referenceBoundsFor(level.superior);
      const resectionFrame = sourceBounds
        ? {
            center: sourceLocalPoint(level, sourceBounds.center),
            size: sourceBounds.size.clone().multiplyScalar(REFERENCE_MM_TO_SCENE),
            source: 'source_ct_bounding_frame'
          }
        : {
            center: new THREE.Vector3(0, dims.height * .50, 0),
            size: new THREE.Vector3(dims.width, dims.height, dims.depth),
            source: 'procedural_fallback_frame'
          };
      const resectionCenter = resectionFrame.center;
      const resectionSize = resectionFrame.size;

      const cutSurfaces = new THREE.Group();
      cutSurfaces.name = 'laminectomyCutSurfaces';
      [-1, 1].forEach(side => {
        const cut = mesh(new THREE.BoxGeometry(
          resectionSize.x * .055, resectionSize.y * .18, resectionSize.z * .09
        ), materials.cutSurface, `laminaCutSurface:${side > 0 ? 'left' : 'right'}`);
        cut.position.set(
          resectionCenter.x + resectionSize.x * .24,
          resectionCenter.y,
          resectionCenter.z + side * resectionSize.z * .14
        );
        cut.userData = {
          representation: 'planned posterior cut-margin marker; intact CT mesh is not subtracted',
          frameSource: resectionFrame.source, cutSafetyValidated: false
        };
        cutSurfaces.add(cut);
      });
      cutSurfaces.visible = false;
      cutSurfaces.userData = {
        representation: 'planned posterior cut-margin markers; intact CT mesh is not subtracted',
        frameSource: resectionFrame.source, cutSafetyValidated: false
      };
      const decompressionVoid = mesh(new THREE.BoxGeometry(
        resectionSize.x * .22, resectionSize.y * .40, resectionSize.z * .34
      ), materials.canalVoid, 'plannedPosteriorResectionEnvelope');
      decompressionVoid.position.set(
        resectionCenter.x + resectionSize.x * .24,
        resectionCenter.y,
        resectionCenter.z
      );
      decompressionVoid.visible = false;
      decompressionVoid.userData = {
        representation: 'planned posterior resection envelope; intact CT mesh is not subtracted',
        frameSource: resectionFrame.source, cutSafetyValidated: false
      };

      // A PSO is shown as a translucent, source-bounded planned wedge envelope
      // over the intact CT surface. It does not pretend that a whole-bone mesh
      // has been subtracted, nor does it infer a safe osteotomy trajectory.
      const osteotomyRemnants = new THREE.Group();
      osteotomyRemnants.name = 'psoPlannedWedgeEnvelope';
      if (dims.kind !== 'atlas') {
        const wedgeWidth = resectionSize.x * .44;
        const wedgeHalfHeight = resectionSize.y * .18;
        const wedge = mesh(extrudedProfileGeometry([
          [-wedgeWidth * .48, 0],
          [wedgeWidth * .50, wedgeHalfHeight],
          [wedgeWidth * .50, -wedgeHalfHeight]
        ], resectionSize.z * .62, Math.max(.001, resectionSize.y * .012)), materials.osteotomyEnvelope, 'plannedPsoThreeColumnWedge');
        wedge.userData = {
          representation: 'planned PSO three-column wedge envelope over intact CT',
          frameSource: resectionFrame.source, ctMeshSubtracted: false,
          cutSafetyValidated: false, corridorValidated: false
        };
        osteotomyRemnants.add(wedge);
        osteotomyRemnants.position.set(
          resectionCenter.x - resectionSize.x * .09,
          resectionCenter.y,
          resectionCenter.z
        );
      }
      osteotomyRemnants.visible = false;
      osteotomyRemnants.userData = {
        representation: 'planned PSO wedge envelope; intact CT mesh is not subtracted',
        frameSource: resectionFrame.source, ctMeshSubtracted: false,
        cutSafetyValidated: false, corridorValidated: false
      };
      anatomyRoot.add(cutSurfaces, decompressionVoid, osteotomyRemnants);

      const hardwareLayer = new THREE.Group();
      hardwareLayer.name = 'hardwareLayer';
      hardwareLayer.userData = { representation: 'illustrative hardware; no sizing or trajectory validation' };
      anatomyRoot.add(hardwareLayer);

      const osteophytes = new THREE.Group();
      osteophytes.name = 'osteophytes';
      // A whole-bone CT surface does not provide a segmented endplate rim or
      // osteophyte base. Earlier builds placed generic cones around the
      // procedural envelope; after source-frame deformation those could float
      // beside the actual vertebra and read as sharp bony anatomy. Fail closed:
      // preserve the authored burden as metadata and render no invented solid
      // until a level-specific segmented growth surface is supplied.
      osteophytes.userData = {
        geometryMode: 'withheld_unsegmented',
        representation: 'osteophyte burden metadata only; no invented marginal solid',
        withheldReason: 'No segmented osteophyte base or endplate-margin surface is available.',
        patientSpecific: false
      };
      osteophytes.visible = false;
      anatomyRoot.add(osteophytes);

      const highlight = mesh(new THREE.BoxGeometry(dims.width * 1.18, dims.height * .82, dims.depth * 1.2), materials.highlight, 'levelHighlight');
      highlight.position.y = dims.height * .49;
      highlight.visible = false;
      anatomyRoot.add(highlight);

      return {
        level, group, anatomyRoot, referenceLayer, topsPostoperativeReferenceLayer, body, disc, endplates, posteriorElement,
        anatomy: { body, pedicles, laminae, facets, pars, transverseProcesses, spinous },
        ligaments,
        decompressionTargets: [laminae.left, laminae.right, spinous],
        cutSurfaces, decompressionVoid, interbodyResectionEnvelope, osteotomyRemnants,
        hardwareLayer, highlight, osteophytes, dims, height: dims.height,
        baseAnatomyY: 0,
        decompressed: false, osteotomyType: null, ligamentDisrupted: false,
        discReplaced: false, discExcised: false, interbodyApproach: null, topsReconstruction: false,
        topsAdjacentResection: false, topsResectionContext: null,
        geometryMode: referenceLayer.children.length ? 'ct_reference' : 'procedural_fallback'
      };
    }

    function createPelvis() {
      pelvisAnatomyLayer = new THREE.Group();
      pelvisAnatomyLayer.name = 'pelvisAnatomyLayer';
      pelvisAnatomyLayer.userData = { representation: 'procedural anatomical visualization; not patient-specific geometry' };
      siJointLayer = new THREE.Group();
      siJointLayer.name = 'siJointLayer';
      pelvisLigamentLayer = new THREE.Group();
      pelvisLigamentLayer.name = 'pelvisLigamentLayer';
      pelvisLigamentLayer.userData = { representation: 'reference attachment pathways only', mechanicsModeled: false };
      pelvicHardwareLayer = new THREE.Group();
      pelvicHardwareLayer.name = 'pelvicHardwareLayer';
      pelvicHardwareLayer.userData = { representation: 'illustrative implant placement; no sizing or trajectory validation' };
      pelvisReferenceLayer = createCoherentReferenceGroup(
        ['sacrum', 'hip_left', 'hip_right'], 'ctPelvisReferenceLayer'
      );
      sacralReferenceSurface = pelvisReferenceLayer.getObjectByName('ctReferenceSurface:sacrum') || null;
      if (sacralReferenceSurface) {
        sacralReferenceRestPosition.copy(sacralReferenceSurface.position);
        sacralReferenceSurface.userData = {
          ...sacralReferenceSurface.userData,
          pelvicIncidenceDisplayTransform: 'pivoted_source_surface_rotation_about_l5_s1_proxy',
          patientSpecificMorphology: false,
          siJointCongruityInferred: false
        };
      }
      pelvisAnatomyLayer.visible = pelvisReferenceLayer.children.length === 0;
      pelvisGroup.add(pelvisReferenceLayer, pelvisAnatomyLayer, siJointLayer, pelvisLigamentLayer, pelvicHardwareLayer);

      // The sacrum and innominates use explicit silhouettes rather than generic
      // boxes/spheres. Dimensions are normalized scene units, not clinical data.
      const sacrum = mesh(extrudedProfileGeometry([
        [-.66, .63], [.62, .63], [.52, .34], [.39, -.58],
        [.12, -.78], [-.20, -.74], [-.48, -.48], [-.63, .26]
      ], 1.34, .045), materials.boneDark, 'sacrum');
      sacrum.position.set(.02, .08, 0);
      sacrum.rotation.z = -.05;
      pelvisAnatomyLayer.add(sacrum);

      const sacralPlate = mesh(extrudedProfileGeometry([
        [-.72, -.06], [.64, -.06], [.70, .02], [.61, .10], [-.67, .10]
      ], 1.40, .018), materials.cortical, 'sacralEndplate');
      sacralPlate.position.set(.01, .76, 0);
      pelvisAnatomyLayer.add(sacralPlate);

      [-1, 1].forEach(side => {
        const label = side > 0 ? 'left' : 'right';
        const ilium = mesh(extrudedProfileGeometry([
          [-1.48, .84], [-.72, 1.18], [.35, 1.04], [.86, .52],
          [.77, -.22], [.28, -.77], [-.45, -.94], [-1.05, -.54]
        ], .34, .045), materials.bone, `ilium:${label}`);
        ilium.position.set(-.05, -.02, side * 1.03);
        ilium.rotation.y = side * -.10;
        pelvisAnatomyLayer.add(ilium);

        const acetabulum = mesh(new THREE.TorusGeometry(.40, .085, 10, 28), materials.cortical, `acetabularRim:${label}`);
        acetabulum.position.set(-.20, -.72, side * 1.23);
        acetabulum.rotation.x = Math.PI / 2;
        acetabulum.rotation.y = side * .14;
        pelvisAnatomyLayer.add(acetabulum);

        const pubicRamus = tubeThrough([
          new THREE.Vector3(-.27, -.69, side * 1.10),
          new THREE.Vector3(-.72, -.94, side * .73),
          new THREE.Vector3(-.82, -.92, side * .18)
        ], .095, materials.boneDark, `pubicRamus:${label}`, 18);
        const ischialRamus = tubeThrough([
          new THREE.Vector3(-.08, -.77, side * 1.15),
          new THREE.Vector3(.20, -1.25, side * 1.06),
          new THREE.Vector3(-.28, -1.34, side * .72)
        ], .13, materials.boneDark, `ischialRamus:${label}`, 18);
        pelvisAnatomyLayer.add(pubicRamus, ischialRamus);

        const femoralHead = mesh(new THREE.SphereGeometry(.39, 20, 14), materials.boneDark, `femoralHead:${label}`);
        femoralHead.position.set(-.25, -.73, side * 1.40);
        pelvisAnatomyLayer.add(femoralHead);

        const siSurface = mesh(new THREE.BoxGeometry(.64, .82, .035), materials.siJoint, `sacroiliacJoint:${label}`);
        siSurface.position.set(.03, .18, side * .72);
        siSurface.rotation.x = side * .10;
        siSurface.userData = { representation: 'illustrative SI joint surface; no diagnostic grading' };
        siJointLayer.add(siSurface);

        const posteriorSILigament = tubeThrough([
          new THREE.Vector3(.27, .55, side * .64),
          new THREE.Vector3(.50, .66, side * .88),
          new THREE.Vector3(.62, .46, side * 1.02)
        ], .035, materials.ligamentPosterior, `posteriorSILigament:${label}`, 12);
        const anteriorSILigament = tubeThrough([
          new THREE.Vector3(-.34, .46, side * .62),
          new THREE.Vector3(-.48, .36, side * .84),
          new THREE.Vector3(-.58, .18, side * 1.01)
        ], .030, materials.ligamentAnterior, `anteriorSILigament:${label}`, 12);
        const interosseousSILigament = cylinderBetween(
          new THREE.Vector3(.10, .28, side * .66),
          new THREE.Vector3(.12, .28, side * 1.00),
          .052, materials.ligamentPosterior, `interosseousSILigament:${label}`, 9
        );
        const iliolumbarLigament = tubeThrough([
          new THREE.Vector3(.34, .79, side * .46),
          new THREE.Vector3(.18, .91, side * .76),
          new THREE.Vector3(-.02, .88, side * 1.10)
        ], .032, materials.ligamentAnterior, `iliolumbarLigament:${label}`, 12);
        const sacrospinousLigament = cylinderBetween(
          new THREE.Vector3(.18, -.33, side * .42),
          new THREE.Vector3(.03, -.88, side * 1.04),
          .032, materials.ligamentPosterior, `sacrospinousLigament:${label}`, 9
        );
        const sacrotuberousLigament = tubeThrough([
          new THREE.Vector3(.31, -.44, side * .44),
          new THREE.Vector3(.28, -.93, side * .78),
          new THREE.Vector3(.18, -1.27, side * 1.06)
        ], .041, materials.ligamentAnterior, `sacrotuberousLigament:${label}`, 13);
        pelvisLigamentLayer.add(
          posteriorSILigament, anteriorSILigament, interosseousSILigament,
          iliolumbarLigament, sacrospinousLigament, sacrotuberousLigament
        );

        [-.28, .18].forEach((y, index) => {
          const foramen = mesh(new THREE.TorusGeometry(.105, .025, 7, 18), materials.canalVoid, `sacralForamen:${label}:${index + 1}`);
          foramen.position.set(-.16, y, side * .69);
          foramen.rotation.x = Math.PI / 2;
          pelvisAnatomyLayer.add(foramen);
        });
      });

      // Explicit posterosuperior S1 reference used by the visual plumb line.
      s1Landmark = new THREE.Object3D();
      s1Landmark.name = 'posterosuperiorS1';
      const s1Bounds = referenceBoundsFor('S1');
      if (s1Bounds) {
        s1Landmark.position.set(
          s1Bounds.center.x + s1Bounds.size.x * .34,
          s1Bounds.center.y + s1Bounds.size.y * .34,
          s1Bounds.center.z
        ).multiplyScalar(REFERENCE_MM_TO_SCENE);
      } else {
        s1Landmark.position.set(.64, .84, 0);
      }
      s1Landmark.userData = { sourceFrameDerived: Boolean(s1Bounds), landmarkValidated: false };
      pelvisGroup.add(s1Landmark);
    }

    function createSacralMorphologyRoot(sacrumSourceAnchor) {
      const sourcePivot = motionSegmentPivotFor('L5-S1', 'sacrum') || sacrumSourceAnchor.clone();
      sacralMorphologyPivotAppMm.copy(sourcePivot);
      sacralMorphologyPivotScene.copy(sourcePivot).sub(sacrumSourceAnchor).multiplyScalar(REFERENCE_MM_TO_SCENE);

      sacralMorphologyRoot = new THREE.Group();
      sacralMorphologyRoot.name = 'authoredSacralBaseMorphologyRoot';
      sacralMorphologyRoot.position.copy(sacralMorphologyPivotScene);
      sacralMorphologyRoot.userData = {
        representation: 'authored pelvic-incidence morphology display surrogate',
        pivot: 'L5-S1 anterior-central source-surface proxy',
        pivotAppMm: sourcePivot.toArray(),
        patientSpecific: false,
        sourceSacrumRigidlyPivoted: true,
        siJointCongruityInferred: false,
        ligamentRemodelingInferred: false,
        basePosition: sacralMorphologyRoot.position.clone()
      };
      pelvisGroup.add(sacralMorphologyRoot);

      pelvicIncidenceGuide = new THREE.Group();
      pelvicIncidenceGuide.name = 'pelvicIncidenceMorphologyGuide';
      const endplateMaterial = new THREE.LineBasicMaterial({
        color: 0x22d3ee, transparent: true, opacity: .94, depthTest: false
      });
      const normalMaterial = new THREE.LineDashedMaterial({
        color: 0x38bdf8, dashSize: .12, gapSize: .07, transparent: true, opacity: .86, depthTest: false
      });
      const endplateLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-.82, 0, 0), new THREE.Vector3(.82, 0, 0)
        ]), endplateMaterial
      );
      endplateLine.name = 'authoredS1EndplateAxis';
      const normalLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, .82, 0)
        ]), normalMaterial
      );
      normalLine.name = 'authoredS1EndplateNormal';
      normalLine.computeLineDistances();
      pelvicIncidenceGuide.add(endplateLine, normalLine);
      pelvicIncidenceGuide.visible = false;
      pelvicIncidenceGuide.renderOrder = 12;
      pelvicIncidenceGuide.userData = {
        representation: 'auditable PI orientation guide; not a segmented endplate or validated landmark',
        followsMorphologyRoot: true
      };
      sacralMorphologyRoot.add(pelvicIncidenceGuide);

      if (s1Landmark?.parent === pelvisGroup) {
        const priorPosition = s1Landmark.position.clone();
        pelvisGroup.remove(s1Landmark);
        s1Landmark.position.copy(priorPosition).sub(sacralMorphologyRoot.position);
        s1Landmark.userData = {
          ...s1Landmark.userData,
          followsPelvicIncidenceMorphology: true,
          patientSpecificMorphology: false
        };
        sacralMorphologyRoot.add(s1Landmark);
      }
      return sourcePivot;
    }

    function applySacralReferenceMorphologyTransform(angleRadians) {
      if (!sacralReferenceSurface) return false;
      const pivot = sacralMorphologyPivotAppMm;
      sacralReferenceSurface.rotation.set(0, 0, angleRadians);
      sacralReferenceSurface.position.copy(sacralReferenceRestPosition)
        .sub(pivot)
        .applyAxisAngle(LOCAL_Z_AXIS, angleRadians)
        .add(pivot);
      sacralReferenceSurface.userData.pelvicIncidenceMorphologyRotationDeg = THREE.MathUtils.radToDeg(angleRadians);
      applyPelvicIncidenceField(angleRadians);
      return true;
    }

    /* ---------------------------------------------------------------------
       Pelvic-incidence display field for the hip bones (v0.23.1).

       PI is posed by rotating the sacrum and spine about the L5-S1 proxy while
       the femoral-head axis and the world-rooted legs stay put, so the rigid CT
       innominates no longer met the rotated sacrum and earlier builds hid them
       (with the SI overlays, pelvic ligaments and pelvic hardware) at any PI
       other than the atlas value. Each innominate is now reshaped instead:
       every vertex rotates about the SAME pivot and axis as the sacrum, in the
       same app-mm frame, by w * theta, where theta is the sacrum's PI rotation
       and
         w = 1 inside the sacroiliac band (within sacroiliacBandMm of the rest
               sacrum), so the SI joint moves with the sacrum and stays congruent;
         w = 0 inside the acetabular zone (within acetabularZoneMm of the
               femoral-head proxy the hip axis is built on), so the socket stays
               concentric with the femoral head;
         w = smoothstep(dA / (dA + dS)) in between, dA and dS being the
               distances past those two zones, which spreads the blend over
               the whole ilium between them.
       Blending the angle rather than the position keeps the bone from
       collapsing. Weights are computed once from the undeformed rest geometry;
       at the atlas PI (theta = 0) the rest buffers are restored bit for bit.
       The SI-joint and pelvic-ligament overlays take the same field per vertex;
       pelvic implants stay rigid, anchored at their entry point and re-aimed
       at their deformed target. No reported landmark reads these vertices: the
       hip axis is the femoral-head proxy (atlas bounds) and S1 the S1 bounds,
       so every measured value is unchanged. This is a schematic educational
       reshaping, not patient anatomy.
    --------------------------------------------------------------------- */
    const PELVIC_INCIDENCE_FIELD = Object.freeze({
      id: 'pi-innominate-angle-blend-v1',
      // Moves rigidly with the sacrum. The normal adult SI joint space is 2 mm
      // or more on CT (Vogler JB et al., Radiology 1984;151:433-437, PMID
      // 6709915); 8 mm spans that space, both articular cortices and the
      // adjacent interosseous surface of this decimated mesh.
      sacroiliacBandMm: 8,
      // Stays fixed. The adult femoral-head radius is about 22-25 mm (Jamali AA
      // et al., Clin Orthop Relat Res 2013;471:3581-3587, PMID 23922189); 30 mm
      // adds a margin for the acetabular rim.
      acetabularZoneMm: 30,
      // Damped animation steps smaller than this are skipped until the target
      // is reached exactly (1e-6 rad moves a vertex 150 mm from the pivot by
      // 0.15 micrometre).
      updateEpsilonRad: 1e-6,
      // Bucket size of the nearest-sacrum-vertex search.
      clusterCellMm: 24
    });

    // Local-to-pelvis matrix of an object below pelvisGroup. It excludes the
    // live pelvic posture, so it is the same at every PT.
    function pelvisRelativeMatrix(object) {
      const chain = [];
      for (let cursor = object; cursor && cursor !== pelvisGroup; cursor = cursor.parent) chain.push(cursor);
      if (!chain.length || chain[chain.length - 1].parent !== pelvisGroup) return null;
      const matrix = new THREE.Matrix4();
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        chain[index].updateMatrix();
        matrix.multiply(chain[index].matrix);
      }
      return matrix;
    }

    function buildPointClusters(points, cellMm) {
      const buckets = new Map();
      for (let offset = 0; offset < points.length; offset += 3) {
        const key = `${Math.floor(points[offset] / cellMm)},${Math.floor(points[offset + 1] / cellMm)},${Math.floor(points[offset + 2] / cellMm)}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(points[offset], points[offset + 1], points[offset + 2]);
      }
      const clusters = [...buckets.values()].map(values => Float64Array.from(values));
      const boxes = new Float64Array(clusters.length * 6);
      clusters.forEach((cluster, index) => {
        const box = index * 6;
        boxes.fill(Infinity, box, box + 3);
        boxes.fill(-Infinity, box + 3, box + 6);
        for (let offset = 0; offset < cluster.length; offset += 3) {
          for (let axis = 0; axis < 3; axis += 1) {
            boxes[box + axis] = Math.min(boxes[box + axis], cluster[offset + axis]);
            boxes[box + 3 + axis] = Math.max(boxes[box + 3 + axis], cluster[offset + axis]);
          }
        }
      });
      return { clusters, boxes, bounds: new Float64Array(clusters.length) };
    }

    function nearestSquaredInCluster(cluster, x, y, z, best) {
      for (let offset = 0; offset < cluster.length; offset += 3) {
        const dx = x - cluster[offset];
        const dy = y - cluster[offset + 1];
        const dz = z - cluster[offset + 2];
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < best) best = distance;
      }
      return best;
    }

    // Exact distance to the nearest point: the cluster whose box is nearest
    // seeds the bound, then only clusters whose box is closer are scanned.
    function nearestClusterPointDistance(index, x, y, z) {
      const { clusters, boxes, bounds } = index;
      let first = -1;
      let firstBound = Infinity;
      for (let cluster = 0; cluster < clusters.length; cluster += 1) {
        const box = cluster * 6;
        const dx = x < boxes[box] ? boxes[box] - x : x > boxes[box + 3] ? x - boxes[box + 3] : 0;
        const dy = y < boxes[box + 1] ? boxes[box + 1] - y : y > boxes[box + 4] ? y - boxes[box + 4] : 0;
        const dz = z < boxes[box + 2] ? boxes[box + 2] - z : z > boxes[box + 5] ? z - boxes[box + 5] : 0;
        const bound = dx * dx + dy * dy + dz * dz;
        bounds[cluster] = bound;
        if (bound < firstBound) {
          firstBound = bound;
          first = cluster;
        }
      }
      if (first < 0) return Infinity;
      let best = nearestSquaredInCluster(clusters[first], x, y, z, Infinity);
      for (let cluster = 0; cluster < clusters.length; cluster += 1) {
        if (cluster !== first && bounds[cluster] < best) best = nearestSquaredInCluster(clusters[cluster], x, y, z, best);
      }
      return Math.sqrt(best);
    }

    // Blend weight at an app-mm point of the pelvis reference frame.
    function pelvicIncidenceWeightAt(field, x, y, z) {
      const sacroiliacExcess = nearestClusterPointDistance(field.sacrumIndex, x, y, z) - PELVIC_INCIDENCE_FIELD.sacroiliacBandMm;
      if (!(sacroiliacExcess > 0)) return 1;
      let acetabularDistance = Infinity;
      field.femoralHeadCentres.forEach(centre => {
        acetabularDistance = Math.min(acetabularDistance, Math.hypot(x - centre.x, y - centre.y, z - centre.z));
      });
      const acetabularExcess = acetabularDistance - PELVIC_INCIDENCE_FIELD.acetabularZoneMm;
      if (!(acetabularExcess > 0)) return 0;
      const blend = acetabularExcess / (acetabularExcess + sacroiliacExcess);
      return blend * blend * (3 - 2 * blend);
    }

    function rotatePointAboutPivotZ(point, pivot, angleRadians) {
      const cosine = Math.cos(angleRadians);
      const sine = Math.sin(angleRadians);
      const dx = point.x - pivot.x;
      const dy = point.y - pivot.y;
      return new THREE.Vector3(pivot.x + cosine * dx - sine * dy, pivot.y + sine * dx + cosine * dy, point.z);
    }

    // toMm maps the mesh's local coordinates to the pelvis reference frame
    // (null for the innominates, which sit untransformed in that frame).
    function createPelvicVertexSet(field, surface, toMm, label) {
      const geometry = surface.geometry;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal') || null;
      if (!position || position.isInterleavedBufferAttribute || normal?.isInterleavedBufferAttribute) return null;
      const count = position.count;
      const restMm = new Float64Array(count * 3);
      const weights = new Float64Array(count);
      const point = new THREE.Vector3();
      let sacroiliacBandVertices = 0;
      let acetabularZoneVertices = 0;
      for (let index = 0; index < count; index += 1) {
        point.fromBufferAttribute(position, index);
        if (toMm) point.applyMatrix4(toMm);
        restMm[index * 3] = point.x;
        restMm[index * 3 + 1] = point.y;
        restMm[index * 3 + 2] = point.z;
        weights[index] = pelvicIncidenceWeightAt(field, point.x, point.y, point.z);
        if (weights[index] === 1) sacroiliacBandVertices += 1;
        else if (weights[index] === 0) acetabularZoneVertices += 1;
      }
      const toLocal = toMm ? toMm.clone().invert() : null;
      let restNormalsMm = null;
      if (toMm && normal) {
        const normalToMm = new THREE.Matrix3().getNormalMatrix(toMm);
        restNormalsMm = new Float64Array(count * 3);
        for (let index = 0; index < count; index += 1) {
          point.fromBufferAttribute(normal, index).applyMatrix3(normalToMm).normalize();
          restNormalsMm[index * 3] = point.x;
          restNormalsMm[index * 3 + 1] = point.y;
          restNormalsMm[index * 3 + 2] = point.z;
        }
      }
      return {
        label, surface, geometry, position, normal, count, restMm, weights,
        restPositions: position.array.slice(),
        restNormals: normal ? normal.array.slice() : null,
        restBoundingBox: geometry.boundingBox ? geometry.boundingBox.clone() : null,
        restBoundingSphere: geometry.boundingSphere ? geometry.boundingSphere.clone() : null,
        toLocal,
        normalToLocal: toLocal ? new THREE.Matrix3().getNormalMatrix(toLocal) : null,
        restNormalsMm,
        // The closed CT surfaces get true normals; the thin tube and box
        // overlays keep their analytic normals, rotated with the field, so
        // their UV seams do not show.
        recomputeNormals: !toMm,
        sacroiliacBandVertices,
        acetabularZoneVertices
      };
    }

    function buildPelvicIncidenceField() {
      const started = performance.now();
      const unavailable = reason => ({ ready: false, id: PELVIC_INCIDENCE_FIELD.id, reason });
      if (!pelvisGroup || !pelvisReferenceLayer?.children.length || !sacralReferenceSurface?.geometry) {
        return unavailable('The CT pelvis reference surfaces are unavailable.');
      }
      const innominates = ['left', 'right'].map(side => ({
        side, surface: pelvisReferenceLayer.getObjectByName(`ctReferenceSurface:hip_${side}`) || null
      }));
      const untransformed = surface => surface.position.lengthSq() === 0
        && surface.quaternion.equals(new THREE.Quaternion())
        && surface.scale.equals(new THREE.Vector3(1, 1, 1));
      if (innominates.some(({ surface }) => !surface?.geometry?.getAttribute('position') || !untransformed(surface))) {
        return unavailable('The CT innominate surfaces are missing or no longer in the source frame.');
      }
      const femoralHeadCentres = ['left', 'right'].map(side => referenceBoundsFor(`femur_${side}`)?.center || null);
      if (femoralHeadCentres.some(centre => !centre)) return unavailable('The femoral-head proxies are unavailable.');
      const referenceMatrix = pelvisRelativeMatrix(pelvisReferenceLayer);
      if (!referenceMatrix) return unavailable('The pelvis reference frame is detached.');
      const sacrumPosition = sacralReferenceSurface.geometry.getAttribute('position');
      const sacrumPoints = new Float64Array(sacrumPosition.count * 3);
      for (let index = 0; index < sacrumPosition.count; index += 1) {
        sacrumPoints[index * 3] = sacrumPosition.getX(index) + sacralReferenceRestPosition.x;
        sacrumPoints[index * 3 + 1] = sacrumPosition.getY(index) + sacralReferenceRestPosition.y;
        sacrumPoints[index * 3 + 2] = sacrumPosition.getZ(index) + sacralReferenceRestPosition.z;
      }
      const field = {
        ready: true,
        id: PELVIC_INCIDENCE_FIELD.id,
        pivot: sacralMorphologyPivotAppMm.clone(),
        femoralHeadCentres,
        sacrumIndex: buildPointClusters(sacrumPoints, PELVIC_INCIDENCE_FIELD.clusterCellMm),
        referenceInverse: referenceMatrix.clone().invert(),
        appliedAngle: 0,
        innominateSets: [],
        overlaySets: [],
        updates: 0,
        lastUpdateMs: 0,
        maxUpdateMs: 0
      };
      for (const { side, surface } of innominates) {
        const set = createPelvicVertexSet(field, surface, null, `innominate:${side}`);
        if (!set) return unavailable(`The ${side} innominate buffers cannot be reshaped.`);
        set.side = side;
        field.innominateSets.push(set);
        surface.userData = {
          ...surface.userData,
          pelvicIncidenceDisplayField: 'angle-blended rotation about the L5-S1 proxy; SI band moves with the sacrum, acetabular zone fixed',
          patientSpecificMorphology: false
        };
      }
      [siJointLayer, pelvisLigamentLayer].filter(Boolean).forEach(layer => layer.traverse(object => {
        if (!object.isMesh) return;
        const objectMatrix = pelvisRelativeMatrix(object);
        if (!objectMatrix) return;
        const set = createPelvicVertexSet(field, object, field.referenceInverse.clone().multiply(objectMatrix), `overlay:${object.name}`);
        if (set) field.overlaySets.push(set);
      }));
      field.buildMs = performance.now() - started;
      return field;
    }

    function ensurePelvicIncidenceField() {
      if (!pelvicIncidenceField) pelvicIncidenceField = buildPelvicIncidenceField();
      return pelvicIncidenceField.ready ? pelvicIncidenceField : null;
    }

    function deformPelvicVertexSet(set, angleRadians, pivot) {
      const { geometry, position, normal, count, restMm, weights } = set;
      const positions = position.array;
      if (angleRadians === 0) {
        positions.set(set.restPositions);
        position.needsUpdate = true;
        if (normal && set.restNormals) {
          normal.array.set(set.restNormals);
          normal.needsUpdate = true;
        }
        geometry.boundingBox = set.restBoundingBox ? set.restBoundingBox.clone() : null;
        geometry.boundingSphere = set.restBoundingSphere ? set.restBoundingSphere.clone() : null;
        return;
      }
      const normals = normal && !set.recomputeNormals ? normal.array : null;
      const local = set.toLocal?.elements || null;
      const normalLocal = set.normalToLocal?.elements || null;
      for (let index = 0; index < count; index += 1) {
        const offset = index * 3;
        let x = restMm[offset];
        let y = restMm[offset + 1];
        const z = restMm[offset + 2];
        const weight = weights[index];
        let cosine = 1;
        let sine = 0;
        if (weight !== 0) {
          const angle = weight * angleRadians;
          cosine = Math.cos(angle);
          sine = Math.sin(angle);
          const dx = x - pivot.x;
          const dy = y - pivot.y;
          x = pivot.x + cosine * dx - sine * dy;
          y = pivot.y + sine * dx + cosine * dy;
        }
        if (local) {
          positions[offset] = local[0] * x + local[4] * y + local[8] * z + local[12];
          positions[offset + 1] = local[1] * x + local[5] * y + local[9] * z + local[13];
          positions[offset + 2] = local[2] * x + local[6] * y + local[10] * z + local[14];
        } else {
          positions[offset] = x;
          positions[offset + 1] = y;
          positions[offset + 2] = z;
        }
        if (normals && normalLocal && set.restNormalsMm) {
          const nx0 = set.restNormalsMm[offset];
          const ny0 = set.restNormalsMm[offset + 1];
          const nz = set.restNormalsMm[offset + 2];
          const nx = cosine * nx0 - sine * ny0;
          const ny = sine * nx0 + cosine * ny0;
          const lx = normalLocal[0] * nx + normalLocal[3] * ny + normalLocal[6] * nz;
          const ly = normalLocal[1] * nx + normalLocal[4] * ny + normalLocal[7] * nz;
          const lz = normalLocal[2] * nx + normalLocal[5] * ny + normalLocal[8] * nz;
          const length = Math.hypot(lx, ly, lz) || 1;
          normals[offset] = lx / length;
          normals[offset + 1] = ly / length;
          normals[offset + 2] = lz / length;
        }
      }
      position.needsUpdate = true;
      if (set.recomputeNormals) geometry.computeVertexNormals();
      else if (normals) normal.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }

    /* Pelvic implants stay rigid. Each one is anchored at its entry point,
       moved by the field there, and re-aimed at where the field puts its
       target, so a screw crossing the blend keeps its corridor instead of
       bending or leaving the bone. A connector rod shares its screw's anchor
       and target, so it stays on the screw head. */
    function applyPelvicHardwareField(field = pelvicIncidenceField) {
      if (!field?.ready || !pelvicHardwareLayer) return;
      const angleRadians = field.appliedAngle;
      pelvicHardwareLayer.children.forEach(root => root.children.forEach(implant => {
        const data = implant.userData || {};
        if (!Array.isArray(data.pelvicAnchorScene) || !Array.isArray(data.pelvicAimScene)) return;
        if ((data.pelvicFieldAngle ?? 0) === angleRadians) return;
        if (!data.pelvicRestTransform) {
          data.pelvicRestTransform = Object.freeze({
            position: implant.position.toArray(), quaternion: implant.quaternion.toArray(), scale: implant.scale.toArray()
          });
        }
        const rest = data.pelvicRestTransform;
        implant.position.fromArray(rest.position);
        implant.quaternion.fromArray(rest.quaternion);
        implant.scale.fromArray(rest.scale);
        data.pelvicFieldAngle = angleRadians;
        if (angleRadians === 0) return;
        const rootMatrix = pelvisRelativeMatrix(root);
        if (!rootMatrix) return;
        const toMm = field.referenceInverse.clone().multiply(rootMatrix);
        const anchor = new THREE.Vector3().fromArray(data.pelvicAnchorScene).applyMatrix4(toMm);
        const aim = new THREE.Vector3().fromArray(data.pelvicAimScene).applyMatrix4(toMm);
        const anchorAngle = pelvicIncidenceWeightAt(field, anchor.x, anchor.y, anchor.z) * angleRadians;
        const aimAngle = pelvicIncidenceWeightAt(field, aim.x, aim.y, aim.z) * angleRadians;
        const movedAnchor = rotatePointAboutPivotZ(anchor, field.pivot, anchorAngle);
        const movedAim = rotatePointAboutPivotZ(aim, field.pivot, aimAngle);
        const anchorRotation = new THREE.Quaternion().setFromAxisAngle(LOCAL_Z_AXIS, anchorAngle);
        const carriedDirection = aim.clone().sub(anchor).normalize().applyQuaternion(anchorRotation);
        const movedDirection = movedAim.clone().sub(movedAnchor).normalize();
        const rotation = new THREE.Quaternion().setFromUnitVectors(carriedDirection, movedDirection).multiply(anchorRotation);
        const rigid = new THREE.Matrix4().makeRotationFromQuaternion(rotation)
          .setPosition(movedAnchor.clone().sub(anchor.clone().applyQuaternion(rotation)));
        const restMatrix = new THREE.Matrix4().compose(implant.position, implant.quaternion, implant.scale);
        toMm.clone().invert().multiply(rigid).multiply(toMm).multiply(restMatrix)
          .decompose(implant.position, implant.quaternion, implant.scale);
      }));
    }

    // Called with every applied sacral PI angle, including each damped frame.
    function applyPelvicIncidenceField(angleRadians) {
      const angle = finiteOr(angleRadians);
      if (!pelvicIncidenceField && angle === 0) return false;
      const field = ensurePelvicIncidenceField();
      if (!field) return false;
      const reachedTarget = angle === targetSacralMorphologyRotation;
      if (angle !== field.appliedAngle && (angle === 0 || reachedTarget
          || Math.abs(angle - field.appliedAngle) >= PELVIC_INCIDENCE_FIELD.updateEpsilonRad)) {
        const started = performance.now();
        [...field.innominateSets, ...field.overlaySets].forEach(set => deformPelvicVertexSet(set, angle, field.pivot));
        field.appliedAngle = angle;
        field.updates += 1;
        field.lastUpdateMs = performance.now() - started;
        field.maxUpdateMs = Math.max(field.maxUpdateMs, field.lastUpdateMs);
      }
      applyPelvicHardwareField(field);
      return true;
    }

    function pelvicIncidenceFieldDiagnostics() {
      const field = pelvicIncidenceField;
      if (!field) return { built: false, ready: false, id: PELVIC_INCIDENCE_FIELD.id, ...PELVIC_INCIDENCE_FIELD };
      if (!field.ready) return { built: true, ready: false, id: field.id, reason: field.reason };
      const weightRange = set => {
        let minimum = Infinity;
        let maximum = -Infinity;
        set.weights.forEach(weight => { minimum = Math.min(minimum, weight); maximum = Math.max(maximum, weight); });
        return [minimum, maximum];
      };
      return {
        built: true, ready: true, id: field.id,
        sacroiliacBandMm: PELVIC_INCIDENCE_FIELD.sacroiliacBandMm,
        acetabularZoneMm: PELVIC_INCIDENCE_FIELD.acetabularZoneMm,
        pivotAppMm: field.pivot.toArray(),
        femoralHeadCentresAppMm: field.femoralHeadCentres.map(centre => centre.toArray()),
        appliedAngleDeg: THREE.MathUtils.radToDeg(field.appliedAngle),
        updates: field.updates, buildMs: field.buildMs, lastUpdateMs: field.lastUpdateMs, maxUpdateMs: field.maxUpdateMs,
        innominates: field.innominateSets.map(set => ({
          side: set.side, vertices: set.count, sacroiliacBandVertices: set.sacroiliacBandVertices,
          acetabularZoneVertices: set.acetabularZoneVertices, weightRange: weightRange(set)
        })),
        overlays: field.overlaySets.map(set => ({ name: set.label, vertices: set.count, weightRange: weightRange(set) }))
      };
    }

    // App-mm image of a rest point under the field at angleRadians (tests).
    function pelvicIncidenceFieldPoint(pointAppMm, angleRadians) {
      const field = ensurePelvicIncidenceField();
      if (!field || !Array.isArray(pointAppMm) || pointAppMm.length !== 3) return null;
      const point = new THREE.Vector3().fromArray(pointAppMm);
      const weight = pelvicIncidenceWeightAt(field, point.x, point.y, point.z);
      return { weight, point: rotatePointAboutPivotZ(point, field.pivot, weight * finiteOr(angleRadians)).toArray() };
    }

    const LOWER_LIMB_FOOT_BONES = Object.freeze([
      'talus', 'calcaneus', 'navicular',
      'cuneiform_medial', 'cuneiform_intermediate', 'cuneiform_lateral', 'cuboid',
      'metatarsal_1', 'metatarsal_2', 'metatarsal_3', 'metatarsal_4', 'metatarsal_5'
    ]);

    function createBodyPartsLayer(boneNames, side, anchor, scale, name) {
      const layer = new THREE.Group();
      layer.name = name;
      const keys = boneNames.map(boneName => `${boneName}_${side}`);
      keys.forEach(boneKey => {
        const geometry = decodeLowerLimbGeometry(boneKey);
        if (!geometry) return;
        const surface = mesh(geometry, materials.referenceBone, `bodyParts3dSurface:${boneKey}`);
        surface.userData = {
          ...geometry.userData,
          referenceOnly: true,
          jointCentersValidated: false,
          compositeAtlas: true
        };
        layer.add(surface);
      });
      if (layer.children.length !== keys.length) {
        layer.clear();
        return layer;
      }
      layer.scale.setScalar(scale);
      layer.position.copy(anchor).multiplyScalar(-scale);
      layer.userData = {
        geometryMode: 'bodyparts3d_reference', side, boneKeys: keys,
        uniformScaleOnly: true, referenceOnly: true
      };
      return layer;
    }

    function createBodyPartsLowerLimbAssembly(side) {
      const anchors = LOWER_LIMB_ATLAS_DATA.manifest.anchors?.[side];
      if (!anchors || !['hip', 'knee', 'ankle', 'foot'].every(key => Array.isArray(anchors[key]) && anchors[key].length === 3)) return null;
      const hip = new THREE.Vector3().fromArray(anchors.hip);
      const knee = new THREE.Vector3().fromArray(anchors.knee);
      const ankle = new THREE.Vector3().fromArray(anchors.ankle);
      const sideAnchors = ['left', 'right'].map(key => LOWER_LIMB_ATLAS_DATA.manifest.anchors?.[key]);
      const femurLengths = sideAnchors.map(value => value
        ? new THREE.Vector3().fromArray(value.hip).distanceTo(new THREE.Vector3().fromArray(value.knee))
        : NaN);
      if (femurLengths.some(length => !Number.isFinite(length) || length < 300 || length > 600)) return null;
      const scale = 5.68 / ((femurLengths[0] + femurLengths[1]) * .5);
      const femurLayer = createBodyPartsLayer(['femur'], side, hip, scale, `bodyPartsFemur:${side}`);
      const lowerLegLayer = createBodyPartsLayer(['patella', 'tibia', 'fibula'], side, knee, scale, `bodyPartsLowerLeg:${side}`);
      const footLayer = createBodyPartsLayer(LOWER_LIMB_FOOT_BONES, side, ankle, scale, `bodyPartsFoot:${side}`);
      if (!femurLayer.children.length || lowerLegLayer.children.length !== 3 || footLayer.children.length !== LOWER_LIMB_FOOT_BONES.length) return null;
      return {
        scale, femurLayer, lowerLegLayer, footLayer,
        kneeOffset: knee.clone().sub(hip).multiplyScalar(scale),
        ankleOffset: ankle.clone().sub(knee).multiplyScalar(scale),
        anchors: { hip, knee, ankle, foot: new THREE.Vector3().fromArray(anchors.foot) }
      };
    }

    function createLowerExtremityContext() {
      lowerExtremityContext = new THREE.Group();
      lowerExtremityContext.name = 'lowerExtremityContext';
      lowerExtremityContext.userData = {
        representation: 'illustrative standing alignment context; not patient-specific and not used for compensation inference',
        mechanicsModeled: false
      };
      worldRoot.add(lowerExtremityContext);

      let lowerLimbReferenceSides = 0;
      [-1, 1].forEach(side => {
        const label = side > 0 ? 'left' : 'right';
        const hipPivot = new THREE.Group();
        hipPivot.name = `hipPivot:${label}`;
        const proximalFemurBounds = referenceBoundsFor(`femur_${label}`);
        if (proximalFemurBounds) hipPivot.position.copy(proximalFemurBounds.center).multiplyScalar(REFERENCE_MM_TO_SCENE);
        else hipPivot.position.set(-.25, -.73, side * 1.40);
        hipPivot.userData.sourceFrameDerived = Boolean(proximalFemurBounds);
        hipPivot.userData.targetRotationZ = 0;
        lowerExtremityContext.add(hipPivot);

        const neck = cylinderBetween(
          new THREE.Vector3(0, -.05, 0),
          new THREE.Vector3(.18, -.72, side * .17),
          .15, materials.boneDark, `femoralNeck:${label}`, 14
        );
        const shaft = cylinderBetween(
          new THREE.Vector3(.18, -.64, side * .17),
          new THREE.Vector3(.27, -5.65, side * .10),
          .19, materials.bone, `femoralShaft:${label}`, 16
        );
        const greaterTrochanter = mesh(new THREE.SphereGeometry(.25, 16, 12), materials.boneDark, `greaterTrochanter:${label}`);
        greaterTrochanter.scale.set(.78, 1.5, .92);
        greaterTrochanter.position.set(.16, -.80, side * .34);
        hipPivot.add(neck, shaft, greaterTrochanter);
        const proceduralBones = [neck, shaft, greaterTrochanter];

        const kneePivot = new THREE.Group();
        kneePivot.name = `kneePivot:${label}`;
        kneePivot.position.set(.27, -5.68, side * .10);
        kneePivot.userData.targetRotationZ = 0;
        hipPivot.add(kneePivot);
        [-1, 1].forEach(condyleSide => {
          const condyle = mesh(new THREE.SphereGeometry(.24, 16, 10), materials.cortical, `femoralCondyle:${label}:${condyleSide > 0 ? 'medial' : 'lateral'}`);
          condyle.scale.set(.85, .72, 1.08);
          condyle.position.set(0, 0, condyleSide * .16);
          kneePivot.add(condyle);
          proceduralBones.push(condyle);
        });
        const patella = mesh(new THREE.SphereGeometry(.15, 14, 10), materials.boneDark, `patella:${label}`);
        patella.scale.set(.55, 1.05, .78);
        patella.position.set(-.27, -.02, 0);
        kneePivot.add(patella);

        const tibia = cylinderBetween(new THREE.Vector3(.02, -.20, 0), new THREE.Vector3(.08, -4.18, 0), .15, materials.bone, `tibialShaft:${label}`, 14);
        const fibula = cylinderBetween(new THREE.Vector3(.04, -.25, side * .26), new THREE.Vector3(.08, -4.12, side * .22), .07, materials.boneDark, `fibularShaft:${label}`, 12);
        kneePivot.add(tibia, fibula);
        proceduralBones.push(patella, tibia, fibula);

        const anklePivot = new THREE.Group();
        anklePivot.name = `anklePivot:${label}`;
        anklePivot.position.set(.08, -4.20, 0);
        anklePivot.userData.targetRotationZ = 0;
        kneePivot.add(anklePivot);
        const talus = mesh(new THREE.SphereGeometry(.18, 14, 10), materials.cortical, `talus:${label}`);
        talus.scale.set(1.15, .72, .92);
        const foot = tubeThrough([
          new THREE.Vector3(0, -.04, 0),
          new THREE.Vector3(-.38, -.18, 0),
          new THREE.Vector3(-1.08, -.23, 0)
        ], .12, materials.boneDark, `footReference:${label}`, 16);
        anklePivot.add(talus, foot);
        proceduralBones.push(talus, foot);

        const referenceAssembly = createBodyPartsLowerLimbAssembly(label);
        if (referenceAssembly) {
          kneePivot.position.copy(referenceAssembly.kneeOffset);
          anklePivot.position.copy(referenceAssembly.ankleOffset);
          hipPivot.add(referenceAssembly.femurLayer);
          kneePivot.add(referenceAssembly.lowerLegLayer);
          anklePivot.add(referenceAssembly.footLayer);
          proceduralBones.forEach(object => { object.visible = false; });
          hipPivot.userData.lowerLimbGeometryMode = 'bodyparts3d_reference';
          hipPivot.userData.referenceScale = referenceAssembly.scale;
          lowerLimbReferenceSides += 1;
        } else {
          hipPivot.userData.lowerLimbGeometryMode = 'procedural_fallback';
        }

        const hipLandmark = new THREE.Object3D(); hipLandmark.name = `femoralHeadCenter:${label}`;
        const kneeLandmark = new THREE.Object3D(); kneeLandmark.name = `kneeCenter:${label}`; kneePivot.add(kneeLandmark);
        const ankleLandmark = new THREE.Object3D(); ankleLandmark.name = `ankleCenter:${label}`; anklePivot.add(ankleLandmark);
        hipPivot.add(hipLandmark);
      });
      lowerExtremityContext.userData.geometryMode = lowerLimbReferenceSides === 2
        ? 'bodyparts3d_bilateral_reference'
        : lowerLimbReferenceSides ? 'hybrid_reference_fallback' : 'procedural_fallback';
      if (lowerLimbReferenceSides === 2) {
        lowerExtremityContext.userData.representation = 'BodyParts3D v4 bilateral external bone surfaces; composite reference anatomy; heuristic joint pivots';
      }
      lowerExtremityContext.userData.legalReviewRequired = LOWER_LIMB_ATLAS_SOURCE.distributionLegalReview?.requiredBeforeAppStoreOrPlayStoreDistribution === true;
      lowerExtremityContext.visible = false;
      return lowerExtremityContext;
    }

    function configurePelvicPosturePivot() {
      if (!pelvisGroup || pelvisGroup.userData.posturePivotConfigured) return pelvisPosturePivot;
      const hipPivots = (lowerExtremityContext?.children || [])
        .filter(child => child.name.startsWith('hipPivot:'));
      if (hipPivots.length === 2) {
        pelvisPosturePivot.copy(hipPivots[0].position).add(hipPivots[1].position).multiplyScalar(.5);
      } else {
        const right = referenceBoundsFor('femur_right')?.center;
        const left = referenceBoundsFor('femur_left')?.center;
        if (right && left) pelvisPosturePivot.copy(right).add(left).multiplyScalar(.5 * REFERENCE_MM_TO_SCENE);
        else pelvisPosturePivot.set(0, 0, 0);
      }
      [...pelvisGroup.children].forEach(child => {
        child.position.sub(pelvisPosturePivot);
        if (child.userData?.basePosition?.isVector3) {
          child.userData.basePosition.copy(child.position);
          child.userData.targetPositionX = child.position.x;
          child.userData.targetPositionZ = child.position.z;
        }
      });
      pelvisGroup.position.copy(pelvisPosturePivot);
      targetPelvisPosition.copy(pelvisPosturePivot);
      pelvisGroup.userData.posturePivotConfigured = true;
      pelvisGroup.userData.posturePivot = 'bilateral femoral-head center proxy';
      pelvisGroup.userData.posturePivotScene = pelvisPosturePivot.toArray();
      return pelvisPosturePivot;
    }

    function setLowerExtremityVisibility(visible, frame = false) {
      if (!lowerExtremityContext) return false;
      const requested = Boolean(visible);
      if (state.globalDeformity) state.globalDeformity.lowerExtremitiesVisible = requested;
      if (state.layers) state.layers.lowerLimbs = requested;
      if (layerEls?.lowerLimbs) layerEls.lowerLimbs.checked = requested;
      if (labEls?.lowerExtremitiesVisible) labEls.lowerExtremitiesVisible.checked = requested;
      lowerExtremityContext.visible = requested
        && !state.inspection?.active;
      if (frame && camera && controls) resetCameraView();
      return lowerExtremityContext.visible;
    }

    function createDynamicLine(name, material) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(6);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(geometry, material);
      line.name = name;
      scene.add(line);
      return line;
    }

    function setLinePoints(line, a, b, recomputeDistances = false) {
      const positions = line.geometry.attributes.position.array;
      positions[0] = a.x; positions[1] = a.y; positions[2] = a.z;
      positions[3] = b.x; positions[4] = b.y; positions[5] = b.z;
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      if (recomputeDistances) line.computeLineDistances();
    }

    function createReferenceSystem() {
      const plumbMaterial = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: .82 });
      const cogMaterial = new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: .28, gapSize: .2, transparent: true, opacity: .92 });
      const connectorMaterial = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .65 });
      plumbLine = createDynamicLine('plumbLine', plumbMaterial);
      cogLine = createDynamicLine('c7CogLine', cogMaterial);
      svaConnector = createDynamicLine('svaConnector', connectorMaterial);
      pelvicIncidenceRadiusLine = createDynamicLine(
        'pelvicIncidenceHipAxisToS1',
        new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: .18, gapSize: .10, transparent: true, opacity: .74 })
      );
      pelvicIncidenceRadiusLine.computeLineDistances();
      pelvicIncidenceRadiusLine.userData = {
        representation: 'hip-axis-to-S1 display guide; not a validated radiographic measurement',
        patientSpecific: false
      };
      c7Marker = mesh(new THREE.SphereGeometry(.13, 16, 12), materials.amber, 'c7CogMarker');
      scene.add(c7Marker);
    }

    function createScrewAssembly(start, end, radius, material, name = 'pedicleScrew') {
      const assembly = new THREE.Group();
      assembly.name = name;
      const shaft = cylinderBetween(start, end, radius, material, `${name}:shaft`, 12);
      const direction = end.clone().sub(start).normalize();
      const headEnd = start.clone().sub(direction.clone().multiplyScalar(radius * 2.3));
      const head = cylinderBetween(start, headEnd, radius * 1.65, materials.metal, `${name}:tulip`, 12);
      const collar = mesh(new THREE.SphereGeometry(radius * 1.48, 12, 8), materials.metal, `${name}:collar`);
      collar.position.copy(start);
      assembly.add(shaft, head, collar);
      assembly.userData = { representation: 'illustrative screw; trajectory and sizing are not validated' };
      return assembly;
    }

    function addScrewPair(root, dims, material, zOffset = 0) {
      [-1, 1].forEach(side => {
        const start = new THREE.Vector3(dims.width * .83, dims.height * .49, side * dims.depth * .30 + zOffset);
        const end = new THREE.Vector3(dims.width * .02, dims.height * .27, side * dims.depth * .10 + zOffset);
        root.add(createScrewAssembly(start, end, .052, material, `pedicleScrew:${side > 0 ? 'left' : 'right'}`));

        const rod = tubeThrough([
          new THREE.Vector3(dims.width * .91, dims.height * .08, side * dims.depth * .32 + zOffset),
          new THREE.Vector3(dims.width * .89, dims.height * .50, side * dims.depth * .32 + zOffset),
          new THREE.Vector3(dims.width * .86, dims.height * .91, side * dims.depth * .32 + zOffset)
        ], .043, material, `posteriorRod:${side > 0 ? 'left' : 'right'}`, 10);
        root.add(rod);
      });
    }

    function addCage(root, dims, anterior = false) {
      const w = dims.width * .64;
      const h = dims.height * .20;
      const cage = mesh(extrudedProfileGeometry([
        [-w * .5, -h * .36], [w * .48, -h * .5], [w * .5, h * .48], [-w * .46, h * .35]
      ], dims.depth * .68, h * .16), materials.cage, 'interbodyCage');
      cage.position.set(anterior ? -dims.width * .14 : dims.width * .02, dims.height * .08, 0);
      cage.userData = { representation: 'illustrative interbody device; footprint and lordosis are not patient-specific' };
      root.add(cage);
    }

    function addAnteriorPlate(root, dims) {
      const plateHeight = dims.height * .66;
      const plate = mesh(extrudedProfileGeometry([
        [-.045, -plateHeight * .5], [.045, -plateHeight * .5], [.075, -plateHeight * .36],
        [.075, plateHeight * .36], [.045, plateHeight * .5], [-.045, plateHeight * .5], [-.075, plateHeight * .36], [-.075, -plateHeight * .36]
      ], dims.depth * .58, .012), materials.plate, 'anteriorPlate');
      plate.position.set(-dims.width * .58, dims.height * .40, 0);
      root.add(plate);
      [-1, 1].forEach(side => {
        const start = new THREE.Vector3(-dims.width * .61, dims.height * (.40 + side * .20), side * dims.depth * .15);
        const end = new THREE.Vector3(-dims.width * .31, dims.height * (.40 + side * .12), side * dims.depth * .08);
        root.add(createScrewAssembly(start, end, .034, materials.plate, `anteriorFastener:${side > 0 ? 'superior' : 'inferior'}`));
      });
    }

    const sceneFromMm = valueMm => Number(valueMm) * REFERENCE_MM_TO_SCENE;

    function implantComponent(plan, role) {
      return plan?.components?.find(component => component.role === role) || null;
    }

    function createCatalogScrewAssembly(start, direction, screwComponent, material, name = 'catalogScrew') {
      const dimensions = screwComponent?.dimensionsMm;
      if (!dimensions || !Number.isFinite(dimensions.outerDiameter) || !Number.isFinite(dimensions.length)) return null;
      const axis = direction.clone().normalize();
      const radius = sceneFromMm(dimensions.outerDiameter * .5);
      const end = start.clone().add(axis.multiplyScalar(sceneFromMm(dimensions.length)));
      const assembly = new THREE.Group();
      assembly.name = name;
      assembly.add(cylinderBetween(start, end, radius, material, `${name}:shaft`, 18));
      const customShaftOnly = screwComponent.dimensionSource === 'user_entered' || screwComponent.geometryTemplate === 'shaft_only';
      if (!customShaftOnly) {
        const headHeightMm = Math.max(8, dimensions.outerDiameter * 1.7);
        const headRadiusMm = Math.max(4.5, dimensions.outerDiameter * .82);
        const outward = direction.clone().normalize().multiplyScalar(-sceneFromMm(headHeightMm));
        const headEnd = start.clone().add(outward);
        assembly.add(cylinderBetween(start, headEnd, sceneFromMm(headRadiusMm), materials.metal, `${name}:catalog-unspecified-tulip-envelope`, 18));
        const collar = mesh(new THREE.CylinderGeometry(sceneFromMm(headRadiusMm * .88), sceneFromMm(headRadiusMm * .72), sceneFromMm(2.2), 18), materials.metal, `${name}:collar`);
        collar.position.copy(start);
        collar.quaternion.setFromUnitVectors(LOCAL_Y_AXIS, direction.clone().normalize());
        assembly.add(collar);
      }
      assembly.userData = {
        representation: customShaftOnly ? 'user-dimensioned screw shaft; head geometry withheld' : 'catalog-dimensioned screw shaft with generic head envelope',
        dimensionSource: screwComponent.dimensionSource || 'manufacturer_catalog',
        catalogId: screwComponent.catalogId, sourceUrl: screwComponent.sourceUrl,
        outerDiameterMm: dimensions.outerDiameter, shaftLengthMm: dimensions.length,
        headGeometryRendered: !customShaftOnly, headGeometryVerified: false, trajectoryValidated: false, fitValidated: false
      };
      return assembly;
    }

    function sourceScrewTrajectoryAppMm(boneKey, side, entryYAppMm = null) {
      const bounds = referenceBoundsFor(boneKey);
      if (!bounds) return null;
      const rowY = Number.isFinite(entryYAppMm) ? entryYAppMm : bounds.center.y;
      const startAppMm = bounds.center.clone().add(new THREE.Vector3(bounds.size.x * .40, 0, side * bounds.size.z * .27));
      startAppMm.y = rowY;
      const targetAppMm = bounds.center.clone().add(new THREE.Vector3(-bounds.size.x * .22, -bounds.size.y * .04, side * bounds.size.z * .06));
      targetAppMm.y += rowY - bounds.center.y;
      return { startAppMm, targetAppMm, boneKey, side };
    }

    function sourceScrewTrajectory(record, boneKey, side, entryYAppMm = null) {
      const source = sourceScrewTrajectoryAppMm(boneKey, side, entryYAppMm);
      if (!source) return null;
      const start = sourceLocalPoint(record.level, source.startAppMm);
      const target = sourceLocalPoint(record.level, source.targetAppMm);
      return {
        start, direction: target.sub(start).normalize(), boneKey, side,
        startAppMm: source.startAppMm, targetAppMm: source.targetAppMm
      };
    }

    function liveBoneSourcePointWorld(boneKey, appMmPoint) {
      if (!appMmPoint?.isVector3) return null;
      const owner = [...segmentRecords.values()].find(candidate => candidate.level.superior === boneKey);
      if (owner?.anatomyRoot) {
        return owner.anatomyRoot.localToWorld(sourceLocalPoint(owner.level, appMmPoint));
      }
      if (['S1', 'sacrum'].includes(boneKey) && sacralReferenceSurface) {
        return sacralReferenceSurface.localToWorld(appMmPoint.clone());
      }
      return null;
    }

    function addCatalogPosteriorConstruct(root, record, plan, material = materials.screw, boneKeys = null) {
      const screw = implantComponent(plan, 'screw_set');
      const rod = implantComponent(plan, 'rod_set');
      if (!screw || !rod) return false;
      const construct = new THREE.Group();
      construct.name = `posteriorConstruct:${record.level.id}`;
      construct.userData = {
        representation: 'catalog-dimensioned posterior construct with live anchor integrity gate',
        kinematicBindingMode: 'fail_closed_if_a_screw_row_detaches_from_its_bone_owner',
        maximumAnchorGapMm: 0,
        liveBindingValid: true
      };
      const sourceAnchors = [];
      const startsBySide = new Map([[-1, []], [1, []]]);
      (boneKeys || [record.level.inferior, record.level.superior]).forEach(boneKey => {
        [-1, 1].forEach(side => {
          const trajectory = sourceScrewTrajectory(record, boneKey, side);
          if (!trajectory) return;
          const assembly = createCatalogScrewAssembly(
            trajectory.start, trajectory.direction, screw, material,
            `catalogPedicleScrew:${boneKey}:${side > 0 ? 'left' : 'right'}`
          );
          if (assembly) {
            startsBySide.get(side).push(trajectory.start.clone());
            sourceAnchors.push({
              boneKey,
              appMm: trajectory.startAppMm.clone(),
              constructLocal: trajectory.start.clone()
            });
            assembly.userData = {
              ...assembly.userData,
              boneOwner: boneKey,
              sourceEntryAppMm: trajectory.startAppMm.toArray()
            };
            construct.add(assembly);
          }
        });
      });
      startsBySide.forEach((anchors, side) => {
        if (anchors.length < 2) return;
        const direction = anchors[1].clone().sub(anchors[0]).normalize();
        const midpoint = anchors[0].clone().add(anchors[1]).multiplyScalar(.5);
        const halfLength = sceneFromMm(rod.dimensionsMm.length * .5);
        const rodStart = midpoint.clone().addScaledVector(direction, -halfLength);
        const rodEnd = midpoint.clone().addScaledVector(direction, halfLength);
        const rodMesh = cylinderBetween(
          rodStart, rodEnd, sceneFromMm(rod.dimensionsMm.diameter * .5), material,
          `catalogRod:${side > 0 ? 'left' : 'right'}`, 18
        );
        rodMesh.userData = {
          representation: rod.dimensionSource === 'user_entered' ? 'user-dimensioned straight rod envelope' : 'catalog-dimensioned straight rod',
          dimensionSource: rod.dimensionSource || 'manufacturer_catalog', catalogId: rod.catalogId,
          diameterMm: rod.dimensionsMm.diameter, lengthMm: rod.dimensionsMm.length,
          contouringAndConnectorFitValidated: false
        };
        construct.add(rodMesh);
      });
      if (!sourceAnchors.length) return false;
      root.add(construct);
      root.updatePosteriorKinematicBinding = () => {
        const gapsMm = sourceAnchors.map(anchor => {
          const rendered = construct.localToWorld(anchor.constructLocal.clone());
          const expected = liveBoneSourcePointWorld(anchor.boneKey, anchor.appMm);
          if (!expected || !rendered.toArray().every(Number.isFinite) || !expected.toArray().every(Number.isFinite)) {
            return Infinity;
          }
          return rendered.distanceTo(expected) / REFERENCE_MM_TO_SCENE;
        });
        const maximumGapMm = gapsMm.length ? Math.max(...gapsMm) : Infinity;
        const liveBindingValid = Number.isFinite(maximumGapMm) && maximumGapMm <= 1;
        construct.visible = liveBindingValid;
        construct.userData.maximumAnchorGapMm = maximumGapMm;
        construct.userData.liveBindingValid = liveBindingValid;
        construct.userData.geometryWithheld = !liveBindingValid;
        construct.userData.withheldReason = liveBindingValid
          ? null
          : 'The static two-row construct no longer follows both live vertebral owners; screws and rods are withheld rather than shown detached.';
        root.userData.posteriorConstructBindingValid = liveBindingValid;
        root.userData.posteriorConstructWithheldReason = construct.userData.withheldReason;
        return liveBindingValid;
      };
      return true;
    }

    function addCatalogTopsMotionDevice(root, record, plan) {
      const motionDevice = implantComponent(plan, 'posterior_motion_device');
      const screw = implantComponent(plan, 'screw_set');
      const stagedScrewAssemblies = [];
      const withholdTopsGeometry = reason => {
        stagedScrewAssemblies.forEach(assembly => {
          assembly.traverse(object => { if (object.geometry) object.geometry.dispose(); });
        });
        root.userData.topsGeometryWithheld = true;
        root.userData.topsGeometryWithheldReason = reason;
        return false;
      };
      if (!motionDevice || !screw) {
        return withholdTopsGeometry('The TOPS device or four-screw component plan is unavailable.');
      }
      const dimensions = motionDevice.dimensionsMm;
      const numericDimensions = [
        dimensions?.interpedicularDistance, dimensions?.armAngleDeg,
        dimensions?.topPlateLength, dimensions?.bottomPlateLength,
        screw?.dimensionsMm?.outerDiameter, screw?.dimensionsMm?.length
      ];
      if (!numericDimensions.every(Number.isFinite)) {
        return withholdTopsGeometry('The saved FDA-configuration dimensions are incomplete.');
      }

      const screwOuterDiameterMm = screw.dimensionsMm.outerDiameter;
      const genericHeadHeightMm = Math.max(8, screwOuterDiameterMm * 1.7);
      const genericHeadRadiusMm = Math.max(4.5, screwOuterDiameterMm * .82);
      const anchors = { superior: new Map(), inferior: new Map() };
      const rowObjects = {};
      [
        ['superior', record.level.superior],
        ['inferior', record.level.inferior]
      ].forEach(([positionKey, boneKey]) => {
        [-1, 1].forEach(side => {
          const trajectory = sourceScrewTrajectory(record, boneKey, side);
          if (!trajectory) return;
          const sideName = side > 0 ? 'left' : 'right';
          const assembly = createCatalogScrewAssembly(
            trajectory.start, trajectory.direction, screw, materials.screw,
            `TOPSPedicleScrew:${boneKey}:${sideName}`
          );
          if (!assembly) return;
          const tulipCenter = trajectory.start.clone().addScaledVector(
            trajectory.direction,
            -sceneFromMm(genericHeadHeightMm * .55)
          );
          assembly.userData = {
            ...assembly.userData,
            implantFamily: 'TOPS',
            row: positionKey,
            side: sideName,
            tulipCenterLocal: tulipCenter.toArray(),
            tulipGeometryVerified: false,
            sourceFrameTrajectoryProxy: true
          };
          anchors[positionKey].set(side, {
            trajectory,
            tulipCenter,
            assembly,
            boneKey,
            side,
            screwParts: {
              shaft: assembly.children.find(child => child.name === `${assembly.name}:shaft`) || null,
              head: assembly.children.find(child => child.name === `${assembly.name}:catalog-unspecified-tulip-envelope`) || null,
              collar: assembly.children.find(child => child.name === `${assembly.name}:collar`) || null
            },
            sourceRowYAppMm: trajectory.startAppMm.y
          });
          stagedScrewAssemblies.push(assembly);
        });
      });
      if (anchors.superior.size !== 2 || anchors.inferior.size !== 2) {
        return withholdTopsGeometry('Four source-frame pedicle anchor proxies were not available.');
      }

      const midpoint = pair => pair.get(-1).tulipCenter.clone().add(pair.get(1).tulipCenter).multiplyScalar(.5);
      const superiorMid = midpoint(anchors.superior);
      const inferiorMid = midpoint(anchors.inferior);
      const leftRightFor = pair => pair.get(1).tulipCenter.clone().sub(pair.get(-1).tulipCenter).normalize();
      const lateral = leftRightFor(anchors.superior).add(leftRightFor(anchors.inferior)).normalize();
      if (lateral.z < 0) lateral.negate();
      const cranial = superiorMid.clone().sub(inferiorMid);
      cranial.addScaledVector(lateral, -cranial.dot(lateral));
      if (cranial.lengthSq() < 1e-8) {
        return withholdTopsGeometry('The two screw rows do not define a stable device-local frame.');
      }
      cranial.normalize();
      if (cranial.y < 0) cranial.negate();
      const posterior = cranial.clone().cross(lateral).normalize();
      if (posterior.x < 0) {
        lateral.negate();
        posterior.copy(cranial).cross(lateral).normalize();
      }
      stagedScrewAssemblies.forEach(assembly => root.add(assembly));
      const frameMatrix = new THREE.Matrix4().makeBasis(posterior, cranial, lateral);
      const frameQuaternion = new THREE.Quaternion().setFromRotationMatrix(frameMatrix);
      const localLateralAxis = new THREE.Vector3(0, 0, 1);
      const capsuleToLateral = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const armAngle = THREE.MathUtils.degToRad(dimensions.armAngleDeg);
      const plateApMm = 10;
      const plateThicknessMm = 5;
      const armRadiusMm = 3.1;
      const sourceMechanismCenter = superiorMid.clone().add(inferiorMid).multiplyScalar(.5);
      const sourceRowSeparationMm = superiorMid.clone().sub(inferiorMid).dot(cranial) / REFERENCE_MM_TO_SCENE;
      const nominalHalfIpd = sceneFromMm(dimensions.interpedicularDistance * .5);
      const nominalIpdProxyMismatch = Math.abs(sourceRowSeparationMm - dimensions.interpedicularDistance) > 4;
      const superiorDeviceCenter = sourceMechanismCenter.clone().addScaledVector(cranial, nominalHalfIpd);
      const inferiorDeviceCenter = sourceMechanismCenter.clone().addScaledVector(cranial, -nominalHalfIpd);
      const rowMetadata = {};

      const buildCrossbar = (positionKey, center, pair, overallLengthMm, pitchSign) => {
        const rowAxis = lateral.clone().applyAxisAngle(posterior, pitchSign * armAngle * .5).normalize();
        const rowNormal = rowAxis.clone().cross(posterior).normalize();
        const rowFrame = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(posterior, rowNormal, rowAxis)
        );
        const objects = {
          plate: null,
          arms: new Map(),
          bridges: new Map(),
          rings: new Map(),
          jaws: new Map(),
          caps: new Map()
        };
        const leftSeatProjection = pair.get(1).tulipCenter.clone().sub(center).dot(rowAxis);
        const rightSeatProjection = pair.get(-1).tulipCenter.clone().sub(center).dot(rowAxis);
        const sourceSeatSpanMm = Math.abs(leftSeatProjection - rightSeatProjection) / REFERENCE_MM_TO_SCENE;
        const centralWidthMm = THREE.MathUtils.clamp(
          sourceSeatSpanMm * .48,
          22,
          Math.max(22, overallLengthMm - 12)
        );
        const capsuleRadius = sceneFromMm(plateThicknessMm * .5);
        const plate = mesh(
          new THREE.CapsuleGeometry(
            capsuleRadius,
            Math.max(sceneFromMm(centralWidthMm - plateThicknessMm), sceneFromMm(.5)),
            5,
            18
          ),
          materials.metal,
          `TOPSTitaniumEndplate:${positionKey}`
        );
        plate.position.copy(center);
        plate.quaternion.copy(rowFrame).multiply(capsuleToLateral);
        plate.scale.x = plateApMm / plateThicknessMm;
        plate.userData = {
          representation: 'rounded external titanium central crossbar body with four-arm topology',
          configurationOverallLengthMm: overallLengthMm,
          centralBodyWidthMm: centralWidthMm,
          displayedPitchDeg: pitchSign * dimensions.armAngleDeg * .5,
          displayedArmAxis: rowAxis.toArray(),
          plateApMm,
          plateThicknessMm,
          overallLengthFromFdaConfiguration: true,
          centralCrossSectionVerified: false,
          deviceParallelToDiscAssessed: false
        };
        root.add(plate);
        objects.plate = plate;

        const armOverhangBeyondDisplayedHeadMm = {};
        const seatResidualMm = {};
        const seatMetrics = new Map();
        [-1, 1].forEach(side => {
          const seat = pair.get(side).tulipCenter;
          const seatProjection = seat.clone().sub(center).dot(rowAxis);
          const signedSeatDistanceMm = side * seatProjection / REFERENCE_MM_TO_SCENE;
          const headEdgeOverhangMm = overallLengthMm * .5 - signedSeatDistanceMm - genericHeadRadiusMm;
          const seatOnArmAxis = center.clone().addScaledVector(rowAxis, seatProjection);
          const residualMm = seat.distanceTo(seatOnArmAxis) / REFERENCE_MM_TO_SCENE;
          seatMetrics.set(side, { seat, seatProjection, seatOnArmAxis, residualMm, headEdgeOverhangMm });
        });
        const bothSidesOverFiveMillimetres = [...seatMetrics.values()]
          .every(metric => metric.headEdgeOverhangMm > 5);
        const rowProxyLengthCompatible = [...seatMetrics.values()]
          .every(metric => metric.headEdgeOverhangMm >= 2)
          && !bothSidesOverFiveMillimetres;
        [-1, 1].forEach(side => {
          const sideName = side > 0 ? 'left' : 'right';
          const metric = seatMetrics.get(side);
          const { seat, seatProjection, seatOnArmAxis, residualMm, headEdgeOverhangMm } = metric;
          const inner = center.clone().addScaledVector(rowAxis, side * sceneFromMm(centralWidthMm * .5));
          const endpoint = center.clone().addScaledVector(rowAxis, side * sceneFromMm(overallLengthMm * .5));
          const arm = cylinderBetween(
            inner,
            endpoint,
            sceneFromMm(armRadiusMm),
            materials.metal,
            `TOPSArm:${positionKey}:${sideName}`,
            20
          );
          const unseatedProxy = nominalIpdProxyMismatch || residualMm > 5 || !rowProxyLengthCompatible;
          armOverhangBeyondDisplayedHeadMm[sideName] = headEdgeOverhangMm;
          seatResidualMm[sideName] = residualMm;
          arm.userData = {
            representation: 'external titanium arm from central crossbar through the polyaxial tulip seat',
            configurationOverallLengthMm: overallLengthMm,
            radiusMm: armRadiusMm,
            armCrossSectionVerified: false,
            displayedGenericHeadRadiusMm: genericHeadRadiusMm,
            selectedConfigurationOverhangBeyondDisplayedHeadMm: headEdgeOverhangMm,
            twoToFiveMillimetreHeadEdgeSelectionProxyMet: headEdgeOverhangMm >= 2
              && !(bothSidesOverFiveMillimetres),
            sourceTulipAxisResidualMm: residualMm,
            tulipFitValidated: false
          };
          root.add(arm);
          objects.arms.set(side, arm);

          const interfaceBridge = cylinderBetween(
            seatOnArmAxis,
            seat,
            sceneFromMm(3.8),
            unseatedProxy ? materials.amber : materials.motion,
            `TOPSTulipInterface:${positionKey}:${sideName}`,
            18
          );
          interfaceBridge.visible = residualMm > .05;
          interfaceBridge.userData = {
            representation: 'polyaxial seat-envelope bridge to the source-frame screw-head proxy',
            residualMm,
            unseatedProxy,
            connectorGeometryVerified: false,
            fitValidated: false
          };
          root.add(interfaceBridge);
          objects.bridges.set(side, interfaceBridge);
          const interfaceRing = mesh(
            new THREE.TorusGeometry(sceneFromMm(genericHeadRadiusMm * 1.02), sceneFromMm(1.05), 8, 22),
            unseatedProxy ? materials.amber : materials.motion,
            `TOPSTulipInterfaceRing:${positionKey}:${sideName}`
          );
          interfaceRing.position.copy(seat);
          interfaceRing.quaternion.setFromUnitVectors(
            localLateralAxis,
            pair.get(side).trajectory.direction.clone().negate().normalize()
          );
          interfaceRing.userData = {
            representation: 'generic polyaxial tulip-seat ring envelope',
            unseatedProxy,
            tulipGeometryVerified: false,
            fitValidated: false
          };
          root.add(interfaceRing);
          objects.rings.set(side, interfaceRing);

          const jawObjects = [];
          [-1, 1].forEach(jawSide => {
            const jaw = mesh(
              new THREE.BoxGeometry(sceneFromMm(4.2), sceneFromMm(4.8), sceneFromMm(5.2)),
              unseatedProxy ? materials.amber : materials.motion,
              `TOPSTulipJaw:${positionKey}:${sideName}:${jawSide > 0 ? 'cranial' : 'caudal'}`
            );
            jaw.position.copy(seat).addScaledVector(rowNormal, jawSide * sceneFromMm(armRadiusMm + 2.2));
            jaw.quaternion.copy(rowFrame);
            jaw.userData = {
              representation: 'generic U-channel jaw around the displayed TOPS arm seat',
              tulipGeometryVerified: false,
              fitValidated: false,
              unseatedProxy
            };
            root.add(jaw);
            jawObjects.push({ jawSide, mesh: jaw });
          });
          objects.jaws.set(side, jawObjects);
          const capOutward = pair.get(side).trajectory.direction.clone().negate().normalize();
          const lockingCap = cylinderBetween(
            seat,
            seat.clone().addScaledVector(capOutward, sceneFromMm(2.2)),
            sceneFromMm(genericHeadRadiusMm * .63),
            materials.metal,
            `TOPSTulipLockingCap:${positionKey}:${sideName}`,
            20
          );
          lockingCap.userData = {
            representation: 'generic locking-cap envelope over the displayed arm seat',
            lockingCapGeometryVerified: false,
            torqueOrEngagementValidated: false
          };
          root.add(lockingCap);
          objects.caps.set(side, lockingCap);
        });
        rowObjects[positionKey] = objects;
        rowMetadata[positionKey] = {
          overallLengthMm,
          centralWidthMm,
          sourceSeatSpanMm,
          displayedArmAxis: rowAxis.toArray(),
          displayedArmPitchDeg: pitchSign * dimensions.armAngleDeg * .5,
          armOverhangBeyondDisplayedHeadMm,
          bothSidesOverFiveMillimetres,
          rowProxyLengthCompatible,
          sourceTulipAxisResidualMm: seatResidualMm
        };
      };

      buildCrossbar('superior', superiorDeviceCenter, anchors.superior, dimensions.topPlateLength, 1);
      buildCrossbar('inferior', inferiorDeviceCenter, anchors.inferior, dimensions.bottomPlateLength, -1);

      const mechanismCenter = sourceMechanismCenter;
      const rowSeparationMm = dimensions.interpedicularDistance;
      const bootHeightMm = Math.max(7, rowSeparationMm - plateThicknessMm);
      const bootRadiusMm = 4.5;
      const bootApMm = 12;
      const bootMlMm = Math.min(28, Math.min(rowMetadata.superior.centralWidthMm, rowMetadata.inferior.centralWidthMm) * .88);
      const boot = mesh(
        new THREE.CapsuleGeometry(
          sceneFromMm(bootRadiusMm),
          Math.max(sceneFromMm(bootHeightMm - bootRadiusMm * 2), sceneFromMm(.5)),
          7,
          22
        ),
        materials.topsBoot,
        'TOPSPolycarbonateUrethaneBoot'
      );
      boot.position.copy(mechanismCenter);
      boot.quaternion.copy(frameQuaternion);
      boot.scale.set(bootApMm / (bootRadiusMm * 2), 1, bootMlMm / (bootRadiusMm * 2));
      boot.userData = {
        representation: 'compact rounded external flexible-boot envelope between the two titanium central crossbars',
        materialFamily: 'polycarbonate urethane',
        displayedEnvelopeMm: { ap: bootApMm, craniocaudal: bootHeightMm, mediolateral: bootMlMm },
        bootContourVerified: false,
        proprietaryInternalGeometryRendered: false,
        proprietaryInternalGeometryVerified: false
      };
      root.add(boot);

      const allHeadEdgeOverhangs = Object.values(rowMetadata)
        .flatMap(row => Object.values(row.armOverhangBeyondDisplayedHeadMm));
      const allSeatResiduals = Object.values(rowMetadata).flatMap(row => Object.values(row.sourceTulipAxisResidualMm));
      const rowSeparationMismatchMm = sourceRowSeparationMm - dimensions.interpedicularDistance;
      const proxyDisplayCompatible = Math.abs(rowSeparationMismatchMm) <= 4
        && Object.values(rowMetadata).every(row => row.rowProxyLengthCompatible)
        && allSeatResiduals.every(value => value <= 5);
      const proxyDisplaySeatingReasons = [
        Math.abs(rowSeparationMismatchMm) > 4 ? 'nominal IPD differs from the source-row proxy by more than 4 mm' : '',
        Object.values(rowMetadata).some(row => Object.values(row.armOverhangBeyondDisplayedHeadMm).some(value => value < 2))
          ? 'an arm extends less than 2 mm beyond the displayed generic screw-head edge' : '',
        Object.values(rowMetadata).some(row => row.bothSidesOverFiveMillimetres)
          ? 'a row extends more than 5 mm beyond both displayed generic screw-head edges; step down the public length class' : '',
        allSeatResiduals.some(value => value > 5) ? 'a source-head proxy lies more than 5 mm from the displayed arm axis' : ''
      ].filter(Boolean);
      root.userData.topsMotionDevice = {
        catalogId: motionDevice.catalogId,
        sourceUrl: motionDevice.sourceUrl,
        interpedicularDistanceMm: dimensions.interpedicularDistance,
        armAngleDeg: dimensions.armAngleDeg,
        plateLengthClass: dimensions.plateLengthClass,
        topPlateLengthMm: dimensions.topPlateLength,
        bottomPlateLengthMm: dimensions.bottomPlateLength,
        labeledDesignMotionLimitsDeg: motionDevice.labeledDesignMotionLimitsDeg,
        sagittalTranslationDesign: motionDevice.sagittalTranslationDesign,
        fourPedicleScrewsRendered: true,
        crossbarCount: 2,
        armCount: 4,
        bootCount: 1,
        proprietaryInternalMechanismRendered: false,
        decompressionRequired: true,
        sourceFrameRowSeparationMm: sourceRowSeparationMm,
        nominalIpdMismatchMm: rowSeparationMismatchMm,
        nominalIpdComparedToProxyAnchors: true,
        displayedGenericHeadRadiusMm: genericHeadRadiusMm,
        minimumArmOverhangBeyondDisplayedHeadMm: Math.min(...allHeadEdgeOverhangs),
        twoToFiveMillimetreHeadEdgeSelectionProxyMet: Object.values(rowMetadata)
          .every(row => row.rowProxyLengthCompatible),
        maximumSourceTulipAxisResidualMm: Math.max(...allSeatResiduals),
        proxyDisplaySeatingStatus: proxyDisplayCompatible ? 'proxy_aligned' : 'unseated_proxy',
        proxyDisplaySeatingReasons,
        rows: rowMetadata,
        deviceLocalAxes: {
          posterior: posterior.toArray(),
          cranial: cranial.toArray(),
          patientLeft: lateral.toArray()
        },
        namedDeviceGeometryStatus: 'public two-crossbar/four-arm/four-screw/compact-boot external topology; proprietary internal mechanism withheld',
        roundedReferenceTopBottomLengthsRendered: true,
        nominalIpdRenderedWithoutMovingSourceScrewAnchors: true,
        displayedArmAxisAngleDeg: dimensions.armAngleDeg,
        armAngleGeometryStatus: 'rendered as the included angle between superior and inferior external arm axes',
        configurationFitIsDisplayProxyOnly: true,
        exactTulipGeometryVerified: false,
        exactArmAndCrossbarCrossSectionsVerified: false,
        exactBootContourVerified: false,
        screwTrajectoriesValidated: false,
        placementFitValidated: false,
        activeSlipReductionModeled: false,
        kinematicBinding: 'live dual-bone source-frame attachment'
      };

      const ownerRecordForBone = boneKey =>
        [...segmentRecords.values()].find(candidate => candidate.level.superior === boneKey) || null;
      const sourcePointInDeviceRoot = (ownerRecord, appMmPoint) => {
        const ownerLocal = sourceLocalPoint(ownerRecord.level, appMmPoint);
        const worldPoint = ownerRecord.anatomyRoot.localToWorld(ownerLocal);
        return root.worldToLocal(worldPoint);
      };

      root.updateTopsKinematicBinding = () => {
        if (!root.parent) return false;
        root.updateWorldMatrix(true, false);
        const liveAnchors = { superior: new Map(), inferior: new Map() };
        for (const positionKey of ['superior', 'inferior']) {
          for (const side of [-1, 1]) {
            const stored = anchors[positionKey].get(side);
            if (!stored) return false;
            const ownerRecord = ownerRecordForBone(stored.boneKey);
            if (!ownerRecord) return false;
            const start = sourcePointInDeviceRoot(ownerRecord, stored.trajectory.startAppMm);
            const target = sourcePointInDeviceRoot(ownerRecord, stored.trajectory.targetAppMm);
            const direction = target.clone().sub(start).normalize();
            const tulipCenter = start.clone().addScaledVector(direction, -sceneFromMm(genericHeadHeightMm * .55));
            liveAnchors[positionKey].set(side, { start, target, direction, tulipCenter, stored });

            const shaftEnd = start.clone().addScaledVector(direction, sceneFromMm(screw.dimensionsMm.length));
            updateCylinderMeshBetween(stored.screwParts.shaft, start, shaftEnd);
            const headEnd = start.clone().addScaledVector(direction, -sceneFromMm(genericHeadHeightMm));
            if (stored.screwParts.head) updateCylinderMeshBetween(stored.screwParts.head, start, headEnd);
            if (stored.screwParts.collar) {
              stored.screwParts.collar.position.copy(start);
              stored.screwParts.collar.quaternion.setFromUnitVectors(LOCAL_Y_AXIS, direction);
            }
            stored.assembly.userData.tulipCenterLocal = tulipCenter.toArray();
          }
        }

        const liveMidpoint = pair => pair.get(-1).tulipCenter.clone().add(pair.get(1).tulipCenter).multiplyScalar(.5);
        const liveSuperiorMid = liveMidpoint(liveAnchors.superior);
        const liveInferiorMid = liveMidpoint(liveAnchors.inferior);
        const liveLeftRight = pair => pair.get(1).tulipCenter.clone().sub(pair.get(-1).tulipCenter).normalize();
        const liveLateral = liveLeftRight(liveAnchors.superior).add(liveLeftRight(liveAnchors.inferior)).normalize();
        if (liveLateral.z < 0) liveLateral.negate();
        const liveCranial = liveSuperiorMid.clone().sub(liveInferiorMid);
        liveCranial.addScaledVector(liveLateral, -liveCranial.dot(liveLateral));
        if (liveCranial.lengthSq() < 1e-8) return false;
        liveCranial.normalize();
        if (liveCranial.y < 0) liveCranial.negate();
        const livePosterior = liveCranial.clone().cross(liveLateral).normalize();
        if (livePosterior.x < 0) {
          liveLateral.negate();
          livePosterior.copy(liveCranial).cross(liveLateral).normalize();
        }
        const liveFrameQuaternion = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(livePosterior, liveCranial, liveLateral)
        );
        const liveSourceCenter = liveSuperiorMid.clone().add(liveInferiorMid).multiplyScalar(.5);
        const liveSourceSeparationMm = liveSuperiorMid.clone().sub(liveInferiorMid).dot(liveCranial) / REFERENCE_MM_TO_SCENE;
        const liveDeviceCenters = {
          superior: liveSourceCenter.clone().addScaledVector(liveCranial, nominalHalfIpd),
          inferior: liveSourceCenter.clone().addScaledVector(liveCranial, -nominalHalfIpd)
        };
        const liveHeadEdgeOverhangs = [];
        const liveResiduals = [];

        for (const [positionKey, pitchSign] of [['superior', 1], ['inferior', -1]]) {
          const center = liveDeviceCenters[positionKey];
          const pair = liveAnchors[positionKey];
          const objects = rowObjects[positionKey];
          const metadata = rowMetadata[positionKey];
          const rowAxis = liveLateral.clone().applyAxisAngle(livePosterior, pitchSign * armAngle * .5).normalize();
          const rowNormal = rowAxis.clone().cross(livePosterior).normalize();
          const rowFrame = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(livePosterior, rowNormal, rowAxis)
          );
          objects.plate.position.copy(center);
          objects.plate.quaternion.copy(rowFrame).multiply(capsuleToLateral);
          metadata.displayedArmAxis = rowAxis.toArray();

          const liveSeatMetrics = new Map();
          for (const side of [-1, 1]) {
            const live = pair.get(side);
            const seat = live.tulipCenter;
            const seatProjection = seat.clone().sub(center).dot(rowAxis);
            const seatOnArmAxis = center.clone().addScaledVector(rowAxis, seatProjection);
            const residualMm = seat.distanceTo(seatOnArmAxis) / REFERENCE_MM_TO_SCENE;
            const signedSeatDistanceMm = side * seatProjection / REFERENCE_MM_TO_SCENE;
            const headEdgeOverhangMm = metadata.overallLengthMm * .5
              - signedSeatDistanceMm
              - genericHeadRadiusMm;
            liveSeatMetrics.set(side, { live, seat, seatProjection, seatOnArmAxis, residualMm, headEdgeOverhangMm });
          }
          const bothSidesOverFiveMillimetres = [...liveSeatMetrics.values()]
            .every(metric => metric.headEdgeOverhangMm > 5);
          const rowProxyLengthCompatible = [...liveSeatMetrics.values()]
            .every(metric => metric.headEdgeOverhangMm >= 2)
            && !bothSidesOverFiveMillimetres;
          metadata.bothSidesOverFiveMillimetres = bothSidesOverFiveMillimetres;
          metadata.rowProxyLengthCompatible = rowProxyLengthCompatible;

          for (const side of [-1, 1]) {
            const sideName = side > 0 ? 'left' : 'right';
            const metric = liveSeatMetrics.get(side);
            const { live, seat, seatProjection, seatOnArmAxis, residualMm, headEdgeOverhangMm } = metric;
            const inner = center.clone().addScaledVector(rowAxis, side * sceneFromMm(metadata.centralWidthMm * .5));
            const endpoint = center.clone().addScaledVector(rowAxis, side * sceneFromMm(metadata.overallLengthMm * .5));
            const arm = objects.arms.get(side);
            updateCylinderMeshBetween(arm, inner, endpoint);
            const unseatedProxy = Math.abs(liveSourceSeparationMm - dimensions.interpedicularDistance) > 4
              || residualMm > 5 || !rowProxyLengthCompatible;
            liveResiduals.push(residualMm);
            liveHeadEdgeOverhangs.push(headEdgeOverhangMm);
            metadata.armOverhangBeyondDisplayedHeadMm[sideName] = headEdgeOverhangMm;
            metadata.sourceTulipAxisResidualMm[sideName] = residualMm;
            arm.userData.selectedConfigurationOverhangBeyondDisplayedHeadMm = headEdgeOverhangMm;
            arm.userData.twoToFiveMillimetreHeadEdgeSelectionProxyMet = headEdgeOverhangMm >= 2
              && !bothSidesOverFiveMillimetres;
            arm.userData.sourceTulipAxisResidualMm = residualMm;

            const bridge = objects.bridges.get(side);
            updateCylinderMeshBetween(bridge, seatOnArmAxis, seat);
            bridge.visible = residualMm > .05;
            bridge.material = unseatedProxy ? materials.amber : materials.motion;
            bridge.userData.residualMm = residualMm;
            bridge.userData.unseatedProxy = unseatedProxy;

            const outward = live.direction.clone().negate().normalize();
            const ring = objects.rings.get(side);
            ring.position.copy(seat);
            ring.quaternion.setFromUnitVectors(localLateralAxis, outward);
            ring.material = unseatedProxy ? materials.amber : materials.motion;
            ring.userData.unseatedProxy = unseatedProxy;
            objects.jaws.get(side).forEach(({ jawSide, mesh: jaw }) => {
              jaw.position.copy(seat).addScaledVector(rowNormal, jawSide * sceneFromMm(armRadiusMm + 2.2));
              jaw.quaternion.copy(rowFrame);
              jaw.material = unseatedProxy ? materials.amber : materials.motion;
              jaw.userData.unseatedProxy = unseatedProxy;
            });
            updateCylinderMeshBetween(
              objects.caps.get(side),
              seat,
              seat.clone().addScaledVector(outward, sceneFromMm(2.2))
            );
          }
        }

        boot.position.copy(liveSourceCenter);
        boot.quaternion.copy(liveFrameQuaternion);
        const liveMetadata = root.userData.topsMotionDevice;
        liveMetadata.sourceFrameRowSeparationMm = liveSourceSeparationMm;
        liveMetadata.nominalIpdMismatchMm = liveSourceSeparationMm - dimensions.interpedicularDistance;
        liveMetadata.minimumArmOverhangBeyondDisplayedHeadMm = Math.min(...liveHeadEdgeOverhangs);
        liveMetadata.maximumSourceTulipAxisResidualMm = Math.max(...liveResiduals);
        liveMetadata.twoToFiveMillimetreHeadEdgeSelectionProxyMet = Object.values(rowMetadata)
          .every(row => row.rowProxyLengthCompatible);
        liveMetadata.proxyDisplaySeatingStatus = Math.abs(liveMetadata.nominalIpdMismatchMm) <= 4
          && liveMetadata.twoToFiveMillimetreHeadEdgeSelectionProxyMet
          && liveResiduals.every(value => value <= 5)
          ? 'proxy_aligned'
          : 'unseated_proxy';
        liveMetadata.proxyDisplaySeatingReasons = [
          Math.abs(liveMetadata.nominalIpdMismatchMm) > 4
            ? 'nominal IPD differs from the source-row proxy by more than 4 mm' : '',
          Object.values(rowMetadata).some(row =>
            Object.values(row.armOverhangBeyondDisplayedHeadMm).some(value => value < 2))
            ? 'an arm extends less than 2 mm beyond the displayed generic screw-head edge' : '',
          Object.values(rowMetadata).some(row => row.bothSidesOverFiveMillimetres)
            ? 'a row extends more than 5 mm beyond both displayed generic screw-head edges; step down the public length class' : '',
          liveResiduals.some(value => value > 5)
            ? 'a source-head proxy lies more than 5 mm from the displayed arm axis' : ''
        ].filter(Boolean);
        liveMetadata.deviceLocalAxes = {
          posterior: livePosterior.toArray(),
          cranial: liveCranial.toArray(),
          patientLeft: liveLateral.toArray()
        };
        return true;
      };
      return true;
    }

    function updateKinematicConstructBindings() {
      segmentRecords.forEach(record => {
        record.hardwareLayer?.children.forEach(root => {
          [
            'updateInterbodyKinematicBinding',
            'updateArthroplastyKinematicBinding',
            'updatePosteriorKinematicBinding',
            'updateTopsKinematicBinding'
          ].forEach(binding => {
            if (typeof root[binding] === 'function') root[binding]();
          });
        });
      });
    }

    function createLordoticCageGeometry(apMm, mlMm, anteriorHeightMm, posteriorHeightMm) {
      const ap = sceneFromMm(apMm);
      const ml = sceneFromMm(mlMm);
      const posteriorHeight = sceneFromMm(posteriorHeightMm);
      const anteriorHeight = sceneFromMm(anteriorHeightMm);
      const geometry = new THREE.BoxGeometry(ap, 1, ml, 2, 1, 1);
      const positions = geometry.attributes.position;
      for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index);
        const ySign = Math.sign(positions.getY(index)) || 1;
        const anteriorShare = THREE.MathUtils.clamp(.5 - x / ap, 0, 1);
        const localHeight = THREE.MathUtils.lerp(posteriorHeight, anteriorHeight, anteriorShare);
        positions.setY(index, ySign * localHeight * .5);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      return { geometry, anteriorHeightMm, posteriorHeightMm };
    }

    const INTERBODY_APPROACH_LAYOUTS = Object.freeze({
      central: Object.freeze([{ label: 'central', yawDeg: 0, apOffsetMm: 0, mlOffsetMm: 0 }]),
      acdf: Object.freeze([{ label: 'central-anterior', yawDeg: 0, apOffsetMm: -1, mlOffsetMm: 0 }]),
      alif: Object.freeze([{ label: 'central-anterior', yawDeg: 0, apOffsetMm: -2.5, mlOffsetMm: 0 }]),
      tlif: Object.freeze([{ label: 'transforaminal-oblique', yawDeg: -32, apOffsetMm: 2, mlOffsetMm: 6 }]),
      plif: Object.freeze([
        { label: 'right-posterior', yawDeg: -4, apOffsetMm: 2, mlOffsetMm: -7 },
        { label: 'left-posterior', yawDeg: 4, apOffsetMm: 2, mlOffsetMm: 7 }
      ]),
      llif: Object.freeze([{ label: 'direct-lateral', yawDeg: 0, apOffsetMm: 0, mlOffsetMm: 0 }]),
      xlif: Object.freeze([{ label: 'transpsoas-lateral', yawDeg: 0, apOffsetMm: 0, mlOffsetMm: 0 }]),
      olif: Object.freeze([{ label: 'oblique-lateral', yawDeg: 25, apOffsetMm: -2, mlOffsetMm: 0 }])
    });

    function sourceBoundedInterbodyPlacement(record, component, placement) {
      const dimensions = component.dimensionsMm;
      const rendered = record.disc?.userData?.renderedFootprintMm;
      const discEnvelope = rendered
        ? { ap: rendered.ap, lr: rendered.ml }
        : { ap: 0, lr: 0 };
      const maximumApOffset = Math.max(0, (discEnvelope.ap - dimensions.ap) * .5);
      const maximumMlOffset = Math.max(0, (discEnvelope.lr - dimensions.ml) * .5);
      const apOffsetMm = THREE.MathUtils.clamp(placement.apOffsetMm, -maximumApOffset, maximumApOffset);
      const mlOffsetMm = THREE.MathUtils.clamp(placement.mlOffsetMm, -maximumMlOffset, maximumMlOffset);
      const anchor = record.disc.position.clone().sub(record.anatomyRoot.position);
      const offset = new THREE.Vector3(sceneFromMm(apOffsetMm), 0, sceneFromMm(mlOffsetMm));
      offset.applyQuaternion(record.disc.quaternion);
      return {
        anchor: anchor.add(offset), apOffsetMm, mlOffsetMm,
        sourceDiscEnvelopeMm: { ap: discEnvelope.ap, ml: discEnvelope.lr },
        footprintWithinSourceDisc: dimensions.ap <= discEnvelope.ap && dimensions.ml <= discEnvelope.lr
      };
    }

    function addCatalogInterbody(root, record, plan, approach = 'central') {
      const component = implantComponent(plan, 'fusion_cage');
      if (!component) return false;
      if (!record.disc?.isMesh || record.disc.userData?.containmentAssessed !== true) {
        root.userData.interbodyGeometryWithheld = true;
        root.userData.interbodyGeometryWithheldReason = 'No contained CT-source disc loft is available at this level; cage geometry is withheld.';
        return false;
      }
      const dimensions = component.dimensionsMm;
      const anteriorHeightMm = dimensions.anteriorHeight ?? dimensions.height;
      const posteriorHeightMm = dimensions.posteriorHeight ?? dimensions.height;
      const custom = component.dimensionSource === 'user_entered';
      const placements = INTERBODY_APPROACH_LAYOUTS[approach] || INTERBODY_APPROACH_LAYOUTS.central;
      const placementSummary = [];
      const liveComponents = [];
      const interbodyGroup = new THREE.Group();
      interbodyGroup.name = `liveInterbodyJoint:${record.level.id}:${approach}`;
      interbodyGroup.userData = {
        representation: 'disc-joint-bound interbody and graft envelopes',
        liveJointBinding: true
      };
      root.add(interbodyGroup);
      placements.forEach((placement, index) => {
        const built = createLordoticCageGeometry(dimensions.ap, dimensions.ml, anteriorHeightMm, posteriorHeightMm);
        const baseName = custom ? 'customInterbodyEnvelope' : 'catalogInterbodyCage';
        const cageName = placements.length === 1 ? baseName : `${baseName}:${approach}:${placement.label}`;
        const cage = mesh(built.geometry, materials.cage, cageName);
        const bounded = sourceBoundedInterbodyPlacement(record, component, placement);
        const approachRotation = new THREE.Quaternion().setFromAxisAngle(LOCAL_Y_AXIS, THREE.MathUtils.degToRad(placement.yawDeg));
        cage.position.copy(bounded.anchor);
        cage.quaternion.copy(record.disc.quaternion).multiply(approachRotation);
        cage.userData = {
          representation: custom ? 'user-dimensioned outer-envelope interbody cage' : 'catalog outer-envelope interbody cage',
          approach, approachPlacement: placement.label, approachYawDeg: placement.yawDeg,
          sourceBoundedAnchor: true, sourceDiscEnvelopeMm: bounded.sourceDiscEnvelopeMm,
          appliedApOffsetMm: bounded.apOffsetMm, appliedMlOffsetMm: bounded.mlOffsetMm,
          footprintWithinSourceDisc: bounded.footprintWithinSourceDisc,
          dimensionSource: component.dimensionSource || 'manufacturer_catalog', heightConvention: component.heightConvention,
          catalogId: component.catalogId,
          sourceUrl: component.sourceUrl, apMm: dimensions.ap, mlMm: dimensions.ml,
          posteriorHeightMm: built.posteriorHeightMm, anteriorHeightMm: built.anteriorHeightMm,
          lordosisDeg: component.lordosisDeg, teethAndPorosityGeometryVerified: false,
          approachCorridorModeled: false, containmentAssessed: false, fitValidated: false
        };
        interbodyGroup.add(cage);
        const liveEntry = { placement, cage, graft: null };
        placementSummary.push({ label: placement.label, yawDeg: placement.yawDeg, ...bounded });
        if (plan.graft) {
          const graft = mesh(
            new THREE.BoxGeometry(sceneFromMm(dimensions.ap * .55), sceneFromMm(Math.max(1.5, Math.min(anteriorHeightMm, posteriorHeightMm) * .45)), sceneFromMm(dimensions.ml * .58)),
            materials.graft, placements.length === 1 ? 'graftContainmentEnvelope' : `graftContainmentEnvelope:${approach}:${placement.label}`
          );
          graft.position.copy(bounded.anchor);
          graft.quaternion.copy(cage.quaternion);
          graft.userData = {
            representation: 'cage chamber marker; not a packing or placed-volume simulation',
            approach, approachPlacement: placement.label,
            dimensionMode: plan.dimensionMode || 'catalog', quantityMeaning: plan.graft.quantityMeaning || 'manufacturer_package_quantity',
            packageCatalogId: plan.graft.catalogId, packageVolumeCc: plan.graft.packageVolumeCc,
            packageVolumeIsPlacedVolume: false, sourceUrl: plan.graft.sourceUrl
          };
          interbodyGroup.add(graft);
          liveEntry.graft = graft;
        }
        liveComponents.push(liveEntry);
      });
      root.userData.interbodyPlacement = {
        approach, sourceBoundedAnchors: true, placements: placementSummary,
        approachCorridorModeled: false, containmentAssessed: false, fitValidated: false
      };
      root.updateInterbodyKinematicBinding = () => {
        if (!record.disc?.isMesh || record.disc.userData?.containmentAssessed !== true) {
          interbodyGroup.visible = false;
          interbodyGroup.userData.liveJointBinding = false;
          interbodyGroup.userData.withheldReason = 'The live disc joint no longer has a contained source-fit envelope.';
          return false;
        }
        liveComponents.forEach(entry => {
          const bounded = sourceBoundedInterbodyPlacement(record, component, entry.placement);
          const approachRotation = new THREE.Quaternion().setFromAxisAngle(
            LOCAL_Y_AXIS,
            THREE.MathUtils.degToRad(entry.placement.yawDeg)
          );
          entry.cage.position.copy(bounded.anchor);
          entry.cage.quaternion.copy(record.disc.quaternion).multiply(approachRotation);
          if (entry.graft) {
            entry.graft.position.copy(bounded.anchor);
            entry.graft.quaternion.copy(entry.cage.quaternion);
          }
        });
        interbodyGroup.visible = true;
        interbodyGroup.userData.liveJointBinding = true;
        interbodyGroup.userData.withheldReason = null;
        return true;
      };
      return true;
    }

    function addCatalogArthroplasty(root, record, plan) {
      const component = implantComponent(plan, 'arthroplasty');
      if (!component) return false;
      if (!record.disc?.isMesh || record.disc.userData?.containmentAssessed !== true) {
        root.userData.arthroplastyGeometryWithheld = true;
        root.userData.arthroplastyGeometryWithheldReason = 'No contained live disc joint is available for device placement.';
        return false;
      }
      const dimensions = component.dimensionsMm;
      const jointRoot = new THREE.Group();
      jointRoot.name = `liveArthroplastyJoint:${record.level.id}`;
      jointRoot.userData = {
        representation: 'disc-joint-bound arthroplasty envelope',
        liveJointBinding: true
      };
      root.add(jointRoot);
      const updateJointBinding = () => {
        const anchor = record.disc.position.clone().sub(record.anatomyRoot.position);
        const finite = anchor.toArray().every(Number.isFinite)
          && record.disc.quaternion.toArray().every(Number.isFinite);
        jointRoot.visible = finite;
        if (!finite) {
          jointRoot.userData.liveJointBinding = false;
          jointRoot.userData.withheldReason = 'The live disc-joint transform is not finite.';
          return false;
        }
        jointRoot.position.copy(anchor);
        jointRoot.quaternion.copy(record.disc.quaternion);
        jointRoot.userData.liveJointBinding = true;
        jointRoot.userData.withheldReason = null;
        return true;
      };
      root.updateArthroplastyKinematicBinding = updateJointBinding;
      if (component.dimensionSource === 'user_entered') {
        const built = createLordoticCageGeometry(
          dimensions.ap, dimensions.ml,
          dimensions.anteriorHeight ?? dimensions.height,
          dimensions.posteriorHeight ?? dimensions.height
        );
        const envelope = mesh(built.geometry, materials.motion, 'customArthroplastyEnvelope');
        envelope.userData = {
          representation: 'user-dimensioned arthroplasty outer envelope; internal articulation and keel geometry withheld',
          dimensionSource: 'user_entered', displayLabel: component.catalogLabel,
          apMm: dimensions.ap, mlMm: dimensions.ml,
          anteriorHeightMm: built.anteriorHeightMm, posteriorHeightMm: built.posteriorHeightMm,
          articulationGeometryVerified: false, keelGeometryVerified: false, placementValidated: false
        };
        jointRoot.add(envelope);
        updateJointBinding();
        return true;
      }
      const plateThicknessMm = .8;
      [-1, 1].forEach(side => {
        const plate = mesh(
          new THREE.BoxGeometry(sceneFromMm(dimensions.ap), sceneFromMm(plateThicknessMm), sceneFromMm(dimensions.ml)),
          materials.metal, `catalogArthroplastyEndplate:${side > 0 ? 'superior' : 'inferior'}`
        );
        plate.position.y = side * sceneFromMm((dimensions.height - plateThicknessMm) * .5);
        jointRoot.add(plate);
      });
      const coreHeightMm = Math.max(1, dimensions.height - plateThicknessMm * 2);
      const core = mesh(
        new THREE.CylinderGeometry(sceneFromMm(dimensions.ap * .24), sceneFromMm(dimensions.ap * .24), sceneFromMm(coreHeightMm), 24),
        materials.motion, 'catalogArthroplastyCore'
      );
      jointRoot.add(core);
      root.userData.catalogArthroplasty = {
        catalogId: component.catalogId, sourceUrl: component.sourceUrl,
        apMm: dimensions.ap, mlMm: dimensions.ml, totalHeightMm: dimensions.height,
        lordosisDeg: component.lordosisDeg, keelGeometryVerified: false, placementValidated: false
      };
      updateJointBinding();
      return true;
    }

    function createPelvicHardware(item, type) {
      const root = new THREE.Group();
      root.name = `pelvicHardware:${item.id}`;
      const screw = implantComponent(item.implantPlan, 'screw_set');
      const rod = implantComponent(item.implantPlan, 'rod_set');
      root.userData = {
        itemId: item.id, levelId: item.levelId, procedureId: item.procedureId, type,
        representation: item.implantPlan?.dimensionMode === 'custom'
          ? 'user-dimensioned pelvic hardware envelope; no navigation, fit, or trajectory validation'
          : 'catalog-dimensioned pelvic hardware; no navigation, fit, or trajectory validation',
        dimensionMode: item.implantPlan?.dimensionMode || 'unknown',
        catalogRevision: item.implantPlan?.catalogRevision, renderStatus: item.implantPlan?.renderStatus
      };
      if (!screw) return root;
      // Entry point and planned target of each rigid implant, in this layer's
      // frame; the PI display field anchors and re-aims the implant with them
      // (applyPelvicHardwareField).
      const anchorImplant = (implant, start, end) => {
        if (!implant) return;
        implant.userData.pelvicAnchorScene = start.toArray();
        implant.userData.pelvicAimScene = end.toArray();
      };

      [-1, 1].forEach(side => {
        const label = side > 0 ? 'left' : 'right';
        let start;
        let end;
        if (type === 'si_fusion') {
          start = new THREE.Vector3(.18, .16, side * 1.32);
          end = new THREE.Vector3(-.04, .16, side * .34);
          const assembly = createCatalogScrewAssembly(start, end.clone().sub(start), screw, materials.motion, `siFusionImplant:${label}`);
          anchorImplant(assembly, start, end);
          if (assembly) root.add(assembly);
          return;
        }
        if (type === 'pelvic_iliac') {
          start = new THREE.Vector3(.63, .42, side * 1.03);
          end = new THREE.Vector3(-.40, -.36, side * 1.18);
        } else {
          // S2-alar-iliac path is a recognizable schematic corridor only.
          start = new THREE.Vector3(.39, -.12, side * .43);
          end = new THREE.Vector3(-.45, -.42, side * 1.20);
        }
        const assembly = createCatalogScrewAssembly(start, end.clone().sub(start), screw, materials.screw, `${type}:${label}`);
        anchorImplant(assembly, start, end);
        if (assembly) root.add(assembly);
        if (rod) {
          const rodDirection = new THREE.Vector3(.12, .78, -side * .08).normalize();
          const midpoint = start.clone().add(new THREE.Vector3(.10, .26, -side * .18));
          const halfLength = sceneFromMm(rod.dimensionsMm.length * .5);
          const connector = cylinderBetween(
            midpoint.clone().addScaledVector(rodDirection, -halfLength),
            midpoint.clone().addScaledVector(rodDirection, halfLength),
            sceneFromMm(rod.dimensionsMm.diameter * .5), materials.screw,
            `pelvicConnectorRod:${label}`, 18
          );
          connector.userData = {
            representation: rod.dimensionSource === 'user_entered' ? 'user-dimensioned pelvic connector rod envelope' : 'catalog-dimensioned pelvic connector rod',
            dimensionSource: rod.dimensionSource || 'manufacturer_catalog',
            diameterMm: rod.dimensionsMm.diameter, lengthMm: rod.dimensionsMm.length, fitValidated: false
          };
          anchorImplant(connector, start, end);
          root.add(connector);
        }
      });
      return root;
    }

    /* Reconstruction after a body resection.

       Deliberately built from the patient's own geometry rather than an implant
       catalog. Published dimension tables for expandable vertebral body
       replacements could not be verified, and this app does not ship invented
       dimensions — so the strut is sized to the defect it fills and is labelled
       as a reconstruction envelope, not a device. That is the same discipline
       the PSO wedge already follows.

       The removed body is the record's own body mesh bounds, so the envelope
       tracks the source CT rather than a nominal vertebra. */
    function addBodyResectionReconstruction(root, record, procedure, item) {
      const target = LEVEL_BY_ID.get(item?.levelId);
      const boneKey = target?.bodyId || record.level.superior;
      const sourceBounds = referenceBoundsFor(boneKey);
      const source = record.body;
      if (!sourceBounds && !source?.geometry) return false;

      let width;
      let bodyHeight;
      let depth;
      let center;
      if (sourceBounds) {
        const size = sourceBounds.size.clone().multiplyScalar(REFERENCE_MM_TO_SCENE);
        width = Math.max(1e-3, size.x);
        bodyHeight = Math.max(1e-3, size.y);
        depth = Math.max(1e-3, size.z);
        center = sourceLocalPoint(record.level, sourceBounds.center);
      } else {
        source.geometry.computeBoundingBox();
        const box = source.geometry.boundingBox;
        width = Math.max(1e-3, (box.max.x - box.min.x) * Math.abs(source.scale.x));
        bodyHeight = Math.max(1e-3, (box.max.y - box.min.y) * Math.abs(source.scale.y));
        depth = Math.max(1e-3, (box.max.z - box.min.z) * Math.abs(source.scale.z));
        center = source.position.clone().add(new THREE.Vector3(
          (box.max.x + box.min.x) * .5 * source.scale.x,
          (box.max.y + box.min.y) * .5 * source.scale.y,
          (box.max.z + box.min.z) * .5 * source.scale.z
        ));
      }

      const consumedSegments = consumedDiscSegmentIdsFor(procedure, item.levelId);
      const consumedGapMm = consumedSegments.reduce((sum, segmentId) => {
        const discRecord = segmentRecords.get(segmentId);
        return sum + Math.max(0, finiteOr(discRecord?.disc?.userData?.renderedCenterHeightMm));
      }, 0);
      const defectHeight = bodyHeight + sceneFromMm(consumedGapMm);

      const voidMesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, defectHeight, depth),
        materials.osteotomyEnvelope
      );
      voidMesh.name = 'corpectomyResectionEnvelope';
      voidMesh.position.copy(center);
      voidMesh.userData = {
        representation: 'source-CT-bounded complete-body and adjacent-disc defect envelope',
        boneKey,
        consumedDiscSegments: [...consumedSegments],
        ctMeshBooleanSubtracted: false,
        patientSpecificCutValidated: false
      };
      root.add(voidMesh);

      const radius = Math.min(width, depth) * 0.30;
      const strut = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, defectHeight, 20, 1, true),
        materials.cage
      );
      strut.name = 'corpectomyStrut';
      strut.position.copy(center);
      strut.userData = {
        representation: 'source-defect-sized vertebral-body-replacement envelope; not a catalog device',
        spansAdjacentDiscDefects: consumedSegments.length > 0,
        catalogDimensionsClaimed: false
      };
      root.add(strut);

      const capHeight = Math.max(sceneFromMm(1), defectHeight * .045);
      const capGeometry = new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, capHeight, 20);
      [1, -1].forEach(sign => {
        const cap = new THREE.Mesh(capGeometry, materials.cage);
        cap.name = sign > 0 ? 'corpectomyStrutCranialCap' : 'corpectomyStrutCaudalCap';
        cap.position.copy(center).add(new THREE.Vector3(0, sign * (defectHeight - capHeight) * .5, 0));
        root.add(cap);
      });

      const graft = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, defectHeight * 0.8, 12),
        materials.graft
      );
      graft.name = 'corpectomyGraft';
      graft.position.copy(center);
      root.add(graft);

      root.userData.reconstruction = 'source-CT-bounded body-plus-disc defect envelope; not a catalog-dimensioned device';
      root.userData.resectedBodyHeightSceneUnits = Number(bodyHeight.toFixed(4));
      root.userData.reconstructionSpanSceneUnits = Number(defectHeight.toFixed(4));
      root.userData.consumedDiscSegments = [...consumedSegments];
      return true;
    }

    function addSourceBoundedKyphoplastyEnvelope(root, record, item) {
      const target = LEVEL_BY_ID.get(item?.levelId);
      const bounds = referenceBoundsFor(target?.bodyId || record.level.superior);
      if (!bounds) return false;
      const center = sourceLocalPoint(record.level, bounds.center);
      const size = bounds.size.clone().multiplyScalar(REFERENCE_MM_TO_SCENE);
      [-1, 1].forEach(side => {
        const cement = mesh(
          new THREE.SphereGeometry(Math.max(sceneFromMm(1), size.y * .14), 18, 12),
          materials.graft,
          `kyphoplastyCementEnvelope:${side > 0 ? 'left' : 'right'}`
        );
        cement.scale.set(
          Math.max(.6, size.x / Math.max(size.y, 1e-3) * .55),
          .75,
          Math.max(.55, size.z / Math.max(size.y, 1e-3) * .30)
        );
        cement.position.copy(center).add(new THREE.Vector3(-size.x * .08, 0, side * size.z * .16));
        cement.userData = {
          representation: 'source-bounded cement augmentation envelope; fill and leakage are not simulated',
          ctBodyPreserved: true,
          injectionPressureModeled: false,
          leakageRiskCalculated: false
        };
        root.add(cement);
      });
      root.userData.augmentationRendered = true;
      return true;
    }

    function addSourceBoundedPosteriorResectionMarker(root, record, kind) {
      const bounds = referenceBoundsFor(record.level.superior);
      if (!bounds) return false;
      const center = sourceLocalPoint(record.level, bounds.center);
      const size = bounds.size.clone().multiplyScalar(REFERENCE_MM_TO_SCENE);
      if (kind === 'laminoplasty') {
        [-1, 1].forEach((side, index) => {
          const marker = mesh(
            new THREE.BoxGeometry(size.x * .035, size.y * .34, size.z * .06),
            index === 0 ? materials.cutSurface : materials.motion,
            index === 0 ? 'laminoplastyHingeEnvelope' : 'laminoplastyOpeningCutEnvelope'
          );
          marker.position.copy(center).add(new THREE.Vector3(size.x * .32, 0, side * size.z * .18));
          marker.userData = {
            representation: index === 0
              ? 'source-bounded laminoplasty hinge envelope'
              : 'source-bounded laminoplasty opening cut envelope',
            ctMeshBooleanSubtracted: false,
            plateGeometryModeled: false,
            canalExpansionValidated: false
          };
          root.add(marker);
        });
      } else {
        [-1, 1].forEach(side => {
          const marker = mesh(
            new THREE.SphereGeometry(Math.max(sceneFromMm(.8), size.y * .07), 12, 8),
            materials.cutSurface,
            `grade1PartialFacetResectionEnvelope:${side > 0 ? 'left' : 'right'}`
          );
          marker.scale.set(1.2, .7, .8);
          marker.position.copy(center).add(new THREE.Vector3(size.x * .30, size.y * .12, side * size.z * .28));
          marker.userData = {
            representation: 'source-bounded partial facet resection envelope; intact CT surface is not subtracted',
            facetCapsuleInterrupted: true,
            ligamentumFlavumPreserved: true,
            cutSafetyValidated: false
          };
          root.add(marker);
        });
      }
      return true;
    }

    function createHardware(item, record) {
      const procedure = PROCEDURES[item.procedureId];
      const root = new THREE.Group();
      root.name = `hardware:${item.id}`;
      root.userData = {
        itemId: item.id, levelId: item.levelId, procedureId: item.procedureId, type: procedure.type,
        representation: item.implantPlan?.dimensionMode === 'custom'
          ? 'user-dimensioned implant envelope; placement and trajectory are not validated'
          : 'catalog-dimensioned implant envelope; placement and trajectory are not validated',
        dimensionMode: item.implantPlan?.dimensionMode || 'unknown',
        catalogRevision: item.implantPlan?.catalogRevision,
        renderStatus: item.implantPlan?.renderStatus || 'withheld_missing_plan'
      };
      root.position.z = 0;

      /* A body resection is drawn before the catalog check, because none of its
         geometry comes from a catalog - the resection is the patient's own body
         bounds and the strut is sized to that defect. Withholding it because no
         verified VBR dimension table exists would have meant the single most
         visible thing the procedure does simply never appeared. The catalog is
         still reported as withheld; that claim is about the device, not the
         resection. */
      if (procedure.wholeBodyResection === true) {
        const built = addBodyResectionReconstruction(root, record, procedure, item);
        const target = LEVEL_BY_ID.get(item.levelId);
        const spanningBoneKeys = target?.kind === 'vertebral_body'
          ? [
              LEVEL_BY_ID.get(target.cranialSegmentId)?.superior,
              LEVEL_BY_ID.get(target.caudalSegmentId)?.inferior
            ].filter(Boolean)
          : null;
        const posteriorBuilt = procedure.mandatorySupplementalFixation === true
          ? addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.amber, spanningBoneKeys)
          : false;
        root.userData.representation = built
          ? 'source-defect-bounded resection and reconstruction envelope; not a dimensioned VBR implant'
          : 'body resection could not be built from the source geometry';
        root.userData.anteriorSupportRendered = built;
        root.userData.posteriorSupportRendered = posteriorBuilt;
        root.userData.catalogDimensionsWithheld = true;
        root.userData.withheldReason = 'No verified vertebral body replacement dimension table was available, so the anterior envelope is sized to the source defect rather than to a device.';
        return root;
      }

      if (!item.implantPlan || String(item.implantPlan.renderStatus || '').startsWith('withheld_')) {
        root.userData.hardwareWithheld = true;
        root.userData.withheldReason = item.implantPlan?.note || 'No verified catalog dimensions were selected.';
        return root;
      }

      switch (procedure.type) {
        case 'anterior_cage_plate':
          addCatalogInterbody(root, record, item.implantPlan, 'acdf');
          root.userData.omittedComponent = 'Anterior plate withheld pending a dimensioned catalog.';
          break;

        case 'motion_disc':
          root.userData.arthroplastyRendered = addCatalogArthroplasty(root, record, item.implantPlan);
          if (!root.userData.arthroplastyRendered) {
            root.userData.hardwareWithheld = true;
            root.userData.withheldReason = root.userData.arthroplastyGeometryWithheldReason
              || item.implantPlan?.note || 'A live contained arthroplasty envelope is unavailable.';
          }
          break;

        case 'posterior_screws':
          addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.screw);
          break;

        case 'decompression': {
          root.userData.resection = 'planned lamina/spinous resection envelope on anatomy layer; intact CT mesh is not subtracted';
          break;
        }

        case 'decompression_motion_sparing': {
          root.userData.anatomyEnvelopeRendered = addSourceBoundedPosteriorResectionMarker(root, record, 'laminoplasty');
          root.userData.resection = 'source-bounded laminoplasty hinge/opening envelopes; intact CT mesh is not subtracted';
          break;
        }

        case 'vertebral_augmentation': {
          root.userData.anatomyEnvelopeRendered = addSourceBoundedKyphoplastyEnvelope(root, record, item);
          break;
        }

        case 'posterior_motion': {
          const topsGeometryAdded = addCatalogTopsMotionDevice(root, record, item.implantPlan);
          if (!topsGeometryAdded) {
            root.userData.hardwareWithheld = true;
            root.userData.withheldReason = root.userData.topsGeometryWithheldReason
              || 'The TOPS construct could not be built atomically from the available source anchors.';
            root.userData.resection = 'TOPS construct and TOPS-specific derived resection are withheld; the separately linked decompression scenario remains visible.';
          } else {
            root.userData.resection = 'TOPS requires same-level bilateral decompression with posterior-element/facet resection; the linked laminectomy item is added automatically.';
          }
          break;
        }

        case 'posterior_cage_screws':
          root.userData.interbodyRendered = addCatalogInterbody(root, record, item.implantPlan, procedure.interbodyApproach || 'tlif');
          root.userData.posteriorSupportRendered = addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.screw);
          break;

        case 'anterior_cage_screws':
          root.userData.interbodyRendered = addCatalogInterbody(root, record, item.implantPlan, procedure.interbodyApproach || 'alif');
          root.userData.posteriorSupportRendered = addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.screw);
          root.userData.omittedComponent = 'Generic anterior plate removed; no dimensioned plate catalog is loaded.';
          break;

        case 'lateral_cage_screws':
        case 'oblique_cage_screws':
          root.userData.interbodyRendered = addCatalogInterbody(root, record, item.implantPlan, procedure.interbodyApproach || 'llif');
          root.userData.posteriorSupportRendered = addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.screw);
          root.userData.omittedComponent = 'Approach-specific lateral plate and corridor anatomy are withheld; no dimensioned plate catalog or patient corridor is loaded.';
          break;

        case 'osteotomy_post':
          root.userData.posteriorSupportRendered = addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.amber);
          break;

        case 'osteotomy_post_g1':
          root.userData.anatomyEnvelopeRendered = addSourceBoundedPosteriorResectionMarker(root, record, 'grade1');
          root.userData.posteriorSupportRendered = addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.amber);
          break;

        case 'osteotomy_wedge':
          root.userData.posteriorSupportRendered = addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.amber);
          break;

        case 'osteotomy_wedge_extended': {
          const target = LEVEL_BY_ID.get(item.levelId);
          const spanningBoneKeys = target?.kind === 'vertebral_body'
            ? [
                LEVEL_BY_ID.get(target.cranialSegmentId)?.superior,
                LEVEL_BY_ID.get(target.caudalSegmentId)?.inferior
              ].filter(Boolean)
            : null;
          root.userData.posteriorSupportRendered = addCatalogPosteriorConstruct(
            root, record, item.implantPlan, materials.amber, spanningBoneKeys
          );
          root.userData.anatomyEnvelopeRendered = true;
          break;
        }

        case 'atlantoaxial_fusion':
          root.userData.posteriorSupportRendered = addCatalogPosteriorConstruct(root, record, item.implantPlan, materials.screw);
          break;
      }
      return root;
    }

    function disposeHardwareLayer(layer) {
      const children = [...layer.children];
      for (const child of children) {
        child.traverse(object => {
          if (object.geometry) object.geometry.dispose();
        });
        layer.remove(child);
      }
    }

    function rebuildHardware() {
      for (const record of segmentRecords.values()) {
        disposeHardwareLayer(record.hardwareLayer);
        disposeTopsPostoperativeReferenceLayer(record);
        record.decompressed = false;
        record.osteotomyType = null;
        record.ligamentDisrupted = false;
        record.disruptedLigaments = new Set();
        record.laminoplasty = false;
        record.discReplaced = false;
        record.discExcised = false;
        record.bodyResected = false;
        record.bodyResectionSpares = null;
        record.interbodyApproach = null;
        record.topsReconstruction = false;
        record.topsAdjacentResection = false;
        record.topsResectionContext = null;
      }
      if (pelvicHardwareLayer) disposeHardwareLayer(pelvicHardwareLayer);

      const byLevel = new Map();
      state.itinerary.forEach(item => {
        const procedure = PROCEDURES[item.procedureId];
        if (procedure && ['pelvic_s2ai', 'pelvic_iliac', 'si_fusion'].includes(procedure.type)) {
          pelvicHardwareLayer?.add(createPelvicHardware(item, procedure.type));
          return;
        }
        /* A body-indexed item has no segment record of its own. Route it to the
           record that owns that bone (the caudal segment) so it renders at all,
           and mark both spanned discs as excised when the resection consumes
           them. Without this the item was silently skipped: no hardware, no
           resection, and no error to say so. */
        const target = LEVEL_BY_ID.get(item.levelId);
        if (target?.kind === 'vertebral_body') {
          const host = segmentRecords.get(target.hostSegmentId);
          if (host) {
            if (procedure?.wholeBodyResection === true) {
              host.bodyResected = true;
              // A three-column resection takes the posterior elements with the
              // body; an anterior corpectomy leaves them. The tension-band flag
              // already draws exactly that distinction.
              host.bodyResectionSpares = disruptsPosteriorTensionBand(procedure) ? null : 'posterior_elements';
            }
            if (procedure && consumesAdjacentDiscs(procedure)) {
              consumedDiscSegmentIdsFor(procedure, item.levelId).forEach(segmentId => {
                const spanned = segmentRecords.get(segmentId);
                if (spanned) spanned.discExcised = true;
              });
            }
            if (!byLevel.has(target.hostSegmentId)) byLevel.set(target.hostSegmentId, []);
            byLevel.get(target.hostSegmentId).push(item);
          }
          return;
        }
        if (!byLevel.has(item.levelId)) byLevel.set(item.levelId, []);
        byLevel.get(item.levelId).push(item);
      });

      for (const [levelId, items] of byLevel) {
        const record = segmentRecords.get(levelId);
        if (!record) continue;
        items.forEach(item => {
          const procedure = PROCEDURES[item.procedureId];
          const hardware = createHardware(item, record);
          if (procedure.type === 'decompression') record.decompressed = true;
          if (procedure.type === 'decompression_motion_sparing') record.laminoplasty = true;
          if (['osteotomy_post', 'osteotomy_post_g1', 'osteotomy_wedge', 'osteotomy_wedge_extended'].includes(procedure.type)) {
            record.osteotomyType = procedure.type;
          }
          if (procedure.type === 'motion_disc' && hardware.userData.arthroplastyRendered === true) {
            record.discReplaced = true;
            record.discExcised = true;
          }
          if (procedure.interbodyApproach && hardware.userData.interbodyRendered === true) {
            record.interbodyApproach = procedure.interbodyApproach;
            record.discExcised = true;
          }
          if (procedure.type === 'anterior_cage_plate' && hardware.userData.interbodyRendered === true) {
            record.interbodyApproach = 'acdf';
            record.discExcised = true;
          }
          if (procedure.type === 'posterior_motion' && !hardware.userData.hardwareWithheld) {
            const motionDevice = implantComponent(item.implantPlan, 'posterior_motion_device');
            const screwSet = implantComponent(item.implantPlan, 'screw_set');
            const screwOuterDiameterMm = finiteOr(screwSet?.dimensionsMm?.outerDiameter, 6.5);
            const interpedicularDistanceMm = finiteOr(motionDevice?.dimensionsMm?.interpedicularDistance, 30);
            record.topsReconstruction = true;
            record.topsResectionContext = {
              treatedLevelId: item.levelId,
              role: 'superior',
              boneKey: record.level.superior,
              screwOuterDiameterMm,
              interpedicularDistanceMm
            };
            const inferiorRecord = [...segmentRecords.values()].find(candidate => candidate.level.superior === record.level.inferior);
            if (inferiorRecord) {
              inferiorRecord.topsAdjacentResection = true;
              inferiorRecord.topsResectionContext = {
                treatedLevelId: item.levelId,
                role: 'inferior',
                boneKey: record.level.inferior,
                screwOuterDiameterMm,
                interpedicularDistanceMm
              };
            }
          }
          for (const ligament of procedure.disruptsLigaments || []) record.disruptedLigaments.add(ligament);
          if (disruptsPosteriorTensionBand(procedure)) record.ligamentDisrupted = true;
          record.hardwareLayer.add(hardware);
        });
      }
      // Newly built pelvic implants start in the rest pose; place them on the
      // currently displayed PI field.
      applyPelvicHardwareField();
      updateSurgicalVisibility();
    }

    function collectLocalCorrections() {
      const byLevel = new Map();
      let lumbar = 0;
      let cervical = 0;
      let thoracic = 0;
      if (state.view !== 'post' || state.prediction?.applicabilityStatus !== 'within_engineering_domain') {
        return { byLevel, lumbar, cervical, thoracic };
      }
      for (const item of state.itinerary) {
        const procedure = PROCEDURES[item.procedureId];
        const level = LEVEL_BY_ID.get(item.levelId);
        if (!procedure || !level || level.isChain === false || !correctionPolicyFor(procedure, level).enabled) continue;
        const correction = correctionFor(item, procedure);
        /* applyModelTargets reads this map by iterating segmentRecords, whose
           keys are motion segments. Writing a body id here would store a value
           nothing ever reads, so the reported alignment and the posed model would
           silently disagree. Spread the correction across the segments the target
           actually spans.

           The even split is a display distribution convention, not a claim about
           where the angular change physically occurs across a resected body. */
        const span = spannedSegmentIdsFor(item.levelId);
        const share = span.length ? correction / span.length : 0;
        span.forEach(segmentId => byLevel.set(segmentId, (byLevel.get(segmentId) || 0) + share));
        if (level.metricRegion === 'lumbar') lumbar += correction;
        if (level.metricRegion === 'cervical') cervical += correction;
        if (level.metricRegion === 'thoracic') thoracic += correction;
      }
      return { byLevel, lumbar, cervical, thoracic };
    }

    function recordVisualRoots(record) {
      return [
        record.referenceLayer, record.topsPostoperativeReferenceLayer,
        record.disc, record.body, record.endplates, record.posteriorElement,
        record.ligaments.layer, record.cutSurfaces, record.decompressionVoid, record.interbodyResectionEnvelope,
        record.osteotomyRemnants, record.hardwareLayer, record.osteophytes
      ].filter(Boolean);
    }

    function anatomyLayerKeyFor(record) {
      const bone = String(record?.level?.superior || '');
      if (bone === 'C0') return 'skull';
      if (bone.startsWith('C')) return 'cervical';
      if (bone.startsWith('T')) return 'thoracic';
      if (bone.startsWith('L')) return 'lumbar';
      return null;
    }

    function recordRegionVisible(record) {
      if (state.inspection?.active && state.inspection.levelId === record.level.id) return true;
      const key = anatomyLayerKeyFor(record);
      return !key || state.layers?.[key] !== false;
    }

    // Every motion segment is nested below the next caudal segment. Hiding the
    // kinematic group would therefore also hide all anatomy above it. This
    // identity wrapper contains only that record's rendered anatomy, leaving the
    // chain and every more-cranial record active and independently visible.
    function installRecordRegionLayer(record) {
      if (!record?.anatomyRoot || record.regionVisibilityLayer) return record?.regionVisibilityLayer || null;
      const layer = new THREE.Group();
      layer.name = `regionVisibility:${anatomyLayerKeyFor(record) || 'spine'}`;
      layer.userData = { levelId: record.level.id, regionKey: anatomyLayerKeyFor(record) };
      record.anatomyRoot.add(layer);
      [...recordVisualRoots(record), record.highlight].filter(Boolean).forEach(root => {
        if (root.parent === record.anatomyRoot) layer.add(root);
      });
      record.regionVisibilityLayer = layer;
      return layer;
    }

    function recordHasNonRigidAtlasOverride(record) {
      const factor = levelFactorFor(record.level.id);
      // This identifies a requested whole-bone edit. It may drive the procedural
      // fallback only when no source CT surface exists; an intact CT surface is
      // never replaced with a schematic vertebra.
      return (factor.morphologyVariant && factor.morphologyVariant !== 'typical')
        || Math.abs(finiteOr(factor.bodyWidthScale, 1) - 1) > .005
        || Math.abs(finiteOr(factor.bodyDepthScale, 1) - 1) > .005
        || Math.abs(finiteOr(factor.pedicleScale, 1) - 1) > .005;
    }

    function ctShapeEditReasons(record) {
      const factor = levelFactorFor(record.level.id);
      const reasons = [];
      if (recordHasNonRigidAtlasOverride(record)) {
        reasons.push('Whole-bone morphology and proportion edits require a compatible segmented variant surface.');
      }
      if (Math.abs(finiteOr(factor.facetHypertrophy)) > .005) {
        reasons.push('Facet hypertrophy requires segmented facet surfaces.');
      }
      if (Math.abs(finiteOr(factor.osteophytes)) > .005) {
        reasons.push('Osteophyte burden requires a segmented endplate-margin growth surface.');
      }
      return reasons;
    }

    function disposeTopsPostoperativeReferenceLayer(record) {
      const layer = record?.topsPostoperativeReferenceLayer;
      if (!layer) return;
      [...layer.children].forEach(child => {
        child.traverse(object => { if (object.geometry) object.geometry.dispose(); });
        layer.remove(child);
      });
      layer.visible = false;
      layer.userData = {
        geometryMode: 'not_active',
        representation: 'derived open postoperative display surface; not a Boolean surgical solid'
      };
    }

    function ensureTopsPostoperativeReferenceLayer(record) {
      const layer = record?.topsPostoperativeReferenceLayer;
      const context = record?.topsResectionContext;
      if (!layer || !context || !record.referenceLayer?.children.length) return false;
      const contextKey = [
        context.treatedLevelId, context.role, context.boneKey,
        finiteOr(context.screwOuterDiameterMm, 6.5).toFixed(1)
      ].join(':');
      if (layer.userData.contextKey !== contextKey || layer.children.length !== 1) {
        disposeTopsPostoperativeReferenceLayer(record);
        const geometry = buildTopsPostDecompressionGeometry(context);
        let intactSurface = null;
        record.referenceLayer.traverse(object => {
          if (!intactSurface && object.isMesh && object.name === `ctReferenceSurface:${context.boneKey}`) intactSurface = object;
        });
        if (!geometry || !intactSurface) {
          layer.userData = {
            ...layer.userData,
            contextKey,
            geometryMode: 'withheld_fail_closed',
            withheldReason: 'The source-locked postoperative shell could not be derived; the intact CT reference remains active.'
          };
          return false;
        }
        const surface = mesh(
          geometry,
          materials.referenceBone,
          `topsPostDecompressionSurface:${context.boneKey}:${context.role}`
        );
        surface.position.copy(intactSurface.position);
        surface.quaternion.copy(intactSurface.quaternion);
        surface.scale.copy(intactSurface.scale);
        surface.userData = {
          ...geometry.userData,
          levelId: record.level.id,
          boneKey: context.boneKey,
          treatedLevelId: context.treatedLevelId,
          resectionRole: context.role,
          sourceTransformCopiedFrom: intactSurface.name,
          patientSpecificCutValidated: false,
          cutSafetyValidated: false
        };
        layer.add(surface);
        layer.userData = {
          geometryMode: 'ct_derived_post_decompression',
          contextKey,
          boneKey: context.boneKey,
          treatedLevelId: context.treatedLevelId,
          resectionRole: context.role,
          openSurface: true,
          patientSpecificCutValidated: false,
          cutSafetyValidated: false,
          representation: 'source-locked derived open postoperative external surface; not a Boolean surgical solid'
        };
      }
      return layer.children.length === 1 && layer.userData.geometryMode === 'ct_derived_post_decompression';
    }

    function applyRecordGeometryPolicy(record) {
      const hasReference = Boolean(record.referenceLayer?.children.length);
      // Isolated decompression, SPO and PSO remain overlays on the intact CT
      // whole-bone surface. TOPS is the one explicit postoperative display path:
      // a source-locked open surface removes bounded posterior triangles at both
      // treated bones while preserving the intact source mesh for pre-op. It is
      // not a Boolean solid, patient-specific cut plan or clearance assessment.
      const topsPostoperativeSurface = state.view === 'post'
        && (record.topsReconstruction || record.topsAdjacentResection)
        && ensureTopsPostoperativeReferenceLayer(record);
      const surgicalFallback = state.view === 'post'
        && !hasReference
        && (record.topsReconstruction || record.topsAdjacentResection);
      const inspectionFallback = state.inspection?.active
        && state.inspection.levelId === record.level.id
        && finiteOr(state.inspection.explode) > .001;
      const authoredOverride = recordHasNonRigidAtlasOverride(record);
      const authoredShapeEditReasons = hasReference ? ctShapeEditReasons(record) : [];
      const authoredFallback = authoredOverride && !hasReference;
      /* A resected vertebral body has to fall back to the semantic primitives for
         the same reason the TOPS decompression does: the CT reference surface is
         a single mesh covering the whole vertebra, so it cannot show a body that
         is gone while keeping the posterior elements that are not. Dropping to
         primitives lets the body and endplates be hidden individually. */
      const bodyResectionActive = state.view === 'post' && record.bodyResected === true;
      const showReference = hasReference && !topsPostoperativeSurface && !surgicalFallback && !inspectionFallback && !authoredFallback && !bodyResectionActive;
      record.referenceLayer.visible = showReference;
      if (record.topsPostoperativeReferenceLayer) record.topsPostoperativeReferenceLayer.visible = topsPostoperativeSurface;
      const showSemantic = !showReference && !topsPostoperativeSurface;
      const bodyWedge = state.view === 'post'
        && ['osteotomy_wedge', 'osteotomy_wedge_extended'].includes(record.osteotomyType)
        && !showReference;
      record.body.visible = showSemantic && !bodyWedge && !bodyResectionActive;
      record.endplates.visible = showSemantic && !bodyResectionActive;
      // An anterior corpectomy leaves the posterior column standing; a
      // three-column resection takes it with the body.
      record.posteriorElement.visible = showSemantic
        && !(bodyResectionActive && record.bodyResectionSpares !== 'posterior_elements');
      record.geometryMode = topsPostoperativeSurface ? 'ct_derived_post_decompression'
        : showReference ? 'ct_reference'
        : !hasReference ? 'procedural_fallback'
        : surgicalFallback ? 'semantic_surgical_fallback'
        : inspectionFallback ? 'semantic_exploded_fallback'
        : 'schematic_morph_fallback';
      record.referenceLayer.userData.geometryMode = record.geometryMode;
      record.referenceLayer.userData.authoredMorphologyWithheld = authoredShapeEditReasons.length > 0;
      record.referenceLayer.userData.authoredMorphologyWithheldReasons = [...authoredShapeEditReasons];
      record.referenceLayer.userData.authoredMorphologyWithheldReason = authoredShapeEditReasons.length
        ? authoredShapeEditReasons.join(' ')
        : null;
      return record.geometryMode;
    }

    function updateGeometryStatus() {
      if (!els.geometryChip) return;
      const modes = [...segmentRecords.values()].map(record => record.geometryMode);
      const intactReferenceCount = modes.filter(mode => mode === 'ct_reference').length;
      const postoperativeReferenceCount = modes.filter(mode => mode === 'ct_derived_post_decompression').length;
      const referenceCount = intactReferenceCount + postoperativeReferenceCount;
      const fallbackCount = modes.length - referenceCount;
      const hasCtPelvis = Boolean(pelvisReferenceLayer?.children.length);
      const hasReferenceLowerLimbs = lowerExtremityContext?.userData?.geometryMode === 'bodyparts3d_bilateral_reference';
      const lowerLimbSuffix = hasReferenceLowerLimbs ? ' + atlas lower limbs' : '';
      const withheldShapeRecords = [...segmentRecords.values()].filter(
        record => record.referenceLayer?.userData?.authoredMorphologyWithheld
      );
      const withheldShapeEditCount = withheldShapeRecords.reduce(
        (sum, record) => sum + Math.max(
          1,
          record.referenceLayer.userData.authoredMorphologyWithheldReasons?.length || 0
        ),
        0
      );
      const withheldMorphologySuffix = withheldShapeEditCount
        ? ` · ${withheldShapeEditCount} unsupported anatomy edit${withheldShapeEditCount === 1 ? '' : 's'} withheld across ${withheldShapeRecords.length} level${withheldShapeRecords.length === 1 ? '' : 's'}`
        : '';
      const withheldDiscCount = [...segmentRecords.values()].filter(record => record.disc?.userData?.geometryWithheld).length;
      const withheldDiscSuffix = withheldDiscCount
        ? ` · ${withheldDiscCount} disc solid${withheldDiscCount === 1 ? '' : 's'} withheld (no continuous CT clearance)`
        : '';
      const withheldLigamentCount = [...segmentRecords.values()]
        .filter(record => record.ligaments?.layer?.userData?.geometryWithheld).length;
      const withheldCanalCount = [...segmentRecords.values()]
        .filter(record => record.decompressionVoid?.userData?.authoredCanalShapeWithheld).length;
      const pelvicContextWithheld = pelvisGroup?.userData?.pelvicReferenceContextWithheld === true;
      const pelvicReshaped = pelvisGroup?.userData?.pelvicIncidenceSchematicReshaping === true;
      const integritySuffix = [
        withheldLigamentCount ? `${withheldLigamentCount} non-continuous ligament overlay${withheldLigamentCount === 1 ? '' : 's'} withheld` : '',
        withheldCanalCount ? `${withheldCanalCount} unsegmented canal edit${withheldCanalCount === 1 ? '' : 's'} withheld` : '',
        pelvicReshaped ? `pelvis shape adjusted schematically to PI ${degree(finiteOr(pelvisGroup.userData.pelvicIncidence))} (educational approximation, not patient anatomy)` : '',
        // Only without the CT pelvis, which the PI display field needs.
        pelvicContextWithheld ? 'schematic pelvis withheld for non-reference PI (limbs kept on the hip axis)' : ''
      ].filter(Boolean);
      const integrityStatusSuffix = integritySuffix.length ? ` · ${integritySuffix.join(' · ')}` : '';
      if (modes.length && referenceCount === modes.length) {
        els.geometryChip.dataset.mode = 'reference';
        els.geometryChip.textContent = `Source-coherent CT spine${hasCtPelvis ? ' + pelvis' : ''}${lowerLimbSuffix} · one mm scale${withheldMorphologySuffix}${withheldDiscSuffix}${integrityStatusSuffix}`;
      } else if (referenceCount > 0) {
        els.geometryChip.dataset.mode = 'fallback';
        els.geometryChip.textContent = `Hybrid display · ${referenceCount} CT-derived level${referenceCount === 1 ? '' : 's'}${hasCtPelvis ? ' + CT-derived pelvis' : ''}${lowerLimbSuffix} + ${fallbackCount} explicit semantic fallback${fallbackCount === 1 ? '' : 's'}${withheldMorphologySuffix}${withheldDiscSuffix}${integrityStatusSuffix}`;
      } else {
        els.geometryChip.dataset.mode = 'fallback';
        els.geometryChip.textContent = `Procedural fallback · embedded CT reference surfaces unavailable${withheldDiscSuffix}${integrityStatusSuffix}`;
      }
    }

    function restoreInspectionMaterialsAndPositions() {
      segmentRecords.forEach(record => {
        recordVisualRoots(record).forEach(root => root.traverse(object => {
          if (object.userData?.inspectionOriginalMaterial) {
            const clone = object.material;
            object.material = object.userData.inspectionOriginalMaterial;
            delete object.userData.inspectionOriginalMaterial;
            if (clone?.dispose) clone.dispose();
          }
          if (object.userData?.inspectionBasePosition) {
            object.position.copy(object.userData.inspectionBasePosition);
            delete object.userData.inspectionBasePosition;
          }
        }));
      });
    }

    function restoreInspectionRootVisibility() {
      segmentRecords.forEach(record => {
        record.disc.visible = true;
        record.body.visible = true;
        record.endplates.visible = true;
        record.posteriorElement.visible = true;
        record.ligaments.layer.visible = true;
        record.hardwareLayer.visible = state.view === 'post';
        record.cutSurfaces.visible = false;
        record.decompressionVoid.visible = false;
        record.osteotomyRemnants.visible = false;
        if (record.interbodyResectionEnvelope) record.interbodyResectionEnvelope.visible = false;
        record.highlight.visible = false;
        const geometryMode = applyRecordGeometryPolicy(record);
        if (geometryMode === 'ct_derived_post_decompression') {
          record.cutSurfaces.visible = false;
          record.decompressionVoid.visible = false;
        }
      });
      if (pelvisReferenceLayer) pelvisReferenceLayer.visible = pelvisReferenceLayer.children.length > 0;
      if (pelvisAnatomyLayer) pelvisAnatomyLayer.visible = !pelvisReferenceLayer?.children.length;
      if (siJointLayer) siJointLayer.visible = true;
      if (pelvisLigamentLayer) pelvisLigamentLayer.visible = true;
      if (pelvicHardwareLayer) pelvicHardwareLayer.visible = state.view === 'post';
      if (lowerExtremityContext) lowerExtremityContext.visible = state.globalDeformity?.lowerExtremitiesVisible === true;
      updateGeometryStatus();
    }

    function applyInspectionTransparency(record) {
      const boneMaterials = new Set([materials.referenceBone, materials.bone, materials.boneDark, materials.cortical]);
      [record.referenceLayer, record.topsPostoperativeReferenceLayer, record.body, record.endplates, record.posteriorElement, record.osteophytes].forEach(root => root?.traverse(object => {
        if (!object.isMesh || !boneMaterials.has(object.material) || object.userData.inspectionOriginalMaterial) return;
        object.userData.inspectionOriginalMaterial = object.material;
        object.material = object.material.clone();
        object.material.transparent = true;
        object.material.opacity = .30;
        object.material.depthWrite = false;
      }));
    }

    function applyInspectionExplosion(record, amount) {
      const spread = THREE.MathUtils.clamp(finiteOr(amount), 0, 1) * Math.max(record.dims.width, record.dims.depth) * .72;
      if (!spread) return;
      const components = [
        record.anatomy.pedicles.left, record.anatomy.pedicles.right,
        record.anatomy.laminae.left, record.anatomy.laminae.right,
        record.anatomy.facets.left, record.anatomy.facets.right,
        record.anatomy.pars.left, record.anatomy.pars.right,
        record.anatomy.transverseProcesses.left, record.anatomy.transverseProcesses.right,
        record.anatomy.spinous, ...record.endplates.children, ...record.hardwareLayer.children
      ].filter(Boolean);
      components.forEach((component, index) => {
        if (!component.userData.inspectionBasePosition) component.userData.inspectionBasePosition = component.position.clone();
        const side = component.name.includes(':left') ? 1 : component.name.includes(':right') ? -1 : 0;
        component.position.z = component.userData.inspectionBasePosition.z + side * spread;
        if (!side) component.position.x = component.userData.inspectionBasePosition.x + ((index % 3) - 1) * spread * .34;
      });
    }

    function visibleInspectionBoundsForRecord(record) {
      const bounds = new THREE.Box3();
      const leafBounds = new THREE.Box3();
      const visit = (object, ancestorsVisible = true) => {
        if (!object || !ancestorsVisible || object.visible === false || object.userData?.excludeFromInspectionBounds === true) return;
        if (object.isMesh && object.geometry) {
          if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
          if (object.geometry.boundingBox && !object.geometry.boundingBox.isEmpty()) {
            leafBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
            bounds.union(leafBounds);
          }
        }
        object.children?.forEach(child => visit(child, true));
      };
      recordVisualRoots(record).forEach(root => visit(root, true));
      return bounds;
    }

    function frameInspectionRecord(record) {
      if (!record || !camera || !controls) return;
      if (!inspectionCameraState) {
        inspectionCameraState = {
          position: camera.position.clone(),
          target: controls.target.clone(),
          minDistance: controls.minDistance,
          maxDistance: controls.maxDistance
        };
      }
      worldRoot?.updateMatrixWorld(true);
      const bounds = visibleInspectionBoundsForRecord(record);
      if (['level', 'implant'].includes(state.inspection?.scope)) {
        const inferiorRecord = [...segmentRecords.values()]
          .find(candidate => candidate.level.superior === record.level.inferior);
        if (inferiorRecord) bounds.union(visibleInspectionBoundsForRecord(inferiorRecord));
      }
      if (bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const direction = camera.position.clone().sub(controls.target);
      if (direction.lengthSq() < .0001) direction.set(1, .2, 3);
      direction.normalize();
      const distance = THREE.MathUtils.clamp(Math.max(size.x, size.y, size.z) * 3.4, 2.4, 24);
      controls.minDistance = CAMERA_LIMITS.inspectionMinDistance;
      controls.maxDistance = CAMERA_LIMITS.inspectionMaxDistance;
      controls.target.copy(center);
      camera.position.copy(center).add(direction.multiplyScalar(distance));
      controls.update();
    }

    function applyInspectionVisibility() {
      const selection = state.inspection;
      if (!selection?.active || !selection.levelId) return;
      const selected = segmentRecords.get(selection.levelId);
      if (!selected) return;
      restoreInspectionMaterialsAndPositions();
      restoreInspectionRootVisibility();
      inspectionApplying = true;
      updateSurgicalVisibility();
      inspectionApplying = false;

      const scope = ['body', 'implant', 'level'].includes(selection.scope) ? selection.scope : 'level';
      const inferiorRecord = ['level', 'implant'].includes(scope)
        ? [...segmentRecords.values()].find(candidate => candidate.level.superior === selected.level.inferior)
        : null;
      segmentRecords.forEach((record, levelId) => {
        if (levelId === selection.levelId || record === inferiorRecord) return;
        recordVisualRoots(record).forEach(root => { root.visible = false; });
        record.highlight.visible = false;
      });
      if (inferiorRecord) {
        applyRecordGeometryPolicy(inferiorRecord);
        [
          inferiorRecord.disc, inferiorRecord.ligaments.layer,
          inferiorRecord.cutSurfaces, inferiorRecord.decompressionVoid,
          inferiorRecord.interbodyResectionEnvelope, inferiorRecord.osteotomyRemnants,
          inferiorRecord.hardwareLayer
        ].forEach(root => { if (root) root.visible = false; });
        inferiorRecord.highlight.visible = false;
      }
      if (scope === 'body') {
        [selected.disc, selected.ligaments.layer, selected.cutSurfaces, selected.decompressionVoid, selected.osteotomyRemnants].forEach(root => { if (root) root.visible = false; });
        applyRecordGeometryPolicy(selected);
        if (!selected.referenceLayer.visible && !selected.topsPostoperativeReferenceLayer?.visible) {
          selected.body.visible = true;
          selected.endplates.visible = true;
          selected.posteriorElement.visible = true;
        }
        selected.hardwareLayer.visible = false;
      } else if (scope === 'implant') {
        selected.disc.visible = true;
        applyRecordGeometryPolicy(selected);
        if (!selected.referenceLayer.visible && !selected.topsPostoperativeReferenceLayer?.visible) {
          selected.body.visible = true;
          selected.endplates.visible = true;
          selected.posteriorElement.visible = true;
        }
        selected.ligaments.layer.visible = false;
        selected.hardwareLayer.visible = state.view === 'post';
      }
      if (pelvisAnatomyLayer) pelvisAnatomyLayer.visible = false;
      if (pelvisReferenceLayer) pelvisReferenceLayer.visible = false;
      if (siJointLayer) siJointLayer.visible = false;
      if (pelvisLigamentLayer) pelvisLigamentLayer.visible = false;
      if (pelvicHardwareLayer) pelvicHardwareLayer.visible = false;
      if (lowerExtremityContext) lowerExtremityContext.visible = false;
      // Isolation and the visible level label identify the selection. The old
      // nominal wireframe BoxGeometry obscured CT surfaces and could look like
      // corrupt anatomy, especially when the independent inspection target was
      // still set to C0-C1.
      selected.highlight.visible = false;
      applyInspectionTransparency(selected);
      if (inferiorRecord) applyInspectionTransparency(inferiorRecord);
      applyInspectionExplosion(selected, selection.explode);
      updateGeometryStatus();
      inspectionRoot.visible = true;
      inspectionRoot.userData = {
        levelId: selection.levelId,
        scope,
        explode: THREE.MathUtils.clamp(finiteOr(selection.explode), 0, 1),
        warning: 'Non-anatomic inspection layout—measurements, containment and collisions disabled.'
      };
    }

    function setInspectionSelection(levelId, scope = 'level', explode = 0) {
      if (!segmentRecords.has(levelId)) return false;
      state.inspection = {
        levelId,
        scope: ['body', 'implant', 'level'].includes(scope) ? scope : 'level',
        explode: THREE.MathUtils.clamp(finiteOr(explode), 0, 1),
        active: true
      };
      syncInspectionChrome();
      highlightedLevel = null;
      segmentRecords.forEach(record => { record.highlight.visible = false; });
      applyInspectionVisibility();
      worldRoot?.updateMatrixWorld(true);
      frameInspectionRecord(segmentRecords.get(levelId));
      updateShapeStatus();
      updateCanvasDescription();
      updateReferenceLines();
      return true;
    }

    /* Single place that reflects isolation state into the DOM, called from both
       transitions so the on-canvas exit can never disagree with the model. */
    function syncInspectionChrome() {
      const active = state.inspection?.active === true;
      if (active) document.body.dataset.inspectionActive = 'true';
      else delete document.body.dataset.inspectionActive;
      const label = $('inspectExitLevel');
      if (label && active) {
        const scope = state.inspection.scope;
        label.textContent = `Showing ${state.inspection.levelId} · ${scope === 'level' ? 'full level' : scope}`;
      }
    }

    function exitInspectionMode() {
      state.inspection = {
        levelId: state.inspection?.levelId || 'L4-L5',
        scope: state.inspection?.scope || 'level',
        explode: false,
        active: false
      };
      syncInspectionChrome();
      restoreInspectionMaterialsAndPositions();
      restoreInspectionRootVisibility();
      highlightedLevel = null;
      if (inspectionRoot) { inspectionRoot.visible = false; inspectionRoot.userData = {}; }
      inspectionApplying = true;
      updateSurgicalVisibility();
      inspectionApplying = false;
      applyPathologyTargets(true);
      if (inspectionCameraState && camera && controls) {
        camera.position.copy(inspectionCameraState.position);
        controls.target.copy(inspectionCameraState.target);
        controls.minDistance = inspectionCameraState.minDistance;
        controls.maxDistance = inspectionCameraState.maxDistance;
        controls.update();
        inspectionCameraState = null;
      }
      updateShapeStatus();
      updateCanvasDescription();
      updateReferenceLines();
      return true;
    }

    function selectLevelAtClientPoint(clientX, clientY, scope = 'level') {
      if (!renderer || !camera) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      inspectionPointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      inspectionRaycaster.setFromCamera(inspectionPointer, camera);
      const candidates = [];
      segmentRecords.forEach(record => {
        if (record.regionVisibilityLayer?.visible === false) return;
        [record.referenceLayer, record.topsPostoperativeReferenceLayer, record.body, record.posteriorElement].forEach(root => {
          if (!root?.visible) return;
          root.traverse(object => { if (object.isMesh && object.visible) candidates.push(object); });
        });
      });
      const hit = inspectionRaycaster.intersectObjects(candidates, false)[0];
      const levelId = hit?.object?.userData?.levelId || null;
      if (levelId) setInspectionSelection(levelId, scope, 0);
      return levelId;
    }

    function updateSurgicalVisibility() {
      const post = state.view === 'post';
      if (pelvicHardwareLayer) pelvicHardwareLayer.visible = post;
      for (const record of segmentRecords.values()) {
        record.hardwareLayer.visible = post;
        const resected = post && record.decompressed;
        const posteriorOsteotomy = post && ['osteotomy_post', 'osteotomy_wedge', 'osteotomy_wedge_extended'].includes(record.osteotomyType);
        const partialFacetOsteotomy = post && record.osteotomyType === 'osteotomy_post_g1';
        const bodyWedge = post && ['osteotomy_wedge', 'osteotomy_wedge_extended'].includes(record.osteotomyType);
        const disruptedLigaments = post ? record.disruptedLigaments : new Set();
        const interrupted = post && record.ligamentDisrupted;
        const topsResection = post && record.topsReconstruction;
        const topsAdjacentResection = post && record.topsAdjacentResection;
        const discExcised = post && record.discExcised;
        const interbodyResection = post && Boolean(record.interbodyApproach);
        /* Body resection visibility is NOT set here. The CT reference surface is
           one mesh per vertebra, so removing a body means falling back to the
           semantic primitives - a decision owned by the geometry-mode pass, which
           also runs after this one and would overwrite anything set here. */
        record.posteriorElement.visible = true;
        record.body.visible = !bodyWedge;
        record.disc.visible = !discExcised;
        if (record.interbodyResectionEnvelope) {
          record.interbodyResectionEnvelope.position.copy(record.disc.position).sub(record.anatomyRoot.position);
          record.interbodyResectionEnvelope.quaternion.copy(record.disc.quaternion);
          record.interbodyResectionEnvelope.visible = interbodyResection;
          record.interbodyResectionEnvelope.userData.approach = record.interbodyApproach;
        }
        record.osteotomyRemnants.visible = bodyWedge;
        record.decompressionTargets.forEach(target => { target.visible = !(resected || posteriorOsteotomy || topsResection); });
        record.anatomy.facets.left.visible = !(posteriorOsteotomy || topsResection || topsAdjacentResection);
        record.anatomy.facets.right.visible = !(posteriorOsteotomy || topsResection || topsAdjacentResection);
        record.anatomy.pars.left.visible = !(posteriorOsteotomy || topsResection || topsAdjacentResection);
        record.anatomy.pars.right.visible = !(posteriorOsteotomy || topsResection || topsAdjacentResection);
        record.cutSurfaces.visible = resected || record.laminoplasty || partialFacetOsteotomy || posteriorOsteotomy || topsResection || topsAdjacentResection;
        record.decompressionVoid.visible = resected || posteriorOsteotomy || topsResection || topsAdjacentResection;
        const flavumInterrupted = resected || posteriorOsteotomy || disruptedLigaments.has('ligamentum_flavum');
        setReferenceLigamentInterrupted(record.ligaments.all, disruptedLigaments.has('anterior_longitudinal_ligament'));
        setReferenceLigamentInterrupted(record.ligaments.pll, disruptedLigaments.has('posterior_longitudinal_ligament'));
        setReferenceLigamentInterrupted(record.ligaments.flavum.left, flavumInterrupted);
        setReferenceLigamentInterrupted(record.ligaments.flavum.right, flavumInterrupted);
        setReferenceLigamentInterrupted(record.ligaments.capsular.left, disruptedLigaments.has('facet_capsule'));
        setReferenceLigamentInterrupted(record.ligaments.capsular.right, disruptedLigaments.has('facet_capsule'));
        setReferenceLigamentInterrupted(record.ligaments.interspinous, disruptedLigaments.has('interspinous'));
        setReferenceLigamentInterrupted(record.ligaments.supraspinous, disruptedLigaments.has('supraspinous'));
        record.ligaments.disruptionMarkers.visible = flavumInterrupted
          || disruptedLigaments.has('interspinous')
          || disruptedLigaments.has('supraspinous');
        const geometryMode = applyRecordGeometryPolicy(record);
        if (geometryMode === 'ct_derived_post_decompression') {
          record.cutSurfaces.visible = false;
          record.decompressionVoid.visible = false;
        }
      }
      applyLayerVisibility();
      updateGeometryStatus();
      if (state.inspection?.active && state.inspection.levelId && !inspectionApplying) applyInspectionVisibility();
    }

    function applyLayerVisibility() {
      const post = state.view === 'post';
      const layers = state.layers || {};
      const piAtReference = Math.abs(
        finiteOr(pelvisGroup?.userData?.pelvicIncidenceMorphologyDeltaDeg)
      ) < .005;
      // Away from the atlas PI the CT hip bones and pelvic overlays are
      // reshaped by the PI display field. Only when that field cannot be built
      // (no CT pelvis) does the pelvic context still fail closed.
      const pelvicContextCoherent = piAtReference || Boolean(ensurePelvicIncidenceField());
      segmentRecords.forEach(record => {
        const regionVisible = recordRegionVisible(record);
        if (record.regionVisibilityLayer) record.regionVisibilityLayer.visible = regionVisible;
        const discExcised = post && record.discExcised;
        record.disc.visible = regionVisible && layers.discs !== false && !discExcised;
        // Same all-or-nothing policy as updateReferenceLigamentContinuity: once
        // any rigid pathway has detached, no level's overlay is shown. Checking
        // only this level let undeformed levels flash visible for a frame.
        record.ligaments.layer.visible = regionVisible
          && layers.ligaments === true
          && record.ligaments.layer.userData.liveContinuityValid !== false
          && record.ligaments.layer.userData.globalContinuityValid !== false;
        record.hardwareLayer.visible = regionVisible && layers.implants !== false && post;
        if (record.interbodyResectionEnvelope) {
          record.interbodyResectionEnvelope.visible = regionVisible && layers.implants !== false && post && Boolean(record.interbodyApproach);
        }
      });
      const pelvisVisible = layers.pelvis !== false && !state.inspection?.active;
      if (pelvisReferenceLayer) pelvisReferenceLayer.visible = pelvisVisible && pelvisReferenceLayer.children.length > 0;
      pelvisReferenceLayer?.children.forEach(surface => {
        const innominate = /^ctReferenceSurface:hip_(left|right)$/.test(surface.name);
        surface.visible = !innominate || pelvicContextCoherent;
      });
      // The procedural fallback pelvis has no PI field, so it keeps the old
      // fail-closed rule.
      if (pelvisAnatomyLayer) pelvisAnatomyLayer.visible = pelvisVisible
        && !pelvisReferenceLayer?.children.length
        && piAtReference;
      if (pelvisLigamentLayer) pelvisLigamentLayer.visible = pelvisVisible
        && layers.ligaments === true
        && pelvicContextCoherent;
      if (siJointLayer) siJointLayer.visible = pelvisVisible
        && layers.siJoints === true
        && pelvicContextCoherent;
      if (pelvicHardwareLayer) pelvicHardwareLayer.visible = pelvisVisible
        && layers.implants !== false
        && post
        && pelvicContextCoherent;
      if (pelvicIncidenceGuide) pelvicIncidenceGuide.visible = pelvisVisible && layers.measurements === true;
      if (pelvicIncidenceRadiusLine) pelvicIncidenceRadiusLine.visible = pelvisVisible && layers.measurements === true;
      /* PI is posed by pivoting only the sacrum and spine about the L5-S1
         proxy; the femoral-head axis, which is where PI and PT are measured
         to, does not move, and the lower limbs are world-rooted on that same
         hip-axis proxy. PI = angle between the sacral-endplate normal and the
         line from the endplate midpoint to the femoral-head axis (Legaye J et
         al., Eur Spine J 1998;7:99-103), so the limbs stay geometrically
         coherent with the entered PI and PT. The sacroiliac articulation is
         kept coherent by the PI display field (applyPelvicIncidenceField): the
         hip bones are reshaped so the SI band moves with the sacrum while the
         acetabulum stays on the femoral head. Earlier builds withheld the
         innominates, SI overlays, pelvic ligaments and pelvic hardware here. */
      if (lowerExtremityContext) {
        lowerExtremityContext.visible = !state.inspection?.active
          && layers.lowerLimbs !== false
          && state.globalDeformity?.lowerExtremitiesVisible === true;
      }
      pelvisGroup.userData.pelvicReferenceContextWithheld = !pelvicContextCoherent;
      pelvisGroup.userData.pelvicIncidenceSchematicReshaping = !piAtReference && pelvicContextCoherent;
      pelvisGroup.userData.lowerLimbsPosedFromHipAxisAtNonReferencePi = !piAtReference;
      pelvisGroup.userData.pelvicIncidenceReshapingNote = pelvisGroup.userData.pelvicIncidenceSchematicReshaping
        ? 'The pelvis shape is adjusted schematically to the entered PI: the sacroiliac band of each hip bone moves with the sacrum and the acetabulum stays on the unchanged femoral-head axis. An educational approximation, not patient anatomy.'
        : null;
      pelvisGroup.userData.pelvicReferenceContextWithheldReason = pelvicContextCoherent
        ? null
        : 'Non-reference PI is an authored sacral-base display surrogate and the CT pelvis needed to reshape the hip bones is unavailable, so the schematic pelvis, SI overlays, pelvic ligaments and pelvic hardware are withheld. The lower limbs stay posed on the unchanged femoral-head axis that PI and PT are measured to.';
      updateReferenceLines();
    }

    function factorFraction(value, maximum = 1) {
      const percent = Math.abs(finiteOr(value));
      return THREE.MathUtils.clamp(percent / 100, 0, maximum);
    }

    function morphologyAppearance(variant) {
      const key = String(variant || 'reference').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (key.includes('hemivertebra')) return { bodyWidth: .84, bodyDepth: .72, bodyHeight: .72, pedicle: .72, facet: .82, offsetZ: key.includes('left') ? .10 : -.10 };
      if (key.includes('butterfly')) return { bodyWidth: .92, bodyDepth: .78, bodyHeight: .82, pedicle: .86, facet: .90, offsetZ: 0 };
      if (key.includes('dysplastic')) return { bodyWidth: .88, bodyDepth: .84, bodyHeight: .90, pedicle: .66, facet: .78, offsetZ: .04 };
      if (key.includes('hypoplastic') || key.includes('smallpedicle')) return { bodyWidth: .94, bodyDepth: .92, bodyHeight: .96, pedicle: .62, facet: .86, offsetZ: 0 };
      if (key.includes('transitional') || key.includes('sacralized') || key.includes('lumbarized')) return { bodyWidth: 1.13, bodyDepth: 1.10, bodyHeight: .92, pedicle: 1.12, facet: 1.12, offsetZ: 0 };
      if (key.includes('block')) return { bodyWidth: 1.04, bodyDepth: 1.04, bodyHeight: 1.16, pedicle: 1.06, facet: 1.04, offsetZ: 0 };
      return { bodyWidth: 1, bodyDepth: 1, bodyHeight: 1, pedicle: 1, facet: 1, offsetZ: 0 };
    }

    // The displayed disc is a joint object: its source-fit loft starts between
    // the two endplates, so subsequent kinematic edits must not attach it wholly
    // to only the superior bone. Interpolate the superior segment's relative
    // rotation/translation halfway toward its inferior parent and include half
    // of any authored disc-space collapse. This preserves the neutral source fit
    // while keeping the envelope centered during sagittal/coronal/axial edits.
    function updateDiscJointTransform(record) {
      const disc = record?.disc;
      if (!disc?.isMesh || disc.userData?.containmentAssessed !== true) return false;
      const baseDiscPosition = disc.userData.baseLocalPosition;
      const baseDiscQuaternion = disc.userData.baseLocalQuaternion;
      const baseGroupPosition = record.group?.userData?.basePosition;
      if (!Array.isArray(baseDiscPosition) || !Array.isArray(baseDiscQuaternion) || !baseGroupPosition) return false;

      const currentRotation = record.group.quaternion.clone().normalize();
      const halfRotation = new THREE.Quaternion().identity().slerp(currentRotation, .5).normalize();
      const inverseCurrentRotation = currentRotation.clone().invert();
      const translationDelta = record.group.position.clone().sub(baseGroupPosition);
      const desiredParentPosition = baseGroupPosition.clone()
        .addScaledVector(translationDelta, .5)
        .add(new THREE.Vector3().fromArray(baseDiscPosition).applyQuaternion(halfRotation));
      const collapseHeightScene = Math.max(0, finiteOr(disc.userData.collapseHeightScene));
      desiredParentPosition.add(
        new THREE.Vector3(0, -collapseHeightScene * .5, 0).applyQuaternion(currentRotation)
      );

      disc.position.copy(desiredParentPosition.sub(record.group.position).applyQuaternion(inverseCurrentRotation));
      disc.quaternion.copy(inverseCurrentRotation)
        .multiply(halfRotation)
        .multiply(new THREE.Quaternion().fromArray(baseDiscQuaternion))
        .normalize();
      disc.userData.jointTransformMode = 'half relative motion between adjacent endplates';
      disc.userData.jointTransformAssessed = true;

      if (record.interbodyResectionEnvelope) {
        record.interbodyResectionEnvelope.position.copy(disc.position).sub(record.anatomyRoot.position);
        record.interbodyResectionEnvelope.quaternion.copy(disc.quaternion);
      }
      return true;
    }

    /* ---------------------------------------------------------------------
       Coronal balance of the displayed chain.

       Root cause of the lean reported for the degenerative-scoliosis example
       (C7 ~228 mm lateral to S1): every authored curve is drawn as ONE
       same-signed curvature lobe (normalizedRegionalCurveWeights), so the
       vertebra above the lobe inherits the whole Cobb as tilt, and nothing
       above it returned the chain to vertical unless an opposite secondary
       Cobb of exactly the same size happened to be authored. Pelvic obliquity
       and level wedges tilted everything above them the same way, and the
       apical-translation input was spread as an equal lateral step at every
       level, which is a whole-trunk shift carried into the head, not a
       translation of the apex.

       A standing patient with a structural curve compensates: a fractional /
       take-off curve below the main curve and a compensatory curve above it
       bring the head back over the sacrum (Silva FE, Lenke LG. Adult
       degenerative scoliosis: evaluation and management. Neurosurg Focus
       2010;28(3):E1). Coronal decompensation (C7 plumb line off the CSVL) is a
       separate, measured finding (Glassman SD et al., Spine 2005;30(6):682-8),
       and this app has no C7-CSVL input to author it. The display therefore
       adds an UNMEASURED balancing bend in the free levels just below and just
       above the authored coronal geometry, solved so the head (C0-C1 pivot)
       sits over the chain root and the top of the chain is as level as in the
       source atlas pose. The authored lobes, wedges and planned changes are
       untouched, so the drawn curve still sums to the displayed Cobb. The
       balancing bend is tagged per level (userData.coronalBalanceDeg) and never
       enters a reported number. It is a display convention, not a prediction.

       Apical translation is posed as an apex-peaked lateral shift (caudal half
       of the primary lobe toward the input side, cranial half back), so it
       moves the apex and not the head. An entered value places the drawn apex
       at that distance from the chain root; 0 means "not entered" and leaves
       the apex where the balanced curve geometry puts it.
    --------------------------------------------------------------------- */
    const CORONAL_BALANCE_DISPLAY = Object.freeze({
      // Levels either side of the authored geometry that may carry the bend.
      windowLevels: 8,
      // The craniovertebral joints never carry trunk compensation.
      excludedLevels: Object.freeze(['C0-C1', 'C1-C2']),
      // Used only when nothing is authored except pelvic obliquity or a shift.
      defaultBoundaryLevel: 'T12-L1',
      newtonIterations: 6,
      finiteDifferenceRad: THREE.MathUtils.degToRad(.5),
      toleranceMm: .05,
      toleranceRad: 1e-6
    });

    function halfSineWindowWeights(count) {
      const weights = Array.from({ length: count }, (_, index) => Math.sin(Math.PI * (index + 1) / (count + 1)));
      const sum = weights.reduce((total, value) => total + value, 0);
      return sum > 0 ? weights.map(value => value / sum) : weights;
    }

    // Forward kinematics of the TARGET pose (not the damped current pose), in
    // world orientation. Lateral is scene Z. With includeCoronal false every
    // coronal/axial input is dropped, giving the source-atlas reference pose.
    function coronalTargetKinematics(records, extraRotation, extraLateral, obliquityRad, includeCoronal = true) {
      const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(includeCoronal ? obliquityRad : 0, 0, targetPelvisRotation));
      orientation.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, targetSacralMorphologyRotation)));
      const point = new THREE.Vector3();
      const step = new THREE.Vector3();
      const euler = new THREE.Euler();
      const local = new THREE.Quaternion();
      const lateral = new Array(records.length);
      records.forEach((record, index) => {
        const data = record.group.userData;
        const base = data.basePosition || record.group.position;
        step.set(
          finiteOr(data.targetPositionX, base.x),
          base.y,
          includeCoronal ? finiteOr(data.targetPositionZ, base.z) + finiteOr(extraLateral?.[index]) : base.z
        ).applyQuaternion(orientation);
        point.add(step);
        lateral[index] = point.z;
        euler.set(
          includeCoronal ? finiteOr(data.targetRotationX) + finiteOr(extraRotation?.[index]) : 0,
          includeCoronal ? finiteOr(data.targetRotationY) : 0,
          finiteOr(data.targetRotationZ)
        );
        orientation.multiply(local.setFromEuler(euler));
        step.set(record.anatomyRoot.position.x, finiteOr(record.anatomyRoot.userData.targetPositionY), record.anatomyRoot.position.z)
          .applyQuaternion(orientation);
        point.add(step);
      });
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
      return { lateral, topLateral: lateral[lateral.length - 1], topTilt: Math.atan2(up.z, up.y) };
    }

    function balanceCoronalChain(records, { obliquityRad, primaryWeights, apexLevelId, apexTarget }) {
      const n = records.length;
      const mmToScene = PATHOLOGY_VISUALIZATION.trunkShiftScale;
      const ids = records.map(record => record.level.id);
      const zeros = new Array(n).fill(0);
      const summary = {
        mode: 'none', caudalLevels: [], cranialLevels: [], caudalDeg: 0, cranialDeg: 0,
        headOffsetMm: 0, c7PivotOffsetMm: 0, apexLevelId: apexLevelId || null, apexOffsetMm: null,
        apexTargetMm: apexTarget?.mm ?? null, apexShiftMm: 0, residualTiltDeg: 0,
        convention: 'display-only balancing bend outside the authored coronal geometry; not a measured curve and not a reported value'
      };
      const occupied = records.map(record => Math.abs(finiteOr(record.group.userData.targetRotationX)) > CORONAL_BALANCE_DISPLAY.toleranceRad);
      const translated = records.some(record => Math.abs(finiteOr(record.group.userData.targetPositionZ) - finiteOr(record.group.userData.basePosition?.z)) > 1e-9);
      const bumpRequested = Boolean(apexTarget && Math.abs(apexTarget.mm) > 1e-9);
      if (!occupied.some(Boolean) && Math.abs(obliquityRad) < 1e-9 && !translated && !bumpRequested) {
        return { rotation: zeros, lateral: zeros, summary };
      }
      const allowed = index => !CORONAL_BALANCE_DISPLAY.excludedLevels.includes(ids[index]);
      let first = occupied.indexOf(true);
      let last = occupied.lastIndexOf(true);
      if (first < 0) {
        const boundary = Math.max(1, ids.indexOf(CORONAL_BALANCE_DISPLAY.defaultBoundaryLevel));
        first = boundary; last = boundary - 1;
      }
      const caudal = [];
      for (let index = first - 1; index >= 0 && caudal.length < CORONAL_BALANCE_DISPLAY.windowLevels; index -= 1) {
        if (allowed(index)) caudal.unshift(index);
      }
      const cranial = [];
      for (let index = last + 1; index < n && cranial.length < CORONAL_BALANCE_DISPLAY.windowLevels; index += 1) {
        if (allowed(index)) cranial.push(index);
      }
      // A curve that already reaches C2-C3 leaves only the craniovertebral
      // joints above it; head righting there is the physiological last resort.
      if (!cranial.length) {
        for (let index = last + 1; index < n; index += 1) cranial.push(index);
      }
      const caudalWeights = halfSineWindowWeights(caudal.length);
      const cranialWeights = halfSineWindowWeights(cranial.length);

      // Apex-peaked lateral shift: +1 mm spread over the caudal half of the
      // primary lobe (apex included), -1 mm over the cranial half.
      const apexIndex = apexLevelId ? ids.indexOf(apexLevelId) : -1;
      const bumpShape = new Array(n).fill(0);
      if (apexIndex >= 0 && primaryWeights) {
        const lower = primaryWeights.reduce((sum, weight, index) => sum + (index <= apexIndex && weight > 0 ? weight : 0), 0);
        const upper = primaryWeights.reduce((sum, weight, index) => sum + (index > apexIndex && weight > 0 ? weight : 0), 0);
        primaryWeights.forEach((weight, index) => {
          if (!(weight > 0)) return;
          if (index <= apexIndex && lower > 0) bumpShape[index] = weight / lower;
          else if (index > apexIndex && upper > 0) bumpShape[index] = -weight / upper;
        });
      }

      const reference = coronalTargetKinematics(records, zeros, zeros, 0, false);
      const rotationFor = (a, b) => {
        const rotation = new Array(n).fill(0);
        caudal.forEach((index, k) => { rotation[index] = a * caudalWeights[k]; });
        cranial.forEach((index, k) => { rotation[index] = b * cranialWeights[k]; });
        return rotation;
      };
      // Scene +Z is patient-left, so a rightward shift is negative Z.
      const lateralFor = shiftMm => bumpShape.map(share => -share * shiftMm * mmToScene);
      const evaluate = (a, b, shiftMm) => {
        const pose = coronalTargetKinematics(records, rotationFor(a, b), lateralFor(shiftMm), obliquityRad, true);
        return { pose, tilt: pose.topTilt - reference.topTilt, offset: (pose.topLateral - reference.topLateral) / mmToScene };
      };
      const solve = shiftMm => {
        let a = 0, b = 0;
        const h = CORONAL_BALANCE_DISPLAY.finiteDifferenceRad;
        const useA = caudal.length > 0, useB = cranial.length > 0;
        for (let iteration = 0; iteration < CORONAL_BALANCE_DISPLAY.newtonIterations; iteration += 1) {
          const f = evaluate(a, b, shiftMm);
          if (Math.abs(f.tilt) < CORONAL_BALANCE_DISPLAY.toleranceRad && (!(useA && useB) || Math.abs(f.offset) < CORONAL_BALANCE_DISPLAY.toleranceMm)) break;
          if (useA && useB) {
            const fa = evaluate(a + h, b, shiftMm), fb = evaluate(a, b + h, shiftMm);
            const j11 = (fa.tilt - f.tilt) / h, j12 = (fb.tilt - f.tilt) / h;
            const j21 = (fa.offset - f.offset) / h, j22 = (fb.offset - f.offset) / h;
            const det = j11 * j22 - j12 * j21;
            if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
            a -= (j22 * f.tilt - j12 * f.offset) / det;
            b -= (-j21 * f.tilt + j11 * f.offset) / det;
          } else if (useA || useB) {
            // One free window can level the top but not re-centre it; the
            // residual offset is reported, not hidden.
            const f2 = useA ? evaluate(a + h, b, shiftMm) : evaluate(a, b + h, shiftMm);
            const slope = (f2.tilt - f.tilt) / h;
            if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) break;
            if (useA) a -= f.tilt / slope; else b -= f.tilt / slope;
          } else break;
          // Keep the balancing bend physiological in size; never flip the chain.
          const cap = Math.PI / 3;
          a = THREE.MathUtils.clamp(a, -cap, cap);
          b = THREE.MathUtils.clamp(b, -cap, cap);
        }
        return { a, b, result: evaluate(a, b, shiftMm) };
      };
      const apexOffsetOf = pose => apexIndex >= 0
        ? -(pose.lateral[apexIndex] - reference.lateral[apexIndex]) / mmToScene
        : null;

      let shiftMm = 0;
      let solution = solve(0);
      if (bumpRequested && apexIndex >= 0 && bumpShape.some(Boolean)) {
        const geometricApex = apexOffsetOf(solution.result.pose);
        const target = apexTarget.additive ? geometricApex + apexTarget.mm : apexTarget.mm;
        for (let pass = 0; pass < 3; pass += 1) {
          const current = apexOffsetOf(solution.result.pose);
          if (Math.abs(target - current) < CORONAL_BALANCE_DISPLAY.toleranceMm) break;
          shiftMm += target - current;
          solution = solve(shiftMm);
        }
        summary.apexTargetMm = target;
      }
      const c7Index = ids.indexOf('C7-T1');
      const pose = solution.result.pose;
      Object.assign(summary, {
        mode: caudal.length && cranial.length ? 'two-window' : (caudal.length || cranial.length) ? 'single-window-level-only' : 'unavailable',
        caudalLevels: caudal.map(index => ids[index]),
        cranialLevels: cranial.map(index => ids[index]),
        caudalDeg: THREE.MathUtils.radToDeg(solution.a),
        cranialDeg: THREE.MathUtils.radToDeg(solution.b),
        // Right-positive, relative to the source-atlas reference pose.
        headOffsetMm: -solution.result.offset,
        c7PivotOffsetMm: c7Index >= 0 ? -(pose.lateral[c7Index] - reference.lateral[c7Index]) / mmToScene : null,
        apexOffsetMm: apexOffsetOf(pose),
        apexShiftMm: shiftMm,
        residualTiltDeg: THREE.MathUtils.radToDeg(solution.result.tilt)
      });
      return { rotation: rotationFor(solution.a, solution.b), lateral: lateralFor(shiftMm), summary };
    }

    function applyPathologyTargets(force = false) {
      if (!sceneReady) return;
      const deformity = deformityState();
      const records = [...segmentRecords.values()];
      const curveProfileId = state.globalDeformity?.coronalProfileId
        || state.caseContext?.exampleId
        || state.globalDeformity?.preset;
      let profile = CORONAL_DISPLAY_PROFILES[curveProfileId] || null;
      // An authored coronal magnitude with no matching display profile used to
      // render nothing at all, so dragging the Cobb surrogate on a case without
      // a declared curve pattern was a silent no-op. Fall back to a declared
      // default so the input always has a visible, labelled effect.
      if (!profile && Math.abs(finiteOr(state.globalDeformity?.coronalMagnitude)) > .01) {
        profile = CORONAL_DISPLAY_PROFILES[MODEL_MANIFEST.defaultCoronalProfileId] || null;
      }
      const primaryWeights = normalizedRegionalCurveWeights(records, profile?.primary);
      const secondaryWeights = normalizedRegionalCurveWeights(records, profile?.secondary);
      const regionalCurveAvailable = Boolean(profile);
      /* Modeled post-op coronal pose (F082). The engine folds a planned coronal
         change inside a curve into that curve's modeled Cobb, so the display
         draws the modeled primary and secondary Cobb across the curve and poses
         only the out-of-curve share locally. It used to draw the baseline
         primary bend plus the local offset and the modeled secondary plus the
         local offset again, so the drawn curve did not match the reported one. */
      const modeledScenario = state.view === 'post' ? state.threePlanePrediction : null;
      const modeledCurveRegions = modeledScenario && regionalCurveAvailable ? resolveCoronalCurveRegions(state.globalDeformity) : null;
      const drawModeledCobb = Boolean(modeledScenario && modeledCurveRegions);
      const modeledPrimarySigned = drawModeledCobb ? THREE.MathUtils.clamp(finiteOr(modeledScenario.outputs.primaryCobb), -120, 120) : 0;

      records.forEach((record, index) => {
        const factor = levelFactorFor(record.level.id);
        const collapse = ['C0-C1', 'C1-C2'].includes(record.level.id)
          ? 0
          : Math.min(factorFraction(factor.discCollapse), PATHOLOGY_VISUALIZATION.maxDiscCollapse);
        const facetSeverity = factorFraction(factor.facetHypertrophy);
        const osteophyteSeverity = factorFraction(factor.osteophytes);
        const appearance = morphologyAppearance(factor.morphologyVariant);
        const bodyWidthScale = THREE.MathUtils.clamp(finiteOr(factor.bodyWidthScale, 1), .55, 1.65);
        const bodyDepthScale = THREE.MathUtils.clamp(finiteOr(factor.bodyDepthScale, 1), .55, 1.65);
        const pedicleScale = THREE.MathUtils.clamp(finiteOr(factor.pedicleScale, 1), .45, 1.75);
        const canalScale = THREE.MathUtils.clamp(finiteOr(factor.canalScale, 1), .45, 1.75);

        record.disc.scale.y = Math.max(.05, 1 - collapse);
        record.disc.traverse(object => {
          if (object.isMesh) object.material = collapse > .12 ? materials.degenerativeDisc : materials.disc;
        });
        const discBaselineHeightScene = finiteOr(
          record.disc.userData?.renderedCenterHeightMm * REFERENCE_MM_TO_SCENE,
          finiteOr(
            record.disc.userData?.morphometryMm?.middle * REFERENCE_MM_TO_SCENE,
            record.dims.height * .16
          )
        );
        record.disc.userData.collapseFraction = collapse;
        record.disc.userData.collapseHeightScene = collapse * discBaselineHeightScene;
        record.anatomyRoot.userData.targetPositionY = -collapse * discBaselineHeightScene;

        record.body.scale.set(
          appearance.bodyWidth * bodyWidthScale,
          appearance.bodyHeight,
          appearance.bodyDepth * bodyDepthScale
        );
        record.body.position.z = appearance.offsetZ * record.dims.depth;
        ['left', 'right'].forEach(key => {
          record.anatomy.pedicles[key].scale.setScalar(appearance.pedicle * pedicleScale);
          const facetBase = record.anatomy.facets[key].userData.pathologyBaseScale
            || record.anatomy.facets[key].scale.clone();
          if (!record.anatomy.facets[key].userData.pathologyBaseScale) record.anatomy.facets[key].userData.pathologyBaseScale = facetBase.clone();
          record.anatomy.facets[key].scale.copy(facetBase).multiplyScalar(appearance.facet * (1 + facetSeverity * PATHOLOGY_VISUALIZATION.maxFacetScale));
        });
        // Canal calibre is not recoverable from the external whole-bone mesh.
        // Never resize the surgical resection envelope to impersonate stenosis.
        record.decompressionVoid.scale.z = 1;
        const topsDerivedSurfaceActive = record.geometryMode === 'ct_derived_post_decompression'
          && record.topsPostoperativeReferenceLayer?.visible === true;
        const surgicalCanalOverlay = state.view === 'post' && !topsDerivedSurfaceActive && (
          record.decompressed || record.topsReconstruction || record.topsAdjacentResection || ['osteotomy_post', 'osteotomy_wedge'].includes(record.osteotomyType)
        );
        const authoredCanalOverlay = !['C0-C1', 'C1-C2'].includes(record.level.id) && Math.abs(canalScale - 1) > .005;
        record.decompressionVoid.visible = surgicalCanalOverlay;
        const surgicalOverlayMode = record.osteotomyType === 'osteotomy_wedge'
          ? 'planned PSO three-column wedge and posterior resection envelopes; intact CT mesh is not subtracted and cut safety is not inferred'
          : record.osteotomyType === 'osteotomy_post'
            ? 'planned SPO posterior closing-wedge resection envelope; intact CT mesh is not subtracted and cut safety is not inferred'
            : record.topsReconstruction
              ? 'planned TOPS superior posterior-element/facet resection envelope; external device topology is shown and cut safety is not inferred'
              : record.topsAdjacentResection
                ? 'planned TOPS inferior facet/pars resection envelope at the adjacent bone; cut safety is not inferred'
              : 'planned posterior resection envelope; intact CT mesh is not subtracted';
        record.decompressionVoid.userData.mode = surgicalOverlayMode;
        record.decompressionVoid.userData.authoredCanalScale = canalScale;
        record.decompressionVoid.userData.authoredCanalShapeWithheld = authoredCanalOverlay;
        record.decompressionVoid.userData.authoredCanalShapeWithheldReason = authoredCanalOverlay
          ? 'Canal-calibre geometry requires a segmented canal or neural-element surface; the surgical resection envelope is not reused.'
          : null;
        record.osteophytes.visible = false;
        record.osteophytes.userData.authoredBurdenFraction = osteophyteSeverity;
        record.osteophytes.userData.shapeEditWithheld = osteophyteSeverity > .015;

        /* Coronal curvature sign. Scene +Z is patient-left and a positive X
           rotation turns the chain above toward +Z. A curve whose apex
           (convexity) is on the patient's RIGHT leaves the sacrum heading right
           and turns LEFT as it ascends, so right-positive curvature maps to +X.
           Earlier builds negated this: the chain turned toward the labelled
           apex side, which makes that side the CONCAVITY (an "apex right" curve
           was drawn convex-left), and without the balance below it read as a
           lean toward the apex. Level coronal wedges (positive = right-sided,
           convex-right wedge, as the right-hemivertebra and right-thoracic
           examples author them) and planned coronal changes (added to the
           right-positive Cobb by the engine) use the same sign. */
        const coronalShare = regionalCurveAvailable
          ? ((drawModeledCobb ? modeledPrimarySigned : deformity.primaryCobbSigned) * primaryWeights[index])
            + (deformity.secondaryCobbSigned * secondaryWeights[index])
          : 0;
        const axialShare = regionalCurveAvailable
          ? deformity.axialRotation * primaryWeights[index]
          : 0;
        const localPlane = state.view === 'post' ? state.threePlanePrediction?.byLevel?.[record.level.id] : null;
        const membership = drawModeledCobb ? coronalCurveMembershipFor(modeledCurveRegions, record.level.id) : null;
        const localCoronal = drawModeledCobb
          ? finiteOr(localPlane?.coronal) * membership.outside
          : finiteOr(localPlane?.coronal);
        // In-curve planned translation is folded into the modeled apical
        // translation (engine translationChange), which the apex shift below
        // draws; only the out-of-curve share is posed at its own level.
        const localTranslation = drawModeledCobb
          ? finiteOr(localPlane?.translation) * (1 - membership.primary)
          : finiteOr(localPlane?.translation);
        record.group.userData.targetRotationX = THREE.MathUtils.degToRad(coronalShare + finiteOr(factor.coronalWedge) + localCoronal);
        // Level and planned axial values bypass deformityState, so they carry the
        // same negation: positive turns the body toward the patient's right.
        record.group.userData.targetRotationY = THREE.MathUtils.degToRad(axialShare - finiteOr(factor.axialRotation) - finiteOr(localPlane?.axial));
        record.group.userData.targetRotationZ = (record.group.userData.alignmentRotationZ || 0) + THREE.MathUtils.degToRad(finiteOr(factor.sagittalWedge));
        const basePosition = record.group.userData.basePosition || new THREE.Vector3();
        record.group.userData.targetPositionX = basePosition.x - finiteOr(factor.apTranslation) * PATHOLOGY_VISUALIZATION.translationScale;
        record.group.userData.targetPositionZ = basePosition.z - finiteOr(factor.lateralTranslation) * PATHOLOGY_VISUALIZATION.translationScale
          - localTranslation * PATHOLOGY_VISUALIZATION.translationScale;
      });

      // Apical translation: the modeled value in the post-op view (baseline plus
      // in-curve planned change), the entered value otherwise. The primary lobe
      // carries it; with no declared curve the default profile's lobe does.
      const baselineApicalTranslation = finiteOr(deformity.trunkShift);
      const displayedApicalTranslation = drawModeledCobb
        ? finiteOr(modeledScenario.outputs.apicalTranslation)
        : baselineApicalTranslation;
      const translationProfile = profile || CORONAL_DISPLAY_PROFILES[MODEL_MANIFEST.defaultCoronalProfileId] || null;
      const translationWeights = profile ? primaryWeights : normalizedRegionalCurveWeights(records, translationProfile?.primary);
      const apexTarget = Math.abs(baselineApicalTranslation) > 1e-9
        ? { mm: displayedApicalTranslation, additive: false }
        : Math.abs(displayedApicalTranslation) > 1e-9
          ? { mm: displayedApicalTranslation, additive: true }
          : null;
      const balance = balanceCoronalChain(records, {
        obliquityRad: THREE.MathUtils.degToRad(deformity.pelvicObliquity),
        primaryWeights: translationWeights,
        apexLevelId: translationProfile?.primary?.apex || null,
        apexTarget
      });
      records.forEach((record, index) => {
        record.group.userData.targetRotationX += balance.rotation[index];
        record.group.userData.targetPositionZ += balance.lateral[index];
        record.group.userData.coronalBalanceDeg = THREE.MathUtils.radToDeg(balance.rotation[index]);
        record.group.userData.apicalShiftMm = -balance.lateral[index] / PATHOLOGY_VISUALIZATION.trunkShiftScale;
      });
      if (worldRoot) worldRoot.userData.coronalBalance = Object.freeze({ ...balance.summary });

      targetPelvisRotationX = THREE.MathUtils.degToRad(deformity.pelvicObliquity);
      targetPelvisRotationY = 0;
      // Case edits change the walk, so the derived amplitudes are recomputed.
      if (gait.active) gait.params = null;
      targetPelvisPosition.copy(pelvisPosturePivot).add(
        new THREE.Vector3(-deformity.pelvicShift * PATHOLOGY_VISUALIZATION.translationScale, 0, 0)
      );
      if (lowerExtremityContext) {
        // Not gated on PI: see applyLayerVisibility for why the limbs stay
        // coherent at a non-reference PI (the hip bones are reshaped to meet
        // them by applyPelvicIncidenceField).
        const showLowerLimbs = deformity.lowerExtremitiesVisible
          && state.layers?.lowerLimbs !== false
          && !state.inspection?.active;
        lowerExtremityContext.visible = showLowerLimbs;
        lowerExtremityContext.userData.targetPositionX = targetPelvisPosition.x - pelvisPosturePivot.x;
        lowerExtremityContext.userData.targetRotationX = targetPelvisRotationX;
        lowerExtremityContext.children.forEach(hip => {
          // Measured against the rig, not assumed: a POSITIVE hip rotation about
          // Z swings the knee posteriorly (extension) and a POSITIVE knee
          // rotation carries the ankle posteriorly (flexion, heel to buttock).
          // Both authored sliders declare positive = flexion, so hip is negated
          // and knee is not. These were previously inverted in both joints.
          hip.userData.targetRotationZ = THREE.MathUtils.degToRad(-deformity.hipFlexion);
          const knee = hip.children.find(child => child.name.startsWith('kneePivot:'));
          if (knee) {
            knee.userData.targetRotationZ = THREE.MathUtils.degToRad(deformity.kneeFlexion);
            const ankle = knee.children.find(child => child.name.startsWith('anklePivot:'));
            if (ankle) ankle.userData.targetRotationZ = THREE.MathUtils.degToRad(deformity.ankleFlexion);
          }
        });
      }

      if (force || reducedMotion.matches) {
        records.forEach(record => {
          record.group.rotation.x = record.group.userData.targetRotationX;
          record.group.rotation.y = record.group.userData.targetRotationY;
          record.group.rotation.z = record.group.userData.targetRotationZ;
          record.group.position.x = record.group.userData.targetPositionX;
          record.group.position.z = record.group.userData.targetPositionZ;
          record.anatomyRoot.position.y = record.anatomyRoot.userData.targetPositionY;
          updateDiscJointTransform(record);
        });
        pelvisGroup.rotation.x = targetPelvisRotationX;
        pelvisGroup.rotation.y = targetPelvisRotationY;
        pelvisGroup.position.copy(targetPelvisPosition);
        lowerExtremityContext?.traverse(object => {
          if (object.userData?.targetRotationZ !== undefined) object.rotation.z = object.userData.targetRotationZ;
        });
        if (lowerExtremityContext) {
          lowerExtremityContext.position.x = finiteOr(lowerExtremityContext.userData.targetPositionX);
          lowerExtremityContext.rotation.x = finiteOr(lowerExtremityContext.userData.targetRotationX);
        }
      }
    }

    function applyModelTargets(force = false) {
      if (!sceneReady) return;
      const localized = collectLocalCorrections();
      const post = state.view === 'post';
      // Baseline curves are distributed with a transparent region-specific
      // visualization profile. Procedure corrections occur at their chosen
      // motion segment; they are not smeared uniformly across the whole spine.
      const calibration = MODEL_MANIFEST.anatomy.referencePoseCalibration;
      const lumbarBaseTotal = state.params.ll - calibration.ll;
      const cervicalBaseTotal = state.params.cl - calibration.cl;
      // The engine's own thoracic local sum (per spanned disc), so a junction
      // body split across T12 or T4 is posed once, not re-derived here.
      const thoracicBaseTotal = (post ? state.prediction.newTK + state.prediction.thoracicLocalGain : state.params.tk) - calibration.tk;

      for (const [levelId, record] of segmentRecords) {
        const region = record.level.region;
        const weight = CURVE_DISTRIBUTION[region]?.[levelId] || 0;
        const localCorrection = post ? (localized.byLevel.get(levelId) || 0) : 0;
        let degrees;
        if (region === 'lumbar') degrees = -(lumbarBaseTotal * weight + localCorrection);
        else if (region === 'thoracic') degrees = thoracicBaseTotal * weight - localCorrection;
        else degrees = -(cervicalBaseTotal * weight + localCorrection);
        record.group.userData.alignmentRotationZ = THREE.MathUtils.degToRad(degrees);
      }

      const displayedPT = state.view === 'post' ? state.prediction.newPT : state.params.pt;
      const pelvicKinematics = derivePelvicKinematicTargets(state.params.pi, displayedPT, calibration);
      // PT remains a rigid posture transform of pelvis + spine about the hip-axis
      // proxy. PI is independent: it pivots only the source sacrum and the spinal
      // chain about the L5-S1 proxy, leaving the hip-bone transforms, hip axis and
      // lower limbs fixed; the hip-bone surfaces are reshaped to follow the
      // sacrum at the SI joints (applyPelvicIncidenceField). This is an authored
      // morphology display surrogate, not patient-specific sacral remodeling or
      // an inference of SI-joint congruity.
      targetPelvisRotation = THREE.MathUtils.degToRad(pelvicKinematics.postureDeltaDeg);
      targetSacralMorphologyRotation = THREE.MathUtils.degToRad(pelvicKinematics.morphologyDeltaDeg);
      pelvisGroup.userData.sacralSlope = pelvicKinematics.sacralSlopeDeg;
      pelvisGroup.userData.pelvicIncidence = pelvicKinematics.pelvicIncidenceDeg;
      pelvisGroup.userData.pelvicTilt = pelvicKinematics.pelvicTiltDeg;
      pelvisGroup.userData.pelvicIncidenceChangesRigidPose = false;
      pelvisGroup.userData.pelvicIncidenceChangesSacralBaseMorphology = true;
      pelvisGroup.userData.pelvicIncidenceMorphologyDeltaDeg = pelvicKinematics.morphologyDeltaDeg;
      pelvisGroup.userData.pelvicPostureDeltaDeg = pelvicKinematics.postureDeltaDeg;
      pelvisGroup.userData.netSacralSlopeDeltaDeg = pelvicKinematics.netSacralSlopeDeltaDeg;
      if (sacralMorphologyRoot) {
        sacralMorphologyRoot.userData.targetRotationZ = targetSacralMorphologyRotation;
        sacralMorphologyRoot.userData.pelvicIncidenceDeg = pelvicKinematics.pelvicIncidenceDeg;
        sacralMorphologyRoot.userData.sacralSlopeDeg = pelvicKinematics.sacralSlopeDeg;
      }
      updateSurgicalVisibility();
      applyPathologyTargets(force);

      if (firstTargetApplication || force || reducedMotion.matches) {
        pelvisGroup.rotation.z = targetPelvisRotation;
        if (sacralMorphologyRoot) sacralMorphologyRoot.rotation.z = targetSacralMorphologyRotation;
        applySacralReferenceMorphologyTransform(targetSacralMorphologyRotation);
        segmentRecords.forEach(record => { record.group.rotation.z = record.group.userData.targetRotationZ; });
        firstTargetApplication = false;
        worldRoot.updateMatrixWorld(true);
        updateReferenceLines();
      }
      worldRoot.updateMatrixWorld(true);
      updateKinematicConstructBindings();
      worldRoot.updateMatrixWorld(true);
      updateReferenceLigamentContinuity();
    }

    function setHighlightedLevel(levelId) {
      highlightedLevel = levelId;
      for (const [id, record] of segmentRecords) record.highlight.visible = id === levelId;
    }

    function updateReferenceLines() {
      const c7 = segmentRecords.get('C7-T1');
      if (!c7 || !s1Landmark || !camera || !renderer) return;
      if (state.inspection?.active || state.layers?.measurements !== true) {
        [plumbLine, cogLine, svaConnector, c7Marker, pelvicIncidenceRadiusLine, pelvicIncidenceGuide]
          .forEach(object => { if (object) object.visible = false; });
        els.c7Label.hidden = true;
        els.plumbLabel.hidden = true;
        return;
      }
      [plumbLine, cogLine, svaConnector, c7Marker, pelvicIncidenceRadiusLine, pelvicIncidenceGuide]
        .forEach(object => { if (object) object.visible = true; });
      const c7Centroid = referenceAnchorFor('C7');
      c7World.copy(c7.group.localToWorld(c7Centroid ? sourceLocalPoint(c7.level, c7Centroid) : new THREE.Vector3()));
      s1Landmark.getWorldPosition(s1World);
      pelvisGroup.getWorldPosition(hipAxisWorld);
      sacralMorphologyRoot.getWorldPosition(sacralBaseWorld);
      setLinePoints(pelvicIncidenceRadiusLine, hipAxisWorld, sacralBaseWorld, true);
      const topY = Math.max(10.5, c7World.y + 1.5);
      const z = 1.12;
      plumbTopWorld.set(s1World.x, topY, z);
      setLinePoints(plumbLine, new THREE.Vector3(s1World.x, s1World.y - 1.6, z), plumbTopWorld);
      setLinePoints(cogLine, new THREE.Vector3(c7World.x, s1World.y - 1.6, z + .02), new THREE.Vector3(c7World.x, c7World.y, z + .02), true);
      setLinePoints(svaConnector, new THREE.Vector3(s1World.x, c7World.y, z + .03), new THREE.Vector3(c7World.x, c7World.y, z + .03));
      c7Marker.position.set(c7World.x, c7World.y, z + .04);

      positionWorldLabel(els.c7Label, c7Marker.position);
      positionWorldLabel(els.plumbLabel, plumbTopWorld);
    }

    function positionWorldLabel(element, worldPosition) {
      const projected = worldPosition.clone().project(camera);
      if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.15 || Math.abs(projected.y) > 1.15) {
        element.hidden = true;
        return;
      }
      const width = renderer.domElement.clientWidth;
      const height = renderer.domElement.clientHeight;
      element.hidden = false;
      element.style.left = `${(projected.x * .5 + .5) * width}px`;
      element.style.top = `${(-projected.y * .5 + .5) * height}px`;
    }

    function positionPostoperativeSurveillanceMarkers() {
      if (!renderer || !camera || els.surveillanceMarkerLayer.hidden) return;
      const width = renderer.domElement.clientWidth;
      const height = renderer.domElement.clientHeight;
      els.surveillanceMarkerLayer.querySelectorAll('.surveillance-marker').forEach(button => {
        const record = segmentRecords.get(button.dataset.levelId);
        if (!record || !recordRegionVisible(record)) {
          button.hidden = true;
          return;
        }
        const point = new THREE.Vector3();
        const visibleBoneBounds = new THREE.Box3().makeEmpty();
        [
          record.referenceLayer,
          record.topsPostoperativeReferenceLayer,
          record.body,
          record.endplates,
          record.posteriorElement
        ].forEach(root => expandBoundsByVisibleMeshes(visibleBoneBounds, root));
        if (visibleBoneBounds.isEmpty()) record.anatomyRoot.getWorldPosition(point);
        else visibleBoneBounds.getCenter(point);
        const projected = point.project(camera);
        const outside = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08;
        button.hidden = outside;
        if (outside) return;
        button.style.left = `${(projected.x * .5 + .5) * width + 22}px`;
        button.style.top = `${(-projected.y * .5 + .5) * height}px`;
      });
    }

    function objectVisibleInHierarchy(object) {
      if (!object) return false;
      let current = object;
      while (current) {
        if (current.visible === false) return false;
        current = current.parent;
      }
      return true;
    }

    function expandBoundsByVisibleMeshes(bounds, root) {
      if (!root || !objectVisibleInHierarchy(root)) return bounds;
      root.updateWorldMatrix(true, true);
      root.traverse(object => {
        if (!object.isMesh || !object.geometry || !objectVisibleInHierarchy(object)) return;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        const localBounds = object.geometry.boundingBox;
        if (!localBounds || localBounds.isEmpty()) return;
        object.updateWorldMatrix(true, false);
        bounds.union(localBounds.clone().applyMatrix4(object.matrixWorld));
      });
      return bounds;
    }

    function visibleAnatomyBounds(includeLowerLimbs = lowerExtremityContext?.visible === true) {
      const bounds = new THREE.Box3().makeEmpty();
      segmentRecords.forEach(record => {
        [
          record.referenceLayer,
          record.topsPostoperativeReferenceLayer,
          record.body,
          record.endplates,
          record.posteriorElement,
          record.disc,
          record.hardwareLayer,
          record.cutSurfaces,
          record.decompressionVoid,
          record.interbodyResectionEnvelope,
          record.osteotomyRemnants
        ].filter(Boolean).forEach(root => expandBoundsByVisibleMeshes(bounds, root));
      });
      [pelvisReferenceLayer, pelvisAnatomyLayer]
        .filter(Boolean)
        .forEach(root => expandBoundsByVisibleMeshes(bounds, root));
      if (includeLowerLimbs && lowerExtremityContext?.visible) {
        expandBoundsByVisibleMeshes(bounds, lowerExtremityContext);
      }
      return bounds;
    }

    /* Camera view presets (F108). Scene axes: +Z is patient-left, -X is
       anterior, +Y is cranial. Each preset is a horizontal camera direction
       from the target; the lateral preset keeps the established slightly
       anterior-offset left-lateral view. */
    const CAMERA_VIEW_PRESETS = Object.freeze({
      lateral: Object.freeze({ label: 'Left lateral', direction: Object.freeze([.0875, 0, 1]) }),
      ap: Object.freeze({ label: 'AP (anterior view)', direction: Object.freeze([-1, 0, 0]) }),
      pa: Object.freeze({ label: 'PA (posterior view)', direction: Object.freeze([1, 0, 0]) }),
      oblique: Object.freeze({ label: 'Left anterior oblique', direction: Object.freeze([-1, 0, 1]) })
    });
    let cameraViewPreset = 'lateral';
    let cameraViewTween = null;

    function cameraPresetDirection(preset = cameraViewPreset) {
      const entry = CAMERA_VIEW_PRESETS[preset] || CAMERA_VIEW_PRESETS.lateral;
      return new THREE.Vector3().fromArray(entry.direction).normalize();
    }

    /* The Pre-Op / Modeled Post-Op switch floats over the top-centre of the
       viewport, exactly where the skull lands in a full-body frame, so the
       frame reserves that band (F101). Measured, because the switch moves
       between breakpoints. */
    function viewportOverlayInsets() {
      const host = $('viewport');
      const switcher = els?.viewSwitch;
      if (!host || !switcher || typeof host.getBoundingClientRect !== 'function') return { top: 0, bottom: 0 };
      const box = host.getBoundingClientRect();
      if (!(box.height > 40)) return { top: 0, bottom: 0 };
      const overlay = switcher.getBoundingClientRect();
      // A pill-sized overlay only; anything else is not the view switch.
      const visible = overlay.height > 0 && overlay.height < box.height * .3 && overlay.width < box.width * .8
        && (typeof window.getComputedStyle !== 'function' || window.getComputedStyle(switcher).display !== 'none');
      const top = visible && overlay.bottom > box.top && overlay.top < box.top + box.height * .5
        ? THREE.MathUtils.clamp((overlay.bottom - box.top + 10) / box.height, 0, .3)
        : 0;
      return { top, bottom: 0 };
    }

    function frameVisibleAnatomy({ includeLowerLimbs = lowerExtremityContext?.visible === true, margin = 1.12, view = cameraViewPreset, apply = true } = {}) {
      if (!camera || !controls) return null;
      const bounds = visibleAnatomyBounds(includeLowerLimbs);
      if (bounds.isEmpty()) return null;
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const direction = cameraPresetDirection(view);
      // Horizontal screen axis for this direction, so AP/PA views fit the
      // patient's left-right width rather than the lateral depth.
      const right = new THREE.Vector3().crossVectors(direction.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
      const projectedWidth = Math.abs(size.x * right.x) + Math.abs(size.z * right.z);
      const projectedDepth = Math.abs(size.x * direction.x) + Math.abs(size.z * direction.z);
      const insets = viewportOverlayInsets();
      const band = Math.max(.5, 1 - insets.top - insets.bottom);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1;
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const heightDistance = size.y / Math.max(2 * Math.tan(verticalFov / 2) * band, 1e-6);
      const widthDistance = projectedWidth / Math.max(2 * Math.tan(horizontalFov / 2), 1e-6);
      const maxDistance = includeLowerLimbs ? CAMERA_LIMITS.fullBodyMaxDistance : CAMERA_LIMITS.spineMaxDistance;
      const requestedDistance = (Math.max(heightDistance, widthDistance) + projectedDepth * .5) * margin;
      const distance = THREE.MathUtils.clamp(
        requestedDistance,
        CAMERA_LIMITS.minDistance * 1.05,
        maxDistance * .96
      );
      // Centre the anatomy in the unobstructed band: raising the target moves
      // the model down the screen by the same fraction of the view height.
      const target = center.clone();
      target.y += (insets.top - insets.bottom) * distance * Math.tan(verticalFov / 2);
      const frame = {
        policy: MODEL_MANIFEST.anatomy.cameraFramingPolicy,
        includeLowerLimbs: Boolean(includeLowerLimbs),
        margin,
        view: CAMERA_VIEW_PRESETS[view] ? view : 'lateral',
        topInsetFraction: insets.top,
        distance,
        requestedDistance,
        center: center.toArray(),
        target: target.toArray(),
        size: size.toArray(),
        boundsMin: bounds.min.toArray(),
        boundsMax: bounds.max.toArray()
      };
      if (!apply) return { ...frame, position: target.clone().addScaledVector(direction, distance).toArray() };
      cameraViewTween = null;
      controls.minDistance = CAMERA_LIMITS.minDistance;
      controls.maxDistance = maxDistance;
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.userData.lastAnatomyFrame = frame;
      controls.update();
      syncCameraOrientationLabel(true);
      return camera.userData.lastAnatomyFrame;
    }

    // Moves to a preset view around the same framing, animated unless reduced
    // motion is requested. Returns the preset actually applied.
    function setCameraViewPreset(preset, { animate = true, announceChange = true } = {}) {
      if (!CAMERA_VIEW_PRESETS[preset]) return null;
      cameraViewPreset = preset;
      syncViewPresetButtons(preset);
      if (!camera || !controls) return preset;
      if (state.inspection?.active) {
        resetCameraView({ announceChange });
        return preset;
      }
      const frameFullBody = state.globalDeformity?.lowerExtremitiesVisible === true
        && state.layers?.lowerLimbs !== false
        && lowerExtremityContext?.visible === true;
      const frame = frameVisibleAnatomy({ includeLowerLimbs: frameFullBody, apply: false });
      if (!frame) return preset;
      if (!animate || reducedMotion.matches) {
        frameVisibleAnatomy({ includeLowerLimbs: frameFullBody });
      } else {
        const fromOffset = camera.position.clone().sub(controls.target);
        const toTarget = new THREE.Vector3().fromArray(frame.target);
        const toOffset = new THREE.Vector3().fromArray(frame.position).sub(toTarget);
        const from = new THREE.Spherical().setFromVector3(fromOffset);
        const to = new THREE.Spherical().setFromVector3(toOffset);
        let deltaTheta = to.theta - from.theta;
        while (deltaTheta > Math.PI) deltaTheta -= Math.PI * 2;
        while (deltaTheta < -Math.PI) deltaTheta += Math.PI * 2;
        controls.minDistance = CAMERA_LIMITS.minDistance;
        controls.maxDistance = frameFullBody ? CAMERA_LIMITS.fullBodyMaxDistance : CAMERA_LIMITS.spineMaxDistance;
        cameraViewTween = {
          startedAt: performance.now(), duration: 420,
          fromTarget: controls.target.clone(), toTarget,
          from, deltaTheta, toPhi: to.phi, toRadius: to.radius, frame, frameFullBody
        };
      }
      if (announceChange) announce(`${CAMERA_VIEW_PRESETS[preset].label} view.`);
      return preset;
    }

    // Advanced from the render loop; the damping of OrbitControls is bypassed
    // while a preset move is running.
    function stepCameraViewTween(now = performance.now()) {
      const tween = cameraViewTween;
      if (!tween || !camera || !controls) return false;
      const t = Math.min(1, (now - tween.startedAt) / tween.duration);
      const eased = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const spherical = new THREE.Spherical(
        tween.from.radius + (tween.toRadius - tween.from.radius) * eased,
        tween.from.phi + (tween.toPhi - tween.from.phi) * eased,
        tween.from.theta + tween.deltaTheta * eased
      );
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      if (t >= 1) {
        cameraViewTween = null;
        camera.userData.lastAnatomyFrame = tween.frame;
      }
      return true;
    }

    function syncViewPresetButtons(active) {
      document.querySelectorAll('[data-view-preset]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.viewPreset === active));
      });
    }

    /* The orientation chip and horizontal axis label follow the camera
       (F108): they were static text reading "Lateral sagittal · Left" in every
       view. Derived from the camera azimuth around the target; the DOM is only
       written when the nearest canonical view changes. */
    let lastOrientationKey = '';
    function describeCameraOrientation() {
      if (!camera || !controls) return null;
      const offset = camera.position.clone().sub(controls.target);
      const horizontal = Math.hypot(offset.x, offset.z);
      // 0° = camera at patient-left (+Z); -90° = anterior (-X); 90° = posterior.
      const azimuth = THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
      const elevation = THREE.MathUtils.radToDeg(Math.atan2(offset.y, Math.max(horizontal, 1e-6)));
      const views = [
        { at: 0, key: 'left-lateral', label: 'Left lateral', axis: 'Anterior ←', preset: 'lateral' },
        { at: -45, key: 'left-anterior-oblique', label: 'Left anterior oblique', axis: '', preset: 'oblique' },
        { at: -90, key: 'ap', label: 'AP · anterior view', axis: 'Patient right ←', preset: 'ap' },
        { at: -135, key: 'right-anterior-oblique', label: 'Right anterior oblique', axis: '', preset: null },
        { at: 180, key: 'right-lateral', label: 'Right lateral', axis: 'Anterior →', preset: null },
        { at: 135, key: 'right-posterior-oblique', label: 'Right posterior oblique', axis: '', preset: null },
        { at: 90, key: 'pa', label: 'PA · posterior view', axis: 'Patient right →', preset: 'pa' },
        { at: 45, key: 'left-posterior-oblique', label: 'Left posterior oblique', axis: '', preset: null }
      ];
      const distance = at => Math.abs(((azimuth - at + 540) % 360) - 180);
      const nearest = views.reduce((best, view) => (distance(view.at) < distance(best.at) ? view : best), views[0]);
      const tilted = Math.abs(elevation) > 30;
      return {
        ...nearest,
        azimuth,
        elevation,
        exact: distance(nearest.at) <= 6 && !tilted,
        label: tilted ? `${nearest.label} · ${elevation > 0 ? 'from above' : 'from below'}` : nearest.label
      };
    }

    function syncCameraOrientationLabel(force = false) {
      const orientation = describeCameraOrientation();
      if (!orientation) return null;
      const key = `${orientation.label}|${orientation.axis}|${orientation.exact ? orientation.preset : ''}`;
      if (!force && key === lastOrientationKey) return orientation;
      lastOrientationKey = key;
      const label = $('orientationLabel');
      if (label) label.textContent = orientation.label;
      const axis = $('axisHorizontalLabel');
      if (axis) {
        axis.textContent = orientation.axis;
        axis.hidden = !orientation.axis;
      }
      if (!cameraViewTween) syncViewPresetButtons(orientation.exact ? orientation.preset : null);
      return orientation;
    }

    function resetCameraView({ announceChange = true } = {}) {
      if (!camera || !controls) return;
      if (state.inspection?.active) {
        frameInspectionRecord(segmentRecords.get(state.inspection.levelId));
        if (announceChange) announce('Focused inspection camera reset. Measurements, containment and collisions remain disabled.');
        return;
      }
      const frameFullBody = state.globalDeformity?.lowerExtremitiesVisible === true
        && state.layers?.lowerLimbs !== false
        && lowerExtremityContext?.visible === true;
      const frame = frameVisibleAnatomy({ includeLowerLimbs: frameFullBody });
      if (!frame) {
        // Startup fallback before anatomy exists; initialization performs a
        // second bounds-based frame immediately after the scene is built.
        controls.minDistance = CAMERA_LIMITS.minDistance;
        controls.maxDistance = frameFullBody ? CAMERA_LIMITS.fullBodyMaxDistance : CAMERA_LIMITS.spineMaxDistance;
        camera.position.set(frameFullBody ? 4.2 : 2.8, frameFullBody ? -1 : 4.2, frameFullBody ? 48 : 24);
        controls.target.set(frameFullBody ? -.2 : -.35, frameFullBody ? -1 : 4.2, 0);
        controls.update();
      }
      if (announceChange) announce(`${frameFullBody ? 'Full standing-context' : 'Spine-focused'} ${(CAMERA_VIEW_PRESETS[cameraViewPreset] || CAMERA_VIEW_PRESETS.lateral).label} camera view reset.`);
    }

    function zoomCameraByFactor(factor) {
      if (!camera || !controls || !Number.isFinite(factor) || factor <= 0) return null;
      const offset = camera.position.clone().sub(controls.target);
      const currentDistance = offset.length();
      if (currentDistance < 1e-6) offset.set(0, 0, 1);
      const nextDistance = THREE.MathUtils.clamp(
        Math.max(currentDistance, 1e-6) * factor,
        controls.minDistance,
        controls.maxDistance
      );
      offset.normalize().multiplyScalar(nextDistance);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      return nextDistance;
    }

    // Last viewport size the camera was framed for. A step change, a panel
    // collapse or a device rotation resizes the viewport without moving the
    // camera, so the framing computed for the old box no longer fits the model -
    // which is how the lower limbs end up cropped off the bottom.
    let lastFramedViewport = null;

    function resizeRenderer() {
      if (!renderer || !camera) return;
      const host = $('viewport');
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      if (width > 1 && height > 1) {
        const changedMaterially = !lastFramedViewport
          || Math.abs(width - lastFramedViewport.width) / lastFramedViewport.width > .12
          || Math.abs(height - lastFramedViewport.height) / lastFramedViewport.height > .12;
        if (changedMaterially) {
          lastFramedViewport = { width, height };
          // Defer so the new aspect is applied before the fit is computed.
          window.requestAnimationFrame(() => {
            if (typeof frameVisibleAnatomy === 'function') frameVisibleAnatomy();
          });
        }
      }
      const mobilePixelRatioCeiling = window.matchMedia('(max-width: 640px)').matches ? 1.35 : 1.75;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobilePixelRatioCeiling));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    // Version-independent exponential damping keeps morph timing identical in
    // desktop browsers and native WebViews.
    const dampValue = (current, target, lambda, deltaSeconds) =>
      target + ((current - target) * Math.exp(-lambda * deltaSeconds));
    let lastRenderedFrame = 0;

