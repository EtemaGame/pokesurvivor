/* Analítica de combate para el LAB. Sólo memoria de la partida:
 * no altera daño, recompensas, ranking ni el guardado en Firebase.
 * Daño medido: PS realmente descontados al enemigo (sin exceso por matar ni
 * absorción de escudos), más quemadura/veneno atribuibles al jugador local.
 * En enemigos remotos de coop la cifra es provisional hasta confirmar el host.
 * No atribuye daño de estados aplicado remotamente sin identificar autor.
 */
G.CombatStats = (() => {
  let byMove = Object.create(null), total = 0, hits = 0, periodic = 0;

  const num = n => Number.isFinite(n) ? n : 0;
  const fmt = n => Math.round(num(n)).toLocaleString('es-ES');
  const dec = n => num(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function reset() { byMove = Object.create(null); total = 0; hits = 0; periodic = 0; }
  function note(pl, id, damage, status = null) {
    if (!pl || pl.remote || !id || !Number.isFinite(damage) || damage <= 0) return;
    if (!byMove[id]) byMove[id] = { id, damage: 0, hits: 0, periodic: 0, burn: 0, poison: 0 };
    const row = byMove[id];
    row.damage += damage;
    total += damage;
    if (status === 'burn' || status === 'poison') {
      periodic += damage;
      row.periodic += damage;
      row[status] += damage;
    } else {
      row.hits++;
      hits++;
    }
  }
  function damage() { return total; }
  function snapshot(pl, seconds, team) {
    const elapsed = Math.max(1, num(seconds));
    return {
      total, hits, periodic, direct: total - periodic, dps: total / elapsed,
      moves: Object.values(byMove).map(row => ({
        id: row.id, name: (G.Moves.BY_ID[row.id] || {}).name || row.id,
        damage: row.damage, hits: row.hits, periodic: row.periodic,
        burn: row.burn, poison: row.poison, dps: row.damage / elapsed
      })).sort((a,b) => b.damage - a.damage),
      hp: pl ? pl.hp : 0, maxHp: pl ? pl.maxHp : 0,
      attack: pl ? pl.atk : 0, speed: pl ? pl.spd : 0,
      defense: pl ? pl.reduction : 0, regen: pl ? pl.regen : 0,
      cooldown: pl ? pl.cdMul : 1, crit: pl ? pl.critChance : 0,
      team: (team || []).map(p => ({
        name: p.uid && p.tag ? p.tag : p === pl ? ((G.Social.me || {}).name || 'Tú') : (p.tag || 'Compañero'),
        damage: p === pl ? total : num(p.dmgDealt),
        uid: p.uid || '',
        own: p === pl
      })).sort((a,b) => b.damage - a.damage)
    };
  }

  /** Un golpe a objetivo neutro, sin clima, con los multiplicadores REALES
   * de ataque, recarga y crítico esperados. NO presupone cuántos proyectiles
   * impactarán ni cuántos enemigos estarán dentro de un área.
   */
  function theoretical(m, pl, atkK = 1, cdK = 1) {
    if (!m || m.kind === 'buff' || !m.dmg) return null;
    const atk = pl ? pl.atk : 1;
    const crit = pl ? 1 + num(pl.critChance) * 0.5 : 1;
    const damage = m.dmg * atk * atkK * crit;
    const cd = Math.max(0.05, m.cd * (pl ? pl.cdMul : 1) * cdK);
    // Las órbitas usan directamente m.cd como intervalo de cada orbe,
    // sin aplicar pl.cdMul (ver combat.js).
    const period = m.kind === 'orbit' ? Math.max(0.12, m.cd) : cd;
    const dps = damage / period;
    return { damage, cd: period, dps, count: Math.max(1, m.count || 1),
      multi: ['projectile', 'nova', 'boomerang', 'cone', 'orbit', 'chain', 'mine', 'meteor'].includes(m.kind),
      hex: m.hex ? m.hex : 0,
      kind: m.kind };
  }

  function details(m, pl) {
    const a = theoretical(m, pl);
    if (!a) return '<span class="sub">Potenciador: no inflige daño directo.</span>';
    let s = '<span>Golpe neutro esperado: <b>' + fmt(a.damage) +
      '</b> · Cadencia: <b>' + dec(a.cd) + ' s</b> · DPS por impacto: <b>' + dec(a.dps) + '</b></span>';
    if (a.multi) s += '<span class="sub"> · ' + a.count + ' ' +
      (a.kind === 'chain' ? 'saltos máx.' : 'proyectiles/orbes/zonas máx.') +
      ' (no garantiza impactos)</span>';
    if (a.hex) s += '<div>Enemigo quemado, envenenado o ralentizado: <b>×' +
      dec(a.hex) + ' (' + fmt(a.damage * a.hex) + ' por primer golpe)</b></div>';
    if (m.burn) s += '<div>Quemadura: ' + m.burn + ' carga(s) por impacto; ' +
      '1,6 × cargas × (1 + nivel del jugador × 0,06) cada 0,5 s.</div>';
    if (m.poison) s += '<div>Veneno: ' + m.poison + ' carga(s) por impacto; ' +
      '1,2 % de vida máxima del enemigo × cargas + 1 cada 0,6 s.</div>';
    if (m.slow) s += '<div>Ralentiza al objetivo: -' + fmt(m.slow * 100) + '% de velocidad durante 1,2 s.</div>';
    return s;
  }

  function cardInfo(card, pl) {
    if (!card || !pl || !card.key) return '';
    const [kind, id] = card.key.split(':');
    if (kind === 'stat') {
      if (id === 'atk') return 'Ataque real: ' + dec(pl.atk) + ' → ' + dec(pl.atk * 1.1);
      if (id === 'spd') return 'Velocidad real: ' + dec(pl.spd) + ' → ' + dec(pl.spd * 1.07) + ' u/s (sin cambios de terreno)';
      if (id === 'cd') return 'Recarga global: ×' + dec(pl.cdMul) + ' → ×' + dec(pl.cdMul * 0.92);
      if (id === 'def') return 'Reducción de daño: ' + dec(pl.reduction * 100) +
        '% → ' + dec(Math.min(.8, Math.min(.7, pl.dmgReduce + .06) + pl.buffs.def.n * pl.buffs.def.amount) * 100) + '%';
      return '';
    }
    const existing = pl.moves.find(m => m.id === id);
    let m = existing && Object.assign({}, existing);
    if (kind === 'new') m = G.Moves.instance(id);
    else if (kind === 'up' && m) G.Moves.levelUp(m);
    else if (kind === 'evo' && m) G.Moves.evolve(m);
    if (!m) return '';
    const old = theoretical(existing, pl), cur = theoretical(m, pl);
    if (!cur) return 'Potenciador sin daño directo.';
    const cmp = old ? ' → ' + fmt(cur.damage) : '';
    let txt = 'Golpe neutro esperado: ' + (old ? fmt(old.damage) + cmp : fmt(cur.damage)) +
      ' · DPS/impacto: ' + (old ? dec(old.dps) + ' → ' : '') + dec(cur.dps);
    if (cur.multi) txt += ' · Hasta ' + cur.count + ' disparos/objetivos (sin garantía de impactos)';
    if (cur.hex) txt += ' · Con estado: ×' + dec(cur.hex) + ' = ' + fmt(cur.damage * cur.hex);
    // Referencia útil, no decisión automática: el daño real depende de aciertos,
    // tipos, resistencias, escudos, movilidad y número de enemigos.
    const reference = pl.moves.filter(x => x.id !== id)
      .map(x => ({ x, a: theoretical(x, pl) })).filter(v => v.a)
      .sort((a,b) => b.a.dps - a.a.dps)[0];
    if (reference) txt += ' · Comparación: ' + reference.x.name + ' ' + dec(reference.a.dps) + ' DPS/impacto';
    return txt;
  }

  function html(pl, seconds, team, full = true) {
    return render(snapshot(pl, seconds, team), pl, full);
  }

  function render(s, pl, full = true) {
    const line = (a,b) => '<div style="display:flex;justify-content:space-between;gap:12px"><span>' + a +
      '</span><b>' + b + '</b></div>';
    let out = '<section style="text-align:left;font-size:13px;line-height:1.65">' +
      '<h3 style="margin:6px 0">Análisis de combate</h3>' +
      line('Daño efectivo registrado', fmt(s.total)) +
      line('Impactos directos', fmt(s.direct)) + line('Quemadura / veneno', fmt(s.periodic)) +
      line('DPS medio desde el inicio', dec(s.dps)) +
      line('Impactos directos acertados', fmt(s.hits));
    if (full) {
      out += '<h4 style="margin:12px 0 4px">Tus estadísticas efectivas</h4>' +
        line('Ataque', dec(s.attack)) + line('Defensa · reducción', dec(s.defense * 100) + '%') +
        line('Velocidad de movimiento', dec(s.speed) + ' u/s') +
        line('Recarga global', '×' + dec(s.cooldown)) +
        line('Crítico', dec(s.crit * 100) + '%') +
        line('Regeneración', dec(s.regen) + ' PS/s');
    }
    if (s.team.length > 1) {
      out += '<h4 style="margin:12px 0 4px">Daño por jugador (informado por cada cliente)</h4>';
      for (const p of s.team) out += line(esc(p.name) + (p.own ? ' (tú)' : ''), fmt(p.damage));
    }
    out += '<h4 style="margin:12px 0 4px">Daño por habilidad</h4>';
    for (const row of s.moves) {
      const m = pl && pl.moves.find(x => x.id === row.id) || G.Moves.BY_ID[row.id];
      out += '<div style="padding:6px 0;border-bottom:1px solid #ffffff22"><b>' + esc(row.name) + '</b>' +
        '<div>' + fmt(row.damage) + ' daño · ' + fmt(row.hits) + ' impactos · ' + dec(row.dps) + ' DPS medio' +
        (row.periodic ? ' · ' + fmt(row.periodic) + ' por estados (' +
          fmt(row.burn) + ' quemadura, ' + fmt(row.poison) + ' veneno)' : '') + '</div>' +
        (full && m ? '<div class="sub" style="font-size:12px">' + details(m, pl) + '</div>' : '') +
        '</div>';
    }
    if (!s.moves.length) out += '<p class="sub">Todavía no hay daño atribuido a habilidades.</p>';
    if (full && pl) {
      const unseen = pl.moves.filter(m => !byMove[m.id]);
      if (unseen.length) out += '<h4 style="margin:12px 0 4px">Otras habilidades equipadas</h4>' +
        unseen.map(m => '<div style="padding:5px 0"><b>' + esc(m.name) + '</b><div class="sub" style="font-size:12px">' +
          details(m, pl) + '</div></div>').join('');
    }
    return out + '<p class="sub" style="font-size:11px;margin:10px 0 0">El DPS medio es daño efectivo registrado / tiempo de ronda. ' +
      'El daño de quemadura y veneno se atribuye al último movimiento local que aplicó cada estado. ' +
      'No incluye daño ambiental ni efectos remotos sin autor conocido. El DPS teórico supone un impacto ' +
      'constante sobre un enemigo neutro, sin clima, y no predice aciertos ni objetivos múltiples. ' +
      'En cooperativo, el daño en enemigos remotos es una estimación del cliente, y los totales ' +
      'de otros jugadores son los que informa cada uno.</p></section>';
  }

  return { reset, note, damage, snapshot, theoretical, details, cardInfo, html, render, fmt, dec };
})();
