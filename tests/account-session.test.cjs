'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'js/core/db.js'), 'utf8');

function harness({ transactionTimeout = false, delayedRead = false } = {}) {
  const events = [], storage = new Map();
  const accounts = {
    a: { uid: 'uid-A', email: 'a@jugadores.pokesurvivor.net' },
    b: { uid: 'uid-B', email: 'b@jugadores.pokesurvivor.net' }
  };
  const makeSave = (name, coins) => ({
    v: 3, name, created: 100, updated: Date.now() - 5000, coins,
    tickets: { t1: 0, t10: 0 }, owned: {}, shiny: {}, stats: {},
    upgrades: {}, pupg: {}, legends: {}, arenas: {}, itemsFound: {},
    evoMoves: {}, ach: {}, missions: {}
  });
  const records = new Map([
    ['uid-A', { save: makeSave('Alfa', 100), v: 3 }],
    ['uid-B', { save: makeSave('Beta', 900), v: 3 }]
  ]);
  let unblockA;
  const heldA = new Promise(resolve => { unblockA = resolve; });
  let holdReauth = false, unblockReauth;
  const reauthGate = new Promise(resolve => { unblockReauth = resolve; });
  for (const id of ['a', 'b']) {
    accounts[id].reauthenticateWithCredential = async () => {
      events.push('reauth:' + accounts[id].uid);
      if (holdReauth) await reauthGate;
    };
    accounts[id].delete = async () => { events.push('auth:delete:' + accounts[id].uid); };
  }
  let unblockRead;
  const heldRead = new Promise(resolve => { unblockRead = resolve; });
  let slowNextReadA = false;
  const auth = {
    currentUser: accounts.a,
    async setPersistence() {},
    onAuthStateChanged(cb) {
      queueMicrotask(() => cb(this.currentUser));
      return () => {};
    },
    async signInWithEmailAndPassword(email) {
      this.currentUser = accounts[email.includes('62657461') ? 'b' : 'a'];
      events.push('login:' + this.currentUser.uid);
      return { user: this.currentUser };
    },
    async signOut() { events.push('signout'); this.currentUser = null; }
  };
  const db = {
    settings() {},
    collection(name) {
      assert.equal(name, 'saves');
      return {
        doc(uid) {
          return {
            uid,
            async get() {
              events.push('read:' + uid);
              if (uid === 'uid-A' && slowNextReadA) {
                slowNextReadA = false;
                await heldRead;
              }
              const doc = records.get(uid);
              return { exists: !!doc, data: () => doc && JSON.parse(JSON.stringify(doc)) };
            },
            async delete() { records.delete(uid); }
          };
        }
      };
    },
    async runTransaction(fn) {
      events.push('transaction:start');
      const writes = [];
      const tx = {
        async get(ref) {
          events.push('transaction:get:' + ref.uid);
          if (ref.uid === 'uid-A') await heldA;
          const doc = records.get(ref.uid);
          return { exists: !!doc, data: () => doc && JSON.parse(JSON.stringify(doc)) };
        },
        set(ref, data) { writes.push([ref.uid, data]); }
      };
      await fn(tx);
      for (const [uid, doc] of writes) {
        records.set(uid, doc);
        events.push('transaction:set:' + uid);
      }
    }
  };
  const firebaseAuth = () => auth;
  firebaseAuth.Auth = { Persistence: { LOCAL: 'LOCAL' } };
  firebaseAuth.EmailAuthProvider = { credential: () => ({}) };
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: () => 1 };
  const fb = { initializeApp() {}, auth: firebaseAuth, firestore };
  const timers = [];
  function timer(fn, ms) {
    if (transactionTimeout && ms === 12000) return setTimeout(fn, 0);
    const id = setTimeout(fn, ms);
    id.unref?.();
    timers.push({ fn, ms, id });
    return id;
  }
  const document = {
    visibilityState: 'visible', addEventListener() {},
    createElement() { return {}; },
    head: { appendChild(el) { queueMicrotask(() => el.onload()); } }
  };
  const ctx = {
    G: { FIREBASE_CONFIG: { apiKey: 'test', projectId: 'test' } },
    firebase: fb, document, window: {},
    location: { protocol: 'https:', hostname: 'localhost' },
    navigator: { onLine: true }, addEventListener() {},
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
      get length() { return storage.size; },
      key: n => [...storage.keys()][n]
    },
    Date, Math, JSON, Promise, TextEncoder, Uint8Array,
    setTimeout: timer, clearTimeout, console
  };
  vm.runInNewContext(SOURCE, ctx, { filename: 'js/core/db.js' });
  return {
    DB: ctx.G.DB, accounts, auth, events, records, storage, timers,
    unblockA, unblockRead, unblockReauth,
    holdNextReauth() { holdReauth = true; },
    delayNextARead() { slowNextReadA = true; }
  };
}
async function untilEvent(events, prefix) {
  for (let i = 0; i < 100; i++) {
    if (events.some(e => e.startsWith(prefix))) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw Error('No apareció el evento: ' + prefix);
}

test('dos usuarios: una escritura A retrasada no contamina el guardado B', async () => {
  const h = harness();
  assert.equal(await h.DB.ready(), true);
  h.DB.save.coins = 150;
  h.DB.commit(true);
  const oldWrite = h.DB.flush();
  await untilEvent(h.events, 'transaction:get:uid-A');

  const loginB = await h.DB.login('Beta', 'secret');
  assert.equal(loginB.ok, true);
  assert.equal(h.DB.fb.uid, 'uid-B');
  assert.equal(h.DB.save.name, 'Beta');
  assert.equal(h.DB.save.coins, 900);
  h.DB.save.coins = 950;
  h.DB.commit();

  h.unblockA();
  await oldWrite;
  assert.equal(h.records.get('uid-A').save.coins, 150);
  assert.equal(h.records.get('uid-B').save.coins, 900);
  assert.equal(h.DB.save.coins, 950);
  assert.equal(h.DB.fb.uid, 'uid-B');
  assert.equal(JSON.parse(h.storage.get('ps.cloud.uid-B')).coins, 950);
  assert.equal(JSON.parse(h.storage.get('ps.cloud.uid-A')).coins, 150);
});

test('logout con escritura pendiente conserva A y permite login B', async () => {
  const h = harness();
  assert.equal(await h.DB.ready(), true);
  h.DB.save.coins = 225;
  h.DB.commit(true);
  const oldWrite = h.DB.flush();
  await untilEvent(h.events, 'transaction:get:uid-A');
  await h.DB.logout();
  assert.equal(h.DB.loggedIn, false);
  assert.equal(JSON.parse(h.storage.get('ps.cloud.uid-A')).coins, 225);
  assert.equal((await h.DB.login('Beta', 'secret')).ok, true);
  h.unblockA();
  await oldWrite;
  assert.equal(h.records.get('uid-A').save.coins, 225);
  assert.equal(h.DB.save.name, 'Beta');
  assert.equal(h.DB.save.coins, 900);
  assert.equal(h.DB.fb.uid, 'uid-B');
});

test('timeout de escritura A no dispara cambios en B cuando llega tarde', async () => {
  const h = harness({ transactionTimeout: true });
  assert.equal(await h.DB.ready(), true);
  h.DB.save.coins = 300;
  h.DB.commit(true);
  const oldWrite = h.DB.flush();
  await untilEvent(h.events, 'transaction:get:uid-A');
  await oldWrite; // superado el tope de 12 s simulado
  assert.equal((await h.DB.login('Beta', 'secret')).ok, true);
  h.unblockA();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.DB.save.coins, 900);
  assert.equal(h.DB.fb.uid, 'uid-B');
  assert.equal(h.records.get('uid-B').save.coins, 900);
  // Un reintento antiguo no debe generar una segunda escritura en el usuario B.
  for (const t of h.timers.filter(t => t.ms >= 1000)) t.fn();
  await Promise.resolve();
  assert.equal(h.events.filter(e => e === 'transaction:get:uid-B').length, 0);
});

