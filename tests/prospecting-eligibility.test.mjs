import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  PROSPECTING_CONNECT_MESSAGE,
  accessRequiresWhatsapp,
  decideProspectingGate,
  isSessionOperational,
  participationRequiresWhatsapp
} from "../lib/prospecting-eligibility-core.mjs";

// Prospecção SÓ com WhatsApp conectado (regra do dono, 2026-10-02).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");
const between = (code, from, to) => {
  const start = code.indexOf(from);
  assert.ok(start >= 0, `não achei: ${from}`);
  const end = to ? code.indexOf(to, start + from.length) : -1;
  return code.slice(start, end > 0 ? end : undefined);
};

test("só 'connected' é operacional (número cadastrado, reconnecting, qr_required, disconnected e sem sessão não bastam)", () => {
  assert.equal(isSessionOperational("connected"), true);
  for (const status of ["reconnecting", "qr_required", "disconnected", "error", "", null, undefined]) {
    assert.equal(isSessionOperational(status), false, String(status));
  }
});

test("A/B/C — conectado participa; desconectado não; reconectou volta sozinho (a decisão só depende do status atual)", () => {
  const broker = { role: "broker", isGeneralAdmin: false };
  for (const kind of ["participate", "access"]) {
    assert.equal(decideProspectingGate({ ...broker, kind, sessionStatus: "connected" }).allowed, true, `conectado/${kind}`);
    const blocked = decideProspectingGate({ ...broker, kind, sessionStatus: "disconnected" });
    assert.equal(blocked.allowed, false, `desconectado/${kind}`);
    assert.equal(blocked.message, "Conecte seu WhatsApp para acessar a Prospecção.");
    assert.equal(blocked.code, "WHATSAPP_NOT_CONNECTED");
    assert.equal(decideProspectingGate({ ...broker, kind, sessionStatus: "connected" }).allowed, true, `reconectou/${kind}`);
  }
  assert.equal(PROSPECTING_CONNECT_MESSAGE, "Conecte seu WhatsApp para acessar a Prospecção.");
});

test("administrador geral nunca é bloqueado; gestor mantém a tela de supervisão mas não executa sem conexão", () => {
  assert.equal(participationRequiresWhatsapp({ isGeneralAdmin: true }), false);
  assert.equal(decideProspectingGate({ kind: "participate", role: "admin", isGeneralAdmin: true, sessionStatus: null }).allowed, true);
  assert.equal(decideProspectingGate({ kind: "access", role: "admin", isGeneralAdmin: true, sessionStatus: null }).allowed, true);
  // Gestor: abre a tela (supervisão), mas participar/executar exige a sessão conectada.
  assert.equal(accessRequiresWhatsapp({ role: "manager" }), false);
  assert.equal(decideProspectingGate({ kind: "access", role: "manager", sessionStatus: "disconnected" }).allowed, true);
  assert.equal(decideProspectingGate({ kind: "participate", role: "manager", sessionStatus: "disconnected" }).allowed, false);
  assert.equal(decideProspectingGate({ kind: "participate", role: "manager", sessionStatus: "connected" }).allowed, true);
  // Associado segue a regra do corretor na tela.
  assert.equal(accessRequiresWhatsapp({ role: "associate" }), true);
});

test("D — barreiras de SERVIDOR (não só visual) em cada caminho que executa/entrega Prospecção", () => {
  const goal = source("lib/daily-goal.js");
  // Cota da Meta Diária: checa ANTES de criar a linha do dia (reconectar no mesmo dia gera normalmente).
  const generation = between(goal, "async function ensureDailyGoalGenerated(auth, today) {", "const { data: won");
  assert.match(generation, /if \(!\(await isUserEligibleToProspect\(brokerId\)\)\) return;/);
  assert.match(between(goal, "export async function registerDailyGoalAttempt(", "const round = await"), /await assertProspectingParticipation\(auth\);/);

  const extra = source("lib/prospecting-extra-dispatch.js");
  const enqueue = between(extra, "export async function enqueueExtraProspectingDispatch(", "const [{ data: contact");
  assert.ok(enqueue.indexOf("assertProspectingParticipation(auth)") > 0 && enqueue.indexOf("assertProspectingParticipation(auth)") < enqueue.indexOf("loadAvailability(brokerId)"), "barra antes de reservar/enfileirar");
  assert.match(between(extra, "export async function getExtraDispatchStatus(", "}"), /assertProspectingAccess\(auth\)/);

  const prospecting = source("lib/prospecting.js");
  assert.match(between(prospecting, "export async function listProspectingContacts(", "const now"), /assertProspectingAccess\(auth\)/);
  assert.match(between(prospecting, "export async function assignProspectingContacts(", "let assigned = 0"), /assertCanReceiveProspecting\(assignedUserId\)/);
  assert.match(between(prospecting, "export async function updateProspectingContact(", "const { data, error }"), /assertCanReceiveProspecting\(assignedUserId\)/);
  assert.match(between(prospecting, 'if (action === "prospect") {', "if (!registration.prospectingAssignedPending)"), /assertProspectingParticipation\(auth\)/);
  assert.match(between(prospecting, "export async function claimProspectingContact(", "const completion"), /assertProspectingParticipation\(auth\)/);
});

test("fila de disparos: sem sessão conectada não entra na fila (nenhum item novo) e a tela mostra o aviso", () => {
  const auto = source("lib/daily-goal-auto.js");
  const cycle = between(auto, "await ensureDailyGoalGeneratedForBroker(brokerId);", "const result = await dispatchOneForBroker");
  assert.match(cycle, /isSessionOperational\(await getIndividualSessionStatusForUser\(brokerId\)\)\) return \{ brokerId, skipped: "sessao_nao_conectada" \}/);
  assert.ok(cycle.indexOf("sessao_nao_conectada") < cycle.indexOf("enqueueTodayItemsForBroker"), "checa antes de enfileirar");

  const page = source("app/admin/prospeccao/page.jsx");
  assert.match(page, /getProspectingGate\(auth, "access"\)/);
  assert.ok(page.indexOf("<ProspectingConnectGate") < page.indexOf("listProspectingContacts(auth"), "não carrega a base de quem está bloqueado");
  assert.match(source("components/ProspectingConnectGate.jsx"), /crm:open-whatsapp-connect/);
  assert.match(source("components/WhatsappIndividualStatus.jsx"), /addEventListener\("crm:open-whatsapp-connect"/);
});

test("a barreira só impede: nenhuma escrita no banco nem desconexão de sessão", () => {
  const code = source("lib/prospecting-eligibility.js");
  assert.doesNotMatch(code, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(code, /disconnect|logout|sendIndividualMessage/i);
});
