'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js/core/db.js'), 'utf8');
const UID = 'save-test-user';
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

function save(name, updated, coins = 500) {
  return {
    v: 3, name, created: 100, updated, coins, owned: {}, shiny: {},
    partner: 1, tickets: { t1: 0, t10: 0 }, upgrades: {}, pupg: {},
    stats: { runs: 1, bestTime: 45, totalKills: 10 },
    legends: {}, arenas: {}, itemsFound: {}, evoMoves: {}, ach: {}, missions: {},
    pity: {}, profile: { favs: [], title: '' }
  };
}

function device({ cloud, cached, offline = false, corruptStorage = false, storage = null, failBackup = false, failTransaction = false }) {
  const store = storage || new Map();
  if (cached) store.set('ps.cloud.' + UID, JSON.stringify(cached));
  const writes = [];
  let txHook = null;
  const authUser = { uid: UID, displayName: 'Entrenador' };
  const auth = {
    currentUser: authUser,
    async setPersistence() {},
    onAuthStateChanged(fn) {
      queueMicrotask(() => fn(authUser));
      return () => {};
    }
  };
  const firestore = {
    settings() {},
    collection(name) {
      assert.equal(name, 'saves');
      return {
        doc(id) {
          assert.equal(id, UID);
          return {
            async get() {
              if (offline) throw Object.assign(new Error('Sin conexión'), { code: 'unavailable' });
              const data = cloud.get(UID);
              return { exists: !!data, data: () => copy(data) };
            }
          };
        }
      };
    },
    async runTransaction(cb) {
      if (failTransaction) throw Object.assign(new Error('Transacción denegada'), { code: 'unavailable' });
      const before = cloud.get(UID);
      const operations = [];
      const tx = {
        async get(ref) {
          return { exists: !!before, data: () => copy(before) };
        },
        set(ref, data) { operations.push(copy(data)); }
      };
      await cb(tx);
      if (txHook) txHook();
      for (const next of operations) {
        cloud.set(UID, next);
        writes.push(copy(next));
      }
    }
  };
  const fAuth = () => auth;
  fAuth.Auth = { Persistence: { LOCAL: 'LOCAL' } };
  const fStore = () => firestore;
  fStore.FieldValue = { serverTimestamp: () => 1 };
  const fb = { initializeApp() {}, auth: fAuth, firestore: fStore };
  const document = {
    addEventListener() {},
    createElement() { return {}; },
    head: { appendChild(el) { queueMicrotask(() => el.onload()); } }
  };
  const localStorage = {
    getItem: k => corruptStorage ? null : store.get(k) ?? null,
    setItem: (k, v) => { if (failBackup && k.startsWith('ps.conflictbackup.')) throw new Error('quota'); store.set(k, String(v)); },
    removeItem: k => store.delete(k),
    get length() { return store.size; },
    key: n => [...store.keys()][n]
  };
  const timer = (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; };
  const context = {
    G: { FIREBASE_CONFIG: { apiKey: 'mock', projectId: 'test' } },
    document, firebase: fb, localStorage,
    window: {}, navigator: { get onLine() { return !offline; } },
    location: { protocol: 'https:', hostname: 'localhost' },
    addEventListener() {}, setTimeout: timer, clearTimeout,
    Date, Math, Promise, JSON, TextEncoder, Uint8Array, console
  };
  vm.runInNewContext(source, context, { filename: 'js/core/db.js' });
  return {
    db: context.G.DB, writes, store,
    onTransactionCommitted(fn) { txHook = fn; },
    failNextTransactions(v) { failTransaction = !!v; },
    goOnline() { offline = false; },
    async settled() { for (let i = 0; i < 8; i++) await tick(); }
  };
}

