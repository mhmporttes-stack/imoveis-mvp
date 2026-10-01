import test from "node:test";
import assert from "node:assert/strict";
import { detectImageType } from "../lib/image-signature.mjs";

test("reconhece JPEG, PNG e WEBP pelos bytes", () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 ")])), "image/webp");
});

test("recusa conteúdo que não é imagem aceita, mesmo com nome/MIME de imagem", () => {
  assert.equal(detectImageType(Buffer.from("<html><script>alert(1)</script>")), "");
  assert.equal(detectImageType(Buffer.from("%PDF-1.7")), "");
  assert.equal(detectImageType(Buffer.from("GIF89a")), "");
  assert.equal(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WAVE")])), "");
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8])), "");
  assert.equal(detectImageType(null), "");
});
