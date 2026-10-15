/* ============ db.js — base de datos: Firebase (nube) o local ============
 * TODO el acceso a datos persistentes pasa por aquí. El resto del juego sólo
 * usa G.DB.*.
 *
 * Dos modos (se decide en ready()):
 *
 *   NUBE  (Firebase Authentication + Cloud Firestore)
 *     Si hay configuración en js/core/firebase-config.js y el juego se abre
 *     desde una web (http/https, también localhost). La partida se guarda en
 *     saves/{uid} y se puede seguir en cualquier ordenador.
 *       - Usuario + contraseña: Firebase pide un email, así que el nombre se
 *         convierte en uno interno (nunca se le envía nada).
 *       - Cuenta de Google.
 *     Además se guarda una copia local para poder jugar sin conexión; al
 *     sincronizar se FUSIONA (ver merge): las colecciones se unen y nunca se
 *     pierde un Pokémon ni un shiny.
 *
 *   LOCAL (localStorage)
 *     Si no hay configuración o se abre con doble clic (file://). Igual que
 *     antes: cuentas y partidas sólo en este navegador.
 *       ps.accounts      { clave: { name, salt, hash, created } }
 *       ps.save.<clave>  partida de esa cuenta
 *       ps.session       última cuenta con sesión iniciada
 *
 * El modo invitado juega con una partida en memoria que no se guarda.
 */
