import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_BONUS_DECIDE_MARGIN_MS,
  OFFICE_BONUS_TIE_MS,
  decideFirstArrival,
  decideLastDeparture,
  isOfficeBonusParticipant,
  officeBonusEntries,
  splitOfficeBonusPoints
} from "../lib/office-presence-bonus-core.mjs";
import { describeLedgerRow } from "../lib/points-statement-core.mjs";

const base = Date.parse("2026-10-23T11:00:00Z"); // 08:00 em São Paulo
const at = (minutes, seconds = 0) => new Date(base + minutes * 60000 + seconds * 1000).toISOString();
const until = "2026-10-24T12:00:00Z";
const wifi = (userId, first, last = first) => ({ user_id: userId, source: "wifi", first_seen_at: first, last_wifi_seen_at: last, valid_until: until });
const people = new Set(["a", "b", "c", "d"]);
const later = base + 60 * 60000;

test("divisão sem perder ponto", () => {
  assert.deepEqual(splitOfficeBonusPoints(1), [100]);
  assert.deepEqual(splitOfficeBonusPoints(2), [50, 50]);
  assert.deepEqual(splitOfficeBonusPoints(3), [34, 33, 33]);
  assert.equal(splitOfficeBonusPoints(7).reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(splitOfficeBonusPoints(0), []);
});

test("participa: corretor e associado ativos; dono, gestora e inativo não", () => {
  assert.equal(isOfficeBonusParticipant({ id: "1", role: "broker", status: "active" }), true);
  assert.equal(isOfficeBonusParticipant({ id: "1", role: "associate", status: "active" }), true);
  assert.equal(isOfficeBonusParticipant({ id: "1", role: "admin", status: "active" }), false);
  assert.equal(isOfficeBonusParticipant({ id: "1", role: "manager", status: "active" }), false);
  assert.equal(isOfficeBonusParticipant({ id: "1", role: "broker", status: "inactive" }), false);
});

test("1 pessoa leva 100", () => {
  const result = decideFirstArrival({ checkins: [wifi("a", at(0))], participantIds: people, nowMs: later });
  assert.equal(result.ready, true);
  assert.deepEqual(result.winners, [{ userId: "a", at: at(0), points: 100 }]);
});

test("2 dentro de 3 min dividem 50/50", () => {
  const result = decideFirstArrival({ checkins: [wifi("b", at(0, 18)), wifi("a", at(0)), wifi("c", at(20))], participantIds: people, nowMs: later });
  assert.deepEqual(result.winners.map((w) => [w.userId, w.points]), [["a", 50], ["b", 50]]);
});

test("3 dentro de 3 min dividem 34/33/33 (contra o primeiro, sem encadear)", () => {
  const checkins = [wifi("a", at(0)), wifi("b", at(1)), wifi("c", at(2, 59)), wifi("d", at(4))];
  const result = decideFirstArrival({ checkins, participantIds: people, nowMs: later });
  assert.deepEqual(result.winners.map((w) => [w.userId, w.points]), [["a", 34], ["b", 33], ["c", 33]], "d chegou a 4 min do primeiro: fora, mesmo a 1 min do c");
});

test("a 2ª a 3 min ou mais não divide", () => {
  const result = decideFirstArrival({ checkins: [wifi("a", at(0)), wifi("b", at(3))], participantIds: people, nowMs: later });
  assert.deepEqual(result.winners.map((w) => [w.userId, w.points]), [["a", 100]]);
});

test("sem chegadas: nada", () => {
  assert.deepEqual(decideFirstArrival({ checkins: [], participantIds: people, nowMs: later }), { ready: false, winners: [] });
  assert.deepEqual(decideLastDeparture({ checkins: [], participantIds: people }), { ready: false, winners: [] });
});

test("só decide 3 min (+ folga) depois da 1ª chegada", () => {
  const checkins = [wifi("a", at(0))];
  assert.equal(decideFirstArrival({ checkins, participantIds: people, nowMs: base + OFFICE_BONUS_TIE_MS }).ready, false);
  assert.equal(decideFirstArrival({ checkins, participantIds: people, nowMs: base + OFFICE_BONUS_TIE_MS + OFFICE_BONUS_DECIDE_MARGIN_MS }).ready, true);
});

test("Liberar hoje (manual), ausente e quem não participa ficam fora", () => {
  const manual = { user_id: "a", source: "manual", first_seen_at: at(0), last_wifi_seen_at: null, valid_until: until };
  const absences = new Map([["b", [{ markedAt: at(30), absentUntil: "2026-10-24T03:00:00Z" }]]]);
  const checkins = [manual, wifi("b", at(1)), wifi("owner", at(-30)), wifi("c", at(10))];
  const result = decideFirstArrival({ checkins, participantIds: people, absencesByUser: absences, nowMs: later });
  assert.deepEqual(result.winners.map((w) => [w.userId, w.points]), [["c", 100]]);
});

test("último a sair: último sinal no Wi-Fi; quem saiu a menos de 3 min divide", () => {
  const checkins = [wifi("a", at(0), at(600)), wifi("b", at(5), at(598, 30)), wifi("c", at(6), at(590))];
  const result = decideLastDeparture({ checkins, participantIds: people });
  assert.equal(result.ready, true);
  assert.deepEqual(result.winners.map((w) => [w.userId, w.points, w.at]), [["a", 50, at(600)], ["b", 50, at(598, 30)]]);
});

test("último a sair ignora ausente e quem não participa", () => {
  const absences = new Map([["a", [{ markedAt: at(30), absentUntil: "2026-10-24T03:00:00Z" }]]]);
  const checkins = [wifi("a", at(0), at(700)), wifi("owner", at(0), at(800)), wifi("b", at(0), at(500))];
  const result = decideLastDeparture({ checkins, participantIds: people, absencesByUser: absences });
  assert.deepEqual(result.winners.map((w) => [w.userId, w.points]), [["b", 100]]);
});

test("lançamentos: uma linha por ganhador dentro do período e texto do extrato", () => {
  const awards = [
    { award_date: "2026-10-23", kind: "first_arrival", winners: [{ userId: "a", at: at(0), points: 50 }, { userId: "b", at: at(0, 18), points: 50 }] },
    { award_date: "2026-10-22", kind: "last_departure", winners: [{ userId: "c", at: "2026-10-22T22:00:00Z", points: 100 }] }
  ];
  const entries = officeBonusEntries(awards, { startMs: Date.parse("2026-10-23T03:00:00Z"), endMs: Date.parse("2026-10-24T03:00:00Z") });
  assert.equal(entries.length, 2, "saída de ontem fica no dia de ontem");
  assert.equal(entries[0].action, "Primeiro a chegar na imobiliária (dividido entre 2)");
  const described = describeLedgerRow(entries[0]);
  assert.equal(described.kind, "office_first_arrival");
  assert.equal(described.label, "Primeiro a chegar");
  assert.match(described.note, /divididos entre 2/);
  const single = officeBonusEntries([awards[1]])[0];
  assert.equal(describeLedgerRow(single).label, "Último a sair");
  assert.equal(describeLedgerRow(single).note, "");
});

test("idempotência: uma decisão por dia e tipo (chave primária + insert sem sobrescrever + checagem antes)", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../supabase/migrations/20261023200000_bonus_primeiro_ultimo_imobiliaria.sql", import.meta.url), "utf8");
  assert.match(sql, /primary key \(award_date, kind\)/);
  const lib = await readFile(new URL("../lib/office-presence-bonus.js", import.meta.url), "utf8");
  assert.match(lib, /onConflict: "award_date,kind", ignoreDuplicates: true/);
  assert.match(lib, /if \(await awardExists\(dateKey, kind\)\) return/);
  assert.doesNotMatch(lib, /createAlertDeliveries|web-push|push-subscriptions|crm_notifications|createCrmNotification/, "sem aviso/push (AUT-9)");
  // Recalcular a mesma decisão dá o mesmo resultado (cron concorrente grava a mesma coisa).
  const checkins = [wifi("a", at(0)), wifi("b", at(1))];
  assert.deepEqual(decideFirstArrival({ checkins, participantIds: people, nowMs: later }), decideFirstArrival({ checkins, participantIds: people, nowMs: later + 3600000 }));
});
