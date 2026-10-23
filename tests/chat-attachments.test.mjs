import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_CHAT_ATTACHMENTS, appendAttachments, captionFor, moveAttachment, removeAttachment, sendAttachmentsInOrder, sendingProgressLabel } from "../lib/chat-attachments-core.mjs";
import {
  MARKETPLACE_MEDIA_MAX_BYTES,
  findOutboundEcho,
  messagePreview,
  pickOutboxCandidate,
  supportsMarketplaceMedia,
  toOutboxPayload,
  validateOutboundMedia
} from "../lib/marketplace-chat-core.mjs";

// Dono, 2026-10-23: "anexei uma, quando anexei outra ela substituiu a primeira [...] Eu quero que possa enviar mais de um
// arquivo na mesma mensagem."
const items = (...ids) => ids.map((id) => ({ id, caption: "" }));

test("anexar de novo acrescenta ao fim, nunca substitui", () => {
  const first = appendAttachments([], items("a"));
  const second = appendAttachments(first.items, items("b"));
  assert.deepEqual(second.items.map((item) => item.id), ["a", "b"]);
  assert.equal(second.rejected, 0);
});

test("limite de 10 arquivos por envio: o excedente é recusado, os que já estavam ficam", () => {
  assert.equal(MAX_CHAT_ATTACHMENTS, 10);
  const nine = appendAttachments([], items("1", "2", "3", "4", "5", "6", "7", "8", "9")).items;
  const result = appendAttachments(nine, items("10", "11", "12"));
  assert.equal(result.items.length, 10);
  assert.equal(result.items[0].id, "1");
  assert.equal(result.items[9].id, "10");
  assert.equal(result.rejected, 2);
});

test("remover e reordenar (subir/descer) mantém o resto da fila", () => {
  const list = items("a", "b", "c");
  assert.deepEqual(moveAttachment(list, "c", -1).map((item) => item.id), ["a", "c", "b"]);
  assert.deepEqual(moveAttachment(list, "a", 1).map((item) => item.id), ["b", "a", "c"]);
  assert.equal(moveAttachment(list, "a", -1), list, "fora do limite não muda");
  assert.deepEqual(removeAttachment(list, "b").map((item) => item.id), ["a", "c"]);
});

