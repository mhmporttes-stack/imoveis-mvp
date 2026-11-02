import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SMS_BATCH_DEFAULT_LIMIT,
  SMS_BATCH_DEFAULT_TEMPLATE,
  SMS_BATCH_DEFAULT_TEMPLATE_2,
  SMS_BATCH_TEMPLATE_MAX_CHARS,
  SMS_SKIP_REASON,
  buildSmsHrefs,
  buildSmsMetrics,
  groupSmsConversations,
  isSmsEligible,
  maskSmsPhone,
  normalizeSmsLimit,
  planSmsBatch,
  renderSmsText,
  smsFirstName,
  smsRemainingToday,
  smsSecondSkipReason,
  smsSkipReason,
  spDayStartIso,
  validateSmsTemplate
} from "../lib/sms-batch-core.mjs";

// Lote de SMS (dono, 2026-11-02): base sem nenhuma tentativa de contato; envio por toque no iPhone.
const LINK = "https://www.matheusmachadoimoveis.com.br/c/abc1234";
const fresh = (overrides = {}) => ({
  id: "c1", name: "Maria Souza", phone: "+5514999998888", status: "available",
  assignedUserId: null, ownerUserId: null, lastBrokerId: null, lastAttemptAt: null, registrationId: null,
  reserved: false, hasRound: false, hasManualAttempt: false, isClientPhone: false, hasConversation: false, smsSent: false, isInternalPhone: false,
  ...overrides
});

test("href sms: usa a sintaxe do iOS (&body=) e o fallback (?body=), com o texto codificado", () => {
  const text = "Oi, Maria! Faça a simulação: https://x.com/c/a?b=1&c=2\nPara parar, responda SAIR.";
  const { primary, fallback } = buildSmsHrefs("(14) 99999-8888", text);
  assert.equal(primary, `sms:+5514999998888&body=${encodeURIComponent(text)}`);
  assert.equal(fallback, `sms:+5514999998888?body=${encodeURIComponent(text)}`);
  assert.equal(decodeURIComponent(primary.split("&body=")[1]), text);
  assert.doesNotMatch(primary, /[ \n]/);
  assert.equal(primary.split("&body=").length, 2, "o & do texto precisa estar codificado");
});

test("href sms: telefone inválido não gera link", () => {
  assert.deepEqual(buildSmsHrefs("1433334444", "oi"), { primary: "", fallback: "" });
  assert.deepEqual(buildSmsHrefs("", "oi"), { primary: "", fallback: "" });
});

test("telefone mascarado parcialmente", () => {
  assert.equal(maskSmsPhone("+5514999998888"), "(14) 9****-8888");
  assert.equal(maskSmsPhone("123"), "");
});

test("1ª mensagem padrão: texto do dono, saudação, 1º nome, link e quebras de linha", () => {
  assert.equal(validateSmsTemplate(SMS_BATCH_DEFAULT_TEMPLATE), null);
  const text = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE, { name: "MARIA APARECIDA souza", link: LINK, greeting: "Boa tarde" });
  assert.match(text, /^Boa tarde Maria, tudo bem \?\n\nMeu nome é Matheus Machado, sou Corretor de Imóveis\.\n/);
  assert.match(text, /Quer saber o quanto a Caixa aprova para você comprar seu imóvel\?/);
  assert.ok(text.endsWith(`sem compromisso:\n\n${LINK}`));
  assert.doesNotMatch(text, /Aparecida|Souza|\[/);
  assert.ok(text.length <= SMS_BATCH_TEMPLATE_MAX_CHARS, `tamanho ${text.length}`);
  assert.doesNotMatch(text, /R\$|garant/i);
});

test("saudação vem de fora (getTimeGreeting, única) e vale para Bom dia, Boa tarde e Boa noite", () => {
  for (const greeting of ["Bom dia", "Boa tarde", "Boa noite"]) {
    assert.ok(renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE, { name: "Ana", link: LINK, greeting }).startsWith(`${greeting} Ana, tudo bem ?`), greeting);
  }
  assert.ok(renderSmsText("[saudacao] [nome]!", { name: "Ana", greeting: "Bom dia" }).startsWith("Bom dia Ana"));
  const lib = readFileSync(new URL("../lib/sms-batch.js", import.meta.url), "utf8");
  assert.match(lib, /import \{ getTimeGreeting \} from "\.\/daily-report"/);
  assert.match(lib, /greeting = getTimeGreeting\(\)/);
  const core = readFileSync(new URL("../lib/sms-batch-core.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(core, /["']Bom dia["']|["']Boa noite["']/, "a decisão por horário é só do getTimeGreeting");
});

test("sem nome confiável: \"[Saudação], tudo bem ?\"", () => {
  for (const name of ["", "   ", "11999998888", "Cliente WhatsApp", "A", "Sem nome", null]) {
    assert.equal(smsFirstName(name), "", String(name));
    const text = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE, { name, link: LINK, greeting: "Boa noite" });
    assert.match(text, /^Boa noite, tudo bem \?\n\nMeu nome é Matheus Machado/, String(name));
    assert.doesNotMatch(text, /\[nome\]|\[link\]/);
  }
  assert.match(renderSmsText("Oi, [nome]! veja [link]", { name: "", link: LINK }), /^Olá! veja /);
});

