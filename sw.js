/* PokéSurvivor PWA: navegación y código network-first; sprites cache-first.
 * Precarga el bundle con versión real para arrancar offline tras instalar.
 * version.json evita la caché: sus consultas llevan un timestamp cada 5 min.
 */
const CODE = 'ps-code-v2', ART = 'ps-art-v1';
const SHELL = ['./', './index.html', './en/index.html', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const response = await fetch('./index.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo leer la portada para precargar el juego');
    const html = await response.text();
    const js = html.match(/<script defer src="(js\/app\.min\.js\?v=[a-f0-9]+)"><\/script>/);
    const css = html.match(/<link rel="stylesheet" href="(css\/style\.css(?:\?v=[a-f0-9]+)?)">/);
    if (!js || !css) throw new Error('No se encontró la versión de los recursos');
    const c = await caches.open(CODE);
    // addAll falla como conjunto si falta alguno: no activar una PWA rota.
    await c.addAll([...SHELL, './' + js[1], './' + css[1]]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CODE && k !== ART).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Un ?t=Date.now() creaba infinitas entradas de caché en sesiones largas.
  if (url.pathname.endsWith('/version.json')) return;
  const art = /\/assets\/(pokemon|icons|fonts)\//.test(url.pathname);
  if (art) {
    e.respondWith(caches.open(ART).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) e.waitUntil(c.put(req, res.clone()));
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone();
      e.waitUntil(caches.open(CODE).then(c => c.put(req, copy)));
    }
    return res;
  }).catch(async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const root = new URL(self.registration.scope).pathname;
      if (url.pathname === root + 'en/' || url.pathname === root + 'en/index.html') {
        return (await caches.match('./en/index.html')) || Response.error();
      }
      if (url.pathname === root || url.pathname === root + 'index.html') {
        return (await caches.match('./index.html')) || Response.error();
      }
    }
    return Response.error();
  }));
});
