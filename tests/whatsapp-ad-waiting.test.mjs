// Cliente do anúncio de WhatsApp (WA-18, regra do dono 2026-10-09): segurado com o dono até responder/preencher,
// sequência de lembretes 1 h / 3 h / 10 h / 23 h (24 horas por dia), backlog dos links anteriores à publicação.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AD_WAITING_DISTRIBUTION, canReleaseAdWaitingClient, hasRepliedAfterAutomation } from "../lib/whatsapp-ad-waiting-core.mjs";
import {
  FORM_REMINDER_BACKLOG_CUTOFF,
  FORM_REMINDER_KIND,
  buildFormReminderText,
  claimKeysForStep,
  currentReminderStep,
  decideFormReminder,
  formReminderClaimKey
} from "../lib/whatsapp-form-reminder-core.mjs";
import { rouletteRuleConditions } from "../lib/simulation-deadline-core.mjs";
import { canReturnToRoulette } from "../lib/simulation-deadline-core.mjs";

const H = 60 * 60 * 1000;
const at = (iso, hours = 0) => new Date(new Date(iso).getTime() + hours * H);

// ---- "respondeu" -------------------------------------------------------------------------------------------------
const opening = { direction: "inbound", sender_type: "customer", message_type: "text", message_at: "2026-10-10T17:00:00Z" };
const greeting = { direction: "outbound", sender_type: "automation", message_type: "text", status: "sent", message_at: "2026-10-10T17:00:05Z" };

test("respondeu: a 1ª mensagem (a do anúncio) não conta; só mensagem do cliente depois da automação", () => {
  assert.equal(hasRepliedAfterAutomation([opening]), false);
  assert.equal(hasRepliedAfterAutomation([opening, greeting]), false);
  assert.equal(hasRepliedAfterAutomation([opening, greeting, { ...opening, message_at: "2026-10-10T17:03:00Z" }]), true);
  assert.equal(hasRepliedAfterAutomation([opening, greeting, { ...opening, message_type: "audio", message_at: "2026-10-10T17:03:00Z" }]), true);
  assert.equal(hasRepliedAfterAutomation([opening, greeting, { ...opening, message_type: "image", message_at: "2026-10-10T17:03:00Z" }]), true);
});

test("respondeu: reação não conta; automação que falhou não abre a contagem", () => {
  assert.equal(hasRepliedAfterAutomation([opening, greeting, { ...opening, message_type: "reaction", message_at: "2026-10-10T17:03:00Z" }]), false);
  assert.equal(hasRepliedAfterAutomation([opening, { ...greeting, status: "failed" }, { ...opening, message_at: "2026-10-10T17:03:00Z" }]), false);
});

test("só sai do 'segurado' quem está segurado; resposta só em Atendimento automático; nunca arquivado/Não contactar", () => {
  const waiting = { distribution_type: AD_WAITING_DISTRIBUTION, status: "automated_service" };
  assert.equal(canReleaseAdWaitingClient(waiting, { via: "reply" }), true);
  assert.equal(canReleaseAdWaitingClient({ ...waiting, status: "in_service" }, { via: "reply" }), false);
  assert.equal(canReleaseAdWaitingClient({ ...waiting, status: "pending" }, { via: "form" }), true);
  assert.equal(canReleaseAdWaitingClient({ ...waiting, status: "do_not_contact" }, { via: "form" }), false);
  assert.equal(canReleaseAdWaitingClient({ ...waiting, status: "archived" }, { via: "reply" }), false);
  assert.equal(canReleaseAdWaitingClient({ distribution_type: "round_robin", status: "automated_service" }, { via: "reply" }), false);
});

