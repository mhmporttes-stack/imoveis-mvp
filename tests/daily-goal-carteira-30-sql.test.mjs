// Carteira ativa de no máximo 30 (2026-10-04) — executa a MIGRATION 20261004200000 de verdade num Postgres em
// memória (PGlite), com tabelas mínimas e dados 100% fictícios. Nada de rede nem banco real.
// PGlite NÃO é dependência do projeto: o teste só roda quando PGLITE_DIR aponta para a pasta do pacote
// (ex.: PGLITE_DIR=<pasta>/node_modules/@electric-sql/pglite); sem isso fica "skipped" (o CI não o tem).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { planWalletTrim } from "../lib/daily-goal-wallet-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261004200000_meta_diaria_carteira_30.sql"), "utf8");
const WALLET_BASE = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260919_daily_goal_active_wallet.sql"), "utf8");
const fn = (name, closing) => WALLET_BASE.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?${closing.replace(/\$/g, "\\$")};`))[0];

const pgliteDir = process.env.PGLITE_DIR;
const pgliteOk = Boolean(pgliteDir && fs.existsSync(path.join(pgliteDir, "dist/index.js")));
const { PGlite } = pgliteOk ? await import(pathToFileURL(path.join(pgliteDir, "dist/index.js")).href) : {};
const maybe = pgliteOk ? test : test.skip;

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create table admin_users (id uuid primary key default gen_random_uuid(), name text, status text default 'active');
create table daily_goal_wallet_config (id text primary key default 'default', wallet_limit integer not null default 100, block_on_limit boolean not null default true, updated_by uuid, updated_at timestamptz not null default now());
insert into daily_goal_wallet_config (id, wallet_limit) values ('default', 50);
create table daily_goal_wallet_broker_overrides (broker_id uuid primary key, wallet_limit integer not null, updated_by uuid, updated_at timestamptz not null default now());
create table prospecting_contacts (id uuid primary key default gen_random_uuid(), name text, phone_normalized text, status text not null default 'available', assigned_user_id uuid, registration_id uuid, last_broker_id uuid, last_attempt_at timestamptz, available_after timestamptz, queue_sort_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table simulation_registrations (id uuid primary key default gen_random_uuid(), phone_normalized text, status text not null default 'pending', responsible_user_id uuid, last_status_change_at timestamptz, scheduled_activity_at timestamptz, scheduled_activity_completed_at timestamptz, updated_at timestamptz not null default now());
create table daily_goal_rounds (id uuid primary key default gen_random_uuid(), prospecting_contact_id uuid, client_id uuid, broker_id uuid, round_started_at date, attempt_count integer not null default 0, status text not null default 'active', converted_attempt integer, converted_at timestamptz, ended_at timestamptz, created_at timestamptz not null default now(), origin text);
create table daily_goal_attempts (id uuid primary key default gen_random_uuid(), round_id uuid not null, client_id uuid, broker_id uuid not null, attempt_number integer not null, goal_date date not null, created_at timestamptz not null default now());
create table daily_goal_auto_queue (id uuid primary key default gen_random_uuid(), round_id uuid, broker_id uuid, contact_id uuid, attempt_number integer, status text not null default 'pending', skip_reason text, source text default 'meta', scheduled_for timestamptz, updated_at timestamptz not null default now());
create table prospecting_history (id uuid primary key default gen_random_uuid(), contact_id uuid not null, registration_id uuid, user_id uuid, event_type text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create table prospecting_reply_alerts (id uuid primary key default gen_random_uuid(), client_id uuid not null, status text not null default 'open');
create table calendar_activities (id uuid primary key default gen_random_uuid(), client_id uuid, status text not null default 'pending', scheduled_at timestamptz not null);
create table whatsapp_conversations (id uuid primary key default gen_random_uuid(), client_id uuid, deleted_at timestamptz, last_human_reply_at timestamptz, last_inbound_at timestamptz);
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(fn("daily_goal_wallet_effective_config", "$$"));
  await db.exec(fn("daily_goal_active_wallet_count", "$$"));
  await db.exec(fn("daily_goal_reserve_wallet_slots", "$function$"));
  await db.exec(MIGRATION);
  return db;
}

let seq = 0;
const iso = (day, hour = 12) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
async function broker(db, name) {
  return (await db.query("insert into admin_users (name) values ($1) returning id", [name])).rows[0].id;
}
// Cria uma rodada ativa completa: contato claimed do corretor (+ cliente em "Tentando contato" quando já houve tentativa).
async function addRound(db, brokerId, attemptCount, o = {}) {
  seq += 1;
  const contact = (await db.query(
    `insert into prospecting_contacts (name, phone_normalized, status, assigned_user_id, last_broker_id, last_attempt_at, queue_sort_at)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [`Pessoa Teste ${seq}`, `+5514990${String(seq).padStart(6, "0")}`, o.contactStatus ?? "claimed", o.contactAssigned === undefined ? brokerId : o.contactAssigned, brokerId, o.lastAttemptAt ?? null, iso(1, seq % 24)]
  )).rows[0].id;
  let clientId = null;
  if (attemptCount >= 1 || o.withClient) {
    clientId = (await db.query(
      "insert into simulation_registrations (phone_normalized, status, responsible_user_id, last_status_change_at) values ($1,$2,$3,$4) returning id",
      [`+5514990${String(seq).padStart(6, "0")}`, o.clientStatus ?? "awaiting_return", o.clientResponsible === undefined ? brokerId : o.clientResponsible, iso(2)]
    )).rows[0].id;
    await db.query("update prospecting_contacts set registration_id = $1 where id = $2", [clientId, contact]);
  }
  const roundId = (await db.query(
    "insert into daily_goal_rounds (prospecting_contact_id, client_id, broker_id, round_started_at, attempt_count, status, origin, created_at) values ($1,$2,$3,$4,$5,'active',$6,$7) returning id",
    [contact, clientId, brokerId, o.roundStartedAt ?? "2026-09-30", attemptCount, o.origin ?? null, iso(1, seq % 24)]
  )).rows[0].id;
  for (let n = 1; n <= attemptCount; n += 1) {
    await db.query("insert into daily_goal_attempts (round_id, client_id, broker_id, attempt_number, goal_date, created_at) values ($1,$2,$3,$4,$5,$6)",
      [roundId, clientId, brokerId, n, `2026-10-0${n}`, o.lastAttemptAt ?? iso(1 + n)]);
  }
  return { roundId, contact, clientId, attemptCount };
}
const hash = async (db, table, where = "true") => (await db.query(`select coalesce(md5(string_agg(t::text, '|' order by t::text)), '-') h from (select * from ${table} where ${where}) t`)).rows[0].h;
const activeOf = async (db, brokerId) => Number((await db.query("select count(*) c from daily_goal_rounds where broker_id=$1 and status='active'", [brokerId])).rows[0].c);
const TABLES = ["daily_goal_rounds", "prospecting_contacts", "simulation_registrations", "daily_goal_auto_queue", "daily_goal_attempts"];
const world = async (db) => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await hash(db, t)])));

