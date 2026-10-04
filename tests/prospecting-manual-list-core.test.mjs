// "Imprimir lista" da Prospecção (2026-10-04): regras puras (formatação, tolerância à migration pendente,
// exclusão de reservados, escopo, nome de arquivo). Dados 100% fictícios.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MANUAL_LIST_NOT_ENABLED_MESSAGE,
  MANUAL_LIST_SIZE,
  contactCountLabel,
  formatDateSaoPaulo,
  formatDateTimeSaoPaulo,
  formatListPhone,
  isMissingManualListSchemaError,
  manualListBrokerScope,
  manualListFileName,
  manualListHttpError,
  manualListRpcErrorInfo,
  normalizeRequestKey,
  reservedContactIdsAmong,
  toWinAnsiSafe,
  truncateToWidth,
  withoutReservedContacts
} from "../lib/prospecting-manual-list-core.mjs";

test("tamanho da lista é 30", () => assert.equal(MANUAL_LIST_SIZE, 30));

test("telefone: E.164 do banco vira (DDD) 9XXXX-XXXX; 8 dígitos também; fora do padrão não inventa DDD", () => {
  assert.equal(formatListPhone("+5514999998888"), "(14) 99999-8888");
  assert.equal(formatListPhone("5514999998888"), "(14) 99999-8888");
  assert.equal(formatListPhone("14999998888"), "(14) 99999-8888");
  assert.equal(formatListPhone("+551433334444"), "(14) 3333-4444");
  assert.equal(formatListPhone("1433334444"), "(14) 3333-4444");
  assert.equal(formatListPhone("+14155550123"), "14155550123");
  assert.equal(formatListPhone(""), "");
  assert.equal(formatListPhone(null), "");
});

test("texto do PDF: mantém acentos do português e descarta o que a fonte padrão não desenha", () => {
  assert.equal(toWinAnsiSafe("José Antônio da Conceição Ângela Érica Müller"), "José Antônio da Conceição Ângela Érica Müller");
  assert.equal(toWinAnsiSafe("Bruno 😀 Henrique"), "Bruno Henrique");
  assert.equal(toWinAnsiSafe("Ćiro Petrović"), "Ciro Petrovic");
  assert.equal(toWinAnsiSafe("A​B\tC\nD"), "AB C D");
  assert.equal(toWinAnsiSafe("日本語"), "");
  assert.equal(toWinAnsiSafe(undefined), "");
  assert.equal(toWinAnsiSafe("“aspas” – traço …"), "“aspas” – traço …");
});

test("nome longo é cortado com reticências sem passar da largura; nome curto fica igual", () => {
  const measure = (t) => t.length * 6;
  const out = truncateToWidth("José Antônio Ferreira Nogueira Albuquerque Cavalcanti", 150, measure);
  assert.ok(out.endsWith("…"));
  assert.ok(measure(out) <= 150);
  assert.equal(truncateToWidth("Lu", 150, measure), "Lu");
  assert.equal(truncateToWidth("Qualquer", 1, measure), "…");
});

test("tolerância à migration pendente: só os objetos da lista manual contam como 'ainda não ativado'", () => {
  assert.equal(isMissingManualListSchemaError({ code: "42P01", message: 'relation "public.prospecting_manual_list_items" does not exist' }), true);
  assert.equal(isMissingManualListSchemaError({ code: "PGRST205", message: "Could not find the table 'public.prospecting_manual_list_items' in the schema cache" }), true);
  assert.equal(isMissingManualListSchemaError({ code: "PGRST202", message: "Could not find the function public.create_prospecting_manual_list(...) in the schema cache" }), true);
  assert.equal(isMissingManualListSchemaError({ code: "42883", message: "function public.create_prospecting_manual_list does not exist" }), true);
  // outra tabela faltando NÃO é mascarada
  assert.equal(isMissingManualListSchemaError({ code: "42P01", message: 'relation "public.outra_tabela" does not exist' }), false);
  assert.equal(isMissingManualListSchemaError({ code: "23505", message: "duplicate key value violates unique constraint" }), false);
  assert.equal(isMissingManualListSchemaError(null), false);
});