test('una lectura A tardía no puede sobrescribir el login B', async () => {
  const h = harness({ delayedRead: true });
  assert.equal(await h.DB.ready(), true);
  h.delayNextARead();
  h.events.length = 0;
  const loginA = h.DB.login('Alfa', 'secret');
  await untilEvent(h.events, 'read:uid-A');
  const resultB = await h.DB.login('Beta', 'secret');
  assert.equal(resultB.ok, true);
  h.unblockRead();
  const resultA = await loginA;
  assert.equal(resultA.ok, false);
  assert.equal(h.DB.fb.uid, 'uid-B');
  assert.equal(h.DB.save.name, 'Beta');
});

test('borrado: si B entra durante la reautenticación A, no se borra B', async () => {
  const h = harness();
  assert.equal(await h.DB.ready(), true);
  h.holdNextReauth();
  const deletionA = h.DB.deleteAccount('secret');
  await untilEvent(h.events, 'reauth:uid-A');
  assert.equal((await h.DB.login('Beta', 'secret')).ok, true);
  h.unblockReauth();
  const result = await deletionA;
  assert.equal(result.ok, false);
  assert.equal(h.DB.fb.uid, 'uid-B');
  assert.equal(h.DB.save.coins, 900);
  assert.ok(h.records.has('uid-A'));
  assert.ok(h.records.has('uid-B'));
  assert.equal(h.events.some(e => e.startsWith('auth:delete:')), false);
});
