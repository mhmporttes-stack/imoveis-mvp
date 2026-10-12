// Resposta fora do horário no número Oficial (regra do dono, 2026-10-12 — decisão 12, dossiê §2-B).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUSINESS_HOURS_PHRASE,
  afterHoursClaimKey,
  buildAfterHoursText,
  closedPeriod,
  decideAfterHoursReply,
  isWithinOfficeHours
} from "../lib/whatsapp-after-hours-core.mjs";
import { buildOutgoing } from "../lib/whatsapp-flow-core.mjs";

// SP = UTC-3. 2026-10-13 = terça; 2026-10-17 = sábado; 2026-10-18 = domingo; 2026-10-19 = segunda.
const sp = (iso) => new Date(`${iso}-03:00`);

function input(overrides = {}) {
  return {
    messageType: "text",
    conversation: { id: "conv1", status: "open", deleted_at: null, private_at: null, last_human_reply_at: null },
    client: { status: "automated_service", last_form_submitted_at: null, journey_type: null, private_contact_at: null },
    phoneRegistrations: [],
    automationInPeriod: false,
    isTeamPhone: false,
    doNotContactReason: null,
    ...overrides
  };
}

test("horário: segunda a sábado, 8h às 19h (São Paulo)", () => {
  assert.equal(isWithinOfficeHours(sp("2026-10-13T08:00:00")), true);
  assert.equal(isWithinOfficeHours(sp("2026-10-13T18:59:00")), true);
  assert.equal(isWithinOfficeHours(sp("2026-10-13T19:00:00")), false);
  assert.equal(isWithinOfficeHours(sp("2026-10-13T07:59:00")), false);
  assert.equal(isWithinOfficeHours(sp("2026-10-17T10:00:00")), true); // sábado
  assert.equal(isWithinOfficeHours(sp("2026-10-18T10:00:00")), false); // domingo
});

test("período fechado: noite de semana; sábado 19h → segunda 8h é UM período", () => {
  assert.equal(closedPeriod(sp("2026-10-13T12:00:00")), null);
  const night = closedPeriod(sp("2026-10-13T23:00:00"));
  assert.deepEqual([night.start.toISOString(), night.end.toISOString()], ["2026-10-13T22:00:00.000Z", "2026-10-14T11:00:00.000Z"]);
  assert.deepEqual(closedPeriod(sp("2026-10-14T06:00:00")).start, night.start); // madrugada = mesmo período da noite anterior
  const weekend = closedPeriod(sp("2026-10-17T19:00:00"));
  assert.deepEqual([weekend.start.toISOString(), weekend.end.toISOString()], ["2026-10-17T22:00:00.000Z", "2026-10-19T11:00:00.000Z"]);
  for (const at of ["2026-10-17T23:30:00", "2026-10-18T10:00:00", "2026-10-18T22:00:00", "2026-10-19T07:59:00"]) {
    assert.deepEqual(closedPeriod(sp(at)).start, weekend.start, at);
  }
});

test("chave: uma por conversa e período", () => {
  const sunday = decideAfterHoursReply(input(), sp("2026-10-18T10:00:00"));
  const mondayDawn = decideAfterHoursReply(input(), sp("2026-10-19T06:00:00"));
  assert.equal(sunday.claimKey, "after-hours:conv1:2026-10-17T22:00:00.000Z");
  assert.equal(mondayDawn.claimKey, sunday.claimKey);
  assert.notEqual(decideAfterHoursReply(input(), sp("2026-10-19T20:00:00")).claimKey, sunday.claimKey);
  assert.equal(afterHoursClaimKey("c", new Date("2026-10-17T22:00:00Z")), "after-hours:c:2026-10-17T22:00:00.000Z");
});

test("tipos: texto, áudio, imagem, vídeo e documento respondem; reação, figurinha e toque em botão não", () => {
  const night = sp("2026-10-13T22:00:00");
  for (const messageType of ["text", "audio", "image", "video", "document"]) assert.equal(decideAfterHoursReply(input({ messageType }), night).action, "send", messageType);
  for (const messageType of ["reaction", "sticker", "interactive", "button", "unknown"]) assert.equal(decideAfterHoursReply(input({ messageType }), night).reason, "tipo_sem_resposta", messageType);
});

test("áudio às 22h de quem não preencheu: resposta com botão; dentro do horário nada", () => {
  const decision = decideAfterHoursReply(input({ messageType: "audio" }), sp("2026-10-13T22:00:00"));
  assert.deepEqual([decision.action, decision.withButton], ["send", true]);
  assert.equal(decideAfterHoursReply(input({ messageType: "audio" }), sp("2026-10-13T10:00:00")).reason, "dentro_do_horario");
});