async function scenario(db) {
  const A = await broker(db, "Corretor A"); // 83 -> 30 + zumbis
  const B = await broker(db, "Corretor B"); // 28 (dentro do teto)
  const rounds = [];
  for (let i = 0; i < 20; i += 1) rounds.push({ broker: A, ...(await addRound(db, A, 2, { lastAttemptAt: iso(1 + (i % 3)) })) });
  for (let i = 0; i < 25; i += 1) rounds.push({ broker: A, ...(await addRound(db, A, 1, { lastAttemptAt: iso(1 + (i % 4)) })) });
  for (let i = 0; i < 30; i += 1) rounds.push({ broker: A, ...(await addRound(db, A, 0)) });
  const zombies = [];
  for (let i = 0; i < 8; i += 1) zombies.push(await addRound(db, A, 1, { contactStatus: "recent_attempt", contactAssigned: null, clientResponsible: null, lastAttemptAt: iso(1) }));
  for (let i = 0; i < 28; i += 1) rounds.push({ broker: B, ...(await addRound(db, B, i % 3)) });
  // fila automática: itens pendentes para todos; um cancelado antigo (fila 10/10/10 limpa) e um enviado.
  for (const r of rounds.filter((x) => x.broker === A)) {
    await db.query("insert into daily_goal_auto_queue (round_id, broker_id, contact_id, attempt_number, status) values ($1,$2,$3,$4,'pending')", [r.roundId, A, r.contact, r.attemptCount + 1]);
  }
  const old = rounds.find((x) => x.broker === A && x.attemptCount === 0);
  await db.query("update daily_goal_auto_queue set status='canceled', skip_reason='policy_v2_trim_excess' where round_id=$1", [old.roundId]);
  return { A, B, rounds, zombies };
}

