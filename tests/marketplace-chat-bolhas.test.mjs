// Chat do Marketplace — bolhas e situação do envio (dono, 2026-11-02, conversa "Rafaela" com respostas de Bruna Santos):
// falha incerta ≠ não enviada, "Tentar de novo" só para falha confirmada e recente, balão de rótulo cortado
// ("Mensagem enviada 22 de outubro de 2026 13:04 por") com a hora do rótulo e ordem cronológica. Lógica pura + travas de layout.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FACEBOOK_MARKETPLACE_INBOX_URL,
  NON_TEXT_MESSAGE_BODY,
  UNCERTAIN_LABEL,
  isConfirmedNotSent,
  messageDisplayFields,
  normalizeFacebookMessage,
  outboundStatusView,
  retryRefusal,
  sortThreadMessages
} from "../lib/marketplace-chat-core.mjs";

const now = new Date("2026-10-29T18:52:00Z");
const ago = (hours) => new Date(now.getTime() - hours * 3600000).toISOString();
const base = { direction: "outbound", sender_user_id: "u1", status: "failed", attempts: 1 };
const E120 = "Etapa \"página do Facebook (mp-inbox-send)\" passou de 120 s e foi abandonada.";
const NOT_CONFIRMED = "Não confirmei a mensagem na conversa (confira no Facebook).";
const NOT_OPENED = "A conversa não abriu em 20 s depois do clique (aba em /marketplace/inbox/).";

test("falha incerta (não confirmei / passou de 120 s / sem retorno) = 'Não sei se foi enviada', sem Tentar de novo, com Confira no Facebook", () => {
  for (const error of [NOT_CONFIRMED, E120, "A extensão não deu retorno. Confira no Facebook antes de reenviar.", "Falha sem descrição.", ""]) {
    for (const hours of [0.1, 24 * 7]) {
      const view = outboundStatusView({ ...base, error, created_at: ago(hours) }, { now });
      assert.equal(view.statusLabel, UNCERTAIN_LABEL, error);
      assert.equal(view.canRetry, false, `${error} (${hours} h)`);
      assert.equal(view.checkOnFacebook, true);
    }
  }
  assert.equal(isConfirmedNotSent(NOT_CONFIRMED), false);
  assert.equal(isConfirmedNotSent(E120), false);
  assert.equal(isConfirmedNotSent(NOT_OPENED), true);
});

test("o texto da situação é simples: sem jargão técnico (mp-inbox-send, Etapa, 120 s)", () => {
  const view = outboundStatusView({ ...base, error: E120, created_at: ago(24 * 7) }, { now, technical: false });
  assert.doesNotMatch(view.statusLabel, /mp-inbox|etapa|\d+ s\b/i);
  assert.equal(view.error, null, "texto técnico só para o admin geral");
  assert.equal(outboundStatusView({ ...base, error: E120, created_at: ago(1) }, { now, technical: true }).error, E120);
});

test("falha confirmada: Tentar de novo só nas primeiras 24 h", () => {
  assert.deepEqual(outboundStatusView({ ...base, error: NOT_OPENED, created_at: ago(2) }, { now }), { statusLabel: "Não enviada", canRetry: true, error: null, undelivered: false, checkOnFacebook: false });
  const old = outboundStatusView({ ...base, error: NOT_OPENED, created_at: ago(24) }, { now });
  assert.equal(old.canRetry, false);
  assert.equal(old.checkOnFacebook, false);
  assert.match(old.statusLabel, /mais de 1 dia/);
  assert.equal(outboundStatusView({ ...base, error: NOT_OPENED }, { now }).canRetry, false, "sem data não dá para provar que é recente");
});

test("conversa bloqueada = confirmada (botão nas 24 h); Não contactar e 24 h de tentativas nunca têm botão", () => {
  assert.equal(outboundStatusView({ ...base, error: "[reenvio parado: conversa_bloqueada] x", created_at: ago(1) }, { now }).canRetry, true);
  const dnc = outboundStatusView({ ...base, error: "[reenvio parado: nao_contactar]", created_at: ago(1) }, { now });
  assert.equal(dnc.canRetry, false);
  assert.match(dnc.statusLabel, /Não contactar/);
  const timeout = outboundStatusView({ ...base, error: "[reenvio parado: prazo_24h] x", created_at: ago(30) }, { now });
  assert.equal(timeout.canRetry, false);
  assert.equal(timeout.checkOnFacebook, true);
});

