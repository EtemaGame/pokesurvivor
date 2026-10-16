/* Solo para el laboratorio multijugador. Nunca usar Firebase oficial aquí.
 * La web exige un proyecto NUEVO cuyo ID empiece por ps-test-.
 * sandbox-config.js se genera al preparar la publicación; sin él, modo local.
 * Las claves públicas del SDK NO son credenciales de administración.
 */
G.FIREBASE_CONFIG = (() => {
  const c = window.PS_TEST_FIREBASE_CONFIG;
  if (!c || typeof c !== 'object' || !/^ps-test-[a-z0-9-]{4,24}$/.test(c.projectId || '')
    || !c.apiKey || !c.appId || !c.authDomain || !c.databaseURL) return null;
  // Prohíbe usar como servidor de prueba un proyecto con identidad ajena.
  const id = c.projectId;
  if (c.authDomain !== id + '.firebaseapp.com'
    || !new RegExp('^https://' + id + '(-default-rtdb)?[.-]').test(c.databaseURL)) return null;
  return {
    apiKey: c.apiKey, authDomain: c.authDomain, projectId: id,
    appId: c.appId, databaseURL: c.databaseURL,
    messagingSenderId: c.messagingSenderId || undefined,
    storageBucket: c.storageBucket || undefined
  };
})();
