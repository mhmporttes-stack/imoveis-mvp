import test from "node:test";
import assert from "node:assert/strict";
import { deriveConversao, deriveRanking, deriveResultados, slimOverview } from "../lib/crm-metrics/overview-core.mjs";
import { agendaRange, brParts, buildMeetingItems, nextMeeting } from "../lib/alexa-v2/providers/agenda-core.mjs";
import { firstNameOf } from "../lib/alexa-v2/text.mjs";
import { TOPICS } from "../lib/alexa-v2/catalog.mjs";

// Formato idêntico ao de getPerformanceOverview.
const OVERVIEW = {
  range: { startDate: "2026-10-07", endDate: "2026-10-07" },
  metrics: { newClients: 12, prospecting: 309, service: 9, simulation: 4, approvalPending: 3, approval: 2, sale: 3 },
  team: [
    { profile: { id: "b1", name: "bruna souza", role: "broker", gender: "female" }, newClients: 4, prospecting: 123, approval: 1, sale: 2, points: 195 },
    { profile: { id: "b2", name: "Eduardo Lima", role: "broker", gender: "male" }, newClients: 3, prospecting: 57, approval: 1, sale: 1, points: 150 },
    { profile: { id: "b3", name: "Carlos Dias", role: "broker", gender: "male" }, newClients: 0, prospecting: 0, approval: 0, sale: 0, points: 0 },
    { profile: { id: "m1", name: "Gerente Teste", role: "manager", gender: "" }, newClients: 0, prospecting: 0, approval: 0, sale: 0, points: 10 }
  ],
  ranking: [
    { profile: { id: "b1", name: "bruna souza", gender: "female" }, points: 195 },
    { profile: { id: "b2", name: "Eduardo Lima", gender: "male" }, points: 150 },
    { profile: { id: "b3", name: "Carlos Dias", gender: "male" }, points: 0 }
  ]
};
const slim = slimOverview(OVERVIEW, "2026-10-07T12:00:00Z");

test("nomes saem com inicial maiúscula e só o primeiro nome", () => {
  assert.equal(firstNameOf("bruna souza"), "Bruna");
  assert.equal(firstNameOf("  ketlin  "), "Ketlin");
  assert.equal(firstNameOf("João 99"), "João");
  assert.equal(firstNameOf(""), "");
});

test("resultados: vendas e aprovações usam os mesmos números do Desempenho", () => {
  const sales = deriveResultados(slim, "vendas");
  assert.equal(sales.count, 3);
  assert.deepEqual(sales.items.slice(0, 2), [{ name: "Bruna", count: 2 }, { name: "Eduardo", count: 1 }]);
  assert.equal(deriveResultados(slim, "aprovacoes").count, 2);
  assert.deepEqual(deriveResultados(slim, "desempenho"), { newClients: 12, prospecting: 309, approval: 2, sale: 3 });
  assert.equal(deriveResultados(slim, "x"), null);
});

test("ranking: melhor do dia só com pontos, lista e pontos por corretor", () => {
  assert.deepEqual(deriveRanking(slim, "melhor_dia"), { name: "Bruna", points: 195, gender: "female" });
  const empty = slimOverview({ ...OVERVIEW, ranking: [{ profile: { id: "b3", name: "Carlos" }, points: 0 }] });
  assert.deepEqual(deriveRanking(empty, "melhor_dia"), { name: "", points: 0 });
  assert.deepEqual(deriveRanking(slim, "ranking").items.map((i) => i.name), ["Bruna", "Eduardo", "Carlos"]);
  assert.deepEqual(deriveRanking(slim, "pontos", { id: "", name: "eduardo" }), { name: "Eduardo", points: 150 });
  assert.deepEqual(deriveRanking(slim, "pontos", { id: "zzz", name: "Zeca" }), { name: "Zeca", points: 0 });
});

test("conversão vem das taxas da Meta da Equipe", () => {
  assert.deepEqual(deriveConversao({ summary: { taxaAtendimento: 0.1, taxaSimulacao: 0.4 } }), { taxaAtendimento: 0.1, taxaSimulacao: 0.4 });
  assert.deepEqual(deriveConversao(null), { taxaAtendimento: null, taxaSimulacao: null });
});

