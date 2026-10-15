/* Revisión segura de dos partidas: sin fusiones económicas automáticas. */
G.SaveConflictUI = (() => {
  const $ = id => document.getElementById(id);
  const modal = () => $('save-conflict-overlay');
  let review = null, downloaded = false, busy = false, prompted = false;

  function updateButtons() {
    const canChoose = !busy && !!review?.ok && downloaded && $('save-conflict-ack').checked;
    $('save-conflict-use-cloud').disabled = !canChoose;
    $('save-conflict-use-local').disabled = !canChoose;
    $('save-conflict-download').disabled = busy || !review?.ok;
    $('save-conflict-refresh').disabled = busy;
    $('save-conflict-later').disabled = busy;
  }
  function status(msg, error = false) {
    $('save-conflict-status').textContent = msg;
    $('save-conflict-status').classList.toggle('err', error);
  }
  function row(label, value) {
    const p = document.createElement('p');
    const strong = document.createElement('b');
    strong.textContent = label + ': ';
    p.appendChild(strong);
    p.appendChild(document.createTextNode(String(value)));
    return p;
  }
  function sumLevels(m) {
    return Object.values(m || {}).reduce((n, obj) =>
      n + (obj && typeof obj === 'object'
        ? Object.values(obj).reduce((total, v) => total + (+v || 0), 0)
        : (+obj || 0)), 0);
  }
  function display(id, data) {
    const target = $(id);
    target.textContent = '';
    const num = n => Number(n || 0).toLocaleString('es');
    const tickets = data.tickets || {};
    const stats = data.stats || {};
    for (const [name, value] of [
      ['Monedas', num(data.coins)],
      ['Tickets ×1 / ×10', num(tickets.t1) + ' / ' + num(tickets.t10)],
      ['Pokémon', num(Object.keys(data.owned || {}).length)],
      ['Shinies', num(Object.keys(data.shiny || {}).length)],
      ['Mejoras generales', num(sumLevels(data.upgrades))],
      ['Mejoras por Pokémon', num(sumLevels(data.pupg))],
      ['Logros', num(Object.keys(data.ach || {}).length)],
      ['Partidas', num(stats.runs)],
      ['Mejor tiempo (seg.)', num(stats.bestTime)]
    ]) target.appendChild(row(name, value));
  }
  function downloadJSON(content, filename) {
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }
  function refreshMenuButtons() {
    const conflict = G.DB.syncState === 'conflict';
    $('menu-conflict').classList.toggle('hidden', !conflict);
    $('menu-backup').classList.toggle('hidden', !G.DB.conflictBackup());
  }
  async function open() {
    if (G.DB.syncState !== 'conflict') return;
    modal().classList.remove('hidden');
    review = null; downloaded = false;
    $('save-conflict-ack').checked = false;
    $('save-conflict-ack').disabled = true;
    status('Leyendo las dos versiones de la partida…');
    $('save-conflict-local').textContent = 'Cargando…';
    $('save-conflict-cloud').textContent = 'Cargando…';
    busy = true; updateButtons();
    const result = await G.DB.inspectConflict();
    if (modal().classList.contains('hidden') || G.DB.syncState !== 'conflict') return;
    review = result.ok ? result : null;
    busy = false;
    if (!result.ok) status(result.error, true);
    else {
      display('save-conflict-local', result.local);
      display('save-conflict-cloud', result.cloud);
      status('Revisa los dos inventarios. Descarga ambas versiones antes de elegir.');
    }
    updateButtons();
    modal().querySelector('.save-conflict-box').focus();
  }
  function close() {
    if (busy) return;
    modal().classList.add('hidden');
    review = null; downloaded = false;
    refreshMenuButtons();
  }
  async function choose(which) {
    if (busy || !review?.ok || !downloaded || !$('save-conflict-ack').checked) return;
    const phrase = which === 'local'
      ? 'La nube será sustituida por la partida de ESTE DISPOSITIVO. Las diferencias de la otra partida sólo quedarán en el respaldo. ¿Confirmas?'
      : 'Este dispositivo adoptará la partida de LA NUBE. Sus diferencias locales sólo quedarán en el respaldo. ¿Confirmas?';
    if (!confirm(phrase)) return;
    busy = true; updateButtons();
    status('Validando que ninguna de las dos partidas haya cambiado…');
    const result = await G.DB.resolveConflict(which, review.id);
    busy = false;
    if (!result.ok) {
      status(result.error, true);
      if (result.stale) { review = null; downloaded = false; $('save-conflict-ack').checked = false; }
      updateButtons();
      return;
    }
    modal().classList.add('hidden');
    review = null; downloaded = false;
    G.UI.toast('Conflicto resuelto. La otra partida quedó respaldada en este navegador.', 7000);
    G.MenuUI.open();
    refreshMenuButtons();
  }
  function downloadCompared() {
    if (!review?.ok || busy) return;
    try {
      const backup = {
        type: 'pokesurvivor-conflict-backup', version: 1,
        savedAt: new Date().toISOString(), local: review.local, cloud: review.cloud
      };
      downloadJSON(backup, 'pokesurvivor-dos-partidas-' + Date.now() + '.json');
      downloaded = true;
      $('save-conflict-ack').disabled = false;
      status('Se solicitó descargar un archivo con ambas partidas. Comprueba que quedó guardado antes de continuar.');
      updateButtons();
    } catch (e) { status('No se pudo descargar el respaldo: ' + (e.message || e), true); }
  }
  function downloadLast() {
    const backup = G.DB.conflictBackup();
    if (!backup) { G.UI.toast('No se encontró un respaldo en este navegador.'); refreshMenuButtons(); return; }
    try {
      downloadJSON(backup, 'pokesurvivor-respaldo-' + Date.now() + '.json');
      G.UI.toast('Se solicitó la descarga de la última copia de seguridad.');
    } catch (e) { G.UI.toast('No se pudo descargar el respaldo: ' + (e.message || e), 6000); }
  }
  function showIfNeeded() {
    refreshMenuButtons();
    if (G.DB.syncState === 'conflict' && !prompted) {
      prompted = true;
      open();
    }
    if (G.DB.syncState !== 'conflict') prompted = false;
  }
  function init() {
    $('menu-conflict').onclick = open;
    $('menu-backup').onclick = downloadLast;
    $('save-conflict-refresh').onclick = open;
    $('save-conflict-download').onclick = downloadCompared;
    $('save-conflict-later').onclick = close;
    $('save-conflict-ack').onchange = updateButtons;
    $('save-conflict-use-local').onclick = () => choose('local');
    $('save-conflict-use-cloud').onclick = () => choose('cloud');
    G.DB.onSync(s => {
      refreshMenuButtons();
      if (s === 'conflict' && G.UI.isOpen('scr-menu') && !prompted) showIfNeeded();
    });
  }
  return { init, open, showIfNeeded, refreshMenuButtons, downloadLast };
})();