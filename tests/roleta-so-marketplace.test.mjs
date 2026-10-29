// ROL-2k (REGRA OFICIAL — dono, 2026-10-29): pessoa "só Marketplace" entra só no sorteio do Marketplace, com as mesmas
// regras da roleta; todo outro caminho continua exigindo lead_distribution_enabled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261029120000_roleta_so_marketplace.sql");
const distribution = read("lib/lead-distribution.js");
const marketplace = read("lib/marketplace-chat.js");

test("migration é aditiva e mantém as regras da roleta", () => {
  assert.match(migration, /add column if not exists marketplace_roulette_only boolean not null default false/);
  assert.match(migration, /distribution_origin text default 'leads'/);
  assert.match(migration, /u\.lead_distribution_enabled = true\s+or \(distribution_origin = 'marketplace' and u\.marketplace_roulette_only = true\)/);
  for (const rule of ["roulette_user_extra_eligible(u.id)", "roulette_receive_interval()", "interval '5 minutes'", "pg_advisory_xact_lock"]) {
    assert.ok(migration.includes(rule), `faltou ${rule}`);
  }
  assert.match(migration, /grant execute on function public\.pick_round_robin_broker\(uuid, text\) to service_role/);
  assert.doesNotMatch(migration, /assign_round_robin_lead/); // reserva sem presença não ganha "só Marketplace"
});

test("só o distribute do Marketplace passa a origem", () => {
  assert.match(marketplace, /isMessengerThreadKey\(conversation\.thread_key\) \? "" : "marketplace"/);
  const callers = [...distribution.matchAll(/distribution_origin: "marketplace"/g)];
  assert.equal(callers.length, 1);
  for (const file of ["lib/simulation-registrations.js", "lib/whatsapp-sponsored-lead.js", "lib/whatsapp-chat.js", "lib/crm-automations.js", "lib/whatsapp-flows.js", "lib/simulation-auto-send.js", "lib/cooled-clients-reactivation.js"]) {
    assert.doesNotMatch(read(file), /origin:\s*"marketplace"/, file);
  }
});

test("contagem de aptos (fila de espera / clientes frios) segue só com lead_distribution_enabled", () => {
  const body = distribution.slice(distribution.indexOf("export async function listOnlineRouletteBrokerIds"));
  assert.match(body.slice(0, 1200), /\.eq\("lead_distribution_enabled", true\)/);
  assert.doesNotMatch(body.slice(0, 1200), /marketplace_roulette_only/);
});
