/* =========================================================================
   Service worker — supaya aplikasi tetap terbuka tanpa internet.
   Strategi: network-first untuk berkas aplikasi (selalu dapat versi terbaru
   saat online), jatuh ke cache kalau offline. Firebase & CDN tidak di-cache.
   Naikkan VERSI setiap kali menerbitkan perubahan besar.
   ========================================================================= */
const VERSI = 'lovepet-v30';
const ISI = [
  './',
  './index.html',
  './lapor.html',
  './css/styles.css',
  './css/lapor.css',
  './js/data.js',
  './js/app.js',
  './js/cloud.js',
  './js/provisioning.js',
  './js/lapor.js',
  './js/slip-render.js',
  './js/slip-terbit.js',
  './js/kasbon.js',
  './js/published.js',
  './js/chat.js',
  './js/ayat.js',
  './js/neraca.js',
  './js/jurnal.js',
  './js/firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSI)
      .then((c) => Promise.allSettled(ISI.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((n) => n !== VERSI).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Firebase/CDN: biarkan lewat

  e.respondWith(
    fetch(req)
      .then((res) => {
        const salinan = res.clone();
        caches.open(VERSI).then((c) => c.put(req, salinan)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
  );
});