test("href sms: mantém as quebras de linha do texto como %0A", () => {
  const text = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE, { name: "Ana", link: LINK, greeting: "Bom dia" });
  const { primary, fallback } = buildSmsHrefs("(14) 99999-8888", text);
  assert.ok(primary.startsWith("sms:+5514999998888&body=Bom%20dia%20Ana%2C%20tudo%20bem%20%3F%0A%0AMeu%20nome"), primary.slice(0, 90));
  assert.equal(primary.includes("\n"), false);
  assert.equal((primary.match(/%0A/g) || []).length, 7);
  assert.ok(fallback.startsWith("sms:+5514999998888?body="));
  assert.equal(decodeURIComponent(primary.split("&body=")[1]), text);
});

test("2ª mensagem padrão: texto do dono, com o aviso SAIR e emoji; editável", () => {
  assert.equal(validateSmsTemplate(SMS_BATCH_DEFAULT_TEMPLATE_2, { second: true }), null);
  assert.match(SMS_BATCH_DEFAULT_TEMPLATE_2, /^Saber seu poder de compra é o primeiro passo para sair do aluguel\./);
  assert.match(SMS_BATCH_DEFAULT_TEMPLATE_2, /\nCaso você já tenha comprado seu imóvel, responda SAIR\.\n\nQue você tenha um dia abençoado 🙏🏼$/);
  const href = buildSmsHrefs("+5514999998888", renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE_2, { name: "Ana", greeting: "Bom dia" })).primary;
  assert.equal(decodeURIComponent(href.split("&body=")[1]), SMS_BATCH_DEFAULT_TEMPLATE_2);
  assert.match(validateSmsTemplate("Sem aviso", { second: true }), /SAIR/);
});

test("validação do texto da 1ª: precisa de [link] e respeita o tamanho", () => {
  assert.match(validateSmsTemplate("Oi [nome], responda SAIR"), /\[link\]/);
  assert.match(validateSmsTemplate(`${"a".repeat(600)} [link]`), /caracteres/);
  assert.match(validateSmsTemplate(""), /Escreva/);
  assert.equal(validateSmsTemplate("[Saudação] [nome]! [link]"), null);
});

test("2ª mensagem: só depois da 1ª, uma vez, nunca para SAIR nem Não contactar", () => {
  assert.equal(smsSecondSkipReason({}), SMS_SKIP_REASON.NO_FIRST);
  assert.equal(smsSecondSkipReason({ firstSent: true }), null);
  assert.equal(smsSecondSkipReason({ firstSent: true, secondSent: true }), SMS_SKIP_REASON.SECOND_SENT);
  assert.equal(smsSecondSkipReason({ firstSent: true, optedOut: true }), SMS_SKIP_REASON.OPTED_OUT);
  assert.equal(smsSecondSkipReason({ firstSent: true, doNotContact: true }), SMS_SKIP_REASON.DO_NOT_CONTACT);
  assert.equal(smsSecondSkipReason({ firstSent: true, secondSent: true, optedOut: true }), SMS_SKIP_REASON.OPTED_OUT);
});

test("abas: Aguardando 2ª (1ª enviada, sem 2ª) e Enviados (2ª enviada, SAIR ou Não contactar); um telefone = um cartão", () => {
  const row = (id, phone, event, at, extra = {}) => ({ id, phone_normalized: phone, event, created_at: at, contact_id: `c-${phone}`, name: `N${phone.slice(-2)}`, contactStatus: "recent_attempt", ...extra });
  const { awaiting, done } = groupSmsConversations([
    row("s2", "+5514999990002", "sent", "2026-11-02T10:00:00Z"),
    row("s1", "+5514999990001", "sent", "2026-11-02T09:00:00Z"),
    row("s3", "+5514999990003", "sent", "2026-11-02T11:00:00Z"),
    row("t3", "+5514999990003", "sent_2", "2026-11-02T12:00:00Z"),
    row("s4", "+5514999990004", "sent", "2026-11-02T11:30:00Z"),
    row("o4", "+5514999990004", "opt_out", "2026-11-02T12:30:00Z"),
    row("s5", "+5514999990005", "sent", "2026-11-02T11:40:00Z", { contactStatus: "do_not_contact" }),
    row("s1b", "5514999990001", "sent", "2026-11-02T09:05:00Z")
  ]);
  assert.deepEqual(awaiting.map((entry) => entry.sendId), ["s1", "s2"]);
  assert.deepEqual(awaiting.map((entry) => entry.state), ["awaiting", "awaiting"]);
  assert.deepEqual(done.map((entry) => [entry.sendId, entry.state]).sort(), [["s3", "complete"], ["s4", "opt_out"], ["s5", "opt_out"]]);
});

