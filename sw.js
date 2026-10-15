/* CarScout service worker: lets the app install and open offline (the shell only; prices always come live)
   and shows phone notifications for "Find me a car". */
const CACHE = 'carscout-shell-v8';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // never touch the worker API or fonts
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (r) { const cp = r.clone(); caches.open(CACHE).then(function (c) { c.put('index.html', cp); }); return r; })
      .catch(function () { return caches.match('index.html'); }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (r) { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); } return r; });
  }));
});

/* "Find me a car": the server sends an empty push; the message itself is read from the server inbox */
const API = 'https://carscout.pmax70095.workers.dev';
self.addEventListener('push', function (e) {
  e.waitUntil(self.registration.pushManager.getSubscription().then(function (s) {
    return fetch(API + '/api/push/inbox', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ ep: s ? s.endpoint : '' }) }).then(function (r) { return r.json(); });
  }).catch(function () { return null; }).then(function (j) {
    const items = (j && j.items) || [];
    if (!items.length) return self.registration.showNotification('CarScout', { body: 'Появились новые машины по вашей заявке / New cars for your search', icon: 'icon-192.png', tag: 'carscout-find', data: { url: './?find=1' } });
    return Promise.all(items.slice(0, 3).map(function (x) {
      const o = { body: x.body || '', icon: 'icon-192.png', tag: x.tag || 'carscout-find', renotify: true, data: { url: x.url ? './?url=' + encodeURIComponent(x.url) : './?find=1' } };
      if (x.img) o.image = API + '/api/img?url=' + encodeURIComponent(x.img);
      return self.registration.showNotification(x.title || 'CarScout', o);
    }));
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (const c of cs) { if (c.url.indexOf(self.registration.scope) === 0 && 'navigate' in c) return c.navigate(url).then(function (w) { return (w || c).focus(); }).catch(function () { return self.clients.openWindow(url); }); }
    return self.clients.openWindow(url);
  }));
});
