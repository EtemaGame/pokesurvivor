'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function fixture() {
  const G = { U: { TYPE_COLOR: {} }, Social: { me: { name: 'Jugador LAB' } } };
  const context = { G };
  vm.runInNewContext(src('js/data/moves.js'), context);
  vm.runInNewContext(src('js/systems/combat-stats.js'), context);
  const pl = {
    atk: 2, cdMul: 0.8, critChance: 0.1,
    hp: 90, maxHp: 120, spd: 110, reduction: 0.15, regen: 0.4,
    dmgReduce: 0.15, buffs: { def: { n: 0, amount: 0 } },
    moves: [G.Moves.instance('hex'), G.Moves.instance('ember')],
    dmgDealt: 0
  };
  return { G, pl, context };
}

test('los daños medidos se agregan por habilidad, sin contar daño remoto o inválido', () => {
  const { G, pl } = fixture();
  const m = G.CombatStats;
  m.reset();
  m.note(pl, 'hex', 60);
  m.note(pl, 'hex', 30.5);
  m.note(pl, 'ember', 12);
  m.note(Object.assign({}, pl, { remote: true }), 'hex', 1500);
  m.note(pl, 'ember', -2);
  m.note(pl, 'ember', Infinity);
  let s = m.snapshot(pl, 10);
  assert.equal(s.total, 102.5);
  assert.equal(s.hits, 3);
  assert.equal(s.dps, 10.25);
  assert.equal(s.moves[0].id, 'hex');
  assert.equal(s.moves[0].hits, 2);
  assert.equal(s.moves[1].damage, 12);
  m.reset();
  assert.equal(m.snapshot(pl, 20).total, 0);
});

test('Infortunio muestra multiplicador real 1,7x y daño condicional con ataque actual', () => {
  const { G, pl } = fixture();
  const stats = G.CombatStats;
  const raw = G.Moves.instance('hex');
  const a = stats.theoretical(raw, pl);
  assert.equal(raw.hex, 1.7);
  assert.equal(a.damage, raw.dmg * 2 * 1.05);
  assert.equal(a.cd, raw.cd * .8);
  assert.ok(stats.details(raw, pl).includes('×1,7'));
  assert.ok(stats.cardInfo({ key: 'new:hex' }, pl).includes('Con estado: ×1,7'));
});

test('comparador de mejoras usa de verdad la escalera aplicada, sin mutar el movimiento', () => {
  const { G, pl } = fixture();
  const before = G.Moves.instance('ember');
  pl.moves = [before, G.Moves.instance('hex')];
  const cloned = Object.assign({}, before);
  assert.equal(G.Moves.levelUp(cloned), true);
  const preview = G.CombatStats.cardInfo({ type: 'up', key: 'up:ember' }, pl);
  assert.ok(preview.includes('→'));
  assert.ok(preview.includes(G.CombatStats.fmt(before.dmg * pl.atk * 1.05)));
  assert.ok(preview.includes(G.CombatStats.fmt(cloned.dmg * pl.atk * 1.05)));
  assert.equal(before.lvl, 1);
  assert.equal(before.dmg, G.Moves.BY_ID.ember.dmg);
});

test('defensa y velocidad son valores efectivos, no solo valores base', () => {
  const { G, pl } = fixture();
  let s = G.CombatStats.snapshot(pl, 20);
  assert.equal(s.attack, 2);
  assert.equal(s.speed, 110);
  assert.equal(s.defense, .15);
  const stat = G.CombatStats.cardInfo({ key: 'stat:def' }, pl);
  assert.ok(stat.includes('15'));
  assert.ok(stat.includes('21'));
  assert.ok(G.CombatStats.cardInfo({ key: 'stat:spd' }, pl).includes('→'));
});

test('cooperativo muestra totales por jugador sin confundir daño del grupo con daño local', () => {
  const { G, pl } = fixture();
  G.CombatStats.note(pl, 'ember', 18);
  pl.dmgDealt = 18;
  pl.uid = 'owner';
  const other = { uid: 'teammate', tag: 'Amigo', dmgDealt: 42 };
  const s = G.CombatStats.snapshot(pl, 5, [pl, other]);
  assert.equal(s.total, 18);
  assert.equal(s.team.length, 2);
  assert.equal(s.team[0].name, 'Amigo');
  assert.equal(s.team[0].damage, 42);
  assert.ok(G.CombatStats.render(s, pl).includes('Daño por jugador'));
});

test('intercepción de impactos no cambia daño: golpe directo sin dobles cuentas de fantasmas', () => {
  const { G, pl, context } = fixture();
  G.Types = { mult: () => 1, label: () => null };
  G.Weather = { mult: () => 1 };
  G.FX = {};
  const raw = src('js/systems/combat.js');
  const target = '  return { tick, resolve, ghostCast, ghostOrbit,';
  assert.ok(raw.includes(target));
  const injected = raw.replace(target,
    '  return { __hit: hit, __payload: payload, tick, resolve, ghostCast, ghostOrbit,');
  vm.runInNewContext(injected, context);
  const enemy = {
    types: ['normal'], hurt(d) { this.dealt = d; },
    applyBurn() {}, applyPoison() {}, applySlow() {}
  };
  pl.onDealt = () => {};
  const move = pl.moves[0];
  G.CombatStats.reset();
  G.Combat.__hit(pl, enemy, 20, '#fff', 0, 0, 0, move);
  assert.equal(enemy.dealt, 20);
  assert.equal(pl.dmgDealt, 20);
  assert.equal(G.CombatStats.snapshot(pl, 2).total, 20);
  assert.equal(G.Combat.__payload(move).mid, move.id);
});

test('plantillas de HUD, cartas, Pausa y fin de ronda quedan conectadas', () => {
  const html = src('dev.html'), game = src('js/game.js'), run = src('js/ui/run-ui.js'),
    hud = src('js/ui/hud.js'), coop = src('js/net/coop.js');
  assert.ok(html.includes('js/systems/combat-stats.js'));
  assert.ok(html.includes('id="pause-analysis"'));
  assert.ok(html.includes('id="over-analysis"'));
  assert.ok(game.includes('G.CombatStats.reset()'));
  assert.ok(game.includes('G.CombatStats.snapshot(pl, time, combatTeam)'));
  assert.ok(run.includes('G.CombatStats.cardInfo'));
  assert.ok(hud.includes('G.CombatStats.snapshot(pl, st.time)'));
  assert.ok(coop.includes('r1(local.dmgDealt)'));
  assert.ok(coop.includes('damage: Math.max(0, a[15] || 0)'));
});
