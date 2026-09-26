import test from "node:test";
import assert from "node:assert/strict";
import { INBOUND_MEDIA_TYPES, inboundMediaInfo, mediaExtensionForMime, safeDownloadName } from "../lib/whatsapp-media-utils.mjs";

test("tipos de mídia recebida baixados", () => {
  for (const type of ["audio", "image", "document", "video", "sticker"]) assert.ok(INBOUND_MEDIA_TYPES.includes(type));
  assert.ok(!INBOUND_MEDIA_TYPES.includes("text"));
});

test("inboundMediaInfo lê id, mime, nome do arquivo e legenda do payload da Meta", () => {
  const document = inboundMediaInfo({ type: "document", document: { id: " 123 ", mime_type: "application/pdf", filename: "RG.pdf", caption: "meu RG" } }, "document");
  assert.deepEqual(document, { id: "123", mime: "application/pdf", filename: "RG.pdf", caption: "meu RG" });
  assert.equal(inboundMediaInfo({ image: { id: "9" } }, "image").id, "9");
  assert.equal(inboundMediaInfo({}, "image").id, "");
  assert.equal(inboundMediaInfo({ type: "unsupported" }, "document").id, "");
});

test("extensão por tipo de arquivo", () => {
  assert.equal(mediaExtensionForMime("image/jpeg"), "jpg");
  assert.equal(mediaExtensionForMime("application/pdf; charset=binary"), "pdf");
  assert.equal(mediaExtensionForMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
  assert.equal(mediaExtensionForMime("audio/ogg; codecs=opus"), "ogg");
  assert.equal(mediaExtensionForMime("application/x-desconhecido"), "bin");
});

test("nome de download seguro", () => {
  assert.equal(safeDownloadName("Comprovante de renda.pdf", "documento", "application/pdf"), "Comprovante de renda.pdf");
  assert.equal(safeDownloadName("../../etc/passwd", "documento", "application/pdf"), ".._.._etc_passwd");
  assert.equal(safeDownloadName("", "imagem-1", "image/png"), "imagem-1.png");
  assert.equal(safeDownloadName(undefined, "video", "video/mp4"), "video.mp4");
});
