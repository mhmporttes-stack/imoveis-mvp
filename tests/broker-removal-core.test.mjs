import test from "node:test";
import assert from "node:assert/strict";
import { canRemoveBroker, planBalancedDistribution, planSingleTransfer, selectEligibleRecipients } from "../lib/broker-removal-core.mjs";

const mk = (status, n, prefix = status) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${String(i).padStart(3, "0")}`, status }));
const team = (n) => Array.from({ length: n }, (_, i) => ({ id: `b${i + 1}`, name: `Corretor ${i + 1}` }));

function check(plan, clients) {
  const ids = plan.assignments.map((a) => a.clientId).sort();
  assert.deepEqual(ids, clients.map((c) => c.id).sort(), "nenhum cliente perdido ou duplicado");
  assert.equal(new Set(ids).size, ids.length);
  const totals = plan.perBroker.map((b) => b.total);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 1, `totais equilibrados: ${totals}`);
  for (const status of new Set(clients.map((c) => c.status))) {
    const per = plan.perBroker.map((b) => b.byStatus[status] || 0);
    assert.ok(Math.max(...per) - Math.min(...per) <= 1, `etapa ${status} equilibrada: ${per}`);
  }
}

test("divisão exata: 30 clientes / 5 corretores = 6 cada", () => {
  const clients = mk("in_service", 30);
  const plan = planBalancedDistribution({ clients, recipients: team(5) });
  check(plan, clients);
  assert.deepEqual(plan.perBroker.map((b) => b.total), [6, 6, 6, 6, 6]);
});

test("exemplo do dono: 6 Atendimento + 6 Arquivado, 6 corretores = 1 de cada", () => {
  const clients = [...mk("in_service", 6), ...mk("archived", 6)];
  const plan = planBalancedDistribution({ clients, recipients: team(6) });
  check(plan, clients);
  for (const b of plan.perBroker) assert.deepEqual(b.byStatus, { in_service: 1, archived: 1 });
});

test("divisão com sobras: sobra de cada etapa vai para corretores diferentes", () => {
  const clients = [...mk("in_service", 7), ...mk("archived", 7), ...mk("approved", 7)];
  const plan = planBalancedDistribution({ clients, recipients: team(5) });
  check(plan, clients);
  assert.deepEqual(plan.perBroker.map((b) => b.total).sort(), [4, 4, 4, 4, 5]);
  // 3 grupos × 2 sobras = 6 extras espalhados: nenhum corretor recebe extra em todas as etapas.
  for (const b of plan.perBroker) {
    const extras = Object.values(b.byStatus).filter((v) => v === 2).length;
    assert.ok(extras <= 2);
  }
});

test("vários status/etapas com tamanhos diferentes", () => {
  const clients = [...mk("in_service", 11), ...mk("archived", 4), ...mk("simulation_sent", 3), ...mk("approved", 1), ...mk("sale_paid", 2)];
  const plan = planBalancedDistribution({ clients, recipients: team(4) });
  check(plan, clients);
});

test("mais clientes que corretores", () => {
  const clients = [...mk("in_service", 50), ...mk("archived", 13)];
  const plan = planBalancedDistribution({ clients, recipients: team(6) });
  check(plan, clients);
});

test("menos clientes que corretores: só alguns recebem, sem repetir quem já recebeu", () => {
  const clients = [...mk("in_service", 2), ...mk("archived", 2)];
  const plan = planBalancedDistribution({ clients, recipients: team(6) });
  check(plan, clients);
  assert.equal(plan.perBroker.filter((b) => b.total > 0).length, 4);
  assert.ok(plan.perBroker.every((b) => b.total <= 1));
});

test("sem clientes: plano vazio; sem corretores: erro", () => {
  assert.deepEqual(planBalancedDistribution({ clients: [], recipients: team(3) }).assignments, []);
  assert.throws(() => planBalancedDistribution({ clients: mk("in_service", 1), recipients: [] }), /elegíveis/);
});

test("é determinística e ignora ids repetidos na entrada", () => {
  const clients = [...mk("in_service", 9), ...mk("archived", 5)];
  const a = planBalancedDistribution({ clients, recipients: team(4) });
  const b = planBalancedDistribution({ clients: [...clients].reverse(), recipients: team(4) });
  assert.deepEqual(a, b);
  const dup = planBalancedDistribution({ clients: [...clients, clients[0]], recipients: team(4) });
  assert.equal(dup.assignments.length, clients.length);
});

test("transferência individual leva todos para o escolhido", () => {
  const clients = [...mk("in_service", 3), ...mk("archived", 2)];
  const plan = planSingleTransfer({ clients, target: { id: "x", name: "X" } });
  check(plan, clients);
  assert.ok(plan.assignments.every((a) => a.toId === "x"));
});

test("elegibilidade: só corretor ativo da equipe que recebe leads", () => {
  const removed = { id: "r", managerId: "carol" };
  const profiles = [
    { id: "r", name: "Removido", role: "broker", status: "active", managerId: "carol", leadDistributionEnabled: true },
    { id: "a", name: "Ana", role: "broker", status: "active", managerId: "carol", leadDistributionEnabled: true },
    { id: "i", name: "Inativo", role: "broker", status: "inactive", managerId: "carol", leadDistributionEnabled: true },
    { id: "o", name: "Outra equipe", role: "broker", status: "active", managerId: "outro", leadDistributionEnabled: true },
    { id: "g", name: "Gestora", role: "manager", status: "active", managerId: "carol", leadDistributionEnabled: true },
    { id: "s", name: "Associado", role: "associate", status: "active", managerId: "carol", leadDistributionEnabled: true },
    { id: "n", name: "Sem leads", role: "broker", status: "active", managerId: "carol", leadDistributionEnabled: false },
    { id: "b", name: "Bruno", role: "broker", status: "active", managerId: "carol", leadDistributionEnabled: true }
  ];
  assert.deepEqual(selectEligibleRecipients(profiles, removed).map((p) => p.id), ["a", "b"]);
});

test("permissão: gestora só da própria equipe; corretor comum nunca; admin geral sempre", () => {
  const carol = { id: "carol", role: "manager" };
  assert.equal(canRemoveBroker({ actor: carol, target: { id: "x", role: "broker", managerId: "carol" } }), true);
  assert.equal(canRemoveBroker({ actor: carol, target: { id: "x", role: "associate", managerId: "carol" } }), true);
  assert.equal(canRemoveBroker({ actor: carol, target: { id: "y", role: "broker", managerId: "outro" } }), false);
  assert.equal(canRemoveBroker({ actor: carol, target: { id: "y", role: "broker", managerId: "" } }), false);
  assert.equal(canRemoveBroker({ actor: carol, target: { id: "m", role: "manager", managerId: "carol" } }), false);
  assert.equal(canRemoveBroker({ actor: { id: "b", role: "broker" }, target: { id: "x", role: "broker", managerId: "b" } }), false);
  assert.equal(canRemoveBroker({ actor: { id: "adm", role: "admin" }, isGeneralAdmin: true, target: { id: "y", role: "broker", managerId: "outro" } }), true);
});
