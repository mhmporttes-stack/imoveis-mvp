const CACHE_VERSION = "painel-matheus-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const STATIC_ASSETS = [
  "/offline.html",
  "/icons/favicon-32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/assets/matheus-machado-symbol-premium.png",
  "/assets/matheus-machado-logo-transparent.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => Promise.allSettled(STATIC_ASSETS.map((asset) => cache.add(asset))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isPrivateRoute(url.pathname)) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
  }
});

function isPrivateRoute(pathname) {
  return pathname.startsWith("/admin") || pathname.startsWith("/api");
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/offline.html"
  );
}

async function networkOnly(request) {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch {
    if (request.mode === "navigate") {
      const fallback = await caches.match("/offline.html");
      if (fallback) return fallback;
    }

    return new Response(JSON.stringify({ error: "Sem conexão." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match("/offline.html")) || Response.error();
  }
}