test("segurado fica fora da REDISTRIBUIÇÃO (não é round_robin) e fora da fila de espera (sem pending_distribution_at)", () => {
  assert.equal(canReturnToRoulette({ distribution_type: AD_WAITING_DISTRIBUTION, primary_monthly_income: 0 }), false);
  const lib = readFileSync(new URL("../lib/whatsapp-sponsored-lead.js", import.meta.url), "utf8");
  // cadastro com o dono pela função de banco do canal direto (nunca sorteia), depois a marca de "aguardando anúncio"
  assert.match(lib, /whatsapp_get_or_create_client_for_broker[\s\S]*p_broker_id: ownerId/);
  assert.match(lib, /update\(\{ distribution_type: AD_WAITING_DISTRIBUTION \}\)/);
  // a distribuição só acontece depois de responder (webhook/cron) ou preencher (formulário)
  assert.match(lib, /context\.kind === SPONSORED_KIND && !\(await conversationHasReply\(conversation\.id\)\)/);
  const reg = readFileSync(new URL("../lib/simulation-registrations.js", import.meta.url), "utf8");
  assert.equal((reg.match(/if \(adWaiting\) await releaseAdWaitingAfterForm\(existing\.id, assignment\);/g) || []).length, 2);
  const flows = readFileSync(new URL("../lib/whatsapp-flows.js", import.meta.url), "utf8");
  assert.match(flows, /distribution_type === AD_WAITING_DISTRIBUTION \? null/); // link público, nunca o link pessoal do dono
});

test("REDISTRIBUIÇÃO cobre quem entrou na roleta ao responder (Atendimento automático, sem dados), não retroativo", () => {
  const conditions = [{ type: "status_equals", value: "pending" }];
  const client = { acquisition_context: { kind: "whatsapp_ad" }, status: "automated_service", primary_monthly_income: 0, responsible_changed_at: "2026-10-10T12:00:00Z", distribution_type: "round_robin" };
  assert.deepEqual(rouletteRuleConditions(conditions, client), []);
  assert.deepEqual(rouletteRuleConditions(conditions, { ...client, responsible_changed_at: "2026-10-08T12:00:00Z", created_at: "2026-10-08T12:00:00Z" }), conditions);
  assert.deepEqual(rouletteRuleConditions(conditions, { ...client, acquisition_context: { kind: "whatsapp_organic" } }), conditions);
  assert.deepEqual(rouletteRuleConditions(conditions, { ...client, status: "in_service" }), conditions);
  // sem resposta humana e sem contato: pode voltar; corretor respondeu no Chat: fica
  assert.equal(canReturnToRoulette(client, { humanAttended: false }), true);
  assert.equal(canReturnToRoulette(client, { humanAttended: true }), false);
});

// ---- sequência de lembretes ------------------------------------------------------------------------------------
const LINK_AT = "2026-10-10T17:00:00.000Z"; // depois da publicação
const adOrigin = { kind: "meta_ad", referral: { source_type: "ad", source_id: "52550704071153" } };

function adInput(overrides = {}) {
  return {
    link: { id: "m1", message_at: LINK_AT, channel: "whatsapp_cloud_api" },
    conversation: { client_id: "c1", status: "open", last_inbound_at: "2026-10-10T16:59:00.000Z", last_human_reply_at: null, deleted_at: null, origin: adOrigin },
    client: { status: "automated_service", last_form_submitted_at: null },
    phoneRegistrations: [{ id: "c1", status: "automated_service", created_at: "2026-10-10T16:59:10.000Z", last_form_submitted_at: null }],
    messagesAfter: [],
    auditsAfter: [],
    channel: { kind: "official", officialConfigured: true },
    ...overrides
  };
}

test("textos da sequência: sem emoji, primeiro nome, 'associado'", () => {
  assert.equal(buildFormReminderText("ana souza", "1h"), "Oi, Ana, tudo bem? Notei que você ainda não preencheu o formulário. Ficou com alguma dúvida ou teve alguma dificuldade?");
  assert.equal(buildFormReminderText("ana", "3h"), "Ana, leva menos de 2 minutos e já te mostro quanto você consegue financiar e os imóveis que cabem no seu bolso. Quer que eu te ajude por aqui?");
  assert.equal(buildFormReminderText("ana", "10h"), "Ana, ainda está aí? Se preferir, me responde aqui mesmo e um associado te atende agora.");
  assert.equal(buildFormReminderText("ana", "23h"), "Ana, vou deixar seu atendimento reservado até amanhã. É só me responder quando puder.");
  assert.match(buildFormReminderText("Cliente WhatsApp", "3h"), /^Leva menos/);
  for (const step of ["1h", "3h", "10h", "23h"]) assert.doesNotMatch(buildFormReminderText("Ana", step), /\p{Extended_Pictographic}/u);
});

