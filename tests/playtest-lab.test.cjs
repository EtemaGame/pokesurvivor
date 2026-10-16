'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = file => fs.readFileSync(file, 'utf8');
const runConfig = config => {
  const G = {};
  vm.runInNewContext(read('js/core/firebase-config.js'), {
    window: { PS_TEST_FIREBASE_CONFIG: config }, G
  });
  return G.FIREBASE_CONFIG;
};
const valid = {
  projectId: 'ps-test-grupo',
  authDomain: 'ps-test-grupo.firebaseapp.com',
  apiKey: 'test-only-api-key', appId: '1:123:web:test',
  databaseURL: 'https://ps-test-grupo-default-rtdb.europe-west1.firebasedatabase.app'
};

test('configuración vacía o real nunca activa Firebase oficial', () => {
  assert.equal(runConfig(null), null);
  assert.equal(runConfig({ ...valid, projectId: 'pokesurvivor-free' }), null);
  assert.equal(runConfig({ ...valid, projectId: 'otro-proyecto' }), null);
});

test('proyecto y servicios mezclados son rechazados', () => {
  assert.equal(runConfig({ ...valid, authDomain: 'pokesurvivor-free.firebaseapp.com' }), null);
  assert.equal(runConfig({ ...valid, databaseURL: 'https://pokesurvivor-free-default-rtdb.europe-west1.firebasedatabase.app' }), null);
  assert.equal(runConfig({ ...valid, appId: '' }), null);
});

test('solo se acepta un Firebase web del laboratorio', () => {
  const c = runConfig(valid);
  assert.equal(c.projectId, 'ps-test-grupo');
  assert.equal(c.databaseURL, valid.databaseURL);
});

function fixture() {
  const nodes = Object.create(null);
  const node = id => nodes[id] || (nodes[id] = {
    classList: { hidden: true, toggle(name, hide) { this.hidden = hide; } },
    textContent: '', onclick: null
  });
  const save = { coins: 0, tickets: { t1: 0, t10: 0 }, owned: {}, shiny: {} };
  let commits = 0, refreshes = 0, confirmations = 0;
  const DB = {
    online: true, mode: 'cloud', save,
    fb: { uid: 'test-account' },
    grant(dex) { save.owned[dex] = { at: 1, from: 'test' }; },
    grantShiny(dex) { save.shiny[dex] = { at: 1, from: 'test' }; },
    commit() { commits++; }
  };
  const G = {
    DB,
    FIREBASE_CONFIG: valid,
    DEX: [{ dex: 1 }, { dex: 2 }, { dex: 3 }],
    Sprites: { hasShiny: dex => dex !== 2 },
    Game: { state: 'ui' },
    UI: { $: node, refreshCoins() {}, toast() {} },
    MenuUI: { open() { refreshes++; } }
  };
  vm.runInNewContext(read('js/ui/test-lab.js'), { G, window: {
    confirm() { confirmations++; return true; }
  } });
  return { G, save, node, get commits() { return commits; }, get refreshes() { return refreshes; }, get confirmations() { return confirmations; } };
}

test('cada cuenta de laboratorio desbloquea Pokémon y shinies válidos', () => {
  const x = fixture();
  x.G.TestLab.init();
  assert.equal(x.node('lab-panel').classList.hidden, false);
  assert.equal(x.G.TestLab.seed(), true);
  assert.deepEqual(Object.keys(x.save.owned).sort(), ['1', '2', '3']);
  assert.deepEqual(Object.keys(x.save.shiny).sort(), ['1', '3']);
  assert.equal(x.save.coins, 50000);
  assert.equal(x.save.tickets.t1, 200);
  assert.equal(x.save.tickets.t10, 20);
  assert.equal(x.save.labSeeded, true);
  assert.equal(x.commits, 1);
});

test('repetir no duplica monedas, Pokémon ni tickets', () => {
  const x = fixture();
  assert.equal(x.G.TestLab.seed(), true);
  assert.equal(x.G.TestLab.seed(), true);
  assert.equal(x.save.coins, 50000);
  assert.equal(x.save.tickets.t1, 200);
  assert.equal(x.save.tickets.t10, 20);
  assert.equal(Object.keys(x.save.owned).length, 3);
  assert.equal(x.commits, 2);
});

test('cuenta real, invitado y partida activa no pueden invocar herramientas DEV', () => {
  const x = fixture();
  x.G.FIREBASE_CONFIG = { ...valid, projectId: 'pokesurvivor-free' };
  assert.equal(x.G.TestLab.seed(), false);
  x.G.FIREBASE_CONFIG = valid;
  x.G.DB.online = false;
  assert.equal(x.G.TestLab.seed(), false);
  x.G.DB.online = true;
  x.G.Game.state = 'playing';
  assert.equal(x.G.TestLab.seed(), false);
  assert.equal(x.commits, 0);
});
