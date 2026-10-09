import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { presentationCtaFromText, PRESENTATION_BUTTON_LABEL } from "../lib/chat-link-preview-core.mjs";

// Apresentação da simulação pelo número oficial: botão "Visualizar simulação" + imagem de prévia (dono, 2026-10-09).
const TOKEN = "uRFzoNt7qUsrcaANuUMg2Z1H";

test("só o link /s/<token> do próprio site vira botão com imagem", () => {
  const cta = presentationCtaFromText(`https://www.matheusmachadoimoveis.com.br/s/${TOKEN}?p=h28mk5`, { firstName: "Elaine dos Santos" });
  assert.equal(cta.label, "Visualizar simulação");
  assert.ok(cta.label.length <= 20, "limite do botão da Meta");
  assert.equal(cta.imageUrl, `https://www.matheusmachadoimoveis.com.br/s/${TOKEN}/og`);
  assert.equal(cta.url, `https://www.matheusmachadoimoveis.com.br/s/${TOKEN}?p=h28mk5`);
  assert.equal(cta.bodyText, "Elaine, sua simulação de financiamento está pronta.");
  assert.equal(presentationCtaFromText(`https://www.matheusmachadoimoveis.com.br/s/${TOKEN}`).bodyText, "Sua simulação de financiamento está pronta.");
  assert.equal(PRESENTATION_BUTTON_LABEL, cta.label);
});

test("texto com mais coisa, link externo, formulário público e outras páginas continuam como texto", () => {
  assert.equal(presentationCtaFromText(`Veja: https://www.matheusmachadoimoveis.com.br/s/${TOKEN}`), null);
  assert.equal(presentationCtaFromText(`https://exemplo.com/s/${TOKEN}`), null);
  assert.equal(presentationCtaFromText("https://www.matheusmachadoimoveis.com.br/s/10"), null);
  assert.equal(presentationCtaFromText("https://www.matheusmachadoimoveis.com.br/s"), null);
  assert.equal(presentationCtaFromText(`https://www.matheusmachadoimoveis.com.br/s/${TOKEN}/documentos`), null);
  assert.equal(presentationCtaFromText(""), null);
});

test("o envio pelo número oficial usa o botão e cai no texto se a Meta recusar; o pessoal não muda", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /sendChannel === "individual" \? null : presentationCtaFromText\(/);
  assert.match(chat, /type: "cta_url",\s*header: \{ type: "image"/);
  assert.match(chat, /enviando o link em texto/);
});
