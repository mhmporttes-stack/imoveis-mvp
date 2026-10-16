import test from "node:test";
import assert from "node:assert/strict";
import {
  CASE_STATUS,
  NEGATIVE_DECISION_OPTIONS,
  NEGATIVE_DECISION_STATUSES,
  applyCaseAction,
  autoCancelReason,
  availableDecisionActions,
  buildReasonAlertDelivery,
  canAnswerCase,
  canDecideCase,
  caseLatestReason,
  caseLatestReasonAt,
  cooledDedupeKey,
  genericHandoffMessage,
  hadStatusOtherThanAwaitingReturn,
  isApprovedForCooledFlow,
  isCooledCandidate,
  wasEverApprovedForCooledFlow,
  isCooledDedupeKey,
  keepFirstPendingCooledAlert,
  pinCooledHead,
  isValidCooledText,
  parseHandoffResponse,
  renderHandoffMessage,
  resolveDeciderId
} from "../lib/cooled-clients-core.mjs";
import { evaluateDailyGoalPending } from "../lib/daily-goal-progress.mjs";

const NOW = Date.parse("2026-10-16T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const broker = { id: "b1", role: "broker", status: "active", manager_id: "m1" };
const client = (patch = {}) => ({ id: "c1", status: "in_service", responsibleUserId: "b1", lastWhatsappContactAt: new Date(NOW - 5 * DAY).toISOString(), createdAt: new Date(NOW - 30 * DAY).toISOString(), latestActivityAt: null, privateContactAt: null, ...patch });

test("gatilho: ativo, mais de 3 dias sem contato e sem atividade futura entra (backlog incluso)", () => {
  assert.equal(isCooledCandidate({ client: client(), responsible: broker, now: NOW }), true);
  assert.equal(isCooledCandidate({ client: client({ lastWhatsappContactAt: new Date(NOW - 30 * DAY).toISOString() }), responsible: broker, now: NOW }), true);
});

test("gatilho: contato recente ou atividade futura não entram", () => {
  assert.equal(isCooledCandidate({ client: client({ lastWhatsappContactAt: new Date(NOW - 2 * DAY).toISOString() }), responsible: broker, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client({ latestActivityAt: new Date(NOW + DAY).toISOString() }), responsible: broker, now: NOW }), false);
});

test("escopo: corretor, associado e gestora entram; dono/admin, inativo e responsável errado ficam fora", () => {
  assert.equal(isCooledCandidate({ client: client({ responsibleUserId: "a1" }), responsible: { id: "a1", role: "associate", status: "active" }, now: NOW }), true);
  assert.equal(isCooledCandidate({ client: client({ responsibleUserId: "m1" }), responsible: { id: "m1", role: "manager", status: "active" }, now: NOW }), true);
  assert.equal(isCooledCandidate({ client: client({ responsibleUserId: "o1" }), responsible: { id: "o1", role: "admin", status: "active", isGeneralAdmin: true }, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client({ responsibleUserId: "o2" }), responsible: { id: "o2", role: "broker", status: "active", isGeneralAdmin: true }, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client(), responsible: { ...broker, status: "inactive" }, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client({ responsibleUserId: "x" }), responsible: broker, now: NOW }), false);
});

test("escopo: arquivado, Não contactar, os 5 negativos e Particular ficam fora; Blindagem entra", () => {
  for (const status of NEGATIVE_DECISION_STATUSES) assert.equal(isCooledCandidate({ client: client({ status }), responsible: broker, now: NOW }), false, status);
  assert.equal(isCooledCandidate({ client: client({ privateContactAt: new Date(NOW - DAY).toISOString() }), responsible: broker, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client({ status: "shielding" }), responsible: broker, now: NOW }), true);
});

test("responsável trocado há menos de 3 dias não entra (novo corretor ganha os 3 dias)", () => {
  assert.equal(isCooledCandidate({ client: client({ responsibleChangedAt: new Date(NOW - DAY).toISOString() }), responsible: broker, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client({ responsibleChangedAt: new Date(NOW - 4 * DAY).toISOString() }), responsible: broker, now: NOW }), true);
});

test("Tentando contato: só entra se já teve outro status antes", () => {
  const awaiting = client({ status: "awaiting_return", lastStatusChangeAt: new Date(NOW - 10 * DAY).toISOString() });
  assert.equal(isCooledCandidate({ client: awaiting, responsible: broker, historyRows: [], now: NOW }), false);
  assert.equal(isCooledCandidate({ client: awaiting, responsible: broker, historyRows: [{ previous_status: null, new_status: "awaiting_return" }], now: NOW }), false);
  assert.equal(isCooledCandidate({ client: awaiting, responsible: broker, historyRows: [{ previous_status: "awaiting_return", new_status: "in_service" }, { previous_status: "in_service", new_status: "awaiting_return" }], now: NOW }), true);
  assert.equal(hadStatusOtherThanAwaitingReturn([{ previous_status: "simulation_sent", new_status: "awaiting_return" }]), true);
});

test("decisor: gestora da equipe; associado pela gestora do corretor; gestora e sem gestora -> dono", () => {
  const users = new Map([
    ["m1", { id: "m1", role: "manager", status: "active" }],
    ["b1", broker],
    ["b2", { id: "b2", role: "broker", status: "active", manager_id: null }],
    ["a1", { id: "a1", role: "associate", status: "active", linked_broker_id: "b1" }],
    ["b3", { id: "b3", role: "broker", status: "active", manager_id: "m2" }],
    ["m2", { id: "m2", role: "manager", status: "inactive" }]
  ]);
  assert.equal(resolveDeciderId({ responsible: broker, usersById: users, ownerId: "own" }), "m1");
  assert.equal(resolveDeciderId({ responsible: users.get("a1"), usersById: users, ownerId: "own" }), "m1");
  assert.equal(resolveDeciderId({ responsible: users.get("m1"), usersById: users, ownerId: "own" }), "own");
  assert.equal(resolveDeciderId({ responsible: users.get("b2"), usersById: users, ownerId: "own" }), "own");
  assert.equal(resolveDeciderId({ responsible: users.get("b3"), usersById: users, ownerId: "own" }), "own");
});

test("motivo: mínimo 15 letras/números (espaços e pontuação não contam)", () => {
  assert.equal(isValidCooledText("não respondeu"), false);
  assert.equal(isValidCooledText("...............   ..........."), false);
  assert.equal(isValidCooledText("Cliente não responde mais"), true);
});

const baseCase = { id: "k1", client_id: "c1", broker_id: "b1", decider_id: "m1", status: CASE_STATUS.AWAITING_REASON };

test("transições: motivo -> decisão -> devolução -> 2º motivo -> decisão final sem Devolver", () => {
  const p1 = applyCaseAction(baseCase, "reason", { actorId: "b1", text: "Cliente não responde desde a simulação", now: "t1" });
  assert.equal(p1.status, CASE_STATUS.AWAITING_DECISION);
  assert.equal(p1.first_reason_at, "t1");
  const c1 = { ...baseCase, ...p1 };
  assert.deepEqual(availableDecisionActions(c1), ["transfer", "status", "return"]);
  const p2 = applyCaseAction(c1, "return", { actorId: "m1", text: "Faltou dizer quantas vezes ligou", now: "t2" });
  assert.equal(p2.status, CASE_STATUS.AWAITING_REASON);
  const c2 = { ...c1, ...p2 };
  const p3 = applyCaseAction(c2, "reason", { actorId: "b1", text: "Liguei três vezes e mandei áudio", now: "t3" });
  assert.equal(p3.second_reason_at, "t3");
  assert.equal(p3.first_reason, undefined);
  const c3 = { ...c2, ...p3 };
  assert.deepEqual(availableDecisionActions(c3), ["transfer", "status"]);
  assert.throws(() => applyCaseAction(c3, "return", { text: "Mais uma vez por favor explique" }), /já foi devolvido/);
  assert.equal(caseLatestReason(c3), "Liguei três vezes e mandei áudio");
  assert.equal(caseLatestReasonAt({ first_reason_at: "2026-10-16T10:00:00Z", second_reason_at: "2026-10-16T12:00:00Z" }), "2026-10-16T12:00:00.000Z");
  const p4 = applyCaseAction(c3, "status", { actorId: "m1", status: "archived" });
  assert.equal(p4.status, CASE_STATUS.CLOSED);
  assert.equal(p4.decision_status, "archived");
});

test("transições inválidas", () => {
  assert.throws(() => applyCaseAction(baseCase, "transfer"), /aguarda o corretor/);
  assert.throws(() => applyCaseAction(baseCase, "reason", { text: "curto" }), /15 letras/);
  const open = { ...baseCase, status: CASE_STATUS.AWAITING_DECISION };
  assert.throws(() => applyCaseAction(open, "status", { status: "shielding" }), /Status inválido/);
  assert.throws(() => applyCaseAction(open, "return", { text: "pouco" }), /15 letras/);
  assert.throws(() => applyCaseAction({ ...baseCase, status: CASE_STATUS.CLOSED }, "reason", { text: "Cliente sumiu faz tempo demais" }), /não está aguardando/);
});

test("status negativos da decisão: os 5, sem Blindagem", () => {
  assert.deepEqual(NEGATIVE_DECISION_OPTIONS.map((option) => option.status), ["restriction", "rejected", "income_commitment", "archived", "do_not_contact"]);
  assert.equal(NEGATIVE_DECISION_STATUSES.includes("shielding"), false);
});

test("permissões: corretor só responde o próprio caso; gestora só a equipe e casos dela; dono todos", () => {
  assert.equal(canAnswerCase("b1", baseCase), true);
  assert.equal(canAnswerCase("b2", baseCase), false);
  assert.equal(canAnswerCase("b1", { ...baseCase, status: CASE_STATUS.AWAITING_DECISION }), false);
  const deciding = { ...baseCase, status: CASE_STATUS.AWAITING_DECISION };
  assert.equal(canDecideCase({ viewerId: "m1", isManager: true, managedUserIds: ["m1", "b1"] }, deciding), true);
  assert.equal(canDecideCase({ viewerId: "m1", isManager: true, managedUserIds: ["m1"] }, deciding), false);
  assert.equal(canDecideCase({ viewerId: "m9", isManager: true, managedUserIds: ["b1"] }, deciding), false);
  assert.equal(canDecideCase({ viewerId: "m1", isManager: true, managedUserIds: ["m1"] }, { ...deciding, broker_id: "m1", decider_id: "m1" }), false);
  assert.equal(canDecideCase({ viewerId: "own", isOwner: true }, { ...deciding, decider_id: "m1" }), true);
  assert.equal(canDecideCase({ viewerId: "b1", managedUserIds: ["b1"] }, deciding), false);
});

test("cancelamento automático", () => {
  const row = { ...baseCase };
  assert.equal(autoCancelReason({ row, client: client() }), "");
  assert.equal(autoCancelReason({ row, client: client({ responsibleUserId: "b2" }) }), "responsavel_mudou");
  assert.equal(autoCancelReason({ row, client: client({ status: "do_not_contact" }) }), "status_negativo");
  assert.equal(autoCancelReason({ row, client: client({ privateContactAt: new Date(NOW).toISOString() }) }), "contato_particular");
  assert.equal(autoCancelReason({ row: { ...row, status: CASE_STATUS.AWAITING_DECISION }, client: client() }), "");
  assert.equal(autoCancelReason({ row: { ...row, status: CASE_STATUS.CLOSED }, client: null }), "");
  assert.equal(autoCancelReason({ row, client: null }), "cliente_removido");
});

// Regra do dono (2026-10-16): "Se o corretor mandar mensagem ao cliente ou agendar atividade antes de informar o
// motivo, o card continua até ele informar?" -> "sim".
test("caso aguardando motivo NÃO se encerra por contato retomado, atividade futura nem atendimento", () => {
  const row = { ...baseCase };
  const contacted = client({ lastWhatsappContactAt: new Date(NOW - 60 * 1000).toISOString() });
  const scheduled = client({ latestActivityAt: new Date(NOW + DAY).toISOString() });
  const attended = client({ lastAttendanceAt: new Date(NOW - 60 * 1000).toISOString(), status: "approval_pending" });
  for (const value of [contacted, scheduled, attended]) assert.equal(autoCancelReason({ row, client: value }), "");
  // Saídas que continuam: responsável trocado, Particular, negativos (inclui Arquivado/Não contactar), aprovado/venda.
  assert.equal(autoCancelReason({ row, client: { ...contacted, status: "archived" } }), "status_negativo");
  assert.equal(autoCancelReason({ row, client: { ...contacted, status: "sale_completed" } }), "cliente_aprovado");
});
test("janela do corretor: Importante, chave por caso e rodada, sem link", () => {
  const delivery = buildReasonAlertDelivery({ caseRow: baseCase, clientName: "Ana Souza", stageLabel: "Em atendimento" });
  assert.equal(delivery.kind, "important");
  assert.equal(delivery.recipient_id, "b1");
  assert.equal(delivery.body, "Conte o motivo do desinteresse, desistência ou falta de resposta deste cliente.");
  assert.equal(delivery.dedupe_key, "cooled_client:k1:1");
  assert.equal(delivery.context.link, undefined);
  const second = buildReasonAlertDelivery({ caseRow: { ...baseCase, returned_at: "t", returned_text: "Explique melhor por favor", first_reason: "x" }, clientName: "Ana", returnedByName: "Carol" });
  assert.equal(second.dedupe_key, cooledDedupeKey("k1", 2));
  assert.equal(second.context.returned_text, "Explique melhor por favor");
  assert.equal(isCooledDedupeKey(second.dedupe_key), true);
  assert.equal(isCooledDedupeKey("reply_waiting:1"), false);
});

test("mensagem sugerida: saudação trocada na hora e resposta da IA separada", () => {
  const generic = genericHandoffMessage("Maria da Silva", "João Pedro");
  assert.match(renderHandoffMessage(generic, "Boa tarde"), /^Boa tarde, Maria, sou associado\(a\) do corretor Matheus Machado, e vi que você estava em atendimento com João, certo\?/);
  const parsed = parseHandoffResponse("Quer: casa\nOnde parou: simulação\nO que faltou: documentos\nMENSAGEM: {saudacao}, Maria, vi que...", "fallback");
  assert.equal(parsed.summary, "Quer: casa\nOnde parou: simulação\nO que faltou: documentos");
  assert.equal(parsed.message, "{saudacao}, Maria, vi que...");
  assert.equal(parseHandoffResponse("só resumo", "fb").message, "fb");
});

test("Meta Diária: motivo escrito hoje resolve a pendência congelada (MD-8)", () => {
  const dayStartMs = Date.parse("2026-10-16T03:00:00Z");
  const pending = { id: "c1", responsibleUserId: "b1", status: "in_service", lastWhatsappContactAt: "2026-10-10T12:00:00Z", latestActivityAt: null };
  const base = { brokerId: "b1", frozenIds: ["c1"], dayStartMs, nowMs: NOW };
  assert.equal(evaluateDailyGoalPending({ ...base, clientsById: new Map([["c1", pending]]) }).done, 0);
  assert.equal(evaluateDailyGoalPending({ ...base, clientsById: new Map([["c1", { ...pending, cooledReasonAt: "2026-10-16T13:00:00Z" }]]) }).done, 1);
  // Motivo de ontem não resolve a pendência de hoje.
  assert.equal(evaluateDailyGoalPending({ ...base, clientsById: new Map([["c1", { ...pending, cooledReasonAt: "2026-10-15T13:00:00Z" }]]) }).done, 0);
});

// FUN-15c (dono, 2026-10-16): rascunho 100% de pós-atendimento.
test("rascunho de pós-atendimento: formato do dono (novo corretor, associado do corretor Matheus Machado, atendente anterior)", () => {
  const text = renderHandoffMessage(genericHandoffMessage("Maria da Silva", "Ana Paula", { newBrokerName: "Gabriel Ribeiro", newBrokerGender: "male", previousBrokerGender: "female" }), "Bom dia");
  assert.equal(text, "Bom dia, Maria, meu nome é Gabriel, sou associado do corretor Matheus Machado, e vi que você estava em atendimento com a corretora Ana, certo? Estou te mandando essa mensagem hoje para saber se aconteceu alguma coisa e se você foi bem atendido(a).");
  const female = renderHandoffMessage(genericHandoffMessage("Pedro", "Carlos", { newBrokerName: "Bruna Santos", newBrokerGender: "female", previousBrokerGender: "male" }), "Boa noite");
  assert.match(female, /^Boa noite, Pedro, meu nome é Bruna, sou associada do corretor Matheus Machado, e vi que você estava em atendimento com o corretor Carlos, certo\?/);
});

test("rascunho de pós-atendimento: sem atendente anterior não inventa nome; sem emoji, sem 'Imóveis', sem promessa", () => {
  const text = renderHandoffMessage(genericHandoffMessage("", "", { newBrokerName: "Gabriel" }), "Boa tarde");
  assert.equal(text, "Boa tarde, meu nome é Gabriel, sou associado(a) do corretor Matheus Machado, e vi que você já tinha começado um atendimento com a nossa equipe, certo? Estou te mandando essa mensagem hoje para saber se aconteceu alguma coisa e se você foi bem atendido(a).");
  for (const sample of [text, genericHandoffMessage("Maria", "Ana", { newBrokerName: "Gabriel" })]) {
    assert.doesNotMatch(sample, /\p{Extended_Pictographic}/u);
    assert.doesNotMatch(sample, /Matheus Machado Imóveis/);
    assert.doesNotMatch(sample, /garant|prometo|aprovad|R\$|https?:/i);
    assert.match(sample, /aconteceu alguma coisa/);
  }
});

test("FUN-15e: cliente aprovado (Cliente aprovado, Reunião, Venda) nunca entra nem chega à transferência", () => {
  for (const status of ["approved", "meeting_pending", "meeting_done", "sale_completed"]) {
    assert.equal(isApprovedForCooledFlow(status), true, status);
    assert.equal(isCooledCandidate({ client: client({ status }), responsible: broker, now: NOW }), false, status);
  }
  for (const status of ["in_service", "approval_pending", "shielding", "documentation_pending"]) assert.equal(isApprovedForCooledFlow(status), false, status);
  const row = { ...baseCase };
  assert.equal(autoCancelReason({ row, client: client({ status: "approved" }) }), "cliente_aprovado");
  // Também depois do motivo (aguardando a decisora): não vai para a transferência.
  assert.equal(autoCancelReason({ row: { ...row, status: CASE_STATUS.AWAITING_DECISION }, client: client({ status: "meeting_pending" }) }), "cliente_aprovado");
});

test("FUN-15e: uma janela de cliente esfriado por vez, a mais antiga; o resto continua na fila", () => {
  const cooled = (id, at, extra = {}) => ({ id, kind: "important", created_at: at, acknowledged_at: null, context: { type: "cooled_client" }, ...extra });
  const other = { id: "z", kind: "important", created_at: "2026-10-16T09:00:00Z", acknowledged_at: null, context: {} };
  const rows = [cooled("b", "2026-10-16T10:00:00Z"), other, cooled("a", "2026-10-16T10:00:00Z"), cooled("c", "2026-10-15T10:00:00Z", { acknowledged_at: "x" }), cooled("d", "2026-10-16T11:00:00Z")];
  assert.deepEqual(keepFirstPendingCooledAlert(rows).map((row) => row.id), ["z", "a", "c"]);
  assert.deepEqual(keepFirstPendingCooledAlert([...rows].reverse()).map((row) => row.id).sort(), ["a", "c", "z"]);
  // Sino: frente conhecida por consulta própria; sem frente, nenhuma pendente do fluxo aparece.
  assert.deepEqual(keepFirstPendingCooledAlert(rows, "d").map((row) => row.id), ["z", "c", "d"]);
  assert.deepEqual(keepFirstPendingCooledAlert(rows, null).map((row) => row.id), ["z", "c"]);
});

test("FUN-15e complemento (dono, 2026-10-16): o card fica fixo até concluir, mesmo com backlog maior que o limite da consulta", () => {
  // Backlog: 60 entregas gravadas na mesma rodada do cron (mesmo created_at). A Central lê no máximo 50 — antes, cada
  // releitura recebia um recorte diferente dos empatados e a janela trocava de cliente sozinha (caso da Carol).
  const at = "2026-10-16T10:00:00Z";
  const ids = Array.from({ length: 60 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  const cooled = (id) => ({ id, kind: "important", created_at: at, acknowledged_at: null, context: { type: "cooled_client", case_id: `case-${id}` } });
  const all = ids.map(cooled);
  const head = all[0]; // a consulta própria ordena por created_at e id: sempre a mesma frente
  const shuffled = (seed) => [...all].sort((a, b) => ((a.id.charCodeAt(35) * seed) % 61) - ((b.id.charCodeAt(35) * seed) % 61));
  const pendingIds = (rows) => rows.filter((row) => row.context?.type === "cooled_client" && !row.acknowledged_at).map((row) => row.id);
  for (const seed of [1, 7, 13, 29, 53]) {
    const cut = shuffled(seed).slice(0, 50); // recortes diferentes, inclusive sem a frente
    assert.deepEqual(pendingIds(pinCooledHead(cut, head)), [head.id]);
  }
  // Releituras repetidas (foco, tempo real, recarregar, outro aparelho) devolvem sempre o mesmo cliente.
  const reads = new Set([1, 2, 3, 4].map((seed) => pendingIds(pinCooledHead(shuffled(seed).slice(10), head))[0]));
  assert.deepEqual([...reads], [head.id]);
  // Outros alertas não somem; sem frente pendente (fila vazia), nenhuma janela do fluxo.
  const other = { id: "z", kind: "important", created_at: at, acknowledged_at: null, context: {} };
  assert.deepEqual(pinCooledHead([other, all[5]], head).map((row) => row.id), ["z", head.id]);
  assert.deepEqual(pinCooledHead([other, all[5]], null).map((row) => row.id), ["z"]);
  // Concluído o motivo, a próxima frente (consulta própria) é o seguinte pela ordem estável.
  assert.deepEqual(pendingIds(pinCooledHead(all.slice(1), all[1])), [all[1].id]);
});

// Regra do dono (2026-10-16): "Cliente aprovado que voltou para uma etapa anterior pode entrar de novo na lista?" -> "não".
test("cliente que JÁ FOI aprovado alguma vez nunca entra, mesmo de volta a uma etapa anterior", () => {
  const back = client({ status: "documentation" });
  assert.equal(isCooledCandidate({ client: back, responsible: broker, now: NOW }), true);
  assert.equal(isCooledCandidate({ client: { ...back, approvedAt: "2026-09-01T12:00:00Z" }, responsible: broker, now: NOW }), false);
  for (const historyRows of [
    [{ previous_status: "approval_pending", new_status: "approved" }],
    [{ previous_status: "approval_pending", new_status: "meeting_pending" }],
    [{ previous_status: "approved", new_status: "documentation" }],
    [{ previous_status: "in_service", new_status: "sale_completed" }]
  ]) {
    assert.equal(wasEverApprovedForCooledFlow({ status: "documentation", historyRows }), true, JSON.stringify(historyRows));
    assert.equal(isCooledCandidate({ client: back, responsible: broker, historyRows, now: NOW }), false);
  }
  assert.equal(wasEverApprovedForCooledFlow({ status: "documentation", historyRows: [{ previous_status: "in_service", new_status: "approval_pending" }] }), false);
  // Caso aberto (motivo ou decisora) é encerrado se o cliente já foi aprovado alguma vez.
  assert.equal(autoCancelReason({ row: { ...baseCase }, client: back, historyRows: [{ previous_status: "approved", new_status: "documentation" }] }), "cliente_aprovado");
  assert.equal(autoCancelReason({ row: { ...baseCase, status: CASE_STATUS.AWAITING_DECISION }, client: { ...back, approvedAt: "2026-09-01T12:00:00Z" } }), "cliente_aprovado");
  assert.equal(autoCancelReason({ row: { ...baseCase }, client: back, historyRows: [] }), "");
});

// Regra do dono (2026-10-16): "o último contato com o cliente deve atualizar conforme o chat" e "muda o status ...
// automaticamente o cliente recebeu atendimento hoje, então zera os 3 dias novamente".
test("último atendimento nos últimos 3 dias (chat, status, atividade...) impede abrir caso novo", () => {
  assert.equal(isCooledCandidate({ client: client({ lastAttendanceAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }), responsible: broker, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client({ lastAttendanceAt: new Date(NOW - 4 * DAY).toISOString() }), responsible: broker, now: NOW }), true);
  assert.equal(isCooledCandidate({ client: client({ lastAttendanceAt: null }), responsible: broker, now: NOW }), true);
});
