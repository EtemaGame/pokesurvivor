'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function socialFixture(failRoom = false) {
  const writes = [], events = [];
  const G = {
    DB: {
      onLeave() {}, save: { partner: 25, partnerShiny: false },
      ownsShiny: () => false
    },
    Social: null
  };
  const fb = {
    uid: 'owner',
    rtdb: {
      goOnline() { events.push('online'); },
      goOffline() { events.push('offline'); },
      ref(path) {
        return {
          push: () => ({ key: 'unpredictable-room-id' }),
          set: async value => {
            if (failRoom && path.startsWith('rooms/')) throw { code: 'PERMISSION_DENIED' };
            writes.push({ path, value });
          },
          onDisconnect: () => ({ remove() {} }),
          on() {}, off() {}
        };
      }
    },
    fs: { collection(col) {
      return { doc(id) { return {
        async set(value) { writes.push({ path: col + '/' + id, value }); }
      }; } };
    } }
  };
  const raw = src('js/net/social.js');
  const tag = '  return {\n    start, stop, claimNick, request, accept, remove, publishProfile, getProfile, profileData,';
  assert.ok(raw.includes(tag));
  const injected = raw.replace(tag,
    '  return {\n    __test: { setup() {\n' +
    "      fb = G.__testFirebase; uid = 'owner'; me = { uid, name: 'Anfitrion' };\n" +
    "      friends.set('friend', { uid: 'friend', status: 'ok', online: false, play: false, name: 'Amigo' });\n" +
    '    } },\n    start, stop, claimNick, request, accept, remove, publishProfile, getProfile, profileData,');
  G.__testFirebase = fb;
  vm.runInNewContext(injected, { G, firebase: {
    database: { ServerValue: { TIMESTAMP: 100 } },
    firestore: { FieldValue: { serverTimestamp: () => 100 } }
  }, window: {}, document: {} });
  G.Social.__test.setup();
  return { G, writes, events };
}

test('amistad confirmada: la invitación no depende del estado online obsoleto', async () => {
  const x = socialFixture();
  const r = await x.G.Social.invite('friend');
  assert.equal(r.ok, true);
  const inv = x.writes.find(w => w.path === 'inv/friend_owner');
  assert.ok(inv, 'La invitación se escribió en Firestore');
  assert.equal(inv.value.room, 'unpredictable-room-id');
  assert.equal(x.G.Social.room.isHost, true);
});

test('si la base de datos rechaza crear la sala, se muestra error y se desconecta', async () => {
  const x = socialFixture(true);
  const r = await x.G.Social.invite('friend');
  assert.equal(r.ok, false);
  assert.match(r.error, /PERMISSION_DENIED/);
  assert.ok(x.events.includes('offline'));
  assert.equal(x.G.Social.room, null);
});

test('la pantalla Amigos ofrece Invitar a un amigo confirmado aunque no esté online', () => {
  const nodes = new Map();
  function domNode() {
    return {
      children: [], style: {}, dataset: {}, textContent: '',
      classList: { toggle() {}, add() {}, remove() {} },
      set innerHTML(v) { this.html = v; this.children.length = 0; },
      get innerHTML() { return this.html || ''; },
      querySelector() { return { onclick: null }; },
      appendChild(child) { this.children.push(child); }
    };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, domNode()); return nodes.get(id); };
  const friend = { uid: 'friend', name: 'Amigo', status: 'ok', online: false, play: false, room: '', seen: 0 };
  const G = {
    UI: { $, isOpen: () => true },
    DB: { online: true },
    Social: { me: { name: 'Anfitrion' }, friends: [friend], room: null,
      now: () => Date.now(), refreshPresence() {}, on() {}, invite: async () => ({ ok: true }) },
    Audio: { sfx() {} }
  };
  vm.runInNewContext(src('js/ui/social-ui.js'), { G, document: { createElement: domNode }, window: {} });
  G.FriendsUI.render();
  const buttons = nodes.get('fr-list').children[0].children.map(n => n.textContent);
  assert.ok(buttons.includes('Invitar'), 'No ocultar el botón por presencia caducada');
});

test('crear sala explícitamente funciona sin amigos y una sola vez con solicitudes simultáneas', async () => {
  const x = socialFixture();
  const [a, b] = await Promise.all([x.G.Social.createRoom(), x.G.Social.createRoom()]);
  assert.equal(a.id, 'unpredictable-room-id');
  assert.equal(b.id, a.id);
  assert.equal(x.writes.filter(w => w.path === 'rooms/unpredictable-room-id').length, 1);
  assert.equal(x.G.Social.room.isHost, true);
});

test('si falla crear sala directamente, devuelve permiso denegado y apaga Realtime Database', async () => {
  const x = socialFixture(true);
  await assert.rejects(x.G.Social.createRoom(), e => e && e.code === 'PERMISSION_DENIED');
  assert.equal(x.G.Social.room, null);
  assert.ok(x.events.includes('offline'));
});

function friendsScreenFixture(makeRoom = async () => {}) {
  const nodes = new Map();
  const node = () => ({
    children: [], style: {}, dataset: {}, textContent: '', disabled: false,
    classList: {
      classes: new Set(),
      toggle(name, flag) { if (flag) this.classes.add(name); else this.classes.delete(name); },
      add(name) { this.classes.add(name); },
      remove(name) { this.classes.delete(name); },
      contains(name) { return this.classes.has(name); }
    },
    set innerHTML(v) { this.html = v; this.children.length = 0; },
    get innerHTML() { return this.html || ''; },
    appendChild(el) { this.children.push(el); }
  });
  const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  let opened = 0, calls = 0;
  const G = {
    UI: { $, isOpen: () => true },
    DB: { online: true },
    Social: {
      me: { name: 'Anfitrion' }, friends: [], room: null,
      now: () => Date.now(), refreshPresence() {}, on() {},
      createRoom() { calls++; return makeRoom(); }
    },
    Audio: { sfx() {} }
  };
  vm.runInNewContext(src('js/ui/social-ui.js'), { G, document: { createElement: node }, window: {} });
  G.LobbyUI.open = () => { opened++; };
  G.FriendsUI.init();
  G.FriendsUI.render();
  return { G, node: $, get calls() { return calls; }, get opened() { return opened; } };
}

test('Amigos muestra Crear sala incluso sin amigos; al pulsar abre la sala', async () => {
  const x = friendsScreenFixture();
  assert.equal(x.node('fr-create').classList.contains('hidden'), false);
  assert.equal(x.node('fr-room').classList.contains('hidden'), true);
  await x.node('fr-create').onclick();
  assert.equal(x.calls, 1);
  assert.equal(x.opened, 1);
  assert.equal(x.node('fr-create').disabled, false);
});

test('Crear sala informa errores reales, no abre lobby y deja reintentar', async () => {
  const x = friendsScreenFixture(async () => { throw { code: 'PERMISSION_DENIED' }; });
  await x.node('fr-create').onclick();
  assert.match(x.node('fr-msg').textContent, /PERMISSION_DENIED/);
  assert.equal(x.opened, 0);
  assert.equal(x.node('fr-create').disabled, false);
});

test('Crear sala bloquea pulsaciones duplicadas durante una subida lenta', async () => {
  let release;
  const x = friendsScreenFixture(() => new Promise(resolve => { release = resolve; }));
  const first = x.node('fr-create').onclick();
  await x.node('fr-create').onclick();
  assert.equal(x.calls, 1);
  assert.equal(x.node('fr-create').disabled, true);
  release({});
  await first;
  assert.equal(x.node('fr-create').disabled, false);
  assert.equal(x.opened, 1);
});
