'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js/core/db.js'), 'utf8');

function createHarness({ expireWait = false } = {}) {
  const events = [];
  const items = new Map();
  const starter = {
    v: 3, name: 'Jugador', created: 100, updated: Date.now() - 1000,
    coins: 800, owned: {}, shiny: {}, stats: {}, tickets: { t1: 0, t10: 0 },
    upgrades: {}, pupg: {}, missions: {}, legends: {}, arenas: {},
    itemsFound: {}, evoMoves: {}, ach: {}
  };
  let record = { save: JSON.parse(JSON.stringify(starter)), v: 3 };
  let unblock;
  const held = new Promise(resolve => { unblock = resolve; });
  const user = {
    uid: 'testuser123', email: 'jugador@jugadores.pokesurvivor.net',
    reauthenticateWithCredential: async () => { events.push('reauth'); },
    delete: async () => { events.push('auth:delete'); }
  };
  const auth = {
    currentUser: user,
    setPersistence: async () => {},
    onAuthStateChanged(cb) {
      queueMicrotask(() => cb(user));
      return () => {};
    },
    signOut: async () => {},
    languageCode: 'es'
  };
  const store = {
    collection(collection) {
      assert.equal(collection, 'saves');
      return {
        doc(uid) {
          assert.equal(uid, user.uid);
          return {
            async get() {
              return { exists: !!record, data: () => record };
            },
            async delete() {
              events.push('save:delete');
              record = null;
            }
          };
        }
      };
    },
    settings() {},
    async runTransaction(cb) {
      events.push('transaction:begin');
      const tx = {
        async get() {
          events.push('transaction:reading');
          await held;
          return { exists: !!record, data: () => record };
        },
        set(_ref, data) {
          events.push('transaction:write');
          record = data;
        }
      };
      await cb(tx);
      events.push('transaction:done');
    }
  };
  const firebaseAuth = () => auth;
  firebaseAuth.Auth = { Persistence: { LOCAL: 'LOCAL' } };
  firebaseAuth.EmailAuthProvider = { credential: () => ({}) };
  const firebaseStore = () => store;
  firebaseStore.FieldValue = { serverTimestamp: () => 1 };
  const fb = {
    initializeApp() {},
    auth: firebaseAuth,
    firestore: firebaseStore
  };
  const document = {
    visibilityState: 'visible',
    addEventListener() {},
    createElement() { return {}; },
    head: {
      appendChild(el) {
        queueMicrotask(() => el.onload());
      }
    }
  };
  const timer = (fn, ms) => {
    if (expireWait && ms === 15000) return setTimeout(fn, 0);
    const id = setTimeout(fn, ms);
    id.unref?.();
    return id;
  };
  const context = {
    G: { FIREBASE_CONFIG: { apiKey: 'fake', projectId: 'test' } },
    firebase: fb, document,
    window: {}, navigator: { onLine: true },
    location: { protocol: 'https:', hostname: 'localhost' },
    localStorage: {
      getItem: key => items.get(key) ?? null,
      setItem: (key, value) => { items.set(key, String(value)); },
      removeItem: key => items.delete(key),
      get length() { return items.size; },
      key(index) { return [...items.keys()][index] || null; }
    },
    addEventListener() {},
    setTimeout: timer, clearTimeout, Date, Math,
    TextEncoder, Uint8Array, JSON, Promise, console
  };
  vm.runInNewContext(SOURCE, context, { filename: 'js/core/db.js' });
  return {
    DB: context.G.DB, events, unblock,
    get remote() { return record; }
  };
}

async function untilEvent(events, name) {
  for (let i = 0; i < 30; i++) {
    if (events.includes(name)) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('No se recibió ' + name);
}

test('la eliminación espera transacciones activas y no restaura el guardado', async () => {
  const h = createHarness();
  assert.equal(await h.DB.ready(), true);
  h.DB.save.coins = 1000;
  h.DB.commit(true);
  const uploading = h.DB.flush();
  await untilEvent(h.events, 'transaction:reading');
  const deleting = h.DB.deleteAccount('secret');
  await untilEvent(h.events, 'reauth');
  for (let n = 0; n < 3; n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.includes('save:delete'), false, 'no debe borrar mientras hay escritura en curso');
  assert.equal(h.events.includes('auth:delete'), false);
  h.unblock();
  await uploading;
  const result = await deleting;
  assert.equal(result.ok, true);
  assert.equal(h.remote, null, 'la transacción no debe resucitar la partida borrada');
  assert.ok(h.events.indexOf('transaction:done') < h.events.indexOf('save:delete'));
  assert.ok(h.events.indexOf('save:delete') < h.events.indexOf('auth:delete'));
});

test('si una transacción no termina, se cancela el borrado sin perder la cuenta', async () => {
  const h = createHarness({ expireWait: true });
  assert.equal(await h.DB.ready(), true);
  h.DB.commit(true);
  const uploading = h.DB.flush();
  await untilEvent(h.events, 'transaction:reading');
  const result = await h.DB.deleteAccount('secret');
  assert.equal(result.ok, false);
  assert.equal(h.events.includes('save:delete'), false);
  assert.equal(h.events.includes('auth:delete'), false);
  assert.equal(h.DB.loggedIn, true);
  h.unblock();
  await uploading;
});
