"use client";

// Mock de fetch da vitrine (somente `next dev`). Intercepta toda chamada a
// /api/** do próprio site e responde com as fixtures da tela — nenhuma
// requisição chega às APIs reais, ao Supabase, ao WhatsApp ou à Meta.
// Chamadas sem fixture recebem um corpo vazio e um aviso no console.

let activeRoutes = [];
let mode = "normal"; // normal | carregando | erro
let realFetch = null;

const NEVER = new Promise(() => {});

function resolveUrl(input) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
  return new URL(raw, window.location.origin);
}

async function mockFetch(input, init = {}) {
  const url = resolveUrl(input);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    return realFetch(input, init);
  }

  const method = String(init.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
  const target = `${url.pathname}${url.search}`;

  if (mode === "carregando") return NEVER;
  if (mode === "erro") {
    await wait(200);
    return json({ error: "Erro simulado pela vitrine (estado=erro)." }, 500);
  }

  const route = activeRoutes.find((item) => (item.method || "GET").toUpperCase() === method && item.match.test(target));
  if (!route) {
    console.warn(`[vitrine] sem fixture para ${method} ${target}`);
    await wait(120);
    return json(method === "GET" ? {} : { ok: true });
  }

  const body = typeof route.response === "function" ? await route.response({ url, init, method }) : route.response;
  await wait(route.delay ?? 180);
  return json(body ?? {}, route.status || 200);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function installMockFetch(routes, nextMode = "normal") {
  if (typeof window === "undefined") return;
  activeRoutes = routes;
  mode = nextMode;
  if (!realFetch) {
    realFetch = window.fetch.bind(window);
    window.fetch = mockFetch;
  }
}
