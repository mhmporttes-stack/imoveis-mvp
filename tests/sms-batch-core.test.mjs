import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SMS_BATCH_DEFAULT_LIMIT,
  SMS_BATCH_DEFAULT_TEMPLATE,
  SMS_BATCH_TEMPLATE_MAX_CHARS,
  SMS_SKIP_REASON,
  buildSmsHrefs,
  buildSmsMetrics,
  isSmsEligible,
  maskSmsPhone,
  normalizeSmsLimit,
  planSmsBatch,
  renderSmsText,
  smsFirstName,
  smsRemainingToday,
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

test("texto padrão: só o 1º nome, link, opt-out SAIR, dentro do limite e sem preço/promessa", () => {
  assert.equal(validateSmsTemplate(SMS_BATCH_DEFAULT_TEMPLATE), null);
  const text = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE, { name: "MARIA APARECIDA souza", link: LINK });
  assert.match(text, /^Oi, Maria! Aqui é o Matheus Machado, Corretor de Imóveis, de Marília\./);
  assert.ok(text.includes(LINK) && /responda SAIR\.$/.test(text));
  assert.ok(text.length <= SMS_BATCH_TEMPLATE_MAX_CHARS + 10, `tamanho ${text.length}`);
  assert.doesNotMatch(text, /R\$|aprova|garant/i);
  assert.doesNotMatch(text, /Aparecida|Souza/);
});

test("sem nome confiável o texto começa com Olá!", () => {
  for (const name of ["", "   ", "11999998888", "Cliente WhatsApp", "A", "Sem nome", null]) {
    assert.equal(smsFirstName(name), "", String(name));
    const text = renderSmsText(SMS_BATCH_DEFAULT_TEMPLATE, { name, link: LINK });
    assert.match(text, /^Olá! Aqui é o Matheus Machado/, String(name));
    assert.doesNotMatch(text, /\[nome\]|\[link\]/);
  }
});

test("texto editável precisa de [link] e do aviso SAIR e respeita o tamanho", () => {
  assert.match(validateSmsTemplate("Oi [nome], veja [link]"), /SAIR/);
  assert.match(validateSmsTemplate("Oi [nome], responda SAIR"), /\[link\]/);
  assert.match(validateSmsTemplate(`${"a".repeat(300)} [link] SAIR`), /caracteres/);
  assert.match(validateSmsTemplate(""), /Escreva/);
  assert.equal(validateSmsTemplate("Oi [nome]! [link] Para parar, responda SAIR."), null);
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
    views: [{ created_at: "2026-11-02T14:30:00Z" }],
    signups: [{ created_at: "2026-11-02T14:40:00Z" }]
  }, { days: 3, now });
  assert.deepEqual(metrics.total, { sent: 4, clicks: 1, signups: 1, rate: 0.25 });
  assert.deepEqual(metrics.byDay[0], { day: "2026-11-02", sent: 2, clicks: 1, signups: 1, rate: 0.5 });
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
  for (const fn of ["loadSmsBatch", "markSmsSent", "undoSmsSent", "markSmsOptOut", "saveSmsBatchSettings"]) {
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