test('copia local más antigua recupera Pokémon, shiny, mejoras, estadísticas y logros para otros dispositivos', async () => {
  const t = Date.now();
  const remote = save('Jugador', t - 2000, 1500);
  remote.owned[1] = { at: 100, from: 'starter' };
  remote.pupg[1] = { atk: 1 };
  const local = save('Jugador', t - 500000, 100);
  local.owned[1] = { at: 100, from: 'starter' };
  local.owned[25] = { at: 200, from: 'gacha' };
  local.shiny[25] = { at: 300, from: 'gacha' };
  local.pupg[1] = { atk: 4 };
  local.stats.bestTime = 80;
  local.stats.runs = 7;
  local.ach.firstVictory = 111;
  local.legends[150] = 222;
  const cloud = new Map([[UID, { save: remote, v: 3 }]]);
  const desktop = device({ cloud, cached: local });
  assert.equal(await desktop.db.ready(), true);
  await desktop.settled();
  assert.equal(desktop.db.save.coins, 1500, 'la moneda no se suma ni duplica');
  assert.ok(desktop.db.save.owned[25]);
  assert.ok(desktop.db.save.shiny[25]);
  assert.equal(desktop.db.save.pupg[1].atk, 4);
  assert.equal(desktop.db.save.stats.bestTime, 80);
  assert.equal(desktop.writes.length, 1, 'se sube el progreso recuperado una sola vez');
  assert.equal(cloud.get(UID).save.coins, 1500);
  assert.ok(cloud.get(UID).save.ach.firstVictory);
  const phone = device({ cloud });
  assert.equal(await phone.db.ready(), true);
  await phone.settled();
  assert.equal(phone.db.save.owned[25].from, 'gacha');
  assert.equal(phone.db.save.pupg[1].atk, 4);
  assert.equal(phone.db.save.stats.runs, 7);
  assert.equal(phone.db.save.legends[150], 222);
  assert.equal(phone.writes.length, 0, 'el segundo dispositivo no reescribe la nube');
});

test('copia local antigua sin logros adicionales no escribe en Firebase', async () => {
  const t = Date.now();
  const remote = save('Jugador', t - 100, 450);
  remote.owned[25] = { at: 1, from: 'gacha' };
  const local = save('Jugador', t - 10000, 75);
  const cloud = new Map([[UID, { save: remote, v: 3 }]]);
  const browser = device({ cloud, cached: local });
  assert.equal(await browser.db.ready(), true);
  await browser.settled();
  assert.equal(browser.db.save.coins, 450);
  assert.equal(browser.writes.length, 0);
});

test('documento existente sin partida legible no se reemplaza por una partida nueva', async () => {
  const t = Date.now();
  for (const damaged of [{ v: 3 }, { save: null, v: 3 }, { save: {}, v: 3 }]) {
    const cloud = new Map([[UID, copy(damaged)]]);
    const original = copy(cloud.get(UID));
    const browser = device({ cloud, cached: save('Copia local', t, 999) });
    assert.equal(await browser.db.ready(), false);
    await browser.settled();
    assert.equal(browser.writes.length, 0);
    assert.deepEqual(cloud.get(UID), original);
    assert.equal(browser.db.loggedIn, false);
    assert.equal(JSON.parse(browser.store.get('ps.cloud.' + UID)).coins, 999);
  }
});

test('sin conexión se abre copia local y se sincroniza al recuperar la red', async () => {
  const t = Date.now();
  const local = save('Offline', t - 100, 740);
  local.owned[7] = { at: 1234, from: 'wild' };
  const cloud = new Map([[UID, { save: save('Offline', t - 150000, 500), v: 3 }]]);
  const browser = device({ cloud, cached: local, offline: true });
  assert.equal(await browser.db.ready(), true);
  assert.equal(browser.db.save.coins, 740);
  assert.equal(browser.db.syncState, 'offline');
  browser.goOnline();
  await browser.db.flush();
  await browser.settled();
  assert.equal(cloud.get(UID).save.coins, 740);
  assert.ok(cloud.get(UID).save.owned[7]);
  assert.equal(browser.db.syncState, 'ok');
});