test("já preencheu (cliente ou outro cadastro do telefone): só o texto, sem botão", () => {
  const night = sp("2026-10-13T22:00:00");
  assert.equal(decideAfterHoursReply(input({ client: { ...input().client, last_form_submitted_at: "2026-10-13T20:00:00Z" } }), night).withButton, false);
  assert.equal(decideAfterHoursReply(input({ client: { ...input().client, journey_type: "simulation" } }), night).withButton, false);
  assert.equal(decideAfterHoursReply(input({ phoneRegistrations: [{ journey_type: "quick_service" }] }), night).withButton, false);
});

test("A1 fora do horário já enviada (ou outra automação no período): não responde de novo", () => {
  assert.equal(decideAfterHoursReply(input({ automationInPeriod: true }), sp("2026-10-13T22:00:00")).reason, "automacao_no_periodo");
});

test("nunca: Não contactar, arquivado, Particular, equipe, excluída, finalizada, depois da 1ª resposta humana", () => {
  const night = sp("2026-10-13T22:00:00");
  assert.equal(decideAfterHoursReply(input({ doNotContactReason: "telefone_nao_contactar" }), night).reason, "nao_contactar");
  assert.equal(decideAfterHoursReply(input({ client: { status: "do_not_contact" } }), night).reason, "nao_contactar");
  assert.equal(decideAfterHoursReply(input({ client: { status: "archived" } }), night).reason, "cliente_arquivado");
  assert.equal(decideAfterHoursReply(input({ conversation: { ...input().conversation, private_at: "2026-10-01T00:00:00Z" } }), night).reason, "conversa_particular");
  assert.equal(decideAfterHoursReply(input({ client: { ...input().client, private_contact_at: "2026-10-01T00:00:00Z" } }), night).reason, "conversa_particular");
  assert.equal(decideAfterHoursReply(input({ isTeamPhone: true }), night).reason, "numero_da_equipe");
  assert.equal(decideAfterHoursReply(input({ conversation: { ...input().conversation, deleted_at: "2026-10-01T00:00:00Z" } }), night).reason, "conversa_excluida");
  assert.equal(decideAfterHoursReply(input({ conversation: { ...input().conversation, status: "finished" } }), night).reason, "conversa_finalizada");
  assert.equal(decideAfterHoursReply(input({ conversation: { ...input().conversation, last_human_reply_at: "2026-10-12T15:00:00Z" } }), night).reason, "pessoa_ja_respondeu");
  assert.equal(decideAfterHoursReply(input({ conversation: null }), night).reason, "sem_conversa");
});

test("textos do dossiê com e sem nome; até 1024 caracteres; botão 'Fazer simulação' (≤ 20)", () => {
  assert.equal(buildAfterHoursText("ana souza", { formFilled: true }), `Recebemos sua mensagem, Ana! ${BUSINESS_HOURS_PHRASE}`);
  assert.equal(buildAfterHoursText("Cliente WhatsApp"), `Recebemos sua mensagem! ${BUSINESS_HOURS_PHRASE} Se quiser adiantar, a simulação não pede CPF e não consulta seu nome:`);
  const longest = buildAfterHoursText("Maximiliano Alexandre");
  assert.ok(longest.length <= 1024);
  const outgoing = buildOutgoing({ id: "after-hours", type: "message", data: { mode: "link", text: longest, linkLabel: "Fazer simulação", linkUrl: "https://www.matheusmachadoimoveis.com.br/s?jornada=simulacao" } }, {});
  assert.equal(outgoing.message.interactive.type, "cta_url");
  assert.equal(outgoing.message.interactive.body.text, longest);
  assert.equal(outgoing.message.interactive.action.parameters.display_text, "Fazer simulação");
});

test("webhook: laço próprio depois dos Fluxos, sem quem pediu para parar; reserva antes de enviar; link de segurado = /s", () => {
  const master = readFileSync(new URL("../lib/whatsapp-master.js", import.meta.url), "utf8");
  assert.ok(master.indexOf("processAfterHoursReplies(automationRows)") > master.indexOf("processAutomationReply(event)"));
  const lib = readFileSync(new URL("../lib/whatsapp-after-hours.js", import.meta.url), "utf8");
  assert.match(lib, /sendReservedAutomationMessage\(\{[\s\S]*claimKey: decision\.claimKey/);
  assert.match(lib, /kind: AFTER_HOURS_REPLY_KIND/);
  assert.match(lib, /resolveFormLink\(formLinkResponsibleId\(client\)\)/);
  const flows = readFileSync(new URL("../lib/whatsapp-flows.js", import.meta.url), "utf8");
  assert.match(flows, /export function formLinkResponsibleId[\s\S]*distribution_type === AD_WAITING_DISTRIBUTION \? null/);
  const reminder = readFileSync(new URL("../lib/whatsapp-form-reminder.js", import.meta.url), "utf8");
  // a reserva é gravada (status queued) antes de chamar o envio; 23505 = já enviada
  assert.match(reminder, /status: "queued"[\s\S]*if \(claimError\?\.code === "23505"\) return "ja_enviado";[\s\S]*sent = await send\(\);/);
});
