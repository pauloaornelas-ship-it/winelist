// Service worker: permite usar a app sem ligação à internet.
const VERSION = '8'; // manter igual ao ?v= de index.html
const CACHE = `winelist-v${VERSION}`;
const ASSETS = ['./', 'index.html', `styles.css?v=${VERSION}`, `app.js?v=${VERSION}`, `db.js?v=${VERSION}`, 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (para receber atualizações), cache como alternativa offline.
// 'no-cache' obriga o navegador a confirmar com o servidor, evitando misturar
// ficheiros novos e antigos guardados na cache HTTP (ex.: GitHub Pages guarda 10 min).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./')))
  );
});
