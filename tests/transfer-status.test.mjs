// REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-25: cliente transferido vai para "Tentando contato" + etiqueta do status
// anterior. Regras puras em lib/transfer-status-core.mjs; ponto único lib/transfer-status.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_STATUS, CLIENT_FUNNEL_SALE_STATUS_VALUES, NEGATIVE_CLIENT_STATUS_VALUES } from "../lib/client-status.js";
import {
  PREVIOUS_STATUS_TAG_KEY_PREFIX,
  TRANSFER_STATUS_SOURCE,
  TRANSFER_TARGET_STATUS,
  isResponsibleTransfer,
  planPreviousStatusTags,
  planTransferStatus,
  previousStatusTagName
} from "../lib/transfer-status-core.mjs";
import { AUTOMATIC_STATUS_SOURCES, isPersonStatusChange } from "../lib/client-attendance-core.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

test("etapa ativa vai para Tentando contato com a etiqueta do status anterior", () => {
  assert.equal(TRANSFER_TARGET_STATUS, CLIENT_STATUS.AWAITING_RETURN);
  for (const status of [CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.COMPLETED, CLIENT_STATUS.SIMULATION_SENT, CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING, CLIENT_STATUS.APPROVAL_PENDING, CLIENT_STATUS.SHIELDING, CLIENT_STATUS.CANCELLATION_LETTER, CLIENT_STATUS.RESEARCH_MO]) {
    const plan = planTransferStatus(status);
    assert.equal(plan.change, true, status);
  }
  assert.equal(planTransferStatus(CLIENT_STATUS.IN_SERVICE).tagName, "Status anterior: Em atendimento");
  assert.equal(previousStatusTagName(CLIENT_STATUS.DOCUMENTATION), "Status anterior: Aguardando documentação");
});

test("já em Tentando contato: não muda e não troca a etiqueta", () => {
  assert.deepEqual(planTransferStatus(CLIENT_STATUS.AWAITING_RETURN), { change: false, reason: "ja_tentando_contato", tagName: null });
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

test("uma etiqueta 'Status anterior' por cliente: a nova substitui a antiga, as outras etiquetas ficam", () => {
  const currentTags = [
    { id: "t-old", normalizedName: "status anterior: em atendimento" },
    { id: "t-new", normalizedName: "status anterior: aguardando documentacao" },
    { id: "t-other", normalizedName: "cliente transferido" }
  ];
  assert.deepEqual(planPreviousStatusTags({ currentTags, targetTagId: "t-new" }), { removeIds: ["t-old"], alreadyHas: true });
  assert.deepEqual(planPreviousStatusTags({ currentTags: [{ id: "t-other", normalizedName: "cliente transferido" }], targetTagId: "t-new" }), { removeIds: [], alreadyHas: false });
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
