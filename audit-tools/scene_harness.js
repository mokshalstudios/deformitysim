/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'spine_simulator.html'));
const statBefore = fs.statSync(htmlPath);
const html = fs.readFileSync(htmlPath, 'utf8');
// Executable blocks only; typed data blocks (embedded model topology/weights)
// are validated by check_html.js / v2_static_probe.js instead of parsed here.
const JS_SCRIPT_TYPE = /^(?:|module|text\/javascript|application\/javascript|text\/ecmascript)$/i;
const scripts = [...html.matchAll(/<script((?:\s[^>]*)?)>([\s\S]*?)<\/script>/gi)]
  .filter(match => { const type = /\btype\s*=\s*(["'])(.*?)\1/i.exec(match[1] || ''); return JS_SCRIPT_TYPE.test(type ? type[2].trim() : ''); })
  .map(match => match[2]);

const results = [];
const check = (condition, label, detail = '') => {
  results.push({ ok: Boolean(condition), label, detail: condition ? '' : String(detail) });
};
const near = (left, right, epsilon = 1e-9) => Math.abs(left - right) <= epsilon;

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.name = '';
    this.type = '';
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.multiple = false;
    this.files = [];
    this.open = false;
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = {};
    this.clientWidth = id === 'viewport' || id === 'threeCanvas' ? 1280 : 640;
    this.clientHeight = id === 'viewport' || id === 'threeCanvas' ? 800 : 480;
    this.width = this.clientWidth;
    this.height = this.clientHeight;
    this.validity = { valid: true };
    this.style = { setProperty(key, value) { this[key] = value; } };
    this._classes = new Set();
    this._queryFallbacks = new Map();
    this.classList = {
      add: (...tokens) => tokens.forEach(token => this._classes.add(String(token))),
      remove: (...tokens) => tokens.forEach(token => this._classes.delete(String(token))),
      toggle: (token, force) => {
        const key = String(token);
        const shouldAdd = force === undefined ? !this._classes.has(key) : Boolean(force);
        if (shouldAdd) this._classes.add(key);
        else this._classes.delete(key);
        return shouldAdd;
      },
      contains: token => this._classes.has(String(token))
    };
  }

  get className() { return [...this._classes].join(' '); }
  set className(value) {
    this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  get childNodes() {
    return this.children.length ? this.children : [{ textContent: 'Parameter' }];
  }

  get options() {
    const options = [];
    this.walkDom(node => { if (node.tagName === 'OPTION') options.push(node); });
    return options;
  }

  get selectedIndex() {
    const index = this.options.findIndex(option => option.value === this.value);
    return index < 0 ? (this.options.length ? 0 : -1) : index;
  }

  set selectedIndex(index) {
    const option = this.options[Number(index)];
    if (option) this.value = option.value;
  }

  walkDom(visitor) {
    for (const child of this.children) {
      visitor(child);
      if (child.walkDom) child.walkDom(visitor);
    }
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node || typeof node === 'string') continue;
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) {
    const name = String(key);
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === 'id') this.id = normalized;
    else if (name === 'class') this.className = normalized;
    else if (name === 'name') this.name = normalized;
    else if (name === 'type') this.type = normalized;
    else if (name === 'value') this.value = normalized;
    else if (name === 'checked') this.checked = true;
    else if (name === 'disabled') this.disabled = true;
    else if (name === 'hidden') this.hidden = true;
    else if (name === 'multiple') this.multiple = true;
    else if (name.startsWith('data-')) {
      const dataKey = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[dataKey] = normalized;
    } else {
      this[name] = normalized;
    }
  }
  getAttribute(key) { return this.attributes.get(key) || null; }
  removeAttribute(key) {
    const name = String(key);
    this.attributes.delete(name);
    if (name === 'checked') this.checked = false;
    else if (name === 'disabled') this.disabled = false;
    else if (name === 'hidden') this.hidden = false;
    else if (name === 'src') delete this.src;
  }
  toggleAttribute(key, force) {
    const present = this.attributes.has(key);
    const shouldAdd = force === undefined ? !present : Boolean(force);
    if (shouldAdd) this.setAttribute(key, '');
    else this.removeAttribute(key);
    return shouldAdd;
  }
  addEventListener(key, listener) { (this.listeners[key] ||= []).push(listener); }
  dispatchEvent(event) {
    const normalized = typeof event === 'string' ? { type: event } : { ...(event || {}) };
    normalized.type ||= 'change';
    normalized.target ||= this;
    normalized.currentTarget = this;
    normalized.preventDefault ||= () => {};
    for (const listener of [...(this.listeners[normalized.type] || [])]) listener.call(this, normalized);
    return true;
  }
  click() { return this.dispatchEvent({ type: 'click' }); }
  querySelector(selector) {
    const result = this.querySelectorAll(selector)[0];
    if (result) return result;
    // Static HTML is intentionally not parsed into a full tree. Persist tiny
    // descendants that the application treats as status/value outlets.
    if (['strong', 'span', 'p'].includes(selector) || selector === '.remove-button') {
      if (!this._queryFallbacks.has(selector)) {
        const fallback = new FakeElement(selector === '.remove-button' ? 'button' : selector);
        if (selector === '.remove-button') fallback.className = 'remove-button';
        this._queryFallbacks.set(selector, fallback);
        this.append(fallback);
      }
      return this._queryFallbacks.get(selector);
    }
    return null;
  }
  querySelectorAll(selector) {
    const matches = [];
    this.walkDom(node => { if (matchesSimpleSelector(node, selector)) matches.push(node); });
    return matches;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (matchesSimpleSelector(node, selector)) return node;
      node = node.parentNode;
    }
    const wrapper = new FakeElement();
    const label = new FakeElement('label');
    label.textContent = 'Parameter';
    wrapper.querySelector = () => label;
    return wrapper;
  }
  focus() {}
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() {
    return {
      left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight,
      width: this.clientWidth, height: this.clientHeight
    };
  }
  getContext() { return null; }
}

