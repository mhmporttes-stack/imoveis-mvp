// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] App "Chat" da tela inicial: o alerta "Importante" (Central de Alertas) e
// a janela obrigatória do cliente esfriado (FUN-15) também aparecem e bloqueiam dentro do app Chat. App Financeiro sem
// avisos; Mensagem do dia, Celebração e Supervisão continuam fora do Chat; "Alterar conta" como hoje.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gatesForApp } from "../components/panel-gates-by-app.mjs";

const all = { daily: { userId: "u" }, celebration: { userId: "u" }, supervision: { userId: "u" }, alerts: { userId: "u" }, clientPopups: { userId: "u" } };

test("Painel: todos os avisos; Financeiro: nenhum; Chat: só a Central em modo Importante", () => {
  assert.deepEqual(gatesForApp("", all), all);
  assert.deepEqual(gatesForApp("financeiro", all), { daily: null, celebration: null, supervision: null, alerts: null, clientPopups: null });
  assert.deepEqual(gatesForApp("chat", all), { daily: null, celebration: null, supervision: null, alerts: { userId: "u", importantOnly: true }, clientPopups: { userId: "u" } });
  // "Alterar conta": o layout manda alerts = null — continua sem Central também no Chat.
  assert.deepEqual(gatesForApp("chat", { ...all, alerts: null }).alerts, null);
});

test("layout e app Chat: a Central não fica mais dentro do HideInFinanceiroApp; /chat-app monta só o gate de alertas", () => {
  const layout = readFileSync(new URL("../app/admin/layout.jsx", import.meta.url), "utf8");
  const firstHide = layout.indexOf("<HideInFinanceiroApp>");
  const firstClose = layout.indexOf("</HideInFinanceiroApp>");
  const gates = layout.indexOf("<DeferredPanelGates");
  assert.ok(firstHide >= 0 && firstClose > firstHide && gates > firstClose, "DeferredPanelGates fora do HideInFinanceiroApp");
  assert.ok(layout.slice(firstHide, firstClose).includes("FirstAccessGate"), "o bom dia do dono continua fora dos apps");
  const deferred = readFileSync(new URL("../components/DeferredPanelGates.jsx", import.meta.url), "utf8");
  assert.match(deferred, /gatesForApp\(getMmApp\(\), props\)/);
  const chatApp = readFileSync(new URL("../app/chat-app/page.jsx", import.meta.url), "utf8");
  assert.match(chatApp, /<DeferredPanelGates alerts=\{auth\.accountSwitchMode \? null : \{ userId: auth\.profile\?\.id \}\} \/>/);
  const gate = readFileSync(new URL("../components/alerts/AlertCenterGate.jsx", import.meta.url), "utf8");
  assert.match(gate, /if \(importantOnly\) return;/, "Informativo nem entra na fila no Chat");
  assert.match(gate, /importantOnly \? null : <InformativeStack/);
});
