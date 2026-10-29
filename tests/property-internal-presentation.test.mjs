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
  assert.match(pub, /const \{ internalNotes, createdByUserId, contactName, contactPhone, contactType, \.\.\.publicSafe \}/);
  assert.doesNotMatch(pub, /\.from\("property_contacts"\)/);
});
