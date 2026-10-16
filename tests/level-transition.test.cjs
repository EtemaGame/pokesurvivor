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
  let slowdowns = 0;
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
  G.Game = { player, everyone: () => [player], flash: noop, offerBond: noop,
    resumeSlowMotion() { slowdowns++; }, st: { time: 0 } };
  return { G, context, player, liquid, get slows() { return slowdowns; } };
}

test('sin escudo extra: el daño normal sigue funcionando inmediatamente', () => {
  const { player } = playerFixture();
  assert.equal(player.graceT, undefined);
  assert.equal(player.grantGrace, undefined);
  player.hurt(10);
  assert.equal(player.hp, 90);
  player.hurt(10);
  assert.equal(player.hp, 90, 'el periodo de inmunidad normal tras recibir daño permanece');
});

test('la lava sigue haciendo daño sin excepción por transición', () => {
  const { player, liquid } = playerFixture();
  liquid.on = true;
  player.update(0.1);
  assert.ok(player.hp < 100);
});

test('al regresar de una grieta se activa cámara lenta, no un escudo', () => {
  const x = playerFixture();
  vm.runInNewContext(source('js/systems/rift.js'), x.context);
  x.G.Rift.onEvent(['arena', { tx: 20, ty: 30, r: 11, type: 'fire' }]);
  x.G.Rift.onEvent(['al']);
  x.G.Rift.update(1.3, x.player, 0);
  assert.equal(x.G.Rift.inArena, false);
  assert.equal(x.slows, 1);
  assert.equal(x.player.invuln, 0);
  x.G.Rift.update(0.1, x.player, 0);
  assert.equal(x.slows, 1, 'no se repite al actualizar después de volver');
});

test('revivir conserva los 2 segundos de inmunidad originales', () => {
  const x = playerFixture();
  vm.runInNewContext(source('js/systems/rift.js'), x.context);
  x.G.Rift.onEvent(['arena', { tx: 20, ty: 30, r: 11, type: 'fire' }]);
  x.player.dead = true;
  x.player.hp = 0;
  x.G.Rift.onEvent(['al']);
  x.G.Rift.update(1.3, x.player, 0);
  assert.equal(x.player.dead, false);
  assert.equal(x.player.invuln, 2);
  assert.equal(x.slows, 1);
});

function gameFixture() {
  let now = 0, chosen = null, shown = 0, coopLevels = 0;
  const player = { level: 4, dead: false };
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
  const target = '  return {\n    init, startRun, everyone, levelXp, flash, offerBond, resumeSlowMotion,';
  assert.ok(raw.includes(target), 'No se encontró el flujo real');
  const injected = raw.replace(target, '  return {\n    __test: {\n' +
    "      seed(pending) { state = 'playing'; pl = G.Coop.players()[0]; pendingLevels = pending; resumeSlowUntil = 0; },\n" +
    '      step: maybeLevelUp, startCoopLevel: coopApi.levelStart, resumeCoop: coopApi.resume,\n' +
    '      get slowUntil() { return resumeSlowUntil; }, speedAt: resumeFactorAt, get state() { return state; }\n' +
    '    },\n    init, startRun, everyone, levelXp, flash, offerBond, resumeSlowMotion,');
  vm.runInNewContext(injected, { G, performance: { now: () => now } });
  return {
    G, player, clock(v) { now = v; }, choose() { assert.ok(chosen); chosen({ apply() {} }); },
    get shown() { return shown; }, get coopLevels() { return coopLevels; }
  };
}

test('solo: cartas inmediatas, ralentización durante 850 ms DESPUÉS de elegir', () => {
  const x = gameFixture();
  x.G.Game.__test.seed(1);
  x.G.Game.__test.step();
  assert.equal(x.shown, 1);
  assert.equal(x.G.Game.__test.state, 'levelup');
  assert.equal(x.G.Game.__test.slowUntil, 0);
  x.choose();
  assert.equal(x.G.Game.__test.state, 'playing');
  assert.equal(x.G.Game.__test.slowUntil, 850);
  assert.equal(x.G.Game.__test.speedAt(0), 0.35);
  assert.equal(x.G.Game.__test.speedAt(849), 0.35);
  assert.equal(x.G.Game.__test.speedAt(850), 1);
});

test('la ralentización no se suma ni reinicia por eventos repetidos', () => {
  const x = gameFixture();
  x.G.Game.__test.seed(0);
  x.G.Game.resumeSlowMotion();
  x.clock(200);
  x.G.Game.resumeSlowMotion();
  assert.equal(x.G.Game.__test.slowUntil, 850);
  x.clock(851);
  x.G.Game.resumeSlowMotion();
  assert.equal(x.G.Game.__test.slowUntil, 1701);
});

test('cooperativo: se espera a todos, solo entonces comienza cámara lenta', () => {
  const x = gameFixture();
  x.G.Coop.active = true;
  x.G.Game.__test.seed(1);
  x.G.Game.__test.step();
  assert.equal(x.coopLevels, 1);
  assert.equal(x.G.Game.__test.slowUntil, 0);
  x.G.Game.__test.startCoopLevel(4);
  assert.equal(x.G.Game.__test.state, 'levelup');
  x.choose();
  assert.equal(x.G.Game.__test.slowUntil, 0);
  x.G.Game.__test.resumeCoop();
  assert.equal(x.G.Game.__test.slowUntil, 850);
  x.G.Game.__test.resumeCoop();
  assert.equal(x.G.Game.__test.slowUntil, 850);
  assert.equal(x.G.Game.__test.speedAt(849), 0.35);
});
