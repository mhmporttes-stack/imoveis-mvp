// "Imprimir lista" da Prospecção (2026-10-04) — executa a MIGRATION de verdade num Postgres em memória (PGlite)
// com tabelas mínimas de teste e dados 100% fictícios. Nada de rede nem banco real.
// PGlite NÃO é dependência do projeto: o teste só roda quando PGLITE_DIR aponta para a pasta do pacote
// (ex.: PGLITE_DIR=<pasta>/node_modules/@electric-sql/pglite); sem isso fica "skipped" (o CI não o tem).
// A parte estática (texto da migration) roda sempre.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261004170000_prospecting_manual_lists.sql"), "utf8");

test("migration: nome com 14 dígitos, aditiva, RLS ligado sem policy e RPC só para service_role", () => {
  assert.match("20261004170000_prospecting_manual_lists.sql", /^\d{14}_[a-z_]+\.sql$/);
  assert.doesNotMatch(MIGRATION, /\b(drop\s+table|truncate|delete\s+from)\b/i);
  assert.doesNotMatch(MIGRATION, /create\s+policy/i);
  for (const table of ["prospecting_manual_lists", "prospecting_manual_list_items"]) {
    assert.match(MIGRATION, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(MIGRATION, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }
  assert.match(MIGRATION, /revoke all on function public\.create_prospecting_manual_list\([^)]*\) from public, anon, authenticated/);
  assert.match(MIGRATION, /grant execute on function public\.create_prospecting_manual_list\([^)]*\) to service_role/);
  assert.match(MIGRATION, /security definer\s+set search_path = public, pg_temp/);
  assert.match(MIGRATION, /for update of p skip locked/);
  assert.match(MIGRATION, /create unique index if not exists prospecting_manual_list_items_contact_key on public\.prospecting_manual_list_items \(contact_id\)/);
});

test("migration: a geração só escreve nas tabelas novas (nenhum UPDATE/INSERT em contatos, clientes, funil ou pontos)", () => {
  const start = MIGRATION.indexOf("create or replace function public.create_prospecting_manual_list");
  const end = MIGRATION.indexOf("-- 3) Os seletores");
  const body = MIGRATION.slice(start, end).replace(/--[^\n]*/g, "");
  assert.ok(start > 0 && end > start);
  const writes = [...body.matchAll(/(?<!for\s)\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?([a-z_]+)/gi)].map((m) => m[1]);
  assert.ok(writes.length >= 3);
  for (const table of writes) assert.match(table, /^prospecting_manual_list(s|_items)$/, `escreve em ${table}`);
});

test("migration: os 3 seletores (Meta Diária, Prospecção manual, fila extra) pulam contato reservado", () => {
  for (const fn of ["claim_daily_goal_contacts", "claim_single_prospecting_contact", "enqueue_extra_prospecting_dispatch"]) {
    const from = MIGRATION.indexOf(`create or replace function public.${fn}(`);
    assert.ok(from > 0, fn);
    const next = MIGRATION.indexOf("create or replace function", from + 10);
    const body = MIGRATION.slice(from, next > 0 ? next : undefined);
    assert.match(body, /not exists \(select 1 from public\.prospecting_manual_list_items mli where mli\.contact_id = p\.id\)/, fn);
  }
});

const pgliteDir = process.env.PGLITE_DIR;
const pgliteOk = Boolean(pgliteDir && fs.existsSync(path.join(pgliteDir, "dist/index.js")));
const { PGlite } = pgliteOk ? await import(pathToFileURL(path.join(pgliteDir, "dist/index.js")).href) : {};

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create table admin_users (id uuid primary key default gen_random_uuid(), name text not null, status text not null default 'active');
create table prospecting_contacts (
  id uuid primary key default gen_random_uuid(), name text not null, phone_normalized text not null, status text not null default 'available',
  assigned_user_id uuid, registration_id uuid, last_broker_id uuid, last_attempt_at timestamptz, available_after timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), queue_sort_at timestamptz not null default now(), owner_user_id uuid);
create table simulation_registrations (id uuid primary key default gen_random_uuid(), phone_normalized text, status text, responsible_user_id uuid);
create table daily_goal_rounds (id uuid primary key default gen_random_uuid(), prospecting_contact_id uuid, client_id uuid, broker_id uuid, round_started_at date, attempt_count int, status text, origin text);
create table daily_goal_auto_queue (id uuid primary key default gen_random_uuid());
create table prospecting_extra_dispatch_state (broker_id uuid primary key, cycle_id uuid, cycle_count int default 0, updated_at timestamptz);
create function is_usable_contact_name(p_name text) returns boolean language sql immutable as $$
  select p_name is not null and length(trim(p_name)) >= 2 and p_name ~ '[[:alpha:]]'
    and lower(trim(regexp_replace(p_name, '\\s+', ' ', 'g'))) not in ('sem nome','cliente','teste','na') $$;