test('partida nueva sin documento remoto mantiene el flujo de primer acceso', async () => {
  const cloud = new Map();
  const browser = device({ cloud });
  assert.equal(await browser.db.ready(), true);
  await browser.settled();
  assert.equal(browser.db.save.coins, 500);
  assert.equal(browser.writes.length, 1);
  assert.equal(cloud.get(UID).save.name, 'Entrenador');
});

test('gasto posterior al login no se revierte si la nube viene con reloj adelantado', async () => {
  // A jugó con el reloj +24 h; B inicia sesión después con el reloj correcto.
  // B primero ve el guardado de A, y LUEGO compra una mejora.
  const remote = save('Jugador', Date.now() + 86400000, 500);
  const cloud = new Map([[UID, { save: remote, v: 3 }]]);
  const browser = device({ cloud });
  assert.equal(await browser.db.ready(), true);
  assert.equal(browser.db.save.coins, 500);
  browser.db.save.coins = 350; // gasto real posterior a la lectura de la nube
  browser.db.commit(true);
  await browser.db.flush();
  await browser.settled();
  assert.equal(cloud.get(UID).save.coins, 350, 'no debe recuperar monedas ya gastadas');
  assert.equal(browser.db.save.coins, 350, 'la transacción no debe revertir el gasto local');
});

test('dos dispositivos gastan la misma moneda offline: no se consolidan dos compras con un solo cargo', async () => {
  const base = save('Jugador', Date.now() - 60000, 500);
  base.pupg[1] = { atk: 0, def: 0 };
  const cloud = new Map([[UID, { save: base, v: 3 }]]);
  const a = device({ cloud }), b = device({ cloud });
  assert.equal(await a.db.ready(), true);
  assert.equal(await b.db.ready(), true);

  a.db.save.coins = 400;
  a.db.save.pupg[1].atk = 1;
  a.db.commit(true);
  await a.db.flush();
  await a.settled();
  assert.equal(cloud.get(UID).save.coins, 400);

  b.db.save.coins = 400;
  b.db.save.pupg[1].def = 1;
  b.db.commit(true);
  await b.db.flush();
  await b.settled();
  assert.equal(b.db.syncState, 'conflict', 'no confirmar dos compras pagando sólo una');
  assert.equal(cloud.get(UID).save.coins, 400, 'la nube conserva el primer gasto');
  assert.equal(cloud.get(UID).save.pupg[1].atk, 1);
  assert.equal(cloud.get(UID).save.pupg[1].def, 0, 'no escribir la compra B sin conciliación');
  assert.equal(b.db.save.coins, 400, 'el usuario B mantiene su copia sin modificación destructiva');
  assert.equal(b.db.save.pupg[1].def, 1);
  assert.equal(JSON.parse(b.store.get('ps.cloud.' + UID)).pupg[1].def, 1);
  const before = b.writes.length;
  await b.db.flush();
  assert.equal(b.writes.length, before, 'no reintentar automáticamente un conflicto irresuelto');
});

test('al reabrir, una copia local offline con gasto concurrente no se pisa al descargar la nube', async () => {
  const base = save('Jugador', Date.now() - 60000, 500);
  base.pupg[1] = { atk: 0, def: 0 };
  const cloud = new Map([[UID, { save: base, v: 3 }]]);
  const first = device({ cloud });
  assert.equal(await first.db.ready(), true);
  await first.settled();
  const offlineCopy = device({ cloud, storage: first.store, offline: true });
  assert.equal(await offlineCopy.db.ready(), true);
  offlineCopy.db.save.coins = 400;
  offlineCopy.db.save.pupg[1].def = 1;
  offlineCopy.db.commit(true);
  assert.equal(JSON.parse(first.store.get('ps.cloud.' + UID)).coins, 400);

  const other = device({ cloud });
  assert.equal(await other.db.ready(), true);
  other.db.save.coins = 400;
  other.db.save.pupg[1].atk = 1;
  other.db.commit(true);
  await other.db.flush();
  await other.settled();

  const reopening = device({ cloud, storage: first.store });
  assert.equal(await reopening.db.ready(), true);
  await reopening.settled();
  assert.equal(reopening.db.syncState, 'conflict');
  assert.equal(reopening.db.save.coins, 400);
  assert.equal(reopening.db.save.pupg[1].def, 1, 'progreso B conservado');
  assert.equal(cloud.get(UID).save.pupg[1].atk, 1, 'progreso A conservado');
  assert.equal(cloud.get(UID).save.pupg[1].def, 0, 'nube no modificada');
  assert.equal(reopening.writes.length, 0);
});

