// SIM-AUTO-ENVIO (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23): envio automático da simulação automática.
// Sem envio real: só regras puras e leitura do código-fonte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_SEND_EVENTS,
  AUTO_SIMULATION_SEND_KIND,
  FINAL_AUTO_SEND_EVENTS,
  autoSendClaimKey,
  autoSendJourneyText,
  autoSendSkipReason,
  closedWindowRoute,
  decideAutoSendChannel,
  isWaitReason,
  pickOfflineConnectedBroker
} from "../lib/simulation-auto-send-core.mjs";
import { ATTENDANCE_JOURNEY_EVENTS } from "../lib/client-attendance-core.mjs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-23T12:00:00-03:00");
const hoursAgo = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString();

test("canal: Oficial com janela aberta, número do corretor, janela fechada e ninguém (dono)", () => {
  const official = { conversationId: "of-1", lastInboundAt: hoursAgo(1) };
  const broker = { conversationId: "br-1", lastInboundAt: hoursAgo(2), slot: 2 };
  assert.deepEqual(decideAutoSendChannel({ official, nowMs: NOW }), { kind: "official", conversationId: "of-1" });
  assert.deepEqual(decideAutoSendChannel({ broker, nowMs: NOW }), { kind: "broker", conversationId: "br-1", slot: 2 });
  // A mensagem mais recente do cliente decide.
  assert.equal(decideAutoSendChannel({ official, broker, nowMs: NOW }).kind, "official");
  assert.equal(decideAutoSendChannel({ official: { ...official, lastInboundAt: hoursAgo(3) }, broker, nowMs: NOW }).kind, "broker");
  // Oficial fora da janela de 24 h: nunca manda pelo Oficial (sem modelo aprovado).
  assert.deepEqual(decideAutoSendChannel({ official: { ...official, lastInboundAt: hoursAgo(25) }, nowMs: NOW }), { kind: "official_closed" });
  // Não chamou ninguém → WhatsApp individual do dono.
  assert.deepEqual(decideAutoSendChannel({ nowMs: NOW }), { kind: "owner" });
  assert.deepEqual(decideAutoSendChannel({ official: { conversationId: "x", lastInboundAt: null }, nowMs: NOW }), { kind: "owner" });
});