create function daily_goal_reserve_wallet_slots(p_broker uuid, p_quota int) returns int language sql as $$ select p_quota $$;
create function prospecting_extra_dispatch_effective_state(a uuid, b int, c int) returns table (cycle_id uuid, cycle_count int, open_count int, cooldown_until timestamptz, needs_reset boolean) language sql as $$ select null::uuid, 0, 0, null::timestamptz, false $$;
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(MIGRATION);
  return db;
}

let phoneSeq = 0;
const newPhone = () => `+55149${String(90000000 + (phoneSeq += 1)).padStart(8, "0")}`;
async function addContact(db, fields = {}) {
  const row = { name: `Cliente Teste ${phoneSeq + 1}`, phone_normalized: newPhone(), ...fields };
  const cols = Object.keys(row);
  const { rows } = await db.query(`insert into prospecting_contacts (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`, cols.map((c) => row[c]));
  return rows[0].id;
}
async function broker(db, name = "Corretora Teste") {
  return (await db.query("insert into admin_users (name) values ($1) returning id", [name])).rows[0].id;
}
const create = (db, brokerId, key = `k-${Math.random().toString(36).slice(2)}-xx`, limit = 30) =>
  db.query("select create_prospecting_manual_list($1,$2,$3,$4,$5,null) r", [brokerId, limit, null, "admin@teste", key]).then((res) => res.rows[0].r);
const snapshot = async (db) => (await db.query(`select md5(string_agg(t::text, '|' order by t::text)) h from (select * from prospecting_contacts) t`)).rows[0].h;

const maybe = pgliteOk ? test : test.skip;

