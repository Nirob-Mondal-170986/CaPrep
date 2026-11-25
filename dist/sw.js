/* Service worker: lets the site open without internet and be installed as an app.
   The build step replaces 7b39abfe09 so every new deploy refreshes the cache. */
const VERSION = "7b39abfe09";
const CACHE = "haprep-" + VERSION;
const SHELL = ["./", "app.css", "app.js", "data.js", "store.js", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "logo.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("haprep-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.hostname.endsWith("supabase.co")) return;               // never cache account or progress calls
  if (req.mode === "navigate") {                                   // pages: newest first, saved copy when offline
    e.respondWith(fetch(req).then(r => { caches.open(CACHE).then(c => c.put("./", r.clone())); return r; }).catch(() => caches.match("./")));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {                    // files: saved copy first, refresh in background
    const net = fetch(req).then(r => { if (r && r.status === 200) caches.open(CACHE).then(c => c.put(req, r.clone())); return r; }).catch(() => hit);
    return hit || net;
  }));
});
