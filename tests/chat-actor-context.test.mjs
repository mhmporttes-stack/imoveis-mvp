// Pente-fino do Chat (2026-10-08): rastro de quem enviou, modelo só no número oficial, eco do envio, auditoria e conta
// emprestada. Dados 100% sintéticos; testes de estrutura (os arquivos do servidor importam "server-only").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeChatActor } from "../lib/chat-actor-context-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("descrição do ator: conta emprestada, navegador, IP e sessão (só o administrador vê)", () => {
  assert.equal(describeChatActor(null), "");
  assert.equal(describeChatActor({}), "");
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  assert.equal(describeChatActor({ s: "abcdef123456", ip: "203.0.113.7", ua }), "Windows · Chrome · IP 203.0.113.7 · sessão 123456");
  assert.equal(describeChatActor({ via: true, realName: "Fulano Admin", s: "zzzzzz", ip: "203.0.113.7" }), "via Alterar conta (Fulano Admin) · IP 203.0.113.7 · sessão zzzzzz");
  assert.ok(describeChatActor({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1" }).startsWith("iPhone/iPad"));
});

test("login: toda requisição autenticada carrega o contexto (sessão, IP, navegador, conta emulada)", () => {
  const auth = read("lib/admin-auth.js");
  assert.ok(auth.includes("return final.ok ? { ...final, requestContext: buildRequestContext(request, final) } : final;"));
  assert.ok(auth.includes("payload?.session_id") && auth.includes("x-forwarded-for") && auth.includes("viaAccountSwitch: Boolean(result.accountSwitchMode)"));
});

test("Chat: cada envio (texto, modelo, mídia/atalho) grava o rastro; só o administrador o lê", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.ok(chat.includes("function actorMetadata(auth)"));
  assert.ok(chat.includes("metadata: { ...(replyTo ? { replyToMessageId: replyTo } : {}), ...actorMetadata(auth) }"), "texto");
  assert.ok(chat.includes("metadata: { template: template.name, ...actorMetadata(auth) }"), "modelo");
  assert.ok(chat.includes("metadata: { ...metadata, ...actorMetadata(auth) }"), "mídia/atalho");
  // 2026-10-09: o dono pediu para tirar da tela (dispositivo, IP, sessão). O rastro continua gravado em metadata.actor_ctx.
  assert.ok(!chat.includes("actorNote"), "o rastro não vai mais para a tela");
  assert.ok(!chat.includes("actor_ctx: row.metadata"), "o rastro bruto nunca sai da API");
  const screen = read("components/WhatsappChat.jsx");
  assert.ok(!screen.includes("message.actorNote"));
});

test("modelo aprovado: recusado em conversa do WhatsApp pessoal (sairia pelo número errado)", () => {
  const chat = read("lib/whatsapp-chat.js");
  const start = chat.indexOf("export async function sendChatTemplate");
  const block = chat.slice(start, start + 900);
  assert.ok(block.includes("if (conversationSessionOwner(conversation))") && block.includes("TEMPLATE_OFFICIAL_ONLY"));
});

test("eco do envio: linha duplicada (23505) é aproveitada e o autor corrigido, sem erro nem reenvio", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.equal(chat.split('insertError?.code === "23505"').length - 1, 2, "texto e mídia/atalho");
  assert.ok(chat.includes("async function adoptEchoRow(conversationId, waMessageId, patch)"));
  assert.ok(chat.includes('.eq("metadata->>wa_message_id", waMessageId)'));
});

test("auditoria: status, atribuir/assumir/liberar, editar e apagar para todos são registrados com o rastro; erro do insert é checado", () => {
  const chat = read("lib/whatsapp-chat.js");
  for (const action of ["status_changed", "message_edited", "message_deleted_for_everyone"]) assert.ok(chat.includes(`"${action}"`), action);
  assert.ok(chat.includes('target === null ? "released" : target === self ? "assumed" : "assigned"'));
  assert.ok(chat.includes("const { error } = await db().from(\"whatsapp_conversation_audit\").insert({"));
  assert.ok(chat.includes("detail: { ...detail, ...actorMetadata(auth) }"));
});

test("'Alterar conta' não conecta, desconecta nem renomeia o WhatsApp da outra pessoa", () => {
  for (const route of ["connect", "disconnect", "settings"]) {
    const code = read(`app/api/admin/whatsapp-individual/${route}/route.js`);
    assert.ok(code.includes("if (auth.accountSwitchMode) return NextResponse.json"), route);
    assert.ok(code.indexOf("auth.accountSwitchMode") < code.indexOf("const userId = auth.profile"), `${route}: antes de usar o perfil emulado`);
  }
});

test("lista do Chat: 100 conversas por página (antes 40, sem 'carregar mais')", () => {
  assert.ok(read("lib/whatsapp-chat.js").includes("const CONVERSATION_PAGE_SIZE = 100;"));
});
