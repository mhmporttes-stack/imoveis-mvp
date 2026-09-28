import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { chatDocumentProgress } from "../lib/chat-document-progress.mjs";
import { partitionChatSelection } from "../lib/document-policy.mjs";

test("progresso começa em zero, desacelera e só conclui após confirmação", () => {
  assert.equal(chatDocumentProgress(0), 0);
  assert.ok(chatDocumentProgress(10000) > 0);
  assert.ok(chatDocumentProgress(30000) > chatDocumentProgress(10000));
  assert.ok(chatDocumentProgress(600000) >= 90 && chatDocumentProgress(600000) < 100);
  assert.equal(chatDocumentProgress(600000, true), 100);
});

test("seleção de mensagens e arquivos mantém apenas IDs escolhidos", () => {
  const rows = [
    { id: "text", direction: "inbound", message_type: "text", body: "Meu PIS é 123" },
    { id: "pdf", direction: "inbound", message_type: "document" },
    { id: "photo", direction: "outbound", message_type: "image" },
    { id: "unselected", direction: "inbound", message_type: "text", body: "Não escolhido" }
  ];
  const result = partitionChatSelection(rows, ["text", "pdf", "photo"]);
  assert.deepEqual(result.texts.map((item) => item.id), ["text"]);
  assert.deepEqual(result.media.map((item) => item.id), ["pdf", "photo"]);
});

test("renderizador local consegue ler a primeira página de PDF multipágina", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage(); pdf.addPage();
  const bytes = await pdf.save();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true });
  const document = await task.promise;
  assert.equal(document.numPages, 2);
  assert.equal((await document.getPage(1)).pageNumber, 1);
  await task.destroy();
});
