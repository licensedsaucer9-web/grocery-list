// Service worker. vite.config.ts fills in VERSION and PRECACHE at build time.
const VERSION = 'dev'; /*__BUILD_VERSION__*/
const PRECACHE = []; /*__PRECACHE__*/
const SHELL_CACHE = `grocery-list-shell-${VERSION}`;
// Not versioned: the last list.json must survive app updates.
const DATA_CACHE = 'grocery-list-data';

const scope = new URL(self.registration.scope);
const LIST_URL = new URL('list.json', scope).href;
const INDEX_URL = new URL('./', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('grocery-list-') && k !== SHELL_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// list.json: network first, fall back to the last copy on a network error or
// an HTTP error. Stored under the clean URL so cache-busting ?t= queries
// still update and hit it.
async function listFirstNetwork(request) {
  const cache = await caches.open(DATA_CACHE);
  let res;
  try {
    res = await fetch(request);
  } catch (err) {
    const fallback = await savedList(cache);
    if (!fallback) throw err;
    return fallback;
  }
  if (res.ok) {
    await cache.put(LIST_URL, res.clone());
    return res;
  }
  return (await savedList(cache)) ?? res;
}

async function savedList(cache) {
  const cached = await cache.match(LIST_URL);
  if (!cached) return undefined;
  // Mark it so the page can tell the user this is the saved copy.
  const headers = new Headers(cached.headers);
  headers.set('X-Grocery-Offline', '1');
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
}

async function shellCacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const key = request.mode === 'navigate' ? INDEX_URL : request;
  const cached = await cache.match(key, { ignoreSearch: request.mode === 'navigate' });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && request.mode !== 'navigate') await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.href.startsWith(scope.href)) return;
  if (url.origin + url.pathname === LIST_URL) {
    event.respondWith(listFirstNetwork(request));
  } else {
    event.respondWith(shellCacheFirst(request));
  }
});
