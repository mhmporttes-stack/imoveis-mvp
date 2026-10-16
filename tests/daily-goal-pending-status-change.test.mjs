import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateDailyGoalPending } from "../lib/daily-goal-progress.mjs";
import { isPersonStatusChange } from "../lib/client-attendance-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-16] "Mudar a etapa do cliente também deve resolver a pendência do dia?" -> "sim".
// Mudança de status feita por PESSOA desde o início do dia resolve a pendência (automáticas do sistema não).

const DAY = 24 * 60 * 60 * 1000;
const dayStart = Date.parse("2026-10-16T03:00:00.000Z");
const now = dayStart + 10 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const base = { responsibleUserId: "b1", status: "documents_pending", lastWhatsappContactAt: iso(dayStart - 5 * DAY) };

function evaluate(client) {
  return evaluateDailyGoalPending({ brokerId: "b1", frozenIds: ["c"], clientsById: new Map([["c", { ...base, ...client }]]), dayStartMs: dayStart, nowMs: now });
}

test("mudança de etapa por pessoa hoje resolve a pendência do dia", () => {
  assert.deepEqual(evaluate({ status: "awaiting_approval", personStatusChangeAt: iso(dayStart + 3600_000) }), { total: 1, done: 1, remaining: 0, remainingIds: [] });
});

test("mudança de etapa de ontem (ou sem mudança) não resolve a de hoje", () => {
  assert.equal(evaluate({ personStatusChangeAt: iso(dayStart - 3600_000) }).done, 0);
  assert.equal(evaluate({}).done, 0);
});

test("last_status_change_at sozinho (pode ser automático) continua NÃO resolvendo fora do 'Tentando contato'", () => {
  assert.equal(evaluate({ lastStatusChangeAt: iso(dayStart + 3600_000) }).done, 0);
});

test("só mudança feita por pessoa entra no sinal (mesma régua do último atendimento)", () => {
  assert.equal(isPersonStatusChange({ changed_by: "corretor@x.com", source: "admin" }), true);
  assert.equal(isPersonStatusChange({ changed_by: "sistema", source: "system" }), false);
  assert.equal(isPersonStatusChange({ changed_by: "corretor@x.com", source: "automatico_por_venda" }), false);
  assert.equal(isPersonStatusChange({ changed_by: "corretor@x.com", source: "whatsapp_opt_out" }), false);
});

test("o cálculo das pendências do dia carrega a mudança de status por pessoa da janela do dia (individual e em lote)", () => {
  const lib = readFileSync(new URL("../lib/daily-goal-pending.js", import.meta.url), "utf8");
  assert.match(lib, /loadPersonStatusChangeByClient\(null, statusWindow\)/);
  assert.match(lib, /loadClientsByIds\(ids, day\)/);
  assert.match(lib, /loadClientsByIds\(allClientIds, day\)/);
  const attendance = readFileSync(new URL("../lib/client-attendance.js", import.meta.url), "utf8");
  const fn = attendance.slice(attendance.indexOf("export async function loadPersonStatusChangeByClient"));
  assert.match(fn, /isPersonStatusChange\(row\)/);
});
