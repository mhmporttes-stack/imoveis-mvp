// SIM-AUTO-ENVIO, lembrete de 20 min (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23): "Depois que enviar a simulação, se o
// cliente responder, encerre o fluxo. Depois de 20 minutos, se o cliente não falar nada, envie uma mensagem".
// Sem envio real: só regras puras e leitura do código-fonte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_FOLLOWUP_EVENTS,
  AUTO_FOLLOWUP_KIND,
  FINAL_AUTO_FOLLOWUP_EVENTS,
  autoFollowupCancelReason,
  autoFollowupClaimKey,
  autoFollowupDueAt,
  autoSendClaimKey,
  buildAutoFollowupText,
  isOfficialWindowOpen
} from "../lib/simulation-auto-send-core.mjs";
import { ATTENDANCE_JOURNEY_EVENTS } from "../lib/client-attendance-core.mjs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("texto do dono: saudação, primeiro nome com capitalização, amigo/amiga e sem nome", () => {
  assert.equal(buildAutoFollowupText("joão da silva", "Boa tarde"), "Boa tarde, João, meu amigo, ficou alguma dúvida relacionada à simulação?");
  assert.equal(buildAutoFollowupText("MARIA APARECIDA", "Bom dia"), "Bom dia, Maria, minha amiga, ficou alguma dúvida relacionada à simulação?");
  // Sexo incerto: mantém o nome e usa "meu amigo" (decisão do dono para o neutro).
  assert.match(buildAutoFollowupText("Kauê", "Boa noite"), /^Boa noite, Kauê, meu amigo, ficou/);
  // Sem nome (ou nome-reserva): "Bom dia, meu amigo, ..."
  assert.equal(buildAutoFollowupText("", "Bom dia"), "Bom dia, meu amigo, ficou alguma dúvida relacionada à simulação?");
  assert.equal(buildAutoFollowupText("Cliente WhatsApp", "Boa tarde"), "Boa tarde, meu amigo, ficou alguma dúvida relacionada à simulação?");
  // Saudação da fonte única, na hora do envio real.
  const server = source("lib/simulation-auto-send.js");
  assert.match(server, /import \{ getTimeGreeting \} from "\.\/daily-report"/);
  assert.match(server, /buildAutoFollowupText\(registration\.full_name, getTimeGreeting\(\)\)/);
});

test("20 min depois do envio; entre 21h e 8h (São Paulo) sai às 8 h", () => {
  assert.equal(autoFollowupDueAt("2026-10-23T13:00:00-03:00").toISOString(), new Date("2026-10-23T13:20:00-03:00").toISOString());
  // 20h50 + 20 min = 21h10 → 8 h do dia seguinte.
  assert.equal(autoFollowupDueAt("2026-10-23T20:50:00-03:00").toISOString(), new Date("2026-10-24T08:00:00-03:00").toISOString());
  // 02h → 8 h do mesmo dia.
  assert.equal(autoFollowupDueAt("2026-10-23T02:00:00-03:00").toISOString(), new Date("2026-10-23T08:00:00-03:00").toISOString());
  assert.equal(autoFollowupDueAt(null), null);
});

