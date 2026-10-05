Descubra quanto você pode financiar |import test from "node:test";
Descubra quanto você pode financiar |import assert from "node:assert/strict";
Descubra quanto você pode financiar |import { readFileSync, statSync } from "node:fs";
Descubra quanto você pode financiar |import { fileURLToPath } from "node:url";
Descubra quanto você pode financiar |import path from "node:path";
Descubra quanto você pode financiar |
Descubra quanto você pode financiar |// Prévia de compartilhamento de /simulacao (2026-10-04): metadados no HTML estático + imagem 1200x630 existente.
Descubra quanto você pode financiar |const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
Descubra quanto você pode financiar |const page = readFileSync(path.join(root, "app/simulacao/page.jsx"), "utf8");
Descubra quanto você pode financiar |
Descubra quanto você pode financiar |test("/simulacao declara título, descrição, canonical, Open Graph e Twitter Card", () => {
Descubra quanto você pode financiar |  assert.match(page, /SHARE_TITLE = "Simule seu primeiro imóvel \| Matheus Machado"/);
Descubra quanto você pode financiar |  assert.match(page, /SHARE_DESCRIPTION = "Descubra seu poder de compra e dê o primeiro passo para o seu imóvel\."/);
Descubra quanto você pode financiar |  assert.match(page, /alternates: \{ canonical: SHARE_URL \}/);
Descubra quanto você pode financiar |  assert.match(page, /url: SHARE_URL,/);
Descubra quanto você pode financiar |  assert.match(page, /card: "summary_large_image"/);
Descubra quanto você pode financiar |  assert.match(page, /width: 1200, height: 630/);
Descubra quanto você pode financiar |  assert.match(page, /SHARE_URL = "https:\/\/www\.matheusmachadoimoveis\.com\.br\/simulacao"/);
Descubra quanto você pode financiar |});
Descubra quanto você pode financiar |
Descubra quanto você pode financiar |test("a imagem referenciada existe como PNG 1200x630 (URL absoluta https)", () => {
Descubra quanto você pode financiar |  const match = page.match(/SHARE_IMAGE = "https:\/\/www\.matheusmachadoimoveis\.com\.br(\/assets\/[^"]+\.png)"/);
Descubra quanto você pode financiar |  assert.ok(match, "URL absoluta da imagem");
Descubra quanto você pode financiar |  const file = path.join(root, "public", match[1]);
Descubra quanto você pode financiar |  assert.ok(statSync(file).size < 1024 * 1024, "imagem leve (<1MB)");
Descubra quanto você pode financiar |  const header = readFileSync(file).subarray(0, 24);
Descubra quanto você pode financiar |  assert.equal(header.readUInt32BE(16), 1200);
Descubra quanto você pode financiar |  assert.equal(header.readUInt32BE(20), 630);
Descubra quanto você pode financiar |});
