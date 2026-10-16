// Defeito corrigido em 2026-10-16 (Mesa WhatsApp dos corretores): o CSV do Disparo Oficial também bloqueia telefone com
// "Não contactar" no CADASTRO do cliente (simulation_registrations), não só na fila de prospecção. Checagem de código.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../lib/whatsapp-broadcasts.js", import.meta.url), "utf8");

test("CSV do Disparo: opt-out lido da prospecção E do cadastro do cliente, pelos mesmos formatos de telefone", () => {
  const start = code.indexOf("async function resolveCsvRecipients");
  const body = code.slice(start, code.indexOf("/* -------------------------------- Preview", start));
  assert.match(body, /from\("prospecting_contacts"\)\.select\("phone_normalized"\)\.eq\("status", DO_NOT_CONTACT_STATUS\)\.in\("phone_normalized", phones\)/);
  assert.match(body, /from\("simulation_registrations"\)\.select\("phone_normalized"\)\.eq\("status", DO_NOT_CONTACT_STATUS\)\.in\("phone_normalized", phones\)/);
  assert.match(body, /if \(registrationsResult\.error\) throw registrationsResult\.error;/, "erro de leitura não libera o envio");
  assert.match(body, /\.\.\.\(registrationsResult\.data \|\| \[\]\)/, "bloqueados do cadastro entram no mesmo conjunto");
  assert.match(code, /import \{ DO_NOT_CONTACT_STATUS \} from "\.\/do-not-contact-core\.mjs";/);
});
