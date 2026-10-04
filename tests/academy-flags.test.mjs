import test from "node:test";
import assert from "node:assert/strict";
import { isAcademyEnabled, ACADEMY_ENABLED_ENV } from "../lib/academy-flags.js";
import { withAcademyMenuGroup, ACADEMY_MENU_GROUP } from "../lib/academy-menu.mjs";

test("nome da chave", () => assert.equal(ACADEMY_ENABLED_ENV, "ACADEMIA_ENABLED"));

test("padrão desligado: ausente, vazio e valores desconhecidos", () => {
  for (const v of [undefined, "", " ", "0", "false", "off", "yes", "2", "sim"]) {
    assert.equal(isAcademyEnabled({ ACADEMIA_ENABLED: v }), false, String(v));
  }
  assert.equal(isAcademyEnabled({}), false);
});

test('"1", "true" e "on" ligam (sem diferenciar maiúsculas)', () => {
  for (const v of ["1", "true", "on", "TRUE", "On", " 1 "]) {
    assert.equal(isAcademyEnabled({ ACADEMIA_ENABLED: v }), true, v);
  }
});

test("lido em tempo de chamada (process.env)", () => {
  const prev = process.env.ACADEMIA_ENABLED;
  try {
    delete process.env.ACADEMIA_ENABLED;
    assert.equal(isAcademyEnabled(), false);
    process.env.ACADEMIA_ENABLED = "1";
    assert.equal(isAcademyEnabled(), true);
    process.env.ACADEMIA_ENABLED = "0";
    assert.equal(isAcademyEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.ACADEMIA_ENABLED;
    else process.env.ACADEMIA_ENABLED = prev;
  }
});

test("menu: grupo Academia só aparece com a chave ligada", () => {
  const groups = [{ key: "crm", items: [] }];
  assert.equal(withAcademyMenuGroup(groups, false), groups);
  assert.equal(withAcademyMenuGroup(groups), groups);
  const on = withAcademyMenuGroup(groups, true);
  assert.equal(on.length, 2);
  assert.equal(on[1], ACADEMY_MENU_GROUP);
  assert.equal(on[1].items[0].href, "/academia");
  assert.equal(groups.length, 1);
});
