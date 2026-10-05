import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Prévia de compartilhamento de /simulacao (2026-10-04): metadados no HTML estático + imagem 1200x630 existente.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(path.join(root, "app/simulacao/page.jsx"), "utf8");

test("/simulacao declara título, descrição, canonical, Open Graph e Twitter Card", () => {
  assert.match(page, /SHARE_TITLE = "Simule seu primeiro imóvel \| Matheus Machado"/);
  assert.match(page, /SHARE_DESCRIPTION = "Descubra seu poder de compra e dê o primeiro passo para o seu imóvel\."/);
  assert.match(page, /alternates: \{ canonical: SHARE_URL \}/);
  assert.match(page, /url: SHARE_URL,/);
  assert.match(page, /card: "summary_large_image"/);
  assert.match(page, /width: 1200, height: 630/);
  assert.match(page, /SHARE_URL = "https:\/\/www\.matheusmachadoimoveis\.com\.br\/simulacao"/);
});

test("a imagem referenciada existe como PNG 1200x630 (URL absoluta https)", () => {
  const match = page.match(/SHARE_IMAGE = "https:\/\/www\.matheusmachadoimoveis\.com\.br(\/assets\/[^"]+\.png)"/);
  assert.ok(match, "URL absoluta da imagem");
  const file = path.join(root, "public", match[1]);
  assert.ok(statSync(file).size < 1024 * 1024, "imagem leve (<1MB)");
  const header = readFileSync(file).subarray(0, 24);
  assert.equal(header.readUInt32BE(16), 1200);
  assert.equal(header.readUInt32BE(20), 630);
});
