// REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-25 (CLI-7c): cliente transferido vai para "Aguardando contato" + etiqueta do
// status anterior; o clique no WhatsApp / mensagem do corretor passa para "Tentando contato". Regras puras em lib/transfer-status-core.mjs; ponto único lib/transfer-status.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_STATUS, CLIENT_FUNNEL_SALE_STATUS_VALUES, NEGATIVE_CLIENT_STATUS_VALUES } from "../lib/client-status.js";
import {
  CONTACT_ATTEMPT_SOURCE,
  PREVIOUS_STATUS_TAG_KEY_PREFIX,
  nextStatusOnContactAttempt,
  TRANSFER_STATUS_SOURCE,
  TRANSFER_TARGET_STATUS,
  isResponsibleTransfer,
  planPreviousStatusTags,
  planTransferStatus,
  previousStatusTagName
} from "../lib/transfer-status-core.mjs";
import { AUTOMATIC_STATUS_SOURCES, isPersonStatusChange } from "../lib/client-attendance-core.mjs";
import { CHAT_CLIENT_EVENT, nextClientStatusOnChatEvent } from "../lib/whatsapp-client-status-core.mjs";
import { CLIENT_FUNNEL_STAGES, CLIENT_STATUS_FILTER_GROUPS, CLIENT_STATUS_META, ACTIVE_CLIENT_STATUS_VALUES, pendingReferenceAt } from "../lib/client-status.js";
import { isColdListHidden } from "../lib/cold-list-core.mjs";
import { isTransferredCandidate } from "../lib/transferred-awaiting-core.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

test("etapa ativa (inclusive aprovação não negativa) vai para Aguardando contato com a etiqueta do status anterior", () => {
  assert.equal(TRANSFER_TARGET_STATUS, CLIENT_STATUS.AWAITING_CONTACT);
  for (const status of [CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.COMPLETED, CLIENT_STATUS.SIMULATION_SENT, CLIENT_STATUS.AWAITING_RETURN, CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING, CLIENT_STATUS.APPROVAL_PENDING, CLIENT_STATUS.SHIELDING, CLIENT_STATUS.CANCELLATION_LETTER, CLIENT_STATUS.RESEARCH_MO]) {
    assert.equal(planTransferStatus(status).change, true, status);
  }
  assert.equal(planTransferStatus(CLIENT_STATUS.IN_SERVICE).tagName, "Status anterior: Em atendimento");
  assert.equal(planTransferStatus(CLIENT_STATUS.AWAITING_RETURN).tagName, "Status anterior: Tentando contato");
  assert.equal(previousStatusTagName(CLIENT_STATUS.DOCUMENTATION), "Status anterior: Aguardando documentação");
});

test("já em Aguardando contato (transferido de novo): não muda e não troca a etiqueta", () => {
  assert.deepEqual(planTransferStatus(CLIENT_STATUS.AWAITING_CONTACT), { change: false, tagName: null, tagOnlyIfMissing: false, reason: "ja_aguardando_contato" });
});

test("rotina dos atuais: quem já está em Tentando contato ganha só a etiqueta (se não tiver)", () => {
  assert.deepEqual(planTransferStatus(CLIENT_STATUS.AWAITING_RETURN, { keepTryingContact: true }), { change: false, tagName: "Status anterior: Tentando contato", tagOnlyIfMissing: true, reason: "so_etiqueta" });
  assert.equal(planTransferStatus(CLIENT_STATUS.IN_SERVICE, { keepTryingContact: true }).change, true);
});

test("negativos, aprovado em diante e lead ainda não atendido mantêm o status", () => {
  for (const status of NEGATIVE_CLIENT_STATUS_VALUES) assert.equal(planTransferStatus(status).reason, "etapa_preservada", status);
  for (const status of [CLIENT_STATUS.APPROVED, CLIENT_STATUS.MEETING_PENDING, CLIENT_STATUS.MEETING_DONE, ...CLIENT_FUNNEL_SALE_STATUS_VALUES]) {
    assert.equal(planTransferStatus(status).reason, "etapa_preservada", status);
  }
  for (const status of [CLIENT_STATUS.AUTOMATED_SERVICE, CLIENT_STATUS.PENDING, CLIENT_STATUS.AUTO_SIMULATION]) {
    assert.equal(planTransferStatus(status).reason, "lead_sem_atendimento", status);
  }
  assert.equal(planTransferStatus("").change, false);
});

