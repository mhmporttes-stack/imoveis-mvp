// WA-19b (regra do dono, 2026-10-22): cliente do número oficial, link do Matheus, roleta ou Chat do Marketplace não
// pode ir para conversa Particular.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientePodeSerParticular, motivoBloqueioParticular, privateBlockedMessage } from "../lib/whatsapp-private-eligibility-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const OFFICIAL = "00000000-0000-0000-0000-000000000000";
const personal = { session_key: "11111111-1111-1111-1111-111111111111" };
const ownerRefs = ["matheus", "matheus-captacao", "mm"];
const client = (context, extra = {}) => ({ acquisition_context: context, distribution_type: "", ...extra });

test("conversa no número oficial nunca vai para Particular, com ou sem cliente", () => {
  assert.equal(motivoBloqueioParticular({ conversation: { session_key: OFFICIAL } }), "official");
  assert.equal(motivoBloqueioParticular({ conversation: { session_key: OFFICIAL }, client: client({ kind: "manual" }) }), "official");
});

test("cliente que entrou pelo número oficial (contato direto, anúncio, resposta ao Disparo) é bloqueado no WhatsApp pessoal", () => {
  for (const kind of ["whatsapp_organic", "whatsapp_ad", "whatsapp_reply"]) {
    assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind }) }), "official", kind);
  }
});

test("link do Matheus bloqueia; link pessoal de outro corretor não", () => {
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "broker_link", destination: "broker", metadata: { broker_ref: "Matheus" } }), ownerRefs }), "owner_link");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "broker_link", destination: "broker", metadata: { broker_ref: "mm" } }), ownerRefs }), "owner_link");
  assert.equal(clientePodeSerParticular({ conversation: personal, client: client({ kind: "broker_link", destination: "broker", metadata: { broker_ref: "bruna" } }), ownerRefs }), true);
});

test("roleta: link da equipe, link geral, campanha pela roleta, fila do anúncio e cadastro antigo da roleta", () => {
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "roulette_link", destination: "roulette" }) }), "roulette");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "site", destination: "roulette" }) }), "roulette");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "campaign", destination: "roulette" }) }), "roulette");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "site", destination: "broker" }) }), "roulette");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "paid_link", destination: "owner_waiting" }) }), "roulette");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client(null, { distribution_type: "round_robin" }) }), "roulette");
});

test("decisão do dono 2026-10-22: link pessoal pode, os outros não (campanha com corretor fixo, patrocinado, rastreado)", () => {
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "campaign", destination: "broker" }) }), "link");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "paid_link", destination: "broker" }) }), "link");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "tracked_link", destination: "broker" }) }), "link");
  assert.equal(privateBlockedMessage("link"), "Este cliente veio por um link de campanha e não pode ir para conversa particular.");
});

test("redistribuição depois da entrada não muda a origem: cadastro manual devolvido à roleta continua liberado", () => {
  assert.equal(clientePodeSerParticular({ conversation: personal, client: client({ kind: "manual", destination: "broker" }, { distribution_type: "round_robin" }) }), true);
});

test("Marketplace: origem do cadastro ou conversa do Marketplace ligada ao cliente", () => {
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "facebook_marketplace", destination: "roulette" }) }), "marketplace");
  assert.equal(motivoBloqueioParticular({ conversation: personal, client: client({ kind: "manual" }), hasMarketplaceConversation: true }), "marketplace");
});

test("liberados: sem cliente no WhatsApp pessoal, cadastro manual, contato direto no pessoal, Adicionar ao CRM (mesmo do oficial — decisão do dono 2026-10-22)", () => {
  assert.equal(clientePodeSerParticular({ conversation: personal }), true);
  for (const kind of ["manual", "whatsapp_individual", "whatsapp_chat"]) {
    assert.equal(clientePodeSerParticular({ conversation: personal, client: client({ kind, destination: "broker" }), ownerRefs }), true, kind);
  }
});

test("mensagem clara por origem", () => {
  assert.equal(privateBlockedMessage("roulette"), "Este cliente veio pela roleta e não pode ir para conversa particular.");
  assert.match(privateBlockedMessage("owner_link"), /link do Matheus/);
});

test("barreira no servidor antes de gravar e botão desligado na tela", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /const blockReason = await loadConversationPrivateBlockReason\(conversation\);\n    if \(blockReason\) throw new WhatsappChatError\(privateBlockedMessage\(blockReason\)/);
  assert.match(chat, /privateBlocked: privateBlockReason \? privateBlockedMessage\(privateBlockReason\) : ""/);
  const ui = read("components/WhatsappChat.jsx");
  assert.match(ui, /disabled=\{archiving \|\| \(!conversation\.private && Boolean\(conversation\.privateBlocked\)\)\}/);
});

test("WA-26a: arquivado de origem bloqueada não vai sozinho para Particular (os três caminhos)", () => {
  const auto = read("lib/whatsapp-auto-private.js");
  assert.match(auto, /if \(!archived\.has\(row\.client_id\) \|\| blocked\.has\(row\.client_id\)\) continue;/);
  assert.match(auto, /!linkedArchived\.has\(row\.client_id\) \|\| blocked\.has\(row\.client_id\)/);
  assert.match(auto, /if \(row\.private_at \|\| blocked\.has\(rawMatches\.get\(row\.contact_phone\)\)\) continue;/);
  const loader = read("lib/whatsapp-private-eligibility.js");
  assert.match(loader, /motivoBloqueioParticular\(\{ client, ownerRefs, hasMarketplaceConversation/);
});
