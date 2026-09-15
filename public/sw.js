// O sufixo depois de "v4-" é reescrito a cada build (scripts/stamp-service-worker.mjs,
// rodado via "prebuild") só para os BYTES deste arquivo mudarem a cada deploy —
// sem isso, um deploy que só muda código do app (sem tocar neste arquivo) nunca
// muda o sw.js, o navegador nunca detecta atualização, e o aviso de "nova versão
// disponível" (components/PwaLifecycle.jsx) nunca aparece. Bônus: cada build
// também ganha um cache novo de verdade (o cleanup do "activate" abaixo já
// apaga o anterior), em vez de depender de alguém lembrar de bumpar "v4" à mão.
const CACHE_VERSION = "painel-matheus-v4-mu35k3m0";
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
  self.skipWaiting();
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

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Painel Matheus";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/admin/simulacoes" },
    tag: data.tag || undefined
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || "/admin/simulacoes";
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      const exact = clientsList.find((client) => client.url === targetUrl);
      if (exact && "focus" in exact) return exact.focus();

      // O app já pode estar aberto (PWA em modo standalone) em outra página —
      // clients.openWindow() não navega de forma confiável uma janela
      // standalone já aberta em alguns navegadores, então navegamos essa
      // janela explicitamente em vez de só focar (o que deixava o app parado
      // na tela em que já estava, parecendo abrir "o painel inicial").
      const reusable = clientsList.find((client) => "navigate" in client && "focus" in client);
      if (reusable) {
        await reusable.navigate(targetUrl);
        return reusable.focus();
      }

      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })()
  );
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