test("encerra: cliente respondeu (reação não conta), equipe mandou mensagem humana, status mudado por pessoa", () => {
  const automation = { direction: "outbound", sender_type: "automation", status: "sent", message_type: "audio", metadata: { kind: "client_voice_audio_simulation" } };
  assert.equal(autoFollowupCancelReason({ messagesAfter: [automation] }), null);
  assert.equal(autoFollowupCancelReason({ messagesAfter: [{ direction: "inbound", message_type: "reaction" }] }), null);
  assert.equal(autoFollowupCancelReason({ messagesAfter: [{ direction: "inbound", message_type: "text" }] }), "cliente_respondeu");
  assert.equal(autoFollowupCancelReason({ messagesAfter: [{ direction: "inbound", message_type: "audio" }] }), "cliente_respondeu");
  assert.equal(autoFollowupCancelReason({ messagesAfter: [{ direction: "outbound", sender_type: "user", status: "sent", message_type: "text" }] }), "equipe_respondeu");
  // Mensagem humana que falhou não é contato (isHumanContactMessage).
  assert.equal(autoFollowupCancelReason({ messagesAfter: [{ direction: "outbound", sender_type: "user", status: "failed", message_type: "text" }] }), null);
  assert.equal(autoFollowupCancelReason({ statusChangesAfter: [{ changed_by: "sistema" }] }), null);
  assert.equal(autoFollowupCancelReason({ statusChangesAfter: [{ changed_by: "corretor@exemplo.com" }] }), "status_alterado_pela_equipe");
  // Não contactar/bloqueado/arquivado/Particular: mesmas travas do envio (autoSendSkipReason) encerram o lembrete.
  const server = source("lib/simulation-auto-send.js");
  assert.match(server, /const stop = autoSendSkipReason\(/);
  assert.match(server, /recordFollowupOutcome\(registrationId, "cancelled", \{ reason: cancel \}\)/);
  // Qualquer conversa do cliente: pelo card e pelo telefone.
  assert.match(server, /eq\("client_id", registration\.id\)/);
  assert.match(server, /in\("contact_phone", candidates\)/);
});

test("um único lembrete por cadastro: reserva própria no índice único, nunca reenvia", () => {
  assert.equal(autoFollowupClaimKey("abc"), "simulation-auto-followup:abc");
  assert.notEqual(autoFollowupClaimKey("abc"), autoSendClaimKey("abc"));
  const server = source("lib/simulation-auto-send.js");
  assert.match(server, /claimKey: autoFollowupClaimKey\(registration\.id\)/);
  // Só é programado depois de o envio da simulação sair.
  assert.match(server, /recordOutcome\(registrationId, "sent"[^\n]*\n[^\n]*\n\s*await scheduleAutoSimulationFollowup\(registrationId, result\.audioChannel\)/);
  for (const event of [AUTO_FOLLOWUP_EVENTS.sent, AUTO_FOLLOWUP_EVENTS.cancelled, AUTO_FOLLOWUP_EVENTS.skipped]) assert.ok(FINAL_AUTO_FOLLOWUP_EVENTS.includes(event));
});

test("travas: janela de 24 h do Oficial (com folga de 5 min) e cadência anti-ban do número", () => {
  const now = Date.parse("2026-10-23T12:00:00-03:00");
  assert.equal(isOfficialWindowOpen(new Date(now - 60 * 60 * 1000).toISOString(), now), true);
  assert.equal(isOfficialWindowOpen(new Date(now - (24 * 60 - 3) * 60 * 1000).toISOString(), now), false);
  assert.equal(isOfficialWindowOpen(null, now), false);
  const server = source("lib/simulation-auto-send.js");
  assert.match(server, /reason: "janela_fechada"/);
  assert.match(server, /individualAutomationSendGate\(senderId, \{ slot: details\.slot \|\| 1 \}\)/);
  // O lembrete entra na cadência do número e o eco do celular nunca vira mensagem humana.
  assert.match(source("lib/daily-goal-auto.js"), /AUTO_SIMULATION_SEND_KIND, AUTO_FOLLOWUP_KIND, VOICE_AUDIO_KINDS\.welcome/);
  assert.match(source("lib/whatsapp-form-reminder.js"), /FORM_REMINDER_KIND, AUTO_SIMULATION_SEND_KIND, AUTO_FOLLOWUP_KIND/);
  assert.equal(AUTO_FOLLOWUP_KIND, "simulation_auto_followup");
});

test("linha do tempo: eventos próprios, nenhum conta como atendimento humano", () => {
  for (const event of Object.values(AUTO_FOLLOWUP_EVENTS)) {
    assert.ok(!ATTENDANCE_JOURNEY_EVENTS.includes(event), event);
    assert.match(source("lib/journey-event-labels.mjs"), new RegExp(`case "${event}"`));
  }
});
