// Cliente frio transferido e sem retorno -> arquivado sozinho, aba só do dono (FUN-15q, REGRA OFICIAL — dono, 2026-11-09).
// Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLIENT_STATUS, NEGATIVE_CLIENT_STATUS_VALUES } from "../lib/client-status.js";
import {
  COOLED_ARCHIVE_BATCH,
  COOLED_ARCHIVE_REASON,
  COOLED_ARCHIVE_SOURCE,
  COOLED_ARCHIVE_TAG,
  applyCooledArchiveExclusion,
  canSeeCooledTransferArchive,
  cooledTransferArchiveBlockReason,
  intersectIds,
  isCooledTransferArchiveCandidate,
  maskPhone
} from "../lib/cooled-transfer-archive-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-09T15:00:00.000Z");
const ago = (days) => new Date(NOW - days * DAY).toISOString();

// Cliente transferido há 10 dias, hoje com outro corretor, sem nada depois da transferência.
function input(overrides = {}) {
  const { client, cases, ...rest } = overrides;
  return {
    client: {
      status: CLIENT_STATUS.IN_SERVICE,
      privateContactAt: null,
      responsibleUserId: "novo",
      responsibleChangedAt: ago(10),
      pendingDistributionAt: null,
      lastWhatsappContactAt: ago(12),
      createdAt: ago(60),
      approvedAt: null,
      lastStatusChangeAt: ago(12),
      hasRestrictionTag: false,
      restrictionClosedAt: null,
      ...client
    },
    cases: cases || [{ decision: "transferred", transferred_to: "novo", broker_id: "original", decided_at: ago(10), reactivation_status: "left" }],
    now: NOW,
    ...rest
  };
}

test("candidato: transferido, com o novo corretor, 3+ dias sem atendimento e sem troca recente", () => {
  assert.equal(cooledTransferArchiveBlockReason(input()), null);
  assert.equal(isCooledTransferArchiveCandidate(input()), true);
});

test("candidato: caso identificado só por transferred_to (sem decision) e de volta com o dono", () => {
  assert.equal(isCooledTransferArchiveCandidate(input({ cases: [{ decision: null, transferred_to: "novo", broker_id: "original", decided_at: ago(10) }] })), true);
  assert.equal(isCooledTransferArchiveCandidate(input({ client: { responsibleUserId: "dono" } })), true);
});

test("fora: nunca transferido pelo FUN-15 (inclusive cliente do dono) e outras decisões", () => {
  assert.equal(cooledTransferArchiveBlockReason(input({ cases: [] })), "nunca_transferido");
  assert.equal(cooledTransferArchiveBlockReason(input({ cases: [{ decision: "status", broker_id: "original", decided_at: ago(10) }] })), "nunca_transferido");
  assert.equal(cooledTransferArchiveBlockReason(input({ cases: [{ decision: "second_chance", broker_id: "original", decided_at: ago(10) }] })), "nunca_transferido");
});

test("fora: ainda com o corretor original do caso (ou sem responsável)", () => {
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { responsibleUserId: "original" } })), "com_corretor_original");
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { responsibleUserId: "" } })), "sem_responsavel");
});

test("fora: arquivado, Não contactar e todos os negativos", () => {
  for (const status of NEGATIVE_CLIENT_STATUS_VALUES) {
    assert.equal(cooledTransferArchiveBlockReason(input({ client: { status } })), "arquivado_ou_negativo", status);
  }
});

test("fora: Particular, restrição (status, etiqueta e encerramento por texto)", () => {
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { privateContactAt: ago(5) } })), "particular");
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { hasRestrictionTag: true } })), "restricao");
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { restrictionClosedAt: ago(9), lastStatusChangeAt: ago(12) } })), "restricao");
});

test("fora: venda, Aprovado em diante e quem já foi aprovado alguma vez", () => {
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { status: CLIENT_STATUS.APPROVED } })), "ja_aprovado");
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { status: CLIENT_STATUS.SALE_PAID } })), "ja_aprovado");
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { approvedAt: ago(40) } })), "ja_aprovado");
  assert.equal(cooledTransferArchiveBlockReason(input({ historyRows: [{ previous_status: CLIENT_STATUS.APPROVED, new_status: CLIENT_STATUS.IN_SERVICE }] })), "ja_aprovado");
});