maybe("paridade: o plano do SQL decide exatamente como o espelho em JS (prioridade documentada)", async () => {
  const db = await freshDb();
  const { A, rounds } = await scenario(db);
  // protegida: cliente com resposta aberta (precisa de cliente)
  const withClient = await addRound(db, A, 0, { withClient: true });
  await db.query("insert into prospecting_reply_alerts (client_id) values ($1)", [withClient.clientId]);
  const sql = (await db.query("select * from daily_goal_wallet_trim_plan(30) where broker_id=$1", [A])).rows;
  const jsRounds = (await db.query(`select r.id, r.broker_id, r.attempt_count, r.round_started_at::text rs, r.created_at, c.last_attempt_at,
      (c.id is null or c.status <> 'claimed' or c.assigned_user_id is distinct from r.broker_id) zombie,
      (select max(created_at) from daily_goal_attempts a where a.round_id=r.id) la,
      exists (select 1 from prospecting_reply_alerts pa where pa.client_id=r.client_id and pa.status='open') prot
      from daily_goal_rounds r left join prospecting_contacts c on c.id=r.prospecting_contact_id where r.broker_id=$1 and r.status='active'`, [A])).rows
    .map((r) => ({ id: r.id, brokerId: r.broker_id, attemptCount: r.attempt_count, lastAttemptAt: [r.la, r.last_attempt_at].filter(Boolean).map((d) => new Date(d).getTime()).sort((a, b) => b - a)[0] ?? null,
      roundStartedAt: r.rs, createdAt: r.created_at, zombie: r.zombie, protectedReason: r.prot ? "resposta_do_cliente_aberta" : null }));
  const js = planWalletTrim(jsRounds, { limit: 30 });
  assert.equal(sql.length, jsRounds.length);
  for (const row of sql) assert.equal(row.kind, js.get(row.round_id), `${row.round_id} tent=${row.attempt_count}`);
  assert.equal(sql.filter((r) => r.kind === "keep").length, 30);
  assert.equal(sql.filter((r) => r.kind === "zombie").length, 8);
  assert.equal(sql.find((r) => r.round_id === withClient.roundId).kind, "keep"); // protegido
  assert.equal(sql.find((r) => r.round_id === withClient.roundId).protect_reason, "resposta_do_cliente_aberta");
});

