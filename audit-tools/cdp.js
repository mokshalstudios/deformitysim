'use strict';
// Minimal, dependency-free Chrome DevTools Protocol driver for exercising
// spine_simulator.html in a real browser (Node >= 22: global WebSocket).
//
//   const { launch } = require('./cdp');
//   const b = await launch({ headless: true });
//   const page = await b.open('file:///.../spine_simulator.html');
//   await page.unlock();                       // launch gate
//   const v = await page.eval('window.__SPINE_TEST__.getState()');
//   await page.screenshot('out.png');
//   await page.setFiles('#someFileInput', ['C:/path/film.jpg']);
//   console.log(page.errors, page.console);    // collected page errors / console
//   await b.close();
//
// Chrome is located via CHROME_PATH or the usual Windows / macOS / Linux paths.
// WebGL runs on the real GPU when headed or with --headless=new on most
// machines; pass { angle: 'swiftshader' } etc. to pick an ANGLE backend.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 30000, interval = 100, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out after ${timeout} ms waiting for ${label}`);
    await sleep(interval);
  }
}

class Session {
  constructor(ws, sessionId, browser) {
    this.ws = ws; this.sessionId = sessionId; this.browser = browser;
    this.errors = []; this.console = []; this.dialogs = [];
  }
  send(method, params = {}) { return this.browser._send(method, params, this.sessionId); }

  async eval(expression, { awaitPromise = true, timeout = 120000 } = {}) {
    const wrapped = `(async () => { return (${expression}); })()`;
    const result = await Promise.race([
      this.send('Runtime.evaluate', { expression: wrapped, awaitPromise, returnByValue: true, userGesture: true }),
      sleep(timeout).then(() => { throw new Error(`eval timed out: ${expression.slice(0, 120)}`); })
    ]);
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new Error(`eval threw: ${(d.exception && (d.exception.description || d.exception.value)) || d.text}`);
    }
    return result.result.value;
  }

  // Runs a function body string with `arguments` passed as JSON.
  async call(fnSource, ...args) {
    return this.eval(`(${fnSource})(...${JSON.stringify(args)})`);
  }

  async waitFor(expression, opts = {}) {
    return waitFor(() => this.eval(expression).catch(() => false), { label: expression, ...opts });
  }

  async screenshot(file, { fullPage = false } = {}) {
    const params = { format: file.endsWith('.jpg') ? 'jpeg' : 'png' };
    if (fullPage) params.captureBeyondViewport = true;
    const { data } = await this.send('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  async setViewport(width, height, { mobile = false, deviceScaleFactor = 1 } = {}) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
    if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  async setFiles(selector, files) {
    const { root } = await this.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`setFiles: no element for ${selector}`);
    await this.send('DOM.setFileInputFiles', { nodeId, files: files.map(f => path.resolve(f)) });
  }

  // Real mouse input at CSS pixel coordinates (drives pointer handlers).
  async click(x, y, { button = 'left', clickCount = 1 } = {}) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount });
  }
  async drag(from, to, steps = 8) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from[0], y: from[1] });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      const x = from[0] + (to[0] - from[0]) * i / steps, y = from[1] + (to[1] - from[1]) * i / steps;
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left', clickCount: 1 });
  }
  async clickSelector(selector) {
    const box = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
    if (!box) throw new Error(`clickSelector: no element for ${selector}`);
    if (!box.w || !box.h) throw new Error(`clickSelector: ${selector} is not visible`);
    await this.click(box.x, box.y);
  }
  async type(text) { await this.send('Input.insertText', { text }); }
  async key(key, code = key, keyCode) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  }

  // Launch gate. The open-source alpha builds ship with the gate disabled
  // (LAUNCH_GATE_ENABLED = false in src/js/00-launch-gate.js), so there is
  // usually nothing to unlock: the dialog is removed at startup and this only
  // waits for the test surface. For an internal gated build, pass the code or
  // set SPINE_LAUNCH_CODE in the environment; no code is kept in the source.
  async unlock(code = process.env.SPINE_LAUNCH_CODE || '') {
    await this.waitFor(`document.readyState === 'complete'`, { timeout: 120000 });
    const locked = await this.eval(`(() => {
      if (window.__SPINE_GATE__ && window.__SPINE_GATE__.isUnlocked()) return false;
      const d = document.getElementById('launchGate'); return !!(d && d.open);
    })()`);
    if (locked) {
      await this.eval(`(() => { const i = document.querySelector('#launchGate input'); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('launchGateSubmit').click(); return true; })()`);
      // The gate element is removed from the DOM on success.
      await this.waitFor(`!(document.getElementById('launchGate') || {}).open`, { timeout: 15000 });
    }
    await this.waitFor(`!!window.__SPINE_TEST__`, { timeout: 120000 });
  }

  async close() { try { await this.browser._send('Target.closeTarget', { targetId: this.targetId }); } catch (e) { /* already gone */ } }
}

class Browser {
  constructor(proc, ws, userDataDir) {
    this.proc = proc; this.ws = ws; this.userDataDir = userDataDir;
    this.nextId = 1; this.pending = new Map(); this.sessions = new Map();
    ws.addEventListener('message', event => this._onMessage(JSON.parse(event.data)));
  }
  _send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(message));
    });
  }
  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id); this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
      return;
    }
    const session = msg.sessionId && this.sessions.get(msg.sessionId);
    if (!session) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      session.errors.push((d.exception && d.exception.description) || d.text);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
      session.console.push({ type: msg.params.type, text });
    } else if (msg.method === 'Log.entryAdded') {
      session.console.push({ type: `log.${msg.params.entry.level}`, text: msg.params.entry.text });
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      session.dialogs.push(msg.params.message);
      this._send('Page.handleJavaScriptDialog', { accept: true }, msg.sessionId).catch(() => {});
    }
  }
  async open(url, { width = 1440, height = 900 } = {}) {
    const { targetId } = await this._send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this._send('Target.attachToTarget', { targetId, flatten: true });
    const session = new Session(this.ws, sessionId, this);
    session.targetId = targetId;
    this.sessions.set(sessionId, session);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Log.enable');
    await session.send('DOM.enable');
    await session.setViewport(width, height);
    // Hidden/headless tabs throttle requestAnimationFrame; keep timers honest.
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await session.send('Page.navigate', { url });
    return session;
  }
  async close() {
    try { await this._send('Browser.close'); } catch (e) { /* ignore */ }
    try { this.proc.kill(); } catch (e) { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(this.userDataDir, { recursive: true, force: true }); } catch (e) { /* locked on Windows sometimes */ }
  }
}

async function launch({ headless = true, angle, extraArgs = [], chromePath } = {}) {
  const exe = chromePath || CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!exe) throw new Error('Chrome not found; set CHROME_PATH.');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-cdp-'));
  const args = [
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    ...(headless ? ['--headless=new'] : []),
    ...(angle ? [`--use-angle=${angle}`] : []),
    ...extraArgs, 'about:blank'
  ];
  const proc = spawn(exe, args, { stdio: 'ignore', detached: false });
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const text = await waitFor(() => { try { return fs.readFileSync(portFile, 'utf8'); } catch (e) { return null; } }, { timeout: 30000, label: 'DevToolsActivePort' });
  const [port, wsPath] = text.trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  return new Browser(proc, ws, userDataDir);
}

const fileUrl = p => 'file:///' + path.resolve(p).replace(/\\/g, '/').replace(/ /g, '%20');

module.exports = { launch, waitFor, sleep, fileUrl };
