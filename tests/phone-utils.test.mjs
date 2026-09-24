import test from "node:test";
import assert from "node:assert/strict";
import { canonicalWhatsappPhone, isSamePhone, phoneComparisonKey, phoneLookupCandidates } from "../lib/phone-utils.js";

test("celular com e sem o 9º dígito viram o mesmo número canônico", () => {
  assert.equal(canonicalWhatsappPhone("5514991099548"), "+5514991099548");
  assert.equal(canonicalWhatsappPhone("551491099548"), "+5514991099548");
  assert.equal(canonicalWhatsappPhone("+55 (14) 99109-9548"), "+5514991099548");
  assert.equal(canonicalWhatsappPhone("14991099548"), "+5514991099548");
  assert.equal(canonicalWhatsappPhone("1491099548"), "+5514991099548");
});

test("isSamePhone ignora 9º dígito, +55 e máscara", () => {
  assert.ok(isSamePhone("5514991099548", "551491099548"));
  assert.ok(isSamePhone("+5514991099548", "(14) 99109-9548"));
  assert.ok(isSamePhone("14996209599", "+5514996209599"));
  assert.ok(!isSamePhone("5514991099548", "5514991099549"));
  assert.ok(!isSamePhone("5514991099548", "5511991099548"));
  assert.ok(!isSamePhone("", ""));
});

test("fixo nunca colide com celular que tem os mesmos 8 últimos dígitos", () => {
  // celular 14 9 3322-1234 x fixo 14 3322-1234
  assert.notEqual(phoneComparisonKey("14933221234"), phoneComparisonKey("1433221234"));
  assert.ok(!isSamePhone("+5514933221234", "+551433221234"));
  assert.equal(canonicalWhatsappPhone("551433221234"), "+551433221234");
});

test("número de fora do Brasil só ganha o +", () => {
  assert.equal(canonicalWhatsappPhone("14155550123"), "+14155550123");
  assert.equal(canonicalWhatsappPhone("447911123456"), "+447911123456");
  assert.equal(canonicalWhatsappPhone(""), "");
});

test("candidatos de busca cobrem todas as formas gravadas (com/sem 9, E.164/dígitos/nacional)", () => {
  const candidates = phoneLookupCandidates("551491099548");
  for (const expected of ["+5514991099548", "5514991099548", "14991099548", "+551491099548", "551491099548", "1491099548"]) {
    assert.ok(candidates.includes(expected), `faltou ${expected}`);
  }
  const fromNine = phoneLookupCandidates("+5514991099548");
  for (const expected of ["+551491099548", "1491099548", "14991099548"]) assert.ok(fromNine.includes(expected));
  assert.deepEqual(phoneLookupCandidates(""), []);
});
