/* Coastal Trip Hub service worker. BUILD must match HUB_BUILD in index.html. */
const BUILD = '20260925-2004';
const CACHE = 'coastal-hub-' + BUILD;
const PRECACHE = [
  './',
  './index.html',
  './hub-version.json',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './assets/anastasia.jpg',
  './assets/edisto.jpg',
  './assets/georgetown.jpg',
  './assets/carolina.jpg',
  './assets/hammocks.jpg',
  './assets/frisco.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isVersion(url) {
  return url.pathname.endsWith('/hub-version.json');
}

function isPage(url, request) {
  if (request.mode === 'navigate') return true;
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

function pageRequest() {
  return new Request(new URL('./index.html', self.registration.scope).href);
}

async function networkFirst(request, cacheRequest) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(cacheRequest || request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(cacheRequest || request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheRequest) {
  const cache = await caches.open(CACHE);
  const key = cacheRequest || request;
  const cached = await cache.match(key);
  const refresh = fetch(request).then((res) => {
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  }).catch(() => cached);
  return cached || refresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (isVersion(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isPage(url, request)) {
    const key = pageRequest();
    if (url.searchParams.has('v')) {
      event.respondWith(networkFirst(request, key));
    } else {
      event.respondWith(staleWhileRevalidate(request, key));
    }
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
