// Aba "Todos" da tela Clientes sem situação negativa (REGRA OFICIAL — dono, 2026-10-23). Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALL_TAB_NEGATIVE_STATUSES,
  CLIENT_STATUS,
  CLIENT_STATUS_FILTER_GROUPS,
  allTabExcludedStatuses
} from "../lib/client-status.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const group = (key) => CLIENT_STATUS_FILTER_GROUPS.find((item) => item.key === key);

test("negativos da aba Todos = Arquivado + Não contactar; continuam na aba Arquivados", () => {
  assert.deepEqual([...ALL_TAB_NEGATIVE_STATUSES].sort(), [CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT].sort());
  for (const status of ALL_TAB_NEGATIVE_STATUSES) assert.ok(group("archived").statuses.includes(status), status);
  assert.deepEqual(allTabExcludedStatuses(), ALL_TAB_NEGATIVE_STATUSES);
});

test("casos duvidosos NÃO são tratados como negativos (Tentando contato, Restrição, Reprovado, venda...)", () => {
  for (const status of [
    CLIENT_STATUS.AWAITING_RETURN,
    CLIENT_STATUS.RESTRICTION,
    CLIENT_STATUS.REJECTED,
    CLIENT_STATUS.INCOME_COMMITMENT,
    CLIENT_STATUS.SHIELDING,
    CLIENT_STATUS.SALE_COMPLETED,
    CLIENT_STATUS.IN_SERVICE
  ]) assert.ok(!allTabExcludedStatuses().includes(status), status);
});

test("pesquisa por nome/telefone na aba Todos fica como era: arquivado aparece, Não contactar não", () => {
  assert.deepEqual(allTabExcludedStatuses({ searching: true }), [CLIENT_STATUS.DO_NOT_CONTACT]);
});

test("lista (paginação/total) e contador da aba Todos aplicam o filtro no servidor, na query", () => {
  const code = read("lib/simulation-list-query.js");
  const page = code.slice(code.indexOf("function buildFiltered"), code.indexOf("if (filters.status && filters.status !== \"all\")"));
  assert.match(page, /if \(isAllTab\) \{[\s\S]*query\.not\("status", "in", `\(\$\{allTabExcludedStatuses\(\{ searching: Boolean\(sanitizeFilterTerm\(filters\.query\)\) \}\)\.join\(","\)\}\)`\)/);
  const counters = code.slice(code.indexOf("export async function getSimulationClientCounters"));
  assert.ok(counters.includes('allTotalQuery = allTotalQuery.not("status", "in", `(${allTabExcludedStatuses().join(",")})`);'));
  // as outras abas seguem pelo grupo de status (Arquivados mostra os negativos normalmente)
  assert.ok(page.includes('query = query.in("status", groupStatuses);'));
  assert.ok(counters.includes('group.statuses.reduce((total, status) => total + (byStatus[status] || 0), 0)'));
});
