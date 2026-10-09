import test from "node:test";
import assert from "node:assert/strict";
import {
  FORM_REMINDER_KIND,
  buildFormReminderText,
  decideFormReminder,
  formReminderClaimKey,
  formReminderDueAt,
  isCrmSentLinkMessage,
  isFormLinkUrl,
  latestLinkPerConversation,
  messageFormLink,
  usableFirstName
} from "../lib/whatsapp-form-reminder-core.mjs";

// 10/10/2026 14:00 em São Paulo = 17:00 UTC.
const LINK_AT = "2026-10-10T17:00:00.000Z";
const AFTER_1H = new Date("2026-10-10T18:00:30.000Z");

function baseInput(overrides = {}) {
  return {
    link: { id: "m1", message_at: LINK_AT, channel: "whatsapp_cloud_api" },
    conversation: { client_id: "c1", status: "open", last_inbound_at: "2026-10-10T16:59:00.000Z", last_human_reply_at: null, deleted_at: null },
    client: { status: "automated_service", last_form_submitted_at: null },
    phoneRegistrations: [{ id: "c1", status: "automated_service", created_at: "2026-10-10T16:59:10.000Z", last_form_submitted_at: null }],
    messagesAfter: [],
    auditsAfter: [],
    channel: { kind: "official", officialConfigured: true },
    ...overrides
  };
}

test("texto do lembrete: primeiro nome, sem emoji; sem nome usável cai em 'Oi, tudo bem?'", () => {
  assert.equal(
    buildFormReminderText("MARIA da silva"),
    "Oi, Maria, tudo bem? Notei que você ainda não preencheu o formulário. Ficou com alguma dúvida ou teve alguma dificuldade? Se preferir, posso te ajudar por aqui."
  );
  assert.match(buildFormReminderText("Cliente WhatsApp"), /^Oi, tudo bem\? Notei/);
  assert.match(buildFormReminderText(""), /^Oi, tudo bem\? Notei/);
  assert.equal(usableFirstName("5514999"), "");
  assert.equal(usableFirstName("João Pedro"), "João");
  assert.doesNotMatch(buildFormReminderText("Ana"), /\p{Extended_Pictographic}/u);
});

test("reconhece o link do formulário (curto, longo, campanha) e ignora outros links", () => {
  assert.ok(isFormLinkUrl("https://www.matheusmachadoimoveis.com.br/s/bruna?jornada=simulacao&utm_source=meta"));
  assert.ok(isFormLinkUrl("https://matheusmachadoimoveis.com.br/s"));
  assert.ok(isFormLinkUrl("https://www.matheusmachadoimoveis.com.br/simulacao?ref=matheus"));
  assert.ok(isFormLinkUrl("https://www.matheusmachadoimoveis.com.br/c/abc123"));
  assert.ok(!isFormLinkUrl("https://www.matheusmachadoimoveis.com.br/j/token"));
  assert.ok(!isFormLinkUrl("https://www.matheusmachadoimoveis.com.br/imoveis"));
  assert.ok(!isFormLinkUrl("https://outrosite.com/s/bruna"));
  assert.equal(messageFormLink({ body: "Segue: https://www.matheusmachadoimoveis.com.br/s/ana?jornada=simulacao." }), "https://www.matheusmachadoimoveis.com.br/s/ana?jornada=simulacao.");
  assert.equal(messageFormLink({ body: "Clique abaixo", metadata: { link: { url: "https://www.matheusmachadoimoveis.com.br/s/ana" } } }), "https://www.matheusmachadoimoveis.com.br/s/ana");
});

test("só conta link enviado PELO CRM (automação ou pessoa pelo Chat), nunca o digitado no celular", () => {
  const url = "https://www.matheusmachadoimoveis.com.br/s/ana";
  assert.ok(isCrmSentLinkMessage({ direction: "outbound", sender_type: "automation", metadata: { kind: "flow", link: { url } } }));
  assert.ok(isCrmSentLinkMessage({ direction: "outbound", sender_type: "user", body: url, metadata: { actor_ctx: { s: "x" } } }));
  assert.ok(!isCrmSentLinkMessage({ direction: "outbound", sender_type: "user", body: url, metadata: { wa_message_id: "w1" } }));
  assert.ok(!isCrmSentLinkMessage({ direction: "outbound", sender_type: "automation", status: "failed", body: url }));
  assert.ok(!isCrmSentLinkMessage({ direction: "inbound", sender_type: "customer", body: url }));
});