test("agenda: faixas por período (esta semana olha para a frente)", () => {
  assert.deepEqual(agendaRange("hoje", "2026-10-07"), { startDate: "2026-10-07", endDate: "2026-10-07" });
  assert.deepEqual(agendaRange("amanha", "2026-10-07"), { startDate: "2026-10-08", endDate: "2026-10-08" });
  assert.deepEqual(agendaRange("esta_semana", "2026-10-07"), { startDate: "2026-10-07", endDate: "2026-10-11" });
});

test("agenda: horário de Brasília, dia, deduplicação e próxima reunião", () => {
  assert.deepEqual(brParts("2026-10-07T17:00:00Z"), { dateKey: "2026-10-07", hours: 14, minutes: 0 });
  assert.deepEqual(brParts("2026-10-08T02:30:00Z"), { dateKey: "2026-10-07", hours: 23, minutes: 30 });
  const brokerNames = new Map([["b2", "Eduardo Lima"]]);
  const items = buildMeetingItems(
    [
      { at: "2026-10-09T13:30:00Z", clientId: "c2", clientName: "maria souza", brokerId: "b2" },
      { at: "2026-10-07T13:00:00Z", clientId: "c1", clientName: "João Alves", brokerId: "b2" },
      { at: "2026-10-07T13:00:00Z", clientId: "c1", clientName: "João Alves", brokerId: "b2" }
    ],
    { today: "2026-10-07", brokerNames }
  );
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { at: "2026-10-07T13:00:00Z", hours: 10, minutes: 0, dayOffset: 0, weekdayName: "quarta-feira", client: "João", broker: "Eduardo" });
  assert.equal(items[1].dayOffset, 2);
  assert.equal(items[1].weekdayName, "sexta-feira");
  const next = nextMeeting(items, new Date("2026-10-07T14:00:00Z"));
  assert.deepEqual(next, { when: { dayOffset: 2, hours: 10, minutes: 30, weekdayName: "sexta-feira" }, client: "Maria", broker: "Eduardo" });
  assert.equal(nextMeeting(items, new Date("2026-10-20T00:00:00Z")), null);
});

test("frases da agenda e dos resultados com dados reais do formato", () => {
  const items = buildMeetingItems([{ at: "2026-10-07T13:00:00Z", clientId: "c1", clientName: "João", brokerId: "b2" }], { today: "2026-10-07", brokerNames: new Map([["b2", "Eduardo"]]) });
  const q = { page: 0, periodoSpoken: "hoje" };
  assert.equal(TOPICS.agenda.say.count({ count: 1, items }, q), "Hoje temos 1 reunião.");
  assert.equal(TOPICS.agenda.say.list({ count: 1, items }, q).text, "10 horas com João.");
  const next = nextMeeting(items, new Date("2026-10-07T12:00:00Z"));
  assert.equal(TOPICS.proxima_reuniao.say.count(next, q), "A próxima reunião é hoje às 10 horas, com João, corretor Eduardo.");
  assert.equal(TOPICS.proxima_reuniao.say.count({ when: null }, q), "Não há reuniões marcadas para os próximos dias.");
  assert.equal(TOPICS.vendas.say.count({ count: 3 }, { periodoSpoken: "hoje" }), "Tivemos 3 vendas hoje.");
  assert.equal(TOPICS.melhor_dia.say.count({ name: "Bruna", points: 195 }, { periodoSpoken: "hoje" }), "O melhor do dia é Bruna, com 195 pontos.");
  assert.equal(TOPICS.atencao.say.count({ items: ["3 clientes sem atendimento humano", "5 pendências"] }, q), "Precisa de atenção: 3 clientes sem atendimento humano e 5 pendências.");
  assert.equal(TOPICS.atencao.say.count({ items: [] }, q), "Nada urgente no momento.");
  assert.equal(TOPICS.funil.say.count({ stages: [{ label: "simulação", count: 6 }, { label: "documentação", count: 0 }, { label: "aprovação", count: 2 }] }, q), "No funil: 6 em simulação e 2 em aprovação.");
});
