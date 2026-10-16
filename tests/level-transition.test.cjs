'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = path => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

function uiFixture() {
  let now = 0;
  const nodes = new Map();
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.style = {};
      const values = new Set();
      this.classList = {
        add: name => values.add(name),
        remove: name => values.delete(name),
        contains: name => values.has(name),
        toggle: (name, active) => active ? values.add(name) : values.delete(name)
      };
    }
    set innerHTML(value) { this._html = value; this.children = []; }
    get innerHTML() { return this._html || ''; }
    appendChild(el) { this.children.push(el); }
    querySelectorAll() { return this.children; }
  }
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const card = { type: 'up', color: '#abc', tag: 'Mejora', title: 'Ataque', desc: '+1', icon: 'up' };
  const G = {
    UI: { $: get, show() {}, hide() {} },
    Game: { player: { rerolls: 0, rerollBonus: 0 } },
    LevelUp: { offer: () => [card] },
    Icons: { html: () => '' },
    Audio: { sfx() {} }
  };
  vm.runInNewContext(source('js/ui/run-ui.js'), {
    G, document: { createElement: () => new Element() },
    performance: { now: () => now }
  });
  return { G, card, get, clock(value) { now = value; } };
}

test('la elección por teclado o toque se bloquea 400 ms y solo puede ocurrir una vez', () => {
  const x = uiFixture();
  let picks = 0;
  x.G.RunUI.showLevelUp(3, [x.card], () => { picks++; });
  x.clock(399);
  x.G.RunUI.pick(0);
  assert.equal(picks, 0);
  x.clock(400);
  x.G.RunUI.pick(0);
  x.G.RunUI.pick(0);
  assert.equal(picks, 1);
});

test('el bloqueo también protege la opción de cambiar cartas, incluida la espera cooperativa', () => {
  const x = uiFixture();
  let picks = 0;
  x.G.RunUI.showLevelUp(3, [x.card], () => { picks++; }, true);
  x.G.RunUI.reroll();
  assert.equal(x.G.Game.player.rerolls, 0);
  x.clock(400);
  x.G.RunUI.reroll();
  assert.equal(x.G.Game.player.rerolls, 1);
  x.G.RunUI.pick(0);
  assert.equal(picks, 1);
  assert.equal(x.get('cards').classList.contains('done'), true);
  x.G.RunUI.closeLevelUp();
});

function playerFixture() {
  const liquid = { on: false };
  const noop = () => {};
  const G = {
    Sprites: {
      PX: 2, hasShiny: () => false,
      Animator: class { update() {} loop() {} _start() {} },
      bodyRadius: () => 12, bodyHeight: () => 24, dirFromAngle: () => 0
    },
    U: { pick: a => a[0] },
    Input: { axis: () => [0, 0] },
    World: {
      biome: 0, collide: noop, isLiquid: () => liquid.on,
      liquidEffect: () => ({ dmg: 0.06, flat: 5, every: 0.1, color: '#f00' }),
      nearestBreakable: () => null, setArena: noop, setBiome: noop
    },
    EnemyMgr: { all: () => [], stash: noop, restore: noop, clearRemote: noop },
    Projectiles: { nearest: () => null, clearOrbs: noop, clear: noop },
    Combat: { clearFields: noop },
    Hazards: { clear: noop },
    Weather: { mult: () => 1, speedFor: () => 1, clear: noop, force: noop },
    Types: { mult: () => 1, label: () => '' },
    Audio: { sfx: noop },
    FX: { ring: noop, burst: noop, dmgText: noop },
    Camera: { kick: noop, x: 0, y: 0 },
    Tiles: { T: 16, arenaBiome: () => 0, ARENA_THEMES: {} },
    Coop: { active: false, isHost: false },
    Spawner: { say: noop },
    Judgment: { AT: 1800 }
  };
  const context = { G, performance: { now: () => 0 } };
  vm.runInNewContext(source('js/entities/player.js'), context);
  const player = new G.Player({ dex: 25, types: ['electric'], hp: 100, atk: 12, spd: 100 });
  G.Game = { player, everyone: () => [player], flash: noop, offerBond: noop, st: { time: 0 } };
  return { G, context, player, liquid };
}

test('la protección de un segundo impide daño ordinario y luego caduca', () => {
  const { player } = playerFixture();
  player.grantGrace(1);
  player.hurt(10);
  assert.equal(player.hp, 100);
  player.update(0.5);
  player.hurt(10);
  assert.equal(player.hp, 100);
  player.update(0.51);
  player.hurt(10);
  assert.equal(player.hp, 90);
});

test('la protección de transición no puede acumularse indefinidamente', () => {
  const { player } = playerFixture();
  player.grantGrace(1);
  player.grantGrace(1);
  assert.equal(player.graceT, 1);
  player.grantGrace(999);
  assert.equal(player.graceT, 2);
  player.dead = true;
  player.grantGrace(1);
  assert.equal(player.graceT, 2);
});