test("só o link mais recente de cada conversa", () => {
  const url = "https://www.matheusmachadoimoveis.com.br/s";
  const rows = [
    { id: "a", conversation_id: "k1", direction: "outbound", sender_type: "automation", body: url, message_at: "2026-10-10T10:00:00Z" },
    { id: "b", conversation_id: "k1", direction: "outbound", sender_type: "automation", body: url, message_at: "2026-10-10T11:00:00Z" },
    { id: "c", conversation_id: "k2", direction: "outbound", sender_type: "automation", body: url, message_at: "2026-10-10T09:00:00Z" }
  ];
  assert.deepEqual(latestLinkPerConversation(rows).map((row) => row.id).sort(), ["b", "c"]);
});

test("horário: 1 h depois; entre 21:00 e 08:00 (São Paulo) segura até 08:00", () => {
  assert.equal(formReminderDueAt(LINK_AT).toISOString(), "2026-10-10T18:00:00.000Z");
  // link 20:30 SP → 21:30 cai no silêncio → 08:00 do dia seguinte (11:00 UTC)
  assert.equal(formReminderDueAt("2026-10-10T23:30:00.000Z").toISOString(), "2026-10-11T11:00:00.000Z");
  // link 02:00 SP → 03:00 → 08:00 do mesmo dia
  assert.equal(formReminderDueAt("2026-10-10T05:00:00.000Z").toISOString(), "2026-10-10T11:00:00.000Z");
  // link 19:59 SP → 20:59 ainda dentro do horário
  assert.equal(formReminderDueAt("2026-10-10T22:59:00.000Z").toISOString(), "2026-10-10T23:59:00.000Z");
  // link 07:00 SP → 08:00 exato vale
  assert.equal(formReminderDueAt("2026-10-10T10:00:00.000Z").toISOString(), "2026-10-10T11:00:00.000Z");
});

test("envia: 1 h depois, sem resposta, sem formulário, janela do oficial aberta", () => {
  assert.deepEqual(decideFormReminder(baseInput(), AFTER_1H), { action: "send", reason: "ok", channel: "official" });
});

test("antes de 1 h espera; muito atrasado ou link antigo não envia", () => {
  assert.equal(decideFormReminder(baseInput(), new Date("2026-10-10T17:59:00Z")).action, "wait");
  assert.equal(decideFormReminder(baseInput(), new Date("2026-10-10T21:30:00Z")).reason, "atrasado_demais");
  assert.equal(decideFormReminder(baseInput({ link: { id: "m1", message_at: "2026-10-01T10:00:00Z" } }), new Date("2026-10-01T11:00:30Z")).reason, "antes_da_regra");
});

test("idempotência: um lembrete por envio de link", () => {
  assert.equal(decideFormReminder(baseInput({ alreadyClaimed: true }), AFTER_1H).reason, "ja_enviado");
  assert.equal(decideFormReminder(baseInput({ messagesAfter: [{ direction: "outbound", sender_type: "automation", metadata: { kind: FORM_REMINDER_KIND } }] }), AFTER_1H).reason, "ja_enviado");
  assert.equal(formReminderClaimKey("abc"), "form-reminder:abc");
});

test("não envia se o cliente respondeu, um humano respondeu/assumiu ou saiu link novo", () => {
  assert.equal(decideFormReminder(baseInput({ messagesAfter: [{ direction: "inbound", sender_type: "customer", message_type: "reaction" }] }), AFTER_1H).reason, "cliente_respondeu");
  assert.equal(decideFormReminder(baseInput({ messagesAfter: [{ direction: "outbound", sender_type: "user" }] }), AFTER_1H).reason, "humano_respondeu");
  assert.equal(decideFormReminder(baseInput({ auditsAfter: [{ action: "assumed" }] }), AFTER_1H).reason, "humano_assumiu");
  assert.equal(decideFormReminder(baseInput({ conversation: { ...baseInput().conversation, last_human_reply_at: "2026-10-10T17:10:00Z" } }), AFTER_1H).reason, "humano_respondeu");
  assert.equal(decideFormReminder(baseInput({ messagesAfter: [{ direction: "outbound", sender_type: "automation", body: "https://www.matheusmachadoimoveis.com.br/s" }] }), AFTER_1H).reason, "link_mais_novo");
});

