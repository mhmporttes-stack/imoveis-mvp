// ROL-2j [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-26] Trava até contatar: "O corretor NÃO recebe nenhum cliente novo
// (roleta de leads novos, Marketplace e fila de clientes frios) enquanto tiver um cliente recebido por distribuição ainda
// sem contato. Quando o prazo de 10 min vence sem contato, o cliente é redistribuído e a trava sai."
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ROULETTE_INELIGIBLE_STATUSES } from "../lib/client-distribution-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261026180000_roleta_trava_ate_contatar.sql";
const sql = read(MIGRATION);
const lockFn = sql.slice(sql.indexOf("function public.roulette_contact_lock_ok(p_user_id uuid)"), sql.indexOf("function public.roulette_contact_lock_ok_ids"));
const eligibleFn = sql.slice(sql.indexOf("function public.roulette_user_extra_eligible"));

test("migration com nome de 14 dígitos e a última a definir roulette_user_extra_eligible", () => {
  assert.match(MIGRATION.split("/").pop(), /^\d{14}_[a-z0-9_]+\.sql$/);
  const definers = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql") && /function public\.roulette_user_extra_eligible/.test(read(`supabase/migrations/${name}`)))
    .sort();
  assert.equal(definers.at(-1), MIGRATION.split("/").pop());
});

test("ponto central: roulette_user_extra_eligible mantém as regras anteriores e acrescenta a trava", () => {
  for (const piece of ["whatsapp_user_has_active_number(p_user_id)", "whatsapp_restrictions", "office_presence_ok(p_user_id)", "roulette_contact_lock_ok(p_user_id)"]) {
    assert.ok(eligibleFn.includes(piece), piece);
  }
});

test("status que não travam = ROULETTE_INELIGIBLE_STATUSES (fonte única no JS)", () => {
  const list = lockFn.match(/r\.status not in \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map((item) => item.replaceAll("'", ""));
  assert.deepEqual([...list].sort(), [...ROULETTE_INELIGIBLE_STATUSES].sort());
});

test("contato = mensagem humana (last_human_reply_at) ou resposta do Marketplace — clique no WhatsApp não conta", () => {
  assert.match(lockFn, /whatsapp_conversations c\s+where c\.client_id = r\.id and c\.last_human_reply_at >= rc\.received_at/);
  assert.match(lockFn, /mc\.last_human_reply_at >= rc\.received_at/);
  assert.match(lockFn, /m\.direction = 'outbound'[\s\S]*m\.sender_user_id is not null/);
  assert.doesNotMatch(lockFn, /last_whatsapp_contact_at/);
});

test("só cliente recebido pela distribuição, ainda com o corretor e fora da fila de espera", () => {
  assert.match(lockFn, /r\.responsible_user_id = p_user_id/);
  assert.match(lockFn, /r\.pending_distribution_at is null/);
  assert.match(lockFn, /event_type in \('assigned', 'auto_transferred'\)/);
  assert.match(lockFn, /last_dist\.to_user_id = p_user_id/);
  assert.match(lockFn, /toWaitingQueue/);
  assert.match(lockFn, /heldByOwner/);
});

test("não retroativa (marca gravada ao aplicar, sem sobrescrever) e com teto de 10 min", () => {
  assert.match(sql, /insert into public\.crm_settings \(id, setting_value\)\s+values \('roulette_contact_lock', jsonb_build_object\('since', now\(\)\)\)\s+on conflict \(id\) do nothing/);
  assert.match(sql, /'infinity'::timestamptz/);
  assert.match(lockFn, /rc\.received_at >= public\.roulette_contact_lock_since\(\)/);
  assert.match(sql, /interval '10 minutes'/);
});

test("JS: quem escolhe corretor fora do SQL (fila de clientes frios, contagem da fila de espera) usa a mesma trava", () => {
  const js = read("lib/lead-distribution.js");
  const online = js.slice(js.indexOf("export async function listOnlineRouletteBrokerIds"), js.indexOf("export async function filterContactLockFreeIds"));
  assert.match(online, /return filterContactLockFreeIds\(presentIds\)/);
  const filter = js.slice(js.indexOf("export async function filterContactLockFreeIds"));
  assert.match(filter, /rpc\("roulette_contact_lock_ok_ids"/);
  assert.match(filter, /if \(isMissingRouletteCooldownRpc\(error\)\) return ids;/);
  assert.match(read("lib/cooled-clients-reactivation.js"), /filterRouletteCooldownFreeIds\(await listOnlineRouletteBrokerIds\(\)\)/);
});

test("ninguém liberado: a roleta devolve vazio e o lead espera (comportamento mantido)", () => {
  const js = read("lib/lead-distribution.js");
  assert.match(js, /if \(!roulette\.brokerId\) \{\s+if \(excludedBrokerId\) continue;/);
  assert.match(read("lib/marketplace-chat.js"), /waiting_distribution_at: iso/);
});
