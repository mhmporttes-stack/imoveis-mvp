// Bug real (dono, 2026-10-26): "Quantos clientes o corretor Gabriel tem com status simulação enviada" → "O Gabriel não tem
// nenhum cliente na etapa de simulação agora" e "Simulação realizada, me expressei mal" → "…nem realizada nem enviada",
// com a tela Clientes (Corretor: Gabriel) mostrando aba Simulação 5 e "Simulação realizada" 2. Causa: o catálogo da Alexa
// conta a etapa simulacao só como "Aguardando simulação" (ETAPA_STATUSES) e não conhece sub-status.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLIENT_STATUS, CLIENT_STATUS_FILTER_GROUPS } from "../lib/client-status.js";
import {
  HENRY_STAGE_GROUP,
  HENRY_SUBSTATUS_IDS,
  buildHenryStageCountReport,
  henryStageStatuses,
  henrySubStatusFromText,
  resolveHenryStageRequest
} from "../lib/henry-stage-counts-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
const gabriel = { id: "g1", name: "Gabriel Ribeiro", gender: "male" };
// Números da tela do dono (Corretor: Gabriel Ribeiro): Atendimento 16, Simulação 5 (2 realizadas), Documentação 3.
const counters = {
  byGroup: { service: 16, simulation: 5, documentation: 3, approval: 0 },
  byStatus: { in_service: 16, pending: 3, auto_simulation: 0, completed: 2, simulation_sent: 0, documentation_pending: 3 }
};

test("falas reais: sub-status pelo rótulo da tela, etapa = aba Simulação", () => {
  const sent = resolveHenryStageRequest({ etapa: "simulacao", question: "Quantos clientes o corretor Gabriel tem com status simulação enviada" });
  assert.equal(sent.group.key, "simulation");
  assert.equal(sent.sub.status, CLIENT_STATUS.SIMULATION_SENT);
  const done = resolveHenryStageRequest({ etapa: "simulacao", question: "Simulação realizada, me expressei mal" });
  assert.equal(done.sub.status, CLIENT_STATUS.COMPLETED);
  assert.equal(buildHenryStageCountReport({ request: done, counters, broker: gabriel }).spoken, "O Gabriel tem 5 clientes na etapa Simulação; 2 com simulação realizada.");
  assert.equal(buildHenryStageCountReport({ request: sent, counters, broker: gabriel }).spoken, "O Gabriel tem 5 clientes na etapa Simulação; nenhum com simulação enviada.");
  // Sem sub-status: a aba inteira (nunca só "aguardando simulação") e o que tem dentro.
  const stage = resolveHenryStageRequest({ etapa: "simulacao", question: "quantos clientes o Gabriel tem em simulação?" });
  assert.equal(stage.sub, null);
  assert.equal(buildHenryStageCountReport({ request: stage, counters, broker: gabriel }).spoken, "O Gabriel tem 5 clientes na etapa Simulação: 3 aguardando simulação e 2 com simulação realizada.");
  // Equipe e plural.
  assert.equal(buildHenryStageCountReport({ request: resolveHenryStageRequest({ question: "quantas simulações realizadas a equipe tem?" }), counters }).spoken, "A equipe tem 5 clientes na etapa Simulação; 2 com simulação realizada.");
});

test("rótulos da tela: situação dita manda na etapa; nomes da tela", () => {
  assert.equal(henrySubStatusFromText("quantos em simulação automática?")?.status, CLIENT_STATUS.AUTO_SIMULATION);
  assert.equal(henrySubStatusFromText("e aguardando simulação?")?.status, CLIENT_STATUS.PENDING);
  assert.equal(henrySubStatusFromText("quantos com documentação pendente?")?.status, CLIENT_STATUS.DOCUMENTS_PENDING);
  assert.equal(henrySubStatusFromText("quantos clientes em simulação?"), null);
  assert.ok(HENRY_SUBSTATUS_IDS.includes("simulacao_realizada") && HENRY_SUBSTATUS_IDS.includes("simulacao_enviada"));
  assert.ok(!HENRY_SUBSTATUS_IDS.includes("pago")); // "Pago" some da tela Clientes
  const doc = resolveHenryStageRequest({ etapa: "simulacao", situacao: "aguardando_documentacao" });
  assert.equal(doc.group.key, "documentation");
  assert.deepEqual(henryStageStatuses(doc), [CLIENT_STATUS.DOCUMENTATION]);
  // Toda etapa do Henry é uma aba da tela, com os mesmos status.
  for (const [etapa, key] of Object.entries(HENRY_STAGE_GROUP)) {
    const tab = CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key === key);
    assert.ok(tab, etapa);
    assert.deepEqual(henryStageStatuses(resolveHenryStageRequest({ etapa })), tab.statuses);
  }
});

test("leitura que falhou nunca vira zero; zero real é dito", () => {
  const done = resolveHenryStageRequest({ etapa: "simulacao", situacao: "simulacao_realizada" });
  assert.equal(buildHenryStageCountReport({ request: done, counters: null, broker: gabriel }), null);
  assert.equal(buildHenryStageCountReport({ request: done, counters: { byGroup: {}, byStatus: {} }, broker: gabriel }), null);
  assert.equal(buildHenryStageCountReport({ request: done, counters: { byGroup: { simulation: 0 }, byStatus: {} }, broker: gabriel }).spoken, "O Gabriel não tem nenhum cliente na etapa Simulação agora.");
  assert.match(lib, /Não consegui ver os clientes de \$\{firstName\(broker\.name\)\} nessa etapa agora\./);
});

test("fonte: os MESMOS contadores da tela Clientes, com o filtro Corretor da tela", () => {
  assert.match(reports, /export async function loadHenryStageCounts\(auth, \{ brokerId = "", statuses = null \} = \{\}\)/);
  assert.match(reports, /getSimulationClientCounters\(\{ auth, filters: brokerId \? \{ responsibleUserId: brokerId \} : \{\} \}\)/);
  assert.match(lib, /resolveHenryStageRequest\(\{ etapa: query\.etapa, situacao: query\.situacao, question: context\.question \}\)/);
  assert.match(lib, /if \(stageRequest && !keepsWaitingList\) return await runStageCount\(stageRequest, query, auth, context\);/);
  assert.match(lib, /situacao: \{ type: "string", enum: HENRY_SUBSTATUS_IDS/);
});

test("aba de um status só é a etapa (a lista \"esperando\" dos aprovados continua)", () => {
  const approved = resolveHenryStageRequest({ etapa: "aprovados", question: "e os vinte clientes aprovados esperando?" });
  assert.equal(approved.etapa, "aprovados");
  assert.equal(approved.sub, null);
});

test("rota direta sem corretor: o corretor dito na pergunta vale (\"quantos o Gabriel tem aguardando simulação?\")", () => {
  assert.match(lib, /if \(!query\.corretor\) \{\n\s+const named = brokerNamedInQuestion\(await brokerMatcher\(context\), context\.question\);/);
  assert.match(lib, /return found\.length === 1 \? found\[0\]\.name : "";/);
});