maybe("rebalanceamento: Corretor A 83 -> 30, excedente volta pelo mecanismo da Prospecção, nada é apagado nem marcado", async () => {
  const db = await freshDb();
  const { A, B, rounds, zombies } = await scenario(db);
  assert.equal(await activeOf(db, A), 83);
  const before = await world(db);
  const attemptsBefore = await hash(db, "daily_goal_attempts");
  const bRoundsBefore = await hash(db, "daily_goal_rounds", `broker_id='${B}'`);
  const sold = await hash(db, "simulation_registrations", `id in (select client_id from daily_goal_rounds where broker_id='${B}' and client_id is not null)`);

  const result = (await db.query("select daily_goal_wallet_trim() r")).rows[0].r;
  assert.equal(result.brokers_affected, 1);
  assert.equal(result.zombies_ended, 8);
  assert.equal(result.returned, 45);
  assert.equal(result.returned_untouched, 30); // as 30 sem nenhuma tentativa (menos prioritárias)
  assert.equal(result.returned_with_attempts, 15);
  assert.equal(result.clients_unassigned, 15);

  assert.equal(await activeOf(db, A), 30);
  assert.equal(await activeOf(db, B), 28);
  assert.equal(await hash(db, "daily_goal_rounds", `broker_id='${B}'`), bRoundsBefore, "corretor dentro do teto não é tocado");
  assert.equal(await hash(db, "simulation_registrations", `id in (select client_id from daily_goal_rounds where broker_id='${B}' and client_id is not null)`), sold);
  assert.equal(await hash(db, "daily_goal_attempts"), attemptsBefore, "tentativas intactas");

  // quem ficou: as 20 de 2 tentativas + as 10 de 1 tentativa mais recentes
  const kept = (await db.query("select attempt_count, count(*)::int n from daily_goal_rounds where broker_id=$1 and status='active' group by 1 order by 1", [A])).rows;
  assert.deepEqual(kept.map((r) => [r.attempt_count, r.n]), [[1, 10], [2, 20]]);
  // devolvidos nunca tentados: contato 'available', sem corretor, last_attempt_at intocado
  const untouched = (await db.query(`select c.status, c.assigned_user_id, c.available_after, c.last_attempt_at, r.attempt_count, r.status rs, r.ended_at is not null ended
     from daily_goal_rounds r join prospecting_contacts c on c.id=r.prospecting_contact_id
     where r.broker_id=$1 and r.attempt_count=0 and r.status='ended_no_conversion'`, [A])).rows;
  assert.equal(untouched.length, 30);
  for (const row of untouched) assert.deepEqual([row.status, row.assigned_user_id, row.available_after, row.last_attempt_at, row.ended], ["available", null, null, null, true]);
  // devolvidos já tentados: 'recent_attempt' +30 dias, attempt_count e last_attempt_at preservados; cliente sem responsável, mesma etapa
  const tried = (await db.query(`select c.status, c.assigned_user_id, c.available_after, c.last_attempt_at, r.attempt_count, s.status cs, s.responsible_user_id
     from daily_goal_rounds r join prospecting_contacts c on c.id=r.prospecting_contact_id join simulation_registrations s on s.id=r.client_id
     where r.broker_id=$1 and r.attempt_count=1 and r.status='ended_no_conversion' and c.status='recent_attempt' and not (r.id = any($2))`, [A, zombies.map((z) => z.roundId)])).rows;
  assert.equal(tried.length, 15);
  for (const row of tried) {
    assert.equal(row.assigned_user_id, null);
    assert.equal(row.cs, "awaiting_return");
    assert.equal(row.responsible_user_id, null);
    const days = (new Date(row.available_after) - Date.now()) / 86400000;
    assert.ok(days > 29.9 && days < 30.1, `available_after ${days}`);
  }
  // fila: pendentes dos que saíram foram cancelados; os dos que ficaram continuam pendentes; o cancelado antigo não volta
  const queue = (await db.query(`select q.status, q.skip_reason, r.status rs, count(*)::int n from daily_goal_auto_queue q join daily_goal_rounds r on r.id=q.round_id group by 1,2,3 order by 1,2,3`)).rows;
  assert.ok(queue.every((q) => (q.status === "pending") === (q.rs === "active")), JSON.stringify(queue));
  assert.equal((await db.query("select count(*)::int n from daily_goal_auto_queue where skip_reason='policy_v2_trim_excess'")).rows[0].n, 1);
  // auditoria, backup e histórico
  const log = (await db.query("select * from daily_goal_wallet_trim_log")).rows;
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].wallet_before, log[0].kept, log[0].returned, log[0].zombies_ended, log[0].limit_value], [83, 30, 45, 8, 30]);
  assert.ok((await db.query("select count(*)::int n from daily_goal_wallet_trim_backup")).rows[0].n > 90);
  const hist = (await db.query("select details->>'reason' reason, count(*)::int n from prospecting_history where event_type='daily_goal_round_ended' group by 1 order by 1")).rows;
  assert.deepEqual(hist, [{ reason: "wallet_trim_contact_already_returned", n: 8 }, { reason: "wallet_trim_over_limit", n: 45 }]);
  // nenhum cliente foi alterado além do responsável dos devolvidos; nada foi apagado
  assert.equal((await db.query("select count(*)::int n from simulation_registrations")).rows[0].n, 71, "nenhum cliente apagado");
  assert.equal((await db.query("select count(*)::int n from prospecting_contacts")).rows[0].n, 83 + 28, "nenhum contato apagado");
  const notAwaiting = (await db.query("select count(*)::int n from simulation_registrations where status <> 'awaiting_return'")).rows[0].n;
  assert.equal(notAwaiting, 0);
  assert.ok(rounds.length > 0);
});

