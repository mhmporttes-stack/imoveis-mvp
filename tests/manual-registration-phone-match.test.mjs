// Incidente 2026-10-19: "Criar cadastro" da tela de simulação achava cliente com o mesmo WhatsApp e o
// ATUALIZAVA/renomeava em silêncio (até arquivado/Particular, que nem aparece em Clientes). Trava estática.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("cadastro manual com onPhoneMatch 'ask' avisa antes de atualizar o existente", () => {
  const lib = read("lib/simulation-registrations.js");
  const fn = lib.slice(lib.indexOf("export async function ensureManualSimulationRegistration"));
  const ask = fn.indexOf('payload.onPhoneMatch === "ask"');
  const update = fn.indexOf("updateSimulationRegistration(existing.id");
  assert.ok(ask > 0 && update > ask, "o aviso precisa vir antes de qualquer atualização");
  assert.match(fn, /payload\.onPhoneMatch === "create"\s*\?\s*null/);
  assert.match(lib, /class ExistingPhoneRegistrationError[\s\S]*Nada foi alterado/);
});

test("rota manual devolve 409 com o cliente existente", () => {
  const route = read("app/api/simulation-registrations/manual/route.js");
  assert.match(route, /instanceof ExistingPhoneRegistrationError[\s\S]*status: 409/);
});

test("tela pergunta (só ao criar) e mostra o retorno junto do botão", () => {
  const ui = read("components/SimulationGenerator.jsx");
  assert.match(ui, /creating \? \{ onPhoneMatch \} : \{\}/);
  assert.match(ui, /onClick=\{\(\) => saveClientRegistration\(\)\}/, "não passar o evento de clique como onPhoneMatch");
  assert.match(ui, /saveClientRegistration\("create"\)/);
  assert.match(ui, /registrationFeedback\.existing/);
});

test("salvar simulação só vincula ao cliente do mesmo WhatsApp, sem renomear", () => {
  const sims = read("lib/simulations.js");
  assert.match(sims, /includeDetails: false,[\s\S]{0,200}keepExistingIdentity: true/);
});
