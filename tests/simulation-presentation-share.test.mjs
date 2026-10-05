import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildShareMetadata, shareFirstName, shareTitleFor } from "../lib/simulation-presentation-share.mjs";

// Prévia do link /s/<token> (PRES-18): só o primeiro nome; token inválido sem nome; sem evento de visualização.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const TOKEN = "aB3dEfGhIjKlMnOpQrStUvW9".slice(0, 24);

test("título usa só o primeiro nome; sem nome vira genérico", () => {
  assert.equal(shareTitleFor("Maria Aparecida da Silva"), "Maria, sua simulação de financiamento está pronta");
  assert.equal(shareTitleFor(""), "Sua simulação de financiamento está pronta");
  assert.equal(shareTitleFor(undefined), "Sua simulação de financiamento está pronta");
});

test("metadata: OG + Twitter Card com imagem por token 1200x630, noindex, sem sobrenome nem dados", () => {
  const meta = buildShareMetadata({ token: TOKEN, firstName: "Maria Silva" });
  assert.equal(meta.openGraph.title, "Maria, sua simulação de financiamento está pronta");
  assert.equal(meta.twitter.card, "summary_large_image");
  assert.equal(meta.openGraph.images[0].url, `https://www.matheusmachadoimoveis.com.br/s/${TOKEN}/og`);
  assert.equal(meta.openGraph.images[0].width, 1200);
  assert.equal(meta.openGraph.images[0].height, 630);
  assert.equal(meta.description, "Matheus Machado · Corretor de imóveis");
  assert.equal(meta.robots.index, false);
  assert.doesNotMatch(JSON.stringify(meta), /Silva|R\$|\d{4,}-\d/);
});

test("shareFirstName lê só o primeiro nome da cena de abertura", () => {
  assert.equal(shareFirstName({ scenes: [{ id: "abertura", firstName: "Carol" }] }), "Carol");
  assert.equal(shareFirstName(null), "");
});

test("página: token inválido/revogado → prévia genérica e 404; rota og → 404; nenhuma grava evento", () => {
  const page = read("app/apresentacao/[token]/page.jsx");
  assert.match(page, /generateMetadata/);
  assert.match(page, /if \(!dto\) notFound\(\)/);
  assert.match(page, /if \(!dto\) return \{ title: "Sua simulação"/);
  const og = read("app/apresentacao/[token]/og/route.js");
  assert.match(og, /status: 404/);
  assert.match(og, /getPublicPresentation/);
  for (const src of [page, og, read("lib/simulation-presentation-share.mjs")]) assert.doesNotMatch(src, /recordPresentationEvent/);
});

test("proxy reescreve /s/<token>/og com no-store/noindex", () => {
  assert.match(read("proxy.js"), /\(imagem\|documentos\|og\)/);
});