test("clique no WhatsApp / mensagem do corretor: só Aguardando contato vira Tentando contato", () => {
  assert.equal(nextStatusOnContactAttempt(CLIENT_STATUS.AWAITING_CONTACT), CLIENT_STATUS.AWAITING_RETURN);
  for (const status of [CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.AWAITING_RETURN, CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.ARCHIVED]) assert.equal(nextStatusOnContactAttempt(status), null, status);
  assert.equal(nextClientStatusOnChatEvent(CLIENT_STATUS.AWAITING_CONTACT, CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT), CLIENT_STATUS.AWAITING_RETURN);
  assert.equal(nextClientStatusOnChatEvent(CLIENT_STATUS.AWAITING_CONTACT, CHAT_CLIENT_EVENT.CLIENT_REPLIED), null);
  assert.equal(AUTOMATIC_STATUS_SOURCES.includes(CONTACT_ATTEMPT_SOURCE), false, "o clique é ação do corretor");
  const registrations = read("lib/simulation-registrations.js");
  const click = registrations.slice(registrations.indexOf("export async function markSimulationRegistrationWhatsAppContact("), registrations.indexOf("export async function listDueScheduledActivityNotifications("));
  assert.match(click, /markTransferredContactAttempt/);
});

test("Aguardando contato: aba Atendimento (nunca Prospecção), fora do funil, fora da Lista fria, no card Novos atendimentos", () => {
  assert.equal(CLIENT_STATUS_META[CLIENT_STATUS.AWAITING_CONTACT].label, "Aguardando contato");
  assert.ok(ACTIVE_CLIENT_STATUS_VALUES.has(CLIENT_STATUS.AWAITING_CONTACT));
  const groupOf = (key) => CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key === key).statuses;
  assert.ok(groupOf("service").includes(CLIENT_STATUS.AWAITING_CONTACT));
  assert.equal(groupOf("prospecting").includes(CLIENT_STATUS.AWAITING_CONTACT), false);
  assert.equal(CLIENT_FUNNEL_STAGES.some((stage) => stage.statuses.includes(CLIENT_STATUS.AWAITING_CONTACT)), false);
  assert.equal(isColdListHidden({ status: CLIENT_STATUS.AWAITING_CONTACT, distinctBrokers: 5 }), false);
  assert.equal(isTransferredCandidate({ id: "c", status: CLIENT_STATUS.AWAITING_CONTACT, responsible_user_id: "b", previous_responsible_user_id: "a", responsible_changed_at: "2026-10-25T10:00:00Z" }), true);
  // Os 3 dias do novo corretor contam da transferência.
  const transferredAt = "2026-10-25T10:00:00.000Z";
  assert.equal(pendingReferenceAt({ status: CLIENT_STATUS.AWAITING_CONTACT, lastWhatsappContactAt: "2026-10-01T10:00:00.000Z", lastStatusChangeAt: transferredAt }), Date.parse(transferredAt));
});

test("migration aceita o status novo no cliente e no histórico", () => {
  const sql = read("supabase/migrations/20261025120000_client_status_awaiting_contact.sql");
  for (const constraint of ["simulation_registrations_status_check", "client_status_history_new_status_check", "client_status_history_previous_status_check"]) assert.match(sql, new RegExp(constraint));
  assert.equal((sql.match(/'awaiting_contact'/g) || []).length >= 3, true);
});

test("uma etiqueta 'Status anterior' por cliente: a nova substitui a antiga, as outras etiquetas ficam", () => {
  const currentTags = [
    { id: "t-old", normalizedName: "status anterior: em atendimento" },
    { id: "t-new", normalizedName: "status anterior: aguardando documentacao" },
    { id: "t-other", normalizedName: "cliente transferido" }
  ];
  assert.deepEqual(planPreviousStatusTags({ currentTags, targetTagId: "t-new" }), { removeIds: ["t-old"], alreadyHas: true, hasAny: true });
  assert.deepEqual(planPreviousStatusTags({ currentTags: [{ id: "t-other", normalizedName: "cliente transferido" }], targetTagId: "t-new" }), { removeIds: [], alreadyHas: false, hasAny: false });
  assert.ok("status anterior: em atendimento".startsWith(PREVIOUS_STATUS_TAG_KEY_PREFIX));
});

