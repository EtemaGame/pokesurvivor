/* Herramientas de laboratorio: SOLO proyecto Firebase ps-test-* del propietario.
 * No crea roles privilegiados ni existe en las ramas oficiales.
 * Cada persona entra con su propia cuenta temporal usando el registro normal.
 */
G.TestLab = (() => {
  const $ = G.UI.$;
  const ready = () => {
    const cfg = G.FIREBASE_CONFIG;
    return !!(cfg && /^ps-test-[a-z0-9-]{4,24}$/.test(cfg.projectId)
      && G.DB.online && G.DB.fb && G.DB.fb.uid
      && G.Game && G.Game.state === 'ui');
  };

  function refresh() {
    const panel = $('lab-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !ready());
    if (!ready()) return;
    const s = G.DB.save;
    $('lab-info').textContent = s && s.labSeeded
      ? 'Pokédex preparada. Puedes volver a cargar monedas y tickets de prueba.'
      : 'Usa una cuenta temporal: podrás probar cualquier Pokémon sin gacha.';
    $('lab-seed').textContent = s && s.labSeeded ? 'Reponer recursos de prueba' : 'Preparar cuenta DEV';
  }

  function seed() {
    if (!ready()) return false;
    const s = G.DB.save;
    if (!s || !window.confirm('¿Preparar ESTA cuenta de pruebas con todos los Pokémon? Esto no se puede deshacer desde el menú.')) return false;
    if (!s.labSeeded) {
      // Solo en sandbox: no se añaden estadísticas, logros ni marcas artificiales.
      for (const mon of G.DEX) {
        G.DB.grant(mon.dex, 'test');
        if (G.Sprites.hasShiny(mon.dex)) G.DB.grantShiny(mon.dex, 'test');
      }
      s.labSeeded = true;
    }
    // Presupuesto fijo, no se suma en cada clic (sin duplicación por botón).
    s.coins = Math.max(s.coins, 50000);
    s.tickets.t1 = Math.max(s.tickets.t1, 200);
    s.tickets.t10 = Math.max(s.tickets.t10, 20);
    G.DB.commit(true);
    G.UI.refreshCoins();
    G.UI.toast('Laboratorio preparado. Prueba Pokémon en el menú; el guardado online puede tardar.', 4500);
    G.MenuUI.open();
    return true;
  }

  function init() {
    const btn = $('lab-seed');
    if (btn) btn.onclick = seed;
    refresh();
  }

  return { init, refresh, seed };
})();