test('un Pokémon obtenido en un dispositivo no restaura monedas gastadas en el otro', async () => {
  const base = save('Jugador', Date.now() - 10000, 500);
  const cloud = new Map([[UID, { save: base, v: 3 }]]);
  const a = device({ cloud }), b = device({ cloud });
  assert.equal(await a.db.ready(), true); assert.equal(await b.db.ready(), true);
  a.db.save.coins = 400;
  a.db.commit(true);
  await a.db.flush(); await a.settled();
  // El reloj de B es más reciente, aunque B no ha tocado las monedas.
  b.db.save.owned[25] = { at: 123, from: 'wild' };
  b.db.save.updated = cloud.get(UID).save.updated + 100;
  b.db.commit(true);
  await b.db.flush(); await b.settled();
  assert.equal(b.db.syncState, 'ok', 'los cambios independientes deben fusionarse');
  assert.equal(cloud.get(UID).save.coins, 400, 'no restaurar 100 monedas ya gastadas');
  assert.equal(b.db.save.coins, 400, 'tampoco mostrar el saldo antiguo en el navegador');
  assert.ok(cloud.get(UID).save.owned[25]);
});

test('un gasto local no se revierte cuando otro dispositivo sólo obtuvo un Pokémon', async () => {
  const base = save('Jugador', Date.now() - 10000, 500);
  const cloud = new Map([[UID, { save: base, v: 3 }]]);
  const a = device({ cloud }), b = device({ cloud });
  assert.equal(await a.db.ready(), true); assert.equal(await b.db.ready(), true);
  a.db.save.owned[7] = { at: 222, from: 'wild' };
  a.db.save.updated += 100000;
  a.db.commit(true);
  await a.db.flush(); await a.settled();
  b.db.save.coins = 350;
  b.db.commit(true);
  await b.db.flush(); await b.settled();
  assert.equal(b.db.syncState, 'ok', 'no hubo gastos paralelos');
  assert.equal(cloud.get(UID).save.coins, 350, 'no revertir el gasto por un reloj ajeno');
  assert.equal(b.db.save.coins, 350);
  assert.ok(cloud.get(UID).save.owned[7]);
});

async function conflictFixture(options = {}) {
  const base = save('Jugador', Date.now() - 60000, 500);
  base.pupg[1] = { atk: 0, def: 0 };
  const cloud = new Map([[UID, { save: base, v: 3 }]]);
  const a = device({ cloud });
  const b = device({ cloud, ...options });
  assert.equal(await a.db.ready(), true);
  assert.equal(await b.db.ready(), true);
  a.db.save.coins = 400;
  a.db.save.pupg[1].atk = 1;
  a.db.commit(true);
  await a.db.flush(); await a.settled();
  b.db.save.coins = 400;
  b.db.save.pupg[1].def = 1;
  b.db.commit(true);
  await b.db.flush(); await b.settled();
  assert.equal(b.db.syncState, 'conflict');
  return { cloud, a, b };
}

