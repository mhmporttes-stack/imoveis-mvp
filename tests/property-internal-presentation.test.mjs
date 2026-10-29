import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("'Abrir' de imóvel no CRM vai para a apresentação interna, com 'Ver no site' secundário", () => {
  const list = read("components/AdminPropertyList.jsx");
  assert.match(list, /href=\{`\/admin\/imoveis\/\$\{property\.id\}`\}>Abrir</);
  assert.match(list, /"Ver no site"/);
});

test("apresentação interna exige login e redige campos internos por perfil no servidor", () => {
  const page = read("app/admin/imoveis/[id]/page.jsx");
  assert.match(page, /await requireAdminPage\(\)/);
  assert.match(page, /redactPropertyForAuth\(/);
  assert.match(page, /canViewInternalPropertyFields\(auth\) \? await getPropertyContact/);
});

test("payload público nunca leva campos internos nem contato", () => {
  const pub = read("lib/public-properties.js");
  assert.match(pub, /const \{ internalNotes, createdByUserId, contactName, contactPhone, contactType, exclusivity, fullAddress, documents, \.\.\.publicSafe \}/);
  assert.doesNotMatch(pub, /\.from\("property_contacts"\)/);
});

test("campos internos novos (2026-10-29): todos os perfis logados veem; sem login, nada; sem comissão", async () => {
  const { INTERNAL_PROPERTY_FIELDS, redactInternalPropertyFields } = await import("../lib/property-visibility-core.mjs");
  for (const field of ["exclusivity", "fullAddress", "documents"]) assert.ok(INTERNAL_PROPERTY_FIELDS.includes(field));
  const redacted = redactInternalPropertyFields({ exclusivity: "Sim", fullAddress: "Rua X, 1", documents: [{ url: "https://x/a.pdf" }] }, false);
  assert.equal(redacted.fullAddress, "");
  assert.deepEqual(redacted.documents, []);
  assert.match(read("lib/property-visibility.js"), /return Boolean\(auth && auth\.profile\);/);
  const migration = read("supabase/migrations/20261029180000_property_internal_fields.sql");
  assert.match(migration, /add column if not exists full_address/);
  assert.doesNotMatch(migration + read("lib/property-mapper.js"), /commission/i);
});
