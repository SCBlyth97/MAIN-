/* ============================================================
   Deutsch — sw.js
   Minimal service worker for offline support.
   Uses a cache-first strategy for static assets,
   network-first for words.json so updates propagate.
   ============================================================ */

'use strict';

// Bump this version on every deploy that changes the app shell (index.html,
// app.js, style.css). Changing the name forces a fresh install + the activate
// handler below deletes every old cache, so stale assets can never be served.
const CACHE_NAME = 'deutsch-v2';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
  // words.json is NOT pre-cached here — it's fetched network-first at runtime
  // so you can update the word list without bumping the SW version.
];

// ─────────────────────────────────────────────
// INSTALL — cache static shell
// ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────
// ACTIVATE — remove old caches
// ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────
// FETCH — serve from cache with network fallback
// ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests within the same origin
  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // words.json: network-first so word updates reach users quickly
  if (url.pathname.endsWith('words.json')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Everything else: cache-first
  event.respondWith(cacheFirst(event.request));
});

// ─────────────────────────────────────────────
// STRATEGIES
// ─────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not in cache — return a simple offline page for navigation
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline: fall back to a previously cached copy if we have one.
    // Do NOT fabricate an empty '[]' body — that used to masquerade as a
    // valid (but empty) word list and tripped the "Could not load words"
    // error screen. A real 503 lets the app show an honest offline message.
    const cached = await caches.match(request);
    return cached || new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}
