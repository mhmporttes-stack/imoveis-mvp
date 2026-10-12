import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESENCE_REPORT_PERIODS,
  buildPresenceReportMembers,
  compareReportMembers,
  splitPrivateAttempts,
  tallyAttemptContacts,
  computeDailyPresence,
  resolvePresencePeriodDates
} from "../lib/admin-presence-core.mjs";

const range = (today, period, extra = {}) => {
  const { startDate, endDate } = resolvePresencePeriodDates(today, { period, ...extra });
  return [startDate, endDate];
};

test("períodos aceitos: 'Esta semana' (week) não existe mais; desconhecido vira Hoje", () => {
  assert.deepEqual(PRESENCE_REPORT_PERIODS, ["today", "yesterday", "last_week", "month", "custom"]);
  assert.deepEqual(resolvePresencePeriodDates("2026-10-12", { period: "week" }), { period: "today", startDate: "2026-10-12", endDate: "2026-10-12" });
});

test("Hoje e Ontem (datas de São Paulo)", () => {
  assert.deepEqual(range("2026-10-12", "today"), ["2026-10-12", "2026-10-12"]);
  assert.deepEqual(range("2026-10-12", "yesterday"), ["2026-10-11", "2026-10-11"]);
  assert.deepEqual(range("2026-10-01", "yesterday"), ["2026-09-30", "2026-09-30"]);
  assert.deepEqual(range("2027-01-01", "yesterday"), ["2026-12-31", "2026-12-31"]);
});

test("Semana passada = última semana FECHADA, segunda a domingo (regra do dono, 2026-10-12)", () => {
  // segunda 12/10 → 05/10 a 11/10
  assert.deepEqual(range("2026-10-12", "last_week"), ["2026-10-05", "2026-10-11"]);
  // qualquer dia da semana de 12/10 a 18/10 dá a mesma semana fechada
  for (const today of ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]) {
    assert.deepEqual(range(today, "last_week"), ["2026-10-05", "2026-10-11"], today);
  }
  // domingo 11/10: a semana corrente (05–11) ainda não fechou → 28/09 a 04/10
  assert.deepEqual(range("2026-10-11", "last_week"), ["2026-09-28", "2026-10-04"]);
  // virada de mês/ano
  assert.deepEqual(range("2026-11-02", "last_week"), ["2026-10-26", "2026-11-01"]);
  assert.deepEqual(range("2027-01-01", "last_week"), ["2026-12-21", "2026-12-27"]);
});

test("Este mês: do dia 1 até hoje; Personalizado: aceita só AAAA-MM-DD e inverte se vier trocado", () => {
  assert.deepEqual(range("2026-10-12", "month"), ["2026-10-01", "2026-10-12"]);
  assert.deepEqual(range("2026-10-12", "custom", { startDate: "2026-10-09", endDate: "2026-10-11" }), ["2026-10-09", "2026-10-11"]);
  assert.deepEqual(range("2026-10-12", "custom", { startDate: "2026-10-11", endDate: "2026-10-09" }), ["2026-10-09", "2026-10-11"]);
  assert.deepEqual(range("2026-10-12", "custom", { startDate: "lixo" }), ["2026-10-12", "2026-10-12"]);
});

test("limite da semana: domingo 23:59 (São Paulo) entra, segunda 00:00 não entra", () => {
  const [start, end] = range("2026-10-12", "last_week");
  const rows = [
    { minute_at: "2026-10-05T03:00:00.000Z", kind: "interaction" }, // seg 05/10 00:00 BRT — entra
    { minute_at: "2026-10-12T02:59:00.000Z", kind: "interaction" }, // dom 11/10 23:59 BRT — entra
    { minute_at: "2026-10-12T03:00:00.000Z", kind: "interaction" }, // seg 12/10 00:00 BRT — fora
    { minute_at: "2026-10-05T02:59:00.000Z", kind: "interaction" } // dom 04/10 23:59 BRT — fora
  ];
  const days = computeDailyPresence(rows, Date.parse("2026-10-12T10:00:00.000Z"));
  const inside = days.filter((day) => day.date >= start && day.date <= end).map((day) => day.date);
  const outside = days.filter((day) => day.date < start || day.date > end).map((day) => day.date);
  assert.deepEqual(inside, ["2026-10-05", "2026-10-11"]);
  assert.deepEqual(outside, ["2026-10-04", "2026-10-12"]);
});

test("online × ausente: até 5 min online; excedente até 30 min ausente; acima disso offline", () => {
  const base = Date.parse("2026-10-09T12:00:00.000Z");
  const at = (minutes, kind = "interaction") => ({ minute_at: new Date(base + minutes * 60000).toISOString(), kind });
  // marcas a cada minuto por 10 min (0..9), lacuna de 20 min, marca, lacuna de 2 h, marca
  const rows = [...Array.from({ length: 10 }, (_, index) => at(index)), at(29), at(149)];
  const [day] = computeDailyPresence(rows, base + 24 * 3600000);
  // 9 min contínuos + 5 (lacuna de 20) + 5 (lacuna de 120) + 5 (após a última, dia passado)
  assert.equal(day.activeMinutes, 24);
  // lacuna de 20 → 15 ausente; lacuna de 120 → 25 ausente (até 30), resto offline
  assert.equal(day.awayMinutes, 40);
  assert.equal(day.date, "2026-10-09");
});

test("depois de ação de WhatsApp (grace) tolera 10 min; última marca de hoje limitada ao agora", () => {
  const base = Date.parse("2026-10-12T12:00:00.000Z");
  const rows = [{ minute_at: new Date(base).toISOString(), kind: "grace" }, { minute_at: new Date(base + 8 * 60000).toISOString(), kind: "interaction" }];
  const [day] = computeDailyPresence(rows, base + 10 * 60000);
  assert.equal(day.activeMinutes, 8 + 2);
  assert.equal(day.awayMinutes, 0);
});