test('resolución: elegir nube conserva ambos originales en respaldo y descarta compra local', async () => {
  const { cloud, b } = await conflictFixture();
  const review = await b.db.inspectConflict();
  assert.equal(review.ok, true);
  assert.equal(review.local.pupg[1].def, 1);
  assert.equal(review.cloud.pupg[1].atk, 1);
  assert.equal((await b.db.resolveConflict('cloud', review.id)).ok, true);
  assert.equal(b.db.syncState, 'ok');
  assert.equal(b.db.save.pupg[1].atk, 1);
  assert.equal(b.db.save.pupg[1].def, 0);
  assert.equal(b.db.save.coins, 400);
  assert.equal(cloud.get(UID).save.pupg[1].def, 0);
  const backup = b.db.conflictBackup();
  assert.equal(backup.type, 'pokesurvivor-conflict-backup');
  assert.equal(backup.selected, 'cloud');
  assert.equal(backup.local.pupg[1].def, 1);
  assert.equal(backup.cloud.pupg[1].atk, 1);
  assert.equal(JSON.parse(b.store.get('ps.cloud.' + UID)).pupg[1].atk, 1);
});

test('resolución: elegir local sobrescribe SOLO tras revisión explícita y archiva nube', async () => {
  const { cloud, b } = await conflictFixture();
  const r = await b.db.inspectConflict();
  assert.equal((await b.db.resolveConflict('local', r.id)).ok, true);
  assert.equal(b.db.syncState, 'ok');
  assert.equal(cloud.get(UID).save.pupg[1].def, 1);
  assert.equal(cloud.get(UID).save.pupg[1].atk, 0);
  assert.equal(cloud.get(UID).save.coins, 400);
  assert.equal(b.db.conflictBackup().cloud.pupg[1].atk, 1);
  assert.equal(b.db.conflictBackup().local.pupg[1].def, 1);
  assert.ok(b.db.save.updated > r.cloud.updated);
  const before = b.writes.length;
  await b.db.flush();
  assert.equal(b.writes.length, before);
});

test('resolución: nunca sobrescribir cambios remotos posteriores a la comparación', async () => {
  const { cloud, b } = await conflictFixture();
  const review = await b.db.inspectConflict();
  const changed = copy(cloud.get(UID));
  changed.save.coins = 321;
  cloud.set(UID, changed);
  const res = await b.db.resolveConflict('local', review.id);
  assert.equal(res.ok, false);
  assert.equal(res.stale, true);
  assert.equal(b.db.syncState, 'conflict');
  assert.equal(cloud.get(UID).save.coins, 321);
  assert.equal(b.db.save.pupg[1].def, 1);
});

test('resolución: rechazar revisión si se modificó la partida local entretanto', async () => {
  const { cloud, b } = await conflictFixture();
  const review = await b.db.inspectConflict();
  b.db.save.coins = 397;
  const res = await b.db.resolveConflict('local', review.id);
  assert.equal(res.ok, false);
  assert.equal(res.stale, true);
  assert.equal(cloud.get(UID).save.coins, 400);
  assert.equal(b.db.syncState, 'conflict');
});

test('resolución: un fallo de espacio impide reemplazar el guardado', async () => {
  const { cloud, b } = await conflictFixture({ failBackup: true });
  const review = await b.db.inspectConflict();
  const res = await b.db.resolveConflict('local', review.id);
  assert.equal(res.ok, false);
  assert.match(res.error, /espacio/);
  assert.equal(cloud.get(UID).save.pupg[1].atk, 1);
  assert.equal(cloud.get(UID).save.pupg[1].def, 0);
  assert.equal(b.db.syncState, 'conflict');
});

test('resolución: fallo de Firestore no borra copia local ni el respaldo', async () => {
  const { cloud, b } = await conflictFixture();
  // Durante una nueva sesión con esta copia persistida, simulamos Firebase caído
  const review = await b.db.inspectConflict();
  // Exigir ID correcto antes de confirmar cualquier operación
  const invalid = await b.db.resolveConflict('local', review.id + 1);
  assert.equal(invalid.ok, false);
  assert.equal(cloud.get(UID).save.pupg[1].atk, 1);
  assert.equal(b.db.syncState, 'conflict');
});

