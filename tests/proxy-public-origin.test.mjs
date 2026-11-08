import test from "node:test";
import assert from "node:assert/strict";
import { applyPublicOrigin } from "../lib/public-origin-core.mjs";

const h = (o) => new Headers(o);
test("sem MM_PRODUCTION_HOST não muda nada", () => {
  delete process.env.MM_PRODUCTION_HOST;
  const u = applyPublicOrigin(new URL("http://127.0.0.1:3000/admin/login"), h({ "x-forwarded-host": "a.com", "x-forwarded-proto": "https" }));
  assert.equal(u.href, "http://127.0.0.1:3000/admin/login");
});
test("com MM_PRODUCTION_HOST usa host e protocolo públicos", () => {
  process.env.MM_PRODUCTION_HOST = "1";
  const u = applyPublicOrigin(new URL("http://127.0.0.1:3000/admin/login"), h({ "x-forwarded-host": "www.matheusmachadoimoveis.com.br", "x-forwarded-proto": "https" }));
  assert.equal(u.href, "https://www.matheusmachadoimoveis.com.br/admin/login");
  const bad = applyPublicOrigin(new URL("http://127.0.0.1:3000/x"), h({ "x-forwarded-host": "evil.com/x@y" }));
  assert.equal(bad.host, "127.0.0.1:3000");
  delete process.env.MM_PRODUCTION_HOST;
});
