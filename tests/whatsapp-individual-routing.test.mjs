import test from "node:test";
import assert from "node:assert/strict";
import { pickSendChannel } from "../lib/whatsapp-individual-routing.mjs";

test("responsável com sessão individual conectada -> envia pela sessão individual", () => {
  assert.equal(pickSendChannel({ assignedUserId: "user-1", individualSessionStatus: "connected" }), "individual");
});

test("responsável sem sessão individual configurada -> preserva o caminho atual (número oficial)", () => {
  assert.equal(pickSendChannel({ assignedUserId: "user-1", individualSessionStatus: null }), "cloud_api");
  assert.equal(pickSendChannel({ assignedUserId: "user-1", individualSessionStatus: undefined }), "cloud_api");
});

test("conversa sem responsável nenhum -> preserva o caminho atual (número oficial)", () => {
  assert.equal(pickSendChannel({ assignedUserId: null, individualSessionStatus: "connected" }), "cloud_api");
  assert.equal(pickSendChannel({ assignedUserId: "" }), "cloud_api");
  assert.equal(pickSendChannel({}), "cloud_api");
});

// Regra central da feature: sessão CONFIGURADA mas não conectada nunca cai
// silenciosamente para o número oficial banido pela Meta — o backend bloqueia
// com um erro claro em vez de arriscar perder a mensagem.
test("responsável com sessão individual configurada mas desconectada -> bloqueia (não cai pro número oficial)", () => {
  for (const status of ["disconnected", "connecting", "qr_required", "reconnecting", "error"]) {
    assert.equal(pickSendChannel({ assignedUserId: "user-1", individualSessionStatus: status }), "blocked", `status=${status}`);
  }
});
