// Cliente do anúncio de WhatsApp (WA-18, regra do dono 2026-10-09): segurado com o dono até responder/preencher,
// sequência de lembretes 1 h / 3 h / 10 h (23 h cortada e 21h–8h → 8 h desde 2026-10-12), backlog dos links anteriores à publicação.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AD_WAITING_DISTRIBUTION, SILENCE_TRANSFER_SINCE, adReleaseVia, silenceTransferCutoffMs, canReleaseAdWaitingClient, decideSilenceTransfer, hasRepliedAfterAutomation } from "../lib/whatsapp-ad-waiting-core.mjs";
import {
  AD_REMINDER_STEPS,
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

test("textos da sequência (dossiê 2026-10-12): voz da equipe, com e sem nome, até 1024 caracteres, no máximo 1 emoji", () => {
  assert.equal(buildFormReminderText("ana souza", "1h"), "Ana, conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio.");
  assert.equal(buildFormReminderText("Cliente WhatsApp", "1h"), "Conseguiu abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio.");
  assert.equal(buildFormReminderText("ana", "3h"), "Só lembrando: com a simulação você já fica sabendo quanto pode financiar e a parcela pro seu caso. Não pede CPF e é sem compromisso. É só tocar em Fazer simulação, na primeira mensagem que te mandamos.");
  assert.equal(buildFormReminderText("ana", "10h"), "Ana, esse é nosso último lembrete sobre o link da simulação 🙂 Se você trabalha sem carteira ou não tem nada guardado, pode fazer do mesmo jeito. Se preferir conversar, é só responder aqui que a nossa equipe te responde.");
  assert.match(buildFormReminderText("", "10h"), /^Esse é nosso último lembrete/);
  assert.equal(buildFormReminderText("ana", "10h", { morning: true }), "Bom dia, Ana! Passando pra lembrar da simulação que te mandamos: ela mostra quanto você pode financiar e a parcela, sem CPF e sem compromisso. Se ficou alguma dúvida, é só responder aqui, escrita ou em áudio.");
  assert.match(buildFormReminderText("", "3h", { morning: true }), /^Bom dia! Passando/);
  const longName = "Maximiliano Alexandre de Souza";
  for (const step of ["", "1h", "3h", "10h"]) {
    for (const morning of [false, true]) {
      const text = buildFormReminderText(longName, step, { morning });
      assert.ok(text.length <= 1024, `${step} ${morning}`);
      assert.ok((text.match(/\p{Extended_Pictographic}/gu) || []).length <= 1);
      assert.doesNotMatch(text, /assistente virtual|associado/i);
    }
  }
});

test("cada etapa no seu horário (1 h, 3 h, 10 h do link); a de 23 h não existe mais", () => {
  const plan = (hours) => decideFormReminder(adInput(), at(LINK_AT, hours)); // link 14:00 SP
  assert.equal(plan(0.9).action, "wait");
  assert.deepEqual([plan(1).step, plan(1).claimKey, plan(1).action], ["1h", "form-reminder:m1:1h", "send"]);
  assert.equal(plan(3).step, "3h");
  assert.equal(plan(2.5).step, "1h");
  assert.equal(plan(7).action, "skip"); // 3 h atrasada demais e a de 10 h ainda não chegou
  assert.equal(plan(7).reason, "atrasado_demais");
  // 10 h venceria 00:00 SP → 08:00 SP do dia seguinte, com o texto fixo
  assert.equal(plan(10).reason, "atrasado_demais"); // 00:00: só a de 3 h já venceu (e está atrasada)
  const morning = plan(18);
  assert.deepEqual([morning.action, morning.step, morning.claimKey, morning.morning], ["send", "10h", "form-reminder:m1:10h", true]);
  for (let hours = 0; hours <= 30; hours += 0.25) assert.notEqual(plan(hours).step, "23h");
});

test("madrugada: lead às 20h → UMA mensagem às 8 h, texto fixo, chave :10h (nunca o texto de 10 h)", () => {
  const link = { id: "m1", message_at: "2026-10-12T23:00:00.000Z" }; // segunda 20:00 SP
  const conversation = { ...adInput().conversation, last_inbound_at: "2026-10-12T22:59:00.000Z" };
  const input = (extra = {}) => adInput({ link, conversation, ...extra });
  for (let hours = 0; hours < 12; hours += 0.25) assert.equal(decideFormReminder(input(), at(link.message_at, hours)).action, "wait", String(hours));
  const at8 = decideFormReminder(input(), new Date("2026-10-13T11:00:30Z"));
  assert.deepEqual(at8, { action: "send", reason: "ok", channel: "official", step: "10h", claimKey: "form-reminder:m1:10h", morning: true });
  // depois de enviada, nada mais
  const sentAt = "2026-10-13T11:00:40Z";
  const after = input({ claimedKeys: ["form-reminder:m1:10h"], lastSent: { index: 2, sentAt } });
  for (let hours = 0; hours < 6; hours += 0.5) assert.notEqual(decideFormReminder(after, at(sentAt, hours)).action, "send");
});

test("lead às 6h30 → 8 h (texto fixo) e a de 3 h às 10 h (2 h mínimas entre lembretes)", () => {
  const link = { id: "m1", message_at: "2026-10-13T09:30:00.000Z" }; // terça 06:30 SP
  const conversation = { ...adInput().conversation, last_inbound_at: "2026-10-13T09:29:00.000Z" };
  const first = decideFormReminder(adInput({ link, conversation }), new Date("2026-10-13T11:00:30Z"));
  assert.deepEqual([first.step, first.morning], ["1h", true]);
  assert.equal(decideFormReminder(adInput({ link, conversation }), new Date("2026-10-13T10:59:00Z")).action, "wait");
  const sent = { claimedKeys: ["form-reminder:m1:1h"], lastSent: { index: 0, sentAt: "2026-10-13T11:00:30Z" } };
  // 09:30 (link + 3 h): ainda não — falta 2 h desde o das 8 h
  assert.notEqual(decideFormReminder(adInput({ link, conversation, ...sent }), new Date("2026-10-13T12:30:30Z")).action, "send");
  const third = decideFormReminder(adInput({ link, conversation, ...sent }), new Date("2026-10-13T13:00:40Z"));
  assert.deepEqual([third.action, third.step, third.morning], ["send", "3h", undefined]);
});

test("sábado 22h → domingo 8 h (domingo igual aos outros dias)", () => {
  const link = { id: "m1", message_at: "2026-10-11T01:00:00.000Z" }; // sábado 10/10 22:00 SP
  const conversation = { ...adInput().conversation, last_inbound_at: "2026-10-11T00:59:00.000Z" };
  assert.equal(decideFormReminder(adInput({ link, conversation }), new Date("2026-10-11T10:59:00Z")).action, "wait");
  const sunday = decideFormReminder(adInput({ link, conversation }), new Date("2026-10-11T11:00:30Z"));
  assert.deepEqual([sunday.action, sunday.step, sunday.morning], ["send", "10h", true]);
});

test("link às 11h01: a de 10 h (21h01) vira 8 h do dia seguinte, ainda dentro da janela de 24 h do oficial", () => {
  const link = { id: "m1", message_at: "2026-10-13T14:01:00.000Z" }; // 11:01 SP
  const conversation = { ...adInput().conversation, last_inbound_at: "2026-10-13T14:00:30.000Z" };
  const sent = { claimedKeys: ["form-reminder:m1:1h", "form-reminder:m1:3h"], lastSent: { index: 1, sentAt: "2026-10-13T17:01:30Z" } };
  const next = decideFormReminder(adInput({ link, conversation, ...sent }), new Date("2026-10-14T11:00:30Z"));
  assert.deepEqual([next.action, next.step, next.morning], ["send", "10h", true]);
});

test("idempotência por etapa; lembretes anteriores não bloqueiam a próxima", () => {
  const sent1 = { direction: "outbound", sender_type: "automation", metadata: { kind: FORM_REMINDER_KIND, form_reminder_step: "1h" } };
  assert.equal(decideFormReminder(adInput({ claimedKeys: ["form-reminder:m1:1h"] }), at(LINK_AT, 1.1)).reason, "ja_enviado");
  assert.equal(decideFormReminder(adInput({ claimedKeys: ["form-reminder:m1"] }), at(LINK_AT, 1.1)).reason, "ja_enviado"); // lembrete único antigo
  assert.equal(decideFormReminder(adInput({ claimedKeys: ["form-reminder:m1:1h"], messagesAfter: [sent1] }), at(LINK_AT, 3.1)).action, "send");
  assert.deepEqual(claimKeysForStep("m1", "3h"), ["form-reminder:m1:3h"]);
  assert.deepEqual(AD_REMINDER_STEPS.map((item) => item.step), ["1h", "3h", "10h"]);
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

test("número oficial: só dentro das 24 h da última mensagem do cliente", () => {
  assert.equal(decideFormReminder(adInput(), at(LINK_AT, 18)).action, "send"); // cliente escreveu 16:59 UTC, janela até 16:54 do dia seguinte
  const late = adInput({ conversation: { ...adInput().conversation, last_inbound_at: "2026-10-10T00:00:00Z" } });
  assert.equal(decideFormReminder(late, at(LINK_AT, 18)).reason, "janela_fechada");
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
  // 3 h = 2 h depois da 1ª; 10 h = 9 h depois (backlog já encerrado: sem a regra das 8 h)
  assert.equal(currentReminderStep({ link: oldLink, ad: true, firstSentAt }, at(firstSentAt, 1.9)).step, "1h");
  assert.equal(currentReminderStep({ link: oldLink, ad: true, firstSentAt }, at(firstSentAt, 2)).step, "3h");
  assert.equal(currentReminderStep({ link: oldLink, ad: true, firstSentAt }, at(firstSentAt, 9)).step, "10h");
  assert.equal(currentReminderStep({ link: oldLink, ad: true, firstSentAt }, at(firstSentAt, 22)).step, "10h");
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

// ---- silêncio → roleta (decisões 10 e 12 do dono, 2026-10-12) ---------------------------------------------------
// A1 numa terça às 14:00 SP (17:00 UTC), depois da data de corte.
const A1_AT = "2026-10-13T17:00:00.000Z";
function silenceInput(overrides = {}, a1At = A1_AT) {
  const opening = { direction: "inbound", sender_type: "customer", message_type: "text", status: "received", message_at: at(a1At, -0.001).toISOString() };
  const a1 = { direction: "outbound", sender_type: "automation", message_type: "interactive", status: "sent", message_at: a1At };
  return {
    client: { distribution_type: AD_WAITING_DISTRIBUTION, status: "automated_service", last_form_submitted_at: null, journey_type: null, private_contact_at: null },
    conversation: { private_at: null, deleted_at: null, status: "open", last_human_reply_at: null },
    messages: [opening, a1],
    audits: [],
    activatedAt: SILENCE_TRANSFER_SINCE,
    ...overrides
  };
}

test("silêncio: vai para a roleta 3 h depois da A1 (junto com o lembrete de 3 h)", () => {
  assert.equal(decideSilenceTransfer(silenceInput(), at(A1_AT, 2.9)).action, "wait");
  const due = decideSilenceTransfer(silenceInput(), at(A1_AT, 3));
  assert.deepEqual([due.action, due.reason, due.dueAt.toISOString()], ["transfer", "silencio", "2026-10-13T20:00:00.000Z"]);
  // lembretes automáticos (inclusive o de 1 h) não contam como resposta nem como equipe
  const reminder = { direction: "outbound", sender_type: "automation", status: "sent", message_at: at(A1_AT, 1).toISOString(), metadata: { kind: "form_reminder" } };
  assert.equal(decideSilenceTransfer(silenceInput({ messages: [...silenceInput().messages, reminder] }), at(A1_AT, 3)).action, "transfer");
});

test("silêncio de madrugada → 8 h; domingo igual (sem corretor on-line, a fila entrega)", () => {
  const night = "2026-10-13T22:00:00.000Z"; // terça 19:00 SP → 22:00 SP cairia de noite
  assert.equal(decideSilenceTransfer(silenceInput({}, night), at(night, 3)).action, "wait");
  const morning = decideSilenceTransfer(silenceInput({}, night), new Date("2026-10-14T11:00:00Z"));
  assert.deepEqual([morning.action, morning.dueAt.toISOString()], ["transfer", "2026-10-14T11:00:00.000Z"]);
  const saturday = "2026-10-17T23:30:00.000Z"; // sábado 20:30 SP → domingo 8 h
  assert.equal(decideSilenceTransfer(silenceInput({}, saturday), new Date("2026-10-18T10:59:00Z")).action, "wait");
  assert.equal(decideSilenceTransfer(silenceInput({}, saturday), new Date("2026-10-18T11:00:00Z")).action, "transfer");
});

test("silêncio: não transfere se respondeu, preencheu, a equipe escreveu/mexeu, Particular, excluída, finalizada ou status mudou", () => {
  const now = at(A1_AT, 3.5);
  const reply = { direction: "inbound", sender_type: "customer", message_type: "audio", message_at: at(A1_AT, 0.5).toISOString() };
  assert.equal(decideSilenceTransfer(silenceInput({ messages: [...silenceInput().messages, reply] }), now).reason, "cliente_respondeu");
  // reação não é resposta
  assert.equal(decideSilenceTransfer(silenceInput({ messages: [...silenceInput().messages, { ...reply, message_type: "reaction" }] }), now).action, "transfer");
  assert.equal(decideSilenceTransfer(silenceInput({ client: { ...silenceInput().client, last_form_submitted_at: at(A1_AT, 1).toISOString() } }), now).reason, "formulario_preenchido");
  assert.equal(decideSilenceTransfer(silenceInput({ client: { ...silenceInput().client, journey_type: "simulation" } }), now).reason, "formulario_preenchido");
  const human = { direction: "outbound", sender_type: "user", message_type: "text", status: "sent", message_at: at(A1_AT, 1).toISOString() };
  assert.equal(decideSilenceTransfer(silenceInput({ messages: [...silenceInput().messages, human] }), now).reason, "equipe_escreveu");
  assert.equal(decideSilenceTransfer(silenceInput({ conversation: { ...silenceInput().conversation, last_human_reply_at: at(A1_AT, 1).toISOString() } }), now).reason, "equipe_escreveu");
  assert.equal(decideSilenceTransfer(silenceInput({ audits: [{ action: "assumed" }] }), now).reason, "equipe_mexeu");
  assert.equal(decideSilenceTransfer(silenceInput({ conversation: { ...silenceInput().conversation, private_at: at(A1_AT, 1).toISOString() } }), now).reason, "conversa_particular");
  assert.equal(decideSilenceTransfer(silenceInput({ client: { ...silenceInput().client, private_contact_at: at(A1_AT, 1).toISOString() } }), now).reason, "contato_particular");
  assert.equal(decideSilenceTransfer(silenceInput({ conversation: null }), now).reason, "sem_conversa");
  assert.equal(decideSilenceTransfer(silenceInput({ conversation: { ...silenceInput().conversation, deleted_at: at(A1_AT, 1).toISOString() } }), now).reason, "conversa_excluida");
  assert.equal(decideSilenceTransfer(silenceInput({ conversation: { ...silenceInput().conversation, status: "finished" } }), now).reason, "conversa_finalizada");
  for (const status of ["in_service", "do_not_contact", "archived", "pending"]) {
    assert.equal(decideSilenceTransfer(silenceInput({ client: { ...silenceInput().client, status } }), now).reason, "nao_aguardando", status);
  }
});

test("silêncio: corrida — quem já saiu do segurado (roleta, formulário, atribuição manual) não é transferido de novo", () => {
  const now = at(A1_AT, 3.5);
  for (const distribution_type of ["round_robin", "", "direct_channel"]) {
    assert.equal(decideSilenceTransfer(silenceInput({ client: { ...silenceInput().client, distribution_type } }), now).reason, "nao_aguardando");
  }
  assert.equal(canReleaseAdWaitingClient({ distribution_type: AD_WAITING_DISTRIBUTION, status: "automated_service" }, { via: "silence" }), true);
  assert.equal(canReleaseAdWaitingClient({ distribution_type: AD_WAITING_DISTRIBUTION, status: "in_service" }, { via: "silence" }), false);
  const lib = readFileSync(new URL("../lib/whatsapp-sponsored-lead.js", import.meta.url), "utf8");
  // caminho único de liberação, com a reserva condicionada à marca de segurado
  assert.match(lib, /releaseAdWaitingClient\(\{ clientId: client\.id, via: "silence", transferDueAt: decision\.dueAt \}\)/);
  assert.match(lib, /\.eq\("distribution_type", AD_WAITING_DISTRIBUTION\)\s*\.select\("id"\)/);
});

test("silêncio: só daqui para frente (A1 antes da data de corte não é transferida)", () => {
  const before = at(SILENCE_TRANSFER_SINCE, -1).toISOString();
  assert.equal(decideSilenceTransfer(silenceInput({}, before), at(before, 5)).reason, "antes_da_publicacao");
  assert.equal(decideSilenceTransfer(silenceInput({ messages: [silenceInput().messages[0]] }), at(A1_AT, 5)).reason, "sem_mensagem_automatica");
});

test("silêncio: data de corte = 1ª rodada em produção (marca em crm_settings), nunca antes do piso", () => {
  // sem a marca de ativação, não transfere ninguém
  assert.equal(decideSilenceTransfer(silenceInput({ activatedAt: null }), at(A1_AT, 5)).reason, "sem_data_de_corte");
  assert.equal(silenceTransferCutoffMs(null), Infinity);
  // A1 antes da publicação real (ativação depois do piso) não é transferida; A1 depois, sim
  const activatedAt = at(A1_AT, 1).toISOString();
  assert.equal(decideSilenceTransfer(silenceInput({ activatedAt }), at(A1_AT, 5)).reason, "antes_da_publicacao");
  assert.equal(decideSilenceTransfer(silenceInput({ activatedAt: at(A1_AT, -1).toISOString() }), at(A1_AT, 5)).action, "transfer");
  // ativação anterior ao piso não retroage além do piso
  assert.equal(silenceTransferCutoffMs("2026-01-01T00:00:00Z"), new Date(SILENCE_TRANSFER_SINCE).getTime());
  const lib = readFileSync(new URL("../lib/whatsapp-sponsored-lead.js", import.meta.url), "utf8");
  assert.match(lib, /from\("crm_settings"\)\.insert\(\{ id: SILENCE_TRANSFER_SETTING_ID, setting_value: \{ activatedAt \}/);
  assert.match(lib, /decideSilenceTransfer\(\{ client, conversation, messages, audits: audits \|\| \[\], activatedAt: silenceActivatedAt \}, now\)/);
});

test("rótulo da liberação: silêncio nunca vira 'respondeu'; via desconhecida não passa", () => {
  assert.deepEqual(adReleaseVia("silence"), { history: "anuncio_silencio", label: "não respondeu às mensagens automáticas" });
  assert.equal(adReleaseVia("reply").history, "anuncio_resposta");
  assert.equal(adReleaseVia("form").history, "anuncio_formulario");
  assert.doesNotMatch(adReleaseVia("silence").label, /respondeu no/);
  assert.throws(() => adReleaseVia("outra"));
  const lib = readFileSync(new URL("../lib/whatsapp-sponsored-lead.js", import.meta.url), "utf8");
  assert.doesNotMatch(lib, /via === "form" \? "anuncio_formulario" : "anuncio_resposta"/);
  // sem aviso à gestão no silêncio; on-line × fila e horário previsto no histórico; histórico também quando a fila entrega
  assert.match(lib, /if \(via !== "silence"\) await notifyStaff\("Cliente do anúncio aguardando corretor"/);
  assert.match(lib, /deliveryMode: brokerId \? "online" : "fila", transferDueAt/);
  assert.match(lib, /recordReleaseHistory\(\{ client, brokerId: null, ownerId, via, roulette, transferDueAt, deliveredByQueue: true \}\)/);
});
