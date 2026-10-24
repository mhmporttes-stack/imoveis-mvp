// Porta de entrada do painel (INI-6, dono 2026-10-24): dono abre no Início; demais perfis seguem como antes.
import test from "node:test";
import assert from "node:assert/strict";
import { CLIENTES_PATH, PAINEL_COMPUTADOR_PATH, panelEntryHref, resolvePanelEntryPath } from "../lib/painel-entrada-core.mjs";
import { INICIO_PATH } from "../lib/primeiro-acesso-core.mjs";

test("dono na conta real abre no Início no celular e no computador", () => {
  assert.equal(resolvePanelEntryPath({ ok: true, accountSwitchMode: false, isOwner: true, device: "celular" }), INICIO_PATH);
  assert.equal(resolvePanelEntryPath({ ok: true, accountSwitchMode: false, isOwner: true, device: "computador" }), INICIO_PATH);
  assert.equal(INICIO_PATH, "/admin/inicio");
});

test("dono em 'Alterar conta' segue o destino do perfil emulado (de antes)", () => {
  assert.equal(resolvePanelEntryPath({ ok: true, accountSwitchMode: true, isOwner: true, device: "celular" }), CLIENTES_PATH);
  assert.equal(resolvePanelEntryPath({ ok: true, accountSwitchMode: true, isOwner: true, device: "computador" }), PAINEL_COMPUTADOR_PATH);
});

test("demais perfis não mudam: celular/app → Clientes; computador → /admin", () => {
  assert.equal(resolvePanelEntryPath({ ok: true, accountSwitchMode: false, isOwner: false, device: "celular" }), "/admin/simulacoes");
  assert.equal(resolvePanelEntryPath({ ok: true, accountSwitchMode: false, isOwner: false }), "/admin/simulacoes");
  assert.equal(resolvePanelEntryPath({ ok: true, accountSwitchMode: false, isOwner: false, device: "computador" }), "/admin");
  assert.equal(resolvePanelEntryPath({ ok: false, isOwner: true, device: "celular" }), "/admin/simulacoes");
});

test("endereço da porta de entrada usado pelo login/2FA", () => {
  assert.equal(panelEntryHref("celular"), "/admin/abrir");
  assert.equal(panelEntryHref("computador"), "/admin/abrir?de=computador");
});
