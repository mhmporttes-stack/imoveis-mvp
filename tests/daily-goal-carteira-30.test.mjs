// Carteira ativa de no máximo 30 por corretor (regra do dono, 2026-10-04): prioridade de quem fica, devolução do
// excedente, rodada "zumbi", teto na configuração, fila 10/10/10 intacta. Dados 100% fictícios, sem rede/banco.
// A parte de SQL (migration executada de verdade) está em daily-goal-carteira-30-sql.test.mjs (PGlite opcional).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { planWalletTrim, walletSlotsAvailable, MAX_WALLET_LIMIT } from "../lib/daily-goal-wallet-core.mjs";
import { releaseActiveRoundsForContacts } from "../lib/daily-goal-round-release.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const MIGRATION = read("supabase/migrations/20261004200000_meta_diaria_carteira_30.sql");

let seq = 0;
const round = (brokerId, attemptCount, extra = {}) => {
  seq += 1;
  return {
    id: `r${String(seq).padStart(4, "0")}`, brokerId, attemptCount,
    lastAttemptAt: extra.lastAttemptAt ?? null, roundStartedAt: extra.roundStartedAt ?? "2026-09-30", createdAt: extra.createdAt ?? "2026-09-30T10:00:00Z",
    zombie: extra.zombie ?? false, protectedReason: extra.protectedReason ?? null
  };
};
const counts = (decisions, ids) => ids.reduce((acc, id) => ({ ...acc, [decisions.get(id)]: (acc[decisions.get(id)] || 0) + 1 }), {});

test("teto 30: só há uma constante e a configuração não aceita mais que ela", () => {
  assert.equal(MAX_WALLET_LIMIT, 30);
  const wallet = read("lib/daily-goal-wallet.js");
  assert.match(wallet, /walletLimit > MAX_WALLET_LIMIT/);
  assert.doesNotMatch(wallet, /walletLimit > 5000/);
  const admin = read("components/DailyGoalAdmin.jsx");
  assert.match(admin, /max=\{MAX_WALLET_LIMIT\}/);
  assert.doesNotMatch(admin, /walletLimit \?\? 100/);
});

test("card/tela: o limite exibido vem da configuração (30) e a vitrine não mostra mais 50/100", () => {
  const fixture = read("app/dev/vitrine/_fixtures/meta-diaria.js");
  assert.doesNotMatch(fixture, /limit: (100|60|50),/);
  assert.match(fixture, /walletLimit: 30/);
  assert.match(read("components/DailyGoalDashboard.jsx"), /goal\.wallet\.current\}\/\{goal\.wallet\.limit/);
});

test("novas atribuições: 29 + 5 concede 1; no limite exato de 30 não entra ninguém", () => {
  assert.equal(walletSlotsAvailable({ current: 29, requested: 5 }), 1);
  assert.equal(walletSlotsAvailable({ current: 30, requested: 5 }), 0);
  assert.equal(walletSlotsAvailable({ current: 0, requested: 50 }), 30);
});

test("prioridade de quem fica: mais avançado na cadência, depois contato mais recente, depois mais antigo", () => {
  const b = "corretor-A";
  const rounds = [
    ...Array.from({ length: 20 }, (_, i) => round(b, 2, { lastAttemptAt: `2026-10-0${1 + (i % 3)}T12:00:00Z` })),
    ...Array.from({ length: 20 }, (_, i) => round(b, 1, { lastAttemptAt: `2026-10-0${1 + (i % 3)}T12:00:00Z` })),
    ...Array.from({ length: 20 }, () => round(b, 0))
  ];
  const decisions = planWalletTrim(rounds, { limit: 30 });
  const ids = (list) => list.map((r) => r.id);
  const twos = rounds.filter((r) => r.attemptCount === 2);
  const ones = rounds.filter((r) => r.attemptCount === 1);
  const zeros = rounds.filter((r) => r.attemptCount === 0);
  assert.deepEqual(counts(decisions, ids(twos)), { keep: 20 });
  assert.deepEqual(counts(decisions, ids(zeros)), { return: 20 });
  assert.deepEqual(counts(decisions, ids(ones)), { keep: 10, return: 10 });
  // Entre as de 1 tentativa, ficam as de contato mais recente (dia 3 e dia 2), voltam as mais paradas (dia 1).
  const keptOnes = ones.filter((r) => decisions.get(r.id) === "keep");
  const returnedOnes = ones.filter((r) => decisions.get(r.id) === "return");
  const oldestKept = Math.min(...keptOnes.map((r) => new Date(r.lastAttemptAt)));
  const newestReturned = Math.max(...returnedOnes.map((r) => new Date(r.lastAttemptAt)));
  assert.ok(oldestKept >= newestReturned);
});

test("depois do rebalanceamento ninguém passa de 30 e quem já está dentro do teto não perde nada", () => {
  const rounds = [
    ...Array.from({ length: 83 }, (_, i) => round("A", i % 3)),
    ...Array.from({ length: 30 }, (_, i) => round("B", i % 3)),
    ...Array.from({ length: 12 }, (_, i) => round("C", i % 3))
  ];
  const decisions = planWalletTrim(rounds, { limit: 30 });
  const kept = (broker) => rounds.filter((r) => r.brokerId === broker && decisions.get(r.id) === "keep").length;
  assert.equal(kept("A"), 30);
  assert.equal(kept("B"), 30);
  assert.equal(kept("C"), 12);
});