test("elegível: contato da base, celular válido, nenhuma tentativa em canal nenhum", () => {
  assert.equal(smsSkipReason(fresh()), null);
  assert.equal(isSmsEligible(fresh()), true);
});

test("exclusões: celular inválido, fora da fila, atendido, lista impressa", () => {
  assert.equal(smsSkipReason(fresh({ phone: "+551433334444" })), SMS_SKIP_REASON.INVALID_PHONE);
  assert.equal(smsSkipReason(fresh({ phone: "+55149999988" })), SMS_SKIP_REASON.INVALID_PHONE);
  for (const status of ["do_not_contact", "claimed", "recent_attempt"]) assert.equal(smsSkipReason(fresh({ status })), SMS_SKIP_REASON.NOT_AVAILABLE, status);
  assert.equal(smsSkipReason(fresh({ assignedUserId: "u1" })), SMS_SKIP_REASON.OWNED);
  assert.equal(smsSkipReason(fresh({ ownerUserId: "u1" })), SMS_SKIP_REASON.OWNED);
  assert.equal(smsSkipReason(fresh({ reserved: true })), SMS_SKIP_REASON.RESERVED);
});

test("qualquer tentativa anterior exclui: rodada da Meta Diária/Disparar, reivindicação manual, corretor, última tentativa", () => {
  assert.equal(smsSkipReason(fresh({ hasRound: true })), SMS_SKIP_REASON.ACTIVE_ROUND);
  assert.equal(smsSkipReason(fresh({ hasManualAttempt: true })), SMS_SKIP_REASON.ALREADY_TRIED);
  assert.equal(smsSkipReason(fresh({ lastBrokerId: "u1" })), SMS_SKIP_REASON.ALREADY_TRIED);
  assert.equal(smsSkipReason(fresh({ lastAttemptAt: "2026-10-01T10:00:00Z" })), SMS_SKIP_REASON.ALREADY_TRIED);
});

test("telefone que já é cliente (Não contactar, restrição, arquivado, lista fria, venda...), conversa de WhatsApp ou equipe: nunca", () => {
  assert.equal(smsSkipReason(fresh({ isClientPhone: true })), SMS_SKIP_REASON.IS_CLIENT);
  assert.equal(smsSkipReason(fresh({ registrationId: "r1" })), SMS_SKIP_REASON.IS_CLIENT);
  assert.equal(smsSkipReason(fresh({ hasConversation: true })), SMS_SKIP_REASON.HAS_CONVERSATION);
  assert.equal(smsSkipReason(fresh({ isInternalPhone: true })), SMS_SKIP_REASON.INTERNAL);
});

test("SMS enviado conta como tentativa: o telefone nunca volta ao lote (cooldown maior que 30 dias)", () => {
  assert.equal(smsSkipReason(fresh({ smsSent: true })), SMS_SKIP_REASON.SMS_SENT);
});

test("lote: mais antigos primeiro, um telefone = uma linha (com/sem DDI), respeita limite e o que já foi enviado hoje", () => {
  const list = [
    fresh({ id: "a", phone: "+5514999990001" }),
    fresh({ id: "b", phone: "+5514999990002", hasRound: true }),
    fresh({ id: "c", phone: "5514999990001" }),
    fresh({ id: "d", phone: "+551499990001" }), // sem o 9º dígito: celular inválido para o lote
    fresh({ id: "e", phone: "+5514999990005" }),
    fresh({ id: "f", phone: "+5514999990006" })
  ];
  const plan = planSmsBatch(list, { limit: 3, sentToday: 0 });
  assert.deepEqual(plan.items.map((item) => item.id), ["a", "e", "f"]);
  assert.equal(plan.skipped[SMS_SKIP_REASON.ACTIVE_ROUND], 1);
  assert.equal(plan.skipped[SMS_SKIP_REASON.DUPLICATE], 1);
  assert.equal(plan.skipped[SMS_SKIP_REASON.INVALID_PHONE], 1);
  assert.deepEqual(planSmsBatch(list, { limit: 3, sentToday: 2 }).items.map((item) => item.id), ["a"]);
  assert.deepEqual(planSmsBatch(list, { limit: 3, sentToday: 3 }).items, []);
});

