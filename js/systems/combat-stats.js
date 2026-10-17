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
    // Las torretas disparan según rate, no según la recarga para colocarlas.
    const period = m.kind === 'orbit' ? Math.max(0.12, m.cd)
      : m.kind === 'turret' ? Math.max(0.05, m.rate || 0.6) : cd;
    const dps = damage / period;
    return { damage, cd: period, dps, count: Math.max(1, m.count || 1),
      multi: ['projectile', 'nova', 'boomerang', 'cone', 'orbit', 'chain', 'mine', 'meteor'].includes(m.kind),
      hex: m.hex ? m.hex : 0,
      kind: m.kind };
  }

  function details(m, pl) {
    const a = theoretical(m, pl);
    if (!a) return '<span class="sub">Potenciador: no inflige daño directo.</span>';
    let s = '<div>Daño por impacto, objetivo neutro: <b>' + fmt(a.damage) + '</b></div>' +
      '<div>' + (m.kind === 'turret' ? 'Disparo de torreta cada: ' : 'Un ataque cada: ') +
      '<b>' + dec(a.cd) + ' s</b></div>' +
      '<div>DPS teórico por impacto: <b>' + dec(a.dps) + '</b></div>';
    if (a.multi) s += '<div>Máximo por activación: <b>' + a.count + ' ' +
      (a.kind === 'chain' ? 'saltos' : 'proyectiles/orbes/zonas') +
      '</b> (no significa que todos impacten).</div>';
    if (a.hex) s += '<div>Contra quemados, envenenados o lentos: <b>×' +
      dec(a.hex) + ' (+' + dec((a.hex - 1) * 100) + '%; ' +
      fmt(a.damage * a.hex) + ' por primer impacto)</b></div>';
    if (m.burn) s += '<div>Quemadura: ' + m.burn + ' carga(s) por impacto; ' +
      '1,6 × cargas × (1 + nivel del jugador × 0,06) cada 0,5 s.</div>';
    if (m.poison) s += '<div>Veneno: ' + m.poison + ' carga(s) por impacto; ' +
      '1,2 % de vida máxima del enemigo × cargas + 1 cada 0,6 s.</div>';
    if (m.slow) s += '<div>Ralentiza al objetivo: -' + fmt(m.slow * 100) + '% de velocidad durante 1,2 s.</div>';
    return s;
  }

  /** Resumen de tres cifras para elegir una carta sin leer párrafos técnicos. */
  function cardBrief(card, pl) {
    if (!card || !pl || !card.key) return '';
    const [kind, id] = card.key.split(':');
    const metric = (label, value) => '<span class="lab-metric"><small>' + label +
      '</small><strong>' + value + '</strong></span>';
    const stats = {
      atk: () => metric('Ataque', dec(pl.atk) + ' → ' + dec(pl.atk * 1.10)),
      spd: () => metric('Velocidad', dec(pl.spd) + ' → ' + dec(pl.spd * 1.07)),
      cd: () => metric('Recarga global', '×' + dec(pl.cdMul) + ' → ×' + dec(pl.cdMul * .92)),
      def: () => metric('Reduce daño', dec(pl.reduction * 100) + '% → ' +
        dec(Math.min(.8, Math.min(.7, pl.dmgReduce + .06) +
          pl.buffs.def.n * pl.buffs.def.amount) * 100) + '%')
    };
    if (kind === 'stat') return stats[id] ? '<div class="lab-card-metrics">' + stats[id]() + '</div>' : '';
    const existing = pl.moves.find(m => m.id === id);
    let preview = existing && Object.assign({}, existing);
    if (kind === 'new') preview = G.Moves.instance(id);
    else if (kind === 'up' && preview) G.Moves.levelUp(preview);
    else if (kind === 'evo' && preview) G.Moves.evolve(preview);
    if (!preview) return '';
    const before = theoretical(existing, pl);
    const after = theoretical(preview, pl);
    if (!after) return '';
    const delta = (oldValue, newValue, format) => oldValue != null && Math.abs(oldValue - newValue) > .00001
      ? format(oldValue) + ' → ' + format(newValue) : format(newValue);
    let out = metric('Daño / golpe', delta(before && before.damage, after.damage, fmt)) +
      metric('DPS teórico', delta(before && before.dps, after.dps, dec)) +
      metric('Cada', delta(before && before.cd, after.cd, dec) + ' s');
    if (after.hex > 1) out += metric('Con estado', '+' + dec((after.hex - 1) * 100) + '% daño');
    return '<div class="lab-card-metrics">' + out + '</div>';
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
    let txt = '<div>Golpe neutro esperado: <b>' +
      (old ? fmt(old.damage) + cmp : fmt(cur.damage)) + '</b></div>' +
      '<div>DPS/impacto teórico: <b>' + (old ? dec(old.dps) + ' → ' : '') +
      dec(cur.dps) + '</b></div>';
    if (cur.multi) txt += '<div>Hasta ' + cur.count +
      ' disparos/objetivos por activación (sin garantía de impacto).</div>';
    if (cur.hex) txt += '<div>Con estado: ×' + dec(cur.hex) + ' = ' +
      fmt(cur.damage * cur.hex) + ' por primer impacto.</div>';
    // Referencia útil, no decisión automática: el daño real depende de aciertos,
    // tipos, resistencias, escudos, movilidad y número de enemigos.
    const reference = pl.moves.filter(x => x.id !== id)
      .map(x => ({ x, a: theoretical(x, pl) })).filter(v => v.a)
      .sort((a,b) => b.a.dps - a.a.dps)[0];
    if (reference) txt += '<div>Otro ataque: ' + esc(reference.x.name) + ' · <b>' +
      dec(reference.a.dps) + ' DPS/impacto teórico</b>.</div>';
    return txt + '<div class="lab-muted">*Valores para un objetivo neutro y un impacto ' +
      'por activación. No predicen el daño real cuando hay múltiples proyectiles o áreas.</div>';
  }

  function html(pl, seconds, team, full = true) {
    return render(snapshot(pl, seconds, team), pl, full);
  }

  function render(s, pl, full = true) {
    const line = (label, value) => '<div class="lab-stat"><span>' + label +
      '</span><b>' + value + '</b></div>';
    let out = '<section class="lab-analytics">' +
      '<h3>Análisis de combate</h3>' +
      '<div class="lab-kpis">' +
      '<div><small>Daño total</small><strong>' + fmt(s.total) + '</strong></div>' +
      '<div><small>DPS medio</small><strong>' + dec(s.dps) + '</strong></div>' +
      '<div><small>Impactos</small><strong>' + fmt(s.hits) + '</strong></div>' +
      '</div>';
    if (s.periodic) out += '<p class="lab-muted">Incluye ' + fmt(s.periodic) +
      ' de quemadura o veneno. Daño directo: ' + fmt(s.direct) + '.</p>';

    if (s.team.length > 1) {
      out += '<h4>Daño por jugador</h4><div class="lab-players">';
      for (const p of s.team)
        out += line(esc(p.name) + (p.own ? ' (tú)' : ''), fmt(p.damage));
      out += '</div>';
    }

    out += '<h4>Daño por habilidad</h4><div class="lab-skills">';
    for (const row of s.moves) {
      const m = pl && pl.moves.find(x => x.id === row.id) || G.Moves.BY_ID[row.id];
      const percent = s.total > 0 ? Math.min(100, Math.max(0, row.damage / s.total * 100)) : 0;
      out += '<article class="lab-skill">' +
        '<div class="lab-skill-head"><strong>' + esc(row.name) +
        '</strong><b>' + fmt(row.damage) + '</b></div>' +
        '<div class="lab-track" role="meter" aria-label="Porcentaje de daño" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
          Math.round(percent) + '"><div class="lab-fill" style="width:' + percent.toFixed(2) + '%"></div></div>' +
        '<div class="lab-skill-meta">' + dec(percent) + '% del daño · ' +
          fmt(row.hits) + ' impactos · ' + dec(row.dps) + ' DPS</div>';
      if (row.periodic)
        out += '<div class="lab-muted">Por estados: ' + fmt(row.periodic) +
          ' (' + fmt(row.burn) + ' quemadura, ' + fmt(row.poison) + ' veneno)</div>';
      if (full && m)
        out += '<details class="lab-details"><summary>Ver datos y efectos</summary><div class="lab-detail-text">' +
          details(m, pl) + '</div></details>';
      out += '</article>';
    }
    if (!s.moves.length) out += '<p class="lab-muted">Aún no hay daño registrado.</p>';
    out += '</div>';

    if (full) {
      out += '<details class="lab-details lab-section"><summary>Estadísticas del Pokémon</summary>' +
        '<div class="lab-stat-list">' +
        line('Ataque', dec(s.attack)) +
        line('Reducción de daño', dec(s.defense * 100) + '%') +
        line('Velocidad', dec(s.speed) + ' u/s') +
        line('Recarga global', '×' + dec(s.cooldown)) +
        line('Probabilidad de crítico', dec(s.crit * 100) + '%') +
        line('Regeneración', dec(s.regen) + ' PS/s') +
        '</div></details>';
      if (pl) {
        const unseen = pl.moves.filter(m => !byMove[m.id]);
        if (unseen.length) {
          out += '<details class="lab-details lab-section"><summary>Otras habilidades (' + unseen.length + ')</summary>';
          for (const m of unseen)
            out += '<div class="lab-other"><strong>' + esc(m.name) + '</strong>' +
              '<div class="lab-detail-text">' + details(m, pl) + '</div></div>';
          out += '</details>';
        }
      }
      out += '<details class="lab-details lab-section"><summary>¿Cómo se calcula?</summary>' +
        '<p class="lab-detail-text">Daño total = vida que han perdido los enemigos por tus habilidades; ' +
        'no se cuentan escudos ni daño sobrante. El DPS medio divide ese daño entre el tiempo de la ronda. ' +
        'La quemadura y el veneno se atribuyen a la última habilidad local que aplicó cada estado. ' +
        'No incluye daño ambiental. Los números teóricos de las habilidades suponen un enemigo neutro, ' +
        'sin clima, y un impacto por activación; los proyectiles múltiples, aciertos y áreas ' +
        'pueden cambiar mucho el resultado. En cooperativo las cifras contra enemigos remotos son estimadas, ' +
        'y cada compañero informa de su propio daño.</p></details>';
    }
    return out + '</section>';
  }

  return { reset, note, damage, snapshot, theoretical, details, cardInfo, cardBrief, html, render, fmt, dec };
})();