test("idempotência: reaplicar o plano sobre o que ficou não devolve mais ninguém", () => {
  const first = [...Array.from({ length: 45 }, (_, i) => round("A", i % 3))];
  const decisions = planWalletTrim(first, { limit: 30 });
  const remaining = first.filter((r) => decisions.get(r.id) === "keep");
  const again = planWalletTrim(remaining, { limit: 30 });
  assert.equal(remaining.length, 30);
  assert.ok([...again.values()].every((d) => d === "keep"));
});

test("rodada zumbi (contato já devolvido) é só encerrada: nunca conta como excedente nem desloca quem fica", () => {
  const rounds = [...Array.from({ length: 37 }, () => round("P", 2, { zombie: true })), ...Array.from({ length: 20 }, () => round("P", 1))];
  const decisions = planWalletTrim(rounds, { limit: 30 });
  assert.deepEqual(counts(decisions, rounds.filter((r) => r.zombie).map((r) => r.id)), { zombie: 37 });
  assert.deepEqual(counts(decisions, rounds.filter((r) => !r.zombie).map((r) => r.id)), { keep: 20 });
});

test("negócio em andamento (protegido) nunca é devolvido e ocupa vaga dos 30", () => {
  const protectedRounds = Array.from({ length: 3 }, () => round("A", 0, { protectedReason: "resposta_do_cliente_aberta" }));
  const others = Array.from({ length: 40 }, (_, i) => round("A", i % 3));
  const decisions = planWalletTrim([...protectedRounds, ...others], { limit: 30 });
  assert.deepEqual(counts(decisions, protectedRounds.map((r) => r.id)), { keep: 3 });
  assert.equal(others.filter((r) => decisions.get(r.id) === "keep").length, 27);
  // Mesmo com mais de 30 protegidos, nenhum é devolvido (o teto cede ao negócio em andamento).
  const many = Array.from({ length: 33 }, () => round("Z", 0, { protectedReason: "atividade_futura_agendada" }));
  const manyDecisions = planWalletTrim([...many, round("Z", 2)], { limit: 30 });
  assert.ok(many.every((r) => manyDecisions.get(r.id) === "keep"));
});

test("teto com bloqueio desligado não devolve ninguém (só encerra zumbis)", () => {
  const rounds = [...Array.from({ length: 40 }, () => round("A", 1)), round("A", 2, { zombie: true })];
  const decisions = planWalletTrim(rounds, { limit: 30, enforce: false });
  assert.equal([...decisions.values()].filter((d) => d === "return").length, 0);
  assert.equal([...decisions.values()].filter((d) => d === "zombie").length, 1);
});

// ---- encerrar a rodada quando o contato sai do corretor (causa das rodadas zumbi) ----
function fakeDb(rows = { rounds: [{ id: "r1", prospecting_contact_id: "c1", broker_id: "A", status: "active" }, { id: "r2", prospecting_contact_id: "c2", broker_id: "B", status: "active" }] }) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const state = { table, update: null, filters: [], neq: [] };
      const builder = {
        update(patch) { state.update = patch; return builder; },
        in(col, values) { state.filters.push(["in", col, values]); return builder; },
        eq(col, value) { state.filters.push(["eq", col, value]); return builder; },
        neq(col, value) { state.neq.push([col, value]); return builder; },
        select() { calls.push(state); return Promise.resolve({ data: table === "daily_goal_rounds" ? rows.rounds.filter((r) => state.filters.every(([k, c, v]) => (k === "in" ? v.includes(r[c]) : r[c] === v)) && state.neq.every(([c, v]) => r[c] !== v)).map((r) => ({ id: r.id })) : [], error: null }); },
        then(resolve) { calls.push(state); return Promise.resolve({ data: null, error: null }).then(resolve); }
      };
      return builder;
    }
  };
  return db;
}

test("devolução encerra só a rodada ativa do contato e cancela só fila PENDENTE; não toca tentativas nem cliente", async () => {
  const db = fakeDb();
  const result = await releaseActiveRoundsForContacts(db, ["c1", "c2", "c1", null]);
  assert.equal(result.ended, 2);
  const touched = [...new Set(db.calls.map((c) => c.table))].sort();
  assert.deepEqual(touched, ["daily_goal_auto_queue", "daily_goal_rounds"]);
  const roundsUpdate = db.calls.find((c) => c.table === "daily_goal_rounds");
  assert.equal(roundsUpdate.update.status, "ended_no_conversion");
  assert.ok(roundsUpdate.update.ended_at);
  assert.equal(Object.keys(roundsUpdate.update).sort().join(), "ended_at,status");
  const queueUpdate = db.calls.find((c) => c.table === "daily_goal_auto_queue");
  assert.deepEqual(queueUpdate.filters.find(([, col]) => col === "status"), ["eq", "status", "pending"]);
  assert.equal(queueUpdate.update.status, "canceled");
  assert.equal(queueUpdate.update.skip_reason, "round_reconciled");
});