test("cada etapa no seu horário (1 h, 3 h, 10 h, 23 h do link), inclusive de madrugada", () => {
  const plan = (hours) => decideFormReminder(adInput(), at(LINK_AT, hours));
  assert.equal(plan(0.9).action, "wait");
  assert.deepEqual([plan(1).step, plan(1).claimKey, plan(1).action], ["1h", "form-reminder:m1:1h", "send"]);
  assert.equal(plan(3).step, "3h");
  assert.equal(plan(10).step, "10h"); // 03:00 SP — sem silêncio noturno
  assert.equal(plan(23).step, "23h");
  assert.equal(plan(2.5).step, "1h");
  assert.equal(plan(7).action, "skip"); // 3 h atrasada demais e a de 10 h ainda não chegou
  assert.equal(plan(7).reason, "atrasado_demais");
});

test("idempotência por etapa; lembretes anteriores não bloqueiam a próxima", () => {
  const sent1 = { direction: "outbound", sender_type: "automation", metadata: { kind: FORM_REMINDER_KIND, form_reminder_step: "1h" } };
  assert.equal(decideFormReminder(adInput({ claimedKeys: ["form-reminder:m1:1h"] }), at(LINK_AT, 1.1)).reason, "ja_enviado");
  assert.equal(decideFormReminder(adInput({ claimedKeys: ["form-reminder:m1"] }), at(LINK_AT, 1.1)).reason, "ja_enviado"); // lembrete único antigo
  assert.equal(decideFormReminder(adInput({ claimedKeys: ["form-reminder:m1:1h"], messagesAfter: [sent1] }), at(LINK_AT, 3.1)).action, "send");
  assert.deepEqual(claimKeysForStep("m1", "3h"), ["form-reminder:m1:3h"]);
  assert.equal(formReminderClaimKey("m1", "23h"), "form-reminder:m1:23h");
});

test("para quando o cliente responde (reação não), preenche, ou um humano atende; nunca Não contactar/arquivado", () => {
  const now = at(LINK_AT, 3.1);
  assert.equal(decideFormReminder(adInput({ messagesAfter: [{ direction: "inbound", message_type: "text" }] }), now).reason, "cliente_respondeu");
  assert.equal(decideFormReminder(adInput({ messagesAfter: [{ direction: "inbound", message_type: "reaction" }] }), now).action, "send");
  assert.equal(decideFormReminder(adInput({ client: { status: "pending", last_form_submitted_at: "2026-10-10T18:00:00Z" } }), now).reason, "formulario_preenchido");
  assert.equal(decideFormReminder(adInput({ messagesAfter: [{ direction: "outbound", sender_type: "user" }] }), now).reason, "humano_respondeu");
  assert.equal(decideFormReminder(adInput({ auditsAfter: [{ action: "assumed" }] }), now).reason, "humano_assumiu");
  assert.equal(decideFormReminder(adInput({ client: { status: "do_not_contact" } }), now).reason, "cliente_arquivado_ou_nao_contactar");
  assert.equal(decideFormReminder(adInput({ client: { status: "archived" } }), now).reason, "cliente_arquivado_ou_nao_contactar");
  assert.equal(decideFormReminder(adInput({ isTeamPhone: true }), now).reason, "numero_da_equipe");
});

