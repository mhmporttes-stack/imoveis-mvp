import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADMIN_QUIET_SOURCES, ALERT_KIND, isAdminQuietAlert, quietImportantForAdmins, splitPendingAlerts } from "../lib/crm-alerts-core.mjs";
import { SERVICE_STALL_ALERT_KEY, buildServiceStallDeliveries, fixLegacyHostHint } from "../lib/whatsapp-service-stall-core.mjs";
import { SELF_CONNECTION_ALERT_KEY, OWNER_DISCONNECT_ALERT_KEY } from "../lib/whatsapp-connection-alert-core.mjs";
import { WHATSAPP_SESSION_ATTENTION_KEY } from "../lib/whatsapp-session-attention-core.mjs";
import { FALSE_CONNECTION_ALERT_KEY } from "../lib/whatsapp-false-connection-core.mjs";
import { REDISTRIBUTION_JOB_ID, EXTENSION_SIGNAL_ID } from "../lib/marketplace-chat-core.mjs";
import { NUMBER_PAUSED_ALERT_KEY, QUEUE_PROBLEM_ALERT_KEY } from "../lib/daily-goal-protection-core.mjs";
import { SERVICE_UNREACHABLE_ADMIN_BODY, serviceUnreachableDedupeKey } from "../lib/whatsapp-chat-assist-core.mjs";
import { awaitingCustomerNotice, isBlockedOnlyByDisconnection, isConnectedOwnClientFirstMessageAllowed } from "../lib/distribution-first-message-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-31] Admin geral nunca é bloqueado por alerta de supervisão/infraestrutura (AL-ADM).
const ADMIN = "dono";
const CAROL = "carol";
const important = (recipient_id, extra = {}) => ({ recipient_id, kind: ALERT_KIND.IMPORTANT, body: "x", dedupe_key: "k", created_at: new Date().toISOString(), ...extra });

test("as chaves da regra batem com as constantes dos módulos que geram os alertas", () => {
  for (const key of [SERVICE_STALL_ALERT_KEY, SELF_CONNECTION_ALERT_KEY, OWNER_DISCONNECT_ALERT_KEY, WHATSAPP_SESSION_ATTENTION_KEY, FALSE_CONNECTION_ALERT_KEY, REDISTRIBUTION_JOB_ID, EXTENSION_SIGNAL_ID, NUMBER_PAUSED_ALERT_KEY, QUEUE_PROBLEM_ALERT_KEY, "whatsapp_service_unreachable", "marketplace_outbound_failed", "henry_lock"]) {
    assert.ok(ADMIN_QUIET_SOURCES.includes(key), key);
  }
});

test("dono: todos os alertas de infraestrutura chegam como Informativo; Carol e corretor continuam Importantes", () => {
  for (const source of ADMIN_QUIET_SOURCES) {
    const [forAdmin, forCarol, forBroker] = quietImportantForAdmins([important(ADMIN, { context: { source } }), important(CAROL, { context: { source } }), important("corretor", { context: { source } })], new Set([ADMIN]));
    assert.equal(forAdmin.kind, ALERT_KIND.INFORMATIVE, source);
    assert.equal(forCarol.kind, ALERT_KIND.IMPORTANT, source);
    assert.equal(forBroker.kind, ALERT_KIND.IMPORTANT, source);
  }
});

test("dono: 'WhatsApp fora do ar' (chave wa_svc_unreachable) não bloqueia", () => {
  const out = quietImportantForAdmins([important(ADMIN, { context: {}, dedupe_key: serviceUnreachableDedupeKey() })], new Set([ADMIN]));
  assert.equal(out[0].kind, ALERT_KIND.INFORMATIVE);
});

test("o que exige ação do dono continua bloqueando: motivo do cliente frio, teste, novidade do Manual", () => {
  const rows = [
    important(ADMIN, { context: { type: "cooled_client" }, dedupe_key: "cooled_client:1:1" }),
    important(ADMIN, { context: { test: true }, dedupe_key: "test:important:1" }),
    important(ADMIN, { context: { news_id: "n" }, dedupe_key: "manual_news:n:v1" })
  ];
  assert.ok(quietImportantForAdmins(rows, new Set([ADMIN])).every((row) => row.kind === ALERT_KIND.IMPORTANT));
  assert.equal(isAdminQuietAlert(rows[0]), false);
});

