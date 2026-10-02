import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROSPECTING_STATUS_LOCK_MESSAGE, STATUS_LOCK_SINCE, decideProspectingStatusLock, isStatusAdvance } from "../lib/prospecting-status-lock-core.mjs";

// Trava de status da Prospecção (regra do dono, 2026-10-02). Dados sintéticos.
const ROUND = { status: "active", created_at: "2026-10-03T10:00:00Z" };
const base = { clientStatus: "awaiting_return", round: ROUND, automatedOutreach: true, replied: false };

test("disparo enviado e sem resposta: travado", () => {
  assert.equal(decideProspectingStatusLock(base), true);
});

test("entregue/lido/mensagem do corretor não liberam (nenhum deles gera resposta)", () => {
  // Só a pendência "Cliente respondeu" (replied) ou a rodada convertida pela
  // automação de resposta liberam — qualquer outro evento deixa travado.
  assert.equal(decideProspectingStatusLock({ ...base, replied: false }), true);
});

test("resposta real libera", () => {
  assert.equal(decideProspectingStatusLock({ ...base, replied: true }), false);
  assert.equal(decideProspectingStatusLock({ ...base, round: { ...ROUND, status: "converted" } }), false);
});

test("3ª tentativa sem resposta (rodada encerrada) continua travado", () => {
  assert.equal(decideProspectingStatusLock({ ...base, round: { ...ROUND, status: "ended_no_conversion" } }), true);
});

test("cliente fora do fluxo de disparo: comportamento normal", () => {
  assert.equal(decideProspectingStatusLock({ ...base, automatedOutreach: false }), false, "só prospecção manual");
  assert.equal(decideProspectingStatusLock({ ...base, round: null }), false, "sem rodada");
  assert.equal(decideProspectingStatusLock({ ...base, clientStatus: "in_service" }), false, "outro status");
  assert.equal(decideProspectingStatusLock({ ...base, clientStatus: "pending" }), false, "lead de formulário");
});

test("não é retroativo: rodada anterior à detecção confiável de resposta não trava", () => {
  assert.equal(decideProspectingStatusLock({ ...base, round: { ...ROUND, created_at: "2026-10-01T12:00:00Z" } }), false);
  assert.equal(decideProspectingStatusLock({ ...base, round: { ...ROUND, created_at: STATUS_LOCK_SINCE } }), true);
});

test("avanço = sair de Tentando contato para qualquer etapa do funil; Não contactar/Arquivar continuam livres", () => {
  for (const next of ["in_service", "pending", "completed", "simulation_sent", "documentation_pending", "approval_pending", "approved", "sale_completed"]) {
    assert.equal(isStatusAdvance({ currentStatus: "awaiting_return", nextStatus: next }), true, next);
  }
  for (const next of ["do_not_contact", "archived", "awaiting_return"]) {
    assert.equal(isStatusAdvance({ currentStatus: "awaiting_return", nextStatus: next }), false, next);
  }
  assert.equal(isStatusAdvance({ currentStatus: "in_service", nextStatus: "completed" }), false, "fora da prospecção");
});

test("mensagem curta pedida pelo dono", () => {
  assert.equal(PROSPECTING_STATUS_LOCK_MESSAGE, "Aguardando resposta do cliente para avançar o atendimento.");
});

// Todas as portas de mudança de status pela equipe passam pela trava ANTES de
// gravar (sem histórico/pontuação de tentativa bloqueada).
test("rotas/telas: a trava é chamada antes de gravar em todos os caminhos da equipe", () => {
  // Normaliza CRLF: no checkout Windows (core.autocrlf) os fontes vêm com \r\n e as buscas multilinha abaixo falhavam.
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const registrations = read("lib/simulation-registrations.js");
  const guardAt = registrations.indexOf("await assertProspectingStatusChangeAllowed(");
  const updateAt = registrations.indexOf('.from("simulation_registrations")\n    .update(record)');
  assert.ok(guardAt > 0 && updateAt > guardAt, "updateSimulationRegistration: trava antes do UPDATE");
  assert.ok(registrations.indexOf("recordClientStatusChange({\n      supabase,\n      clientId: id") > updateAt, "histórico só depois do UPDATE");

  const prospecting = read("lib/prospecting.js");
  const inService = prospecting.slice(prospecting.indexOf('if (action === "in_service")'));
  assert.ok(inService.indexOf("assertProspectingStatusChangeAllowed(") < inService.indexOf(".update("), "botão Em atendimento da prospecção");

  const documents = read("lib/client-documents.js");
  const submit = documents.slice(documents.indexOf("export async function submitToCca"));
  assert.ok(submit.indexOf("assertProspectingStatusChangeAllowed(") < submit.indexOf("buildCcaPackageDetail("), "envio à CCA barrado antes de enviar");
});
