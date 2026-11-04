import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// "Voltar" fecha só a camada aberta (dono, 2026-11-04). Estrutura do gancho e onde ele é usado.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("gancho: uma entrada de histórico com a MESMA url, marca própria, sem navegar", () => {
  const hook = read("components/use-back-to-close.js");
  assert.match(hook, /window\.history\.pushState\(\{ \.\.\.\(window\.history\.state \|\| \{\}\), mmBack: token \}, "", window\.location\.href\)/);
  assert.match(hook, /popstate/);
  // sair da tela inteira (troca de página) nunca mexe no histórico
  assert.match(hook, /if \(popped \|\| unmounting\.current\) return;/);
  assert.ok(!hook.includes("router.push") && !hook.includes("location.assign"));
});

test("usado na gaveta (ficha do cliente), na conversa do Chat e na do Marketplace, só no celular nos chats", () => {
  assert.match(read("components/ui/Sheet.jsx"), /useBackToClose\(open, requestClose\)/);
  assert.match(read("components/WhatsappChat.jsx"), /useBackToClose\(Boolean\(selectedId\), closeConversation, \{ maxWidth: 1024 \}\)/);
  assert.match(read("components/marketplace/MarketplaceChat.jsx"), /useBackToClose\(Boolean\(selectedId\), \(\) => \{ setListBack\(true\); setSelectedId\(""\); setThread\(null\); \}, \{ maxWidth: 768 \}\)/);
});