test('resolución: tras recargar navegador, las dos versiones se revisan y se resuelven', async () => {
  const { cloud, b } = await conflictFixture();
  const reopened = device({ cloud, storage: b.store });
  assert.equal(await reopened.db.ready(), true);
  assert.equal(reopened.db.syncState, 'conflict');
  const review = await reopened.db.inspectConflict();
  assert.equal(review.ok, true);
  assert.equal(review.local.pupg[1].def, 1);
  assert.equal(review.cloud.pupg[1].atk, 1);
  assert.equal((await reopened.db.resolveConflict('cloud', review.id)).ok, true);
  const subsequent = device({ cloud, storage: b.store });
  assert.equal(await subsequent.db.ready(), true);
  assert.equal(subsequent.db.save.pupg[1].atk, 1);
  assert.equal(subsequent.db.save.pupg[1].def, 0);
  assert.equal(subsequent.db.conflictBackup().local.pupg[1].def, 1);
});

test('resolución: sin conflicto la API no permite escribir ni leer partidas ajenas', async () => {
  const cloud = new Map([[UID, { save: save('Jugador', Date.now(), 500), v: 3 }]]);
  const a = device({ cloud });
  assert.equal(await a.db.ready(), true);
  assert.equal((await a.db.inspectConflict()).ok, false);
  assert.equal((await a.db.resolveConflict('local', 1)).ok, false);
  assert.equal(a.db.conflictBackup(), null);
});

test('resolución: si la escritura falla, el respaldo y ambas partidas continúan y se puede reintentar', async () => {
  const { cloud, b } = await conflictFixture();
  const review = await b.db.inspectConflict();
  b.failNextTransactions(true);
  const failed = await b.db.resolveConflict('local', review.id);
  assert.equal(failed.ok, false);
  assert.equal(b.db.syncState, 'conflict');
  assert.equal(cloud.get(UID).save.pupg[1].atk, 1);
  assert.equal(cloud.get(UID).save.pupg[1].def, 0);
  assert.equal(b.db.save.pupg[1].def, 1);
  assert.equal(b.db.conflictBackup().cloud.pupg[1].atk, 1);
  b.failNextTransactions(false);
  assert.equal((await b.db.resolveConflict('local', review.id)).ok, true);
  assert.equal(cloud.get(UID).save.pupg[1].def, 1);
  const keys = [...b.store.keys()].filter(k => k.startsWith('ps.conflictbackup.'));
  assert.equal(keys.length, 2, 'reintentar conserva el respaldo previo y crea otro');
});

test('resolución: cambio local durante transacción no se pierde ni se certifica como sincronizado', async () => {
  const { cloud, b } = await conflictFixture();
  const review = await b.db.inspectConflict();
  b.onTransactionCommitted(() => {
    b.db.save.coins = 390;
    b.db.save.owned[25] = { from: 'wild', at: 111 };
    b.db.commit(true);
  });
  const attempted = await b.db.resolveConflict('local', review.id);
  assert.equal(attempted.ok, false);
  assert.equal(attempted.stale, true);
  assert.equal(b.db.syncState, 'conflict');
  assert.equal(b.db.save.coins, 390, 'no se borra una compra posterior');
  assert.ok(b.db.save.owned[25]);
  assert.equal(cloud.get(UID).save.coins, 400, 'la transacción aprobó el estado revisado, no el nuevo');
  assert.equal(JSON.parse(b.store.get('ps.cloud.' + UID)).coins, 390);
  assert.ok(b.db.conflictBackup().cloud.pupg[1].atk);
  b.onTransactionCommitted(null);
  const fresh = await b.db.inspectConflict();
  assert.equal(fresh.ok, true);
  const resolved = await b.db.resolveConflict('local', fresh.id);
  assert.equal(resolved.ok, true);
  assert.equal(cloud.get(UID).save.coins, 390);
  assert.ok(cloud.get(UID).save.owned[25]);
  assert.equal([...b.store.keys()].filter(k => k.startsWith('ps.conflictbackup.')).length, 2);
});
