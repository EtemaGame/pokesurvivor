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
  assert.ok(coop.includes('G.CombatStats.damage()'));
  assert.ok(coop.includes('damage: Math.max(0, a[15] || 0)'));
});

test('el informe separa daño directo de quemaduras y venenos sin duplicar impactos', () => {
  const { G, pl } = fixture();
  G.CombatStats.reset();
  G.CombatStats.note(pl, 'ember', 23);
  G.CombatStats.note(pl, 'ember', 4, 'burn');
  G.CombatStats.note(pl, 'ember', 6, 'poison');
  const s = G.CombatStats.snapshot(pl, 10);
  assert.equal(s.total, 33);
  assert.equal(s.direct, 23);
  assert.equal(s.periodic, 10);
  assert.equal(s.hits, 1);
  assert.equal(s.moves[0].burn, 4);
  assert.equal(s.moves[0].poison, 6);
  assert.equal(G.CombatStats.damage(), 33);
  assert.ok(G.CombatStats.render(s, pl).includes('quemadura'));
});

test('la medición respeta escudos y vida restante sin alterar el daño base del juego', () => {
  const { G, pl, context } = fixture();
  G.Types = { mult: () => 1, label: () => null };
  G.Weather = { mult: () => 1 };
  G.FX = {};
  const srcCombat = src('js/systems/combat.js');
  vm.runInNewContext(srcCombat.replace(
    '  return { tick, resolve, ghostCast, ghostOrbit,',
    '  return { __hit: hit, tick, resolve, ghostCast, ghostOrbit,'
  ), context);
  const e = {
    hp: 12, shield: 6, types: ['normal'], remote: false,
    hurt(amount) {
      let v = amount;
      if (this.shield > 0) {
        const absorbed = Math.min(v, this.shield);
        this.shield -= absorbed; v -= absorbed;
      }
      this.hp -= v;
    },
    applyBurn() {}, applyPoison() {}, applySlow() {}
  };
  pl.onDealt = () => {};
  G.Combat.__hit(pl, e, 9, '#fff', 0, 0, 0, pl.moves[0]);
  assert.equal(G.CombatStats.damage(), 3, 'no suma la absorción del escudo');
  G.Combat.__hit(pl, e, 20, '#fff', 0, 0, 0, pl.moves[0]);
  assert.equal(G.CombatStats.damage(), 12, 'no suma overkill');
  assert.equal(pl.dmgDealt, 29, 'el contador original no se cambia');
});

test('la carta muestra tres números claros y deja el detalle bajo demanda', () => {
  const { G, pl } = fixture();
  pl.moves = [G.Moves.instance('ember', 2)]; // siguiente nivel aumenta el daño
  const summary = G.CombatStats.cardBrief({ key: 'new:hex' }, pl);
  assert.ok(summary.includes('Daño / golpe'));
  assert.ok(summary.includes('DPS*'));
  assert.ok(summary.includes('Cada'));
  assert.ok(summary.includes('Con estado'));
  assert.ok(summary.includes('+70% daño'));
  assert.ok(!summary.includes('Comparación:'), 'el resumen no debe ser un párrafo largo');
  const up = G.CombatStats.cardBrief({ key: 'up:ember' }, pl);
  assert.ok(up.includes('→'), 'la mejora compara antes y después');
  const def = G.CombatStats.cardBrief({ key: 'stat:def' }, pl);
  assert.ok(def.includes('Reduce daño'));
  assert.ok(G.CombatStats.cardBrief({ key: 'stat:spd' }, pl).includes('Velocidad'));
});

test('la torreta usa la velocidad real de disparo para comparar, no el tiempo de colocación', () => {
  const { G, pl } = fixture();
  const turret = G.Moves.instance('will-o-wisp');
  const numbers = G.CombatStats.theoretical(turret, pl);
  assert.equal(numbers.cd, turret.rate);
  assert.equal(numbers.dps, turret.dmg * pl.atk * 1.05 / turret.rate);
});

test('el informe prioriza daño, DPS e impactos y permite desplegar explicaciones', () => {
  const { G, pl } = fixture();
  G.CombatStats.reset();
  G.CombatStats.note(pl, 'ember', 80);
  G.CombatStats.note(pl, 'hex', 20);
  G.CombatStats.note(pl, 'ember', 5, 'burn');
  const html = G.CombatStats.html(pl, 10, [pl]);
  assert.ok(html.includes('lab-kpis'));
  assert.ok(html.includes('Daño total'));
  assert.ok(html.includes('DPS medio'));
  assert.ok(html.includes('Impactos'));
  assert.ok(html.includes('lab-track'));
  assert.ok(html.includes('Daño por habilidad'));
  assert.ok(html.includes('<details'), 'el detalle no debe ocupar espacio inicialmente');
  assert.ok(html.includes('Estadísticas del Pokémon'));
  assert.ok(html.includes('¿Cómo se calcula?'));
  assert.ok(html.includes('Por estados:'));
  assert.ok(!html.includes('Impactos directos</span>'), 'no confundir daño con número de golpes');
});

test('en móvil el botón de detalles no elige la carta por accidente', () => {
  const run = src('js/ui/run-ui.js');
  const css = src('css/style.css');
  assert.ok(run.includes('G.CombatStats.cardBrief'));
  assert.ok(run.includes('e.stopPropagation()'));
  assert.ok(run.includes('aria-expanded'));
  assert.ok(run.includes('info.hidden = !expanded'));
  assert.ok(css.includes('.lab-card-detail[hidden]'));
  assert.ok(css.includes('@media (max-height: 520px)'));
});
