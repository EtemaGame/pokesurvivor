'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ delayedSuspend = false } = {}) {
  const windowEvents = new Map();
  const documentEvents = new Map();
  const contexts = [];
  const on = (events, name, cb) => {
    const handlers = events.get(name) || [];
    handlers.push(cb);
    events.set(name, handlers);
  };
  const document = {
    hidden: false,
    addEventListener(name, cb) { on(documentEvents, name, cb); }
  };
  const node = () => ({ connect() { return this; } });
  class AudioContextMock {
    constructor() {
      this.state = 'running';
      this.sampleRate = 8;
      this.destination = {};
      this.suspends = 0;
      this.resumes = 0;
      contexts.push(this);
    }
    createDynamicsCompressor() {
      return Object.assign(node(), { threshold: { value: 0 }, ratio: { value: 0 } });
    }
    createGain() {
      return Object.assign(node(), { gain: { value: 0, setTargetAtTime() {} } });
    }
    createConvolver() { return node(); }
    createBuffer(_channels, length) {
      return { getChannelData() { return new Float32Array(length); } };
    }
    suspend() {
      this.suspends++;
      if (delayedSuspend) {
        return new Promise(resolve => {
          this.finishSuspend = () => { this.state = 'suspended'; resolve(); };
        });
      }
      this.state = 'suspended';
      return Promise.resolve();
    }
    resume() {
      this.resumes++;
      this.state = 'running';
      return Promise.resolve();
    }
  }
  const sandbox = {
    G: { U: { clamp(v, a, b) { return Math.max(a, Math.min(b, v)); } } },
    document,
    window: { AudioContext: AudioContextMock },
    localStorage: { getItem() { return null; } },
    addEventListener(name, cb) { on(windowEvents, name, cb); },
    setTimeout() { return 1; },
    performance: { now() { return 0; } },
    console
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'audio.js'), 'utf8'),
    sandbox,
    { filename: 'js/core/audio.js' }
  );
  const fire = (events, name) => {
    for (const callback of events.get(name) || []) callback();
  };
  return {
    document, contexts,
    windowEvent(name) { fire(windowEvents, name); },
    documentEvent(name) { fire(documentEvents, name); }
  };
}

test('background events do not create an audio context', () => {
  const h = harness();
  h.document.hidden = true;
  h.documentEvent('visibilitychange');
  h.windowEvent('pointerup');
  h.windowEvent('keydown');
  assert.equal(h.contexts.length, 0);
  h.document.hidden = false;
  h.documentEvent('visibilitychange');
  assert.equal(h.contexts.length, 0);
});

test('audio suspends in background and resumes on return', () => {
  const h = harness();
  h.windowEvent('pointerup');
  assert.equal(h.contexts.length, 1);
  const ctx = h.contexts[0];
  h.document.hidden = true;
  h.documentEvent('visibilitychange');
  assert.equal(ctx.state, 'suspended');
  h.documentEvent('visibilitychange');
  assert.equal(ctx.suspends, 1);
  h.windowEvent('keydown');
  assert.equal(ctx.resumes, 0);
  h.document.hidden = false;
  h.documentEvent('visibilitychange');
  assert.equal(ctx.state, 'running');
  assert.equal(ctx.resumes, 1);
});

test('pagehide keeps bfcache audio paused until pageshow', () => {
  const h = harness();
  h.windowEvent('pointerup');
  const ctx = h.contexts[0];
  h.windowEvent('pagehide');
  assert.equal(ctx.state, 'suspended');
  h.windowEvent('keydown');
  assert.equal(ctx.resumes, 0);
  h.windowEvent('pageshow');
  assert.equal(ctx.state, 'running');
  assert.equal(ctx.resumes, 1);
});

test('rapid hide/show does not leave audio suspended', async () => {
  const h = harness({ delayedSuspend: true });
  h.windowEvent('pointerup');
  const ctx = h.contexts[0];
  h.document.hidden = true;
  h.documentEvent('visibilitychange');
  h.document.hidden = false;
  h.documentEvent('visibilitychange');
  assert.equal(ctx.resumes, 0);
  ctx.finishSuspend();
  await Promise.resolve();
  assert.equal(ctx.state, 'running');
  assert.equal(ctx.resumes, 1);
});
