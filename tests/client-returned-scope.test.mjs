// Cliente devolvido à fila depois de um disparo continua ACHÁVEL por quem
// disparou (2026-10-05). Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brokerClientScopeClause, clientAccessOwnerId } from "../lib/client-returned-scope-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const LINKED = "bbbbbbbb-0000-4000-8000-00000000000b";

test("cláusula: cliente do corretor OU devolvido à fila vindo dele (só sem responsável)", () => {
  assert.equal(
    brokerClientScopeClause([A]),
    `responsible_user_id.in.(${A}),and(responsible_user_id.is.null,returned_from_user_id.in.(${A}))`
  );
  const withLinked = brokerClientScopeClause([A, LINKED]);
  assert.ok(withLinked.includes(`responsible_user_id.in.(${A},${LINKED})`));
  assert.ok(withLinked.includes(`and(responsible_user_id.is.null,returned_from_user_id.in.(${A},${LINKED}))`));
  assert.equal(brokerClientScopeClause([]), "");
});

test("acesso a UM cliente: responsável; sem responsável, quem o tinha antes da devolução", () => {
  assert.equal(clientAccessOwnerId({ responsibleUserId: A, returnedFromUserId: LINKED }), A);
  assert.equal(clientAccessOwnerId({ responsibleUserId: "", returnedFromUserId: LINKED }), LINKED);
  assert.equal(clientAccessOwnerId({}), "");
});

test("lista: a busca por nome/telefone inclui o devolvido; as abas (sem busca) não mudam", () => {
  const code = read("lib/simulation-list-query.js");
  assert.match(code, /const searching = Boolean\(sanitizeFilterTerm\(filters\.query\)\)/);
  assert.match(code, /returnedFromColumn: searching \? "returned_from_user_id" : ""/);
  assert.match(code, /fetchPinnedClientItem[\s\S]{0,400}returnedFromColumn: "returned_from_user_id"/);
});

test("acesso à ficha/edição usa o dono da devolução; a coluna é lida", () => {
  const code = read("lib/simulation-registrations.js");
  assert.match(code, /assertCanAccessResponsibleUser\(auth, clientAccessOwnerId\(registration\)\)/);
  assert.match(code, /responsible_user_id, returned_from_user_id, phone_normalized/);
  assert.match(code, /returnedFromUserId: row\.returned_from_user_id \|\| ""/);
  assert.match(read("lib/admin-access.js"), /returnedFromColumn\) return query\.or\(brokerClientScopeClause/);
});

test("migration: coluna + gatilho cobrindo todos os caminhos de devolução + preenchimento retroativo", () => {
  const sql = read("supabase/migrations/20261005190000_client_returned_from_user.sql");
  assert.match(sql, /add column if not exists returned_from_user_id uuid/);
  assert.match(sql, /before update of responsible_user_id on public\.simulation_registrations/);
  assert.match(sql, /new\.status = 'awaiting_return'/);
  assert.match(sql, /new\.responsible_user_id is not null then\s+new\.returned_from_user_id := null/);
  assert.match(sql, /c\.status = 'recent_attempt'/);
});
