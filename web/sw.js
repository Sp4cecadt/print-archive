/* Print Archive service worker: offline app shell + cached thumbnails. API data is network-first. */
importScripts('version.js');
const CACHE = 'pa-shell-' + self.PA_VERSION;
const RUNTIME = 'pa-runtime-' + self.PA_VERSION;
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'version.js', 'manifest.webmanifest', 'fonts/Geist.ttf',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'favicon.ico', 'demo/prints.json'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pa-') && k !== CACHE && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'version' && e.source) e.source.postMessage({ type: 'version', cache: CACHE, version: self.PA_VERSION }); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;                 // never touch cross-origin (e.g. a helper on another host)
  if (u.pathname.includes('/api/')) {
    if (/\/api\/prints\/[^/]+\/thumb$/.test(u.pathname)) {   // thumbnails: cache-first
      e.respondWith(caches.open(RUNTIME).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    }
    return;                                                   // other API calls: straight to the network
  }
  if (/\.(3mf|stl)$/i.test(u.pathname)) return;               // downloads: network only
  // App shell: stale-while-revalidate
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
    const net = fetch(req).then(r => { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; }).catch(() => hit || (req.mode === 'navigate' ? c.match('index.html') : undefined));
    return hit || net;
  }));
});