maybe("idempotência: rodar de novo (e de novo) não muda nada nem grava auditoria", async () => {
  const db = await freshDb();
  await scenario(db);
  await db.query("select daily_goal_wallet_trim()");
  const after1 = await world(db);
  const logs1 = (await db.query("select count(*)::int n from daily_goal_wallet_trim_log")).rows[0].n;
  const history1 = (await db.query("select count(*)::int n from prospecting_history")).rows[0].n;
  const second = (await db.query("select daily_goal_wallet_trim() r")).rows[0].r;
  assert.equal(second.brokers_affected, 0);
  assert.equal(second.returned, 0);
  assert.deepEqual(await world(db), after1);
  assert.equal((await db.query("select count(*)::int n from daily_goal_wallet_trim_log")).rows[0].n, logs1);
  assert.equal((await db.query("select count(*)::int n from prospecting_history")).rows[0].n, history1);
});

maybe("reversão: devolve rodadas, contatos, clientes e fila exatamente ao estado de antes", async () => {
  const db = await freshDb();
  const { A } = await scenario(db);
  const before = await world(db);
  const run = (await db.query("select daily_goal_wallet_trim() r")).rows[0].r;
  assert.notDeepEqual(await world(db), before);
  const reverted = (await db.query("select daily_goal_wallet_trim_revert($1) r", [run.run_id])).rows[0].r;
  assert.equal(reverted.rounds_restored, 53);
  assert.equal(reverted.rounds_skipped, 0);
  assert.deepEqual(await world(db), before);
  assert.equal(await activeOf(db, A), 83);
  assert.equal((await db.query("select daily_goal_wallet_trim_revert($1) r", [run.run_id])).rows[0].r.already_reverted, true);
});

maybe("reversão não desfaz o que outra pessoa já assumiu depois", async () => {
  const db = await freshDb();
  const { A, B } = await scenario(db);
  const run = (await db.query("select daily_goal_wallet_trim() r")).rows[0].r;
  const taken = (await db.query(`select c.id from daily_goal_rounds r join prospecting_contacts c on c.id=r.prospecting_contact_id where r.broker_id=$1 and r.status='ended_no_conversion' and c.status='available' limit 1`, [A])).rows[0].id;
  await db.query("update prospecting_contacts set status='claimed', assigned_user_id=$1, updated_at=now() + interval '1 second' where id=$2", [B, taken]);
  const reverted = (await db.query("select daily_goal_wallet_trim_revert($1) r", [run.run_id])).rows[0].r;
  assert.equal(reverted.rounds_skipped, 1);
  assert.equal((await db.query("select assigned_user_id from prospecting_contacts where id=$1", [taken])).rows[0].assigned_user_id, B);
});

