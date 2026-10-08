import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOutgoing, interpolate } from "../lib/whatsapp-flow-core.mjs";

// Fluxo do anúncio (2026-10-08): saudação por horário + botão de link com imagem de prévia.
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("{{saudacao}} entra nas variáveis do fluxo e vira 'Bom dia, Ana!' (sem nome: 'Bom dia!')", () => {
  assert.match(source("lib/whatsapp-flows.js"), /saudacao: getTimeGreeting\(\),/);
  assert.equal(interpolate("{{saudacao}}, {{primeiro_nome}}! Muito bom ter você por aqui.", { saudacao: "Bom dia", primeiro_nome: "Ana" }), "Bom dia, Ana! Muito bom ter você por aqui.");
  assert.equal(interpolate("{{saudacao}}, {{primeiro_nome}}! Muito bom ter você por aqui.", { saudacao: "Bom dia", primeiro_nome: "" }), "Bom dia! Muito bom ter você por aqui.");
});

test("mensagem de link: botão 'Preencher formulário' com imagem de cabeçalho (prévia)", () => {
  const node = { id: "form", type: "message", data: { mode: "link", text: "Preencha o formulário.", linkLabel: "Preencher formulário", linkUrl: "{{link_simulacao}}", imageUrl: "https://www.matheusmachadoimoveis.com.br/assets/og-simulacao-v3.png" } };
  const { message } = buildOutgoing(node, { link_simulacao: "https://www.matheusmachadoimoveis.com.br/s/mhm" }, "fx");
  assert.equal(message.interactive.type, "cta_url");
  assert.equal(message.interactive.header.type, "image");
  assert.equal(message.interactive.action.parameters.display_text, "Preencher formulário");
  assert.equal(message.interactive.action.parameters.url, "https://www.matheusmachadoimoveis.com.br/s/mhm");
});