const matchesSimpleSelector = (element, selector) => {
  if (!element || typeof selector !== 'string') return false;
  let source = selector.trim();
  if (!source || source.includes(' ') || source.includes(',')) return false;
  const requiresChecked = /:checked\b/.test(source);
  source = source.replace(/:checked\b/g, '');
  if (requiresChecked && !element.checked) return false;
  const attributes = [...source.matchAll(/\[([^\]=\s]+)(?:\s*=\s*["']?([^"'\]]+)["']?)?\]/g)];
  source = source.replace(/\[[^\]]+\]/g, '');
  for (const match of attributes) {
    const name = match[1];
    const expected = match[2];
    const actual = name in element ? element[name] : element.getAttribute?.(name);
    if (expected === undefined) {
      if (actual === undefined || actual === null || actual === false) return false;
    } else if (String(actual) !== expected) return false;
  }
  const idMatches = [...source.matchAll(/#([\w-]+)/g)].map(match => match[1]);
  if (idMatches.some(id => element.id !== id)) return false;
  const classMatches = [...source.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
  if (classMatches.some(className => !element.classList?.contains(className))) return false;
  const tag = source.replace(/#[\w-]+/g, '').replace(/\.[\w-]+/g, '').trim();
  return !tag || element.tagName === tag.toUpperCase();
};

const parseAttributes = source => {
  const attributes = [];
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of String(source || '').matchAll(pattern)) {
    attributes.push([match[1], match[2] ?? match[3] ?? match[4] ?? '']);
  }
  return attributes;
};

const elements = new Map();
const staticElements = [];
for (const match of html.matchAll(/<([a-z][\w-]*)([^<>]*)>/gi)) {
  const tagName = match[1];
  const attributes = parseAttributes(match[2]);
  const id = attributes.find(([name]) => name.toLowerCase() === 'id')?.[1] || '';
  const shouldTrack = Boolean(id) || ['input', 'option'].includes(tagName.toLowerCase());
  if (!shouldTrack) continue;
  const element = new FakeElement(tagName, id);
  attributes.forEach(([name, value]) => element.setAttribute(name.toLowerCase(), value));
  staticElements.push(element);
  if (id) elements.set(id, element);
}
const getElement = id => {
  if (!elements.has(id)) elements.set(id, new FakeElement(id === 'threeCanvas' ? 'canvas' : 'div', id));
  return elements.get(id);
};
for (const selectMatch of html.matchAll(/<select\b([^>]*)\bid=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/select>/gi)) {
  const select = getElement(selectMatch[2]);
  const optionMatches = [...selectMatch[4].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
  let selectedValue = '';
  for (const optionMatch of optionMatches) {
    const option = new FakeElement('option');
    parseAttributes(optionMatch[1]).forEach(([name, value]) => option.setAttribute(name.toLowerCase(), value));
    option.textContent = optionMatch[2].replace(/<[^>]+>/g, '').trim();
    select.append(option);
    if (!selectedValue || /\bselected\b/i.test(optionMatch[1])) selectedValue = option.value;
  }
  if (selectedValue) select.value = selectedValue;
}
const documentListeners = {};
const documentBody = new FakeElement('body');
const documentElement = new FakeElement('html');
const document = {
  hidden: false,
  body: documentBody,
  documentElement,
  getElementById: getElement,
  createElement: tag => new FakeElement(tag),
  createElementNS: (namespace, tag) => new FakeElement(tag),
  createDocumentFragment: () => new FakeElement(),
  addEventListener(type, listener) { (documentListeners[type] ||= []).push(listener); },
  dispatchEvent(event) {
    const normalized = typeof event === 'string' ? { type: event } : event;
    for (const listener of [...(documentListeners[normalized.type] || [])]) listener.call(document, normalized);
  },
  querySelector: selector => staticElements.find(element => matchesSimpleSelector(element, selector)) || null,
  querySelectorAll: selector => staticElements.filter(element => matchesSimpleSelector(element, selector))
};

const capturedErrors = [];
const windowListeners = {};
const createdObjectUrls = [];
const revokedObjectUrls = [];
let nextObjectUrl = 1;
const context = {
  document,
  console: {
    log() {},
    warn() {},
    error(...args) { capturedErrors.push(args.map(value => value && value.stack || String(value)).join(' ')); }
  },
  navigator: {},
  performance: { now: () => 0 },
  devicePixelRatio: 1,
  setTimeout: () => 1,
  clearTimeout() {},
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener(type, listener) { (windowListeners[type] ||= []).push(listener); },
  removeEventListener(type, listener) {
    const listeners = windowListeners[type] || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  },
  dispatchEvent(event) {
    const normalized = typeof event === 'string' ? { type: event } : event;
    for (const listener of [...(windowListeners[normalized.type] || [])]) listener.call(context, normalized);
  },
  URL: {
    createObjectURL(file) {
      const value = `blob:scene-harness/${nextObjectUrl++}`;
      createdObjectUrls.push({ value, file });
      return value;
    },
    revokeObjectURL(value) { revokedObjectUrls.push(value); }
  },
  location: { reload() {} },
  ResizeObserver: class { observe() {} },
  HTMLCanvasElement: FakeElement,
  HTMLElement: FakeElement,
  HTMLImageElement: function HTMLImageElement() {},
  ImageData: function ImageData() {},
  ImageBitmap: function ImageBitmap() {},
  atob: encoded => Buffer.from(encoded, 'base64').toString('binary'),
  Map, Set, WeakMap, WeakSet, Object, Array, Math, Number, String, Boolean, Date,
  JSON, RegExp, Error, TypeError, RangeError, Symbol, Promise,
  Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array,
  Int8Array, Int16Array, Int32Array, ArrayBuffer, DataView
};
context.window = context;
context.self = context;
context.globalThis = context;
vm.createContext(context);

for (let index = 0; index < scripts.length; index += 1) {
  try {
    new Function(scripts[index]);
    check(true, 'embedded script ' + index + ' parses');
  } catch (error) {
    check(false, 'embedded script ' + index + ' parses', error.message);
  }
}

const runtimeScriptIndex = scripts.findIndex(script =>
  script.includes('THREE.OrbitControls = OrbitControls')
  && script.includes('WebGLRenderer'));
const bootstrapScriptIndex = scripts.findIndex(script =>
  script.includes('window.__spineModuleReady = false')
  && script.includes('window.__showSpine3dError'));
const applicationScriptIndex = scripts.findIndex((script, index) =>
  index > runtimeScriptIndex
  && script.includes('function auditSceneStructure()')
  && script.includes('window.__SPINE_TEST__'));
if (runtimeScriptIndex < 0 || bootstrapScriptIndex < 0 || applicationScriptIndex < 0) {
  throw new Error(
    `Unable to locate bootstrap/runtime/application scripts `
    + `(bootstrap=${bootstrapScriptIndex}, runtime=${runtimeScriptIndex}, app=${applicationScriptIndex}).`
  );
}

vm.runInContext(scripts[bootstrapScriptIndex], context, { filename: 'bootstrap.js' });
vm.runInContext(scripts[runtimeScriptIndex], context, { filename: 'three-runtime.js', timeout: 15000 });

context.THREE.WebGLRenderer = class FakeRenderer {
  constructor(options) {
    this.domElement = options.canvas;
    this.domElement.clientWidth = 1280;
    this.domElement.clientHeight = 800;
  }
  setPixelRatio() {}
  setSize(width, height) {
    this.domElement.clientWidth = width;
    this.domElement.clientHeight = height;
  }
  render() {}
};
context.THREE.OrbitControls = class FakeControls {
  constructor() {
    this.target = new context.THREE.Vector3();
    this.minPolarAngle = 0;
    this.maxPolarAngle = Math.PI;
    this.minDistance = 0;
    this.maxDistance = 100;
  }
  update() {}
};

const exposure = [
  ';globalThis.__SCENE_HARNESS__ = {',
  '  get ready() { return sceneReady; },',
  '  decode: decodeReferenceGeometry,',
  '  decodeLower: decodeLowerLimbGeometry,',
  '  captureRaycastCandidates() {',
  '    let captured = [];',
  '    inspectionRaycaster.intersectObjects = function (candidates) { captured = candidates.slice(); return []; };',
  '    selectLevelAtClientPoint(640, 400, "level");',
  '    return captured;',
  '  },',
  '  setScenario(items) {',
  '    state.inspection.active = false;',
  '    state.itinerary = items.map(function (item, index) {',
  '      var procedure = PROCEDURES[item.procedureId];',
  '      var level = LEVEL_BY_ID.get(item.levelId);',
  '      var policy = correctionPolicyFor(procedure, level);',
  '      return Object.assign({ id: index + 1, plannedAngle: policy.defaultDeg, plannedAngleSource: policy.enabled ? "procedure_default_assumption" : "not_applicable" }, item);',
  '    });',
  '    state.prediction = calculateBiomechanics(state.params, state.itinerary, state.assumptions);',
  '    state.threePlanePrediction = computeThreePlaneScenario(state.globalDeformity, state.itinerary, state.assumptions);',
  '    state.view = "post";',
  '    rebuildHardware();',
  '    applyModelTargets(true);',
  '    updateShapeStatus();',
  '    updateMechanicsSummary();',
  '    updateCanvasDescription();',
  '  },',
  '  get implantCatalogs() { return IMPLANT_CATALOGS; },',
  '  get implantProfiles() { return PROCEDURE_IMPLANT_PROFILES; },',
  '  get millimetresToScene() { return REFERENCE_MM_TO_SCENE; },',
  '  get layerState() { return Object.assign({}, state.layers); },',
  '  get camera() { return camera; },',
  '  get controls() { return controls; },',
  '  get measurementObjects() { return [plumbLine, cogLine, svaConnector, c7Marker]; },',
  '  get createHardwareSource() { return createHardware.toString(); },',
  '  get legacyHardwareSource() { return [addCage.toString(), addScrewPair.toString(), addAnteriorPlate.toString()].join("\\n"); },',
  '  buildPlan(procedureId, levelId, selection) {',
  '    selection = selection || {};',
  '    els.procedureSelect.value = procedureId;',
  '    els.levelSelect.value = levelId;',
  '    updateImplantConfiguration();',
  '    implantEls.supplementalPosterior.checked = selection.supplementalPosterior !== false;',
  '    implantEls.customMode.checked = selection.custom === true;',
  '    if (selection.cageCatalogId) implantEls.cageCatalog.value = selection.cageCatalogId;',
  '    if (selection.cageFootprint) implantEls.cageFootprint.value = JSON.stringify(selection.cageFootprint);',
  '    if (selection.cageHeight != null) implantEls.cageHeight.value = String(selection.cageHeight);',
  '    if (selection.cageLordosis != null) implantEls.cageLordosis.value = String(selection.cageLordosis);',
  '    if (selection.screwDiameter != null) implantEls.screwDiameter.value = String(selection.screwDiameter);',
  '    if (selection.screwLength != null) implantEls.screwLength.value = String(selection.screwLength);',
  '    if (selection.rodDiameter != null) implantEls.rodDiameter.value = String(selection.rodDiameter);',
  '    if (selection.rodLength != null) implantEls.rodLength.value = String(selection.rodLength);',
  '    if (selection.graftFamily) implantEls.graftFamily.value = selection.graftFamily;',
  '    if (selection.graftVolume != null) implantEls.graftVolume.value = String(selection.graftVolume);',
  '    if (selection.customLabel != null) implantEls.customLabel.value = String(selection.customLabel);',
  '    if (selection.customCageAp != null) implantEls.customCageAp.value = String(selection.customCageAp);',
  '    if (selection.customCageMl != null) implantEls.customCageMl.value = String(selection.customCageMl);',
  '    if (selection.customCageAnterior != null) implantEls.customCageAnterior.value = String(selection.customCageAnterior);',
  '    if (selection.customCagePosterior != null) implantEls.customCagePosterior.value = String(selection.customCagePosterior);',
  '    if (selection.customScrewDiameter != null) implantEls.customScrewDiameter.value = String(selection.customScrewDiameter);',
  '    if (selection.customScrewLength != null) implantEls.customScrewLength.value = String(selection.customScrewLength);',
  '    if (selection.customRodDiameter != null) implantEls.customRodDiameter.value = String(selection.customRodDiameter);',
  '    if (selection.customRodLength != null) implantEls.customRodLength.value = String(selection.customRodLength);',
  '    if (selection.customGraftLabel != null) implantEls.customGraftLabel.value = String(selection.customGraftLabel);',
  '    if (selection.customGraftVolume != null) implantEls.customGraftVolume.value = String(selection.customGraftVolume);',
  '    return buildImplantPlan(procedureId, levelId);',
  '  },',
  '  safeSummary(plan) { return escapeHtml(implantPlanSummary(plan)); },',
  '  createHardwareFor(item, levelId) {',
  '    return createHardware(item, segmentRecords.get(levelId));',
  '  },',
  '  createHardwareWithUnavailableTopsAnchor(item, levelId) {',
  '    var sourceRecord = segmentRecords.get(levelId);',
  '    var record = Object.create(sourceRecord);',
  '    record.level = Object.assign({}, sourceRecord.level, { superior: "MISSING_SOURCE_BONE" });',
  '    return createHardware(item, record);',
  '  },',
  '  setLayers(patch) {',
  '    state.layers = Object.assign({}, state.layers, patch || {});',
  '    if (Object.prototype.hasOwnProperty.call(patch || {}, "lowerLimbs")) state.globalDeformity.lowerExtremitiesVisible = state.layers.lowerLimbs;',
  '    updateSurgicalVisibility();',
  '  },',
  '  setAlignmentParams(patch) {',
  '    Object.assign(state.params, patch || {});',
  '    state.prediction = calculateBiomechanics(state.params, state.itinerary, state.assumptions);',
  '    state.threePlanePrediction = computeThreePlaneScenario(state.globalDeformity, state.itinerary, state.assumptions);',
  '    applyModelTargets(true);',
  '    return Object.assign({}, state.params);',
  '  },',
  '  zoomBy(factor) { return zoomCameraByFactor(factor); },',
  '  resetCamera() { resetCameraView(); },',
  '  get editorCorrectionSource() { return state.editorCorrectionSource; },',
  '  get editorComparisonPrefill() { return state.editorComparisonPrefill; },',
  '  get pelvisAnatomyLayer() { return pelvisAnatomyLayer; }',
  '};'
].join('\n');

// Decoding both embedded atlases and constructing every audited scene object is
// intentionally heavier than ordinary startup. Keep a generous deterministic
// ceiling so slower CI/desktop hosts do not turn a complete scene sweep into a
// false timeout.
vm.runInContext(scripts[applicationScriptIndex] + exposure, context, { filename: 'app.js', timeout: 180000 });

const test = context.__SPINE_TEST__;
const harness = context.__SCENE_HARNESS__;
const segments = test.getSegments();
const atlas = test.REFERENCE_ATLAS_DATA;
const manifest = atlas.manifest;
const objectNames = root => {
  const names = [];
  if (root && root.traverse) root.traverse(object => names.push(object.name || ''));
  return names;
};
const recordVisualRoots = record => [
  record.referenceLayer, record.topsPostoperativeReferenceLayer,
  record.disc, record.body, record.endplates, record.posteriorElement,
  record.ligaments?.layer, record.cutSurfaces, record.decompressionVoid, record.interbodyResectionEnvelope,
  record.osteotomyRemnants, record.hardwareLayer, record.osteophytes
].filter(Boolean);
const valuesFinite = values => Array.from(values || []).every(Number.isFinite);
const finiteObjectTree = root => {
  let pass = true;
  if (!root?.traverse) return pass;
  root.updateWorldMatrix?.(true, true);
  root.traverse(object => {
    pass &&= valuesFinite(object.position?.toArray?.() || [])
      && valuesFinite(object.quaternion?.toArray?.() || [])
      && valuesFinite(object.scale?.toArray?.() || [])
      && valuesFinite(object.matrixWorld?.elements || []);
    const position = object.geometry?.getAttribute?.('position');
    if (position) pass &&= valuesFinite(position.array);
    if (object.geometry) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox;
      pass &&= !box || (valuesFinite(box.min.toArray()) && valuesFinite(box.max.toArray()));
    }
  });
  return pass;
};
const visibleRootBox = root => {
  if (!root?.visible) return null;
  root.updateWorldMatrix?.(true, true);
  const box = new context.THREE.Box3().setFromObject(root);
  return box.isEmpty() ? null : box;
};
const boxMaximumDimension = box => box
  ? Math.max(...box.getSize(new context.THREE.Vector3()).toArray())
  : 0;
const worldMatrixSnapshot = object => {
  object?.updateWorldMatrix?.(true, true);
  return Array.from(object?.matrixWorld?.elements || []);
};
const numericArraysNear = (left, right, epsilon = 1e-9) =>
  left.length === right.length && left.every((value, index) => near(value, right[index], epsilon));
const geometryCounts = geometry => ({
  vertices: geometry && geometry.getAttribute('position') ? geometry.getAttribute('position').count : 0,
  triangles: geometry && geometry.getIndex() ? geometry.getIndex().count / 3 : 0
});
const indexedGeometryBounds = geometry => {
  const box = new context.THREE.Box3();
  const position = geometry?.getAttribute?.('position');
  const index = geometry?.getIndex?.();
  const referenced = new Set();
  if (position) {
    if (index) {
      for (let offset = 0; offset < index.count; offset += 1) referenced.add(index.getX(offset));
    } else {
      for (let offset = 0; offset < position.count; offset += 1) referenced.add(offset);
    }
    const point = new context.THREE.Vector3();
    referenced.forEach(vertexIndex => box.expandByPoint(point.fromBufferAttribute(position, vertexIndex)));
  }
  return {
    box,
    referencedVertices: referenced.size,
    triangles: index ? index.count / 3 : position ? position.count / 3 : 0
  };
};
const geometryTriangleMap = geometry => {
  const triangles = new Map();
  const position = geometry?.getAttribute?.('position');
  const index = geometry?.getIndex?.();
  if (!position || !index) return triangles;
  const pointKey = point => point.toArray().map(value => Number(value).toFixed(5)).join(',');
  for (let offset = 0; offset < index.count; offset += 3) {
    const points = [0, 1, 2].map(delta => new context.THREE.Vector3()
      .fromBufferAttribute(position, index.getX(offset + delta)));
    const key = points.map(pointKey).sort().join('|');
    const existing = triangles.get(key);
    if (existing) existing.count += 1;
    else triangles.set(key, { count: 1, points });
  }
  return triangles;
};
const boxesNear = (left, right, epsilon = 1e-9) => Boolean(left && right
  && numericArraysNear([...left.min.toArray(), ...left.max.toArray()],
    [...right.min.toArray(), ...right.max.toArray()], epsilon));

check(harness.ready && !context.__spineLastError && capturedErrors.length === 0,
  'complete scene initializes without decode/runtime errors',
  context.__spineLastError || capturedErrors.join('\n'));
check(test.MODEL_SELF_TEST.passed, 'built-in model self-test passes', JSON.stringify(test.MODEL_SELF_TEST));
check(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(test.MODEL_MANIFEST.modelVersion),
  'model version is valid semantic-version text', test.MODEL_MANIFEST.modelVersion);
check(typeof test.MODEL_MANIFEST.buildId === 'string'
    && test.MODEL_MANIFEST.buildId.length >= 8
    && !/placeholder|unknown|todo/i.test(test.MODEL_MANIFEST.buildId),
  'model exposes a non-placeholder build identity', test.MODEL_MANIFEST.buildId);
check(test.MODEL_MANIFEST.anatomy.pelvicIncidenceTransformPolicy
    === 'authored_sacral_base_morphology_about_l5_s1_with_fixed_hip_axis'
    && test.MODEL_MANIFEST.anatomy.pelvicOrientationTransformDriver
      === 'pelvic_tilt_delta_about_bicoxofemoral_proxy_plus_independent_pi_morphology_delta'
    && test.MODEL_MANIFEST.anatomy.pelvicIncidencePatientSpecific === false
    && test.MODEL_MANIFEST.anatomy.atlasMorphologyPolicy
      === 'preserve_intact_ct_surface_for_degeneration_and_withhold_unsupported_component_shape_edits'
    && test.MODEL_MANIFEST.anatomy.cameraFramingPolicy
      === 'visible_anatomy_bounds_with_fov_aspect_and_margin',
  'manifest separates authored pelvic-incidence morphology from pelvic posture transforms');
check(Object.keys(test.DEFORMITY_PRESETS).length === 12
    && Object.values(test.DEFORMITY_PRESETS).every(preset => typeof preset.description === 'string'
      && preset.description.length > 20 && preset.alignment && preset.global && preset.levels),
  'deformity catalog exposes 12 described measurement-pattern presets');
const caseExampleIds = Object.keys(test.CASE_EXAMPLES);
const caseExampleSeeds = caseExampleIds.map(caseId => test.resolveCaseExampleSeed(caseId));
const demoCaseOptionValues = getElement('demoCaseSelect').options.map(option => option.value);
check(caseExampleIds.length === 20
    && new Set(caseExampleIds).size === 20
    && caseExampleSeeds.every(seed => test.validateCaseExampleSeed(seed))
    && caseExampleSeeds.every(seed => seed.example.featureTags.length > 0
      && seed.example.featureTags.every(tag => ['authored_display', 'context_only', 'unmodeled'].includes(tag.status))),
  '20 example pathology cases validate with explicit authored/context/unmodeled feature provenance');
check(demoCaseOptionValues.length === 20
    && caseExampleIds.every(caseId => demoCaseOptionValues.includes(caseId)),
  'example pathology selector exposes every versioned case exactly once');
check(document.querySelectorAll('input[name="imagingPath"]').length === 3
    && document.querySelector('input[name="imagingPath"]:checked')?.value === 'radiographs'
    && document.querySelectorAll('.imaging-coverage-input').length === 4
    && document.querySelectorAll('input[name="inspectionScope"]').length === 2,
  'fake DOM preserves patient-imaging and inspection radios, coverage inputs, and checked selectors');
check(test.PATIENT_IMAGING_MODEL.networkTransferEnabled === false
    && test.PATIENT_IMAGING_MODEL.persistenceEnabled === false
    && test.PATIENT_IMAGING_MODEL.representations.hybrid.recommended === true
    && test.PATIENT_IMAGING_MODEL.disabledUntilValidated.includes('patient_specific_mesh'),
  'patient-imaging model remains local, ephemeral, and fail-closed for patient geometry');
const cervicalReferenceBands = test.classifyCervicalModifiers({
  cervicalSva: 20, cbva: 5, t1Slope: 28, cervicalLordosis: 18
});
const cervicalMarkedBands = test.classifyCervicalModifiers({
  cervicalSva: 85, cbva: 30, t1Slope: 25, cervicalLordosis: -20
});
check(cervicalReferenceBands.cervicalSva === '0'
    && cervicalReferenceBands.cbva === '0'
    && cervicalReferenceBands.t1SlopeMinusCl === '0'
    && cervicalReferenceBands.mismatch === 10,
  'Ames-style reference modifier bands retain explicit measured inputs');
check(cervicalMarkedBands.cervicalSva === '2'
    && cervicalMarkedBands.cbva === '2'
    && cervicalMarkedBands.t1SlopeMinusCl === '2'
    && cervicalMarkedBands.mismatch === 45,
  'Ames-style marked bands preserve signed cervical kyphosis');
check(test.MODEL_MANIFEST.anatomy.geometryTier === 'source_coherent_ct_millimetre_external_surfaces_with_semantic_surgical_fallback',
  'model declares CT-reference plus semantic-fallback tier');

const implantCatalogs = harness.implantCatalogs;
const cageCatalogs = Object.values(implantCatalogs.cages);
const motionDeviceCatalogs = Object.values(implantCatalogs.motionDevices);
const screwCatalogs = Object.values(implantCatalogs.screws);
const graftCatalogs = Object.values(implantCatalogs.grafts);
const hasSource = entry => typeof entry.sourceUrl === 'string' && /^https:\/\//.test(entry.sourceUrl);
const cageSchemaPass = cageCatalogs.length > 0 && cageCatalogs.every(catalog =>
  catalog && typeof catalog.id === 'string' && typeof catalog.label === 'string'
  && typeof catalog.revision === 'string' && hasSource(catalog)
  && Array.isArray(catalog.footprints) && catalog.footprints.length > 0
  && catalog.footprints.every(size => Number.isFinite(size.ap) && size.ap > 0
    && Number.isFinite(size.ml) && size.ml > 0)
  && Array.isArray(catalog.heights) && catalog.heights.length > 0
  && catalog.heights.every(value => Number.isFinite(value) && value > 0)
  && Array.isArray(catalog.lordosis) && catalog.lordosis.length > 0
  && catalog.lordosis.every(value => Number.isFinite(value) && value >= 0));
const screwSchemaPass = screwCatalogs.length > 0 && screwCatalogs.every(catalog =>
  catalog && typeof catalog.id === 'string' && typeof catalog.label === 'string'
  && typeof catalog.revision === 'string' && hasSource(catalog)
  && Object.keys(catalog.diameterLengths).length > 0
  && Object.entries(catalog.diameterLengths).every(([diameter, lengths]) =>
    Number.isFinite(Number(diameter)) && Number(diameter) > 0
    && Array.isArray(lengths) && lengths.length > 0
    && lengths.every(value => Number.isFinite(value) && value > 0))
  && Array.isArray(catalog.rodDiameters)
  && catalog.rodDiameters.every(value => Number.isFinite(value) && value > 0)
  && Array.isArray(catalog.rodLengths)
  && catalog.rodLengths.every(value => Number.isFinite(value) && value > 0));
const motionDeviceSchemaPass = motionDeviceCatalogs.length > 0 && motionDeviceCatalogs.every(catalog =>
  catalog && typeof catalog.id === 'string' && typeof catalog.label === 'string'
  && typeof catalog.revision === 'string' && hasSource(catalog)
  && Array.isArray(catalog.ipdConfigurations) && catalog.ipdConfigurations.length > 0
  && catalog.ipdConfigurations.every(value =>
    Number.isFinite(value.ipdMm) && value.ipdMm > 0
      && Number.isFinite(value.armAngleDeg) && value.armAngleDeg >= 0)
  && Array.isArray(catalog.plateLengthConfigurations) && catalog.plateLengthConfigurations.length > 0
  && catalog.plateLengthConfigurations.every(value =>
    typeof value.id === 'string'
      && Number.isFinite(value.topPlateLengthMm) && value.topPlateLengthMm > 0
      && Number.isFinite(value.bottomPlateLengthMm) && value.bottomPlateLengthMm > 0));
const graftSchemaPass = graftCatalogs.length > 0 && graftCatalogs.every(catalog =>
  catalog && typeof catalog.id === 'string' && typeof catalog.label === 'string' && hasSource(catalog)
  && Array.isArray(catalog.volumesCc) && catalog.volumesCc.length > 0
  && catalog.volumesCc.every(value => Number.isFinite(value) && value > 0));
check(cageCatalogs.length === 6 && motionDeviceCatalogs.length === 1 && screwCatalogs.length === 6
    && cageSchemaPass && motionDeviceSchemaPass && screwSchemaPass && graftSchemaPass,
  'implant, motion-device, screw, and graft catalogs have sourced positive-dimension schemas');

const hedronA = implantCatalogs.cages.hedron_a;
const hedronL = implantCatalogs.cages.hedron_l;
const topsMotion = implantCatalogs.motionDevices.tops_motion;
const topsPedicle = implantCatalogs.screws.tops_pedicle;
const uCentum = implantCatalogs.screws.ucentum_pedicle;
check(hedronA.footprints.some(size => size.ap === 24 && size.ml === 35)
    && hedronA.heights.includes(11) && hedronA.lordosis.includes(15)
    && uCentum.diameterLengths['6.5'].includes(45)
    && uCentum.rodDiameters.includes(5.5) && uCentum.rodLengths.includes(60),
  'requested HEDRON A and uCentum size combinations exist exactly in the catalogs');
check(hedronL
    && hedronL.footprints.some(size => size.ap === 18 && size.ml === 40)
    && hedronL.footprints.some(size => size.ap === 22 && size.ml === 60)
    && hedronL.heights.join(',') === '7,9,11,13,15'
    && hedronL.lordosis.join(',') === '10,15'
    && hedronL.publishedLengthRangeMm.min === 40
    && hedronL.publishedLengthRangeMm.max === 60
    && hedronL.publishedLengthRangeMm.discreteIntermediateLengthsVerified === false,
  'HEDRON L retains only sourced widths, published length-range endpoints, heights, and lordosis values');
check(topsMotion.ipdConfigurations.map(value => `${value.ipdMm}/${value.armAngleDeg}`).join(',')
      === '21/0,30/14,38/26'
    && topsMotion.plateLengthConfigurations.map(value =>
      `${value.id}/${value.topPlateLengthMm}/${value.bottomPlateLengthMm}`).join(',')
      === 'S/67/73,M/77/83,L/87/93'
    && Object.keys(topsPedicle.diameterLengths).join(',') === '5.5,6.5,7.5'
    && Object.values(topsPedicle.diameterLengths).every(lengths =>
      lengths.join(',') === '25,30,35,40,45,50,55,60')
    && topsPedicle.rodDiameters.length === 0 && topsPedicle.rodLengths.length === 0,
  'TOPS catalog preserves the FDA-reference IPD, arm, plate, and screw options without inventing rods');

const defaultLayers = harness.layerState;
check(defaultLayers.ligaments === false && defaultLayers.siJoints === false
    && defaultLayers.measurements === false
    && [...segments.values()].every(record => record.ligaments.layer.visible === false)
    && test.getPelvicLigaments().visible === false && test.getSIJoints().visible === false
    && harness.measurementObjects.every(object => object && object.visible === false),
  'ligament, SI-joint, and measurement overlays are hidden by default');

const anatomyLayerKeys = ['skull', 'cervical', 'thoracic', 'lumbar', 'pelvis', 'lowerLimbs'];
check(anatomyLayerKeys.every(key => defaultLayers[key] === true)
    && [...segments.values()].every(record => record.regionVisibilityLayer?.visible === true)
    && test.getPelvisReferenceLayer().visible === true
    && test.getLowerExtremities().visible === true,
  'skull, spinal regions, pelvis, and lower limbs are visible by default');

const c0VisibilityRecord = segments.get('C0-C1');
const c1VisibilityRecord = segments.get('C1-C2');
const t6VisibilityRecord = segments.get('T6-T7');
const l3VisibilityRecord = segments.get('L3-L4');
harness.setLayers({ skull: false });
check(c0VisibilityRecord.regionVisibilityLayer.visible === false
    && c1VisibilityRecord.regionVisibilityLayer.visible === true,
  'skull visibility is independent from the cervical spine');
harness.setLayers({ skull: true, cervical: false });
check(c0VisibilityRecord.regionVisibilityLayer.visible === true
    && c1VisibilityRecord.regionVisibilityLayer.visible === false
    && t6VisibilityRecord.regionVisibilityLayer.visible === true,
  'cervical visibility does not disconnect or hide superior-independent regional records');
harness.setLayers({ cervical: true, thoracic: false, lumbar: false });
check(t6VisibilityRecord.regionVisibilityLayer.visible === false
    && l3VisibilityRecord.regionVisibilityLayer.visible === false
    && c1VisibilityRecord.regionVisibilityLayer.visible === true,
  'thoracic and lumbar regions can be hidden independently');
harness.setLayers({ thoracic: true, lumbar: true, pelvis: false, lowerLimbs: false });
check(test.getPelvisReferenceLayer().visible === false
    && harness.pelvisAnatomyLayer.visible === false
    && test.getLowerExtremities().visible === false
    && l3VisibilityRecord.regionVisibilityLayer.visible === true,
  'pelvis and lower-limb visibility are independent from the lumbar chain');
harness.setLayers({ pelvis: true, lowerLimbs: true });

const pelvisRoot = test.getPelvis();
const lowerExtremitiesRoot = test.getLowerExtremities();
const pelvicPivot = test.getPelvicPosturePivot().clone();
const sacralMorphologyRoot = test.getSacralMorphologyRoot();
const sacralReferenceSurface = test.getSacralReferenceSurface();
const leftHipReference = test.getPelvisReferenceLayer().getObjectByName('ctReferenceSurface:hip_left');
const rightHipReference = test.getPelvisReferenceLayer().getObjectByName('ctReferenceSurface:hip_right');
const relativeMatrixSnapshot = (inferior, superior) => new context.THREE.Matrix4()
  .multiplyMatrices(inferior.matrixWorld.clone().invert(), superior.matrixWorld)
  .toArray();
const piReferenceBefore = {
  pelvis: worldMatrixSnapshot(pelvisRoot),
  leftHip: worldMatrixSnapshot(leftHipReference),
  rightHip: worldMatrixSnapshot(rightHipReference),
  sacrum: worldMatrixSnapshot(sacralReferenceSurface),
  lumbar: worldMatrixSnapshot(l3VisibilityRecord.group),
  lowerLimbs: worldMatrixSnapshot(lowerExtremitiesRoot),
  sacrumToLumbar: relativeMatrixSnapshot(sacralReferenceSurface, l3VisibilityRecord.group),
  sacralPivotWorld: sacralMorphologyRoot.getWorldPosition(new context.THREE.Vector3()).toArray()
};
harness.setAlignmentParams({ pi: 61 });
const piMorphologyAfter = {
  pelvis: worldMatrixSnapshot(pelvisRoot),
  leftHip: worldMatrixSnapshot(leftHipReference),
  rightHip: worldMatrixSnapshot(rightHipReference),
  sacrum: worldMatrixSnapshot(sacralReferenceSurface),
  lumbar: worldMatrixSnapshot(l3VisibilityRecord.group),
  lowerLimbs: worldMatrixSnapshot(lowerExtremitiesRoot),
  sacrumToLumbar: relativeMatrixSnapshot(sacralReferenceSurface, l3VisibilityRecord.group),
  sacralPivotWorld: sacralMorphologyRoot.getWorldPosition(new context.THREE.Vector3()).toArray()
};
check(numericArraysNear(piReferenceBefore.pelvis, piMorphologyAfter.pelvis)
    && numericArraysNear(piReferenceBefore.leftHip, piMorphologyAfter.leftHip)
    && numericArraysNear(piReferenceBefore.rightHip, piMorphologyAfter.rightHip)
    && numericArraysNear(piReferenceBefore.lowerLimbs, piMorphologyAfter.lowerLimbs)
    && !numericArraysNear(piReferenceBefore.sacrum, piMorphologyAfter.sacrum)
    && !numericArraysNear(piReferenceBefore.lumbar, piMorphologyAfter.lumbar)
    && numericArraysNear(piReferenceBefore.sacrumToLumbar, piMorphologyAfter.sacrumToLumbar, 1e-8)
    && numericArraysNear(piReferenceBefore.sacralPivotWorld, piMorphologyAfter.sacralPivotWorld)
    && near(sacralMorphologyRoot.rotation.z, context.THREE.MathUtils.degToRad(9), 1e-10)
    && pelvisRoot.userData.pelvicIncidence === 61
    && pelvisRoot.userData.sacralSlope === 39
    && pelvisRoot.userData.pelvicIncidenceChangesRigidPose === false
    && pelvisRoot.userData.pelvicIncidenceChangesSacralBaseMorphology === true,
  'PI-only edits pivot the sacrum and spine together while the pelvic ring, hip axis, and lower limbs stay fixed',
  JSON.stringify({
    pelvisFixed: numericArraysNear(piReferenceBefore.pelvis, piMorphologyAfter.pelvis),
    leftHipFixed: numericArraysNear(piReferenceBefore.leftHip, piMorphologyAfter.leftHip),
    rightHipFixed: numericArraysNear(piReferenceBefore.rightHip, piMorphologyAfter.rightHip),
    lowerLimbsFixed: numericArraysNear(piReferenceBefore.lowerLimbs, piMorphologyAfter.lowerLimbs),
    sacrumChanged: !numericArraysNear(piReferenceBefore.sacrum, piMorphologyAfter.sacrum),
    lumbarChanged: !numericArraysNear(piReferenceBefore.lumbar, piMorphologyAfter.lumbar),
    sacrumToLumbarFixed: numericArraysNear(piReferenceBefore.sacrumToLumbar, piMorphologyAfter.sacrumToLumbar, 1e-8),
    morphologyRotationDeg: context.THREE.MathUtils.radToDeg(sacralMorphologyRoot.rotation.z),
    targets: pelvisRoot.userData
  }));
harness.setAlignmentParams({ pi: 52 });
check(numericArraysNear(piReferenceBefore.pelvis, worldMatrixSnapshot(pelvisRoot), 1e-9)
    && numericArraysNear(piReferenceBefore.sacrum, worldMatrixSnapshot(sacralReferenceSurface), 1e-8)
    && numericArraysNear(piReferenceBefore.lumbar, worldMatrixSnapshot(l3VisibilityRecord.group), 1e-8)
    && numericArraysNear(piReferenceBefore.leftHip, worldMatrixSnapshot(leftHipReference), 1e-9)
    && numericArraysNear(piReferenceBefore.rightHip, worldMatrixSnapshot(rightHipReference), 1e-9),
  'resetting PI exactly restores the reference sacrum, spine, and pelvic ring transforms');

const lowerLimbsBeforePt = worldMatrixSnapshot(lowerExtremitiesRoot);
harness.setAlignmentParams({ pt: 30 });
const expectedPtRotation = context.THREE.MathUtils.degToRad(
  test.MODEL_MANIFEST.anatomy.referencePoseCalibration.pt - 30
);
check(near(pelvisRoot.rotation.z, expectedPtRotation, 1e-10)
    && near(sacralMorphologyRoot.rotation.z, 0, 1e-10)
    && pelvisRoot.position.distanceTo(pelvicPivot) <= 1e-10
    && numericArraysNear(lowerLimbsBeforePt, worldMatrixSnapshot(lowerExtremitiesRoot))
    && lowerExtremitiesRoot.parent !== pelvisRoot
    && pelvisRoot.userData.posturePivot === 'bilateral femoral-head center proxy',
  'PT alone drives the hip-centered pelvic posture pivot while world-rooted lower limbs remain fixed',
  JSON.stringify({
    actualRotationDeg: context.THREE.MathUtils.radToDeg(pelvisRoot.rotation.z),
    expectedRotationDeg: context.THREE.MathUtils.radToDeg(expectedPtRotation),
    morphologyRotationDeg: context.THREE.MathUtils.radToDeg(sacralMorphologyRoot.rotation.z),
    pivotDistance: pelvisRoot.position.distanceTo(pelvicPivot),
    lowerLimbsFixed: numericArraysNear(lowerLimbsBeforePt, worldMatrixSnapshot(lowerExtremitiesRoot)),
    posturePivot: pelvisRoot.userData.posturePivot
  }));
harness.setAlignmentParams({ pt: 22 });

harness.setAlignmentParams({ pi: 61, pt: 30 });
const combinedSacralQuaternion = sacralReferenceSurface.getWorldQuaternion(new context.THREE.Quaternion());
const combinedSacralEuler = new context.THREE.Euler().setFromQuaternion(combinedSacralQuaternion, 'XYZ');
check(near(sacralMorphologyRoot.rotation.z, context.THREE.MathUtils.degToRad(9), 1e-10)
    && near(pelvisRoot.rotation.z, context.THREE.MathUtils.degToRad(-8), 1e-10)
    && near(context.THREE.MathUtils.radToDeg(combinedSacralEuler.z), 1, 1e-8)
    && pelvisRoot.userData.netSacralSlopeDeltaDeg === 1
    && test.derivePelvicKinematicTargets(61, 30).identityResidualDeg === 0,
  'PI and PT compose independently to produce the requested sacral-slope change',
  JSON.stringify({
    morphologyRotationDeg: context.THREE.MathUtils.radToDeg(sacralMorphologyRoot.rotation.z),
    postureRotationDeg: context.THREE.MathUtils.radToDeg(pelvisRoot.rotation.z),
    combinedSacralRotationDeg: context.THREE.MathUtils.radToDeg(combinedSacralEuler.z),
    netSacralSlopeDeltaDeg: pelvisRoot.userData.netSacralSlopeDeltaDeg
  }));
harness.setAlignmentParams({ pi: 30, pt: 22 });
harness.setAlignmentParams({ pi: 80, pt: 22 });
harness.setAlignmentParams({ pi: 52, pt: 22 });
check(worldMatrixSnapshot(sacralMorphologyRoot).every(Number.isFinite)
    && worldMatrixSnapshot(sacralReferenceSurface).every(Number.isFinite)
    && worldMatrixSnapshot(l3VisibilityRecord.group).every(Number.isFinite)
    && numericArraysNear(piReferenceBefore.sacrum, worldMatrixSnapshot(sacralReferenceSurface), 1e-8)
    && numericArraysNear(piReferenceBefore.lumbar, worldMatrixSnapshot(l3VisibilityRecord.group), 1e-8),
  'extreme PI scenarios remain finite and non-cumulative');

const camera = harness.camera;
const controls = harness.controls;
// Re-establish the current full-body framing policy before probing extrema;
// prior PI/layer assertions deliberately exercise fail-closed visibility and
// may leave the controls on the spine-only distance ceiling.
harness.resetCamera();
const initialZoomRangePass = camera.near <= .03 && camera.far >= 300
  && controls.minDistance <= .5 && controls.maxDistance >= 200
  && controls.zoomSpeed >= 1.1 && controls.zoomToCursor === true;
const closeDistance = harness.zoomBy(.00001);
const farDistance = harness.zoomBy(100000);
harness.resetCamera();
const resetDistance = camera.position.distanceTo(controls.target);
check(initialZoomRangePass
    && near(closeDistance, controls.minDistance, 1e-9)
    && near(farDistance, controls.maxDistance, 1e-9)
    && resetDistance > controls.minDistance * 10 && resetDistance < controls.maxDistance,
  'camera permits deep close-up and wide standing-context zoom with a stable reset',
  JSON.stringify({ near: camera.near, far: camera.far, min: controls.minDistance, max: controls.maxDistance, closeDistance, farDistance, resetDistance }));

const ligamentRecords = test.LEVELS.slice(1).map(level => segments.get(level.id));
const ligamentPathsFor = record => [
  record.ligaments.all, record.ligaments.pll,
  record.ligaments.flavum.left, record.ligaments.flavum.right,
  record.ligaments.intertransverse.left, record.ligaments.intertransverse.right,
  record.ligaments.interspinous, record.ligaments.supraspinous
];
const ligamentPathGroups = ligamentRecords.flatMap(ligamentPathsFor);
const ligamentGeometryIsBounded = ligamentPathGroups.every(pathway => {
  const continuous = pathway.children.find(child => child.userData?.pathwayRole === 'continuous_reference');
  if (!continuous?.geometry) return false;
  continuous.geometry.computeBoundingBox();
  const size = continuous.geometry.boundingBox.max.clone().sub(continuous.geometry.boundingBox.min);
  return Math.max(size.x, size.y, size.z) < 2
    && pathway.userData.radiusMm > 0 && pathway.userData.radiusMm <= .9;
});
check(ligamentPathGroups.length === 24 * 8 && ligamentGeometryIsBounded
    && ligamentRecords.every(record => record.ligaments.layer.name === 'referenceLigamentPathwayLayer'
      && /not anatomical solids/.test(record.ligaments.layer.userData.representation))
    && ligamentPathGroups.every(pathway => /not a segmented ligament/.test(pathway.userData.representation)),
  'spinal ligament display uses thin, bounded CT-envelope attachment/pathway proxies rather than oversized bars');

let sharedLigamentAnchorGapMm = 0;
for (let index = 1; index < ligamentRecords.length; index += 1) {
  const caudalPaths = ligamentPathsFor(ligamentRecords[index - 1]);
  const cranialPaths = ligamentPathsFor(ligamentRecords[index]);
  caudalPaths.forEach((pathway, pathwayIndex) => {
    const caudal = pathway.userData.caudalAnchorAppMm;
    const cranial = cranialPaths[pathwayIndex].userData.cranialAnchorAppMm;
    if (!caudal || !cranial) { sharedLigamentAnchorGapMm = Infinity; return; }
    const dx = caudal[0] - cranial[0];
    const dy = caudal[1] - cranial[1];
    const dz = caudal[2] - cranial[2];
    sharedLigamentAnchorGapMm = Math.max(sharedLigamentAnchorGapMm, (dx * dx + dy * dy + dz * dz) ** .5);
  });
}
check(sharedLigamentAnchorGapMm < 1e-9,
  'adjacent ligament spans share exact source-frame motion-pivot attachment proxies',
  'max gap mm=' + sharedLigamentAnchorGapMm);

const spineKeys = [...segments.values()].map(record => record.level.superior);
check(segments.size === 25 && new Set(spineKeys).size === 25,
  'scene has 25 unique C0-L5 segment reference records', spineKeys.join(','));

let spineVertices = 0;
let spineTriangles = 0;
let intactPolicyPasses = true;
let sourceTagsPass = true;
for (const record of segments.values()) {
  const surface = record.referenceLayer && record.referenceLayer.children[0];
  const entry = atlas.bones[record.level.superior];
  const counts = geometryCounts(surface && surface.geometry);
  spineVertices += counts.vertices;
  spineTriangles += counts.triangles;
  intactPolicyPasses &&= Boolean(
    surface && surface.geometry.getIndex() && counts.vertices > 0 && counts.triangles > 0
    && counts.vertices === entry.vertexCount && counts.triangles === entry.triangleCount
    && record.referenceLayer.visible && record.geometryMode === 'ct_reference'
    && !record.body.visible && !record.endplates.visible && !record.posteriorElement.visible
  );
  sourceTagsPass &&= Boolean(
    surface && surface.userData.geometryTier === 'ct_derived_reference_surface'
    && surface.userData.sourceDataset === 'TotalSegmentator v2'
    && surface.userData.sourceSubject === 's1369'
    && surface.userData.sourceLicense === 'CC BY 4.0'
    && /^[0-9a-f]{64}$/i.test(surface.userData.sourceSha256)
    && surface.userData.levelId === record.level.id
    && surface.userData.screwPlanningValidated === false
  );
}
check(intactPolicyPasses, 'all 25 intact CT levels have nonempty indexed geometry and hide procedural bone');
check(sourceTagsPass, 'all 25 reference surfaces retain source, subject, license, hash, and safety tags');
check(spineVertices === 49163 && spineTriangles === 98500,
  '25-level spine subset matches expected atlas totals',
  'vertices=' + spineVertices + ', triangles=' + spineTriangles);

let decodedVertices = 0;
let decodedTriangles = 0;
let allPayloadsDecode = true;
for (const boneKey of Object.keys(atlas.bones)) {
  const geometry = harness.decode(boneKey);
  const counts = geometryCounts(geometry);
  decodedVertices += counts.vertices;
  decodedTriangles += counts.triangles;
  allPayloadsDecode &&= Boolean(geometry && geometry.getIndex() && counts.vertices > 0 && counts.triangles > 0);
}
const diagnostics = test.getReferenceAtlasDiagnostics();
check(allPayloadsDecode && Object.keys(diagnostics.failures).length === 0,
  'all 31 atlas payloads decode with no diagnostic failures', JSON.stringify(diagnostics.failures));
check(decodedVertices === 67819 && decodedTriangles === 135997
    && manifest.totals.vertices === decodedVertices && manifest.totals.triangles === decodedTriangles,
  'decoded atlas totals match the embedded manifest',
  'vertices=' + decodedVertices + ', triangles=' + decodedTriangles);
check(diagnostics.decoded.length === 31 && diagnostics.cacheSize === 31,
  'diagnostics account for all 31 decoded structures', JSON.stringify(diagnostics));
check(manifest.source.dataset === 'TotalSegmentator v2'
    && manifest.source.subject === 's1369' && manifest.source.license === 'CC BY 4.0',
  'atlas manifest source tags are complete');

const ctSpineOrder = [
  'C0', ...Array.from({ length: 7 }, (_, index) => `C${index + 1}`),
  ...Array.from({ length: 12 }, (_, index) => `T${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `L${index + 1}`)
];
const coherentCtKeys = [...ctSpineOrder, 'sacrum', 'hip_left', 'hip_right'];
const ctSurfaceByKey = new Map();
for (const record of segments.values()) {
  const surface = record.referenceLayer && record.referenceLayer.children[0];
  if (surface) ctSurfaceByKey.set(record.level.superior, surface);
}
const coherentPelvisReference = test.getPelvisReferenceLayer();
for (const surface of coherentPelvisReference.children) {
  const boneKey = surface.name.startsWith('ctReferenceSurface:')
    ? surface.name.slice('ctReferenceSurface:'.length)
    : surface.userData.boneKey;
  if (boneKey) ctSurfaceByKey.set(boneKey, surface);
}
test.getScene().updateMatrixWorld(true);
check(coherentCtKeys.length === 28 && ctSurfaceByKey.size >= 28
    && coherentCtKeys.every(key => ctSurfaceByKey.has(key)),
  'scene exposes all 28 coherent CT skull, spine, sacrum, and hip surfaces',
  JSON.stringify([...ctSurfaceByKey.keys()]));

const commonCtMatrix = ctSurfaceByKey.get('sacrum').matrixWorld.clone();
const commonCtInverse = commonCtMatrix.clone().invert();
const commonElements = commonCtMatrix.elements;
const commonAxisX = new context.THREE.Vector3(commonElements[0], commonElements[1], commonElements[2]);
const commonAxisY = new context.THREE.Vector3(commonElements[4], commonElements[5], commonElements[6]);
const commonAxisZ = new context.THREE.Vector3(commonElements[8], commonElements[9], commonElements[10]);
const vectorNearMm = (actual, expected, epsilon = 1e-9) =>
  near(actual.x, expected.x, epsilon)
  && near(actual.y, expected.y, epsilon)
  && near(actual.z, expected.z, epsilon);
const commonCtScale = (commonAxisX.length() + commonAxisY.length() + commonAxisZ.length()) / 3;
const commonSimilarityPass = Number.isFinite(commonCtScale) && commonCtScale > 0
  && near(commonAxisX.length(), commonCtScale, 1e-12)
  && near(commonAxisY.length(), commonCtScale, 1e-12)
  && near(commonAxisZ.length(), commonCtScale, 1e-12)
  && Math.abs(commonAxisX.dot(commonAxisY)) < 1e-12
  && Math.abs(commonAxisX.dot(commonAxisZ)) < 1e-12
  && Math.abs(commonAxisY.dot(commonAxisZ)) < 1e-12
  && commonCtMatrix.determinant() > 0;
check(commonSimilarityPass,
  'common CT baseline transform is a right-handed rigid transform plus one uniform scale',
  `scale=${commonCtScale}, determinant=${commonCtMatrix.determinant()}`);

const identityMatrix = new context.THREE.Matrix4();
let maxCtMatrixDelta = 0;
let maxCtScaleDelta = 0;
let sharedCtMatrixPass = true;
for (const boneKey of coherentCtKeys) {
  const surface = ctSurfaceByKey.get(boneKey);
  if (!surface) {
    sharedCtMatrixPass = false;
    continue;
  }
  const relative = new context.THREE.Matrix4().multiplyMatrices(commonCtInverse, surface.matrixWorld);
  for (let index = 0; index < 16; index += 1) {
    maxCtMatrixDelta = Math.max(maxCtMatrixDelta,
      Math.abs(relative.elements[index] - identityMatrix.elements[index]));
  }
  const worldScale = surface.getWorldScale(new context.THREE.Vector3());
  maxCtScaleDelta = Math.max(maxCtScaleDelta,
    Math.abs(worldScale.x - commonCtScale),
    Math.abs(worldScale.y - commonCtScale),
    Math.abs(worldScale.z - commonCtScale));
  sharedCtMatrixPass &&= maxCtMatrixDelta < 1e-9 && maxCtScaleDelta < 1e-12;
}
check(sharedCtMatrixPass,
  'all 28 CT surfaces share one baseline matrix and one display scale',
  `matrix delta=${maxCtMatrixDelta}, scale delta=${maxCtScaleDelta}`);

let maxRecoveredAtlasErrorMm = 0;
const recoveredAtlasBounds = keys => {
  const bounds = new context.THREE.Box3().makeEmpty();
  const sourcePoint = new context.THREE.Vector3();
  const recoveredPoint = new context.THREE.Vector3();
  for (const key of keys) {
    const surface = ctSurfaceByKey.get(key);
    const positions = surface.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      sourcePoint.fromBufferAttribute(positions, index);
      recoveredPoint.copy(sourcePoint)
        .applyMatrix4(surface.matrixWorld)
        .applyMatrix4(commonCtInverse);
      maxRecoveredAtlasErrorMm = Math.max(maxRecoveredAtlasErrorMm,
        recoveredPoint.distanceTo(sourcePoint));
      bounds.expandByPoint(recoveredPoint);
    }
  }
  return bounds;
};
const recoveredSkullBounds = recoveredAtlasBounds(['C0']);
const recoveredSacrumBounds = recoveredAtlasBounds(['sacrum']);
const recoveredPelvisBounds = recoveredAtlasBounds(['sacrum', 'hip_left', 'hip_right']);
check(maxRecoveredAtlasErrorMm < 0.001,
  'baseline world geometry reconstructs the source atlas coordinates through one inverse transform',
  `maximum recovered error=${maxRecoveredAtlasErrorMm} mm`);

const recoveredSkullSize = recoveredSkullBounds.getSize(new context.THREE.Vector3());
const recoveredSacrumSize = recoveredSacrumBounds.getSize(new context.THREE.Vector3());
const recoveredPelvisSize = recoveredPelvisBounds.getSize(new context.THREE.Vector3());
const sourceDimensionPass = vectorNearMm(recoveredSkullSize,
  new context.THREE.Vector3(172.07644, 222.53942, 153.55558), .01)
  && vectorNearMm(recoveredSacrumSize,
    new context.THREE.Vector3(102.63176, 137.75224, 124.84802), .01)
  && vectorNearMm(recoveredPelvisSize,
    new context.THREE.Vector3(160.50388, 168.88640, 304.83196), .01);
check(sourceDimensionPass,
  'recovered skull, sacrum, and pelvis dimensions match the s1369 source atlas',
  JSON.stringify({
    skull: recoveredSkullSize.toArray(),
    sacrum: recoveredSacrumSize.toArray(),
    pelvis: recoveredPelvisSize.toArray()
  }));

const recoveredPelvisSkullRatio = recoveredPelvisSize.clone().divide(recoveredSkullSize);
const recoveredSacrumSkullRatio = recoveredSacrumSize.clone().divide(recoveredSkullSize);
check(vectorNearMm(recoveredPelvisSkullRatio,
    new context.THREE.Vector3(.93274756, .75890555, 1.98515717), 1e-5)
    && vectorNearMm(recoveredSacrumSkullRatio,
      new context.THREE.Vector3(.59643121, .61900152, .81304776), 1e-5),
  'rendered pelvis/skull and sacrum/skull proportions match the source subject',
  JSON.stringify({
    pelvisSkull: recoveredPelvisSkullRatio.toArray(),
    sacrumSkull: recoveredSacrumSkullRatio.toArray()
  }));

const sourceRelativeCentroidPairs = [...ctSpineOrder, 'sacrum'];
let maxCentroidSpacingErrorMm = 0;
const centroidSpacingDetails = [];
for (let index = 0; index < sourceRelativeCentroidPairs.length - 1; index += 1) {
  const superiorKey = sourceRelativeCentroidPairs[index];
  const inferiorKey = sourceRelativeCentroidPairs[index + 1];
  const superiorSurface = ctSurfaceByKey.get(superiorKey);
  const inferiorSurface = ctSurfaceByKey.get(inferiorKey);
  if (!superiorSurface || !inferiorSurface) {
    maxCentroidSpacingErrorMm = Infinity;
    centroidSpacingDetails.push({ pair: `${superiorKey}-${inferiorKey}`, error: 'missing CT surface' });
    continue;
  }
  const superiorSource = superiorSurface.geometry.boundingBox.getCenter(new context.THREE.Vector3());
  const inferiorSource = inferiorSurface.geometry.boundingBox.getCenter(new context.THREE.Vector3());
  const sourceDistanceMm = superiorSource.distanceTo(inferiorSource);
  const worldDistanceMm = superiorSource.clone().applyMatrix4(superiorSurface.matrixWorld)
    .distanceTo(inferiorSource.clone().applyMatrix4(inferiorSurface.matrixWorld)) / commonCtScale;
  const errorMm = Math.abs(worldDistanceMm - sourceDistanceMm);
  maxCentroidSpacingErrorMm = Math.max(maxCentroidSpacingErrorMm, errorMm);
  if (errorMm >= .01) centroidSpacingDetails.push({
    pair: `${superiorKey}-${inferiorKey}`, sourceDistanceMm, worldDistanceMm, errorMm
  });
}
check(maxCentroidSpacingErrorMm < .01,
  'C0 through L5 and sacrum preserve every source-relative centroid spacing',
  JSON.stringify(centroidSpacingDetails));

const craniovertebralLevels = ['C0-C1', 'C1-C2'];
const noCraniovertebralDiscPass = craniovertebralLevels.every(levelId => {
  const joint = segments.get(levelId)?.disc;
  const names = objectNames(joint);
  const pads = [];
  joint?.traverse(object => { if (object.isMesh) pads.push(object); });
  return joint && joint.userData.intervertebralDisc === false
    && joint.name.includes('noIntervertebralDisc')
    && !names.some(name => name.startsWith('disc:'))
    && pads.length === 2
    && pads.every(pad => pad.userData.intervertebralDisc === false);
});
check(noCraniovertebralDiscPass,
  'C0-C1 and C1-C2 contain paired synovial joint pads and no intervertebral discs');

const morphometricDiscRecords = [...segments.values()].filter(
  record => !craniovertebralLevels.includes(record.level.id)
);
const discMorphometrySignatures = new Set();
let levelSpecificDiscMetadataPass = morphometricDiscRecords.length === 23;
const discContainmentMetadataFailures = [];
let containedDiscCount = 0;
const withheldDiscLevels = [];
for (const record of morphometricDiscRecords) {
  const disc = record.disc;
  const morphometry = disc?.userData?.morphometryMm;
  const rendered = disc?.userData?.renderedFootprintMm;
  const dimensions = morphometry && ['anterior', 'middle', 'posterior', 'ap', 'lr']
    .map(key => Number(morphometry[key]));
  const containedPass = Boolean(
    disc?.isMesh
    && disc.name === 'disc:ct-endplate-contained-ray-loft'
    && disc.userData.levelId === record.level.id
    && disc.userData.sourceRelativeCenterPreserved === false
    && disc.userData.sourceMotionSegmentFramePreserved === true
    && disc.userData.sourceSubjectDiscSegmentation === false
    && disc.userData.containmentAssessed === true
    && disc.userData.endplateConstraintMethod.includes('convex intersection')
    && Number.isFinite(rendered?.ap) && rendered.ap > 0 && rendered.ap <= morphometry.ap
    && Number.isFinite(rendered?.ml) && rendered.ml > 0 && rendered.ml <= morphometry.lr
    && Number.isFinite(disc.userData.maxOutsideEndplateMm) && disc.userData.maxOutsideEndplateMm <= .01
    && Number.isFinite(disc.userData.minSurfaceClearanceMm) && disc.userData.minSurfaceClearanceMm >= -.001
    && disc.userData.jointTransformAssessed === true
    && disc.userData.jointTransformMode.includes('adjacent endplates')
  );
  const withheldPass = Boolean(
    disc?.isGroup
    && disc.name === 'disc:withheld-no-contained-source-fit'
    && disc.userData.levelId === record.level.id
    && disc.userData.geometryWithheld === true
    && disc.userData.containmentAssessed === false
    && typeof disc.userData.withheldReason === 'string'
    && disc.userData.withheldReason.length > 30
  );
  const recordPass = Boolean(
    dimensions?.every(value => Number.isFinite(value) && value > 0 && value < 100)
    && (containedPass || withheldPass)
  );
  if (containedPass) containedDiscCount += 1;
  if (withheldPass) withheldDiscLevels.push(record.level.id);
  levelSpecificDiscMetadataPass &&= recordPass;
  if (!recordPass) discContainmentMetadataFailures.push({
    levelId: record.level.id,
    name: disc?.name,
    isMesh: Boolean(disc?.isMesh),
    withheldReason: disc?.userData?.withheldReason,
    rendered,
    maxOutsideEndplateMm: disc?.userData?.maxOutsideEndplateMm,
    minSurfaceClearanceMm: disc?.userData?.minSurfaceClearanceMm
  });
  if (dimensions) discMorphometrySignatures.add(dimensions.join('|'));
}
const l1DiscMorphometry = segments.get('L1-L2')?.disc?.userData?.morphometryMm;
const l4DiscMorphometry = segments.get('L4-L5')?.disc?.userData?.morphometryMm;
levelSpecificDiscMetadataPass &&= discMorphometrySignatures.size === morphometricDiscRecords.length
  && containedDiscCount === 22
  && withheldDiscLevels.length === 1 && withheldDiscLevels[0] === 'C5-C6'
  && near(l1DiscMorphometry?.anterior, 5.68) && near(l1DiscMorphometry?.middle, 6.61)
  && near(l4DiscMorphometry?.anterior, 9.27) && near(l4DiscMorphometry?.middle, 9.31);
check(levelSpecificDiscMetadataPass,
  '22 discs use CT-endplate-contained ray lofts and C5-C6 explicitly fails closed while all 23 retain unique morphometry priors',
  JSON.stringify({ records: morphometricDiscRecords.length, containedDiscCount, withheldDiscLevels, signatures: discMorphometrySignatures.size, failures: discContainmentMetadataFailures }));

// Independently reconstruct each adjacent CT body footprint and test the actual
// rendered vertices against both endplate-proxy hulls. This intentionally does
// not consume the production constraint polygon or its reported outside value.
const independentMedian = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const lower = Math.floor(middle);
  const upper = Math.ceil(middle);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (middle - lower);
};
const independentCross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const independentHull = points => {
  const sorted = points.map(point => ({ x: point.x, z: point.z }))
    .sort((a, b) => a.x - b.x || a.z - b.z)
    .filter((point, index, list) => index === 0
      || Math.abs(point.x - list[index - 1].x) > 1e-6
      || Math.abs(point.z - list[index - 1].z) > 1e-6);
  if (sorted.length < 3) return [];
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && independentCross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-7) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && independentCross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-7) upper.pop();
    upper.push(point);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
};
const independentQuantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  const cursor = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lower = Math.floor(cursor);
  const upper = Math.ceil(cursor);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (cursor - lower);
};
const independentCentralBody = boneKey => {
  const geometry = harness.decode(boneKey);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const size = bounds.getSize(new context.THREE.Vector3());
  const position = geometry.getAttribute('position');
  const points = [];
  for (let index = 0; index < position.count; index += 1) {
    const point = new context.THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
    const ap = (point.x - bounds.min.x) / size.x;
    const ml = (point.z - bounds.min.z) / size.z;
    if (ap >= .02 && ap <= .43 && ml >= .17 && ml <= .83) points.push(point);
  }
  return points;
};
const maximumOutsideHullMm = (point, hull) => {
  let outside = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const start = hull[index];
    const end = hull[(index + 1) % hull.length];
    const edgeLength = Math.hypot(end.x - start.x, end.z - start.z) || 1;
    outside = Math.max(outside, -independentCross(start, end, point) / edgeLength);
  }
  return outside;
};
const independentDiscContainmentFailures = [];
let independentlyAuditedDiscs = 0;
for (const record of morphometricDiscRecords) {
  const disc = record.disc;
  if (!disc?.isMesh) continue;
  const superiorPoints = independentCentralBody(record.level.superior);
  const inferiorPoints = independentCentralBody(record.level.inferior);
  if (superiorPoints.length < 20 || inferiorPoints.length < 20) {
    independentDiscContainmentFailures.push({ levelId: record.level.id, reason: 'insufficient central-body samples' });
    continue;
  }
  const superiorMedian = new context.THREE.Vector3(
    independentMedian(superiorPoints.map(point => point.x)),
    independentMedian(superiorPoints.map(point => point.y)),
    independentMedian(superiorPoints.map(point => point.z))
  );
  const inferiorMedian = new context.THREE.Vector3(
    independentMedian(inferiorPoints.map(point => point.x)),
    independentMedian(inferiorPoints.map(point => point.y)),
    independentMedian(inferiorPoints.map(point => point.z))
  );
  const cranial = superiorMedian.clone().sub(inferiorMedian).normalize();
  const posterior = new context.THREE.Vector3(1, 0, 0).addScaledVector(cranial, -cranial.x).normalize();
  const patientLeft = posterior.clone().cross(cranial).normalize();
  const project = point => ({
    x: point.dot(posterior), y: point.dot(cranial), z: point.dot(patientLeft)
  });
  const superiorProjected = superiorPoints.map(project);
  const inferiorProjected = inferiorPoints.map(project);
  const superiorThreshold = independentQuantile(superiorProjected.map(point => point.y), .25);
  const inferiorThreshold = independentQuantile(inferiorProjected.map(point => point.y), .75);
  const superiorHull = independentHull(superiorProjected.filter(point => point.y <= superiorThreshold));
  const inferiorHull = independentHull(inferiorProjected.filter(point => point.y >= inferiorThreshold));
  disc.updateMatrix();
  const sourceAnchor = new context.THREE.Vector3().fromArray(record.group.userData.sourceAnchorAppMm);
  const position = disc.geometry.getAttribute('position');
  let maximumOutsideMm = 0;
  let finite = superiorHull.length >= 3 && inferiorHull.length >= 3;
  for (let index = 0; index < position.count && finite; index += 1) {
    const sourcePoint = new context.THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index))
      .applyMatrix4(disc.matrix)
      .divideScalar(test.REFERENCE_MM_TO_SCENE)
      .add(sourceAnchor);
    const projected = project(sourcePoint);
    maximumOutsideMm = Math.max(
      maximumOutsideMm,
      maximumOutsideHullMm(projected, superiorHull),
      maximumOutsideHullMm(projected, inferiorHull)
    );
    finite &&= sourcePoint.toArray().every(Number.isFinite) && Number.isFinite(maximumOutsideMm);
  }
  independentlyAuditedDiscs += 1;
  if (!finite || maximumOutsideMm > .30) {
    independentDiscContainmentFailures.push({ levelId: record.level.id, finite, maximumOutsideMm });
  }
}
check(independentlyAuditedDiscs === 22 && independentDiscContainmentFailures.length === 0,
  'actual vertices of all 22 rendered discs independently remain inside both adjacent CT endplate-proxy hulls within 0.30 mm',
  JSON.stringify({ independentlyAuditedDiscs, failures: independentDiscContainmentFailures }));

const lowerAtlas = test.LOWER_LIMB_ATLAS_DATA;
const lowerManifest = lowerAtlas.manifest;
let lowerVertices = 0;
let lowerTriangles = 0;
let lowerSourceTagsPass = true;
let allLowerPayloadsDecode = true;
for (const boneKey of Object.keys(lowerAtlas.bones)) {
  const geometry = harness.decodeLower(boneKey);
  const counts = geometryCounts(geometry);
  lowerVertices += counts.vertices;
  lowerTriangles += counts.triangles;
  allLowerPayloadsDecode &&= Boolean(
    geometry && geometry.getIndex() && counts.vertices > 0 && counts.triangles > 0
  );
  lowerSourceTagsPass &&= Boolean(
    geometry && geometry.userData.geometryTier === 'bodyparts3d_reference_surface'
    && geometry.userData.boneKey === boneKey
    && geometry.userData.sourceDataset === 'BodyParts3D version 4.0, PART-OF tree'
    && String(geometry.userData.sourceLicense).includes('CC BY 4.0')
    && /^[0-9a-f]{64}$/i.test(geometry.userData.sourceSha256)
  );
}
const lowerDiagnostics = test.getLowerLimbAtlasDiagnostics();
check(Object.keys(lowerAtlas.bones).length === 32
    && lowerManifest.coverage.objectCount === 32 && lowerManifest.coverage.complete === true,
  'BodyParts3D manifest declares 32 complete lower-limb objects');
check(allLowerPayloadsDecode && Object.keys(lowerDiagnostics.failures).length === 0
    && lowerDiagnostics.decoded.length === 32 && lowerDiagnostics.cacheSize === 32,
  'all 32 BodyParts3D objects decode with zero failures', JSON.stringify(lowerDiagnostics));
check(lowerVertices === 18836 && lowerTriangles === 33644
    && lowerManifest.totals.vertices === lowerVertices
    && lowerManifest.totals.triangles === lowerTriangles,
  'BodyParts3D decoded totals match 18,836 vertices / 33,644 triangles',
  'vertices=' + lowerVertices + ', triangles=' + lowerTriangles);
check(lowerSourceTagsPass, 'all BodyParts3D geometries retain source, license, and hash tags');

const lowerContext = test.getLowerExtremities();
const vectorNear = (actual, expected, epsilon = 1e-9) =>
  near(actual.x, expected.x, epsilon)
  && near(actual.y, expected.y, epsilon)
  && near(actual.z, expected.z, epsilon);
const sideAssemblies = {};
let lowerLayerCompositionPass = lowerContext.userData.geometryMode === 'bodyparts3d_bilateral_reference'
  && lowerDiagnostics.geometryMode === 'bodyparts3d_bilateral_reference'
  && lowerContext.children.length === 2;
let lowerUniformScalePass = true;
let proceduralHiddenPass = true;
let anchorOffsetsPass = true;
const anchorOffsetDetails = [];
let coordinateSignsPass = true;
const bilateralFemurLengths = ['left', 'right'].map(side => {
  const anchors = lowerManifest.anchors[side];
  return new context.THREE.Vector3().fromArray(anchors.hip)
    .distanceTo(new context.THREE.Vector3().fromArray(anchors.knee));
});
const expectedBilateralScale = 5.68
  / ((bilateralFemurLengths[0] + bilateralFemurLengths[1]) * 0.5);
for (const side of ['right', 'left']) {
  const hipPivot = lowerContext.children.find(child => child.name === 'hipPivot:' + side);
  const kneePivot = hipPivot && hipPivot.children.find(child => child.name === 'kneePivot:' + side);
  const anklePivot = kneePivot && kneePivot.children.find(child => child.name === 'anklePivot:' + side);
  const femurLayer = hipPivot && hipPivot.children.find(child => child.name === 'bodyPartsFemur:' + side);
  const lowerLegLayer = kneePivot && kneePivot.children.find(child => child.name === 'bodyPartsLowerLeg:' + side);
  const footLayer = anklePivot && anklePivot.children.find(child => child.name === 'bodyPartsFoot:' + side);
  sideAssemblies[side] = { hipPivot, kneePivot, anklePivot, femurLayer, lowerLegLayer, footLayer };
  lowerLayerCompositionPass &&= Boolean(
    hipPivot && kneePivot && anklePivot && femurLayer && lowerLegLayer && footLayer
    && hipPivot.userData.lowerLimbGeometryMode === 'bodyparts3d_reference'
    && femurLayer.children.length === 1
    && lowerLegLayer.children.length === 3
    && footLayer.children.length === 12
  );

  const scale = hipPivot && hipPivot.userData.referenceScale;
  const layers = [femurLayer, lowerLegLayer, footLayer];
  lowerUniformScalePass &&= Boolean(
    Number.isFinite(scale) && scale > 0
    && layers.every(layer => layer
      && near(layer.scale.x, scale) && near(layer.scale.y, scale) && near(layer.scale.z, scale)
      && layer.children.every(surface => near(surface.scale.x, 1)
        && near(surface.scale.y, 1) && near(surface.scale.z, 1)))
  );

  const procedural = [];
  if (hipPivot) {
    hipPivot.traverse(object => {
      if (/^(femoralNeck|femoralShaft|greaterTrochanter|femoralCondyle|patella|tibialShaft|fibularShaft|talus|footReference):/.test(object.name)) {
        procedural.push(object);
      }
    });
  }
  proceduralHiddenPass &&= procedural.length === 10 && procedural.every(object => object.visible === false);

  const anchors = lowerManifest.anchors[side];
  const hip = new context.THREE.Vector3().fromArray(anchors.hip);
  const knee = new context.THREE.Vector3().fromArray(anchors.knee);
  const ankle = new context.THREE.Vector3().fromArray(anchors.ankle);
  const expectedScale = expectedBilateralScale;
  const expectedKneeOffset = knee.clone().sub(hip).multiplyScalar(expectedScale);
  const expectedAnkleOffset = ankle.clone().sub(knee).multiplyScalar(expectedScale);
  anchorOffsetsPass &&= Boolean(
    near(scale, expectedScale, 1e-12)
    && vectorNear(kneePivot.position, expectedKneeOffset, 1e-9)
    && vectorNear(anklePivot.position, expectedAnkleOffset, 1e-9)
  );
  anchorOffsetDetails.push({
    side,
    scale,
    expectedScale,
    kneeActual: kneePivot.position.toArray(),
    kneeExpected: expectedKneeOffset.toArray(),
    ankleActual: anklePivot.position.toArray(),
    ankleExpected: expectedAnkleOffset.toArray()
  });

  const sideSign = side === 'left' ? 1 : -1;
  coordinateSignsPass &&= Math.sign(anchors.hip[2]) === sideSign
    && Math.sign(anchors.knee[2]) === sideSign
    && Math.sign(anchors.ankle[2]) === sideSign
    && Math.sign(anchors.foot[2]) === sideSign
    && anchors.foot[0] < anchors.ankle[0]
    && Math.sign(expectedKneeOffset.z) === -sideSign
    && Math.sign(expectedAnkleOffset.z) === -sideSign
    && Math.sign(hipPivot.position.z) === sideSign;
}
check(lowerLayerCompositionPass,
  'bilateral context has 1 femur, 3 lower-leg, and 12 foot reference meshes per side');
check(lowerUniformScalePass, 'each side uses one uniform scale across all reference layers');
check(proceduralHiddenPass, 'procedural lower-limb bones are hidden behind complete reference layers');
check(anchorOffsetsPass, 'knee and ankle pivot offsets exactly derive from manifest anchors',
  JSON.stringify(anchorOffsetDetails));
check(coordinateSignsPass, 'lower-limb anchors preserve left/right and anterior coordinate signs');

test.setGlobalDeformity({
  hipFlexion: 20, kneeFlexion: 30, ankleFlexion: 10, lowerExtremitiesVisible: true
});
let lowerRotationsPass = lowerContext.visible;
for (const side of ['right', 'left']) {
  const assembly = sideAssemblies[side];
  lowerRotationsPass &&= near(assembly.hipPivot.rotation.z, -20 * Math.PI / 180)
    && near(assembly.kneePivot.rotation.z, 30 * Math.PI / 180)
    && near(assembly.anklePivot.rotation.z, 10 * Math.PI / 180);
}
check(lowerRotationsPass, 'global lower-limb posture factors still animate all bilateral pivots');

const lowerSource = lowerManifest.source;
const visibleDocument = html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '');
check(test.MODEL_MANIFEST.anatomy.appStoreLegalReviewRequired === true
    && lowerContext.userData.legalReviewRequired === true
    && lowerSource.distributionLegalReview.requiredBeforeAppStoreOrPlayStoreDistribution === true,
  'lower-limb legal-review gate is asserted for store distribution');
check(typeof lowerSource.requiredAttribution === 'string'
    && lowerSource.requiredAttribution.includes('BodyParts3D')
    && visibleDocument.includes(lowerSource.requiredAttribution)
    && visibleDocument.includes('App Store or Play Store distribution'),
  'required BodyParts3D attribution and store-review notice are present in visible documentation',
  lowerSource.requiredAttribution);

const raycastCandidates = harness.captureRaycastCandidates();
check(raycastCandidates.length === 25
    && raycastCandidates.every(object => object.name.startsWith('ctReferenceSurface:')
      && object.userData.levelId && object.geometry.getIndex()),
  'inspection raycast candidates include all visible CT reference surfaces',
  'candidate count=' + raycastCandidates.length);

const initialInspectionState = test.getState().inspection;
check(initialInspectionState.levelId === 'L4-L5'
    && initialInspectionState.scope === 'level'
    && initialInspectionState.active === false,
  'focused inspection defaults to a lumbar level without entering isolation');
getElement('levelSelect').value = 'L3-L4';
getElement('openAnatomyLab').click();
const syncedInspectionState = test.getState().inspection;
check(syncedInspectionState.levelId === 'L3-L4'
    && getElement('anatomyLevelSelect').value === 'L3-L4'
    && getElement('anatomyLabDialog').open === true,
  'opening Anatomy Lab synchronizes focused inspection to the current lumbar surgical target');
getElement('closeAnatomyLab').click();

const l4 = segments.get('L4-L5');
test.setInspectionSelection('L4-L5', 'body', 0);
const l4InspectionBounds = test.getInspectionBounds('L4-L5');
check(l4.geometryMode === 'ct_reference' && l4.referenceLayer.visible
    && !l4.body.visible && !l4.posteriorElement.visible,
  'non-exploded inspection retains intact CT reference geometry');
check([...segments.values()].every(record => record.highlight.visible === false)
    && recordVisualRoots(segments.get('C0-C1')).every(root => root.visible === false)
    && l4InspectionBounds && !l4InspectionBounds.isEmpty()
    && l4InspectionBounds.containsPoint(controls.target),
  'lumbar inspection hides every nominal level highlight and unrelated skull anatomy while framing selected geometry');
check(controls.minDistance <= .2 && controls.maxDistance >= 75,
  'focused inspection retains deep close-up zoom without clipping');
check(lowerContext.visible === false, 'focused inspection hides bilateral lower-limb reference context');
test.exitInspectionMode();
check(lowerContext.visible === true
    && lowerContext.userData.geometryMode === 'bodyparts3d_bilateral_reference',
  'inspection exit restores bilateral lower-limb reference context');
harness.setLayers({ lumbar: false });
test.setInspectionSelection('L4-L5', 'body', 0);
check(l4.regionVisibilityLayer.visible === true
    && segments.get('L3-L4').regionVisibilityLayer.visible === false,
  'focused inspection temporarily reveals its selected level inside a hidden region');
test.exitInspectionMode();
check(l4.regionVisibilityLayer.visible === false,
  'inspection exit restores the user-selected regional visibility');
harness.setLayers({ lumbar: true });
const pedicleBase = l4.anatomy.pedicles.left.position.clone();
test.setInspectionSelection('L4-L5', 'body', 0.7);
check(l4.geometryMode === 'semantic_exploded_fallback' && !l4.referenceLayer.visible
    && l4.body.visible && l4.posteriorElement.visible
    && l4.anatomy.pedicles.left.position.distanceTo(pedicleBase) > 0,
  'exploded inspection forces explicit semantic geometry');
test.exitInspectionMode();
check(l4.geometryMode === 'ct_reference' && l4.referenceLayer.visible
    && !l4.body.visible && !l4.posteriorElement.visible,
  'inspection exit restores intact CT geometry policy');

const fullImagingCoverage = ['occiput-cervical', 'thoracic', 'lumbar-pelvis'];
const makeImagingFile = (name, type, size = 1024 * 1024) => ({ name, type, size });
const frontalRaster = makeImagingFile('Patient_Name_should_never_render_PA.png', 'image/png', 2_000_000);
const lateralRaster = makeImagingFile('Patient_Name_should_never_render_LAT.jpg', 'image/jpeg', 2_500_000);
const dicomOne = makeImagingFile('series-0001.dcm', '', 600_000);
const dicomTwo = makeImagingFile('series-0002.dcm', '', 610_000);
const invalidText = makeImagingFile('not-imaging.txt', 'text/plain', 500);
const authorizedSelection = {
  authorization: true,
  pixelReview: true,
  frontalProjection: 'pa',
  coverage: fullImagingCoverage
};
const standingValidation = test.validatePatientImagingSelection({
  ...authorizedSelection,
  path: 'radiographs',
  frontal: frontalRaster,
  lateral: lateralRaster,
  ctFiles: []
});
const ctValidation = test.validatePatientImagingSelection({
  ...authorizedSelection,
  path: 'ct',
  frontal: null,
  lateral: null,
  ctFiles: [dicomOne, dicomTwo]
});
const hybridValidation = test.validatePatientImagingSelection({
  ...authorizedSelection,
  path: 'hybrid',
  frontal: frontalRaster,
  lateral: lateralRaster,
  ctFiles: [dicomOne, dicomTwo]
});
const invalidImagingValidation = test.validatePatientImagingSelection({
  ...authorizedSelection,
  path: 'radiographs',
  frontal: invalidText,
  lateral: lateralRaster,
  ctFiles: []
});
check(standingValidation.valid
    && standingValidation.summary.representation === 'standing_raster_pair_preview_only'
    && standingValidation.summary.capabilities.previewOnly === true
    && standingValidation.summary.geometryReady === false
    && standingValidation.summary.alignmentReady === false,
  'standing radiograph validation accepts a complete authorized pair but keeps geometry and alignment gates closed');
check(!ctValidation.valid
    && ctValidation.errors.some(error => /CT DICOM intake is untested/i.test(error))
    && ctValidation.summary.sourceCounts.ct === 2
    && ctValidation.summary.sourceKinds.ct === 'dicom'
    && ctValidation.summary.representation === 'ct_dicom_series_selected_unparsed_unsegmented',
  'CT selection recognizes DICOM files but remains blocked until the intake path is validated');
check(!hybridValidation.valid
    && hybridValidation.errors.some(error => /CT DICOM intake is untested/i.test(error))
    && hybridValidation.summary.representation === 'hybrid_sources_selected_registration_unavailable'
    && hybridValidation.summary.capabilities.standingRegistrationReviewed === false
    && hybridValidation.summary.capabilities.patientSpecificGeometry === false,
  'hybrid selection remains blocked while registration and patient geometry are unavailable');
check(!invalidImagingValidation.valid
    && invalidImagingValidation.errors.some(error => /frontal file/i.test(error))
    && !JSON.stringify(standingValidation.summary).includes(frontalRaster.name)
    && !JSON.stringify(hybridValidation.summary).includes(lateralRaster.name),
  'unsupported imaging types fail preflight and pure validation summaries never retain source filenames');

const setImagingRadio = pathValue => {
  const radios = document.querySelectorAll('input[name="imagingPath"]');
  radios.forEach(radio => { radio.checked = radio.value === pathValue; });
  const selected = radios.find(radio => radio.checked);
  selected?.dispatchEvent({ type: 'change' });
};
const stageStandingPairThroughControls = () => {
  setImagingRadio('radiographs');
  getElement('imagingAuthorization').checked = true;
  getElement('imagingAuthorization').dispatchEvent({ type: 'change' });
  getElement('imagingPixelReview').checked = true;
  document.querySelectorAll('.imaging-coverage-input').forEach(input => {
    input.checked = fullImagingCoverage.includes(input.value);
  });
  getElement('standingPaInput').files = [frontalRaster];
  getElement('standingLateralInput').files = [lateralRaster];
  getElement('standingPaInput').dispatchEvent({ type: 'change' });
  getElement('standingLateralInput').dispatchEvent({ type: 'change' });
  return test.stagePatientImagingFromSession();
};
const sceneTransformFingerprint = () => {
  test.getScene()?.updateMatrixWorld?.(true);
  return JSON.stringify([...segments.entries()].map(([levelId, record]) => ({
    levelId,
    roots: recordVisualRoots(record).map(root => ({
      visible: root.visible,
      matrix: worldMatrixSnapshot(root)
    }))
  })));
};
const sceneBeforeImagingStage = sceneTransformFingerprint();
const createdBeforeStage = createdObjectUrls.length;
const stagedThroughControls = stageStandingPairThroughControls();
const stagedImagingState = test.getState().patientImaging;
const stagedSessionCounts = test.getPatientImagingSessionCounts();
check(stagedThroughControls === true
    && stagedImagingState.status === 'staged'
    && stagedImagingState.path === 'radiographs'
    && stagedImagingState.sourceCounts.frontal === 1
    && stagedImagingState.sourceCounts.lateral === 1
    && stagedSessionCounts.previewUrls === 2
    && createdObjectUrls.length === createdBeforeStage + 2,
  'file-input events stage an authorized local standing pair and create only two transient previews');
check(!JSON.stringify(stagedImagingState).includes('Patient_Name_should_never_render')
    && !getElement('patientImagingSummary').textContent.includes('Patient_Name_should_never_render')
    && !getElement('standingPaStatus').textContent.includes(frontalRaster.name)
    && stagedImagingState.appliedToGeometry === false
    && sceneTransformFingerprint() === sceneBeforeImagingStage,
  'staged imaging state is filename-sanitized and cannot mutate atlas scene geometry');
const revokedBeforeClear = revokedObjectUrls.length;
const firstClear = test.clearPatientImagingSession();
const revokedAfterFirstClear = revokedObjectUrls.length;
const secondClear = test.clearPatientImagingSession();
check(firstClear === true && secondClear === true
    && revokedAfterFirstClear === revokedBeforeClear + 2
    && revokedObjectUrls.length === revokedAfterFirstClear
    && test.getPatientImagingSessionCounts().previewUrls === 0
    && test.getState().patientImaging.status === 'none',
  'patient imaging clear is idempotent and revokes every transient object URL exactly once');
const revokedBeforePagehide = revokedObjectUrls.length;
stageStandingPairThroughControls();
context.dispatchEvent({ type: 'pagehide' });
check(revokedObjectUrls.length === revokedBeforePagehide + 2
    && test.getPatientImagingSessionCounts().frontal === 0
    && test.getPatientImagingSessionCounts().lateral === 0
    && test.getState().patientImaging.status === 'none',
  'pagehide releases app-held file references and preview URLs');

const mutableFlatbackSeed = test.resolveCaseExampleSeed('flatback');
const canonicalFlatbackLl = mutableFlatbackSeed.params.ll;
const canonicalFlatbackLoss = mutableFlatbackSeed.levelFactors['L4-L5'].discHeightLoss;
mutableFlatbackSeed.params.ll = -999;
mutableFlatbackSeed.levelFactors['L4-L5'].discHeightLoss = 99;
const freshFlatbackSeed = test.resolveCaseExampleSeed('flatback');
check(freshFlatbackSeed.params.ll === canonicalFlatbackLl
    && freshFlatbackSeed.levelFactors['L4-L5'].discHeightLoss === canonicalFlatbackLoss,
  'resolved case seeds are independent working copies and cannot dirty the versioned case library');

stageStandingPairThroughControls();
harness.setScenario([{ levelId: 'L4-L5', procedureId: 'laminectomy' }]);
test.setLevelFactor('L4-L5', { discHeightLoss: 91, axialRotation: 23 });
test.setInspectionSelection('C0-C1', 'body', 0.5);
const caseUrlsBeforeApply = revokedObjectUrls.length;
const flatbackApplied = test.applyCaseExample('flatback');
const flatbackState = test.getState();
check(flatbackApplied === true
    && JSON.stringify(flatbackState.params) === JSON.stringify(freshFlatbackSeed.params)
    && JSON.stringify(flatbackState.assumptions) === JSON.stringify(freshFlatbackSeed.assumptions)
    && JSON.stringify(flatbackState.levelFactors) === JSON.stringify(freshFlatbackSeed.levelFactors)
    && flatbackState.itinerary.length === 0
    && flatbackState.view === 'pre'
    && flatbackState.inspection.active === false
    && flatbackState.inspection.levelId === 'L4-L5'
    && flatbackState.caseContext.exampleId === 'flatback'
    && flatbackState.patientImaging.status === 'none'
    && revokedObjectUrls.length === caseUrlsBeforeApply + 2,
  'loading an example atomically clears dirty procedures, inspection, level edits, assumptions, and local imaging');
const neutralCaseSeed = test.resolveCaseExampleSeed('neutral-reference');
test.applyCaseExample('neutral-reference');
const neutralCaseState = test.getState();
check(JSON.stringify(neutralCaseState.params) === JSON.stringify(neutralCaseSeed.params)
    && JSON.stringify(neutralCaseState.globalDeformity) === JSON.stringify(neutralCaseSeed.globalDeformity)
    && JSON.stringify(neutralCaseState.levelFactors) === JSON.stringify(neutralCaseSeed.levelFactors)
    && neutralCaseState.caseContext.exampleId === 'neutral-reference'
    && neutralCaseState.levelFactors['L4-L5'].discHeightLoss === 0,
  'sequential example loading has no pathology carry-over from the prior case');

camera.position.set(91, -44, 150);
controls.target.set(30, 19, -27);
const degenerativeDemoApplied = test.applyCaseExample('degenerative-scoliosis');
const degenerativeAtlasRecords = [...segments.values()].filter(record => record.referenceLayer.children.length > 0);
const degenerativeWithheldRecords = degenerativeAtlasRecords.filter(
  record => record.referenceLayer.userData.authoredMorphologyWithheld === true
);
const l3L4Degenerative = segments.get('L3-L4');
const degenerativeBounds = test.getVisibleAnatomyBounds(true);
const degenerativeCenter = degenerativeBounds.getCenter(new context.THREE.Vector3());
const degenerativeSize = degenerativeBounds.getSize(new context.THREE.Vector3());
const degenerativeFrame = test.getCameraFrameDiagnostics();
const degenerativeDistance = camera.position.distanceTo(controls.target);
const verticalFill = degenerativeSize.y
  / (2 * degenerativeDistance * Math.tan(context.THREE.MathUtils.degToRad(camera.fov) / 2));
const firstDemoCamera = camera.position.toArray();
const firstDemoTarget = controls.target.toArray();
test.applyCaseExample('degenerative-scoliosis');
const repeatedDemoFrame = test.getCameraFrameDiagnostics();
check(degenerativeDemoApplied === true
    && degenerativeAtlasRecords.length === segments.size
    && degenerativeAtlasRecords.every(record => record.geometryMode === 'ct_reference'
      && record.referenceLayer.visible
      && !record.body.visible && !record.endplates.visible && !record.posteriorElement.visible)
    && degenerativeWithheldRecords.length === 4
    && String(getElement('geometryChip').textContent).startsWith('Source-coherent CT spine')
    && !String(getElement('geometryChip').textContent).includes('semantic fallback'),
  'adult degenerative scoliosis demo preserves every atlas-backed CT vertebra and never substitutes generic lumbar blocks',
  `modes=${degenerativeAtlasRecords.map(record => `${record.level.id}:${record.geometryMode}`).join(',')}`);
check(near(l3L4Degenerative.disc.userData.collapseFraction, .58, 1e-9)
    && near(l3L4Degenerative.disc.scale.y, .42, 1e-9)
    && degenerativeWithheldRecords.every(record =>
      /Facet hypertrophy|Osteophyte/.test(record.referenceLayer.userData.authoredMorphologyWithheldReason)),
  'degeneration demo retains supported disc collapse and explicitly withholds unsegmented bone-shape edits');
check(degenerativeFrame?.policy === test.MODEL_MANIFEST.anatomy.cameraFramingPolicy
    && degenerativeFrame.includeLowerLimbs === true
    && controls.target.distanceTo(degenerativeCenter) < 1e-8
    && verticalFill > .55 && verticalFill < .92
    && numericArraysNear(firstDemoCamera, camera.position.toArray(), 1e-8)
    && numericArraysNear(firstDemoTarget, controls.target.toArray(), 1e-8)
    && JSON.stringify(degenerativeFrame) === JSON.stringify(repeatedDemoFrame),
  'loading the full-body demo deterministically reframes actual visible anatomy after an adversarial camera state',
  JSON.stringify({ verticalFill, degenerativeFrame, repeatedDemoFrame }));

test.applyAnatomyPreset('degenerative-scoliosis');
const alifPlan = harness.buildPlan('alif', 'L4-L5', {
  cageCatalogId: 'hedron_a', cageFootprint: { ap: 24, ml: 35 }, cageHeight: 11, cageLordosis: 15,
  screwDiameter: 6.5, screwLength: 45, rodDiameter: 5.5, rodLength: 60,
  graftFamily: 'mastergraft_putty', graftVolume: 3
});
harness.setScenario([{
  levelId: 'L4-L5', procedureId: 'alif', plannedAngle: 15, plannedAngleSource: 'user_planned',
  implantPlan: alifPlan
}]);
check(l4.geometryMode === 'ct_reference' && l4.referenceLayer.visible
    && !l4.body.visible && !l4.endplates.visible && !l4.posteriorElement.visible
    && l4.discExcised && !l4.disc.visible && l4.hardwareLayer.visible,
  'L4-L5 ALIF preserves the CT vertebral reference while hiding only the excised disc',
  l4.geometryMode);
const atlasBackedDuringAlif = [...segments.values()].filter(record => record.referenceLayer.children.length > 0);
const withheldMorphologyRecords = atlasBackedDuringAlif.filter(record => record.referenceLayer.userData.authoredMorphologyWithheld === true);
check(atlasBackedDuringAlif.every(record => record.geometryMode === 'ct_reference'
      && record.referenceLayer.visible && !record.body.visible && !record.endplates.visible && !record.posteriorElement.visible)
    && withheldMorphologyRecords.length === 4
    && /unsupported (?:anatomy|component shape) edit/.test(String(getElement('geometryChip').textContent)),
  'ALIF with the degeneration preset retains every atlas-backed CT level and explicitly withholds four unsegmented bone-shape edits',
  `withheld=${withheldMorphologyRecords.map(record => record.level.id).join(',')}`);
check(l4.interbodyResectionEnvelope.visible
    && l4.interbodyResectionEnvelope.children[0]?.name === 'plannedInterbodyDiscectomyEnvelope'
    && l4.interbodyResectionEnvelope.userData.ctBoneSubtracted === false
    && l4.interbodyResectionEnvelope.userData.cutSafetyValidated === false,
  'ALIF displays a localized source-disc-bounded discectomy envelope without claiming CT subtraction or cut safety');
test.applyAnatomyPreset('neutral');

const itinerarySnapshot = test.getState().itinerary[0]?.implantPlan;
const snapshotCage = itinerarySnapshot?.components?.find(component => component.role === 'fusion_cage');
const snapshotScrew = itinerarySnapshot?.components?.find(component => component.role === 'screw_set');
const snapshotRod = itinerarySnapshot?.components?.find(component => component.role === 'rod_set');
check(Object.isFrozen(alifPlan) && Object.isFrozen(alifPlan.components)
    && Object.isFrozen(snapshotCage?.dimensionsMm) && Object.isFrozen(snapshotScrew?.dimensionsMm)
    && alifPlan.schemaVersion === 'implant-plan-v2' && alifPlan.dimensionMode === 'catalog'
    && snapshotCage?.catalogId === 'hedron_a'
    && snapshotCage.dimensionsMm.ap === 24 && snapshotCage.dimensionsMm.ml === 35
    && snapshotCage.dimensionsMm.height === 11 && snapshotCage.dimensionsMm.anteriorHeight === 11
    && near(snapshotCage.dimensionsMm.posteriorHeight, 11 - 24 * Math.tan(15 * Math.PI / 180), 1e-9)
    && snapshotCage.heightConvention === 'catalog_maximum_height' && snapshotCage.lordosisDeg === 15
    && snapshotScrew?.catalogId === 'ucentum_pedicle'
    && snapshotScrew.dimensionsMm.outerDiameter === 6.5 && snapshotScrew.dimensionsMm.length === 45
    && snapshotRod?.dimensionsMm.diameter === 5.5 && snapshotRod.dimensionsMm.length === 60,
  'itinerary retains an immutable full implant-dimension snapshot');

const alifObjects = [];
l4.hardwareLayer.traverse(object => alifObjects.push(object));
const catalogCage = alifObjects.find(object => object.name === 'catalogInterbodyCage');
const screwAssemblies = alifObjects.filter(object => /^catalogPedicleScrew:[^:]+:(left|right)$/.test(object.name));
const screwShafts = alifObjects.filter(object => /^catalogPedicleScrew:.*:shaft$/.test(object.name));
const catalogRods = alifObjects.filter(object => /^catalogRod:(left|right)$/.test(object.name));
check(screwAssemblies.length === 4 && screwShafts.length === 4 && catalogRods.length === 2,
  'single-level ALIF posterior construct contains four screws and two rods',
  `assemblies=${screwAssemblies.length}, shafts=${screwShafts.length}, rods=${catalogRods.length}`);

const mmScale = harness.millimetresToScene;
const cagePositions = catalogCage?.geometry?.getAttribute('position');
let cageMinX = Infinity;
let cageMaxX = -Infinity;
let cageMinZ = Infinity;
let cageMaxZ = -Infinity;
if (cagePositions) {
  for (let index = 0; index < cagePositions.count; index += 1) {
    cageMinX = Math.min(cageMinX, cagePositions.getX(index));
    cageMaxX = Math.max(cageMaxX, cagePositions.getX(index));
    cageMinZ = Math.min(cageMinZ, cagePositions.getZ(index));
    cageMaxZ = Math.max(cageMaxZ, cagePositions.getZ(index));
  }
}
let posteriorMinY = Infinity;
let posteriorMaxY = -Infinity;
let anteriorMinY = Infinity;
let anteriorMaxY = -Infinity;
if (cagePositions) {
  for (let index = 0; index < cagePositions.count; index += 1) {
    const x = cagePositions.getX(index);
    const y = cagePositions.getY(index);
    if (Math.abs(x - cageMaxX) <= 1e-8) {
      posteriorMinY = Math.min(posteriorMinY, y);
      posteriorMaxY = Math.max(posteriorMaxY, y);
    }
    if (Math.abs(x - cageMinX) <= 1e-8) {
      anteriorMinY = Math.min(anteriorMinY, y);
      anteriorMaxY = Math.max(anteriorMaxY, y);
    }
  }
}
const cageMeasured = {
  ap: (cageMaxX - cageMinX) / mmScale,
  ml: (cageMaxZ - cageMinZ) / mmScale,
  anteriorHeight: (anteriorMaxY - anteriorMinY) / mmScale,
  posteriorHeight: (posteriorMaxY - posteriorMinY) / mmScale
};
const expectedPosteriorHeight = 11 - 24 * Math.tan(15 * Math.PI / 180);
check(catalogCage && near(cageMeasured.ap, 24, 1e-5)
    && near(cageMeasured.ml, 35, 1e-5) && near(cageMeasured.anteriorHeight, 11, 1e-5)
    && near(cageMeasured.posteriorHeight, expectedPosteriorHeight, 1e-5)
    && catalogCage.userData.lordosisDeg === 15
    && catalogCage.userData.heightConvention === 'catalog_maximum_height',
  'HEDRON A 24x35 mm / 11 mm maximum-height / 15 degree envelope preserves the catalog height convention',
  JSON.stringify(cageMeasured));

const screwGeometry = screwShafts[0]?.geometry?.parameters;
const rodGeometry = catalogRods[0]?.geometry?.parameters;
check(screwGeometry && near(screwGeometry.radiusTop * 2 / mmScale, 6.5, 1e-6)
    && near(screwGeometry.height / mmScale, 45, 1e-6)
    && rodGeometry && near(rodGeometry.radiusTop * 2 / mmScale, 5.5, 1e-6)
    && near(rodGeometry.height / mmScale, 60, 1e-6),
  'uCentum 6.5x45 mm screws and 5.5x60 mm rods inverse-measure in scene units',
  JSON.stringify({
    screwDiameter: screwGeometry?.radiusTop * 2 / mmScale,
    screwLength: screwGeometry?.height / mmScale,
    rodDiameter: rodGeometry?.radiusTop * 2 / mmScale,
    rodLength: rodGeometry?.height / mmScale
  }));

const interbodyApproachCases = [
  { procedureId: 'alif', levelId: 'L4-L5', catalogId: 'hedron_a', footprint: { ap: 24, ml: 35 }, height: 11, lordosis: 15, approach: 'alif', cageCount: 1, yawDeg: 0 },
  { procedureId: 'tlifPlif', levelId: 'L4-L5', catalogId: 'hedron_t', footprint: { ap: 28, ml: 10 }, height: 9, lordosis: 8, approach: 'tlif', cageCount: 1, yawDeg: -32 },
  { procedureId: 'plif', levelId: 'L4-L5', catalogId: 'hedron_p', footprint: { ap: 26, ml: 10 }, height: 9, lordosis: 8, approach: 'plif', cageCount: 2, yawDeg: null },
  { procedureId: 'llif', levelId: 'L3-L4', catalogId: 'hedron_l', footprint: { ap: 18, ml: 40 }, height: 9, lordosis: 10, approach: 'llif', cageCount: 1, yawDeg: 0 },
  { procedureId: 'xlif', levelId: 'L3-L4', catalogId: 'hedron_l', footprint: { ap: 18, ml: 40 }, height: 9, lordosis: 10, approach: 'xlif', cageCount: 1, yawDeg: 0 },
  { procedureId: 'olif', levelId: 'L3-L4', catalogId: 'hedron_l', footprint: { ap: 18, ml: 40 }, height: 9, lordosis: 10, approach: 'olif', cageCount: 1, yawDeg: 25 }
];
const interbodyApproachFailures = [];
const approachYawById = new Map();
for (const pathCase of interbodyApproachCases) {
  try {
    const plan = harness.buildPlan(pathCase.procedureId, pathCase.levelId, {
      cageCatalogId: pathCase.catalogId,
      cageFootprint: pathCase.footprint,
      cageHeight: pathCase.height,
      cageLordosis: pathCase.lordosis
    });
    harness.setScenario([{ levelId: pathCase.levelId, procedureId: pathCase.procedureId, implantPlan: plan }]);
    const record = segments.get(pathCase.levelId);
    const cages = [];
    record.hardwareLayer.traverse(object => {
      if (object.name.startsWith('catalogInterbodyCage')) cages.push(object);
    });
    if (record.geometryMode !== 'ct_reference' || !record.referenceLayer.visible
        || record.body.visible || record.endplates.visible || record.posteriorElement.visible) {
      throw new Error(`generic anatomy visible or CT hidden (${record.geometryMode})`);
    }
    if (!record.discExcised || record.disc.visible || !record.interbodyResectionEnvelope.visible) {
      throw new Error('disc/resection state is inconsistent');
    }
    if (cages.length !== pathCase.cageCount) throw new Error(`cages=${cages.length}, expected=${pathCase.cageCount}`);
    if (!cages.every(cage => cage.userData.approach === pathCase.approach
        && cage.userData.sourceBoundedAnchor === true
        && cage.userData.approachCorridorModeled === false
        && cage.userData.containmentAssessed === false
        && cage.userData.fitValidated === false
        && finiteObjectTree(cage))) {
      throw new Error('cage metadata or transform failed closed-state checks');
    }
    if (pathCase.yawDeg != null && !near(cages[0].userData.approachYawDeg, pathCase.yawDeg)) {
      throw new Error(`yaw=${cages[0].userData.approachYawDeg}`);
    }
    approachYawById.set(pathCase.procedureId, cages.map(cage => cage.userData.approachYawDeg));
  } catch (error) {
    interbodyApproachFailures.push(`${pathCase.procedureId}@${pathCase.levelId}: ${error.message}`);
  }
}
check(interbodyApproachFailures.length === 0,
  'ALIF, TLIF, PLIF, LLIF, XLIF, and OLIF use CT-preserving localized approach-specific cage and discectomy paths',
  interbodyApproachFailures.join('\n'));
check(approachYawById.get('xlif')?.[0] === 0
    && approachYawById.get('olif')?.[0] === 25
    && approachYawById.get('plif')?.length === 2,
  'XLIF is direct lateral, OLIF is oblique-lateral, and PLIF uses paired posterior cage envelopes',
  JSON.stringify(Object.fromEntries(approachYawById)));

const customPlan = harness.buildPlan('alif', 'L4-L5', {
  custom: true,
  customLabel: 'Research <ALIF> & cage',
  customCageAp: 30, customCageMl: 40, customCageAnterior: 14, customCagePosterior: 9,
  customScrewDiameter: 7.2, customScrewLength: 52,
  customRodDiameter: 6.2, customRodLength: 75,
  customGraftLabel: 'Custom & graft', customGraftVolume: 5.5
});
const customCageComponent = customPlan.components.find(component => component.role === 'fusion_cage');
const customScrewComponent = customPlan.components.find(component => component.role === 'screw_set');
const expectedCustomAngle = Math.atan2(5, 30) * 180 / Math.PI;
check(customPlan.schemaVersion === 'implant-plan-v2'
    && customPlan.dimensionMode === 'custom' && customPlan.sizingSource === 'user_entered_dimensions'
    && customPlan.catalogMatch === false && customPlan.clinicalSuitability === 'not_assessed'
    && customPlan.fitAssessment === 'not_performed' && customPlan.trajectoryAssessment === 'not_performed'
    && Object.isFrozen(customPlan) && Object.isFrozen(customCageComponent?.dimensionsMm)
    && Object.isFrozen(customCageComponent?.provenance)
    && customCageComponent?.catalogId === null && customCageComponent?.dimensionSource === 'user_entered'
    && customCageComponent?.dimensionsMm.anteriorHeight === 14
    && customCageComponent?.dimensionsMm.posteriorHeight === 9
    && near(customCageComponent?.lordosisDeg, expectedCustomAngle, 1e-10)
    && customScrewComponent?.geometryTemplate === 'shaft_only'
    && customPlan.graft?.declaredQuantityCc === 5.5 && customPlan.graft?.placedVolumeInferred === false,
  'custom implant-plan-v2 snapshot is exact, immutable, provenance-separated, and suitability-neutral');

const escapedCustomSummary = harness.safeSummary(customPlan);
check(escapedCustomSummary.includes('&lt;ALIF&gt;') && escapedCustomSummary.includes('&amp;')
    && !escapedCustomSummary.includes('<ALIF>'),
  'custom component labels are escaped before itinerary HTML insertion', escapedCustomSummary);

let customBoundsRejected = false;
try {
  test.normalizeCustomImplantSelection(test.PROCEDURE_IMPLANT_PROFILES.alif, {
    label: 'Out-of-domain custom device',
    cage: { ap: 1000, ml: 40, anteriorHeight: 14, posteriorHeight: 9 },
    screw: { outerDiameter: 7.2, length: 52 }, rod: { diameter: 6.2, length: 75 },
    graft: { label: 'Custom graft', quantityCc: 5.5 }
  });
} catch (_error) { customBoundsRejected = true; }
let unsupportedCustomRejected = false;
try {
  test.normalizeCustomImplantSelection(test.PROCEDURE_IMPLANT_PROFILES.tops, { label: 'Custom TOPS' });
} catch (_error) { unsupportedCustomRejected = true; }
let subGuardrailCatalogEdgeRejected = false;
try { test.deriveCatalogCageHeights(22, 9, 20); } catch (_error) { subGuardrailCatalogEdgeRejected = true; }
check(customBoundsRejected && unsupportedCustomRejected && subGuardrailCatalogEdgeRejected,
  'dimension guardrails reject out-of-domain custom values, sub-2 mm catalog edges, and unsupported TOPS topology');

harness.setScenario([{
  levelId: 'L4-L5', procedureId: 'alif', plannedAngle: 15, plannedAngleSource: 'user_planned',
  implantPlan: customPlan
}]);
const customObjects = [];
l4.hardwareLayer.traverse(object => customObjects.push(object));
const customCage = customObjects.find(object => object.name === 'customInterbodyEnvelope');
const customScrewAssemblies = customObjects.filter(object => /^catalogPedicleScrew:[^:]+:(left|right)$/.test(object.name));
const customScrewShafts = customObjects.filter(object => /^catalogPedicleScrew:.*:shaft$/.test(object.name));
const customHeads = customObjects.filter(object => object.name.includes('catalog-unspecified-tulip-envelope') || /:collar$/.test(object.name));
const customRods = customObjects.filter(object => /^catalogRod:(left|right)$/.test(object.name));
const customPositions = customCage?.geometry?.getAttribute('position');
let customMinX = Infinity;
let customMaxX = -Infinity;
let customMinZ = Infinity;
let customMaxZ = -Infinity;
if (customPositions) {
  for (let index = 0; index < customPositions.count; index += 1) {
    customMinX = Math.min(customMinX, customPositions.getX(index));
    customMaxX = Math.max(customMaxX, customPositions.getX(index));
    customMinZ = Math.min(customMinZ, customPositions.getZ(index));
    customMaxZ = Math.max(customMaxZ, customPositions.getZ(index));
  }
}
let customAnteriorMinY = Infinity;
let customAnteriorMaxY = -Infinity;
let customPosteriorMinY = Infinity;
let customPosteriorMaxY = -Infinity;
if (customPositions) {
  for (let index = 0; index < customPositions.count; index += 1) {
    const x = customPositions.getX(index);
    const y = customPositions.getY(index);
    if (Math.abs(x - customMinX) <= 1e-8) {
      customAnteriorMinY = Math.min(customAnteriorMinY, y);
      customAnteriorMaxY = Math.max(customAnteriorMaxY, y);
    }
    if (Math.abs(x - customMaxX) <= 1e-8) {
      customPosteriorMinY = Math.min(customPosteriorMinY, y);
      customPosteriorMaxY = Math.max(customPosteriorMaxY, y);
    }
  }
}
const customMeasured = {
  ap: (customMaxX - customMinX) / mmScale,
  ml: (customMaxZ - customMinZ) / mmScale,
  anteriorHeight: (customAnteriorMaxY - customAnteriorMinY) / mmScale,
  posteriorHeight: (customPosteriorMaxY - customPosteriorMinY) / mmScale
};
const customScrewGeometry = customScrewShafts[0]?.geometry?.parameters;
const customRodGeometry = customRods[0]?.geometry?.parameters;
check(customCage && near(customMeasured.ap, 30, 1e-5) && near(customMeasured.ml, 40, 1e-5)
    && near(customMeasured.anteriorHeight, 14, 1e-5) && near(customMeasured.posteriorHeight, 9, 1e-5)
    && customScrewAssemblies.length === 4 && customScrewShafts.length === 4 && customHeads.length === 0
    && customRods.length === 2
    && near(customScrewGeometry?.radiusTop * 2 / mmScale, 7.2, 1e-6)
    && near(customScrewGeometry?.height / mmScale, 52, 1e-6)
    && near(customRodGeometry?.radiusTop * 2 / mmScale, 6.2, 1e-6)
    && near(customRodGeometry?.height / mmScale, 75, 1e-6)
    && customScrewAssemblies.every(assembly => assembly.userData.headGeometryRendered === false)
    && customRods.every(rod => rod.userData.dimensionSource === 'user_entered'),
  'custom cage, screw shafts, and rods inverse-measure exactly while unspecified screw heads remain withheld',
  JSON.stringify({ customMeasured, screws: customScrewShafts.length, heads: customHeads.length, rods: customRods.length }));

const activeHardwareSource = harness.createHardwareSource;
check(/function\s+addCage\b/.test(harness.legacyHardwareSource)
    && !/\b(?:addCage|addScrewPair|addAnteriorPlate)\s*\(/.test(activeHardwareSource),
  'active createHardware paths do not call legacy proportion-scaled hardware helpers');

const topsPlan = harness.buildPlan('tops', 'L4-L5');
const topsHardware = harness.createHardwareFor({
  id: 9001, levelId: 'L4-L5', procedureId: 'tops', implantPlan: topsPlan
}, 'L4-L5');
const topsMotionComponent = topsPlan.components.find(component => component.role === 'posterior_motion_device');
const topsScrewComponent = topsPlan.components.find(component => component.role === 'screw_set');
const topsHardwareObjects = [];
topsHardware.traverse(object => topsHardwareObjects.push(object));
const topsScrewAssemblies = topsHardwareObjects.filter(object =>
  /^TOPSPedicleScrew:[^:]+:(left|right)$/.test(object.name)
);
const topsScrewShafts = topsHardwareObjects.filter(object =>
  /^TOPSPedicleScrew:.*:shaft$/.test(object.name)
);
const topsEndplates = topsHardwareObjects.filter(object =>
  /^TOPSTitaniumEndplate:(superior|inferior)$/.test(object.name)
);
const topsArms = topsHardwareObjects.filter(object => /^TOPSArm:(superior|inferior):(left|right)$/.test(object.name));
const topsBoots = topsHardwareObjects.filter(object => object.name === 'TOPSPolycarbonateUrethaneBoot');
const topsRods = topsHardwareObjects.filter(object => /^catalogRod:/.test(object.name));
const topsTopPlate = topsEndplates.find(object => object.name.endsWith(':superior'));
const topsBottomPlate = topsEndplates.find(object => object.name.endsWith(':inferior'));
check(topsPlan.renderStatus === 'catalog_dimensions_available'
    && topsPlan.constructVariant === 'posterior_motion_device_with_pedicle_screws'
    && topsMotionComponent?.catalogId === 'tops_motion'
    && topsMotionComponent?.dimensionsMm.interpedicularDistance === 30
    && topsMotionComponent?.dimensionsMm.armAngleDeg === 14
    && topsMotionComponent?.dimensionsMm.plateLengthClass === 'M'
    && topsMotionComponent?.dimensionsMm.topPlateLength === 77
    && topsMotionComponent?.dimensionsMm.bottomPlateLength === 83
    && topsScrewComponent?.catalogId === 'tops_pedicle'
    && topsScrewComponent?.dimensionsMm.outerDiameter === 6.5
    && topsScrewComponent?.dimensionsMm.length === 45
    && !topsPlan.components.some(component => component.role === 'rod_set'),
  'TOPS plan snapshots the FDA-reference medium 30 mm / 14 degree configuration with four-screw sizing and no rods');
check(topsHardware.userData.hardwareWithheld !== true
    && topsScrewAssemblies.length === 4 && topsScrewShafts.length === 4
    && topsScrewAssemblies.every(object => object.isGroup)
    && topsEndplates.length === 2 && topsEndplates.every(object => object.isMesh)
    && topsArms.length === 4 && topsArms.every(object => object.isMesh)
    && topsBoots.length === 1 && topsBoots[0].isMesh && topsRods.length === 0
    && !topsHardwareObjects.some(object => object.name === 'TOPSInternalArticulationEnvelope')
    && topsTopPlate?.userData.configurationOverallLengthMm === 77
    && topsBottomPlate?.userData.configurationOverallLengthMm === 83
    && topsHardware.userData.topsMotionDevice?.fourPedicleScrewsRendered === true
    && topsHardware.userData.topsMotionDevice?.crossbarCount === 2
    && topsHardware.userData.topsMotionDevice?.armCount === 4
    && topsHardware.userData.topsMotionDevice?.bootCount === 1
    && topsHardware.userData.topsMotionDevice?.proprietaryInternalMechanismRendered === false
    && topsHardware.userData.topsMotionDevice?.placementFitValidated === false
    && topsHardware.userData.topsMotionDevice?.activeSlipReductionModeled === false
    && finiteObjectTree(topsHardware),
  'TOPS renders the public two-crossbar/four-arm/four-screw/central-boot topology while withholding the proprietary internal mechanism');

const topsFitMetadata = topsHardware.userData.topsMotionDevice;
const topsHeadEdgeOverhangs = Object.values(topsFitMetadata?.rows || {})
  .flatMap(row => Object.values(row.armOverhangBeyondDisplayedHeadMm || {}));
check(near(topsFitMetadata?.displayedGenericHeadRadiusMm, 5.33, 1e-6)
    && topsHeadEdgeOverhangs.length === 4
    && topsHeadEdgeOverhangs.every(Number.isFinite)
    && Object.values(topsFitMetadata?.rows || {}).every(row => row.bothSidesOverFiveMillimetres === true)
    && topsFitMetadata?.twoToFiveMillimetreHeadEdgeSelectionProxyMet === false
    && topsFitMetadata?.proxyDisplaySeatingStatus === 'unseated_proxy'
    && topsFitMetadata?.proxyDisplaySeatingReasons?.some(reason => reason.includes('step down'))
    && topsArms.every(arm => Number.isFinite(arm.userData.selectedConfigurationOverhangBeyondDisplayedHeadMm)),
  'TOPS fit proxy measures overhang beyond the displayed screw-head edge and flags the public step-down criterion');

const unavailableAnchorHardware = harness.createHardwareWithUnavailableTopsAnchor({
  id: 90015, levelId: 'L4-L5', procedureId: 'tops', implantPlan: topsPlan
}, 'L4-L5');
check(unavailableAnchorHardware.userData.hardwareWithheld === true
    && unavailableAnchorHardware.userData.topsGeometryWithheld === true
    && /Four source-frame pedicle anchor proxies/.test(unavailableAnchorHardware.userData.withheldReason)
    && unavailableAnchorHardware.children.length === 0,
  'TOPS construction fails atomically with no partial screw geometry when a source anchor is unavailable');

const occipitalPlan = harness.buildPlan('occipitalFusion', 'C0-C1');
const occipitalHardware = harness.createHardwareFor({
  id: 9002, levelId: 'C0-C1', procedureId: 'occipitalFusion', implantPlan: occipitalPlan
}, 'C0-C1');
check(occipitalPlan.renderStatus === 'withheld_unverified_geometry'
    && occipitalHardware.userData.hardwareWithheld === true && occipitalHardware.children.length === 0,
  'unsupported occipital hardware still fails closed with empty geometry');

const c3 = segments.get('C3-C4');
harness.setScenario([{ levelId: 'C3-C4', procedureId: 'laminectomy' }]);
check(c3.decompressed && c3.geometryMode === 'ct_reference'
    && c3.referenceLayer.visible && !c3.body.visible && !c3.endplates.visible
    && !c3.posteriorElement.visible && c3.disc.visible,
  'C3-C4 isolated laminectomy retains intact CT geometry without exposing the semantic body',
  c3.geometryMode);
check(c3.cutSurfaces.visible && c3.decompressionVoid.visible
    && c3.decompressionTargets.every(target => !target.visible)
    && c3.decompressionVoid.userData.mode === 'planned posterior resection envelope; intact CT mesh is not subtracted',
  'C3-C4 isolated laminectomy shows truthful post-op resection-envelope and cut-margin overlays');
const interruptionState = pathway => ({
  continuous: pathway.children.find(child => child.userData?.pathwayRole === 'continuous_reference')?.visible,
  preserved: pathway.children.find(child => child.userData?.pathwayRole === 'preserved_after_planned_interruption')?.visible,
  interrupted: pathway.userData.interrupted
});
const interruptedPathways = [
  c3.ligaments.flavum.left, c3.ligaments.flavum.right,
  c3.ligaments.interspinous, c3.ligaments.supraspinous
].map(interruptionState);
check(interruptedPathways.every(pathway => pathway.interrupted && pathway.continuous === false && pathway.preserved === true)
    && c3.ligaments.disruptionMarkers.visible,
  'laminectomy creates a short planned interruption while retaining the proximal ligament pathway proxies');
test.setView('pre');
check(c3.geometryMode === 'ct_reference' && c3.referenceLayer.visible
    && !c3.cutSurfaces.visible && !c3.decompressionVoid.visible,
  'C3-C4 laminectomy pre-op view retains CT anatomy and hides resection overlays');
test.setView('post');
check(c3.geometryMode === 'ct_reference' && c3.referenceLayer.visible
    && c3.cutSurfaces.visible && c3.decompressionVoid.visible,
  'C3-C4 laminectomy post-op view restores overlays without replacing CT anatomy');

const l5 = segments.get('L5-S1');
const topsIntactSnapshots = [
  { record: l4, boneKey: 'L4', role: 'superior' },
  { record: l5, boneKey: 'L5', role: 'inferior' }
].map(entry => {
  let surface = null;
  entry.record.referenceLayer.traverse(object => {
    if (!surface && object.isMesh && object.name === `ctReferenceSurface:${entry.boneKey}`) surface = object;
  });
  const indexed = indexedGeometryBounds(surface?.geometry);
  return {
    ...entry,
    layer: entry.record.referenceLayer,
    surface,
    geometry: surface?.geometry,
    geometryUuid: surface?.geometry?.uuid,
    counts: geometryCounts(surface?.geometry),
    indexedBounds: indexed.box.clone(),
    worldMatrix: worldMatrixSnapshot(surface)
  };
});
check(topsIntactSnapshots.every(snapshot => snapshot.surface && snapshot.layer.visible
    && snapshot.counts.triangles > 0 && snapshot.geometry?.getIndex()),
  'TOPS source snapshot captures the intact indexed L4 and L5 CT surfaces before reconstruction');

harness.setScenario([
  { levelId: 'L4-L5', procedureId: 'laminectomy' },
  { levelId: 'L4-L5', procedureId: 'tops', implantPlan: topsPlan }
]);
const topsPostoperativeSnapshots = topsIntactSnapshots.map(snapshot => {
  const layer = snapshot.record.topsPostoperativeReferenceLayer;
  const surface = layer?.children.find(object =>
    object.isMesh && object.name === `topsPostDecompressionSurface:${snapshot.boneKey}:${snapshot.role}`
  );
  return { ...snapshot, postoperativeLayer: layer, postoperativeSurface: surface };
});
check(l4.topsReconstruction && l5.topsAdjacentResection
    && topsPostoperativeSnapshots.every(snapshot => snapshot.record.topsResectionContext?.boneKey === snapshot.boneKey
      && snapshot.record.topsResectionContext?.role === snapshot.role
      && snapshot.record.topsResectionContext?.treatedLevelId === 'L4-L5'),
  'TOPS assigns the treated L4 and next-inferior L5 resection roles atomically');
check(topsPostoperativeSnapshots.every(snapshot => snapshot.record.geometryMode === 'ct_derived_post_decompression'
    && !snapshot.layer.visible
    && snapshot.postoperativeLayer?.visible
    && snapshot.postoperativeLayer.children.length === 1
    && snapshot.postoperativeLayer.userData.geometryMode === 'ct_derived_post_decompression'
    && snapshot.postoperativeLayer.userData.openSurface === true
    && snapshot.postoperativeLayer.userData.patientSpecificCutValidated === false
    && snapshot.postoperativeSurface),
  'TOPS replaces both intact CT display layers with explicit L4/L5 derived open postoperative surfaces',
  JSON.stringify(topsPostoperativeSnapshots.map(snapshot => ({
    boneKey: snapshot.boneKey,
    context: snapshot.record.topsResectionContext,
    geometryMode: snapshot.record.geometryMode,
    sourceVisible: snapshot.layer.visible,
    postoperativeVisible: snapshot.postoperativeLayer?.visible,
    postoperativeChildren: snapshot.postoperativeLayer?.children.length,
    openSurface: snapshot.postoperativeLayer?.userData.openSurface,
    semanticVisible: [snapshot.record.body.visible, snapshot.record.endplates.visible, snapshot.record.posteriorElement.visible],
    cutVisible: [snapshot.record.cutSurfaces.visible, snapshot.record.decompressionVoid.visible]
  }))));
check(l4.disc.visible
    && !l4.body.visible && !l4.endplates.visible && !l4.posteriorElement.visible
    && !l5.body.visible && !l5.endplates.visible && !l5.posteriorElement.visible
    && !l4.cutSurfaces.visible && !l4.decompressionVoid.visible
    && !l5.cutSurfaces.visible && !l5.decompressionVoid.visible,
  'TOPS preserves the native disc while suppressing semantic bone and redundant resection overlays');

let topsDerivedGeometryPass = true;
const topsDerivedGeometryDetails = [];
topsPostoperativeSnapshots.forEach(snapshot => {
  const surface = snapshot.postoperativeSurface;
  const postGeometry = surface?.geometry;
  const postCounts = geometryCounts(postGeometry);
  const postIndexed = indexedGeometryBounds(postGeometry);
  const sourceTriangles = geometryTriangleMap(snapshot.geometry);
  const postTriangles = geometryTriangleMap(postGeometry);
  const sourceTriangleTotal = [...sourceTriangles.values()]
    .reduce((sum, entry) => sum + entry.count, 0);
  const postTriangleTotal = [...postTriangles.values()]
    .reduce((sum, entry) => sum + entry.count, 0);
  const removedTriangles = [];
  sourceTriangles.forEach((entry, key) => {
    const removedCount = entry.count - (postTriangles.get(key)?.count || 0);
    for (let duplicate = 0; duplicate < removedCount; duplicate += 1) removedTriangles.push(entry.points);
  });
  const postIsSourceSubset = [...postTriangles.entries()]
    .every(([key, entry]) => entry.count <= (sourceTriangles.get(key)?.count || 0));
  const sourceSize = snapshot.indexedBounds.getSize(new context.THREE.Vector3());
  const postSize = postIndexed.box.getSize(new context.THREE.Vector3());
  const posteriorThreshold = snapshot.indexedBounds.min.x + sourceSize.x * .60;
  const removedBounds = new context.THREE.Box3();
  removedTriangles.forEach(points => points.forEach(point => removedBounds.expandByPoint(point)));
  const removedArePosterior = removedTriangles.length > 0
    && removedTriangles.every(points => points.every(point => point.x >= posteriorThreshold - 1e-4));
  const anteriorThreshold = snapshot.indexedBounds.min.x + sourceSize.x * .55;
  const anteriorSourceKeys = [...sourceTriangles.entries()]
    .filter(([, entry]) => entry.points.every(point => point.x <= anteriorThreshold));
  const anteriorTrianglesPreserved = anteriorSourceKeys.length > 0
    && anteriorSourceKeys.every(([key, entry]) => (postTriangles.get(key)?.count || 0) >= entry.count);
  const boundsRemainWithinSource = postIndexed.box.min.x >= snapshot.indexedBounds.min.x - 1e-4
    && postIndexed.box.min.y >= snapshot.indexedBounds.min.y - 1e-4
    && postIndexed.box.min.z >= snapshot.indexedBounds.min.z - 1e-4
    && postIndexed.box.max.x <= snapshot.indexedBounds.max.x + 1e-4
    && postIndexed.box.max.y <= snapshot.indexedBounds.max.y + 1e-4
    && postIndexed.box.max.z <= snapshot.indexedBounds.max.z + 1e-4;
  const pass = Boolean(surface && postGeometry && postGeometry !== snapshot.geometry
    && postGeometry.uuid !== snapshot.geometryUuid && postGeometry.getIndex()
    && postCounts.triangles > 0 && postCounts.triangles < snapshot.counts.triangles
    && postCounts.triangles >= snapshot.counts.triangles * .55
    && postTriangleTotal === postCounts.triangles
    && sourceTriangleTotal === snapshot.counts.triangles
    && postIsSourceSubset
    && removedTriangles.length === snapshot.counts.triangles - postCounts.triangles
    && removedArePosterior && !removedBounds.isEmpty()
    && removedBounds.min.x >= posteriorThreshold - 1e-4
    && anteriorTrianglesPreserved
    && Math.abs(postIndexed.box.min.x - snapshot.indexedBounds.min.x) <= .5
    && postSize.y >= sourceSize.y * .65 && postSize.z >= sourceSize.z * .65
    && boundsRemainWithinSource
    && surface.userData.geometryTier === 'ct_derived_open_post_decompression_surface'
    && surface.userData.sourceSha256 === snapshot.surface.userData.sourceSha256
    && surface.userData.originalTriangleCount === snapshot.counts.triangles
    && surface.userData.retainedTriangleCount === postCounts.triangles
    && surface.userData.removedTriangleCount === removedTriangles.length
    && surface.userData.openSurface === true
    && surface.userData.patientSpecificCutValidated === false
    && surface.userData.cutSafetyValidated === false);
  topsDerivedGeometryPass &&= pass;
  topsDerivedGeometryDetails.push(`${snapshot.boneKey}: ${snapshot.counts.triangles}->${postCounts.triangles}, removed=${removedTriangles.length}`);
});
check(topsDerivedGeometryPass,
  'TOPS postoperative surfaces are source-triangle subsets with posterior-only removal and preserved anterior body bounds',
  topsDerivedGeometryDetails.join('; '));

const actualTopsRoot = l4.hardwareLayer.children.find(root => root.userData.topsMotionDevice);
const actualTopsObjects = [];
actualTopsRoot?.traverse(object => actualTopsObjects.push(object));
const actualTopsScrews = actualTopsObjects.filter(object =>
  object.isGroup && /^TOPSPedicleScrew:[^:]+:(left|right)$/.test(object.name)
);
const actualTopsShafts = actualTopsObjects.filter(object => /^TOPSPedicleScrew:.*:shaft$/.test(object.name));
const actualTopsEndplates = actualTopsObjects.filter(object =>
  object.isMesh && /^TOPSTitaniumEndplate:(superior|inferior)$/.test(object.name)
);
const actualTopsArms = actualTopsObjects.filter(object =>
  object.isMesh && /^TOPSArm:(superior|inferior):(left|right)$/.test(object.name)
);
const actualTopsBoots = actualTopsObjects.filter(object =>
  object.isMesh && object.name === 'TOPSPolycarbonateUrethaneBoot'
);
test.getScene().updateMatrixWorld(true);
const derivedBoneUnion = new context.THREE.Box3();
topsPostoperativeSnapshots.forEach(snapshot => {
  const box = visibleRootBox(snapshot.postoperativeSurface);
  if (box) derivedBoneUnion.union(box);
});
const actualHardwareBox = visibleRootBox(actualTopsRoot);
const actualPartBoxes = [...actualTopsScrews, ...actualTopsEndplates, ...actualTopsBoots]
  .map(visibleRootBox);
const boneUnionMaximum = boxMaximumDimension(derivedBoneUnion);
const hardwareMaximum = boxMaximumDimension(actualHardwareBox);
const hardwareCenterDistance = actualHardwareBox && !derivedBoneUnion.isEmpty()
  ? actualHardwareBox.getCenter(new context.THREE.Vector3())
    .distanceTo(derivedBoneUnion.getCenter(new context.THREE.Vector3()))
  : Infinity;
const superiorEndplate = actualTopsEndplates.find(object => object.name.endsWith(':superior'));
const inferiorEndplate = actualTopsEndplates.find(object => object.name.endsWith(':inferior'));
const superiorCenter = visibleRootBox(superiorEndplate)?.getCenter(new context.THREE.Vector3());
const inferiorCenter = visibleRootBox(inferiorEndplate)?.getCenter(new context.THREE.Vector3());
const bootCenter = visibleRootBox(actualTopsBoots[0])?.getCenter(new context.THREE.Vector3());
const endplateAxis = superiorCenter && inferiorCenter
  ? superiorCenter.clone().sub(inferiorCenter) : new context.THREE.Vector3();
const bootEndplateFraction = bootCenter && endplateAxis.lengthSq() > 1e-9
  ? bootCenter.clone().sub(inferiorCenter).dot(endplateAxis) / endplateAxis.lengthSq()
  : Infinity;
check(Boolean(actualTopsRoot)
    && actualTopsScrews.length === 4 && actualTopsShafts.length === 4
    && actualTopsEndplates.length === 2 && actualTopsArms.length === 4 && actualTopsBoots.length === 1
    && !actualTopsObjects.some(object => object.name === 'TOPSInternalArticulationEnvelope')
    && actualTopsRoot.userData.topsMotionDevice?.crossbarCount === 2
    && actualTopsRoot.userData.topsMotionDevice?.armCount === 4
    && actualTopsRoot.userData.topsMotionDevice?.bootCount === 1
    && actualTopsRoot.userData.topsMotionDevice?.proprietaryInternalMechanismRendered === false
    && finiteObjectTree(actualTopsRoot)
    && [...actualTopsScrews, ...actualTopsEndplates, ...actualTopsBoots].every(finiteObjectTree)
    && actualPartBoxes.every(box => box && boxMaximumDimension(box) > 0 && boxMaximumDimension(box) <= 6)
    && actualHardwareBox && hardwareMaximum > 0
    && hardwareMaximum <= Math.max(6, boneUnionMaximum * 2.25)
    && hardwareCenterDistance <= boneUnionMaximum * 1.25
    && bootEndplateFraction >= .1 && bootEndplateFraction <= .9,
  'scene-parented TOPS hardware has four bounded screws, two bounded crossbars, four arms, and one central finite boot',
  `hardwareMax=${hardwareMaximum}, boneMax=${boneUnionMaximum}, bootFraction=${bootEndplateFraction}`);

const initialL45Factor = test.getState().levelFactors['L4-L5'] || {};
test.setLevelFactor('L4-L5', {
  sagittalWedge: 10,
  coronalWedge: 6,
  axialRotation: 5,
  apTranslation: 3,
  lateralTranslation: 2
});
test.getScene().updateMatrixWorld(true);
const topsTulipAnchorErrors = [];
for (const snapshot of topsPostoperativeSnapshots) {
  const bounds = snapshot.indexedBounds;
  const center = bounds.getCenter(new context.THREE.Vector3());
  const size = bounds.getSize(new context.THREE.Vector3());
  const ownerSurface = snapshot.postoperativeSurface || snapshot.surface;
  for (const side of [-1, 1]) {
    const sideName = side > 0 ? 'left' : 'right';
    const assembly = actualTopsScrews.find(object => object.name === `TOPSPedicleScrew:${snapshot.boneKey}:${sideName}`);
    const sourceStart = center.clone().add(new context.THREE.Vector3(size.x * .40, 0, side * size.z * .27));
    const sourceTarget = center.clone().add(new context.THREE.Vector3(-size.x * .22, -size.y * .04, side * size.z * .06));
    if (!ownerSurface) {
      topsTulipAnchorErrors.push(Infinity);
      continue;
    }
    const expectedStartWorld = ownerSurface.localToWorld(sourceStart);
    const expectedTargetWorld = ownerSurface.localToWorld(sourceTarget);
    const expectedDirectionWorld = expectedTargetWorld.clone().sub(expectedStartWorld).normalize();
    const expectedTulipWorld = expectedStartWorld.clone().addScaledVector(
      expectedDirectionWorld,
      -Math.max(8, topsScrewComponent.dimensionsMm.outerDiameter * 1.7) * .55 * harness.millimetresToScene
    );
    const actualTulipWorld = assembly?.userData?.tulipCenterLocal
      ? actualTopsRoot.localToWorld(new context.THREE.Vector3().fromArray(assembly.userData.tulipCenterLocal))
      : null;
    topsTulipAnchorErrors.push(actualTulipWorld ? actualTulipWorld.distanceTo(expectedTulipWorld) : Infinity);
  }
}
const liveTopsRows = actualTopsRoot?.userData?.topsMotionDevice?.rows;
const liveSuperiorArmAxis = new context.THREE.Vector3().fromArray(liveTopsRows?.superior?.displayedArmAxis || [0, 0, 0]);
const liveInferiorArmAxis = new context.THREE.Vector3().fromArray(liveTopsRows?.inferior?.displayedArmAxis || [0, 0, 0]);
const liveArmAngleDeg = context.THREE.MathUtils.radToDeg(liveSuperiorArmAxis.angleTo(liveInferiorArmAxis));
check(typeof actualTopsRoot?.updateTopsKinematicBinding === 'function'
    && topsTulipAnchorErrors.length === 4
    && topsTulipAnchorErrors.every(error => error <= 1e-5)
    && near(liveArmAngleDeg, 14, 1e-6),
  'TOPS keeps both screw rows attached to their owning vertebrae through combined three-plane edits and renders the selected arm angle',
  `maxTulipError=${Math.max(...topsTulipAnchorErrors)}, armAngle=${liveArmAngleDeg}`);
test.setLevelFactor('L4-L5', {
  sagittalWedge: Number(initialL45Factor.sagittalWedge) || 0,
  coronalWedge: Number(initialL45Factor.coronalWedge) || 0,
  axialRotation: Number(initialL45Factor.axialRotation) || 0,
  apTranslation: Number(initialL45Factor.apTranslation) || 0,
  lateralTranslation: Number(initialL45Factor.lateralTranslation) || 0
});

test.setView('pre');
check(topsPostoperativeSnapshots.every(snapshot => snapshot.record.geometryMode === 'ct_reference'
    && snapshot.record.referenceLayer === snapshot.layer && snapshot.layer.visible
    && snapshot.layer.children.includes(snapshot.surface)
    && snapshot.surface.geometry === snapshot.geometry
    && snapshot.surface.geometry.uuid === snapshot.geometryUuid
    && geometryCounts(snapshot.surface.geometry).triangles === snapshot.counts.triangles
    && boxesNear(indexedGeometryBounds(snapshot.surface.geometry).box, snapshot.indexedBounds)
    && numericArraysNear(worldMatrixSnapshot(snapshot.surface), snapshot.worldMatrix)
    && !snapshot.postoperativeLayer.visible
    && snapshot.postoperativeLayer.children[0] === snapshot.postoperativeSurface)
    && !l4.hardwareLayer.visible && !l5.hardwareLayer.visible
    && !l4.cutSurfaces.visible && !l4.decompressionVoid.visible
    && !l5.cutSurfaces.visible && !l5.decompressionVoid.visible,
  'TOPS pre-op restores the exact intact L4/L5 CT surfaces and hides derived surfaces, hardware, and resection display');

test.setView('post');
check(topsPostoperativeSnapshots.every(snapshot => snapshot.record.geometryMode === 'ct_derived_post_decompression'
    && !snapshot.layer.visible && snapshot.postoperativeLayer.visible
    && snapshot.postoperativeLayer.children[0] === snapshot.postoperativeSurface),
  'TOPS post-op reuses the same derived surfaces after a reversible pre-op comparison');

harness.setScenario([]);
check(topsIntactSnapshots.every(snapshot => snapshot.record.geometryMode === 'ct_reference'
    && snapshot.layer.visible && snapshot.layer.children.includes(snapshot.surface)
    && snapshot.surface.geometry === snapshot.geometry
    && snapshot.surface.geometry.uuid === snapshot.geometryUuid
    && geometryCounts(snapshot.surface.geometry).triangles === snapshot.counts.triangles
    && !snapshot.record.topsResectionContext
    && !snapshot.record.topsPostoperativeReferenceLayer.visible
    && snapshot.record.topsPostoperativeReferenceLayer.children.length === 0
    && snapshot.record.topsPostoperativeReferenceLayer.userData.geometryMode === 'not_active')
    && !l4.topsReconstruction && !l5.topsAdjacentResection
    && l4.hardwareLayer.children.length === 0,
  'removing the TOPS scenario disposes derived shells and restores untouched source CT anatomy');

const l2 = segments.get('L2-L3');
const psoPlan = harness.buildPlan('pso', 'L2-L3');
harness.setScenario([{
  levelId: 'L2-L3', procedureId: 'pso', plannedAngle: 30, plannedAngleSource: 'user_planned', implantPlan: psoPlan
}]);
check(l2.osteotomyType === 'osteotomy_wedge'
    && l2.geometryMode === 'ct_reference' && l2.referenceLayer.visible
    && !l2.body.visible && !l2.endplates.visible && !l2.posteriorElement.visible,
  'PSO retains the intact CT surface and never exposes the generic full-body slab',
  l2.geometryMode);
check(l2.osteotomyRemnants.visible && l2.cutSurfaces.visible && l2.decompressionVoid.visible
    && objectNames(l2.osteotomyRemnants).includes('plannedPsoThreeColumnWedge')
    && l2.osteotomyRemnants.userData.ctMeshSubtracted === false
    && l2.osteotomyRemnants.userData.cutSafetyValidated === false
    && String(l2.decompressionVoid.userData.mode).includes('intact CT mesh is not subtracted')
    && String(l2.decompressionVoid.userData.mode).includes('cut safety is not inferred'),
  'PSO shows only localized non-subtractive wedge/cut envelopes with fail-closed safety wording');
const psoReferenceMax = boxMaximumDimension(visibleRootBox(l2.referenceLayer));
const psoWedgeMax = boxMaximumDimension(visibleRootBox(l2.osteotomyRemnants));
check(psoReferenceMax > 0 && psoWedgeMax > 0 && psoWedgeMax <= psoReferenceMax * 1.05,
  'PSO wedge envelope stays bounded by the operated CT vertebra',
  JSON.stringify({ referenceMax: psoReferenceMax, wedgeMax: psoWedgeMax }));

const l3 = segments.get('L3-L4');
const spoPlan = harness.buildPlan('spo', 'L3-L4');
harness.setScenario([{
  levelId: 'L3-L4', procedureId: 'spo', plannedAngle: 10, plannedAngleSource: 'user_planned', implantPlan: spoPlan
}]);
check(l3.osteotomyType === 'osteotomy_post'
    && l3.geometryMode === 'ct_reference' && l3.referenceLayer.visible
    && !l3.body.visible && !l3.endplates.visible && !l3.posteriorElement.visible
    && !l3.osteotomyRemnants.visible,
  'SPO retains the intact CT surface and never exposes a generic full-body slab',
  l3.geometryMode);
check(l3.cutSurfaces.visible && l3.decompressionVoid.visible
    && l3.cutSurfaces.userData.frameSource === 'source_ct_bounding_frame'
    && String(l3.decompressionVoid.userData.mode).includes('SPO posterior closing-wedge')
    && String(l3.decompressionVoid.userData.mode).includes('cut safety is not inferred'),
  'SPO uses source-bounded posterior cut/resection envelopes with fail-closed safety wording');
const spoReferenceMax = boxMaximumDimension(visibleRootBox(l3.referenceLayer));
const spoCutMax = Math.max(
  boxMaximumDimension(visibleRootBox(l3.cutSurfaces)),
  boxMaximumDimension(visibleRootBox(l3.decompressionVoid))
);
check(spoReferenceMax > 0 && spoCutMax > 0 && spoCutMax <= spoReferenceMax * .75,
  'SPO resection overlays remain localized within the operated vertebral envelope',
  JSON.stringify({ referenceMax: spoReferenceMax, overlayMax: spoCutMax }));

const pelvisReference = test.getPelvisReferenceLayer();
const pelvisCounts = pelvisReference.children.reduce((totals, surface) => {
  const counts = geometryCounts(surface.geometry);
  totals.vertices += counts.vertices;
  totals.triangles += counts.triangles;
  return totals;
}, { vertices: 0, triangles: 0 });
check(pelvisReference.children.length === 3
    && pelvisReference.userData.geometryMode === 'ct_reference'
    && ['ctReferenceSurface:sacrum', 'ctReferenceSurface:hip_left', 'ctReferenceSurface:hip_right']
      .every(name => pelvisReference.children.some(child => child.name === name)),
  'pelvis reference layer contains three coherent CT meshes');
check(pelvisCounts.vertices === 10363 && pelvisCounts.triangles === 20998,
  'pelvis reference subset matches expected atlas totals', JSON.stringify(pelvisCounts));
check(test.getSIJoints().children.length >= 2
    && test.getSIJoints().parent === test.getPelvis()
    && test.getPelvicHardware().parent === test.getPelvis()
    && test.getPelvicHardware() !== pelvisReference,
  'SI and pelvic hardware layers remain separate from CT pelvis reference');

const s2aiPlan = harness.buildPlan('s2aiFixation', 'PELVIS-SI', {
  screwDiameter: 8.5, screwLength: 80, rodDiameter: 5.5, rodLength: 100
});
harness.setScenario([{ levelId: 'PELVIS-SI', procedureId: 's2aiFixation', implantPlan: s2aiPlan }]);
check(pelvisReference.children.length === 3 && pelvisReference.visible
    && !test.getSIJoints().visible && test.getPelvicHardware().visible
    && test.getPelvicHardware().children.length > 0,
  'pelvic fixation preserves CT pelvis, respects hidden SI overlays, and adds catalog hardware');

// Exercise every compatible procedure/target pair through plan construction,
// hardware rebuild, post-op geometry policy, and world-transform evaluation.
// This is intentionally broader than one representative level per procedure:
// a path is only considered audited when its exact compatibility pair ran.
const compatibleProcedurePaths = [];
for (const [procedureId, procedure] of Object.entries(test.PROCEDURES)) {
  for (const target of test.SURGICAL_TARGETS) {
    if (test.isProcedureCompatible(procedure, target)) {
      compatibleProcedurePaths.push({ procedureId, target });
    }
  }
}
const procedurePathFailures = [];
let auditedProcedurePaths = 0;
for (const pathCase of compatibleProcedurePaths) {
  const { procedureId, target } = pathCase;
  const pathLabel = `${procedureId}@${target.id}`;
  try {
    const plan = harness.buildPlan(procedureId, target.id, procedureId === 'siFusion' ? {
      custom: true,
      customLabel: 'Generic trans-SI audit envelope',
      customScrewDiameter: 8.5,
      customScrewLength: 80
    } : undefined);
    const auditedProcedure = test.PROCEDURES[procedureId];
    const visualizationContract = test.PROCEDURE_VISUALIZATION_CONTRACTS[procedureId];
    if (!visualizationContract) throw new Error('missing visualization contract');
    const planRoles = new Set((plan.components || []).map(component => component.role));
    const missingRequiredRoles = visualizationContract.requiredPlanRoles
      .filter(role => !planRoles.has(role));
    if (missingRequiredRoles.length) {
      throw new Error(`missing required plan roles: ${missingRequiredRoles.join(', ')}`);
    }
    const items = [];
    if (procedureId === 'tops') {
      items.push({
        levelId: target.id, procedureId: 'laminectomy',
        implantPlan: harness.buildPlan('laminectomy', target.id)
      });
    }
    items.push({ levelId: target.id, procedureId, implantPlan: plan });
    harness.setScenario(items);

    if (target.id === 'PELVIS-SI') {
      const pelvicRoots = [
        test.getPelvisReferenceLayer(), harness.pelvisAnatomyLayer,
        test.getSIJoints(), test.getPelvicLigaments(), test.getPelvicHardware()
      ].filter(Boolean);
      if (!pelvicRoots.every(finiteObjectTree)) throw new Error('non-finite pelvic transform or geometry');
      const maximumPelvicPathDimension = Math.max(...pelvicRoots.map(root => boxMaximumDimension(visibleRootBox(root))), 0);
      if (!(maximumPelvicPathDimension <= 8)) {
        throw new Error(`unreasonable pelvic path bound ${maximumPelvicPathDimension}`);
      }
    } else {
      const record = segments.get(target.hostSegmentId || target.id);
      if (!record) throw new Error('missing segment record');
      const procedureRoot = record.hardwareLayer.children
        .find(child => child.userData?.procedureId === procedureId);
      if (!procedureRoot) throw new Error('missing procedure hardware/anatomy root');
      const affectedRecords = [record];
      if (procedureId === 'tops') {
        const inferiorRecord = [...segments.values()]
          .find(candidate => candidate.level.superior === record.level.inferior);
        if (!inferiorRecord) throw new Error('missing TOPS inferior-bone record');
        affectedRecords.push(inferiorRecord);
      }
      affectedRecords.forEach((affectedRecord, affectedIndex) => {
        const roots = recordVisualRoots(affectedRecord);
        if (!roots.every(finiteObjectTree)) throw new Error('non-finite segment transform or geometry');
        const hasReference = affectedRecord.referenceLayer.children.length > 0;
        if (procedureId === 'tops') {
          const role = affectedIndex === 0 ? 'superior' : 'inferior';
          const boneKey = affectedRecord.level.superior;
          const sourceSurface = affectedRecord.referenceLayer.children
            .find(object => object.name === `ctReferenceSurface:${boneKey}`);
          const postoperativeSurface = affectedRecord.topsPostoperativeReferenceLayer?.children
            .find(object => object.name === `topsPostDecompressionSurface:${boneKey}:${role}`);
          if (!hasReference || !sourceSurface || !postoperativeSurface
            || affectedRecord.geometryMode !== 'ct_derived_post_decompression'
            || affectedRecord.referenceLayer.visible
            || !affectedRecord.topsPostoperativeReferenceLayer.visible
            || affectedRecord.topsPostoperativeReferenceLayer.children.length !== 1
            || affectedRecord.topsPostoperativeReferenceLayer.userData.openSurface !== true
            || affectedRecord.topsResectionContext?.treatedLevelId !== target.id
            || affectedRecord.topsResectionContext?.boneKey !== boneKey
            || affectedRecord.topsResectionContext?.role !== role
            || geometryCounts(postoperativeSurface.geometry).triangles <= 0
            || geometryCounts(postoperativeSurface.geometry).triangles >= geometryCounts(sourceSurface.geometry).triangles) {
            throw new Error(`invalid TOPS ${role} postoperative surface for ${boneKey}`);
          }
        } else if (hasReference && auditedProcedure?.wholeBodyResection === true) {
          if (affectedRecord.geometryMode !== 'schematic_morph_fallback'
              || affectedRecord.referenceLayer.visible
              || affectedRecord.body.visible
              || affectedRecord.endplates.visible) {
            throw new Error(`invalid complete-body resection geometry mode ${affectedRecord.geometryMode}`);
          }
        } else if (hasReference) {
          if (affectedRecord.geometryMode !== 'ct_reference' || !affectedRecord.referenceLayer.visible) {
            throw new Error(`unexpected geometry mode ${affectedRecord.geometryMode}`);
          }
        }
        if (hasReference
          && auditedProcedure?.wholeBodyResection !== true
          && (affectedRecord.body.visible || affectedRecord.endplates.visible || affectedRecord.posteriorElement.visible)) {
          throw new Error('generic full-vertebra semantic geometry became visible');
        }
        const referenceRoots = [affectedRecord.referenceLayer, affectedRecord.topsPostoperativeReferenceLayer]
          .filter(Boolean);
        const referenceMax = Math.max(...referenceRoots
          .map(root => boxMaximumDimension(visibleRootBox(root))), 0);
        const nonReferenceMax = Math.max(...roots
          .filter(root => !referenceRoots.includes(root))
          .map(root => boxMaximumDimension(visibleRootBox(root))), 0);
        const dimensionLimit = Math.max(procedureId === 'tops' ? 6 : 2.5, referenceMax * 2.25);
        if (!(nonReferenceMax <= dimensionLimit)) {
          throw new Error(`unreasonable local geometry bound ${nonReferenceMax} > ${dimensionLimit}`);
        }
      });
      if (auditedProcedure?.interbodyApproach) {
        const cages = [];
        record.hardwareLayer.traverse(object => {
          if (object.name.startsWith('catalogInterbodyCage')) cages.push(object);
        });
        const expectedCages = auditedProcedure.interbodyApproach === 'plif' ? 2 : 1;
        if (cages.length !== expectedCages) throw new Error(`interbody cage count ${cages.length} != ${expectedCages}`);
        if (!record.discExcised || record.disc.visible || !record.interbodyResectionEnvelope?.visible) {
          throw new Error('interbody disc/resection visibility failed');
        }
        if (!cages.every(cage => cage.userData.approach === auditedProcedure.interbodyApproach
            && cage.userData.sourceBoundedAnchor === true
            && cage.userData.approachCorridorModeled === false
            && cage.userData.containmentAssessed === false
            && cage.userData.fitValidated === false)) {
          throw new Error('interbody approach metadata did not fail closed');
        }
      }
      if (visualizationContract.mode === 'withheld') {
        if (procedureRoot.userData.hardwareWithheld !== true) {
          throw new Error('withheld visualization contract rendered unsupported hardware');
        }
        if (procedureId === 'lumbarTdr' && (record.discExcised || !record.disc.visible)) {
          throw new Error('withheld lumbar TDR removed the native disc');
        }
      }
      if (procedureId === 'laminoplasty') {
        const names = [];
        procedureRoot.traverse(object => { if (object.isMesh) names.push(object.name); });
        if (!record.laminoplasty
            || !names.includes('laminoplastyHingeEnvelope')
            || !names.includes('laminoplastyOpeningCutEnvelope')) {
          throw new Error('laminoplasty did not create its source-bounded hinge/opening anatomy envelope');
        }
      }
      if (procedureId === 'kyphoplasty') {
        const cement = [];
        procedureRoot.traverse(object => {
          if (object.name.startsWith('kyphoplastyCementEnvelope:')) cement.push(object);
        });
        if (cement.length !== 2 || procedureRoot.userData.augmentationRendered !== true) {
          throw new Error('kyphoplasty did not create bilateral source-bounded cement envelopes');
        }
      }
      if (procedureId === 'pcoGrade1') {
        const partialFacetMarkers = [];
        procedureRoot.traverse(object => {
          if (object.name.startsWith('grade1PartialFacetResectionEnvelope:')) partialFacetMarkers.push(object);
        });
        if (partialFacetMarkers.length !== 2
            || !record.disruptedLigaments.has('facet_capsule')
            || record.disruptedLigaments.has('ligamentum_flavum')) {
          throw new Error('grade-1 PCO anatomy/ligament footprint is incomplete');
        }
      }
      if (auditedProcedure?.wholeBodyResection === true) {
        const reconstruction = [];
        procedureRoot.traverse(object => {
          if (object.name === 'corpectomyStrut') reconstruction.push(object);
        });
        if (reconstruction.length !== 1
            || procedureRoot.userData.anteriorSupportRendered !== true
            || !(procedureRoot.userData.reconstructionSpanSceneUnits
              > procedureRoot.userData.resectedBodyHeightSceneUnits)) {
          throw new Error('complete-body reconstruction does not continuously span its adjacent disc defects');
        }
      }
      if (auditedProcedure?.mandatorySupplementalFixation === true
          && procedureRoot.userData.posteriorSupportRendered !== true) {
        throw new Error('mandatory posterior support was not rendered');
      }
      if (procedureId === 'osteotomyGrade4') {
        const consumed = test.consumedDiscSegmentIdsFor(auditedProcedure, target.id);
        if (record.bodyResected
            || consumed.length !== 1
            || consumed[0] !== target.cranialSegmentId
            || !segments.get(target.cranialSegmentId)?.discExcised
            || segments.get(target.caudalSegmentId)?.discExcised) {
          throw new Error('grade-4 extended PSO did not preserve the body and limit disc resection to the declared proximal disc');
        }
      }
    }
    auditedProcedurePaths += 1;
  } catch (error) {
    procedurePathFailures.push(`${pathLabel}: ${error.message}`);
  }
}
check(auditedProcedurePaths === compatibleProcedurePaths.length
    && procedurePathFailures.length === 0,
  `all ${compatibleProcedurePaths.length} compatible procedure/target geometry paths remain finite and locally bounded`,
  procedurePathFailures.join('\n'));

const impossibleProcedurePairs = [
  [{ procedureId: 'acr', levelId: 'L3-L4' }, { procedureId: 'alif', levelId: 'L3-L4' }],
  [{ procedureId: 'lumbarTdr', levelId: 'L4-L5' }, { procedureId: 'alif', levelId: 'L4-L5' }],
  [{ procedureId: 'pcoGrade1', levelId: 'L3-L4' }, { procedureId: 'spo', levelId: 'L3-L4' }],
  [{ procedureId: 'kyphoplasty', levelId: 'BODY-L4' }, { procedureId: 'thoracolumbarCorpectomy', levelId: 'BODY-L4' }],
  [{ procedureId: 'laminoplasty', levelId: 'C4-C5' }, { procedureId: 'laminectomy', levelId: 'C4-C5' }],
  [{ procedureId: 'c1c2Fusion', levelId: 'C1-C2' }, { procedureId: 'pcf', levelId: 'C1-C2' }],
  [{ procedureId: 'vcr', levelId: 'BODY-L4' }, { procedureId: 'pedicleScrews', levelId: 'L4-L5' }],
  [{ procedureId: 'osteotomyGrade4', levelId: 'BODY-L4' }, { procedureId: 'pedicleScrews', levelId: 'L4-L5' }],
  [{ procedureId: 'vcr', levelId: 'BODY-L4' }, { procedureId: 'vcr', levelId: 'BODY-L5' }]
];
const rejectedImpossiblePairs = impossibleProcedurePairs.filter(([left, right]) => {
  const leftAfterRight = test.findProcedureConflict(left.procedureId, left.levelId, [right]);
  const rightAfterLeft = test.findProcedureConflict(right.procedureId, right.levelId, [left]);
  return Boolean(leftAfterRight) && Boolean(rightAfterLeft);
});
check(rejectedImpossiblePairs.length === impossibleProcedurePairs.length,
  'semantic occupancy rejects every audited impossible procedure pair in both insertion orders',
  `${rejectedImpossiblePairs.length}/${impossibleProcedurePairs.length} pairs rejected bidirectionally`);

const acrLigamentPlan = harness.buildPlan('acr', 'L3-L4');
harness.setScenario([{ levelId: 'L3-L4', procedureId: 'acr', implantPlan: acrLigamentPlan }]);
const acrLigamentRecord = segments.get('L3-L4');
check(acrLigamentRecord.ligaments.all.userData.interrupted === true
    && acrLigamentRecord.ligaments.pll.userData.interrupted !== true
    && acrLigamentRecord.ligaments.interspinous.userData.interrupted !== true,
  'ACR interrupts only its declared ALL pathway in the visual ligament layer');

const gradeOneLigamentPlan = harness.buildPlan('pcoGrade1', 'L3-L4');
harness.setScenario([{ levelId: 'L3-L4', procedureId: 'pcoGrade1', implantPlan: gradeOneLigamentPlan }]);
const gradeOneLigamentRecord = segments.get('L3-L4');
check(gradeOneLigamentRecord.ligaments.capsular.left.userData.interrupted === true
    && gradeOneLigamentRecord.ligaments.capsular.right.userData.interrupted === true
    && gradeOneLigamentRecord.ligaments.flavum.left.userData.interrupted !== true
    && gradeOneLigamentRecord.ligaments.interspinous.userData.interrupted !== true,
  'grade-1 PCO interrupts facet capsules while preserving flavum and posterior tension-band pathways');

const threePlaneBaseline = {
  coronalMagnitude: 40, coronalDirection: 'right', compensatoryCobb: 20,
  trunkShift: 24, axialRotation: 12, secondaryFlexibility: .5
};
const threePlanePlan = [{
  procedureId: 'xlif', levelId: 'L3-L4',
  plannedCoronal: -20, plannedAxialRotation: -10, plannedTranslationMm: -20
}];
const compensationOff = test.computeThreePlaneScenario(threePlaneBaseline, threePlanePlan, { applyCoronalCompensation: false });
const compensationPartial = test.computeThreePlaneScenario(threePlaneBaseline, threePlanePlan, { applyCoronalCompensation: true });
const compensationRigid = test.computeThreePlaneScenario({ ...threePlaneBaseline, secondaryFlexibility: 0 }, threePlanePlan, { applyCoronalCompensation: true });
const compensationFlexible = test.computeThreePlaneScenario({ ...threePlaneBaseline, secondaryFlexibility: 1 }, threePlanePlan, { applyCoronalCompensation: true });
check(compensationOff.outputs.primaryCobb === 20 && compensationOff.outputs.secondaryCobb === -20
    && compensationOff.flexibility.responseFraction === 0,
  'three-plane surrogate keeps secondary response off by default');
check(compensationPartial.outputs.secondaryCobb === -15 && compensationPartial.flexibility.responseFraction === .25,
  'partly flexible secondary curve responds fractionally to primary improvement');
check(compensationRigid.outputs.secondaryCobb === -20 && compensationFlexible.outputs.secondaryCobb === -10,
  'structural and fully flexible compensation cases remain distinct and bounded');
check(Object.values(compensationPartial.outputs).every(Number.isFinite)
    && Math.abs(compensationPartial.outputs.primaryCobb) <= 120
    && Math.abs(compensationPartial.outputs.secondaryCobb) <= 100
    && Math.abs(compensationPartial.outputs.apicalTranslation) <= 150
    && Math.abs(compensationPartial.outputs.axialRotation) <= 90,
  'three-plane surrogate outputs are finite and inside declared engineering bounds');

const xlifPlan = harness.buildPlan('xlif', 'L3-L4');
test.setGlobalDeformity(threePlaneBaseline);
harness.setScenario([{ levelId: 'L3-L4', procedureId: 'xlif', plannedCoronal: -20, plannedAxialRotation: -10, plannedTranslationMm: -20, implantPlan: xlifPlan }]);
const threePlaneRecord = segments.get('L3-L4');
const threePlaneRoots = recordVisualRoots(threePlaneRecord);
const threePlaneReferenceMax = boxMaximumDimension(visibleRootBox(threePlaneRecord.referenceLayer));
const threePlaneNonReferenceMax = Math.max(...threePlaneRoots.filter(root => root !== threePlaneRecord.referenceLayer).map(root => boxMaximumDimension(visibleRootBox(root))), 0);
check(threePlaneRoots.every(finiteObjectTree)
    && threePlaneNonReferenceMax <= Math.max(2.5, threePlaneReferenceMax * 2.25),
  'three-plane XLIF rigid transforms remain finite without local geometry explosion',
  JSON.stringify({ referenceMax: threePlaneReferenceMax, nonReferenceMax: threePlaneNonReferenceMax }));
test.setGlobalDeformity({ coronalMagnitude: 0, coronalDirection: 'right', compensatoryCobb: 0, trunkShift: 0, axialRotation: 0, secondaryFlexibility: .5 });

const mechanics = test.MODEL_MANIFEST.mechanics;
const numerical = test.calculateBiomechanics(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22, measuredSva: null }, []
);
check(mechanics.status === 'locked_pending_verification_and_validation'
    && mechanics.renderGeometryIsComputationalModel === false
    && test.MODEL_MANIFEST.anatomy.renderGeometryIsScrewPlanningModel === false,
  'mechanics and screw-planning claims remain fail-closed');
check(mechanics.disabledOutputs.every(key => !(key in numerical) && !(key in numerical.outputs))
    && String(getElement('mechanicsStress').textContent).includes('Unavailable'),
  'disabled mechanics outputs remain absent and UI stays locked');

const emptySurveillance = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 }, [], {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 48 }
);
check(emptySurveillance.markers.length === 0
    && emptySurveillance.modelId === 'postoperative-construct-review-v3'
    && emptySurveillance.constructTopology.modelId === 'construct-topology-v3'
    && emptySurveillance.probabilityStatus === 'not_calculated'
    && emptySurveillance.scoreStatus === 'not_calculated'
    && !('probability' in emptySurveillance) && !('riskScore' in emptySurveillance),
  'postoperative surveillance stays descriptive and emits no probability or score');

const missingAlifPlanTopology = test.deriveConstructTopology([{
  procedureId: 'alif', levelId: 'L4-L5'
}]);
const missingAlifPlanSegment = missingAlifPlanTopology.byLevel['L4-L5'];
check(missingAlifPlanSegment.state === 'planned_fusion_fixation_unverified'
    && missingAlifPlanSegment.fusionIntent === true
    && missingAlifPlanSegment.posteriorFixationPlanned === false
    && missingAlifPlanSegment.interbodySupportPlanned === false
    && missingAlifPlanSegment.constructSupportStatus === 'not_established'
    && missingAlifPlanSegment.supportProvenance === 'implant_plan_snapshot_missing'
    && missingAlifPlanSegment.implantPlanSnapshotsPresent === 0
    && missingAlifPlanSegment.implantPlanSnapshotsMissing === 1
    && missingAlifPlanSegment.implantRoles.length === 0,
  'missing ALIF implant-plan data fails closed without inferring a cage or posterior fixation',
  JSON.stringify(missingAlifPlanSegment));

const singleAlifTopology = test.deriveConstructTopology([{
  procedureId: 'alif', levelId: 'L4-L5', implantPlan: alifPlan
}]);
const singleAlifSegment = singleAlifTopology.byLevel['L4-L5'];
const singleAlifAdjacent = test.computeAdjacentMobileLevels(
  [{ procedureId: 'alif', levelId: 'L4-L5', implantPlan: alifPlan }],
  singleAlifTopology
);
check(singleAlifSegment.state === 'planned_fusion_posterior_supported'
    && singleAlifSegment.fusionIntent === true
    && singleAlifSegment.posteriorFixationPlanned === true
    && singleAlifSegment.interbodySupportPlanned === true
    && singleAlifSegment.constructSupportStatus === 'posterior_screw_rod_support_present'
    && singleAlifSegment.supportProvenance === 'explicit_implant_plan_components'
    && ['fusion_cage', 'rod_set', 'screw_set'].every(role => singleAlifSegment.implantRoles.includes(role)),
  'L4-L5 ALIF topology derives the cage plus bilateral posterior screw-rod planned fusion from the actual implant plan',
  JSON.stringify(singleAlifSegment));
check(singleAlifAdjacent.length === 2
    && singleAlifAdjacent[0].levelId === 'L3-L4' && singleAlifAdjacent[0].relation === 'cranial'
    && singleAlifAdjacent[1].levelId === 'L5-S1' && singleAlifAdjacent[1].relation === 'caudal'
    && !singleAlifAdjacent.some(adjacent => adjacent.levelId === 'L4-L5'),
  'single-level L4-L5 ALIF identifies only L3-L4 and L5-S1 as construct transitions');

const singleAlifSurveillance = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 },
  [{ procedureId: 'alif', levelId: 'L4-L5', implantPlan: alifPlan }],
  {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 48 }
);
const singleAlifMarkerLevels = new Set(singleAlifSurveillance.markers.map(marker => marker.levelId));
check(singleAlifMarkerLevels.size === 2
    && singleAlifMarkerLevels.has('L3-L4') && singleAlifMarkerLevels.has('L5-S1')
    && !singleAlifMarkerLevels.has('L4-L5')
    && singleAlifSurveillance.markers.every(marker => marker.tone === 'transition'
      && marker.factors.some(factor => factor.id === 'construct_transition')
      && marker.factors.some(factor => factor.id === 'adjacent_construct_supported'
        && /posterior screw/i.test(factor.label + ' ' + factor.detail))),
  'ALIF surveillance marks neighboring transitions while explicitly recognizing posterior support at the operated segment');

const standaloneAlifPlan = harness.buildPlan('alif', 'L4-L5', {
  supplementalPosterior: false
});
const standaloneAlifTopology = test.deriveConstructTopology([{
  procedureId: 'alif', levelId: 'L4-L5', implantPlan: standaloneAlifPlan
}]);
const standaloneAlifSegment = standaloneAlifTopology.byLevel['L4-L5'];
const standaloneAlifSurveillance = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 },
  [{ procedureId: 'alif', levelId: 'L4-L5', implantPlan: standaloneAlifPlan }],
  {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 48 }
);
check(standaloneAlifPlan.components.some(component => component.role === 'fusion_cage')
    && !standaloneAlifPlan.components.some(component => ['screw_set', 'rod_set'].includes(component.role))
    && standaloneAlifSegment.state === 'planned_fusion_interbody_only'
    && standaloneAlifSegment.posteriorFixationPlanned === false
    && standaloneAlifSegment.interbodySupportPlanned === true
    && standaloneAlifSegment.constructSupportStatus === 'interbody_support_without_verified_posterior_fixation'
    && standaloneAlifSurveillance.markers.every(marker =>
      marker.factors.some(factor => factor.id === 'adjacent_construct_interbody_only')
        && !marker.factors.some(factor => factor.id === 'adjacent_construct_supported')),
  'explicit interbody-only ALIF remains cage-only and receives a distinct construct-review factor');

const alifWithLaminectomy = [
  { procedureId: 'alif', levelId: 'L4-L5', implantPlan: alifPlan },
  { procedureId: 'laminectomy', levelId: 'L4-L5' }
];
const alifLaminectomySurveillance = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 },
  alifWithLaminectomy,
  {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 48 }
);
const stabilizedLaminectomyMarker = alifLaminectomySurveillance.markers.find(marker => marker.levelId === 'L4-L5');
check(test.deriveConstructTopology(alifWithLaminectomy).byLevel['L4-L5'].state === 'planned_fusion_posterior_supported'
    && stabilizedLaminectomyMarker?.tone === 'stabilized'
    && stabilizedLaminectomyMarker.factors.some(factor => factor.id === 'posterior_disruption_spanned')
    && !stabilizedLaminectomyMarker.factors.some(factor => factor.id === 'unspanned_posterior_disruption'),
  'same-level ALIF posterior fixation reclassifies the laminectomy footprint as spanned rather than mobile or unstable');

const isolatedLaminectomySurveillance = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 },
  [{ procedureId: 'laminectomy', levelId: 'L4-L5' }],
  {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 48 }
);
const isolatedLaminectomyMarker = isolatedLaminectomySurveillance.markers.find(marker => marker.levelId === 'L4-L5');
check(isolatedLaminectomySurveillance.constructTopology.byLevel['L4-L5'].state === 'unspanned_posterior_disruption'
    && isolatedLaminectomyMarker?.tone === 'review'
    && isolatedLaminectomyMarker.factors.some(factor => factor.id === 'unspanned_posterior_disruption')
    && !isolatedLaminectomyMarker.factors.some(factor => factor.id === 'posterior_disruption_spanned'),
  'isolated laminectomy remains an amber review trigger without diagnosing instability');

const pediclePlan = harness.buildPlan('pedicleScrews', 'L4-L5');
const laminectomyWithFixationOnly = [
  { procedureId: 'laminectomy', levelId: 'L4-L5' },
  { procedureId: 'pedicleScrews', levelId: 'L4-L5', implantPlan: pediclePlan }
];
const fixationOnlyTopology = test.deriveConstructTopology(laminectomyWithFixationOnly);
const fixationOnlySurveillance = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 },
  laminectomyWithFixationOnly,
  {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 48 }
);
const fixationOnlyMarker = fixationOnlySurveillance.markers.find(marker => marker.levelId === 'L4-L5');
check(fixationOnlyTopology.byLevel['L4-L5'].state === 'instrumented_without_fusion_inferred'
    && fixationOnlyTopology.byLevel['L4-L5'].posteriorFixationPlanned === true
    && fixationOnlyTopology.byLevel['L4-L5'].fusionIntent === false
    && fixationOnlyMarker?.tone === 'review'
    && fixationOnlyMarker.factors.some(factor => factor.id === 'unspanned_posterior_disruption')
    && !fixationOnlyMarker.factors.some(factor => factor.id === 'posterior_disruption_spanned'),
  'fixation-only hardware is not silently promoted to a same-level fusion construct');

const spoTopology = test.deriveConstructTopology([{
  procedureId: 'spo', levelId: 'L3-L4', implantPlan: harness.buildPlan('spo', 'L3-L4')
}]);
const psoTopology = test.deriveConstructTopology([{
  procedureId: 'pso', levelId: 'L3-L4', implantPlan: harness.buildPlan('pso', 'L3-L4')
}]);
check([spoTopology, psoTopology].every(topology =>
  topology.byLevel['L3-L4'].state === 'planned_fusion_posterior_supported'
    && topology.byLevel['L3-L4'].fusionIntent === true
    && topology.byLevel['L3-L4'].posteriorFixationPlanned === true
    && topology.byLevel['L3-L4'].constructSupportStatus === 'posterior_screw_rod_support_present'
    && topology.byLevel['L3-L4'].posteriorDisruption === true),
  'SPO and PSO are construct-aware posterior fusion scenarios rather than unspanned osteotomy disruptions');

const laminectomyWithTops = [
  { procedureId: 'laminectomy', levelId: 'L4-L5' },
  { procedureId: 'tops', levelId: 'L4-L5', implantPlan: topsPlan }
];
const topsTopology = test.deriveConstructTopology(laminectomyWithTops);
const topsConstructSegment = topsTopology.byLevel['L4-L5'];
const topsConstructSurveillance = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 },
  laminectomyWithTops,
  {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 48 }
);
const topsConstructMarker = topsConstructSurveillance.markers.find(marker => marker.levelId === 'L4-L5');
check(topsConstructSegment.state === 'motion_preserving'
    && topsConstructSegment.motionPreservingStabilizationPlanned === true
    && topsConstructSegment.fixedForPlannedFusionSpan === false
    && topsConstructSegment.constructSupportStatus === 'motion_device_and_pedicle_screw_components_present'
    && topsConstructSegment.supportProvenance === 'explicit_implant_plan_components'
    && topsConstructSegment.implantRoles.includes('posterior_motion_device')
    && topsConstructSegment.implantRoles.includes('screw_set')
    && !topsConstructSegment.implantRoles.includes('rod_set')
    && topsConstructMarker?.tone === 'stabilized'
    && topsConstructMarker.factors.some(factor => factor.id === 'posterior_disruption_with_motion_device')
    && !topsConstructMarker.factors.some(factor =>
      ['posterior_disruption_spanned', 'unspanned_posterior_disruption'].includes(factor.id)),
  'laminectomy plus component-complete TOPS has a distinct motion-device disruption state without being labeled a fusion');

const incompleteTopsPlans = [
  { label: 'motion device only', components: topsPlan.components.filter(component => component.role === 'posterior_motion_device') },
  { label: 'screws only', components: topsPlan.components.filter(component => component.role === 'screw_set') },
  { label: 'missing plan', components: null }
];
const incompleteTopsStates = incompleteTopsPlans.map(entry => {
  const incompleteItem = { procedureId: 'tops', levelId: 'L4-L5' };
  if (entry.components) incompleteItem.implantPlan = { ...topsPlan, components: entry.components };
  const topology = test.deriveConstructTopology([
    { procedureId: 'laminectomy', levelId: 'L4-L5' },
    incompleteItem
  ]);
  return { label: entry.label, segment: topology.byLevel['L4-L5'] };
});
check(incompleteTopsStates.every(({ segment }) =>
  segment.state === 'unspanned_posterior_disruption'
    && segment.motionPreservingStabilizationPlanned === false
    && segment.constructSupportStatus === 'not_established'),
  'TOPS topology fails closed unless both posterior motion-device and screw-set roles are saved',
  JSON.stringify(incompleteTopsStates.map(({ label, segment }) => ({
    label, state: segment.state, roles: segment.implantRoles, support: segment.constructSupportStatus
  }))));

const cervicalAcdfPlan = harness.buildPlan('acdf', 'C4-C5');
const cervicalSurveillance = test.computePostoperativeSurveillance(
  { pi: 70, ll: 20, tk: 42, cl: -10, pt: 22 },
  [{ procedureId: 'acdf', levelId: 'C4-C5', implantPlan: cervicalAcdfPlan }],
  {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 20 }
);
const cervicalSurveillanceFactorIds = cervicalSurveillance.markers
  .flatMap(marker => marker.factors.map(factor => factor.id));
check(cervicalSurveillance.markers.length === 2
    && cervicalSurveillance.markers.every(marker =>
      ['C3-C4', 'C5-C6'].includes(marker.levelId)
        && marker.factors.some(factor => factor.id === 'construct_transition'))
    && !cervicalSurveillanceFactorIds.includes('modeled_pi_ll_departure')
    && !cervicalSurveillanceFactorIds.includes('thoracolumbar_upper_transition'),
  'isolated cervical fusion surveillance does not apply lumbar PI-LL or thoracolumbar transition factors');

const posteriorAlifItemsByLevel = Object.fromEntries(
  ['L1-L2', 'L2-L3', 'L3-L4', 'L4-L5', 'L5-S1'].map(levelId => [levelId, {
    procedureId: 'alif',
    levelId,
    implantPlan: harness.buildPlan('alif', levelId)
  }])
);
const disconnectedFusionItems = [
  posteriorAlifItemsByLevel['L1-L2'],
  posteriorAlifItemsByLevel['L2-L3'],
  posteriorAlifItemsByLevel['L4-L5'],
  posteriorAlifItemsByLevel['L5-S1']
];
const disconnectedFusionTopology = test.deriveConstructTopology(disconnectedFusionItems);
const disconnectedFusionIntervals = test.derivePlannedFusionIntervals(disconnectedFusionTopology);
const disconnectedFusionSurveillance = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 },
  disconnectedFusionItems,
  {},
  { applicabilityStatus: 'within_engineering_domain', newLL: 48 }
);
check(disconnectedFusionIntervals.length === 2
    && disconnectedFusionIntervals.every(interval => interval.segmentCount === 2)
    && disconnectedFusionSurveillance.plannedFusionSegmentCount === 4
    && !disconnectedFusionSurveillance.markers.some(marker =>
      marker.factors.some(factor => factor.id === 'long_construct')),
  'two disconnected two-level fusion intervals do not trigger the contiguous four-level construct flag');

const surveillanceScenario = test.computePostoperativeSurveillance(
  { pi: 52, ll: 48, tk: 42, cl: 18, pt: 22 },
  [
    posteriorAlifItemsByLevel['L1-L2'],
    posteriorAlifItemsByLevel['L2-L3'],
    posteriorAlifItemsByLevel['L3-L4'],
    posteriorAlifItemsByLevel['L4-L5'],
    { procedureId: 's2aiFixation', levelId: 'PELVIS-SI' },
    { procedureId: 'laminectomy', levelId: 'L1-L2' }
  ],
  { 'T12-L1': { discHeightLoss: 30, facetHypertrophy: 20, osteophyteBurden: 0 } },
  { applicabilityStatus: 'within_engineering_domain', newLL: 64 }
);
const proximalSurveillance = surveillanceScenario.markers.find(marker => marker.levelId === 'T12-L1');
const proximalFactorIds = new Set((proximalSurveillance?.factors || []).map(factor => factor.id));
const l1OperatedMarker = surveillanceScenario.markers.find(marker => marker.levelId === 'L1-L2');
const allSurveillanceFactorIds = surveillanceScenario.markers
  .flatMap(marker => marker.factors.map(factor => factor.id));
check(['construct_transition', 'adjacent_construct_supported', 'long_construct', 'modeled_pi_ll_departure',
  'authored_adjacent_degeneration', 'thoracolumbar_upper_transition']
  .every(id => proximalFactorIds.has(id))
    && l1OperatedMarker?.tone === 'stabilized'
    && l1OperatedMarker.factors.some(factor => factor.id === 'posterior_disruption_spanned')
    && !allSurveillanceFactorIds.includes('pelvic_fixation')
    && surveillanceScenario.pelvicFixationPresent === true
    && surveillanceScenario.pelvicConnectionStatus === 'not_inferred_without_explicit_connected_span'
    && surveillanceScenario.unknownInputs.some(label => /Hounsfield/i.test(label)),
  'surveillance exposes construct, alignment, degeneration, spanned-disruption, and unknown-input triggers without treating disconnected pelvic anchors as a global factor');

const neutralPreset = test.DEFORMITY_PRESETS.neutral;
const neutralConstructOptions = test.computeConstructComparisons(
  neutralPreset.alignment, neutralPreset.global, neutralPreset.levels
);
check(neutralConstructOptions.length === 0,
  'neutral authored inputs do not manufacture a construct comparison');

const targetCaseParams = { pi: 70, ll: 20, tk: 65, cl: -20, pt: 35, measuredSva: 12 };
const targetCaseGlobal = {
  coronalMagnitude: 40, coronalDirection: 'right', compensatoryCobb: 20,
  trunkShift: 30, axialRotation: 12, secondaryFlexibility: .5,
  cervicalSva: 70, t1Slope: 35, cbva: 20
};
const targetCaseTargets = test.derivePlanningTargets(targetCaseParams, targetCaseGlobal);
const targetCaseBefore = test.deriveResidualDeficits(targetCaseParams, targetCaseGlobal, [], {});
const existingTargetCorrection = [{
  id: 600,
  procedureId: 'alif',
  levelId: 'L4-L5',
  plannedAngle: 15,
  plannedAngleSource: 'user_planned',
  plannedCoronal: 0,
  plannedAxialRotation: 0,
  plannedTranslationMm: 0,
  implantPlan: test.buildDefaultSuggestedImplantPlan('alif', 'L4-L5')
}];
const targetCaseAfterExisting = test.deriveResidualDeficits(
  targetCaseParams,
  targetCaseGlobal,
  existingTargetCorrection,
  {}
);
// WP6/F081: the CL target was the atlas display calibration (18°) whatever the
// T1 slope. With this case's T1 slope of 35° that target is itself Ames T1S–CL
// '+' (17°), so the old expectation encoded the bug. The target is now T1 slope
// − 10° (inside the Ames '0' band): 35 − 10 = 25°, residual 25 − (−20) = 45°.
check(targetCaseTargets.modelId === 'educational-reference-targets-v1'
    && targetCaseTargets.lumbarLordosis === 70
    && targetCaseTargets.thoracicKyphosis === 42
    && targetCaseTargets.cervicalLordosis === 25
    && targetCaseTargets.primaryCobb === 0
    && targetCaseBefore.residual.lumbarLordosis === 50
    && targetCaseBefore.residual.thoracicKyphosis === 23
    && targetCaseBefore.residual.cervicalLordosis === 45
    && targetCaseBefore.residual.primaryCobb === 40
    && targetCaseAfterExisting.projected.lumbarLordosis === 35
    && targetCaseAfterExisting.residual.lumbarLordosis === 35
    && targetCaseAfterExisting.unaddressed.some(label => /SVA target/i.test(label)),
  'case targets and residuals are deterministic, itinerary-aware, and disclose unmodeled SVA response');

const nullSvaPhenotypes = test.deriveDeformityPhenotypes(
  { ...neutralPreset.alignment, pi: 62, measuredSva: null },
  neutralPreset.global,
  {}
);
const zeroSvaPhenotypes = test.deriveDeformityPhenotypes(
  { ...neutralPreset.alignment, pi: 62, measuredSva: 0 },
  neutralPreset.global,
  {}
);
const nullSvaReason = nullSvaPhenotypes.find(phenotype => phenotype.id === 'positive_sagittal')?.reason || '';
const zeroSvaReason = zeroSvaPhenotypes.find(phenotype => phenotype.id === 'positive_sagittal')?.reason || '';
check(nullSvaReason.length > 0
    && !/entered SVA/i.test(nullSvaReason)
    && /entered SVA 0 cm/i.test(zeroSvaReason),
  'missing measured SVA remains absent rather than being coerced to a measured zero');

const opposingJunctionalPhenotypes = test.deriveDeformityPhenotypes(
  neutralPreset.alignment,
  neutralPreset.global,
  {
    'T11-T12': { sagittalWedge: 6 },
    'T12-L1': { sagittalWedge: -6 }
  }
);
const positiveJunctionalPhenotypes = test.deriveDeformityPhenotypes(
  neutralPreset.alignment,
  neutralPreset.global,
  { 'T12-L1': { sagittalWedge: 8 } }
);
check(!opposingJunctionalPhenotypes.some(phenotype => phenotype.id === 'focal_junctional')
    && positiveJunctionalPhenotypes.some(phenotype => phenotype.id === 'focal_junctional'),
  'opposing junctional wedges do not sum absolute magnitudes into a false kyphotic trigger');

const zeroGlobalAxes = {
  ...neutralPreset.global,
  coronalMagnitude: 0,
  coronalDirection: 'right',
  compensatoryCobb: 0,
  trunkShift: 0,
  axialRotation: 0,
  secondaryFlexibility: 0
};
const localOnlyLumbarOptions = test.computeConstructComparisons(
  neutralPreset.alignment,
  zeroGlobalAxes,
  {
    'L3-L4': { coronalWedge: 5, axialRotation: 8, lateralTranslation: 5 }
  }
);
const localOnlyLateralBranch = localOnlyLumbarOptions
  .find(option => option.id === 'three-plane-lateral')
  ?.branches?.[0];
const localOnlyThoracicOptions = test.computeConstructComparisons(
  neutralPreset.alignment,
  zeroGlobalAxes,
  {
    'T7-T8': { coronalWedge: 6, axialRotation: 12, lateralTranslation: 5 }
  }
);
const localOnlyThoracicBranches = localOnlyThoracicOptions
  .find(option => option.id === 'thoracic-osteotomy-comparison')
  ?.branches || [];
const globalResidualAxesAreZero = evaluation => evaluation?.valid === true
  && ['primaryCobb', 'axialRotation', 'apicalTranslation'].every(key =>
    near(evaluation.before.residual[key], 0)
      && near(evaluation.after.residual[key], 0)
  );
check(localOnlyLateralBranch?.steps?.length === 1
    && localOnlyLateralBranch.steps[0].coronal === 0
    && localOnlyLateralBranch.steps[0].axial === 0
    && localOnlyLateralBranch.steps[0].translation === 0
    && globalResidualAxesAreZero(localOnlyLateralBranch.evaluation)
    && localOnlyThoracicBranches.length === 2
    && localOnlyThoracicBranches.every(branch =>
      branch.steps.every(step => step.coronal === 0 && step.axial === 0 && step.translation === 0)
        && globalResidualAxesAreZero(branch.evaluation)),
  'local three-plane factors may choose a level but cannot manufacture nonzero global coronal, axial, or translation residuals');

const flatbackPreset = test.DEFORMITY_PRESETS.flatback;
const flatbackConstructOptions = test.computeConstructComparisons(
  flatbackPreset.alignment, flatbackPreset.global, flatbackPreset.levels
);
const flatbackOptionIds = new Set(flatbackConstructOptions.map(option => option.id));
check(flatbackOptionIds.has('distributed-lumbar-interbody')
    && flatbackOptionIds.has('focal-pso-comparison'),
  'flatback phenotype offers both distributed interbody and focal PSO construct comparisons');
const distributedFlatback = flatbackConstructOptions.find(option => option.id === 'distributed-lumbar-interbody');
const distributedFlatbackEvaluation = distributedFlatback?.branches?.[0]?.evaluation;
check(distributedFlatbackEvaluation?.valid === true
    && distributedFlatbackEvaluation.candidates.length > 0
    && Math.abs(distributedFlatbackEvaluation.after.residual.lumbarLordosis)
      < Math.abs(distributedFlatbackEvaluation.before.residual.lumbarLordosis)
    && distributedFlatbackEvaluation.candidates.every(candidate =>
      candidate.implantPlan?.renderStatus === 'catalog_dimensions_available'),
  'flatback construct sequencing is tied to the current modeled residual and materializes explicit catalog-plan candidates');

const cervicalComparisonPreset = test.DEFORMITY_PRESETS['cervical-kyphosis'];
const cervicalConstructOptions = test.computeConstructComparisons(
  cervicalComparisonPreset.alignment,
  cervicalComparisonPreset.global,
  cervicalComparisonPreset.levels
);
const cervicalComparison = cervicalConstructOptions.find(option => option.id === 'cervical-anterior-posterior');
check(cervicalComparison
    && ['acdf', 'pcf'].every(procedureId => cervicalComparison.steps.some(step => step.procedureId === procedureId))
    && !cervicalComparison.steps.some(step => step.procedureId === 'discReplacement'),
  'cervical deformity comparison exposes signed ACDF and PCF branches without surfacing arthroplasty');
check(cervicalConstructOptions.length === 1
    && cervicalComparison.branches.length === 3
    && cervicalComparison.branches.some(branch =>
      branch.id === 'circumferential' && branch.sequence === true && branch.steps.length === 2)
    && cervicalComparison.steps.every(step =>
      test.SURGICAL_TARGETS.find(level => level.id === step.levelId)?.region === 'cervical'),
  'cervical-only authored inputs stay region-gated and expose explicit alternative and sequence branches');

const topsScreenConstructOptions = test.computeConstructComparisons(
  neutralPreset.alignment,
  neutralPreset.global,
  {
    'L4-L5': { discHeightLoss: 35, facetHypertrophy: 25, apTranslation: 4 }
  }
);
const motionPreservationComparison = topsScreenConstructOptions
  .find(option => option.id === 'focal-fusion-vs-motion-preservation');
const motionPreservationBranch = motionPreservationComparison?.branches
  .find(branch => branch.id === 'motion-preservation');
const expandedMotionOrder = motionPreservationBranch?.evaluation?.expandedSteps
  ?.map(step => step.procedureId) || [];
check(motionPreservationComparison
    && motionPreservationBranch?.steps.length === 1
    && motionPreservationBranch.steps[0].procedureId === 'tops'
    && motionPreservationBranch.evaluation?.valid === true
    && expandedMotionOrder.join(',') === 'laminectomy,tops'
    && motionPreservationBranch.evaluation.candidates.length === 2
    && motionPreservationBranch.evaluation.candidates[0].comparisonPrefill.autoAddedPrerequisite === true
    && motionPreservationBranch.evaluation.candidates[1].implantPlan.components.some(component =>
      component.role === 'posterior_motion_device')
    && motionPreservationBranch.evaluation.candidates[1].implantPlan.components.some(component =>
      component.role === 'screw_set'),
  'TOPS comparison keeps one user-facing device step while atomically expanding decompression before component-complete hardware');

const plannedMotionBranch = motionPreservationComparison && motionPreservationBranch
  ? test.planConstructComparisonBranch(
    neutralPreset.alignment,
    neutralPreset.global,
    [],
    {},
    motionPreservationComparison,
    motionPreservationBranch,
    700
  )
  : { valid: false, candidates: [], draftItinerary: [] };
const blockingLumbarItem = {
  id: 699,
  procedureId: 'alif',
  levelId: 'L3-L4',
  plannedAngle: 10,
  plannedAngleSource: 'user_planned',
  plannedCoronal: 0,
  plannedAxialRotation: 0,
  plannedTranslationMm: 0,
  implantPlan: test.buildDefaultSuggestedImplantPlan('alif', 'L3-L4')
};
const rejectedMotionBranch = motionPreservationComparison && motionPreservationBranch
  ? test.planConstructComparisonBranch(
    neutralPreset.alignment,
    neutralPreset.global,
    [blockingLumbarItem],
    {},
    motionPreservationComparison,
    motionPreservationBranch,
    702
  )
  : { valid: true, candidates: [], draftItinerary: [] };
check(plannedMotionBranch.valid
    && plannedMotionBranch.candidates.map(candidate => candidate.id).join(',') === '700,701'
    && plannedMotionBranch.draftItinerary.length === 2
    && plannedMotionBranch.before.residual.piLl === 4
    && plannedMotionBranch.after.residual.piLl === 4
    && rejectedMotionBranch.valid === false
    && rejectedMotionBranch.candidates.length === 0
    && rejectedMotionBranch.draftItinerary.length === 1
    && rejectedMotionBranch.draftItinerary[0] === blockingLumbarItem,
  'construct branches plan all prerequisites atomically and return the original itinerary unchanged on conflict');

const comprehensiveConstructOptions = test.computeConstructComparisons(
  { pi: 70, ll: 20, tk: 65, cl: -20, pt: 35, measuredSva: 12 },
  {
    coronalMagnitude: 40, coronalDirection: 'right', compensatoryCobb: 20,
    trunkShift: 30, axialRotation: 12, secondaryFlexibility: .5,
    cervicalSva: 70, t1Slope: 35, cbva: 20
  },
  {
    'T11-T12': { sagittalWedge: 4 },
    'T12-L1': { sagittalWedge: 8, discHeightLoss: 25 },
    'L2-L3': { discHeightLoss: 30, lateralTranslation: 4 },
    'L3-L4': { discHeightLoss: 45, axialRotation: 8 },
    'L4-L5': { discHeightLoss: 50 }
  }
);
const constructStepIsValid = step => {
  const procedure = test.PROCEDURES[step.procedureId];
  const level = test.SURGICAL_TARGETS.find(candidate => candidate.id === step.levelId);
  if (!test.isProcedureCompatible(procedure, level)) return false;
  const sagittalPolicy = test.correctionPolicyFor(procedure, level);
  const sagittal = Number(step.sagittal);
  if (!Number.isFinite(sagittal)) return false;
  if (sagittalPolicy.enabled) {
    if (sagittal < sagittalPolicy.minDeg || sagittal > sagittalPolicy.maxDeg) return false;
  } else if (sagittal !== 0) return false;
  const threePlanePolicy = test.procedureThreePlanePolicyFor(step.procedureId, level);
  return [
    [step.coronal, threePlanePolicy.coronal],
    [step.axial, threePlanePolicy.axial],
    [step.translation, threePlanePolicy.translation]
  ].every(([value, policy]) => {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      && (policy.enabled
        ? numeric >= policy.min && numeric <= policy.max
        : numeric === 0);
  });
};
const constructEvidenceComplete = comprehensiveConstructOptions.every(option =>
  option.steps.length > 0
    && option.steps.every(constructStepIsValid)
    && option.branches.length > 0
    && option.branches.every(branch =>
      typeof branch.id === 'string' && branch.id.length > 0
        && typeof branch.label === 'string' && branch.label.length > 0
        && typeof branch.sequence === 'boolean'
        && branch.steps.length > 0
        && branch.steps.every((step, sequenceIndex) =>
          step.branchId === branch.id
            && step.branchLabel === branch.label
            && step.sequenceIndex === sequenceIndex))
    && option.evidenceIds.length > 0
    && option.evidenceIds.every(evidenceId => {
      const evidence = test.CONSTRUCT_EVIDENCE_SOURCES[evidenceId];
      return evidence && /^https:\/\//.test(evidence.url)
        && typeof evidence.studyDesign === 'string' && evidence.studyDesign.length > 5
        && typeof evidence.population === 'string' && evidence.population.length > 5
        && typeof evidence.supportedClaim === 'string' && evidence.supportedClaim.length > 20
        && typeof evidence.limitation === 'string' && evidence.limitation.length > 20;
    })
    && !option.steps.some(step => step.procedureId === 'pedicleScrews')
);
const constructComparisonText = comprehensiveConstructOptions
  .flatMap(option => [option.title, option.constructSummary, ...option.matchReasons, ...option.missingInputs])
  .join(' ');
check(comprehensiveConstructOptions.length > 0
    && comprehensiveConstructOptions.length <= test.CONSTRUCT_COMPARISON_MODEL.maximumDisplayedOptions
    && constructEvidenceComplete
    && !/\b(best|recommended|recommendation|probability|confidence)\b/i.test(constructComparisonText),
  'construct comparisons are bounded, compatible, evidence-linked, limitation-bearing, unranked, and avoid duplicate screw-only steps');

test.applyAnatomyPreset('flatback');
const comparisonStateBeforePrefill = test.getState();
const stagedComparison = comparisonStateBeforePrefill.constructComparisons
  .find(option => option.id === 'distributed-lumbar-interbody');
const stagedStep = stagedComparison?.steps[0];
const prefillResult = stagedComparison ? test.stageConstructComparisonStep(stagedComparison.id, 0) : false;
const comparisonStateAfterPrefill = test.getState();
check(prefillResult === true
    && comparisonStateAfterPrefill.itinerary.length === comparisonStateBeforePrefill.itinerary.length
    && getElement('levelSelect').value === stagedStep?.levelId
    && getElement('procedureSelect').value === stagedStep?.procedureId
    && constructStepIsValid(stagedStep)
    && harness.editorCorrectionSource === 'evidence_comparison_prefill'
    && harness.editorComparisonPrefill?.optionId === stagedComparison?.id
    && harness.editorComparisonPrefill?.stepIndex === 0
    && harness.editorComparisonPrefill?.stepLabel === stagedStep?.label
    && harness.editorComparisonPrefill?.evidenceIds?.length === stagedComparison?.evidenceIds.length,
  'construct scenario action prefills a valid editor step with evidence provenance without mutating the itinerary');

test.applyAnatomyPreset('cervical-kyphosis');
const cervicalPresetState = test.getState();
const renderedConstructNodes = [];
getElement('constructComparisonList').walkDom(node => renderedConstructNodes.push(node));
const renderedEvidenceLinks = renderedConstructNodes.filter(node =>
  node.tagName === 'A' && /^https:\/\//.test(node.href || '')
);
const renderedEvidenceSummaries = renderedConstructNodes.filter(node =>
  node.tagName === 'SUMMARY' && /Evidence and limitations/i.test(node.textContent)
);
const renderedBranchLabels = renderedConstructNodes.filter(node =>
  node.tagName === 'STRONG' && /branch|sequence/i.test(node.textContent)
);
const renderedApplyButtons = renderedConstructNodes.filter(node =>
  node.tagName === 'BUTTON' && node.textContent === 'Apply branch'
);
check(cervicalPresetState.params.cl === -20
    && cervicalPresetState.globalDeformity.cervicalSva === 60
    && cervicalPresetState.globalDeformity.t1Slope === 25
    && cervicalPresetState.globalDeformity.cbva === 15
    && cervicalPresetState.provenance.measuredSva === 'not_provided',
  'cervical-kyphosis preset synchronizes signed CL and independent cervical context');
check(getElement('clSlider').value === '-20'
    && getElement('cervicalSva').value === '60'
    && String(getElement('cervicalModifierSummary').textContent).includes('T1S−CL 2 (+45°)'),
  'preset synchronization updates main and Anatomy Lab controls with reference modifier display');
check(renderedEvidenceLinks.length === cervicalComparison.evidenceIds.length
    && renderedEvidenceSummaries.length === 1
    && renderedBranchLabels.length === cervicalComparison.branches.length
    && renderedApplyButtons.length === cervicalComparison.branches.length
    && renderedApplyButtons.every(button => button.disabled === false),
  'comparison panel visibly renders evidence, limitations, branch labels, and enabled atomic branch actions');

// Structural scene audit: exercise every authored case and deformity preset, then
// representative surgical paths in both source and modeled views. The audit is
// intentionally independent from the focused feature assertions above so a new
// catalog entry cannot bypass transform, source-geometry, or overlay containment
// checks simply because it was not selected by another test.
const structuralObjectBox = root => {
  if (!root) return null;
  root.updateWorldMatrix?.(true, true);
  const box = new context.THREE.Box3().setFromObject(root);
  return box.isEmpty() ? null : box;
};
const structurallyValidBox = box => {
  if (!box || box.isEmpty()) return false;
  const values = [...box.min.toArray(), ...box.max.toArray()];
  const size = box.getSize(new context.THREE.Vector3()).toArray();
  return valuesFinite(values) && valuesFinite(size)
    && size.every(value => value >= 0)
    && size.some(value => value > 1e-6);
};
const structuralOverlaySpecs = [
  { role: 'disc', root: record => record.disc, extentRatio: 1.5, offsetRatio: 1.25 },
  { role: 'ligaments', root: record => record.ligaments?.layer, extentRatio: 4, offsetRatio: 2.5 },
  { role: 'osteophytes', root: record => record.osteophytes, extentRatio: 1.75, offsetRatio: 1.25 },
  { role: 'cut-surfaces', root: record => record.cutSurfaces, extentRatio: 2.25, offsetRatio: 1.5 },
  { role: 'decompression-void', root: record => record.decompressionVoid, extentRatio: 2.25, offsetRatio: 1.5 },
  { role: 'interbody-resection', root: record => record.interbodyResectionEnvelope, extentRatio: 2.25, offsetRatio: 1.5 },
  { role: 'osteotomy-remnants', root: record => record.osteotomyRemnants, extentRatio: 2.25, offsetRatio: 1.5 },
  { role: 'hardware', root: record => record.hardwareLayer, extentRatio: 4, offsetRatio: 2.5 }
];
const auditStructuralSceneState = ({ label, view, derivedLevelIds = [] }) => {
  const errors = [];
  const scene = test.getScene();
  const derivedLevels = new Set(derivedLevelIds);
  if (test.getState().view !== view) errors.push(`requested ${view} view did not become active`);
  scene.updateMatrixWorld(true);
  if (!finiteObjectTree(scene)) errors.push('scene contains a non-finite transform or geometry bound');

  const standingBounds = test.getVisibleAnatomyBounds(true);
  if (!structurallyValidBox(standingBounds)) {
    errors.push('visible standing-anatomy bounds are empty or non-finite');
  } else {
    const standingSize = standingBounds.getSize(new context.THREE.Vector3()).toArray();
    const standingMaximum = Math.max(...standingSize);
    if (!(standingMaximum >= 8 && standingMaximum <= 100)) {
      errors.push(`standing-anatomy maximum extent ${standingMaximum.toFixed(3)} is outside [8, 100]`);
    }
  }

  for (const record of segments.values()) {
    if (!record.referenceLayer?.children?.length) continue;
    const levelId = record.level.id;
    const sourceBox = structuralObjectBox(record.referenceLayer);
    if (!structurallyValidBox(sourceBox)) {
      errors.push(`${levelId} CT reference bounds are empty or non-finite`);
      continue;
    }

    const expectsDerivedSurface = view === 'post' && derivedLevels.has(levelId);
    if (expectsDerivedSurface) {
      const postoperativeBox = structuralObjectBox(record.topsPostoperativeReferenceLayer);
      if (record.geometryMode !== 'ct_derived_post_decompression'
          || record.referenceLayer.visible
          || !record.topsPostoperativeReferenceLayer?.visible
          || !structurallyValidBox(postoperativeBox)) {
        errors.push(`${levelId} expected one finite CT-derived postoperative surface, received ${record.geometryMode}`);
      }
    } else if (record.geometryMode !== 'ct_reference' || !record.referenceLayer.visible) {
      errors.push(`${levelId} improperly replaced CT reference with ${record.geometryMode}`);
    }

    if (record.body.visible || record.endplates.visible || record.posteriorElement.visible) {
      errors.push(`${levelId} exposes schematic full-vertebra geometry in ${record.geometryMode}`);
    }

    const sourceMaximum = boxMaximumDimension(sourceBox);
    if (!(sourceMaximum >= .1 && sourceMaximum <= 10)) {
      errors.push(`${levelId} CT reference maximum extent ${sourceMaximum.toFixed(3)} is outside [.1, 10]`);
    }
    const sourceCenter = sourceBox.getCenter(new context.THREE.Vector3());
    if (record.osteophytes?.visible) {
      errors.push(`${levelId} exposes an unsupported schematic osteophyte overlay`);
    }
    for (const spec of structuralOverlaySpecs) {
      const root = spec.root(record);
      const overlayBox = structuralObjectBox(root);
      if (!overlayBox) continue;
      if (!structurallyValidBox(overlayBox)) {
        errors.push(`${levelId} ${spec.role} overlay has an invalid bound`);
        continue;
      }
      const extentRatio = boxMaximumDimension(overlayBox) / sourceMaximum;
      const offsetRatio = overlayBox.getCenter(new context.THREE.Vector3()).distanceTo(sourceCenter) / sourceMaximum;
      if (!Number.isFinite(extentRatio) || !Number.isFinite(offsetRatio)
          || extentRatio > spec.extentRatio || offsetRatio > spec.offsetRatio) {
        errors.push(`${levelId} ${spec.role} detached-overlay ratios extent=${extentRatio.toFixed(3)}`
          + ` (max ${spec.extentRatio}), offset=${offsetRatio.toFixed(3)} (max ${spec.offsetRatio})`);
      }
    }
  }

  const pelvisReferenceBox = structuralObjectBox(test.getPelvisReferenceLayer());
  if (!structurallyValidBox(pelvisReferenceBox)) {
    errors.push('pelvis CT reference bounds are empty or non-finite');
  } else {
    const pelvisMaximum = boxMaximumDimension(pelvisReferenceBox);
    const pelvisCenter = pelvisReferenceBox.getCenter(new context.THREE.Vector3());
    [
      ['SI-joint', test.getSIJoints(), 1.25, 1],
      ['pelvic-ligament', test.getPelvicLigaments(), 1.75, 1.25],
      ['pelvic-hardware', test.getPelvicHardware(), 1.75, 1.25]
    ].forEach(([role, root, extentLimit, offsetLimit]) => {
      const overlayBox = structuralObjectBox(root);
      if (!overlayBox) return;
      const extentRatio = boxMaximumDimension(overlayBox) / pelvisMaximum;
      const offsetRatio = overlayBox.getCenter(new context.THREE.Vector3()).distanceTo(pelvisCenter) / pelvisMaximum;
      if (!structurallyValidBox(overlayBox)
          || !Number.isFinite(extentRatio) || !Number.isFinite(offsetRatio)
          || extentRatio > extentLimit || offsetRatio > offsetLimit) {
        errors.push(`pelvis ${role} detached-overlay ratios extent=${extentRatio.toFixed(3)}`
          + ` (max ${extentLimit}), offset=${offsetRatio.toFixed(3)} (max ${offsetLimit})`);
      }
    });
  }
  return errors.map(error => `${label}: ${error}`);
};

const visibleWithinRoot = (object, root) => {
  let cursor = object;
  let belongsToRoot = false;
  while (cursor) {
    if (cursor.visible === false) return false;
    if (cursor === root) belongsToRoot = true;
    cursor = cursor.parent;
  }
  return belongsToRoot;
};
const visibleGeometryWithin = root => {
  const values = [];
  root?.traverse?.(object => {
    if (object.geometry && visibleWithinRoot(object, root)) values.push(object);
  });
  return values;
};

test.applyCaseExample('degenerative-scoliosis');
test.setView('pre');
const visibleDegenerativeOsteophyteSolids = [...segments.values()]
  .flatMap(record => visibleGeometryWithin(record.osteophytes));
check(visibleDegenerativeOsteophyteSolids.length === 0
    && [...segments.values()].every(record => record.geometryMode === 'ct_reference'),
  'CT-backed degenerative demo withholds procedural osteophyte solids and preserves every intact source surface',
  visibleDegenerativeOsteophyteSolids.map(object => object.name || object.uuid).join(','));

test.applyCaseExample('neutral-reference');
harness.setLayers({ ...defaultLayers, ligaments: true });
const visibleNeutralLigamentPaths = ligamentPathGroups
  .filter(pathway => visibleGeometryWithin(pathway).length > 0);
test.applyCaseExample('degenerative-scoliosis');
harness.setLayers({ ...defaultLayers, ligaments: true });
const visibleDeformedLigamentPaths = ligamentPathGroups
  .filter(pathway => visibleGeometryWithin(pathway).length > 0);
check(visibleNeutralLigamentPaths.length === ligamentPathGroups.length
    && visibleDeformedLigamentPaths.length === 0,
  'reference ligament pathways are available in the source pose but hidden after live deformity until continuous rebuilding exists',
  `neutral=${visibleNeutralLigamentPaths.length}, deformed=${visibleDeformedLigamentPaths.length}`);
harness.setLayers(defaultLayers);

const lumbarMajorRotationPeaks = { cervical: 0, thoracic: 0, lumbar: 0 };
let lumbarMajorPeakLevel = null;
let lumbarMajorPeakValue = -Infinity;
for (const record of segments.values()) {
  const region = record.level.region;
  const magnitude = Math.abs(Number(record.group.userData.targetRotationX));
  if (Object.prototype.hasOwnProperty.call(lumbarMajorRotationPeaks, region)) {
    lumbarMajorRotationPeaks[region] = Math.max(lumbarMajorRotationPeaks[region], magnitude);
  }
  if (magnitude > lumbarMajorPeakValue) {
    lumbarMajorPeakValue = magnitude;
    lumbarMajorPeakLevel = record.level.id;
  }
}
check(test.getState().globalDeformity.preset === 'degenerative-scoliosis'
    && lumbarMajorPeakLevel?.startsWith('L')
    && lumbarMajorRotationPeaks.lumbar > lumbarMajorRotationPeaks.thoracic
    && lumbarMajorRotationPeaks.lumbar > lumbarMajorRotationPeaks.cervical,
  'lumbar-major deformity preset places the dominant primary coronal deformation in the lumbar region',
  JSON.stringify({ peakLevel: lumbarMajorPeakLevel, peaks: lumbarMajorRotationPeaks }));

test.applyCaseExample('cervical-degeneration');
const arthroplastyPlan = harness.buildPlan('discReplacement', 'C4-C5');
harness.setScenario([{
  levelId: 'C4-C5', procedureId: 'discReplacement', implantPlan: arthroplastyPlan
}]);
const arthroplastyRecord = segments.get('C4-C5');
const arthroplastyRoot = arthroplastyRecord.hardwareLayer.children
  .find(root => root.userData?.procedureId === 'discReplacement');
const arthroplastyComponents = [];
arthroplastyRoot?.traverse(object => {
  if (/^catalogArthroplasty(?:Endplate|Core)/.test(object.name)) arthroplastyComponents.push(object);
});
test.getScene().updateMatrixWorld(true);
const liveDiscBox = structuralObjectBox(arthroplastyRecord.disc);
const liveDiscCenter = liveDiscBox?.getCenter(new context.THREE.Vector3());
const liveDiscMaximum = boxMaximumDimension(liveDiscBox);
const liveDiscNormal = new context.THREE.Vector3(0, 1, 0)
  .applyQuaternion(arthroplastyRecord.disc.getWorldQuaternion(new context.THREE.Quaternion()))
  .normalize();
const arthroplastyCenterOffsets = arthroplastyComponents.map(component =>
  structuralObjectBox(component)?.getCenter(new context.THREE.Vector3()).distanceTo(liveDiscCenter) ?? Infinity
);
const arthroplastyNormalDots = arthroplastyComponents.map(component => {
  const normal = new context.THREE.Vector3(0, 1, 0)
    .applyQuaternion(component.getWorldQuaternion(new context.THREE.Quaternion())).normalize();
  return Math.abs(normal.dot(liveDiscNormal));
});
check(arthroplastyComponents.length === 3
    && structurallyValidBox(liveDiscBox)
    && arthroplastyCenterOffsets.every(offset => Number.isFinite(offset) && offset <= liveDiscMaximum * .75)
    && arthroplastyNormalDots.every(dot => Number.isFinite(dot) && dot >= .98),
  'cervical arthroplasty components remain centered near and normal-aligned to the live disc transform',
  JSON.stringify({
    componentCount: arthroplastyComponents.length,
    discMaximum: liveDiscMaximum,
    centerOffsets: arthroplastyCenterOffsets,
    normalDots: arthroplastyNormalDots
  }));

test.applyCaseExample('neutral-reference');
harness.setLayers({ ...defaultLayers, siJoints: true, ligaments: true, implants: true });
const piAuditPlan = harness.buildPlan('s2aiFixation', 'PELVIS-SI');
harness.setScenario([{ levelId: 'PELVIS-SI', procedureId: 's2aiFixation', implantPlan: piAuditPlan }]);
const piMorphRoot = test.getSacralMorphologyRoot();
const piOverlayRoots = [
  ['SI-joint', test.getSIJoints()],
  ['pelvic-ligament', test.getPelvicLigaments()],
  ['pelvic-hardware', test.getPelvicHardware()]
];
test.getScene().updateMatrixWorld(true);
const piMorphMatrixBefore = worldMatrixSnapshot(piMorphRoot);
const piOverlaySnapshots = piOverlayRoots.map(([role, root]) => ({
  role,
  root,
  objects: visibleGeometryWithin(root).map(object => ({
    object,
    relative: new context.THREE.Matrix4()
      .multiplyMatrices(piMorphRoot.matrixWorld.clone().invert(), object.matrixWorld)
      .toArray()
  }))
}));
harness.setAlignmentParams({ pi: 61 });
test.getScene().updateMatrixWorld(true);
const piMorphMatrixAfter = worldMatrixSnapshot(piMorphRoot);
const piOverlaySafety = piOverlaySnapshots.map(snapshot => ({
  role: snapshot.role,
  hidden: snapshot.root.visible === false,
  bound: snapshot.objects.length > 0 && snapshot.objects.every(entry => {
    entry.object.updateWorldMatrix(true, true);
    const relative = new context.THREE.Matrix4()
      .multiplyMatrices(piMorphRoot.matrixWorld.clone().invert(), entry.object.matrixWorld)
      .toArray();
    return numericArraysNear(relative, entry.relative, 1e-7);
  })
}));
check(!numericArraysNear(piMorphMatrixBefore, piMorphMatrixAfter, 1e-7)
    && piOverlaySafety.every(result => result.hidden || result.bound),
  'nonzero pelvic-incidence morphology hides or continuously binds SI, pelvic-ligament, and pelvic-hardware overlays',
  JSON.stringify({
    morphologyRootChanged: !numericArraysNear(piMorphMatrixBefore, piMorphMatrixAfter, 1e-7),
    rotationDeg: context.THREE.MathUtils.radToDeg(piMorphRoot.rotation.z),
    overlays: piOverlaySafety
  }));
harness.setLayers(defaultLayers);

const caseCatalogAuditFailures = [];
let auditedCaseCatalogEntries = 0;
for (const caseId of Object.keys(test.CASE_EXAMPLES)) {
  try {
    if (test.applyCaseExample(caseId) !== true) throw new Error('case loader returned false');
    test.setView('pre');
    caseCatalogAuditFailures.push(...auditStructuralSceneState({
      label: `case ${caseId} / pre`,
      view: 'pre'
    }));
    auditedCaseCatalogEntries += 1;
  } catch (error) {
    caseCatalogAuditFailures.push(`case ${caseId}: ${error.message}`);
  }
}
check(auditedCaseCatalogEntries === Object.keys(test.CASE_EXAMPLES).length
    && caseCatalogAuditFailures.length === 0,
  `all ${Object.keys(test.CASE_EXAMPLES).length} case examples preserve finite, bounded CT-reference scenes`,
  caseCatalogAuditFailures.join('\n'));

const deformityPresetAuditFailures = [];
let auditedDeformityPresets = 0;
for (const presetId of Object.keys(test.DEFORMITY_PRESETS)) {
  try {
    test.applyCaseExample('neutral-reference');
    test.applyAnatomyPreset(presetId);
    test.setView('pre');
    deformityPresetAuditFailures.push(...auditStructuralSceneState({
      label: `preset ${presetId} / pre`,
      view: 'pre'
    }));
    auditedDeformityPresets += 1;
  } catch (error) {
    deformityPresetAuditFailures.push(`preset ${presetId}: ${error.message}`);
  }
}
check(auditedDeformityPresets === Object.keys(test.DEFORMITY_PRESETS).length
    && deformityPresetAuditFailures.length === 0,
  `all ${Object.keys(test.DEFORMITY_PRESETS).length} deformity presets preserve finite, bounded CT-reference scenes`,
  deformityPresetAuditFailures.join('\n'));

const representativeProcedureViewCases = [
  { label: 'lumbar ALIF', caseId: 'lumbar-degeneration', steps: [['L4-L5', 'alif']] },
  { label: 'three-plane XLIF', caseId: 'degenerative-scoliosis', steps: [['L3-L4', 'xlif']] },
  { label: 'cervical ACDF', caseId: 'cervical-degeneration', steps: [['C4-C5', 'acdf']] },
  { label: 'cervical laminectomy', caseId: 'cervical-degeneration', steps: [['C5-C6', 'laminectomy']] },
  {
    label: 'TOPS with required decompression', caseId: 'l4-l5-translation',
    steps: [['L4-L5', 'laminectomy'], ['L4-L5', 'tops']],
    derivedLevelIds: ['L4-L5', 'L5-S1']
  },
  { label: 'lumbar SPO', caseId: 'flatback', steps: [['L3-L4', 'spo']] },
  { label: 'occipital fusion', caseId: 'cervical-kyphosis', steps: [['C0-C1', 'occipitalFusion']] },
  { label: 'pelvic S2AI fixation', caseId: 'degenerative-scoliosis', steps: [['PELVIS-SI', 's2aiFixation']] }
];
const representativeProcedureViewFailures = [];
let auditedRepresentativeViews = 0;
for (const procedureCase of representativeProcedureViewCases) {
  try {
    test.applyCaseExample(procedureCase.caseId);
    const items = procedureCase.steps.map(([levelId, procedureId]) => ({
      levelId,
      procedureId,
      implantPlan: harness.buildPlan(procedureId, levelId)
    }));
    harness.setScenario(items);
    for (const view of ['pre', 'post']) {
      test.setView(view);
      representativeProcedureViewFailures.push(...auditStructuralSceneState({
        label: `${procedureCase.label} / ${view}`,
        view,
        derivedLevelIds: view === 'post' ? procedureCase.derivedLevelIds : []
      }));
      auditedRepresentativeViews += 1;
    }
  } catch (error) {
    representativeProcedureViewFailures.push(`${procedureCase.label}: ${error.message}`);
  }
}
check(auditedRepresentativeViews === representativeProcedureViewCases.length * 2
    && representativeProcedureViewFailures.length === 0,
  `representative procedures preserve finite CT geometry and bounded overlays across ${representativeProcedureViewCases.length * 2} pre/post views`,
  representativeProcedureViewFailures.join('\n'));

test.applyAnatomyPreset('neutral');

const statAfter = fs.statSync(htmlPath);
check(statBefore.size === statAfter.size && statBefore.mtimeMs === statAfter.mtimeMs,
  'HTML remained stable during the scene harness',
  'before=' + statBefore.size + '/' + statBefore.mtimeMs + ', after=' + statAfter.size + '/' + statAfter.mtimeMs);

const failures = results.filter(result => !result.ok);
console.log(JSON.stringify({
  file: { path: htmlPath, bytes: statAfter.size, mtime: statAfter.mtime.toISOString() },
  builtIn: test.MODEL_SELF_TEST,
  atlas: {
    structures: Object.keys(atlas.bones).length,
    decoded: diagnostics.decoded.length,
    spineVertices,
    spineTriangles,
    decodedVertices,
    decodedTriangles
  },
  lowerLimbAtlas: {
    structures: Object.keys(lowerAtlas.bones).length,
    decoded: lowerDiagnostics.decoded.length,
    vertices: lowerVertices,
    triangles: lowerTriangles,
    geometryMode: lowerDiagnostics.geometryMode
  },
  summary: { passed: results.length - failures.length, failed: failures.length, total: results.length },
  failures
}, null, 2));
if (failures.length) process.exitCode = 1;
