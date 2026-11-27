const CACHE = 'collied-v19';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'meta.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CORE.map(u => c.add(u)))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    let t; const slow = new Promise(res => { t = setTimeout(() => res(null), 3000); });
    const net = fetch(r, { cache: 'no-cache' }).then(x => { if (x.ok) c.put(r, x.clone()); return x; });
    try { const x = await Promise.race([net, slow]); clearTimeout(t); if (x) return x; const h = await c.match(r, { ignoreSearch: true }); if (h){ net.catch(() => {}); return h; } return await net; }
    catch (err) { clearTimeout(t); return (await c.match(r, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error(); }
  }));
});