test("número oficial: só dentro das 24 h da última mensagem do cliente; a de 23 h sai se a janela ainda estiver aberta", () => {
  assert.equal(decideFormReminder(adInput(), at(LINK_AT, 23)).action, "send"); // cliente escreveu 16:59, janela até 16:54 do dia seguinte
  const late = adInput({ conversation: { ...adInput().conversation, last_inbound_at: "2026-10-10T15:00:00Z" } });
  assert.equal(decideFormReminder(late, at(LINK_AT, 23)).reason, "janela_fechada");
});

// ---- backlog ---------------------------------------------------------------------------------------------------
test("backlog: 1ª sai logo depois da publicação; as seguintes contam do envio da 1ª", () => {
  const oldLink = { id: "old", message_at: at(FORM_REMINDER_BACKLOG_CUTOFF, -10).toISOString() };
  const input = (extra = {}) => adInput({ phoneRegistrations: [], link: oldLink, conversation: { ...adInput().conversation, last_inbound_at: at(FORM_REMINDER_BACKLOG_CUTOFF, -10.1).toISOString() }, ...extra });
  const first = decideFormReminder(input(), at(FORM_REMINDER_BACKLOG_CUTOFF, 0.1));
  assert.deepEqual([first.action, first.step], ["send", "1h"]);
  const firstSentAt = at(FORM_REMINDER_BACKLOG_CUTOFF, 0.5).toISOString();
  // sem a 1ª enviada não há as seguintes
  assert.equal(currentReminderStep({ link: oldLink, ad: true }, at(FORM_REMINDER_BACKLOG_CUTOFF, 3)).step, "1h");
  // 3 h = 2 h depois da 1ª; 10 h = 9 h depois; 23 h = 22 h depois
  assert.equal(currentReminderStep({ link: oldLink, ad: true, firstSentAt }, at(firstSentAt, 1.9)).step, "1h");
  assert.equal(currentReminderStep({ link: oldLink, ad: true, firstSentAt }, at(firstSentAt, 2)).step, "3h");
  assert.equal(currentReminderStep({ link: oldLink, ad: true, firstSentAt }, at(firstSentAt, 9)).step, "10h");
  assert.equal(currentReminderStep({ link: oldLink, ad: true, firstSentAt }, at(firstSentAt, 22)).step, "23h");
});

test("backlog: só quem escreveu nas últimas 24 h; não respondeu/não foi atendido/não preencheu; lembrete único também", () => {
  const oldLink = { id: "old", message_at: at(FORM_REMINDER_BACKLOG_CUTOFF, -30).toISOString() };
  const now = at(FORM_REMINDER_BACKLOG_CUTOFF, 0.1);
  const stale = adInput({ link: oldLink, conversation: { ...adInput().conversation, last_inbound_at: at(FORM_REMINDER_BACKLOG_CUTOFF, -30.1).toISOString() }, channel: { kind: "individual", individualAllowed: true } });
  assert.equal(decideFormReminder(stale, now).reason, "backlog_fora_das_24h");
  const recentLink = { id: "r", message_at: at(FORM_REMINDER_BACKLOG_CUTOFF, -5).toISOString() };
  const fresh = { ...adInput().conversation, last_inbound_at: at(FORM_REMINDER_BACKLOG_CUTOFF, -5.1).toISOString() };
  assert.equal(decideFormReminder(adInput({ link: recentLink, conversation: fresh, messagesAfter: [{ direction: "outbound", sender_type: "user" }] }), now).reason, "humano_respondeu");
  // conversa que não é de anúncio: o lembrete único (WA-17) também entra no backlog
  const single = decideFormReminder(adInput({ phoneRegistrations: [], link: recentLink, conversation: { ...fresh, origin: null } }), now);
  assert.deepEqual([single.action, single.step, single.claimKey], ["send", "", "form-reminder:r"]);
  // link de 20 min antes da publicação: 1ª só depois de completar 1 h
  const nearLink = { id: "n", message_at: at(FORM_REMINDER_BACKLOG_CUTOFF, -1 / 3).toISOString() };
  assert.equal(decideFormReminder(adInput({ link: nearLink, conversation: fresh }), now).action, "wait");
});