test("alerta já gravado como Importante e pendente: ao ler pelo dono, não entra na lista que bloqueia", () => {
  const stored = [important(ADMIN, { id: "a", context: { source: "whatsapp_service_unreachable" } }), important(ADMIN, { id: "b", context: { type: "cooled_client" }, dedupe_key: "cooled_client:1:1" })];
  const { important: blocking } = splitPendingAlerts(quietImportantForAdmins(stored, new Set([ADMIN])));
  assert.deepEqual(blocking.map((row) => row.id), ["b"]);
  // Gestora lendo o mesmo tipo de alerta: continua bloqueando.
  const carol = splitPendingAlerts(quietImportantForAdmins([important(CAROL, { id: "c", context: { source: "whatsapp_service_unreachable" } })], new Set([ADMIN])));
  assert.deepEqual(carol.important.map((row) => row.id), ["c"]);
});

test("texto do aviso: nada de Railway, aponta o computador do WhatsApp", () => {
  assert.doesNotMatch(SERVICE_UNREACHABLE_ADMIN_BODY, /Railway/);
  assert.match(SERVICE_UNREACHABLE_ADMIN_BODY, /computador do WhatsApp/);
  const decision = { stalled: true, minutes: 7, episode: "2026-10-31T12:00:00.000Z", dedupeKey: "k" };
  const [delivery] = buildServiceStallDeliveries({ recipientIds: [ADMIN], decision });
  assert.doesNotMatch(delivery.body, /Railway/);
  // Definição antiga gravada no banco e aviso antigo pendente: a frase é trocada na exibição.
  const old = 'Uma mensagem do Chat não saiu. Verifique o serviço no Railway; a mensagem pode ser reenviada no Chat com "Tentar de novo".';
  assert.equal(fixLegacyHostHint(old), 'Uma mensagem do Chat não saiu. Confira o computador do WhatsApp (serviço MM WhatsApp dos corretores); a mensagem pode ser reenviada no Chat com "Tentar de novo".');
  const [fromDefinition] = buildServiceStallDeliveries({ definition: { body_template: "Parou há {minutos} min. Verifique o serviço no Railway." }, recipientIds: [ADMIN], decision });
  assert.equal(fromDefinition.body, "Parou há 7 min. Confira o computador do WhatsApp (serviço MM WhatsApp dos corretores).");
});

test("Chat: WhatsApp desconectado mostra aviso próprio; cliente que não escreveu mantém o texto de sempre", () => {
  const client = { responsible_user_id: "gab", pending_distribution_at: null, status: "new" };
  const base = { client, sessionOwnerId: "gab", sessionOwnerRole: "broker", phoneBlocked: false };
  // Desconectado: só a conexão impede (conectado liberaria).
  assert.equal(isBlockedOnlyByDisconnection({ ...base, sessionStatus: "disconnected" }), true);
  assert.equal(isConnectedOwnClientFirstMessageAllowed({ ...base, sessionStatus: "disconnected" }), false);
  // Conectado: nada a avisar. Outros motivos (fila de espera, Não contactar, telefone bloqueado, outro responsável) não são desconexão.
  assert.equal(isBlockedOnlyByDisconnection({ ...base, sessionStatus: "connected" }), false);
  assert.equal(isBlockedOnlyByDisconnection({ ...base, sessionStatus: "disconnected", client: { ...client, pending_distribution_at: "2026-10-31T10:00:00Z" } }), false);
  assert.equal(isBlockedOnlyByDisconnection({ ...base, sessionStatus: "disconnected", client: { ...client, status: "do_not_contact" } }), false);
  assert.equal(isBlockedOnlyByDisconnection({ ...base, sessionStatus: "disconnected", phoneBlocked: true }), false);
  assert.equal(isBlockedOnlyByDisconnection({ ...base, sessionStatus: "disconnected", sessionOwnerId: "outro" }), false);
  const mine = awaitingCustomerNotice({ disconnected: true, isOwner: true });
  assert.equal(`${mine.title} — ${mine.body}`, "Seu WhatsApp está desconectado — Reconecte em Chat › WhatsApp (Conectar) para enviar pelo CRM.");
  assert.match(awaitingCustomerNotice({ disconnected: true, isOwner: false }).title, /do corretor/);
  assert.equal(awaitingCustomerNotice({ disconnected: false }), null);
});

test("a tela usa o aviso novo só quando o servidor diz 'disconnected' e mantém o texto antigo no resto", () => {
  const chat = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(chat, /awaitingReason === "disconnected"/);
  assert.match(chat, /Este cliente ainda não escreveu para você\./);
  const lib = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(lib, /awaitingReason = state\.awaitingCustomer && firstMessage\.disconnectedOnly/);
});