maybe("reduzir o teto depois é seguro: trim(20) devolve só o novo excedente, de novo pela mesma prioridade", async () => {
  const db = await freshDb();
  const { A } = await scenario(db);
  await db.query("select daily_goal_wallet_trim()");
  assert.equal(await activeOf(db, A), 30);
  const r = (await db.query("select daily_goal_wallet_trim(20, $1) r", [A])).rows[0].r;
  assert.equal(r.returned, 10);
  assert.equal(await activeOf(db, A), 20);
  const left = (await db.query("select attempt_count, count(*)::int n from daily_goal_rounds where broker_id=$1 and status='active' group by 1 order by 1", [A])).rows;
  assert.deepEqual(left.map((x) => [x.attempt_count, x.n]), [[2, 20]]);
});

maybe("negócio em andamento nunca é devolvido: protegidos acima de 30 ficam e nada quebra", async () => {
  const db = await freshDb();
  const P = await broker(db, "Corretor P");
  for (let i = 0; i < 33; i += 1) {
    const r = await addRound(db, P, 1);
    if (i % 3 === 0) await db.query("insert into calendar_activities (client_id, scheduled_at) values ($1, now() + interval '2 days')", [r.clientId]);
    else if (i % 3 === 1) await db.query("insert into prospecting_reply_alerts (client_id) values ($1)", [r.clientId]);
    else await db.query("update simulation_registrations set scheduled_activity_at = now() + interval '1 day' where id = $1", [r.clientId]);
  }
  const extra = await addRound(db, P, 2);
  const r = (await db.query("select daily_goal_wallet_trim() r")).rows[0].r;
  assert.equal(r.returned, 1);
  assert.equal(await activeOf(db, P), 33);
  assert.equal((await db.query("select status from daily_goal_rounds where id=$1", [extra.roundId])).rows[0].status, "ended_no_conversion");
});

maybe("cliente em outra etapa e envio em andamento também são protegidos; bloqueio desligado só encerra zumbis", async () => {
  const db = await freshDb();
  const Q = await broker(db, "Corretor Q");
  const other = await addRound(db, Q, 1, { clientStatus: "in_service" });
  const sending = await addRound(db, Q, 0);
  await db.query("insert into daily_goal_auto_queue (round_id, broker_id, contact_id, attempt_number, status) values ($1,$2,$3,1,'sending')", [sending.roundId, Q, sending.contact]);
  for (let i = 0; i < 40; i += 1) await addRound(db, Q, 0);
  const plan = (await db.query("select round_id, kind, protect_reason from daily_goal_wallet_trim_plan(30, $1)", [Q])).rows;
  assert.equal(plan.find((p) => p.round_id === other.roundId).protect_reason, "cliente_em_outra_etapa");
  assert.equal(plan.find((p) => p.round_id === sending.roundId).protect_reason, "envio_em_andamento");
  assert.equal(plan.filter((p) => p.kind === "keep").length, 30);
  await db.query("update daily_goal_wallet_config set block_on_limit = false");
  const off = (await db.query("select kind, count(*)::int n from daily_goal_wallet_trim_plan(null, $1) group by 1", [Q])).rows;
  assert.deepEqual(off, [{ kind: "keep", n: 42 }]);
  const forced = (await db.query("select count(*)::int n from daily_goal_wallet_trim_plan(30, $1) where kind='return'", [Q])).rows[0].n;
  assert.equal(forced, 12);
});