test("fora: na fila de reativação (aguardando ou entregue) e na fila da roleta", () => {
  for (const reactivation_status of ["queued", "offered"]) {
    assert.equal(cooledTransferArchiveBlockReason(input({ cases: [{ decision: "transferred", broker_id: "original", decided_at: ago(10), reactivation_status }] })), "na_fila_de_reativacao");
  }
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { pendingDistributionAt: ago(1) } })), "na_fila_da_roleta");
  // kept/left/null não seguram.
  assert.equal(isCooledTransferArchiveCandidate(input({ cases: [{ decision: "transferred", broker_id: "original", decided_at: ago(10), reactivation_status: "kept" }] })), true);
});

test("fora: atividade futura agendada", () => {
  assert.equal(cooledTransferArchiveBlockReason(input({ latestActivityAt: new Date(NOW + DAY).toISOString() })), "atividade_futura");
  assert.equal(isCooledTransferArchiveCandidate(input({ latestActivityAt: ago(2) })), true);
});

test("fora: cliente que respondeu/escreveu depois da transferência (antes dela não conta)", () => {
  assert.equal(cooledTransferArchiveBlockReason(input({ clientRepliedAt: ago(8) })), "cliente_respondeu");
  assert.equal(isCooledTransferArchiveCandidate(input({ clientRepliedAt: ago(30) })), true);
});

test("relógio da troca de responsável: mais de 3 dias (exatamente 3 não vale; sem o campo usa a decisão)", () => {
  assert.equal(isCooledTransferArchiveCandidate(input({ client: { responsibleChangedAt: new Date(NOW - 3 * DAY - 1000).toISOString() }, cases: [{ decision: "transferred", broker_id: "original", decided_at: ago(10) }] })), true);
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { responsibleChangedAt: new Date(NOW - 3 * DAY).toISOString() } })), "troca_recente");
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { responsibleChangedAt: ago(2) } })), "troca_recente");
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { responsibleChangedAt: null }, cases: [{ decision: "transferred", broker_id: "original", decided_at: ago(2) }] })), "troca_recente");
  assert.equal(isCooledTransferArchiveCandidate(input({ client: { responsibleChangedAt: null } })), true);
});

test("relógio do atendimento: contato gravado, atendimento calculado (fonte única) e cadastro, mais de 3 dias", () => {
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { lastWhatsappContactAt: ago(2) } })), "atendimento_recente");
  assert.equal(cooledTransferArchiveBlockReason(input({ lastAttendanceAt: ago(1) })), "atendimento_recente");
  assert.equal(cooledTransferArchiveBlockReason(input({ lastAttendanceAt: new Date(NOW - 3 * DAY).toISOString() })), "atendimento_recente");
  assert.equal(isCooledTransferArchiveCandidate(input({ lastAttendanceAt: new Date(NOW - 3 * DAY - 1000).toISOString() })), true);
  // Sem contato gravado: vale o cadastro.
  assert.equal(cooledTransferArchiveBlockReason(input({ client: { lastWhatsappContactAt: null, createdAt: ago(1) } })), "atendimento_recente");
});

test("vários casos: vale o de transferência mais recente", () => {
  const cases = [
    { decision: "transferred", broker_id: "antigo", decided_at: ago(40), reactivation_status: "left" },
    { decision: "transferred", broker_id: "original", decided_at: ago(10), reactivation_status: "left" }
  ];
  assert.equal(isCooledTransferArchiveCandidate(input({ cases, client: { responsibleUserId: "antigo" } })), true);
  assert.equal(cooledTransferArchiveBlockReason(input({ cases, client: { responsibleUserId: "original" } })), "com_corretor_original");
});

test("constantes: marca, motivo, origem e lote", () => {
  assert.equal(COOLED_ARCHIVE_TAG.name, "Frio arquivado");
  assert.equal(COOLED_ARCHIVE_TAG.key, "frio arquivado");
  assert.equal(COOLED_ARCHIVE_REASON, "Cliente frio: transferido e sem resposta há mais de 3 dias");
  assert.equal(COOLED_ARCHIVE_SOURCE, "cooled_transfer_archive");
  assert.equal(COOLED_ARCHIVE_BATCH, 30);
  assert.equal(maskPhone("5514999991234"), "(14) *****-1234");
});

