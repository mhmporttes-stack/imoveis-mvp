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
