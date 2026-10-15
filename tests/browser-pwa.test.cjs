'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = path => fs.readFileSync(require('node:path').join(root, path), 'utf8');

test('HTML español e inglés y version.json comparten revisión CSS/JS/HTML', () => {
  const version = JSON.parse(read('version.json')).v;
  const expected = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'js/app.min.js')))
    .update(fs.readFileSync(path.join(root, 'css/style.css')))
    .update(fs.readFileSync(path.join(root, 'dev.html')))
    .digest('hex').slice(0, 12);
  assert.equal(version, expected);
  for (const p of ['index.html', 'en/index.html']) {
    const html = read(p);
    assert.ok(html.includes('js/app.min.js?v=' + version), p + ': falta versión JS');
    assert.ok(html.includes('css/style.css?v=' + version), p + ': falta versión CSS');
  }
});

function updaterHarness() {
  const version = JSON.parse(read('version.json')).v;
  const screens = new Set(['scr-menu']);
  let room = null, toastCalls = [], interval;
  const listeners = new Map();
  const sandbox = {
    Date,
    Promise,
    location: { protocol: 'https:', reload() { throw new Error('No debería recargar'); } },
    document: {
      querySelector() { return { getAttribute() { return 'js/app.min.js?v=' + version; } }; },
      addEventListener(name, fn) { listeners.set(name, fn); },
      getElementById(id) { return id === 'pull-fx' ? { classList: { contains() { return true; } } } : {}; },
      activeElement: { tagName: 'BODY' }
    },
    setInterval(fn) { interval = fn; return 1; },
    clearInterval() {},
    setTimeout() { return 1; },
    fetch: async () => ({ ok: true, json: async () => ({ v: 'ffffffffffff' }) }),
    console,
    G: {
      Game: { state: 'ui' },
      Social: { get room() { return room; } },
      UI: { isOpen(id) { return screens.has(id); }, toast(msg) { toastCalls.push(msg); } }
    }
  };
  vm.runInNewContext(read('js/core/updater.js'), sandbox);
  return {
    async pending() { sandbox.G.Updater.init(); await sandbox.G.Updater.check(); },
    tick() { interval(); },
    screen(id, enabled) { if (enabled) screens.add(id); else screens.delete(id); },
    room(value) { room = value; },
    get toasts() { return toastCalls; }
  };
}

test('el navegador no recarga una sala, pantalla o partida', async () => {
  const h = updaterHarness();
  await h.pending();
  h.room({ id: 'sala' }); h.tick();
  assert.equal(h.toasts.length, 0, 'sala cooperativa');
  h.room(null);
  h.screen('scr-friends', true); h.tick();
  assert.equal(h.toasts.length, 0, 'panel de amigos');
  h.screen('scr-friends', false);
  h.screen('scr-menu', false); h.tick();
  assert.equal(h.toasts.length, 0, 'pantalla distinta del menú');
  h.screen('scr-menu', true); h.tick();
  assert.match(h.toasts.at(-1), /actualizando/i);
});

function swHarness() {
  const listeners = new Map();
  const cacheEntries = new Map();
  const captured = { added: [], deleted: [], fetched: [], waiting: [], served: null };
  let offline = false;
  const cache = {
    addAll: async entries => { captured.added.push(...entries); },
    match: async request => cacheEntries.get(typeof request === 'string' ? request : request.url) || null,
    put: async (req, res) => {
      cacheEntries.set(typeof req === 'string' ? req : req.url, res);
    }
  };
  const rootUrl = 'https://test.example/';
  const html = read('index.html');
  const sandbox = {
    URL,
    location: { origin: 'https://test.example' },
    self: {
      registration: { scope: rootUrl },
      addEventListener(name, fn) { listeners.set(name, fn); },
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async key => captured.deleted.push(key),
      match: req => cache.match(req)
    },
    fetch: async req => {
      captured.fetched.push(typeof req === 'string' ? req : req.url);
      if (offline) throw new Error('offline');
      if (req === './index.html') return {
        ok: true, text: async () => html,
        clone() { return this; }
      };
      return { ok: true, clone() { return this; } };
    },
    Response: { error() { return { ok: false, error: true }; } },
    console
  };
  vm.runInNewContext(read('sw.js'), sandbox);
  const fire = async (type, request) => {
    captured.waiting = []; captured.served = null;
    const e = {
      request,
      waitUntil(p) { captured.waiting.push(p); },
      respondWith(p) { captured.served = Promise.resolve(p); }
    };
    listeners.get(type)(e);
    if (captured.served) {
      const result = await captured.served;
      await Promise.all(captured.waiting);
      return result;
    }
    await Promise.all(captured.waiting);
    return null;
  };
  return { fire, captured, cacheEntries, offline(v) { offline = v; } };
}

test('instalación PWA precarga HTML, JS, CSS y acceso /en/', async () => {
  const h = swHarness();
  await h.fire('install');
  const v = JSON.parse(read('version.json')).v;
  for (const resource of [
    './index.html', './en/index.html', './js/app.min.js?v=' + v,
    './css/style.css?v=' + v, './manifest.webmanifest'
  ]) assert.ok(h.captured.added.includes(resource), resource);
});

test('las consultas version.json no se interceptan ni crean cachés infinitas', async () => {
  const h = swHarness();
  const res = await h.fire('fetch', { method: 'GET', url: 'https://test.example/version.json?t=123' });
  assert.equal(res, null);
  assert.equal(h.captured.fetched.length, 0);
});

test('la PWA sirve el HTML correcto al navegar offline en inglés', async () => {
  const h = swHarness();
  h.offline(true);
  const en = { language: 'en' };
  h.cacheEntries.set('./en/index.html', en);
  const result = await h.fire('fetch', { method: 'GET', mode: 'navigate', url: 'https://test.example/en/' });
  assert.equal(result, en);
});

test('navegaciones offline desconocidas no regresan al juego español', async () => {
  const h = swHarness();
  h.offline(true);
  h.cacheEntries.set('./index.html', { language: 'es' });
  const result = await h.fire('fetch', { method: 'GET', mode: 'navigate', url: 'https://test.example/guia/' });
  assert.equal(result.error, true);
});
