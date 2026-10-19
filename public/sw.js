// AllianceSim service worker (spec 007): installable PWA + works offline.
// Network-first for everything it touches, so a deploy is visible at once; the cache is
// only a fallback when there is no connection. Live streams, writes and the private
// /me API are never cached.
const CACHE = 'alliancesim-v2';
const SHELL = ['./', './index.html', './phone.js', './games.js', './games-engines.js', './analytics.js', './manifest.json', './assets/icon-192.png', './assets/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/me\//.test(url.pathname) || /stream|notifications|__/.test(url.pathname)) return; // private / live
  const api = url.pathname.includes('/api/');
  if (api && !/\/api\/(layout|employees|office\/now)$/.test(url.pathname)) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (res.type === 'basic' || res.type === 'default')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: !api }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
