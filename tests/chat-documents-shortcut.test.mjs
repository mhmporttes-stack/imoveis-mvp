// Atalho "Lista de documentos" do Chat (pedido do dono, 2026-10-09): cliente com cadastro/simulação recebe a lista PERSONALIZADA.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");

test("atalho 'Lista de documentos' tenta a lista personalizada do cliente antes da imagem genérica", () => {
  const start = chat.indexOf("export async function sendChatShortcut");
  const block = chat.slice(start, start + 2600);
  assert.ok(block.includes('row.kind === "image" && isDocumentsListShortcut(row.label) && conversation.client_id'));
  assert.ok(block.indexOf("personalizedDocumentsListImage(conversation.client_id, auth)") < block.indexOf('if (row.kind === "text")'), "personalizada vem antes do envio genérico");
  assert.ok(block.includes('documents_list: "personalized"') && block.includes('mime: "image/png"'));
  assert.ok(block.includes("recordClientDocumentsListSent(conversation.client_id, auth)"), "registra na jornada");
});

test("sem cliente/simulação (ou falha) cai na imagem genérica; reconhece o nome sem acento/maiúscula", () => {
  assert.ok(chat.includes('return result?.kind === "ok" && result.imageUrl ? { imageUrl: result.imageUrl, message: result.message || "" } : null;'));
  assert.ok(chat.includes("usando a genérica"));
  // a mesma normalização do nome, reproduzida aqui
  const isList = (label) => String(label || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase() === "lista de documentos";
  assert.ok(isList("Lista de documentos") && isList("  LISTA DE DOCUMENTOS ") && !isList("Carta de cancelamento"));
  assert.ok(chat.includes('.replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() === "lista de documentos"'));
});

test("a lista personalizada usa o mesmo preparo do botão da ficha (prepareClientDocumentsList), com import dinâmico", () => {
  assert.ok(chat.includes('const { prepareClientDocumentsList } = await import("./documents-forecast");'));
});
