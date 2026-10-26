// Versão nova do painel (components/PwaLifecycle.jsx): sair/voltar ao app nunca recarrega (dono, 2026-10-26).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideUpdateAction, hardNavigationTarget, isRealUpdate, UPDATE_ACTIONS } from "../components/pwa-update-policy.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://www.matheusmachadoimoveis.com.br";

test("sair ou voltar para o app nunca recarrega, mesmo com versão nova pendente", () => {
  for (const trigger of ["visible", "hidden", "controller-change", ""]) {
    assert.equal(decideUpdateAction({ pending: true, trigger }), UPDATE_ACTIONS.NONE, trigger);
  }
});

test("versão nova entra na próxima troca de tela", () => {
  assert.equal(decideUpdateAction({ pending: true, trigger: "link-click" }), UPDATE_ACTIONS.HARD_NAVIGATE);
  assert.equal(decideUpdateAction({ pending: true, trigger: "route-change" }), UPDATE_ACTIONS.RELOAD);
  assert.equal(decideUpdateAction({ pending: true, trigger: "route-change", typing: true }), UPDATE_ACTIONS.NONE);
});

test("sem versão pendente nada acontece", () => {
  for (const trigger of ["visible", "hidden", "link-click", "route-change"]) {
    assert.equal(decideUpdateAction({ pending: false, trigger }), UPDATE_ACTIONS.NONE, trigger);
  }
});

test("primeira instalação do service worker não conta como versão nova", () => {
  assert.equal(isRealUpdate({ hadControllerAtStart: false }), false);
  assert.equal(isRealUpdate({ hadControllerAtStart: true }), true);
});

test("link do próprio painel vira abertura completa; os demais seguem normais", () => {
  const base = { origin: ORIGIN, currentHref: `${ORIGIN}/admin/inicio` };
  assert.equal(hardNavigationTarget({ ...base, href: "/admin/simulacoes" }), `${ORIGIN}/admin/simulacoes`);
  assert.equal(hardNavigationTarget({ ...base, href: "/admin/simulacoes?query=ana" }), `${ORIGIN}/admin/simulacoes?query=ana`);
  assert.equal(hardNavigationTarget({ ...base, href: "https://wa.me/5500" }), null, "outro site");
  assert.equal(hardNavigationTarget({ ...base, href: "#topo" }), null, "âncora na mesma tela");
  assert.equal(hardNavigationTarget({ ...base, href: "/admin/inicio#x" }), null, "mesma tela");
  assert.equal(hardNavigationTarget({ ...base, href: "/admin/chat", target: "_blank" }), null, "nova aba");
  assert.equal(hardNavigationTarget({ ...base, href: "/api/x.pdf", download: true }), null, "download");
  assert.equal(hardNavigationTarget({ ...base, href: "/admin/chat", metaKey: true }), null, "atalho de teclado");
  assert.equal(hardNavigationTarget({ ...base, href: "/admin/chat", button: 1 }), null, "botão do meio");
  assert.equal(hardNavigationTarget({ ...base, href: "/admin/chat", optOut: true }), null, "data-no-hard-nav");
  assert.equal(hardNavigationTarget({ ...base, href: "mailto:a@b.c" }), null, "mailto");
  assert.equal(hardNavigationTarget({ ...base, href: "" }), null);
});

test("PwaLifecycle não tem mais recarga automática ao sair/voltar", () => {
  const pwa = fs.readFileSync(path.join(root, "components/PwaLifecycle.jsx"), "utf8");
  assert.doesNotMatch(pwa, /reloadIfAway|reloadOnReturn/);
  // Toda recarga passa pela regra pura (link → abertura completa; troca de rota → recarga).
  const reloads = pwa.match(/window\.location\.(reload|assign)\(/g) || [];
  assert.equal(reloads.length, 2);
  assert.match(pwa, /window\.addEventListener\("click", handleLinkClick, true\)/);
  // O service worker continua assumindo sozinho (o caminho de atualização segue funcionando).
  const sw = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
});
