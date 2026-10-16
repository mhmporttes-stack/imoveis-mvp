import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hasPropertyContactInput,
  isEmptyPropertyContact,
  normalizePropertyContact,
  propertyContactTypeLabel,
  rowToPropertyContact,
  uniquePropertyContacts,
  findPropertyContactByName
} from "../lib/property-contact-core.mjs";
import { INTERNAL_PROPERTY_FIELDS, redactInternalPropertyFields } from "../lib/property-visibility-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Contato do imóvel (dono, 2026-10-16): interno, só admin/gestor.
test("normaliza o contato e recusa tipo desconhecido", () => {
  assert.deepEqual(normalizePropertyContact({ contactName: " Ana ", contactPhone: " 14 99999-0000 ", contactType: "corretor" }),
    { contactName: "Ana", contactPhone: "14 99999-0000", contactType: "corretor" });
  assert.equal(normalizePropertyContact({ contactType: "vizinho" }).contactType, "");
  assert.deepEqual(rowToPropertyContact(null), { contactName: "", contactPhone: "", contactType: "" });
  assert.equal(rowToPropertyContact({ contact_type: "proprietario" }).contactType, "proprietario");
  assert.equal(propertyContactTypeLabel("proprietario"), "Proprietário");
  assert.ok(isEmptyPropertyContact({}));
  assert.ok(!isEmptyPropertyContact({ contactPhone: "1" }));
});

test("só grava o contato quando o formulário mandou os campos", () => {
  assert.equal(hasPropertyContactInput({ name: "Casa" }), false);
  assert.equal(hasPropertyContactInput({ contactName: "" }), true);
  assert.equal(hasPropertyContactInput(null), false);
});

test("corretor/associado não recebem o contato (redação no servidor)", () => {
  for (const field of ["contactName", "contactPhone", "contactType"]) assert.ok(INTERNAL_PROPERTY_FIELDS.includes(field));
  const redacted = redactInternalPropertyFields({ id: "1", contactName: "Ana", contactPhone: "14999990000", contactType: "corretor" }, false);
  assert.equal(redacted.contactName, "");
  assert.equal(redacted.contactPhone, "");
});

test("contato nunca entra no site público nem no imóvel genérico", () => {
  const publicSource = read("lib/public-properties.js");
  assert.doesNotMatch(publicSource, /property_contacts|contact_phone/);
  assert.match(publicSource, /const \{ internalNotes, createdByUserId, contactName, contactPhone, contactType, \.\.\.publicSafe \} = property;/);
  assert.doesNotMatch(read("lib/property-mapper.js"), /contact_/);
  const migration = read("supabase/migrations/20261016150000_property_contacts.sql");
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(migration, /create policy/i);
});

test("gravação do contato só nas rotas de admin/gestor", () => {
  assert.match(read("app/api/properties/[id]/route.js"), /requireFinancialManagerApi/);
  assert.match(read("app/api/properties/route.js"), /if \(canPublish && hasPropertyContactInput\(payload\)\)/);
});

test("autocomplete: contatos sem repetição e escolha pelo nome preenche telefone e tipo", () => {
  const list = uniquePropertyContacts([
    { contactName: "Ana", contactPhone: "(14) 99999-0000", contactType: "corretor" },
    { contactName: "ana", contactPhone: "14999990000", contactType: "corretor" },
    { contactName: "", contactPhone: "1", contactType: "" },
    { contactName: "Bruno", contactPhone: "14988887777", contactType: "proprietario" }
  ]);
  assert.equal(list.length, 2);
  assert.deepEqual(findPropertyContactByName(list, " bruno "), { contactName: "Bruno", contactPhone: "14988887777", contactType: "proprietario" });
  assert.equal(findPropertyContactByName(list, "Carla"), null);
  assert.match(read("app/api/admin/property-contacts/route.js"), /const auth = await requireFinancialManagerApi\(request\);/);
});