test('la lava respeta la protección especial, pero vuelve a hacer daño después', () => {
  const { player, liquid } = playerFixture();
  liquid.on = true;
  player.grantGrace(1);
  player.update(0.3);
  player.update(0.3);
  assert.equal(player.hp, 100);
  player.update(0.5);
  assert.ok(player.hp < 100);
});

test('volver de una grieta concede protección sin extenderla al repetir el evento', () => {
  const { G, context, player } = playerFixture();
  vm.runInNewContext(source('js/systems/rift.js'), context);
  G.Rift.onEvent(['arena', { tx: 20, ty: 30, r: 11, type: 'fire' }]);
  G.Rift.onEvent(['al']);
  G.Rift.update(1.3, player, 0);
  assert.equal(G.Rift.inArena, false);
  assert.equal(player.graceT, 1);
  player.update(0.6);
  G.Rift.update(0.1, player, 0);
  assert.ok(player.graceT < 1);
});

test('la resurrección conserva sus 2 segundos de invulnerabilidad', () => {
  const { G, context, player } = playerFixture();
  vm.runInNewContext(source('js/systems/rift.js'), context);
  G.Rift.onEvent(['arena', { tx: 20, ty: 30, r: 11, type: 'fire' }]);
  player.dead = true;
  player.hp = 0;
  G.Rift.onEvent(['al']);
  G.Rift.update(1.3, player, 0);
  assert.equal(player.dead, false);
  assert.equal(player.invuln, 2);
  assert.equal(player.graceT, 1);
});

function gameFixture() {
  let now = 0, chosen = null, shown = 0, grace = 0, coopLevels = 0;
  const player = {
    level: 4, dead: false,
    grantGrace(s) { grace += s; }
  };
  const G = {
    Coop: {
      active: false, players: () => [player],
      levelStart() { coopLevels++; }, localPicked() {}
    },
    Audio: { sfx() {} },
    LevelUp: { offer: () => [{ apply() {} }] },
    RunUI: {
      showLevelUp(level, cards, cb) { shown++; chosen = cb; }, closeLevelUp() {}
    },
    UI: { hide() {}, isOpen() { return false; } }
  };
  const raw = source('js/game.js');
  const target = '  return {\n    init, startRun, everyone, levelXp, flash, offerBond,';
  assert.ok(raw.includes(target), 'No se encontró el punto de acceso de prueba al flujo real');
  const injected = raw.replace(target, '  return {\n    __test: {\n' +
    "      seed(pending) { state = 'playing'; pl = G.Coop.players()[0]; pendingLevels = pending; levelSlowUntil = 0; slowUsedForBatch = false; },\n" +
    '      step: maybeLevelUp, startCoopLevel: coopApi.levelStart, resumeCoop: coopApi.resume,\n' +
    '      get slowUntil() { return levelSlowUntil; }, get state() { return state; }\n' +
    '    },\n    init, startRun, everyone, levelXp, flash, offerBond,');
  vm.runInNewContext(injected, { G, performance: { now: () => now } });
  return {
    G, player, clock(v) { now = v; }, choose() { assert.ok(chosen); chosen({ apply() {} }); },
    get shown() { return shown; }, get grace() { return grace; }, get coopLevels() { return coopLevels; }
  };
}

test('solo: ralentización de 700 ms, una vez por tanda de niveles, y escudo al elegir', () => {
  const x = gameFixture();
  x.G.Game.__test.seed(2);
  x.G.Game.__test.step();
  assert.equal(x.G.Game.__test.slowUntil, 700);
  assert.equal(x.shown, 0);
  x.clock(699);
  x.G.Game.__test.step();
  assert.equal(x.shown, 0);
  x.clock(700);
  x.G.Game.__test.step();
  assert.equal(x.shown, 1);
  x.choose();
  assert.equal(x.grace, 1);
  assert.equal(x.G.Game.__test.state, 'playing');
  x.G.Game.__test.step();
  assert.equal(x.shown, 2, 'varios niveles en una tanda no repiten la espera');
  x.choose();
  assert.equal(x.grace, 2);
});

test('cooperativo: mantiene la pausa compartida, sin ralentización individual', () => {
  const x = gameFixture();
  x.G.Coop.active = true;
  x.G.Game.__test.seed(1);
  x.G.Game.__test.step();
  assert.equal(x.coopLevels, 1);
  assert.equal(x.G.Game.__test.slowUntil, 0);
  assert.equal(x.shown, 0);
});

test('cooperativo: el escudo llega tras elegir TODOS y no se repite por reenvíos', () => {
  const x = gameFixture();
  x.G.Coop.active = true;
  x.G.Game.__test.seed(1);
  x.G.Game.__test.startCoopLevel(4);
  assert.equal(x.G.Game.__test.state, 'levelup');
  assert.equal(x.grace, 0);
  x.choose();
  assert.equal(x.grace, 0, 'elegir antes que los demás no activa inmunidad');
  x.G.Game.__test.resumeCoop();
  assert.equal(x.grace, 1);
  x.G.Game.__test.resumeCoop();
  assert.equal(x.grace, 1, 'un reenvío no vuelve a dar inmunidad');
});