G.DB = (() => {
  const K_ACC = 'ps.accounts', K_SES = 'ps.session', K_SAVE = 'ps.save.';
  const K_CLOUD = 'ps.cloud.', K_MIGRATED = 'ps.migrated.', K_BASE = 'ps.cloudbase.';
  const VERSION = 3;
  const START_COINS = 500;
  const SDK = 'https://www.gstatic.com/firebasejs/13.0.0/';
  const NAME_DOMAIN = 'jugadores.pokesurvivor.net';   // sólo para el email interno

  let mode = 'local';       // 'cloud' | 'local'
  let localReason = '';     // por qué no hay nube: 'file' | 'config' | 'host' | 'error'
  let user = null;          // nombre visible
  let key = null;           // clave local (minúsculas) o uid de Firebase
  let guest = false;
  let save = null;
  let storageOk = true;

  // ---------------- almacenamiento local seguro ----------------

  function read(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
    catch (e) { storageOk = false; return null; }
  }
  function write(k, v) {
    const s = JSON.stringify(v);
    try { localStorage.setItem(k, s); return true; }
    catch (e) {
      // Navegador lleno (sobre todo por lo que guarda el ranking): se libera lo
      // prescindible y se reintenta. Antes la copia de la partida dejaba de
      // guardarse sin avisar y, al recargar, se volvía a la de la nube.
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && /^ps\.rk\.c\./.test(key)) localStorage.removeItem(key);
        }
        localStorage.setItem(k, s); return true;
      } catch (e2) { storageOk = false; return false; }
    }
  }
  function remove(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } }

  // ---------------- partida ----------------

  function newSave(name) {
    return {
      v: VERSION,
      name,
      created: Date.now(),
      updated: Date.now(),    // última modificación (para fusionar)
      coins: START_COINS,
      owned: {},              // dex -> { at, from: 'starter'|'gacha'|'wild' }
      shiny: {},              // dex -> { at, from } — variantes shiny conseguidas
      partner: null,          // dex del Pokémon con el que juegas
      partnerShiny: false,    // jugar con su versión shiny (si la tienes)
      starter: null,          // dex que te tocó en el test
      personality: null,      // { trait, scores }
      upgrades: {},           // (antiguo) mejoras de la cuenta; ahora van por Pokémon
      pupg: {},               // dex -> { id -> nivel }: mejoras de cada Pokémon
      tickets: { t1: 0, t10: 0 },   // tickets del gacha (x1 y x10)
      pity: {},               // generación del banner -> tiradas sin ★5
      legends: {},            // dex -> fecha: legendarios vencidos en grietas
      arenas: {},             // tipo -> fecha: arenas de grieta ganadas
      itemsFound: {},         // id -> fecha: objetos equipables encontrados
      evoMoves: {},           // id -> fecha: movimientos evolucionados alguna vez
      ach: {},                // id -> fecha: logros conseguidos
      missions: {},           // misiones del día / semana (systems/progress.js)
      profile: { favs: [], title: '' },   // perfil público: 3 favoritos y título
      stats: { runs: 0, bestTime: 0, bestLevel: 0, totalKills: 0, pulls: 0, coinsEarned: 0, shinies: 0,
               bossesTotal: 0, riftWins: 0, evolutions: 0, missionsDone: 0, groupRuns: 0, bestGroupTime: 0 }
    };
  }

  /** Rellena campos que falten en partidas de versiones anteriores. */
  function migrate(s, name) {
    const base = newSave(name || s.name);
    for (const k in base) if (s[k] == null) s[k] = base[k];
    for (const k in base.stats) if (s.stats[k] == null) s.stats[k] = base.stats[k];
    // v1 -> v2: había un único banner (Kanto) con el pity como número.
    if (typeof s.pity === 'number') s.pity = { 1: s.pity };
    // v2 -> v3: las mejoras eran de la cuenta; pasan al compañero de entonces.
    if (!s.pupgDone) {
      if (s.partner && Object.values(s.upgrades || {}).some(v => v > 0)) {
        s.pupg[s.partner] = Object.assign({}, s.upgrades);
      }
      s.pupgDone = true;
    }
    s.tickets = Object.assign({ t1: 0, t10: 0 }, s.tickets);
    sanitize(s);
    s.v = VERSION;
    return s;
  }

  /**
   * Quita lo imposible de una partida editada a mano (la copia del navegador
   * se puede tocar): números negativos o raros, mejoras por encima del
   * máximo y Pokémon que no existen. Lo que sí sea posible lo frena el
   * servidor (firestore.rules, saves).
   */
  function sanitize(s) {
    const n = v => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
    s.coins = n(s.coins);
    s.tickets.t1 = n(s.tickets.t1);
    s.tickets.t10 = n(s.tickets.t10);
    if (G.DEX_BY) for (const coll of ['owned', 'shiny']) {
      for (const d of Object.keys(s[coll] || {})) if (!G.DEX_BY[d]) delete s[coll][d];
    }
    // Atajos: 4 huecos con un movimiento que exista (o null), sin repetir.
    if (s.pbind && typeof s.pbind === 'object') {
      for (const d of Object.keys(s.pbind)) {
        const l = Array.isArray(s.pbind[d]) ? s.pbind[d].slice(0, 4) : [];
        const seen = new Set();
        s.pbind[d] = [0, 1, 2, 3].map(i => {
          const id = l[i];
          if (typeof id !== 'string' || (G.Moves && !G.Moves.BY_ID[id]) || seen.has(id)) return null;
          seen.add(id); return id;
        });
      }
    } else s.pbind = {};
    // Veto: listas de movimientos que existen, sin repetir, como mucho 3.
    if (s.pban && typeof s.pban === 'object') {
      for (const d of Object.keys(s.pban)) {
        const l = Array.isArray(s.pban[d]) ? s.pban[d] : [];
        s.pban[d] = [...new Set(l.filter(id => typeof id === 'string' && (!G.Moves || G.Moves.BY_ID[id])))].slice(0, 3);
      }
    } else s.pban = {};
    if (G.Upgrades) for (const d of Object.keys(s.pupg || {})) {
      const u = s.pupg[d];
      if (!u || typeof u !== 'object') { delete s.pupg[d]; continue; }
      for (const id of Object.keys(u)) {
        if (!G.Upgrades.BY[id]) delete u[id];
        else u[id] = Math.min(G.Upgrades.BY[id].max, n(u[id]));
      }
    }
  }

  /**
   * Fusiona dos versiones de la misma partida (p. ej. una jugada sin
   * conexión y la de la nube). Nunca se pierde nada conseguido:
   *   - colecciones (owned, shiny): unión
   *   - mejoras y estadísticas: el máximo de cada una
   *   - monedas, compañero, pity...: los de la versión más reciente
   * Es idempotente: fusionar dos veces da lo mismo.
   */
  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    const newer = (a.updated || 0) >= (b.updated || 0) ? a : b;
    const older = newer === a ? b : a;
    const r = JSON.parse(JSON.stringify(newer));
    for (const coll of ['owned', 'shiny']) {
      r[coll] = r[coll] || {};
      for (const k in older[coll] || {}) {
        if (!r[coll][k] || (older[coll][k].at || 0) < (r[coll][k].at || 0)) r[coll][k] = older[coll][k];
      }
    }
    for (const k in older.upgrades || {}) r.upgrades[k] = Math.max(r.upgrades[k] || 0, older.upgrades[k]);
    r.pupg = r.pupg || {};
    for (const d in older.pupg || {}) {
      const mine = r.pupg[d] = r.pupg[d] || {};
      for (const k in older.pupg[d]) mine[k] = Math.max(mine[k] || 0, older.pupg[d][k]);
    }
    r.pupgDone = r.pupgDone || older.pupgDone;
    // Lo conseguido nunca se pierde: unión de legendarios, arenas, objetos, logros...
    for (const coll of ['legends', 'arenas', 'itemsFound', 'evoMoves', 'ach']) {
      r[coll] = r[coll] || {};
      for (const k in older[coll] || {}) if (!r[coll][k]) r[coll][k] = older[coll][k];
    }
    // Misiones del mismo día/semana: el mayor progreso y lo ya recogido.
    const mo = older.missions || {}, mr = r.missions = r.missions || {};
    for (const [per, list] of [['day', 'daily'], ['week', 'weekly']]) {
      if (mr[per] !== mo[per] || !mr[list] || !mo[list]) continue;
      mr[list].forEach((m, i) => {
        const o = mo[list][i];
        if (!o || o.id !== m.id) return;
        m.prog = Math.max(m.prog || 0, o.prog || 0);
        m.claimed = m.claimed || o.claimed;
        m.told = m.told || o.told;
      });
    }
    for (const k in older.stats || {}) r.stats[k] = Math.max(r.stats[k] || 0, older.stats[k] || 0);
    if (r.starter == null) r.starter = older.starter;
    if (r.personality == null) r.personality = older.personality;
    if (r.partner == null || !r.owned[r.partner]) { r.partner = older.partner; r.partnerShiny = older.partnerShiny; }
    r.created = Math.min(a.created || Date.now(), b.created || Date.now());
    r.updated = Math.max(a.updated || 0, b.updated || 0);
    return r;
  }

  /** Sustituye el contenido de `save` sin cambiar el objeto (otros módulos lo tienen). */
  // Copia `s` sobre la partida SIN cambiar los objetos de dentro (mejoras,
  // Pokémon...): las pantallas abiertas guardan referencias a ellos. Antes se
  // sustituían y una compra hecha justo después de subir la partida se
  // apuntaba en la copia vieja: se cobraban las monedas y la mejora se perdía.
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function assignDeep(dst, src) {
    for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
    for (const k in src) {
      if (isObj(src[k]) && isObj(dst[k])) assignDeep(dst[k], src[k]);
      else dst[k] = src[k];
    }
  }
  function applyInPlace(s) { assignDeep(save, s); }

  const VALID = /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$/;

  // =====================================================================
  //                               MODO LOCAL
  // =====================================================================

  async function hash(pass, salt) {
    const text = salt + ':' + pass;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }

  function randomSalt() {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.random() * 256;
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function loadLocal(k, name) {
    const s = read(K_SAVE + k);
    return s ? migrate(s, name) : newSave(name);
  }

  function beginLocal(k, name) {
    key = k; user = name; guest = false;
    save = loadLocal(k, name);
    write(K_SES, k);
  }

  async function registerLocal(name, pass) {
    const accs = read(K_ACC) || {};
    const k = name.toLowerCase();
    if (accs[k]) return { ok: false, error: 'Ese nombre ya existe.' };
    const salt = randomSalt();
    accs[k] = { name, salt, hash: await hash(pass, salt), created: Date.now() };
    if (!write(K_ACC, accs)) return { ok: false, error: 'El navegador no deja guardar datos (¿modo incógnito?).' };
    beginLocal(k, name);
    write(K_SAVE + k, save);
    return { ok: true, isNew: true };
  }

  async function loginLocal(name, pass) {
    const accs = read(K_ACC) || {};
    const acc = accs[name.toLowerCase()];
    if (!acc || acc.hash !== await hash(pass || '', acc.salt)) {
      return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    }
    beginLocal(name.toLowerCase(), acc.name);
    return { ok: true, isNew: !save.partner };
  }

  function restoreLocal() {
    const k = read(K_SES);
    if (!k) return false;
    const accs = read(K_ACC) || {};
    if (!accs[k]) { remove(K_SES); return false; }
    beginLocal(k, accs[k].name);
    return true;
  }

  /** Partida de una cuenta local antigua, si el nombre y la contraseña coinciden. */
  async function legacySave(name, pass) {
    const k = (name || '').toLowerCase();
    const acc = (read(K_ACC) || {})[k];
    if (!acc || read(K_MIGRATED + k)) return null;
    if (acc.hash !== await hash(pass || '', acc.salt)) return null;
    const s = read(K_SAVE + k);
    return s ? { key: k, save: migrate(s, acc.name) } : null;
  }

  // =====================================================================
  //                               MODO NUBE
  // =====================================================================

  let auth = null, fs = null, rtdb = null, uid = null, unlisten = null;
  let pushT = 0, retryT = 0, pending = false, pushing = null, lastPush = 0;
  // No borrar la cuenta mientras Firestore pueda confirmar una escritura anterior.
  // pushNow() puede vencer a los 12 s, pero runTransaction continúa en Firebase.
  const inFlightTransactions = new Set();
  let deleting = false;
  // Invalida callbacks de escrituras y lecturas iniciadas en otra sesión.
  let sessionEpoch = 0;
  // Último saldo ECONÓMICO leído/confirmado en Firebase, separado de la copia
  // local. Hace posible detectar dos gastos divergentes sin sumar monedas o
  // aceptar gratis dos compras. Se guarda también para inicios offline.
  let observedRemote = null, syncBlocked = false;
  function currentSession(epoch, accountUid) {
    return sessionEpoch === epoch && uid === accountUid && !guest && !!save;
  }
  function resetSyncSession() {
    clearTimeout(pushT); clearTimeout(retryT);
    pushT = retryT = 0; pushDue = 0;
    pushing = null; pending = false; lastPush = 0; fails = 0;
    observedRemote = null; syncBlocked = false;
  }
  // Como mucho una subida cada 30 min (con miles de jugadores, cada 5 min
  // eran decenas de miles de escrituras por hora); lo que cuesta algo
  // (gacha, mejoras), a los 30 s. La copia local se guarda siempre al momento (y se fusiona con la
  // nube al volver a entrar), y al ocultar o cerrar la pestaña se sube lo pendiente.
  // Tras tiradas y compras se sube a los 3 min (era 30 s: quien hacía muchas tiradas
  // guardaba 2 veces por minuto y eran millones de escrituras al día). Lo hecho sigue
  // en la copia del navegador al momento, y se sube al salir de la pestaña.
  // Desde el 13-10-2026, lo normal cada 2 h (era 30 min: 216.000 jugadores al día
  // guardaban unas 12 millones de veces); al cerrar la pestaña, siempre; al
  // cambiar de pestaña, si hace más de 30 min.
  // Lo que vale algo (tiradas, compras, Pokémon nuevos, shinies, premios,
  // récords que entran en un top) se sube enseguida, y al acabar cada partida
  // como mucho cada 30 min:
  // con 2 h, quien abría el juego en otro aparato (o en el navegador de otra
  // app) veía la copia vieja de la nube y creía que lo había perdido.
  const PUSH_GAP = 2 * 3600 * 1000, PUSH_GAP_URGENT = 15 * 1000, PUSH_GAP_RUN = 30 * 60 * 1000, HIDE_GAP = 30 * 60 * 1000;
  let syncState = 'local';           // 'ok' | 'syncing' | 'pending' | 'offline' | 'local'
  const listeners = new Set();

  function setSync(s) { syncState = s; listeners.forEach(fn => { try { fn(s); } catch (e) { /* nada */ } }); }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = res; el.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(el);
    });
  }

  /*
   * La nube (Firebase, el TURN del cooperativo) sólo desde la web oficial: el
   * código está en GitHub, y una copia publicada en otra web sin cambiar
   * firebase-config.js guardaría sus cuentas y partidas en NUESTRO proyecto
   * (y lo pagaríamos nosotros). Ahí el juego va en modo local. Lo que lo
   * cierra de verdad es la clave de la API restringida a estos dominios en
   * Google Cloud; esto frena las copias que ni lo miran (14-10-2026).
   */
  const HOSTS = ['pokesurvivor.com', 'www.pokesurvivor.com', 'jpter78.github.io', 'localhost', '127.0.0.1'];

  async function initCloud() {
    const cfg = G.FIREBASE_CONFIG;
    if (!/^https?:$/.test(location.protocol)) { localReason = 'file'; return false; }
    if (cfg && !cfg.emulator && !HOSTS.includes(location.hostname)) { localReason = 'host'; return false; }
    if (!cfg || !cfg.apiKey || !cfg.projectId) { localReason = 'config'; return false; }
    await loadScript(SDK + 'firebase-app-compat.js');
    await loadScript(SDK + 'firebase-auth-compat.js');
    await loadScript(SDK + 'firebase-firestore-compat.js');
    // Base de datos en tiempo real: amigos en línea, invitaciones y salas.
    if (cfg.databaseURL) await loadScript(SDK + 'firebase-database-compat.js');
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    fs = firebase.firestore();
    // Algunas redes y antivirus cortan las actualizaciones en directo (amigos,
    // invitaciones): Firebase prueba otra forma de recibirlas si hace falta.
    try { fs.settings({ experimentalAutoDetectLongPolling: true }); } catch (e) { /* ya estaba */ }
    rtdb = cfg.databaseURL ? firebase.database() : null;
    // Sólo para pruebas: { ..., emulator: true } usa el emulador local de Firebase.
    if (cfg.emulator) {
      auth.useEmulator('http://127.0.0.1:9099');
      fs.useEmulator('127.0.0.1', 8080);
      if (rtdb) rtdb.useEmulator('127.0.0.1', 9000);
    }
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    auth.languageCode = 'es';
    addEventListener('online', () => { if (pending) pushNow(); });
    // Al salir de la pestaña o cerrarla se sube lo pendiente, pero no más de una
    // vez cada 10 min: la gente cambia de pestaña a menudo y cada partida se
    // subía cada ~9 min en vez de cada 30 (12-10-2026, el mayor gasto de
    // Firebase). Lo que no se sube sigue en la copia de este navegador y se
    // sube al volver a entrar.
    const hideFlush = () => { if (pending && Date.now() - lastPush > HIDE_GAP) pushNow(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') hideFlush(); });
    // Al cerrar o recargar la página, lo pendiente se sube siempre.
    addEventListener('pagehide', () => { if (pending) pushNow(); });
    return true;
  }

  /** Firebase pide email: el nombre se codifica en uno interno, único y válido. */
  function nameToEmail(name) {
    const hex = [...new TextEncoder().encode(name.trim().toLowerCase())].map(b => b.toString(16).padStart(2, '0')).join('');
    return hex + '@' + NAME_DOMAIN;
  }

  function displayNameOf(u) {
    const n = ((u && u.displayName) || 'Entrenador').trim().split(/\s+/)[0].replace(/[^A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]/g, '');
    return (n || 'Entrenador').slice(0, 16);
  }

  const docRef = (accountUid = uid) => fs.collection('saves').doc(accountUid);
  const plain = s => JSON.parse(JSON.stringify(s));      // Firestore no admite undefined

  /**
   * Comprueba si la unión recuperó logros que no estaban en la nube.
   * No compara timestamps ni la partida entera: las migraciones añaden campos
   * que no deben provocar una escritura Firestore en cada inicio de sesión.
   * Monedas, tickets, compañero y pity siguen usando la versión más reciente;
   * no se suman saldos (se duplicarían compras al jugar en dos dispositivos).
   */
  function recoveredProgress(cloud, combined) {
    if (!cloud || !combined) return false;
    for (const coll of ['owned', 'shiny', 'legends', 'arenas', 'itemsFound', 'evoMoves', 'ach']) {
      const before = cloud[coll] || {}, after = combined[coll] || {};
      for (const k of Object.keys(after)) if (!Object.prototype.hasOwnProperty.call(before, k)) return true;
    }
    for (const coll of ['upgrades', 'stats']) {
      const before = cloud[coll] || {}, after = combined[coll] || {};
      for (const k of Object.keys(after)) if ((+after[k] || 0) > (+before[k] || 0)) return true;
    }
    for (const dex of Object.keys(combined.pupg || {})) {
      const before = (cloud.pupg || {})[dex] || {}, after = combined.pupg[dex] || {};
      for (const id of Object.keys(after)) if ((+after[id] || 0) > (+before[id] || 0)) return true;
    }
    const oldMissions = cloud.missions || {}, newMissions = combined.missions || {};
    for (const [period, list] of [['day', 'daily'], ['week', 'weekly']]) {
      if (oldMissions[period] !== newMissions[period]) continue;
      for (const [i, now] of (newMissions[list] || []).entries()) {
        const old = (oldMissions[list] || [])[i];
        if (!old || !now || old.id !== now.id) continue;
        if ((now.prog || 0) > (old.prog || 0) || (now.claimed && !old.claimed) || (now.told && !old.told))
          return true;
      }
    }
    return (cloud.starter == null && combined.starter != null) ||
      (cloud.personality == null && combined.personality != null) ||
      (cloud.partner == null && combined.partner != null);
  }


  /**
   * El inventario coleccionable se fusiona con unión/máximo, pero los saldos
   * gastables y upgrades comprados tienen causalidad: con dos compras offline
   * de 100 monedas desde el mismo saldo 500, merge() devolvería dos mejoras
   * y sólo un pago (400). Conservar AMBAS copias, sin subir nada, es más seguro
   * que adivinar un saldo o duplicar tickets.
   */
  function economySnapshot(s) {
    if (!s || !isObj(s)) return null;
    return {
      coins: s.coins,
      tickets: plain(s.tickets || {}),
      pity: plain(s.pity || {}),
      upgrades: plain(s.upgrades || {}),
      pupg: plain(s.pupg || {})
    };
  }
  function concurrentEconomyChanges(base, local, remote) {
    if (!base || !local || !remote) return false;
    const l = economySnapshot(local), r = economySnapshot(remote);
    if (!l || !r) return false;
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const overlap = (a, b, c) => !same(a, b) && !same(a, c);
    if (overlap(base.coins, l.coins, r.coins)) return true;
    for (const group of ['tickets', 'pity', 'upgrades']) {
      const a = base[group] || {}, b = l[group] || {}, c = r[group] || {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)]);
      for (const k of keys) if (overlap(a[k], b[k], c[k])) return true;
    }
    const aa = base.pupg || {}, bb = l.pupg || {}, cc = r.pupg || {};
    const dexes = new Set([...Object.keys(aa), ...Object.keys(bb), ...Object.keys(cc)]);
    for (const dex of dexes) {
      const a = aa[dex] || {}, b = bb[dex] || {}, c = cc[dex] || {};
      const ids = new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)]);
      for (const id of ids) if (overlap(a[id], b[id], c[id])) return true;
    }
    return false;
  }
  const CONFLICT_MSG = 'Conflicto entre dispositivos: tu progreso sigue en este navegador, pero no se enviará a la nube para evitar perder compras. No borres los datos del navegador.';
  function blockConcurrentSync(accountUid) {
    syncBlocked = true; pending = false;
    clearTimeout(pushT); clearTimeout(retryT);
    pushT = retryT = pushDue = 0;
    setSync('conflict');
    if (G.UI && G.UI.refreshCoins) G.UI.refreshCoins();
    if (G.UI && G.UI.toast) G.UI.toast(CONFLICT_MSG, 12000);
    console.warn('[DB]', CONFLICT_MSG, accountUid);
  }

  // Si existe el documento pero no una partida reconocible, NO crear y subir
  // silenciosamente una partida nueva encima de datos potencialmente recuperables.
  function validCloudSave(s) {
    return isObj(s) && ['coins', 'owned', 'created', 'partner'].some(k => Object.prototype.hasOwnProperty.call(s, k));
  }


  /** Abre la partida de la nube de un usuario recién autenticado. */
  async function openCloud(u, opts = {}) {
    // Abrir otra cuenta cancela solamente el estado local de sincronización.
    // Las transacciones ya enviadas siguen perteneciendo a su UID original.
    const epoch = ++sessionEpoch;
    resetSyncSession();
    uid = u.uid; key = null; save = null; user = null; guest = false;
    const accountUid = u.uid;
    if (G.Signups) G.Signups.report(u);          // tope de cuentas del mes (net/signups.js)
    const cached = read(K_CLOUD + accountUid);
    observedRemote = read(K_BASE + accountUid);
    let remote = null, online = true;
    try {
      const snap = await docRef(accountUid).get();
      if (snap.exists && !validCloudSave(snap.data() && snap.data().save))
        throw { code: 'save/cloud-invalid' };
      remote = snap.exists ? snap.data().save : null;
    } catch (e) {
      if (e && e.code === 'save/cloud-invalid') throw e;
      if (!cached) throw e;                // sin conexión y sin copia: no hay nada que abrir
      online = false;
    }
    // Otra autenticación puede haber terminado mientras Firestore respondía.
    if (sessionEpoch !== epoch || uid !== accountUid || auth.currentUser?.uid !== accountUid)
      throw { code: 'save/session-changed' };
    // NO fusionar dos gastos del mismo saldo base al volver de estar offline:
    // el cliente conserva su partida local, y la nube sigue intacta. La última
    // lectura conocida debe haberse guardado antes de abrir el modo offline.
    if (online && observedRemote && cached && remote &&
        concurrentEconomyChanges(observedRemote, cached, remote)) {
      save = migrate(cached, cached.name); key = accountUid; user = save.name;
      blockConcurrentSync(accountUid);
      return;
    }
    const localSave = cached && isObj(cached) ? migrate(cached) : null;
    const cloudSave = remote && migrate(remote);
    // Sólo avanzar la base después de descartar un conflicto.
    if (online && cloudSave) {
      observedRemote = economySnapshot(cloudSave);
      write(K_BASE + accountUid, observedRemote);
    }
    let s = merge(localSave, cloudSave);
    if (!s) s = newSave(opts.name || displayNameOf(u));
    const restored = !!(cloudSave && recoveredProgress(cloudSave, s));
    if (opts.legacy) {
      s = merge(s, opts.legacy.save);
      write(K_MIGRATED + opts.legacy.key, uid);
    }
    save = migrate(s, s.name);
    key = accountUid; user = save.name; guest = false;
    write(K_CLOUD + accountUid, save);
    // Sólo se sube si hay algo que la nube no tenga (cuenta nueva, progreso de
    // este ordenador sin subir...), y SIN esperar: antes el menú no salía hasta
    // terminar la subida, y con Firebase lento se tardaba hasta 9 s en entrar.
    // (Comparar el texto entero daba "distinto" casi siempre y se subía en cada
    // entrada: ahora sólo si esta copia es más nueva que la de la nube.)
    const same = cloudSave && !opts.legacy && !restored &&
      (!localSave || (localSave.updated || 0) <= (cloudSave.updated || 0));
    lastPush = Date.now();       // la primera compra o ticket no sube al momento: espera como las demás
    if (!online) { pending = true; setSync('offline'); scheduleRetry(); }
    else if (same) setSync('ok');
    else pushNow();
  }

  /*
   * Ya no se escucha el documento en vivo (cada cambio costaba una lectura).
   * Si juegas en dos ordenadores, las partidas se fusionan al entrar y en
   * cada subida (transacción con merge()).
   */
  function stopListening() { if (unlisten) { unlisten(); unlisten = null; } }

  /*
   * Si el admin ha baneado la cuenta del ranking (ban = true en la nube, ver
   * firestore.rules), cada guardado tiene que conservarlo: se copia de la nube.
   * Nunca se sube dos veces en menos de 65 s; mientras, todo está en el navegador.
   */
  const K_OK = 'ps.cloudok.', MIN_GAP = 65000;
  const sinceOk = accountUid => Date.now() - (+read(K_OK + accountUid) || 0);

  /** Sube la partida fusionándola con lo que haya en la nube (transacción). */
  function pushNow() {
    if (deleting || syncBlocked || mode !== 'cloud' || guest || !save || !uid) return Promise.resolve();
    // Si ya hay una subida en marcha, se hace otra justo después (para lo que haya cambiado mientras).
    const epoch = sessionEpoch, accountUid = uid;
    if (pushing) {
      pending = true;
      return pushing.then(() => (currentSession(epoch, accountUid) && pending ? pushNow() : undefined));
    }
    clearTimeout(pushT); pushT = 0; pushDue = 0;
    if (navigator.onLine === false) {
      pending = true; setSync('offline'); scheduleRetry();
      return Promise.resolve();
    }
    if (sinceOk(accountUid) < MIN_GAP) {
      pending = true; setSync('pending');
      schedulePush(MIN_GAP - sinceOk(accountUid) + 500);
      return Promise.resolve();
    }
    pending = false;
    lastPush = Date.now();
    setSync('syncing');
    let merged = null;
    const ref = docRef(accountUid);
    const initialSave = plain(save);
    const tr = fs.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const remote = snap.exists ? migrate(snap.data().save) : null;
      // Nunca leer una partida ajena si el usuario cambia durante tx.get().
      const source = currentSession(epoch, accountUid) ? plain(save) : initialSave;
      if (remote && concurrentEconomyChanges(observedRemote, source, remote))
        throw { code: 'save/merge-conflict' };
      merged = remote ? merge(source, remote) : source;
      const doc = { save: merged, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), v: VERSION };
      if (snap.exists && snap.data().ban === true) doc.ban = true;
      tx.set(ref, doc);
    });
    inFlightTransactions.add(tr);
    tr.then(
      () => inFlightTransactions.delete(tr),
      () => inFlightTransactions.delete(tr)
    );
    // Si la red se cae a medias, Firestore puede quedarse esperando: tope de 12 s.
    const timeout = new Promise((_, rej) => setTimeout(() => rej({ code: 'unavailable' }), 12000));
    let failed = false;
    const work = Promise.race([tr, timeout]).then(() => {
      if (!currentSession(epoch, accountUid)) return;
      fails = 0;
      write(K_OK + accountUid, Date.now());
      observedRemote = economySnapshot(merged);
      write(K_BASE + accountUid, observedRemote);
      // Se FUSIONA con lo de ahora (no se sobrescribe): si has cambiado algo
      // mientras se subía (elegir compañero, una compra...), no se pierde.
      if (merged) { applyInPlace(merge(plain(save), merged)); write(K_CLOUD + accountUid, save); }
      setSync(pending ? 'pending' : 'ok');
      if (G.UI && G.UI.refreshCoins) G.UI.refreshCoins();
    }).catch(e => {
      if (!currentSession(epoch, accountUid)) return;
      if (e && e.code === 'save/merge-conflict') {
        failed = true; blockConcurrentSync(accountUid);
        return;
      }
      console.warn('[DB] no se pudo sincronizar:', e.code || e.message);
      pending = true; failed = true;
      setSync(navigator.onLine === false || e.code === 'unavailable' ? 'offline' : 'pending');
      scheduleRetry();
    }).finally(() => {
      if (!currentSession(epoch, accountUid)) return;
      pushing = null;
      // (Si ha fallado, el reintento ya está programado con su espera creciente.)
      if (!failed && pending && syncState === 'pending') schedulePush(Math.max(1500, PUSH_GAP - (Date.now() - lastPush)));
    });
    pushing = work;
    return work;
  }

  // Si ya había una subida programada antes, se respeta (una compra no espera a la siguiente partida).
  let pushDue = 0;
  function schedulePush(ms) {
    if (deleting) return;
    const epoch = sessionEpoch, accountUid = uid;
    const due = Date.now() + ms;
    if (pushT && pushDue && pushDue <= due) return;
    clearTimeout(pushT); pushDue = due;
    pushT = setTimeout(() => {
      if (!currentSession(epoch, accountUid)) return;
      pushT = 0; pushDue = 0; pushNow();
    }, ms);
  }
  /**
   * Reintento con espera creciente: 15 s, 30 s, 1 min, 2 min... hasta 10 min.
   * Con muchos jugadores, reintentar siempre a los 15 s cuando Firebase falla
   * (cupo agotado, caída) multiplicaba las lecturas (pasó el 10-10-2026).
   */
  let fails = 0;
  function scheduleRetry() {
    if (deleting) return;
    const epoch = sessionEpoch, accountUid = uid;
    const ms = Math.min(10 * 60e3, 15e3 * Math.pow(2, fails)) * (0.8 + Math.random() * 0.4);
    fails = Math.min(fails + 1, 8);
    clearTimeout(retryT);
    retryT = setTimeout(() => {
      if (currentSession(epoch, accountUid) && pending) pushNow();
    }, ms);
  }

  function authError(e) {
    const c = (e && e.code) || '';
    const M = {
      'auth/email-already-in-use': 'Ese nombre ya existe.',
      'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
      'auth/invalid-login-credentials': 'Usuario o contraseña incorrectos.',
      'auth/wrong-password': 'Usuario o contraseña incorrectos.',
      'auth/user-not-found': 'Usuario o contraseña incorrectos.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos seguidos. Espera un poco.',
      'auth/network-request-failed': 'Sin conexión a internet.',
      'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes.',
      'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (Authentication > Configuración > Dominios autorizados).',
      'auth/operation-not-allowed': 'Ese método de inicio de sesión no está activado en Firebase.',
      // Registro de cuentas nuevas desactivado en Firebase (Authentication > Configuración).
      'auth/admin-restricted-operation': 'Ahora mismo no se pueden crear cuentas nuevas. Si ya tienes cuenta, entra normal; si no, puedes jugar como invitado.',
      'auth/requires-recent-login': 'Por seguridad, vuelve a iniciar sesión y repite la operación.',
      'permission-denied': 'La base de datos rechazó el acceso (revisa las reglas de Firestore).',
      'unavailable': 'Sin conexión con la base de datos.',
      'save/delete-pending': 'Hay un guardado en curso. Espera a que termine antes de borrar la cuenta.',
      'save/session-changed': 'La sesión cambió mientras se cargaba la partida. Intenta entrar de nuevo.',
      'save/cloud-invalid': 'La partida guardada en la nube está incompleta. Por seguridad no se ha sobrescrito. Contacta con soporte antes de crear una partida nueva.'
    };
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return '';
    // El "portero" de Firebase (functions/index.js) ha rechazado la cuenta nueva: tope del mes.
    if (/error-code:-47|BLOCKING_FUNCTION|resource-exhausted|cuentas nuevas/i.test(c + ' ' + ((e && e.message) || '')))
      return 'Este mes ya no quedan plazas para cuentas nuevas (vuelven el 1 de ' + (G.Signups ? G.Signups.nextMonthName() : 'mes que viene') + '). Mientras, puedes jugar como invitado.';
    return M[c] || ('Error: ' + (c || (e && e.message) || 'desconocido'));
  }

  // =====================================================================
  //                           API PÚBLICA
  // =====================================================================

  let readyP = null;

  /** Arranca la base de datos y recupera la sesión anterior. → true si hay sesión. */
  function ready() {
    if (readyP) return readyP;
    readyP = (async () => {
      try { if (await initCloud()) mode = 'cloud'; }
      catch (e) { console.warn('[DB] sin nube:', e.message); localReason = 'error'; mode = 'local'; }
      if (mode === 'local') { setSync('local'); return restoreLocal(); }
      const u = await new Promise(res => { const off = auth.onAuthStateChanged(x => { off(); res(x); }); });
      if (!u) return false;
      try { await openCloud(u); return true; }
      catch (e) { console.warn('[DB] no se pudo abrir la partida:', e.code || e.message); return false; }
    })();
    return readyP;
  }

  async function register(name, pass) {
    name = (name || '').trim();
    if (!VALID.test(name)) return { ok: false, error: 'El nombre debe tener 3-16 letras, números o _.' };
    const min = mode === 'cloud' ? 6 : 4;
    if ((pass || '').length < min) return { ok: false, error: `La contraseña debe tener al menos ${min} caracteres.` };
    if (mode === 'local') return registerLocal(name, pass);
    // Tope de cuentas del mes (Firebase cobra a partir de 50.000 al mes).
    if (G.Signups && !(await G.Signups.check())) return { ok: false, error: 'Este mes ya no quedan plazas para cuentas nuevas (vuelven el 1 de ' + G.Signups.nextMonthName() + '). Mientras, puedes jugar como invitado.' };
    try {
      const legacy = await legacySave(name, pass);
      const cred = await auth.createUserWithEmailAndPassword(nameToEmail(name), pass);
      if (G.Signups) G.Signups.markNew(cred.user.uid);   // ya la apuntó el portero
      await openCloud(cred.user, { name, legacy });
      return { ok: true, isNew: !save.partner, imported: !!legacy };
    } catch (e) { return { ok: false, error: authError(e) }; }
  }

  async function login(name, pass) {
    name = (name || '').trim();
    if (mode === 'local') return loginLocal(name, pass);
    try {
      const legacy = await legacySave(name, pass);
      const cred = await auth.signInWithEmailAndPassword(nameToEmail(name), pass || '');
      await openCloud(cred.user, { name, legacy });
      return { ok: true, isNew: !save.partner, imported: !!legacy };
    } catch (e) { return { ok: false, error: authError(e) }; }
  }

  async function loginWithGoogle() {
    if (mode !== 'cloud') return { ok: false, error: 'Entrar con Google necesita la versión publicada del juego.' };
    try {
      const cred = await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      // Cuenta de Google nueva con el tope del mes alcanzado: no se crea.
      if (cred.additionalUserInfo && cred.additionalUserInfo.isNewUser && G.Signups && !(await G.Signups.check())) {
        await cred.user.delete().catch(() => {});
        await auth.signOut().catch(() => {});
        return { ok: false, error: 'Este mes ya no quedan plazas para cuentas nuevas (vuelven el 1 de ' + G.Signups.nextMonthName() + '). Mientras, puedes jugar como invitado.' };
      }
      if (cred.additionalUserInfo && cred.additionalUserInfo.isNewUser && G.Signups) G.Signups.markNew(cred.user.uid);
      await openCloud(cred.user, { name: displayNameOf(cred.user) });
      return { ok: true, isNew: !save.partner };
    } catch (e) { return { ok: false, error: authError(e) }; }
  }

  /** Cambia el nombre que se ve en la partida (al elegir apodo). */
  function setName(n) {
    if (!save || guest) return;
    save.name = n; user = n;
    commit();
  }

  function playAsGuest() {
    ++sessionEpoch; resetSyncSession();
    user = 'Invitado'; key = null; guest = true; uid = null;
    save = newSave('Invitado');
    if (mode === 'local') remove(K_SES);
    return { ok: true, isNew: true };
  }

  /**
   * Guarda la partida actual (no hace nada en modo invitado). En el navegador,
   * al momento; en la nube:
   * @param urgent  true: lo que vale algo (tiradas, compras, Pokémon, premios): enseguida
   *                'run': al acabar una partida (como mucho cada 30 min) · false: cada 2 h
   */
  function commit(urgent = false) {
    if (guest || !key || !save) return false;
    // Reloj lógico por sesión: un gasto posterior a abrir una copia de la
    // nube debe ser más reciente incluso si aquel dispositivo tenía la hora
    // adelantada. No resuelve dos ediciones offline verdaderamente concurrentes.
    const previous = +save.updated;
    save.updated = Math.max(Date.now(), (Number.isFinite(previous) ? previous : 0) + 1);
    if (mode === 'local') return write(K_SAVE + key, save);
    write(K_CLOUD + uid, save);
    if (syncBlocked) { setSync('conflict'); return true; }
    pending = true;
    setSync('pending');
    const gap = urgent === 'run' ? PUSH_GAP_RUN : urgent ? PUSH_GAP_URGENT : PUSH_GAP;
    schedulePush(Math.max(1200, gap - (Date.now() - lastPush)));
    return true;
  }

  /** Funciones que se ejecutan al cerrar sesión o borrar la cuenta (amigos, salas...). */
  const leaveHooks = [];

  async function logout() {
    const epoch = sessionEpoch, accountUid = uid;
    // La copia local debe quedar persistida incluso si Firebase tarda o falla.
    if (mode === 'cloud' && !guest && save && accountUid)
      write(K_CLOUD + accountUid, save);
    for (const fn of leaveHooks) {
      try { await fn('logout'); } catch (e) { /* nada */ }
      if (epoch !== sessionEpoch) return;
    }
    if (mode === 'cloud' && !guest && save) {
      if (pending) { try { await pushNow(); } catch (e) { /* queda la copia local */ } }
      if (epoch !== sessionEpoch) return; // otra cuenta entró durante el guardado
      stopListening();
      try { await auth.signOut(); } catch (e) { /* nada */ }
    } else if (mode === 'local' && !guest) {
      commit();
      remove(K_SES);
    }
    if (epoch !== sessionEpoch) return;
    ++sessionEpoch;
    resetSyncSession();
    user = key = save = uid = null; guest = false;
    setSync(mode === 'cloud' ? 'ok' : 'local');
  }

  function nameAccount() { return !!(auth && auth.currentUser && (auth.currentUser.email || '').endsWith('@' + NAME_DOMAIN)); }

  /*
   * Recuperar la cuenta: las de nombre y contraseña no tienen correo de verdad
   * (no se les puede mandar un enlace), así que se les ofrece VINCULAR su Gmail:
   * si un día olvidan la contraseña, entran con Google y es la misma cuenta.
   * Lo hace el sistema de cuentas de Firebase (gratis): ni una lectura ni una
   * escritura de la base de datos.
   */
  function hasGoogle() {
    const u = auth && auth.currentUser;
    return !!(u && u.providerData.some(p => p.providerId === 'google.com'));
  }
  async function linkGoogle() {
    if (!auth || !auth.currentUser) return { ok: false, error: 'Inicia sesión primero.' };
    try {
      await auth.currentUser.linkWithPopup(new firebase.auth.GoogleAuthProvider());
      return { ok: true };
    } catch (e) {
      const c = (e && e.code) || '';
      if (c === 'auth/provider-already-linked') return { ok: true };
      if (c === 'auth/credential-already-in-use' || c === 'auth/email-already-in-use')
        return { ok: false, error: 'Ese Gmail ya tiene su propia cuenta del juego. Usa otro Gmail.' };
      return { ok: false, error: authError(e) };
    }
  }

  /**
   * Borra la cuenta y la partida (en la nube o en este navegador).
   * @param pass  contraseña (cuentas de nombre y contraseña)
   */
  async function waitForUploadsBeforeDelete() {
    if (!inFlightTransactions.size) return;
    let alarm;
    try {
      await Promise.race([
        Promise.allSettled([...inFlightTransactions]),
        new Promise((_, reject) => {
          alarm = setTimeout(() => reject({ code: 'save/delete-pending' }), 15000);
        })
      ]);
    } finally { clearTimeout(alarm); }
  }

  async function deleteAccount(pass) {
    if (guest || !key) return { ok: false, error: 'No hay cuenta que borrar.' };
    const epoch = sessionEpoch, accountUid = uid;
    if (mode === 'local') {
      const accs = read(K_ACC) || {};
      delete accs[key];
      write(K_ACC, accs);
      remove(K_SAVE + key); remove(K_SES);
      user = key = save = null;
      return { ok: true };
    }
    try {
      // Primero se confirma quién eres: Firebase sólo deja borrar la cuenta si
      // se ha entrado hace poco. Antes se borraban los datos y luego fallaba
      // ese último paso: la cuenta quedaba vacía pero existía y su nombre no
      // se podía volver a usar.
      const cu = auth.currentUser;
      if (!cu || cu.uid !== accountUid) throw { code: 'save/session-changed' };
      if (nameAccount()) {
        if (!pass) return { ok: false, error: 'Escribe tu contraseña.' };
        await cu.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(cu.email, pass));
      } else {
        await cu.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
      }
      if (sessionEpoch !== epoch || uid !== accountUid || auth.currentUser?.uid !== accountUid)
        throw { code: 'save/session-changed' };
      deleting = true;
      // Antes de borrar, dejar terminar realmente todas las transacciones,
      // incluso las que ya agotaron el timeout visual de pushNow().
      await waitForUploadsBeforeDelete();
      if (sessionEpoch !== epoch || uid !== accountUid || auth.currentUser?.uid !== accountUid)
        throw { code: 'save/session-changed' };
      clearTimeout(pushT); clearTimeout(retryT); pending = false;
      stopListening();
      for (const fn of leaveHooks) {
        await fn('delete');
        if (sessionEpoch !== epoch || uid !== accountUid || auth.currentUser?.uid !== accountUid)
          throw { code: 'save/session-changed' };
      }
      await docRef(accountUid).delete();
      // El usuario Firebase a borrar debe ser el capturado, nunca el actual
      // después de un cambio de cuenta durante la llamada a Firestore.
      await cu.delete();
      // Conservar la copia local si Firebase borra el documento pero falla al
      // borrar la cuenta: puede restaurarse al volver a iniciar sesión.
      remove(K_CLOUD + accountUid);
      if (sessionEpoch === epoch && uid === accountUid) {
        ++sessionEpoch;
        resetSyncSession();
        user = key = save = uid = null;
      }
      return { ok: true };
    } catch (e) { return { ok: false, error: authError(e) }; }
    finally {
      deleting = false;
      if (pending && uid && save) scheduleRetry();
    }
  }

  // ---------------- helpers de partida ----------------

  function owns(dex) { return !!(save && save.owned[dex]); }

  function grant(dex, from) {
    if (!save.owned[dex]) save.owned[dex] = { at: Date.now(), from };
  }

  function ownsShiny(dex) { return !!(save && save.shiny && save.shiny[dex]); }

  /** Mejoras compradas para un Pokémon: { id -> nivel }. */
  function upgradesOf(dex) {
    if (!save) return {};
    save.pupg = save.pupg || {};
    return save.pupg[dex] || (save.pupg[dex] = {});
  }

  /** Da la versión shiny (y la normal, si no la tenía). Devuelve true si es nueva. */
  function grantShiny(dex, from) {
    grant(dex, from);
    if (save.shiny[dex]) return false;
    save.shiny[dex] = { at: Date.now(), from };
    return true;
  }

  return {
    ready, register, login, loginWithGoogle, playAsGuest, logout, commit, deleteAccount, flush: pushNow,
    owns, grant, ownsShiny, grantShiny, merge, setName, upgradesOf,
    onSync(fn) { listeners.add(fn); },
    onLeave(fn) { leaveHooks.push(fn); },
    /** Acceso de bajo nivel para los módulos de red (sólo en modo nube). */
    get fb() { return mode === 'cloud' ? { auth, fs, rtdb, uid, emulator: !!(G.FIREBASE_CONFIG || {}).emulator } : null; },
    /** ¿Está disponible lo online (amigos, ranking, multijugador)? */
    get online() { return mode === 'cloud' && !guest && !!uid && !!save; },
    /** ¿La cuenta es de usuario y contraseña (no de Google)? */
    get nameAccount() { return nameAccount(); },
    get hasGoogle() { return hasGoogle(); }, linkGoogle,
    get mode() { return mode; },
    get localReason() { return localReason; },
    get syncState() { return syncState; },
    get user() { return user; },
    get guest() { return guest; },
    get save() { return save; },
    get loggedIn() { return !!save; },
    get storageOk() { return storageOk; },
    START_COINS
  };
})();