test("não envia se preencheu o formulário (cadastro existente ou novo com o mesmo telefone)", () => {
  assert.equal(decideFormReminder(baseInput({ client: { status: "pending", last_form_submitted_at: "2026-10-10T17:20:00Z" } }), AFTER_1H).reason, "formulario_preenchido");
  assert.equal(decideFormReminder(baseInput({ phoneRegistrations: [{ id: "c2", status: "pending", created_at: "2026-10-10T17:30:00Z" }] }), AFTER_1H).reason, "cadastro_novo");
  assert.equal(decideFormReminder(baseInput({ phoneRegistrations: [{ id: "c2", status: "pending", created_at: "2026-09-01T00:00:00Z", last_form_submitted_at: "2026-10-10T17:30:00Z" }] }), AFTER_1H).reason, "formulario_preenchido");
});

test("não envia para arquivado, Não contactar, número da equipe, telefone bloqueado, sem cliente", () => {
  assert.equal(decideFormReminder(baseInput({ client: { status: "archived" } }), AFTER_1H).reason, "cliente_arquivado_ou_nao_contactar");
  assert.equal(decideFormReminder(baseInput({ client: { status: "do_not_contact" } }), AFTER_1H).reason, "cliente_arquivado_ou_nao_contactar");
  assert.equal(decideFormReminder(baseInput({ phoneRegistrations: [{ id: "x", status: "do_not_contact", created_at: "2026-01-01T00:00:00Z" }] }), AFTER_1H).reason, "telefone_nao_contactar");
  assert.equal(decideFormReminder(baseInput({ isTeamPhone: true }), AFTER_1H).reason, "numero_da_equipe");
  assert.equal(decideFormReminder(baseInput({ isPhoneBlocked: true }), AFTER_1H).reason, "telefone_bloqueado");
  assert.equal(decideFormReminder(baseInput({ conversation: { ...baseInput().conversation, client_id: null }, client: null }), AFTER_1H).reason, "sem_cliente");
  assert.equal(decideFormReminder(baseInput({ conversation: { ...baseInput().conversation, deleted_at: "2026-10-10T17:30:00Z" } }), AFTER_1H).reason, "conversa_excluida");
});

test("canal: oficial só com a janela de 24 h aberta; pessoal só se permitido; nunca troca de número", () => {
  const old = { ...baseInput().conversation, last_inbound_at: "2026-10-09T18:00:00Z" }; // janela fecha 18:00 do dia 10 (17:55 com a folga)
  assert.equal(decideFormReminder(baseInput({ conversation: old }), AFTER_1H).reason, "janela_fechada");
  assert.equal(decideFormReminder(baseInput({ channel: { kind: "official", officialConfigured: false } }), AFTER_1H).action, "wait");
  assert.equal(decideFormReminder(baseInput({ channel: { kind: "individual", individualAllowed: false } }), AFTER_1H).reason, "whatsapp_pessoal_nao_permitido");
  assert.deepEqual(decideFormReminder(baseInput({ channel: { kind: "individual", individualAllowed: true } }), AFTER_1H), { action: "send", reason: "ok", channel: "individual" });
  // pessoal não depende da janela da Meta
  assert.equal(decideFormReminder(baseInput({ conversation: old, channel: { kind: "individual", individualAllowed: true } }), AFTER_1H).action, "send");
  assert.equal(decideFormReminder(baseInput({ channel: { kind: "numero_mudou" } }), AFTER_1H).reason, "numero_mudou");
  assert.equal(decideFormReminder(baseInput({ chatDisabled: true }), AFTER_1H).reason, "chat_desativado");
  assert.equal(decideFormReminder(baseInput({ hasLiveFlowSession: true }), AFTER_1H).reason, "fluxo_em_andamento");
});

test("silêncio noturno: segura até 08:00 e só envia se a janela do oficial ainda estiver aberta", () => {
  const link = { id: "m1", message_at: "2026-10-10T23:30:00.000Z" }; // 20:30 SP
  const at0800 = new Date("2026-10-11T11:00:30Z");
  assert.equal(decideFormReminder(baseInput({ link, conversation: { ...baseInput().conversation, last_inbound_at: "2026-10-10T23:29:00Z" } }), new Date("2026-10-11T01:00:00Z")).action, "wait");
  assert.equal(decideFormReminder(baseInput({ link, conversation: { ...baseInput().conversation, last_inbound_at: "2026-10-10T23:29:00Z" } }), at0800).action, "send");
  assert.equal(decideFormReminder(baseInput({ link, conversation: { ...baseInput().conversation, last_inbound_at: "2026-10-10T11:00:00Z" } }), at0800).reason, "janela_fechada");
});
