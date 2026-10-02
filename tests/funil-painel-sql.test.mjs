import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CLIENT_FUNNEL_STAGES } from "../lib/client-status.js";

// Regressão do SQL canônico do funil (docs/analytics/funil-painel.sql), usado
// pelo analista-dados para bater com o painel Desempenho. Bug de 2026-10-02:
// "venda" era rk >= 7 (etapa alcançada), então cliente que vendeu em agosto e
// só mudou de subetapa (Conformidade/Pago) no período contava como venda do
// período. Regra oficial MET-12: PRIMEIRA entrada em Venda no período.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(path.join(root, "docs/analytics/funil-painel.sql"), "utf8");

function stageRanksFromSql() {
  const block = sql.slice(sql.indexOf("stage_of(status, rk) as (values"), sql.indexOf("),\ncoorte"));
  return new Map([...block.matchAll(/\('([a-z_]+)',(\d)\)/g)].map(([, status, rk]) => [status, Number(rk)]));
}

test("etapas do SQL batem com CLIENT_FUNNEL_STAGES (lib/client-status.js)", () => {
  const fromSql = stageRanksFromSql();
  const fromLib = new Map();
  CLIENT_FUNNEL_STAGES.forEach((stage, index) => stage.statuses.forEach((status) => fromLib.set(status, index + 1)));
  assert.deepEqual([...fromSql].sort(), [...fromLib].sort());
});

test("Venda = primeira entrada em status de venda dentro do período (MET-12), não etapa alcançada", () => {
  assert.match(sql, /primeira_venda as \(/);
  assert.match(sql, /min\(h\.changed_at\)[\s\S]*s\.rk = 7/, "primeira entrada vem do histórico de status de venda");
  assert.match(sql, /then r\.created_at end/, "criado já em venda sem histórico conta na criação");
  assert.match(sql, /v\.em >= p\.ini and v\.em < p\.fim\) as venda\b/, "filtra a PRIMEIRA entrada pelo período");
  assert.doesNotMatch(sql, /filter \(where rk >= 7\) as venda\b/, "rk >= 7 não pode mais ser a coluna venda");
});

test("SQL continua uma única instrução de leitura", () => {
  const code = sql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(code, /\b(insert|update|delete|drop|alter|create|truncate)\b/i);
  assert.equal(code.trim().split(";").filter((part) => part.trim()).length, 1);
});
