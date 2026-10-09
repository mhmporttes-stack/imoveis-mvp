// "CadastroCRM": evento só do servidor, depois do cadastro novo gravado (pedido do dono, 2026-10-08) — o "Lead" da Meta
// vinha inflado por eventos que não eram cadastro.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("CadastroCRM vai junto do Lead na Conversions API, com event_id próprio", () => {
  const capi = read("lib/meta-conversions-api.js");
  assert.match(capi, /export const CRM_REGISTRATION_EVENT = "CadastroCRM";/);
  assert.match(capi, /event_name: CRM_REGISTRATION_EVENT, event_id: eventId \? `\$\{eventId\}-crm` : undefined/);
  assert.match(capi, /data: \[event, crmEvent\]/);
});

test("nunca sai do navegador e só dispara depois do cadastro NOVO gravado", () => {
  assert.doesNotMatch(read("lib/meta-pixel-client.js"), /CadastroCRM/);
  const reg = read("lib/simulation-registrations.js");
  assert.match(reg, /\.insert\(registrationToRecord\(registrationData\)\)[\s\S]{0,400}fireMetaLeadEvent\(/);
});

test("qualidade da correspondência: fbp/fbc, nome e id externo vão no evento (2026-10-09)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/meta-conversions-api.js", import.meta.url), "utf8");
  for (const piece of ["userData.fbp = fbp", "userData.fbc = fbc", "userData.fn = [sha256Hex(fn)]", "userData.ln = [sha256Hex(ln)]", "userData.external_id"]) {
    assert.ok(src.includes(piece), piece);
  }
  const reg = readFileSync(new URL("../lib/simulation-registrations.js", import.meta.url), "utf8");
  assert.ok(reg.includes("fbp: requestMetadata.fbp") && reg.includes("fbc: requestMetadata.fbc"));
  assert.equal((reg.match(/externalId: registration\.id/g) || []).length, 2);
});
