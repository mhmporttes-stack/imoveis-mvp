import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildOwnerAssistantText,
  buildOwnerAttentions,
  buildOwnerTeamRows,
  groupAwaitingByBroker,
  namesList,
  whatsappStateOf
} from "../lib/painel-inicio-dono-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const at = (minutes) => new Date(Date.UTC(2026, 9, 22, 12, 0, 0) + minutes * 60000).toISOString();

test("aguardando resposta por corretor: conta e acha o mais antigo de cada um", () => {
  const groups = groupAwaitingByBroker([
    { brokerId: "a", clientId: "c1", name: "Ana", lastMessageAt: at(10), waitingMinutes: 20 },
    { brokerId: "a", clientId: "c2", name: "Bia", lastMessageAt: at(0), waitingMinutes: 30 },
    { brokerId: "b", clientId: "c3", name: "Caio", lastMessageAt: at(5), waitingMinutes: 25 },
    { brokerId: null, clientId: null, name: "Sem dono", lastMessageAt: at(1), waitingMinutes: 29 }
  ]);
  assert.deepEqual(groups[0], { brokerId: "a", count: 2, oldest: { name: "Bia", clientId: "c2", waitingMinutes: 30 } });
  assert.equal(groups.length, 3);
  assert.deepEqual(groupAwaitingByBroker([]), []);
});

test("estado do WhatsApp pelos ícones do Online", () => {
  assert.equal(whatsappStateOf([{ connected: true, state: "active" }, { connected: true, state: "idle" }]), "active");
  assert.equal(whatsappStateOf([{ connected: true, state: "idle" }]), "idle");
  assert.equal(whatsappStateOf([{ connected: false, state: "off" }]), "off");
  assert.equal(whatsappStateOf(null), null);
});

const profiles = [
  { id: "a", name: "Ana Souza", leadDistributionEnabled: true },
  { id: "b", name: "Bruno Lima", leadDistributionEnabled: true },
  { id: "c", name: "Carla Dias", leadDistributionEnabled: false }
];
const presence = {
  members: [
    { id: "a", status: "online", whatsapp: [{ connected: true, state: "active" }] },
    { id: "b", status: "offline", whatsapp: [{ connected: false, state: "off" }] },
    { id: "c", status: "away", whatsapp: [{ connected: true, state: "idle" }] }
  ]
};
const metaBrokers = [
  { brokerId: "a", meta: { percent: 80, pending: { done: 2, total: 3 } } },
  { brokerId: "b", meta: { percent: 30, pending: null } },
  { brokerId: "c", meta: { percent: 45, pending: { done: 0, total: 1 } } }
];

test("linhas da equipe: cada fonte por pessoa; fonte ausente vira null (nunca zero)", () => {
  const rows = buildOwnerTeamRows({
    profiles,
    presence,
    metaBrokers,
    awaitingByBroker: [{ brokerId: "a", count: 2, oldest: { name: "Bia", clientId: "c2", waitingMinutes: 30 } }],
    overdueByBroker: new Map([["b", 4]])
  });
  assert.deepEqual(rows.map((row) => row.id), ["a", "c", "b"]); // on-line, ausente, off-line
  const ana = rows[0];
  assert.equal(ana.metaPercent, 80);
  assert.deepEqual(ana.pending, { done: 2, total: 3 });
  assert.equal(ana.awaiting, 2);
  assert.equal(ana.overdue, 0);
  assert.equal(ana.whatsapp, "active");
  assert.equal(rows[2].overdue, 4);
  assert.equal(rows[2].awaiting, 0);

  const empty = buildOwnerTeamRows({ profiles });
  assert.equal(empty[0].metaPercent, null);
  assert.equal(empty[0].presence, null);
  assert.equal(empty[0].awaiting, null);
  assert.equal(empty[0].overdue, null);
});