test("janela fechada: responsável com WhatsApp conectado fica; senão roleta (on-line primeiro, depois conectado off-line)", () => {
  assert.deepEqual(closedWindowRoute({ responsibleId: "b1", responsibleConnected: true }), { kind: "responsible", brokerId: "b1" });
  assert.deepEqual(closedWindowRoute({ responsibleId: "b1", responsibleConnected: false }), { kind: "roulette" });
  assert.deepEqual(closedWindowRoute({ responsibleId: "", responsibleConnected: true }), { kind: "roulette" });
  assert.equal(pickOfflineConnectedBroker([
    { id: "b", lastReceivedAt: "2026-10-23T10:00:00Z" },
    { id: "a", lastReceivedAt: null },
    { id: "c", lastReceivedAt: "2026-10-22T10:00:00Z" }
  ]), "a");
  assert.equal(pickOfflineConnectedBroker([{ id: "b", lastReceivedAt: "2026-10-23T10:00:00Z" }, { id: "c", lastReceivedAt: "2026-10-22T10:00:00Z" }]), "c");
  assert.equal(pickOfflineConnectedBroker([]), null);
  const server = source("lib/simulation-auto-send.js");
  // Roleta de sempre (on-line + WhatsApp conectado + ROL-2h) antes; off-line só com reserva da ROL-2h.
  const picker = server.split("async function pickClosedWindowBroker()")[1].split("\n}\n")[0];
  assert.ok(picker.indexOf("assignRoundRobinLead()") < picker.indexOf("filterRouletteCooldownFreeIds"));
  assert.ok(picker.indexOf("filterRouletteCooldownFreeIds") < picker.indexOf("claimRouletteReceipt"));
  assert.match(picker, /whatsapp_restrictions/);
  // Entrega grava o "de quem" (FUN-15h) e avisa o corretor.
  assert.match(server, /recordLeadDistributionHistory\(\{[\s\S]{0,200}fromUserId: registration\.responsible_user_id/);
});

test("travas: Não contactar, telefone bloqueado, arquivado, Particular, equipe, sem telefone e sem valores nunca recebem", () => {
  const ok = { id: "r1", status: "auto_simulation", private_contact_at: null };
  assert.equal(autoSendSkipReason({ registration: ok, phone: "5514999990000" }), null);
  assert.equal(autoSendSkipReason({ registration: { ...ok, status: "do_not_contact" }, phone: "5514999990000" }), "nao_contactar");
  assert.equal(autoSendSkipReason({ registration: ok, doNotContactReason: "telefone_nao_contactar", phone: "5514999990000" }), "nao_contactar");
  assert.equal(autoSendSkipReason({ registration: { ...ok, status: "archived" }, phone: "5514999990000" }), "arquivado");
  assert.equal(autoSendSkipReason({ registration: { ...ok, private_contact_at: "2026-10-23" }, phone: "5514999990000" }), "particular");
  assert.equal(autoSendSkipReason({ registration: ok, phone: "" }), "sem_telefone");
  assert.equal(autoSendSkipReason({ registration: ok, phone: "5514999990000", isTeamPhone: true }), "telefone_da_equipe");
  assert.equal(autoSendSkipReason({ registration: ok, phone: "5514999990000", hasScenes: false }), "simulacao_sem_valores");
  assert.equal(autoSendSkipReason({ registration: null }), "cadastro_inexistente");
  const server = source("lib/simulation-auto-send.js");
  assert.match(server, /findDoNotContactInboundBlock\(phone, registration\.id\)/);
  assert.match(server, /findInternalTeamPhone\(phone\)/);
});

test("um envio por CADASTRO (reserva no índice único), nunca por telefone; falha nunca reenviada", () => {
  assert.equal(autoSendClaimKey("abc"), "simulation-auto-send:abc");
  assert.ok(FINAL_AUTO_SEND_EVENTS.includes(AUTO_SEND_EVENTS.sent));
  assert.ok(FINAL_AUTO_SEND_EVENTS.includes(AUTO_SEND_EVENTS.failed));
  assert.ok(!FINAL_AUTO_SEND_EVENTS.includes(AUTO_SEND_EVENTS.pending));
  const server = source("lib/simulation-auto-send.js");
  assert.equal((server.match(/claimKey: autoSendClaimKey\(registration\.id\)/g) || []).length, 2);
  assert.match(server, /sendReservedAutomationMessage/);
  assert.doesNotMatch(server, /phone_normalized.*unique|UNIQUE/i);
});

test("cadência anti-ban: mesma trava da automação (janela, 5 min, teto, pausa, espera pós-conexão) e uso somado ao do número", () => {
  for (const reason of ["fora_do_horario_extra", "fim_de_semana", "intervalo_minimo_politica", "teto_diario_politica", "aguardando_apos_reconexao"]) assert.equal(isWaitReason(reason), true);
  for (const reason of ["whatsapp_nao_conectado", "numero_pausado", "automacao_pausada", "acesso_whatsapp_bloqueado"]) assert.equal(isWaitReason(reason), false);
  const auto = source("lib/daily-goal-auto.js");
  assert.match(auto, /export async function individualAutomationSendGate\(/);
  const gate = auto.split("export async function individualAutomationSendGate(")[1].split("\n}\n")[0];
  for (const piece of ["isIndividualChatSendDisabled", "isWhatsappAccessBlocked", "settingsRow?.paused", "applyPolicyV2", "extraSendBlockReason", "listPausedSlots", "slotsPastReconnectWait", "loadV2Usage", "v2SendBlockReason"]) {
    assert.ok(gate.includes(piece), `trava sem ${piece}`);
  }
  // Os envios automáticos da simulação entram no uso do dia do número (teto/intervalo da Meta Diária e da fila extra).
  assert.match(auto, /loadAutoSimulationSendUsageRows\(brokerId, dayStart\)/);
  assert.match(auto, /\.eq\("metadata->>kind", AUTO_SIMULATION_SEND_KIND\)/);
  assert.match(source("lib/simulation-auto-send.js"), /individualAutomationSendGate\(senderId, \{ slot \}\)/);
});

test("mensagem = a mesma do envio manual (só o link); eco do celular nunca vira mensagem humana", () => {
  const server = source("lib/simulation-auto-send.js");
  assert.match(server, /buildPresentationSendMessage\(\{ link \}\)/);
  assert.doesNotMatch(server, /text: "[A-ZÀ-Ú]/); // nenhum texto novo para o cliente
  assert.match(source("lib/whatsapp-form-reminder.js"), /\.in\("metadata->>kind", \[FORM_REMINDER_KIND, AUTO_SIMULATION_SEND_KIND\]\)/);
  assert.equal(AUTO_SIMULATION_SEND_KIND, "simulation_auto_send");
});

test("linha do tempo: eventos próprios, nenhum conta como atendimento humano; contagem para o Henry", () => {
  for (const event of Object.values(AUTO_SEND_EVENTS)) assert.ok(!ATTENDANCE_JOURNEY_EVENTS.includes(event), event);
  assert.match(autoSendJourneyText("sent", { channel: "owner" }), /enviada automaticamente pelo WhatsApp do Matheus/);
  assert.match(autoSendJourneyText("failed", { channel: "official", reason: "falha_envio" }), /Não será reenviado sozinho/);
  assert.match(autoSendJourneyText("skipped", { reason: "nao_contactar" }), /Não contactar/);
  const server = source("lib/simulation-auto-send.js");
  assert.match(server, /export async function countAutoSimulationSendsSince\(sinceIso\) \{[\s\S]{0,300}\.eq\("event_type", AUTO_SEND_EVENTS\.sent\)[\s\S]{0,60}\.gte\("occurred_at", sinceIso\)/);
  assert.match(source("lib/henry-morning.js"), /countAutoSimulationSendsSince\(sinceIso\)/);
  const timeline = source("components/ClientJourneyActions.jsx");
  for (const event of Object.values(AUTO_SEND_EVENTS)) assert.match(timeline, new RegExp(`case "${event}":`));
});
