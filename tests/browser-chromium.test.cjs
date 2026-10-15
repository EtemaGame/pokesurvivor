'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find(file => file && fs.existsSync(file));

function serve() {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png',
    '.ttf': 'font/ttf'
  };
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const rel = decodeURIComponent(u.pathname);
    const filename = path.resolve(ROOT, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
    if (!filename.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(filename, (err, content) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
      res.end(content);
    });
  });
}

async function connectCDP(port) {
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/list');
      target = (await r.json()).find(t => t.type === 'page');
      if (target && target.webSocketDebuggerUrl) break;
    } catch (_) {}
    await pause(100);
  }
  assert.ok(target && target.webSocketDebuggerUrl, 'No apareció la pestaña de Chrome');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let next = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  return {
    send,
    async evaluate(expression) {
      const v = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (v.exceptionDetails) throw Error(v.exceptionDetails.exception?.description || v.exceptionDetails.text);
      return v.result.value;
    },
    close() { ws.close(); }
  };
}

const pageState = `(() => {
  const cv = document.querySelector('canvas#game');
  const el = document.querySelector('script[src*="js/app.min.js?v="]');
  const sheet = document.querySelector('link[href*="css/style.css?v="]');
  return {
    ready: document.readyState,
    lang: document.documentElement ? document.documentElement.lang : null,
    canvasWidth: cv ? cv.getBoundingClientRect().width : 0,
    canvasHeight: cv ? cv.getBoundingClientRect().height : 0,
    jsVersion: el ? el.getAttribute('src').split('v=')[1] : null,
    cssVersion: sheet ? sheet.getAttribute('href').split('v=')[1] : null
  };
})()`;

async function until(fn, condition, attempts = 100) {
  let lastError = null, lastValue = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const value = await fn();
      lastValue = value;
      if (condition(value)) return value;
    } catch (e) { lastError = e; } // Puede cambiar el contexto JS durante una navegación.
    await pause(100);
  }
  throw new Error('No se alcanzó el estado esperado del navegador; valor=' + JSON.stringify(lastValue) + (lastError ? ': ' + lastError.message : ''));
}

test('Chromium real: navegador de PC, versión HTML, inglés y viewport horizontal móvil', { timeout: 80000 }, async () => {
  assert.ok(browser, 'Se requiere Chrome o Chromium en el runner');
  const server = serve();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'http://127.0.0.1:' + server.address().port;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokesurvivor-chrome-'));
  const chrome = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-networking', '--no-first-run', '--window-size=1280,800',
    '--remote-debugging-port=0', '--user-data-dir=' + userDir,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    address + '/index.html'
  ], { stdio: 'ignore' });
  let cdp;
  try {
    const portFile = path.join(userDir, 'DevToolsActivePort');
    await until(async () => {
      if (chrome.exitCode !== null) throw new Error('Chrome salió con código ' + chrome.exitCode);
      return fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').split('\n')[0] : null;
    }, Boolean, 300);
    const port = +fs.readFileSync(portFile, 'utf8').split('\n')[0];
    cdp = await connectCDP(port);
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: address + '/index.html' });
    const revision = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'))).v;
    const pc = await until(() => cdp.evaluate(pageState),
      s => s.ready === 'complete' && ['es', 'en'].includes(s.lang) && s.canvasWidth > 300);
    assert.equal(pc.jsVersion, revision);
    assert.equal(pc.cssVersion, revision);

    await cdp.send('Page.navigate', { url: address + '/en/' });
    const en = await until(() => cdp.evaluate(pageState),
      s => s.ready === 'complete' && s.lang === 'en' && s.canvasWidth > 300);
    assert.equal(en.jsVersion, revision);
    assert.equal(en.cssVersion, revision);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 3, mobile: true
    });
    const mobile = await until(() => cdp.evaluate(pageState), s => s.canvasWidth > 0);
    assert.ok(mobile.canvasWidth <= 844, 'Canvas desborda la anchura móvil');
    assert.ok(mobile.canvasHeight <= 390, 'Canvas desborda la altura móvil');
  } finally {
    if (cdp) cdp.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const exited = new Promise(resolve => chrome.once('exit', resolve));
      chrome.kill('SIGKILL');
      await Promise.race([exited, pause(3000)]);
    }
    await new Promise(resolve => server.close(resolve));
    // Chrome puede dejar procesos secundarios escribiendo en Default un instante.
    // No ocultar un resultado real del test por una carrera de limpieza del runner.
    try { fs.rmSync(userDir, { recursive: true, force: true }); }
    catch (e) { if (e.code !== 'ENOTEMPTY' && e.code !== 'EBUSY') throw e; }
  }
});
