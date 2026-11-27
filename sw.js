/* Service worker: lưu sẵn file để app chạy offline.
   Có mạng: luôn lấy bản MỚI NHẤT từ GitHub (nên cập nhật code là máy tự nhận).
   Mất mạng: dùng bản đã lưu. Khi sửa code, đổi số phiên bản CACHE (v7 -> v8). */
const CACHE = 'mechivas-v7';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'manifest.json', 'qr.png',
  'lib/html2canvas.min.js', 'lib/jspdf.umd.min.js', 'lib/exceljs.min.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: 'reload' }))))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache' })
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