test("ordenação: mais online primeiro; empate por contatos e depois por nome", () => {
  const members = [
    { name: "Izabela", activeMinutes: 0, contacts: 0 },
    { name: "Bruna", activeMinutes: 0, contacts: 0 },
    { name: "Caroline", activeMinutes: 0, contacts: 3 },
    { name: "ketlin", activeMinutes: 73, contacts: 0 }
  ];
  assert.deepEqual(members.sort(compareReportMembers).map((member) => member.name), ["ketlin", "Caroline", "Bruna", "Izabela"]);
});

const PROFILES = [{ id: "bruna", name: "Bruna" }, { id: "ketlin", name: "ketlin" }];
const NOW = Date.parse("2026-10-12T10:00:00.000Z");

test("contatos separados: manuais (corretor) × automáticos (automação), total conservado (regra do dono, 2026-10-12)", () => {
  const attempts = [
    { broker_id: "bruna", goal_date: "2026-10-09", origin: "manual" },
    { broker_id: "bruna", goal_date: "2026-10-09", origin: "auto" },
    { broker_id: "bruna", goal_date: "2026-10-10", origin: "auto" },
    { broker_id: "bruna", goal_date: "2026-10-10", origin: null }, // sem origem = manual (padrão da coluna)
    { broker_id: "ketlin", goal_date: "2026-10-10", origin: "manual" }
  ];
  assert.deepEqual(tallyAttemptContacts(attempts).get("bruna|2026-10-09"), { total: 2, manual: 1, auto: 1 });
  const members = buildPresenceReportMembers(PROFILES, [], attempts, NOW);
  const bruna = members.find((member) => member.id === "bruna");
  assert.equal(bruna.contacts, 4);
  assert.equal(bruna.manualContacts, 2);
  assert.equal(bruna.autoContacts, 2);
  assert.equal(bruna.contacts, bruna.manualContacts + bruna.autoContacts);
  assert.deepEqual(bruna.days.map((day) => [day.date, day.contacts, day.manualContacts, day.autoContacts]), [
    ["2026-10-09", 2, 1, 1],
    ["2026-10-10", 2, 1, 1]
  ]);
  // dia só com contatos (sem presença) aparece, mas não conta como dia com atividade
  assert.equal(bruna.daysWithPresence, 0);
});

test("falha ao buscar contatos nunca vira 0: contatos ficam null (a tela mostra o aviso)", () => {
  const activity = [{ user_id: "bruna", minute_at: "2026-10-09T12:00:00.000Z", kind: "interaction" }];
  const members = buildPresenceReportMembers(PROFILES, activity, null, NOW);
  for (const member of members) {
    assert.equal(member.contacts, null);
    assert.equal(member.manualContacts, null);
    assert.equal(member.autoContacts, null);
    for (const day of member.days) assert.equal(day.contacts, null);
  }
  // o tempo online continua calculado normalmente
  assert.equal(members.find((member) => member.id === "bruna").activeMinutes, 5);
  // sem nenhuma tentativa (busca OK) é 0 de verdade
  assert.equal(buildPresenceReportMembers(PROFILES, [], [], NOW)[0].contacts, 0);
});

test("contatos particulares não contam (regra do dono, 2026-10-12): sem card, private_contact_at, conversa Particular do próprio corretor", () => {
  const rows = [
    { id: 1, broker_id: "bruna", client_id: "c1", client_phone: "5511988887777", contact_phone: "5511988887777", origin: "manual" }, // conta
    { id: 2, broker_id: "bruna", client_id: null, client_phone: "", contact_phone: "5511911112222", origin: "auto" }, // sem card
    { id: 3, broker_id: "bruna", client_id: "c3", client_phone: "5511933334444", contact_phone: "", origin: "manual" }, // private_contact_at
    { id: 4, broker_id: "bruna", client_id: "c4", client_phone: "11955556666", contact_phone: "", origin: "auto" }, // conversa Particular da Bruna (formato diferente)
    { id: 5, broker_id: "ketlin", client_id: "c5", client_phone: "5511955556666", contact_phone: "", origin: "auto" }, // mesmo número, mas a Particular é da Bruna → conta
    { id: 6, broker_id: "bruna", client_id: "c6", client_phone: "5511900000000", contact_phone: "5511977778888", origin: "manual" } // telefone do contato da rodada na Particular
  ];
  const { countable, excluded } = splitPrivateAttempts(rows, {
    privateClientIds: new Set(["c3"]),
    privateConversations: [
      { owner_ids: ["bruna", null], contact_phone: "+55 11 95555-6666" },
      { owner_ids: ["official", "bruna"], contact_phone: "5511977778888" }
    ]
  });
  assert.deepEqual(countable.map((row) => row.id), [1, 5]);
  assert.deepEqual(excluded.map((row) => row.id), [2, 3, 4, 6]);
  // a separação manual × automático é feita só sobre o que conta
  const members = buildPresenceReportMembers([{ id: "bruna", name: "Bruna" }], [], countable, NOW);
  assert.equal(members[0].contacts, 1);
  assert.equal(members[0].manualContacts, 1);
  assert.equal(members[0].autoContacts, 0);
});

test("sem nada particular, nada é excluído", () => {
  const rows = [{ broker_id: "bruna", client_id: "c1", client_phone: "5511988887777", contact_phone: "" }];
  assert.equal(splitPrivateAttempts(rows).countable.length, 1);
});