test("limite diário: padrão 50, configurável, com teto", () => {
  assert.equal(SMS_BATCH_DEFAULT_LIMIT, 50);
  assert.equal(normalizeSmsLimit(undefined), 50);
  assert.equal(normalizeSmsLimit("0"), 50);
  assert.equal(normalizeSmsLimit("30"), 30);
  assert.equal(normalizeSmsLimit(100000), 200);
  assert.equal(smsRemainingToday(50, 12), 38);
  assert.equal(smsRemainingToday(50, 80), 0);
});

test("medição por dia e total: enviados, cliques, cadastros e taxa", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  const metrics = buildSmsMetrics({
    sends: [{ created_at: "2026-11-02T13:00:00Z" }, { created_at: "2026-11-02T14:00:00Z" }, { created_at: "2026-11-01T14:00:00Z" }, { created_at: "2026-11-01T14:10:00Z" }],
    sends2: [{ created_at: "2026-11-02T14:20:00Z" }],
    views: [{ created_at: "2026-11-02T14:30:00Z" }],
    signups: [{ created_at: "2026-11-02T14:40:00Z" }]
  }, { days: 3, now });
  assert.deepEqual(metrics.total, { sent: 4, sent2: 1, clicks: 1, signups: 1, rate: 0.25 });
  assert.deepEqual(metrics.byDay[0], { day: "2026-11-02", sent: 2, sent2: 1, clicks: 1, signups: 1, rate: 0.5 });
  assert.equal(metrics.byDay[1].sent, 2);
  assert.equal(metrics.byDay[2].rate, null);
  assert.equal(buildSmsMetrics().total.rate, null);
});

test("dia de São Paulo começa às 03:00 UTC", () => {
  assert.equal(spDayStartIso(new Date("2026-11-02T02:00:00Z")), "2026-11-01T03:00:00.000Z");
  assert.equal(spDayStartIso(new Date("2026-11-02T15:00:00Z")), "2026-11-02T03:00:00.000Z");
});

test("SAIR usa o caminho único de Não contactar e nunca escreve o patch à mão", () => {
  const source = readFileSync(new URL("../lib/sms-batch.js", import.meta.url), "utf8");
  assert.match(source, /clientDoNotContactPatch\(now\)/);
  assert.match(source, /contactDoNotContactPatch\(now,/);
  assert.doesNotMatch(source, /\.update\(\{\s*status:\s*["']do_not_contact/);
});

test("escopo: rota e página só para admin geral e gestor; toda ação confere o perfil no servidor; o envio é tentativa sem corretor", () => {
  const route = readFileSync(new URL("../app/api/admin/lote-sms/route.js", import.meta.url), "utf8");
  assert.equal((route.match(/requireBrokerManagementApi\(request\)/g) || []).length, 2);
  const page = readFileSync(new URL("../app/admin/lote-sms/page.jsx", import.meta.url), "utf8");
  assert.match(page, /await requireBrokerManagementPage\(\)/);
  const lib = readFileSync(new URL("../lib/sms-batch.js", import.meta.url), "utf8");
  for (const fn of ["loadSmsBatch", "markSmsSent", "markSmsSecondSent", "undoSmsSent", "markSmsOptOut", "saveSmsBatchSettings"]) {
    assert.match(lib, new RegExp(`export async function ${fn}\\([^)]*\\) \\{\\n  assertGeneralAdminOrManager\\(auth\\);`), fn);
  }
  // Tentativa do SMS não é atividade de corretor: sem last_broker_id, sem user_id no histórico, nada de pontuação.
  const sent = lib.slice(lib.indexOf("export async function markSmsSent"), lib.indexOf("const UNDO_WINDOW_MS"));
  assert.doesNotMatch(sent, /last_broker_id|daily_goal|score|points/);
  assert.match(sent, /user_id: null/);
});

test("menu: o item aparece só nos grupos de gestão (gestor e admin geral)", () => {
  const menu = readFileSync(new URL("../components/AdminMenu.jsx", import.meta.url), "utf8");
  assert.equal((menu.match(/key: "sms-batch"/g) || []).length, 2);
  const brokerStart = menu.indexOf("const brokerGroups");
  const managerStart = menu.indexOf("const managerGroups");
  assert.equal(menu.slice(brokerStart, managerStart).includes("sms-batch"), false);
});