// --- Visibilidade: só o dono, na conta real ---------------------------------------------------------------------

test("visibilidade: só o dono em conta real; Alterar conta, outro perfil e sessão inválida não", () => {
  assert.equal(canSeeCooledTransferArchive({ ok: true, accountSwitchMode: false, isOwnerEmail: true }), true);
  assert.equal(canSeeCooledTransferArchive({ ok: true, accountSwitchMode: true, isOwnerEmail: true }), false);
  assert.equal(canSeeCooledTransferArchive({ ok: true, accountSwitchMode: false, isOwnerEmail: false }), false);
  assert.equal(canSeeCooledTransferArchive({ ok: false, accountSwitchMode: false, isOwnerEmail: true }), false);
  assert.equal(canSeeCooledTransferArchive({}), false);
});

function fakeQuery() {
  const calls = [];
  const query = { calls, not(column, op, value) { calls.push(["not", column, op, value]); return query; } };
  return query;
}

test("exclusão: corretor/associado/gestor nunca veem (inclusive pesquisando); dono só na aba e na pesquisa", () => {
  const hiddenIds = ["a", "b"];
  const excluded = (options) => applyCooledArchiveExclusion(fakeQuery(), { hiddenIds, ...options }).calls.length === 1;
  assert.equal(excluded({ viewerIsOwner: false }), true);
  assert.equal(excluded({ viewerIsOwner: false, searching: true }), true);
  assert.equal(excluded({ viewerIsOwner: false, onTab: true }), true);
  assert.equal(excluded({ viewerIsOwner: true }), true);
  assert.equal(excluded({ viewerIsOwner: true, searching: true }), false);
  assert.equal(excluded({ viewerIsOwner: true, onTab: true }), false);
  const call = applyCooledArchiveExclusion(fakeQuery(), { hiddenIds }).calls[0];
  assert.deepEqual(call, ["not", "id", "in", "(a,b)"]);
  assert.equal(applyCooledArchiveExclusion(fakeQuery(), { hiddenIds: [] }).calls.length, 0);
});

test("aba do dono: interseção com o filtro de etiqueta", () => {
  assert.deepEqual(intersectIds(null, ["a", "b"]), ["a", "b"]);
  assert.deepEqual(intersectIds(["b", "c"], ["a", "b"]), ["b"]);
  assert.deepEqual(intersectIds([], ["a"]), []);
});

test("trava de código: a lista usa a exclusão única e só o servidor decide a aba", () => {
  const list = read("lib/simulation-list-query.js");
  assert.match(list, /applyCooledArchiveExclusion\(query, \{ hiddenIds: cooledArchive\?\.hiddenIds/);
  assert.match(list, /cooledTab \? \(cooledArchive\.viewerIsOwner \? intersectIds/);
  assert.match(list, /cooledArchive\.viewerIsOwner \? \{ \[COOLED_ARCHIVE_TAB_KEY\]/);
  const hidden = read("lib/cooled-archive-hidden.js");
  assert.match(hidden, /canSeeCooledTransferArchive\(\{ ok: auth\?\.ok, accountSwitchMode: auth\?\.accountSwitchMode, isOwnerEmail: isOwnerAdminEmail\(auth\?\.user\?\.email\) \}\)/);
  const job = read("lib/cooled-transfer-archive.js");
  assert.match(job, /changedBy: "sistema", source: COOLED_ARCHIVE_SOURCE/);
  assert.match(job, /addSystemTagToClient\(row\.id, COOLED_ARCHIVE_TAG\.name/);
  assert.match(job, /acquireLock\(COOLED_ARCHIVE_LOCK_NAME/);
  assert.match(job, /limit: COOLED_ARCHIVE_BATCH/);
  assert.match(read("app/api/cron/scheduled-activities/route.js"), /runCooledTransferArchiveJob/);
  assert.match(read("app/api/admin/cooled-transfer-archive/route.js"), /viewerSeesCooledArchive\(auth\)/);
});
