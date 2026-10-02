import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Hook de SQL do Supabase (.claude/hooks/guard-destructive-sql.mjs), testado
// com entradas simuladas — nada vai ao banco.
const hook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.claude/hooks/guard-destructive-sql.mjs");

function run({ tool = "mcp__Supabase__execute_sql", query = "", agent = undefined } = {}) {
  const input = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: { project_id: "p", query }, ...(agent ? { agent_id: "a1", agent_type: agent } : {}) };
  const result = spawnSync(process.execPath, [hook], { input: JSON.stringify(input), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

test("agente somente leitura: SELECT passa dentro de transação READ ONLY", () => {
  const out = run({ agent: "analista-dados", query: "select status, count(*) , case when x then 1 end from simulation_registrations group by 1" });
  assert.equal(out.permissionDecision, "allow");
  assert.match(out.updatedInput.query, /^set transaction read only;\n/);
  assert.equal(out.updatedInput.project_id, "p");
});

test("agente somente leitura: escrita, DDL, SET e controle de transação são negados", () => {
  for (const query of [
    "insert into crm_settings(id) values ('x')",
    "update simulation_registrations set status='x' where id='1'",
    "delete from whatsapp_messages where id='1'",
    "drop table x",
    "create table t(a int)",
    "commit; insert into x values (1)",
    "set transaction read write; select 1",
    "select * into tmp from x",
    "do $$ begin perform 1; end $$"
  ]) {
    assert.equal(run({ agent: "analista-dados", query }).permissionDecision, "deny", query);
  }
  assert.equal(run({ agent: "auditor-crm", tool: "mcp__Supabase__apply_migration", query: "select 1" }).permissionDecision, "deny");
});

test("vale para todos os agentes analíticos e para o conector com UUID", () => {
  for (const agent of ["auditor-crm", "gestor-trafego", "gestor-financeiro", "marketing-posicionamento"]) {
    assert.equal(run({ agent, query: "delete from x where id=1" }).permissionDecision, "deny", agent);
  }
  const uuid = run({ agent: "analista-dados", tool: "mcp__4b75594d-0000-0000-0000-000000000000__execute_sql", query: "select 1" });
  assert.equal(uuid.permissionDecision, "allow");
  assert.match(uuid.updatedInput.query, /read only/);
});

test("sessão principal: leitura passa sem pergunta; escrita e migration pedem confirmação", () => {
  assert.equal(run({ query: "select count(*) from simulation_registrations" }), null);
  assert.equal(run({ query: "select 'drop table x' as texto -- drop" }), null);
  assert.equal(run({ query: "update x set a=1 where id=2" }).permissionDecision, "ask");
  assert.equal(run({ query: "insert into x values (1)" }).permissionDecision, "ask");
  assert.equal(run({ tool: "mcp__Supabase__apply_migration", query: "alter table x add column y int" }).permissionDecision, "ask");
});

test("sessão principal: destrutivo pede autorização com o motivo", () => {
  for (const [query, label] of [
    ["drop table x", /DROP/],
    ["truncate x", /TRUNCATE/],
    ["delete from x where id=1", /DELETE/],
    ["update x set a=1", /UPDATE sem WHERE/],
    ["create policy p on x using (true)", /policy/],
    ["alter table x disable row level security", /RLS/],
    ["grant select on x to anon", /GRANT/],
    ["select * from vault.decrypted_secrets", /secrets/]
  ]) {
    const out = run({ query });
    assert.equal(out.permissionDecision, "ask", query);
    assert.match(out.permissionDecisionReason, label, query);
  }
});

test("entrada ilegível nunca libera", () => {
  const result = spawnSync(process.execPath, [hook], { input: "{nao-json", encoding: "utf8" });
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "ask");
});