test("erros do RPC viram status e texto em português", () => {
  assert.deepEqual(manualListRpcErrorInfo({ message: "MANUAL_LIST_NO_CONTACTS" }), { status: 409, message: "Não há contatos elegíveis disponíveis agora para montar uma lista." });
  assert.equal(manualListRpcErrorInfo({ message: "MANUAL_LIST_BROKER_INVALID" }).status, 400);
  assert.deepEqual(manualListRpcErrorInfo({ code: "PGRST202", message: "Could not find the function public.create_prospecting_manual_list" }), { status: 503, message: MANUAL_LIST_NOT_ENABLED_MESSAGE });
  assert.equal(manualListRpcErrorInfo({ message: "algo inesperado" }), null);
});

test("contatos reservados saem da lista de qualquer seletor em JavaScript; sem reservados nada muda", () => {
  const contacts = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(withoutReservedContacts(contacts, new Set(["b"])).map((c) => c.id), ["a", "c"]);
  assert.equal(withoutReservedContacts(contacts, new Set()), contacts);
  assert.equal(withoutReservedContacts(contacts, undefined), contacts);
  assert.deepEqual(reservedContactIdsAmong(["a", "b", "x"], new Set(["b", "x"])), ["b", "x"]);
  assert.deepEqual(reservedContactIdsAmong(["a"], new Set()), []);
});

test("escopo: admin vê tudo; gestor só a equipe; corretor/associado nada", () => {
  assert.deepEqual(manualListBrokerScope({ isGeneralAdmin: true }), { all: true, ids: null });
  assert.deepEqual(manualListBrokerScope({ isManager: true, managedUserIds: ["g", "c1"], profileId: "g" }).ids.sort(), ["c1", "g"]);
  assert.equal(manualListBrokerScope({ isManager: true, managedUserIds: ["g"], profileId: "g" }).all, false);
  assert.deepEqual(manualListBrokerScope({ profileId: "c1" }), { all: false, ids: [] });
});

test("nome do arquivo, rótulos, datas em São Paulo", () => {
  assert.equal(manualListFileName(12, "Jennyfer Cristina da Silva"), "lista-prospeccao-12-jennyfer-cristina-da-silva.pdf");
  assert.equal(manualListFileName(3, "Ângela / Ribeiro"), "lista-prospeccao-3-angela-ribeiro.pdf");
  assert.equal(manualListFileName(7, ""), "lista-prospeccao-7.pdf");
  assert.equal(contactCountLabel(30), "30 contatos para prospecção");
  assert.equal(contactCountLabel(1), "1 contato para prospecção");
  // 2026-10-05 01:30 UTC = 04/10/2026 22:30 em São Paulo (UTC-3): a data é a de São Paulo
  assert.equal(formatDateSaoPaulo("2026-10-05T01:30:00Z"), "04/10/2026");
  assert.equal(formatDateTimeSaoPaulo("2026-10-05T01:30:00Z"), "04/10/2026 22:30");
  assert.equal(formatDateSaoPaulo("lixo"), "");
});

test("chave de idempotência: só caracteres seguros e tamanho razoável", () => {
  assert.equal(normalizeRequestKey("123e4567-e89b-12d3-a456-426614174000"), "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(normalizeRequestKey(" abc "), "");
  assert.equal(normalizeRequestKey("com espaço aqui!"), "");
  assert.equal(normalizeRequestKey(undefined), "");
  assert.equal(normalizeRequestKey("x".repeat(81)), "");
});

test("resposta HTTP de erro: mensagem de negócio aparece; erro desconhecido vira texto genérico e é registrado", () => {
  assert.deepEqual(manualListHttpError(Object.assign(new Error("Recurso ainda não ativado no banco."), { name: "ManualListError", status: 503 }), "x"), { status: 503, message: "Recurso ainda não ativado no banco.", log: false });
  assert.deepEqual(manualListHttpError(Object.assign(new Error("Acesso negado."), { status: 403 }), "x"), { status: 403, message: "Acesso negado.", log: false });
  assert.deepEqual(manualListHttpError(new Error('duplicate key (contact_id)=(abc)'), "Não foi possível."), { status: 500, message: "Não foi possível.", log: true });
});
