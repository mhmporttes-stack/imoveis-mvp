import test from "node:test";
import assert from "node:assert/strict";
import { deriveMeta, derivePendencias, deriveProspeccao, slimTeamGoal } from "../lib/crm-metrics/team-goal-core.mjs";
import { makeBrokerMatcher } from "../lib/alexa-v2/brokers.mjs";

// Formato idêntico ao devolvido por getOwnerTeamDailyOverview (buildOwnerTeamOverview).
const broker = (id, name, { percent, done, total, pDone, pTarget, pending = null, contatos }) => ({
  brokerId: id,
  name,
  photoUrl: "",
  meta: { done, total, percent, prospecting: { done: pDone, target: pTarget, completed: pDone >= pTarget }, pending },
  funnel: { contatos: contatos ?? pDone, atendimentos: 1, simulacoes: 0 }
});

const OVERVIEW = {
  range: { startDate: "2026-10-07", endDate: "2026-10-07" },
  summary: { metaPercent: 91, atividadesDone: 110, atividadesTotal: 120, contatos: 95, atendimentos: 9, simulacoes: 4, taxaAtendimento: 0.1, taxaSimulacao: 0.4 },
  brokers: [
    broker("b1", "Bruna Souza", { percent: 191, done: 60, total: 31, pDone: 60, pTarget: 31, pending: { done: 0, total: 0, remaining: 0, completed: false } }),
    broker("b2", "Eduardo Lima", { percent: 100, done: 31, total: 31, pDone: 31, pTarget: 31, pending: { done: 0, total: 0, remaining: 0 } }),
    broker("b3", "Carlos Dias", { percent: 74, done: 23, total: 31, pDone: 20, pTarget: 25, pending: { done: 3, total: 6, remaining: 3 } }),
    broker("b4", "Daniela Reis", { percent: 0, done: 0, total: 31, pDone: 0, pTarget: 31 }),
    broker("b5", "Sem Meta", { percent: 0, done: 0, total: 0, pDone: 0, pTarget: 0 })
  ]
};

const slim = slimTeamGoal(OVERVIEW, "2026-10-07T12:00:00Z");

test("redução mantém os números da tela e usa só o primeiro nome", () => {
  assert.equal(slim.summary.metaPercent, 91);
  assert.equal(slim.brokers.length, 5);
  assert.deepEqual(slim.brokers[0], {
    id: "b1", name: "Bruna", percent: 191, done: 60, total: 31, prospectingDone: 60, prospectingTarget: 31,
    pending: { done: 0, total: 0, remaining: 0 }, contatos: 60, atendimentos: 1, simulacoes: 0
  });
  assert.equal(slim.brokers[3].pending, null);
  assert.equal(slimTeamGoal({}).brokers.length, 0);
});

test("meta: quem bateu (percent >= 100 com meta), quem falta e quanto falta", () => {
  const hitters = deriveMeta(slim, "meta_bateram");
  assert.equal(hitters.count, 2);
  assert.deepEqual(hitters.items.map((i) => i.name), ["Bruna", "Eduardo"]);
  const missing = deriveMeta(slim, "meta_faltam");
  assert.equal(missing.count, 2);
  assert.deepEqual(missing.items.map((i) => i.name), ["Carlos", "Daniela"]);
  const each = deriveMeta(slim, "meta_cada");
  assert.deepEqual(each.items, [{ name: "Carlos", remaining: 8 }, { name: "Daniela", remaining: 31 }]);
  assert.deepEqual(deriveMeta(slim, "meta_lider"), { name: "Bruna", percent: 191 });
  assert.deepEqual(deriveMeta(slim, "meta_equipe"), { percent: 91 });
  assert.equal(deriveMeta(slim, "x"), null);
});

test("meta: ninguém com meta definida", () => {
  const empty = slimTeamGoal({ ...OVERVIEW, brokers: [OVERVIEW.brokers[4]] });
  assert.equal(deriveMeta(empty, "meta_bateram").count, 0);
  assert.equal(deriveMeta(empty, "meta_faltam").count, 0);
  assert.deepEqual(deriveMeta(empty, "meta_lider"), { name: "", percent: 0 });
});

test("prospecção: total, ranking, contra a meta, por corretor e quem não prospectou", () => {
  const team = deriveProspeccao(slim, "prospeccao_equipe");
  assert.equal(team.count, 111);
  assert.deepEqual(team.items.slice(0, 2), [{ name: "Bruna", count: 60 }, { name: "Eduardo", count: 31 }]);
  assert.deepEqual(deriveProspeccao(slim, "prospeccao_vs_meta"), { done: 111, target: 118, percent: 94 });
  assert.deepEqual(deriveProspeccao(slim, "prospeccao_corretor", { id: "b3", name: "Carlos" }), { name: "Carlos", count: 20 });
  assert.deepEqual(deriveProspeccao(slim, "prospeccao_corretor", { id: "", name: "eduardo" }), { name: "Eduardo", count: 31 });
  const none = deriveProspeccao(slim, "sem_prospeccao");
  assert.equal(none.count, 2);
  assert.deepEqual(none.items.map((i) => i.name), ["Daniela", "Sem"]);
});

test("pendências: total, nomes por tempo sem contato, ranking e 'sem contato há muito tempo'", () => {
  const payload = {
    brokers: [
      { id: "b1", name: "Bruna", remaining: 2, moreClients: 0, clients: [{ name: "Ana", days: 4 }, { name: "Pedro", days: 9 }] },
      { id: "b3", name: "Carlos", remaining: 3, moreClients: 0, clients: [{ name: "Lia", days: 3 }, { name: "Raul", days: 12 }, { name: "Eva", days: 5 }] },
      { id: "b2", name: "Eduardo", remaining: 0, moreClients: 0, clients: [] }
    ]
  };
  const all = derivePendencias(payload, "pendencias");
  assert.equal(all.count, 5);
  assert.deepEqual(all.items.map((i) => i.name), ["Raul", "Pedro", "Eva", "Ana", "Lia"]);
  assert.deepEqual(derivePendencias(payload, "pendencias_ranking").items, [{ name: "Carlos", count: 3 }, { name: "Bruna", count: 2 }, { name: "Eduardo", count: 0 }]);
  const old = derivePendencias(payload, "sem_contato");
  assert.equal(old.count, 2);
  assert.equal(old.days, 7);
});

test("reconhecer corretor falado", () => {
  const matcher = makeBrokerMatcher([{ id: "b1", name: "Bruna" }, { id: "b2", name: "Eduardo" }, { id: "b6", name: "Everaldo" }, { id: "b7", name: "João" }]);
  assert.deepEqual(matcher.match("Eduardo"), { id: "b2", name: "Eduardo" });
  assert.deepEqual(matcher.match("o eduardo"), { id: "b2", name: "Eduardo" });
  assert.deepEqual(matcher.match("joao"), { id: "b7", name: "João" });
  assert.deepEqual(matcher.match("Ed"), { id: "b2", name: "Eduardo" });
  assert.equal(matcher.match("E"), null);
  assert.equal(matcher.match("Zeca"), null);
  assert.equal(matcher.match(""), null);
  assert.deepEqual(matcher.names, ["Bruna", "Eduardo", "Everaldo", "João"]);
});
