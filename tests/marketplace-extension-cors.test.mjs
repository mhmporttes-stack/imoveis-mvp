// CORS da extensão do Marketplace (2026-10-26): o Chrome aplicou CORS aos pedidos da extensão e o preflight sem
// Access-Control-Allow-Origin derrubava a sincronização ("Failed to fetch"). Só /api/marketplace/* e só chrome-extension://.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extensionCorsHeaders } from "../lib/extension-cors-core.mjs";

const EXT = "chrome-extension://ngkmnlnepbbgnajigebfmdoihiicaplm";

test("extensão em /api/marketplace/* recebe Allow-Origin, cabeçalhos da chave e nenhuma credencial", () => {
  const headers = extensionCorsHeaders("/api/marketplace/chat/sync", EXT);
  assert.equal(headers["Access-Control-Allow-Origin"], EXT);
  assert.match(headers["Access-Control-Allow-Headers"], /Authorization/);
  assert.match(headers["Access-Control-Allow-Headers"], /X-Extension-Version/);
  assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
});

test("outras origens e outras rotas não ganham CORS", () => {
  assert.equal(extensionCorsHeaders("/api/marketplace/chat/sync", "https://evil.example"), null);
  assert.equal(extensionCorsHeaders("/api/marketplace/chat/sync", ""), null);
  assert.equal(extensionCorsHeaders("/api/admin/henry", EXT), null);
});

test("proxy responde o preflight (204) e aplica os cabeçalhos antes de qualquer outra regra", () => {
  const source = readFileSync(new URL("../proxy.js", import.meta.url), "utf8");
  assert.match(source, /extensionCorsHeaders\(pathname, request\.headers\.get\("origin"\)\)/);
  assert.match(source, /request\.method === "OPTIONS"\) return new NextResponse\(null, \{ status: 204/);
});
