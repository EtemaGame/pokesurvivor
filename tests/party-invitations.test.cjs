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