test("servidor recusa 'Tentar de novo' em falha incerta/antiga (a tela não é a barreira)", () => {
  assert.equal(retryRefusal({ ...base, error: NOT_OPENED, created_at: ago(1) }, { now }), null);
  assert.match(retryRefusal({ ...base, error: NOT_CONFIRMED, created_at: ago(1) }, { now }), /Confira no Facebook/);
  assert.match(retryRefusal({ ...base, error: NOT_OPENED, created_at: ago(30) }, { now }), /mais de 1 dia/);
  assert.match(retryRefusal({ ...base, error: "[reenvio parado: nao_contactar]", created_at: ago(1) }, { now }), /Não contactar/);
  assert.equal(retryRefusal({ ...base, error: "Falha do Messenger", created_at: ago(1) }, { now, messenger: true }), null, "Messenger: a API confirma a falha");
  assert.match(retryRefusal({ ...base, error: "Falha do Messenger", created_at: ago(30) }, { now, messenger: true }), /mais de 1 dia/);
  const lib = readFileSync(new URL("../lib/marketplace-chat.js", import.meta.url), "utf8");
  const fn = lib.slice(lib.indexOf("export async function retryMarketplaceOutbound"), lib.indexOf("export async function reprocessMarketplaceOutboundFailures"));
  assert.ok(fn.indexOf("retryRefusal(row, { now })") > fn.indexOf("findStoredEcho(row)"), "o eco (já saiu) vem antes");
  assert.ok(fn.indexOf("retryRefusal(row, { now })") < fn.indexOf('update({ status: "queued"'), "a recusa vem antes de voltar à fila");
});

test("balão de rótulo cortado: hora do rótulo (não a da leitura) e aviso no lugar do 'por' solto", () => {
  // Caso real: lido em 29/10 18:52, mas o rótulo diz 22/10 13:04 (= 16:04 UTC).
  const row = { direction: "outbound", sender_user_id: null, external_id: "fb:mid.x", body: "Mensagem enviada 22 de outubro de 2026 13:04 por", attachments: [], message_at: "2026-10-29T18:52:13.971Z" };
  const shown = messageDisplayFields(row);
  assert.equal(shown.body, NON_TEXT_MESSAGE_BODY);
  assert.equal(shown.at, "2026-10-22T16:04:00.000Z");
  // Texto normal, resposta do CRM e balão com anexo ficam como estão.
  assert.deepEqual(messageDisplayFields({ ...row, body: "Mensagem enviada 10:19 por Rafael: oi" }), { body: "Mensagem enviada 10:19 por Rafael: oi", at: row.message_at });
  assert.equal(messageDisplayFields({ ...row, sender_user_id: "u1" }).body, row.body);
  assert.equal(messageDisplayFields({ ...row, attachments: [{ type: "image", url: "https://x.test/a.jpg" }] }).body, row.body);
});

test("leitura da extensão: rótulo cortado vira aviso com a hora do rótulo; 'por Fulano' sem texto continua descartado", () => {
  const cut = normalizeFacebookMessage({ body: "Mensagem enviada 22 de outubro de 2026 15:31 por", direction: "inbound" }, { now });
  assert.equal(cut.body, NON_TEXT_MESSAGE_BODY);
  assert.equal(cut.at, "2026-10-22T18:31:00.000Z");
  assert.equal(cut.direction, "inbound", "sem nome no rótulo vale a direção lida");
  assert.equal(normalizeFacebookMessage({ body: "Pressione Enter, Mensagem enviada 10:19 por Rafael: ", direction: "inbound" }, { now }), null);
  assert.equal(normalizeFacebookMessage({ body: "Pressione Enter, Mensagem enviada 10:18 por Você: Bom dia", direction: "inbound" }, { now }).direction, "outbound");
});

test("ordem cronológica pela hora mostrada, estável nos empates", () => {
  const list = [
    { id: "a", at: "2026-10-22T18:31:00Z" },
    { id: "late", at: "2026-10-29T18:52:13Z" }, // gravada na leitura, hora ainda não corrigida
    { id: "b", at: "2026-10-22T18:31:00Z" },
    { id: "c", at: "2026-10-22T18:33:36Z" }
  ];
  assert.deepEqual(sortThreadMessages(list).map((m) => m.id), ["a", "b", "c", "late"]);
  const fixed = [list[0], { id: "late", at: messageDisplayFields({ direction: "inbound", external_id: "fb:1", body: "Mensagem enviada 22 de outubro de 2026 15:31 por", message_at: "2026-10-29T18:52:13Z" }).at }, list[2], list[3]];
  assert.deepEqual(sortThreadMessages(fixed).map((m) => m.id), ["a", "late", "b", "c"]);
});

test("tela: bolha sem vazamento de lado, sem 'truncate' no remetente, 'Confira no Facebook' e erro técnico fechado", () => {
  const chat = readFileSync(new URL("../components/marketplace/MarketplaceChat.jsx", import.meta.url), "utf8");
  const area = chat.slice(chat.indexOf("data-chat-wallpaper className"), chat.indexOf("{internal ? ("));
  assert.match(area, /overflow-x-hidden/);
  assert.match(area, /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(area, /break-words/, "break-words não reduz a largura mínima: URL longa empurrava a bolha para fora");
  assert.doesNotMatch(area, /truncate/);
  assert.match(area, /max-w-full rounded/, "foto nunca maior que a bolha");
  assert.match(area, /data-check-facebook/);
  assert.match(area, /<details/, "texto técnico fechado (só admin geral recebe `error`)");
  assert.ok(chat.includes("FACEBOOK_MARKETPLACE_INBOX_URL"));
  assert.match(FACEBOOK_MARKETPLACE_INBOX_URL, /^https:\/\/www\.facebook\.com\/marketplace\/inbox\/$/);
});
