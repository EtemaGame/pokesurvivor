'use strict';
// Integration test against REAL Firebase Auth + Firestore emulators. No production use.
// Run: npx firebase-tools emulators:exec --project demo-pokesurvivor --only auth,firestore \
//      "node --test tests/firebase-emulator-save.test.cjs"
const { test } = require('node:test');
const assert = require('node:assert/strict');

const PROJECT = 'demo-pokesurvivor';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const dbHost = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = !!(authHost && dbHost && process.env.GCLOUD_PROJECT === PROJECT);

async function req(base, url, options = {}) {
  const response = await fetch('http://' + base + url, options);
  const raw = await response.text();
  let value;
  try { value = JSON.parse(raw); } catch { value = { raw }; }
  return { status: response.status, value };
}
async function signUp(name) {
  const res = await req(authHost, '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: name + '@emulator.invalid', password: 'SafePassword123!', returnSecureToken: true })
  });
  assert.equal(res.status, 200, JSON.stringify(res.value));
  return { uid: res.value.localId, token: res.value.idToken };
}
function fields(coins) {
  return {
    coins: { integerValue: String(coins) },
    tickets: { mapValue: { fields: {
      t1: { integerValue: '0' }, t10: { integerValue: '0' }
    } } }
  };
}
const root = '/v1/projects/' + PROJECT + '/databases/(default)/documents';
async function write(user, targetUid, coins, banned = undefined, expectedUpdateTime = undefined) {
  const entries = {
    save: { mapValue: { fields: fields(coins) } },
    v: { integerValue: '3' }
  };
  if (banned !== undefined) entries.ban = { booleanValue: banned };
  return req(dbHost, root + ':commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + user.token },
    body: JSON.stringify({ writes: [{
      update: { name: 'projects/' + PROJECT + '/databases/(default)/documents/saves/' + targetUid, fields: entries },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      ...(expectedUpdateTime ? { currentDocument: { updateTime: expectedUpdateTime } } : {})
    }] })
  });
}
async function read(user, uid) {
  return req(dbHost, root + '/saves/' + uid, {
    headers: { authorization: 'Bearer ' + user.token }
  });
}
test('emuladores Auth + Firestore: separación de dos usuarios y preservación de baneo', {
  skip: !enabled ? 'requiere emuladores y proyecto demo-pokesurvivor' : false, timeout: 60000
}, async () => {
  const a = await signUp('alice'), b = await signUp('bob');
  assert.notEqual(a.uid, b.uid);
  const first = await write(a, a.uid, 500);
  assert.equal(first.status, 200, JSON.stringify(first.value));
  const own = await read(a, a.uid);
  assert.equal(own.status, 200, JSON.stringify(own.value));
  assert.equal(Number(own.value.fields.save.mapValue.fields.coins.integerValue), 500);
  const forbiddenRead = await read(b, a.uid);
  assert.equal(forbiddenRead.status, 403, 'B no puede leer la partida A');
  const forbiddenWrite = await write(b, a.uid, 9999);
  assert.equal(forbiddenWrite.status, 403, 'B no puede escribir la partida A');
  assert.equal((await write(b, b.uid, 900)).status, 200, 'B sí puede crear su partida');
  assert.equal((await write(a, a.uid, 350)).status, 200, 'A puede guardar su compra');
  assert.equal(Number((await read(a, a.uid)).value.fields.save.mapValue.fields.coins.integerValue), 350);
  const unauthorizedBan = await write(a, a.uid, 350, true);
  assert.equal(unauthorizedBan.status, 403, 'el propietario no puede autoestablecer un baneo');
});

test('emulador Firestore: dos escrituras con misma revisión no pueden confirmar ambas', {
  skip: !enabled ? 'requiere emuladores y proyecto demo-pokesurvivor' : false, timeout: 60000
}, async () => {
  const user = await signUp('simultaneous');
  assert.equal((await write(user, user.uid, 500)).status, 200);
  const base = await read(user, user.uid);
  assert.equal(base.status, 200);
  assert.ok(base.value.updateTime);
  const [first, second] = await Promise.all([
    write(user, user.uid, 400, undefined, base.value.updateTime),
    write(user, user.uid, 350, undefined, base.value.updateTime)
  ]);
  const statuses = [first.status, second.status].sort();
  assert.equal(statuses.filter(n => n === 200).length, 1, 'sólo una actualización coincide con la revisión');
  assert.equal(statuses.filter(n => n !== 200).length, 1, 'la segunda debe fallar al cambiar la nube');
  const result = await read(user, user.uid);
  assert.equal(result.status, 200);
  assert.ok([350, 400].includes(Number(result.value.fields.save.mapValue.fields.coins.integerValue)));
});