test("envio na ordem mostrada, um de cada vez (espera cada um terminar antes do próximo)", async () => {
  const log = [];
  let running = 0;
  const outcome = await sendAttachmentsInOrder(items("a", "b", "c"), async (item) => {
    running += 1;
    assert.equal(running, 1, "nunca dois envios ao mesmo tempo");
    log.push(`start:${item.id}`);
    await new Promise((resolve) => setTimeout(resolve, item.id === "a" ? 15 : 1)); // o 1º é o mais lento
    log.push(`end:${item.id}`);
    running -= 1;
  });
  assert.deepEqual(log, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  assert.deepEqual(outcome, { sent: ["a", "b", "c"], failed: null, pending: [] });
});

test("falha parcial: para no arquivo que falhou e os seguintes não saem antes dele", async () => {
  const sent = [];
  const progress = [];
  const outcome = await sendAttachmentsInOrder(items("a", "b", "c"), async (item) => {
    if (item.id === "b") throw new Error("Janela de 24 h fechada.");
    sent.push(item.id);
  }, { onProgress: ({ index, total }) => progress.push(sendingProgressLabel(index, total)) });
  assert.deepEqual(sent, ["a"]);
  assert.deepEqual(outcome, { sent: ["a"], failed: { id: "b", error: "Janela de 24 h fechada." }, pending: ["c"] });
  assert.deepEqual(progress, ["Enviando 1 de 3…", "Enviando 2 de 3…"]);
  // "Tentar de novo" recomeça do que falhou, na mesma ordem.
  const retry = await sendAttachmentsInOrder(items("b", "c"), async (item) => sent.push(item.id));
  assert.equal(retry.failed, null);
  assert.deepEqual(sent, ["a", "b", "c"]);
});

test("texto digitado vai como legenda só do 1º arquivo; legenda própria de cada arquivo junto", () => {
  assert.equal(captionFor({ caption: "" }, 0, "Seguem as fotos"), "Seguem as fotos");
  assert.equal(captionFor({ caption: "Sala" }, 0, "Seguem as fotos"), "Seguem as fotos\nSala");
  assert.equal(captionFor({ caption: "Cozinha" }, 1, "Seguem as fotos"), "Cozinha");
  assert.equal(captionFor({ caption: "" }, 1, "Seguem as fotos"), "");
});

test("Chat do WhatsApp: seletor aceita vários, colar/arrastar, mesma rota de mídia e fila compartilhada", () => {
  const source = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(source, /<input ref=\{fileInput\} type="file" multiple /);
  assert.match(source, /onPaste=\{pasteFiles\}/);
  assert.match(source, /onDrop=\{dropFiles\}/);
  assert.doesNotMatch(source, /setAttachment\(/, "a fila de anexos substituiu o anexo único");
  assert.match(source, /sendAttachmentsInOrder\(/);
  assert.equal((source.match(/\/api\/admin\/whatsapp-chat\/conversations\/\$\{conversation\.id\}\/media`/g) || []).length, 1, "um caminho de envio de mídia só");
});

test("Chat do Marketplace: seletor aceita vários e cada arquivo vai pela rota de mídia, na ordem", () => {
  const source = readFileSync(new URL("../components/marketplace/MarketplaceChat.jsx", import.meta.url), "utf8");
  assert.match(source, /type="file" multiple accept=\{MARKETPLACE_MEDIA_ACCEPT\}/);
  assert.match(source, /sendAttachmentsInOrder\(queue/);
  assert.match(source, /\/api\/admin\/marketplace-chat\/conversations\/\$\{id\}\/media/);
});

// --- Marketplace: fila de saída com arquivos --------------------------------------------------------------------
const row = (id, conversation, extra = {}) => ({ id, conversation_id: conversation, status: "queued", claimed_at: null, attachments: [], body: "oi", created_at: "2026-10-23T12:00:00Z", ...extra });
const photo = [{ type: "image", url: "https://x.supabase.co/a.jpg", name: "a.jpg", mime: "image/jpeg" }];

test("Marketplace: arquivo só sai pela extensão 1.9.5+; com versão antiga espera e segura os seguintes da conversa", () => {
  assert.equal(supportsMarketplaceMedia("1.9.5"), true);
  assert.equal(supportsMarketplaceMedia("1.10.0"), true);
  assert.equal(supportsMarketplaceMedia("1.9.4"), false);
  assert.equal(supportsMarketplaceMedia(""), false);
  const queue = [row("f1", "c1", { body: "", attachments: photo }), row("t2", "c1"), row("t3", "c2")];
  assert.equal(pickOutboxCandidate(queue, { mediaAllowed: false }).id, "t3", "outra conversa segue normal");
  assert.equal(pickOutboxCandidate(queue, { mediaAllowed: true }).id, "f1");
});

test("Marketplace: item esperando nova tentativa segura os seguintes da mesma conversa (ordem)", () => {
  const retryBefore = "2026-10-23T12:00:00Z";
  const queue = [row("f1", "c1", { claimed_at: "2026-10-23T12:01:00Z" }), row("f2", "c1"), row("t3", "c2")];
  assert.equal(pickOutboxCandidate(queue, { retryBefore, mediaAllowed: true }).id, "t3");
  assert.equal(pickOutboxCandidate([{ ...queue[0], claimed_at: "2026-10-23T11:50:00Z" }, queue[1]], { retryBefore, mediaAllowed: true }).id, "f1");
});

test("Marketplace: payload da extensão leva o arquivo; texto continua igual", () => {
  const conversation = { thread_key: "123", thread_url: "u" };
  assert.deepEqual(toOutboxPayload({ id: "m1", body: "", attempts: 0, attachments: [{ ...photo[0], path: "p" }] }, conversation),
    { id: "m1", threadKey: "123", threadUrl: "u", body: "", attempt: 0, attachment: { type: "image", url: photo[0].url, name: "a.jpg", mime: "image/jpeg" } });
  assert.deepEqual(toOutboxPayload({ id: "m2", body: "Olá!", attempts: 1 }, conversation), { id: "m2", threadKey: "123", threadUrl: "u", body: "Olá!", attempt: 1 });
});

test("Marketplace: só foto ou PDF, até 4 MB", () => {
  assert.deepEqual(validateOutboundMedia({ mimeType: "image/jpeg", size: 1000, fileName: "sala.jpg" }), { type: "image", mime: "image/jpeg", name: "sala.jpg" });
  assert.equal(validateOutboundMedia({ mimeType: "application/pdf", size: 1000, fileName: "proposta.pdf" }).type, "file");
  assert.throws(() => validateOutboundMedia({ mimeType: "video/mp4", size: 1000 }), /foto .* ou PDF/);
  assert.throws(() => validateOutboundMedia({ mimeType: "image/png", size: MARKETPLACE_MEDIA_MAX_BYTES + 1 }), /4 MB/);
  assert.equal(messagePreview({ body: "", attachments: photo }), "[Foto]");
});

test("Marketplace: eco da foto enviada pelo CRM liga à resposta (não duplica); PDF casa pelo nome", () => {
  const now = new Date("2026-10-23T12:05:00Z");
  const candidates = [
    { id: "m1", direction: "outbound", status: "sent", body: "", attachments: photo, created_at: "2026-10-23T12:00:00Z", sent_at: "2026-10-23T12:01:00Z" },
    { id: "m2", direction: "outbound", status: "sent", body: "", attachments: [{ type: "file", url: "https://x/p.pdf", name: "Proposta.pdf" }], created_at: "2026-10-23T12:00:00Z", sent_at: "2026-10-23T12:02:00Z" }
  ];
  assert.equal(findOutboundEcho({ direction: "outbound", body: "", attachments: [{ type: "image", url: "https://fb/x.jpg" }] }, candidates, now).id, "m1");
  assert.equal(findOutboundEcho({ direction: "outbound", body: "proposta.pdf" }, candidates, now).id, "m2");
  assert.equal(findOutboundEcho({ direction: "outbound", body: "" }, candidates, now), null);
  assert.equal(findOutboundEcho({ direction: "outbound", body: "oi" }, candidates, now), null, "texto não casa com arquivo");
});
