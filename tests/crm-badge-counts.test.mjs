import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Desempenho (2026-10-20): contadores do menu desacoplados do ping do Chat.
const hook = readFileSync(new URL("../components/useCrmBadgeCounts.js", import.meta.url), "utf8");

test("contadores do menu não seguem mais o ping do Chat", () => {
  assert.match(hook, /useWhatsappChatSummary\(\)/);
  assert.doesNotMatch(hook, /useWhatsappChatSummary\(refresh\)/);
});

test("atualizam ao trocar de tela, ao voltar o foco e a cada 2 min com a aba visível", () => {
  assert.match(hook, /export const CRM_BADGE_POLL_MS = 2 \* 60 \* 1000;/);
  assert.match(hook, /usePathname\(\)/);
  assert.match(hook, /\}, \[pathname\]\);/);
  assert.match(hook, /if \(document\.visibilityState === "visible"\) refresh\(\);\n  \}, CRM_BADGE_POLL_MS\);/);
  assert.match(hook, /document\.addEventListener\("visibilitychange", onVisibility\)/);
});