test("reatribuir a outro corretor mantém a rodada de quem continua responsável (exceptBrokerId)", async () => {
  const db = fakeDb();
  const result = await releaseActiveRoundsForContacts(db, ["c1", "c2"], { exceptBrokerId: "A" });
  assert.equal(result.ended, 1);
  assert.deepEqual(db.calls.find((c) => c.table === "daily_goal_rounds").neq, [["broker_id", "A"]]);
  assert.equal((await releaseActiveRoundsForContacts(db, [])).ended, 0);
});

test("os caminhos que tiram o contato do corretor encerram a rodada (auto-retorno, Devolver, liberar, reatribuir)", () => {
  const prospecting = read("lib/prospecting.js");
  const autoReturn = read("lib/prospecting-auto-return.js");
  assert.match(autoReturn, /releaseActiveRoundsForContacts\(db, returned\.map/);
  assert.equal((prospecting.match(/releaseActiveRoundsForContacts\(/g) || []).length, 4);
  assert.match(prospecting, /action === "return"[\s\S]*releaseActiveRoundsForContacts\(db\(\), \[contactId\], \{ now \}\)/);
});

// ---- migration (texto): segura, aditiva, sem tocar o que não pode ----
test("migration: 14 dígitos, teto 50->30 só se ainda for 50, RLS sem policy, só service_role executa", () => {
  assert.match("20261004200000_meta_diaria_carteira_30.sql", /^\d{14}_[a-z0-9_]+\.sql$/);
  assert.match(MIGRATION, /set wallet_limit = 30[\s\S]*where id = 'default' and wallet_limit = 50/);
  assert.match(MIGRATION, /alter column wallet_limit set default 30/);
  for (const table of ["daily_goal_wallet_trim_log", "daily_goal_wallet_trim_backup"]) {
    assert.match(MIGRATION, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(MIGRATION, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }
  assert.doesNotMatch(MIGRATION, /create\s+policy/i);
  for (const fn of ["daily_goal_wallet_trim_plan(integer, uuid)", "daily_goal_wallet_trim(integer, uuid)", "daily_goal_wallet_trim_revert(uuid)"]) {
    assert.ok(MIGRATION.includes(`revoke all on function public.${fn} from public, anon, authenticated`), fn);
    assert.ok(MIGRATION.includes(`grant execute on function public.${fn} to service_role`), fn);
  }
});

test("migration: aditiva — não apaga, não redefine as funções de reserva/claim e não liga cron", () => {
  const code = MIGRATION.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(code, /\bdelete\s+from\b|\btruncate\b|drop\s+(?!table if exists pg_temp\._wallet_trim)(table|function|column|index)/i);
  assert.doesNotMatch(code, /create or replace function public\.(claim_|daily_goal_reserve_wallet_slots|enqueue_extra)/);
  assert.doesNotMatch(code, /cron\./i);
});

test("migration: o rebalanceamento NÃO marca contatado, NÃO mexe em tentativas/funil/pontos/fila cancelada", () => {
  const start = MIGRATION.indexOf("create or replace function public.daily_goal_wallet_trim(");
  const end = MIGRATION.indexOf("create or replace function public.daily_goal_wallet_trim_revert");
  const body = MIGRATION.slice(start, end).replace(/--[^\n]*/g, "");
  assert.ok(start > 0 && end > start);
  const writes = [...body.matchAll(/(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?([a-z_]+)/gi)].map((m) => m[1]);
  const allowed = new Set(["daily_goal_wallet_trim_backup", "daily_goal_wallet_trim_log", "daily_goal_auto_queue", "prospecting_contacts", "simulation_registrations", "daily_goal_rounds", "prospecting_history"]);
  for (const table of writes) assert.ok(allowed.has(table), `escreve em ${table}`);
  assert.ok(!writes.includes("daily_goal_attempts"));
  const assignments = [...body.matchAll(/\bset\b([\s\S]*?)\b(?:from|where)\b/gi)].map((m) => m[1]);
  assert.ok(assignments.length >= 6);
  for (const set of assignments) {
    assert.doesNotMatch(set, /last_attempt_at|attempt_count|converted|do_not_contact/, set);
    assert.doesNotMatch(set, /status\s*=\s*'(archived|do_not_contact|in_service|pending|awaiting_return)'/, set);
  }
  // só cancela item PENDENTE da fila (nunca ressuscita item já cancelado)
  assert.match(body, /update public\.daily_goal_auto_queue q[\s\S]*set status = 'canceled'[\s\S]*where q\.status = 'pending'/);
  assert.doesNotMatch(body, /set status = 'pending'/);
  // mecanismo existente: nunca tentado 'available'; já tentado 'recent_attempt' +30 dias
  assert.match(body, /set status = 'available', assigned_user_id = null/);
  assert.match(body, /set status = 'recent_attempt', assigned_user_id = null/);
  assert.match(body, /interval '30 days'/);
});