maybe("reserva de vagas com o teto em 30: 29 + 5 concede 1; 30 e 31 concedem 0; nunca passa de 30", async () => {
  const db = await freshDb();
  assert.equal((await db.query("select wallet_limit from daily_goal_wallet_config where id='default'")).rows[0].wallet_limit, 30);
  const R = await broker(db, "Corretor R");
  const slots = async (want) => Number((await db.query("select daily_goal_reserve_wallet_slots($1,$2) s", [R, want])).rows[0].s);
  for (let i = 0; i < 29; i += 1) await addRound(db, R, 0);
  assert.equal(await slots(5), 1);
  await addRound(db, R, 0);
  assert.equal(await slots(5), 0);
  await addRound(db, R, 0);
  assert.equal(await slots(5), 0);
  const empty = await broker(db, "Corretor Vazio");
  assert.equal(Number((await db.query("select daily_goal_reserve_wallet_slots($1,100) s", [empty])).rows[0].s), 30);
});

maybe("migration reaplicada não muda nada (idempotente) e não desfaz um teto ajustado depois", async () => {
  const db = await freshDb();
  await db.query("update daily_goal_wallet_config set wallet_limit = 20");
  await db.exec(MIGRATION);
  assert.equal((await db.query("select wallet_limit from daily_goal_wallet_config")).rows[0].wallet_limit, 20);
});

maybe("funções do rebalanceamento: anon/authenticated não executam", async () => {
  const db = await freshDb();
  for (const role of ["anon", "authenticated"]) {
    const r = await db.query("select has_function_privilege($1, 'public.daily_goal_wallet_trim(integer, uuid)', 'execute') p", [role]);
    assert.equal(r.rows[0].p, false, role);
  }
  assert.equal((await db.query("select has_function_privilege('service_role', 'public.daily_goal_wallet_trim(integer, uuid)', 'execute') p")).rows[0].p, true);
});

maybe("arquivos manuais da Central: aplicar roda numa transação com as conferências (e é repetível); reverter restaura", async () => {
  const apply = fs.readFileSync(path.join(ROOT, "docs/sql-manual/carteira-30-aplicar-rebalanceamento.sql"), "utf8");
  const revert = fs.readFileSync(path.join(ROOT, "docs/sql-manual/carteira-30-reverter-rebalanceamento.sql"), "utf8");
  const dry = fs.readFileSync(path.join(ROOT, "docs/sql-manual/carteira-30-dry-run.sql"), "utf8");
  const db = await freshDb();
  const { A } = await scenario(db);
  const before = await world(db);
  await db.exec(dry); // simulação não grava nada
  assert.deepEqual(await world(db), before);
  assert.equal((await db.query("select count(*)::int n from daily_goal_wallet_trim_log")).rows[0].n, 0);

  await db.exec(apply);
  assert.equal(await activeOf(db, A), 30);
  const runId = (await db.query("select run_id from daily_goal_wallet_trim_log limit 1")).rows[0].run_id;
  await db.exec(apply); // segunda vez: sem efeito, conferências passam
  assert.equal((await db.query("select count(*)::int n from daily_goal_wallet_trim_log")).rows[0].n, 1);

  await db.exec(revert.replace("00000000-0000-0000-0000-000000000000", runId));
  assert.deepEqual(await world(db), before);
});

maybe("o arquivo de aplicar desfaz tudo se uma conferência falhar (etapa de cliente alterada durante a execução)", async () => {
  const apply = fs.readFileSync(path.join(ROOT, "docs/sql-manual/carteira-30-aplicar-rebalanceamento.sql"), "utf8");
  const db = await freshDb();
  const { A } = await scenario(db);
  // Simula uma etapa de cliente alterada pelo próprio rebalanceamento: troca o status do cliente de um devolvido logo após o trim.
  const broken = apply.replace("-- Conferencias DEPOIS", "update public.simulation_registrations set status = 'in_service' where id in (select row_id from public.daily_goal_wallet_trim_backup where source_table = 'simulation_registrations');\n-- Conferencias DEPOIS");
  await assert.rejects(db.exec(broken), /CONFERENCIA: etapa de cliente mudou/);
  await db.exec("rollback").catch(() => {});
  assert.equal(await activeOf(db, A), 83);
});
