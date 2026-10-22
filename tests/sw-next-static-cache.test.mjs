// Service worker (public/sw.js), etapa 2 de velocidade (2026-10-22): a publicação nova apaga os caches das versões
// antigas, mas mantém o cache sem versão de /_next/static/* (arquivos com hash no nome), com limite de entradas.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/sw.js"), "utf8");

function load(initialCaches) {
  const stores = new Map(Object.entries(initialCaches).map(([name, keys]) => [name, [...keys]]));
  const listeners = {};
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, []);
      const list = stores.get(name);
      return {
        keys: async () => [...list],
        delete: async (key) => { list.splice(list.indexOf(key), 1); return true; },
        put: async (request) => { list.push(request.url); }
      };
    },
    match: async () => undefined
  };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    clients: { claim: async () => {} },
    location: { origin: "https://example.test" },
    skipWaiting: () => {},
    navigator: {}
  };
  vm.runInNewContext(source, { self, caches, URL, Response, fetch: async () => ({ ok: true, clone() { return this; } }), Promise, console });
  const version = source.match(/CACHE_VERSION = "([^"]+)"/)[1];
  return { stores, listeners, version };
}

async function activate(listeners) {
  let done;
  listeners.activate({ waitUntil: (promise) => { done = promise; } });
  await done;
}

test("publicação nova: apaga caches antigos e mantém o de /_next/static", async () => {
  const { stores, listeners, version } = load({
    "painel-matheus-v4-antigo-static": ["/icons/icon-192-mm.png"],
    "painel-matheus-next-static": ["/_next/static/chunks/a.js"]
  });
  stores.set(`${version}-static`, []);
  await activate(listeners);
  assert.deepEqual([...stores.keys()].sort(), [`${version}-static`, "painel-matheus-next-static"].sort());
  assert.deepEqual(stores.get("painel-matheus-next-static"), ["/_next/static/chunks/a.js"]);
});

test("cache de /_next/static tem limite: saem os mais antigos", async () => {
  const many = Array.from({ length: 650 }, (_, i) => `/_next/static/chunks/${i}.js`);
  const { stores, listeners } = load({ "painel-matheus-next-static": many });
  await activate(listeners);
  const kept = stores.get("painel-matheus-next-static");
  assert.equal(kept.length, 600);
  assert.equal(kept[0], "/_next/static/chunks/50.js");
});

test("arquivo de /_next/static vai para o cache sem versão; ícone, para o versionado", async () => {
  const { stores, listeners, version } = load({});
  const respond = async (url) => {
    let result;
    listeners.fetch({ request: { method: "GET", url, mode: "no-cors" }, respondWith: (p) => { result = p; } });
    await result;
  };
  await respond("https://example.test/_next/static/chunks/b.js");
  await respond("https://example.test/icons/icon-192-mm.png");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stores.get("painel-matheus-next-static"), ["https://example.test/_next/static/chunks/b.js"]);
  assert.deepEqual(stores.get(`${version}-static`), ["https://example.test/icons/icon-192-mm.png"]);
});