maybe("gera exatamente 30 entre 40 elegíveis, na ordem da fila (queue_sort_at), com snapshot", async () => {
  const db = await freshDb();
  const b = await broker(db);
  for (let i = 0; i < 40; i += 1) await addContact(db, { name: `Pessoa ${String.fromCharCode(65 + (i % 26))}ndrade ${i}`, queue_sort_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
  const result = await create(db, b);
  assert.equal(result.contact_count, 30);
  assert.equal(result.already, false);
  const items = (await db.query("select position, name_snapshot, phone_snapshot, contact_id from prospecting_manual_list_items order by position")).rows;
  assert.equal(items.length, 30);
  assert.deepEqual(items.map((i) => i.position), Array.from({ length: 30 }, (_, i) => i + 1));
  const expectedFirst = (await db.query("select name from prospecting_contacts order by queue_sort_at asc limit 1")).rows[0].name;
  assert.equal(items[0].name_snapshot, expectedFirst);
  const list = (await db.query("select * from prospecting_manual_lists")).rows[0];
  assert.equal(Number(list.numero), 1);
  assert.equal(list.broker_name_snapshot, "Corretora Teste");
  assert.equal(list.contact_count, 30);
});

maybe("não altera NADA em prospecting_contacts (status, responsável, tentativa) nem cria cliente", async () => {
  const db = await freshDb();
  const b = await broker(db);
  for (let i = 0; i < 35; i += 1) await addContact(db);
  const before = await snapshot(db);
  const clientsBefore = (await db.query("select count(*)::int c from simulation_registrations")).rows[0].c;
  await create(db, b);
  assert.equal(await snapshot(db), before);
  assert.equal((await db.query("select count(*)::int c from simulation_registrations")).rows[0].c, clientsBefore);
  assert.equal((await db.query("select count(*)::int c from daily_goal_rounds")).rows[0].c, 0);
});

maybe("exclui inelegíveis: não contactar (cliente e linha irmã), atribuído, em atendimento, tentativa recente, base individual, nome ruim, telefone inválido, rodada ativa, cliente de outro corretor", async () => {
  const db = await freshDb();
  const b = await broker(db);
  const other = await broker(db, "Outro Corretor");
  const ok = [];
  ok.push(await addContact(db, { name: "Elegivel Um" }));
  ok.push(await addContact(db, { name: "Elegivel Vencida", status: "recent_attempt", available_after: new Date(Date.now() - 86400000).toISOString() }));
  // cliente com ESTE corretor responsável: permitido
  const mine = (await db.query("insert into simulation_registrations (phone_normalized, status, responsible_user_id) values ('+5514900000001','pending',$1) returning id", [b])).rows[0].id;
  ok.push(await addContact(db, { name: "Cliente Do Mesmo Corretor", phone_normalized: "+5514900000001", registration_id: mine }));
  // cliente sem responsável (devolvido à fila): permitido
  await db.query("insert into simulation_registrations (phone_normalized, status) values ('+5514900000002','pending')");
  ok.push(await addContact(db, { name: "Cliente Sem Responsavel", phone_normalized: "+5514900000002" }));

  const bad = {};
  const dncClient = (await db.query("insert into simulation_registrations (phone_normalized, status) values ('+5514900000010','do_not_contact') returning id")).rows[0].id;
  bad.dncPorTelefone = await addContact(db, { name: "Nao Contactar Tel", phone_normalized: "+5514900000010" });
  bad.dncPorCadastro = await addContact(db, { name: "Nao Contactar Cad", registration_id: dncClient });
  await addContact(db, { name: "Linha Dnc", phone_normalized: "+5514900000011", status: "do_not_contact" });
  bad.irma = await addContact(db, { name: "Linha Irma", phone_normalized: "+5514900000011" });
  await db.query("insert into simulation_registrations (phone_normalized, status) values ('+5514900000012','sale_completed')");
  bad.venda = await addContact(db, { name: "Ja Comprou", phone_normalized: "+5514900000012" });
  bad.atribuido = await addContact(db, { name: "Atribuido Alguem", assigned_user_id: other, status: "claimed" });
  bad.claimed = await addContact(db, { name: "Em Atendimento", status: "claimed" });
  bad.recente = await addContact(db, { name: "Tentativa Recente", status: "recent_attempt", available_after: new Date(Date.now() + 86400000).toISOString() });
  bad.individual = await addContact(db, { name: "Base Individual", owner_user_id: other });
  bad.semNome = await addContact(db, { name: "Sem Nome" });
  bad.soNumero = await addContact(db, { name: "14999999999" });
  bad.fone8 = await addContact(db, { name: "Fone Curto", phone_normalized: "+551433334444" });
  bad.foneFora = await addContact(db, { name: "Fone Exterior", phone_normalized: "+14155550123" });
  const rodadaContato = await addContact(db, { name: "Com Rodada Ativa", phone_normalized: "+5514900000013" });
  await db.query("insert into daily_goal_rounds (prospecting_contact_id, status) values ($1,'active')", [rodadaContato]);
  bad.rodada = rodadaContato;
  const alheio = (await db.query("insert into simulation_registrations (phone_normalized, status, responsible_user_id) values ('+5514900000014','pending',$1) returning id", [other])).rows[0].id;
  bad.outroCorretor = await addContact(db, { name: "Cliente De Outro", phone_normalized: "+5514900000014", registration_id: alheio });

  const result = await create(db, b);
  assert.equal(result.contact_count, ok.length);
  const chosen = new Set((await db.query("select contact_id from prospecting_manual_list_items")).rows.map((r) => r.contact_id));
  for (const id of ok) assert.ok(chosen.has(id), "elegível ficou de fora");
  for (const [motivo, id] of Object.entries(bad)) assert.ok(!chosen.has(id), `inelegível entrou: ${motivo}`);
});

maybe("menos de 30: gera com o que houver (N); zero elegíveis: recusa e não grava nada nem gasta número", async () => {
  const db = await freshDb();
  const b = await broker(db);
  await assert.rejects(() => create(db, b), /MANUAL_LIST_NO_CONTACTS/);
  assert.equal((await db.query("select count(*)::int c from prospecting_manual_lists")).rows[0].c, 0);
  for (let i = 0; i < 7; i += 1) await addContact(db);
  const result = await create(db, b);
  assert.equal(result.contact_count, 7);
  assert.equal(Number(result.numero), 1, "a recusa anterior não consumiu o número 1");
  assert.equal((await db.query("select contact_count from prospecting_manual_lists")).rows[0].contact_count, 7);
});

maybe("duas listas nunca têm o mesmo contato; a 2ª pega os próximos; o banco barra duplicata manual", async () => {
  const db = await freshDb();
  const [b1, b2] = [await broker(db, "Um"), await broker(db, "Dois")];
  for (let i = 0; i < 45; i += 1) await addContact(db, { queue_sort_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
  const first = await create(db, b1);
  const second = await create(db, b2);
  assert.equal(first.contact_count, 30);
  assert.equal(second.contact_count, 15);
  assert.notEqual(first.list_id, second.list_id);
  assert.equal(Number(second.numero), 2);
  const dup = (await db.query("select contact_id, count(*)::int c from prospecting_manual_list_items group by contact_id having count(*) > 1")).rows;
  assert.equal(dup.length, 0);
  const some = (await db.query("select contact_id from prospecting_manual_list_items where list_id = $1 limit 1", [first.list_id])).rows[0].contact_id;
  await assert.rejects(() => db.query("insert into prospecting_manual_list_items (list_id, contact_id, position, name_snapshot, phone_snapshot) values ($1,$2,30,'x','y')", [second.list_id, some]), /duplicate key|unique/i);
  await assert.rejects(() => create(db, b1), /MANUAL_LIST_NO_CONTACTS/, "nada sobrou para uma 3ª lista");
});

maybe("idempotência: a mesma chave devolve a MESMA lista e não reserva mais nada", async () => {
  const db = await freshDb();
  const b = await broker(db);
  for (let i = 0; i < 70; i += 1) await addContact(db);
  const first = await create(db, b, "chave-do-clique-1");
  const again = await create(db, b, "chave-do-clique-1");
  assert.equal(again.already, true);
  assert.equal(again.list_id, first.list_id);
  assert.equal(Number(again.numero), Number(first.numero));
  assert.equal((await db.query("select count(*)::int c from prospecting_manual_lists")).rows[0].c, 1);
  assert.equal((await db.query("select count(*)::int c from prospecting_manual_list_items")).rows[0].c, 30);
  const other = await create(db, b, "chave-do-clique-2");
  assert.equal(other.already, false);
  assert.equal(other.contact_count, 30);
});

maybe("corretor inexistente ou inativo é recusado", async () => {
  const db = await freshDb();
  for (let i = 0; i < 3; i += 1) await addContact(db);
  const inactive = (await db.query("insert into admin_users (name, status) values ('Inativo','inactive') returning id")).rows[0].id;
  await assert.rejects(() => create(db, inactive), /MANUAL_LIST_BROKER_INVALID/);
  await assert.rejects(() => create(db, "00000000-0000-0000-0000-000000000000"), /MANUAL_LIST_BROKER_INVALID/);
  assert.equal((await db.query("select count(*)::int c from prospecting_manual_list_items")).rows[0].c, 0);
});

maybe("snapshot imutável: renomear/excluir o contato depois não muda a lista; excluir mantém o item", async () => {
  const db = await freshDb();
  const b = await broker(db);
  const id = await addContact(db, { name: "Nome Original" });
  await create(db, b);
  await db.query("update prospecting_contacts set name = 'Outro Nome', phone_normalized = '+5514911111111' where id = $1", [id]);
  let item = (await db.query("select name_snapshot, phone_snapshot, contact_id from prospecting_manual_list_items")).rows[0];
  assert.equal(item.name_snapshot, "Nome Original");
  assert.notEqual(item.phone_snapshot, "+5514911111111");
  await db.query("delete from prospecting_contacts where id = $1", [id]);
  item = (await db.query("select name_snapshot, contact_id from prospecting_manual_list_items")).rows[0];
  assert.equal(item.name_snapshot, "Nome Original");
  assert.equal(item.contact_id, null);
});

maybe("seletores existentes pulam o reservado: claim_single e claim_daily_goal_contacts", async () => {
  const db = await freshDb();
  const b = await broker(db);
  const target = await broker(db, "Quem Prospecta Pelo Sistema");
  const reservedId = await addContact(db, { name: "Reservado Para Papel", queue_sort_at: "2026-01-01T00:00:00Z" });
  const freeId = await addContact(db, { name: "Livre Para Sistema", queue_sort_at: "2026-01-02T00:00:00Z" });
  await create(db, b, "chave-reserva-1", 1);
  const reserved = (await db.query("select contact_id from prospecting_manual_list_items")).rows[0].contact_id;
  assert.equal(reserved, reservedId);
  const single = await db.query("select * from claim_single_prospecting_contact($1,$2,current_date)", [reservedId, target]);
  assert.equal(single.rows.length, 0);
  const daily = await db.query("select id from claim_daily_goal_contacts($1, 5, current_date)", [target]);
  assert.deepEqual(daily.rows.map((r) => r.id), [freeId]);
  const row = (await db.query("select status, assigned_user_id from prospecting_contacts where id = $1", [reservedId])).rows[0];
  assert.equal(row.status, "available");
  assert.equal(row.assigned_user_id, null);
});

maybe("a função de geração é SECURITY DEFINER com search_path fixo", async () => {
  const db = await freshDb();
  const row = (await db.query("select prosecdef, proconfig from pg_proc where proname = 'create_prospecting_manual_list'")).rows[0];
  assert.equal(row.prosecdef, true);
  assert.ok(row.proconfig.some((c) => /^search_path=/.test(c)));
});

maybe("migration idempotente: aplicar de novo não falha nem apaga listas ou itens", async () => {
  const db = await freshDb();
  const b = await broker(db);
  for (let i = 0; i < 4; i += 1) await addContact(db);
  await create(db, b, "chave-idempotente-1");
  await db.exec(MIGRATION);
  assert.equal((await db.query("select count(*)::int c from prospecting_manual_lists")).rows[0].c, 1);
  assert.equal((await db.query("select count(*)::int c from prospecting_manual_list_items")).rows[0].c, 4);
});