test("atenções: prioridade, links e limiares de horário", () => {
  const rows = buildOwnerTeamRows({ profiles, presence, metaBrokers });
  const afternoon = buildOwnerAttentions({
    minutesOfDay: 17 * 60,
    rows,
    roulette: { eligibleCount: 0, queueCount: 3 },
    cooledDecisions: 2,
    importantAlerts: 1,
    marketplace: { extensionSilentMinutes: 45, failedReplies: 2 },
    toReview: 4
  });
  assert.deepEqual(afternoon.map((item) => item.key), ["roulette_empty", "whatsapp_off", "cooled", "alerts", "marketplace_extension", "marketplace_failed", "meta_low", "to_review"]);
  assert.equal(afternoon[0].text, "Ninguém apto na roleta e 3 clientes esperando na fila.");
  assert.equal(afternoon[0].href, "/admin/simulacoes?responsibleUserId=roulette");
  assert.equal(afternoon[1].text, "WhatsApp desconectado de quem está na roleta: Bruno.");
  assert.equal(afternoon.find((item) => item.key === "meta_low").text, "Abaixo de 50% da meta: Bruno (30%) e Carla (45%).");
  // Carla está ociosa mas fora da roleta: não vira atenção de WhatsApp.
  assert.equal(afternoon.some((item) => item.key === "whatsapp_idle"), false);

  const morning = buildOwnerAttentions({ minutesOfDay: 7 * 60, rows, roulette: { eligibleCount: 0, queueCount: 0 } });
  assert.equal(morning.some((item) => item.key.startsWith("roulette")), false); // de madrugada/cedo, ninguém apto é normal
  assert.equal(morning.some((item) => item.key === "meta_low"), false); // antes das 16h a meta não vira atenção
  const queueOnly = buildOwnerAttentions({ minutesOfDay: 10 * 60, roulette: { eligibleCount: 2, queueCount: 1 } });
  assert.equal(queueOnly[0].text, "1 cliente esperando na fila da roleta.");
});

test("fonte que falhou aparece como 'não foi possível conferir', nunca some", () => {
  const items = buildOwnerAttentions({ minutesOfDay: 600, unavailable: ["alertas", "Marketplace"] });
  assert.deepEqual(items, [{ key: "unavailable", tone: "muted", text: "Não foi possível conferir agora: alertas e Marketplace.", href: null }]);
});

test("frase do resumo do dono", () => {
  const rows = buildOwnerTeamRows({ profiles, presence });
  const attentions = buildOwnerAttentions({ minutesOfDay: 600, rows, toReview: 2 });
  assert.equal(
    buildOwnerAssistantText({ greeting: "Bom dia", firstName: "Matheus", leadsTotal: 5, awaitingReply: 3, urgent: { name: "Bia Rocha" }, rows, attentions }),
    "Bom dia, Matheus. Hoje entraram 5 leads. Equipe: 1 de 3 on-line. 3 clientes aguardam resposta; o mais antigo é Bia. 2 atenções para você: WhatsApp desconectado de quem está na roleta: Bruno."
  );
  assert.equal(
    buildOwnerAssistantText({ greeting: "Boa tarde", firstName: "Matheus", leadsTotal: 0, rows: [], attentions: [] }),
    "Boa tarde, Matheus. Nenhum lead novo hoje ainda. Nenhuma atenção pendente para você agora."
  );
  assert.equal(namesList(["A", "B", "C", "D", "E"]), "A, B, C e mais 2");
});

test("fiação: só o admin geral recebe a visão do dono; botões fora do resumo do dono", () => {
  assert.match(read("lib/painel-inicio-dono.js"), /if \(!isGeneralAdminAuth\(auth\)\) return null;/);
  const page = read("app/admin/inicio/page.jsx");
  assert.match(page, /isGeneralAdminAuth\(auth\) \? loadOwner\(auth, data\) : null/);
  assert.match(page, /showActions=\{false\}/);
  assert.match(read("lib/painel-inicio.js"), /byBroker: isGeneralAdminAuth\(auth\)/);
});