test("transferência = troca entre duas pessoas", () => {
  assert.equal(isResponsibleTransfer("a", "b"), true);
  assert.equal(isResponsibleTransfer("a", "a"), false);
  assert.equal(isResponsibleTransfer(null, "b"), false);
  assert.equal(isResponsibleTransfer("a", null), false);
});

test("mudança automática não é atendimento nem pontua", () => {
  assert.ok(AUTOMATIC_STATUS_SOURCES.includes(TRANSFER_STATUS_SOURCE));
  assert.equal(isPersonStatusChange({ changed_by: "corretor@exemplo.com", source: TRANSFER_STATUS_SOURCE }), false);
  const scoring = read("lib/scoring-rules.js");
  const block = scoring.slice(scoring.indexOf("const STATUS_TO_SCORING_KEY"), scoring.indexOf("};", scoring.indexOf("const STATUS_TO_SCORING_KEY")));
  assert.ok(block.length > 0);
  assert.equal(block.includes("AWAITING_RETURN"), false, "Tentando contato não pode pontuar");
  assert.equal(block.includes("AWAITING_CONTACT"), false, "Aguardando contato não pode pontuar");
});

test("ponto único grava histórico com source automática e etiqueta, sem pontuar", () => {
  const source = read("lib/transfer-status.js");
  assert.match(source, /source: TRANSFER_STATUS_SOURCE/);
  assert.match(source, /\.eq\("status", client\.status\)/);
  assert.match(source, /addSystemTagToClient/);
  assert.match(source, /planPreviousStatusTags/);
});

// Todo arquivo que troca simulation_registrations.responsible_user_id chama o ponto único, ou está nesta lista com o
// motivo (não é transferência de cliente atendido).
const NOT_A_TRANSFER = {
  "lib/whatsapp-sponsored-lead.js": "1ª distribuição do lead do anúncio (WA-18), cliente em Atendimento automático",
  "lib/simulation-auto-send.js": "1ª distribuição do cadastro novo do site (SIM-AUTO-ENVIO)",
  "lib/daily-goal.js": "Meta Diária: o próprio fluxo grava Tentando contato ao materializar o contato"
};
const CALLS_POINT = /applyTransferStatusRuleAfterTransfer\(/;

function walk(dir, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(m?js)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test("todos os caminhos que trocam o responsável chamam o ponto único", () => {
  const writer = /from\("simulation_registrations"\)(?:\s|\/\/[^\n]*\n)*\.update\(\{[^}]*?\bresponsible_user_id\s*:/;
  const files = walk("lib").filter((path) => writer.test(read(path)));
  assert.ok(files.length >= 6, files.join(", "));
  for (const path of files) {
    if (NOT_A_TRANSFER[path]) continue;
    assert.match(read(path), CALLS_POINT, `${path} troca o responsável sem chamar applyTransferStatusRuleAfterTransfer`);
  }
  for (const path of ["lib/lead-distribution.js", "lib/cooled-clients-reactivation.js", "lib/marketplace-chat.js", "lib/prospecting.js"]) {
    assert.ok(files.includes(path), `${path} deveria ser detectado`);
  }
});

test("caminhos por função compartilhada: ficha/Chat/automações, roleta, exclusão de usuário", () => {
  const registrations = read("lib/simulation-registrations.js");
  assert.match(registrations, /!statusChangedAt && isResponsibleTransfer\(currentRegistration\?\.responsible_user_id, record\.responsible_user_id\)/);
  const distribution = read("lib/lead-distribution.js");
  const move = distribution.slice(distribution.indexOf("async function moveClientToRoulette("));
  assert.match(move, /applyTransferStatusRuleAfterTransfer\(\{ clientId: client\.id, auth \}\)/);
  const waiting = distribution.slice(distribution.indexOf("export async function moveClientToRouletteWaitingQueue("), distribution.indexOf("export async function moveClientToRouletteWaitingQueue(") + 1500);
  assert.match(waiting, CALLS_POINT);
  assert.match(read("lib/admin-profiles.js"), /plan\.assignments[\s\S]{0,200}applyTransferStatusRuleAfterTransfer/);
});
