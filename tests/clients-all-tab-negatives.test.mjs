// Aba "Todos" da tela Clientes sem situação negativa (REGRA OFICIAL — dono, 2026-10-23, CLI-12a). Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALL_TAB_NEGATIVE_STATUSES,
  CLIENT_STATUS,
  CLIENT_STATUS_FILTER_GROUPS,
  allTabExcludedStatuses
} from "../lib/client-status.js";
import { ALL_TAB_NEGATIVE_TAG_KEYS, ALL_TAB_NEGATIVE_TAG_NAMES, applyAllTabExclusions } from "../lib/client-all-tab-core.mjs";
import { aggregateStatusCounts } from "../lib/crm-metrics/status-counts-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const group = (key) => CLIENT_STATUS_FILTER_GROUPS.find((item) => item.key === key);
// Cópia fiel de normalizeTagKey (lib/client-tags.js importa o Supabase e não carrega no node --test); conferida abaixo.
const tagKey = (value) => String(value ?? "").replace(/\s+/g, " ").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Construtor de consulta falso: registra os filtros aplicados.
function fakeQuery() {
  const calls = [];
  const query = { calls, not(column, op, value) { calls.push(["not", column, op, value]); return query; } };
  return query;
}

test("status negativos da aba Todos: Arquivado, Não contactar, Restrição, Reprovado e Comprometimento de renda", () => {
  assert.deepEqual([...ALL_TAB_NEGATIVE_STATUSES].sort(), [
    CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT, CLIENT_STATUS.RESTRICTION, CLIENT_STATUS.REJECTED, CLIENT_STATUS.INCOME_COMMITMENT
  ].sort());
  assert.deepEqual(allTabExcludedStatuses(), ALL_TAB_NEGATIVE_STATUSES);
  // cada um continua na aba/etapa própria
  for (const status of [CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT]) assert.ok(group("archived").statuses.includes(status), status);
  for (const status of [CLIENT_STATUS.RESTRICTION, CLIENT_STATUS.REJECTED, CLIENT_STATUS.INCOME_COMMITMENT]) assert.ok(group("approval").statuses.includes(status), status);
});

test("ficam na aba Todos: Tentando contato, Venda, Blindagem e etapas ativas", () => {
  for (const status of [CLIENT_STATUS.AWAITING_RETURN, CLIENT_STATUS.SALE_COMPLETED, CLIENT_STATUS.SALE_CONTRACT, CLIENT_STATUS.SHIELDING, CLIENT_STATUS.IN_SERVICE, CLIENT_STATUS.APPROVAL_PENDING]) {
    assert.ok(!allTabExcludedStatuses().includes(status), status);
  }
});

test("etiquetas negativas: nome normalizado exato (SEM WHATSAPP, OUTRA CIDADE, RESTRIÇÃO); renda/IR ficam", () => {
  assert.deepEqual(ALL_TAB_NEGATIVE_TAG_NAMES.map(tagKey), ALL_TAB_NEGATIVE_TAG_KEYS);
  for (const kept of ["RENDA INSUFICIENTE", "IR ABAIXO DO SUFICIENTE", "Anúncio WhatsApp"]) assert.ok(!ALL_TAB_NEGATIVE_TAG_KEYS.includes(tagKey(kept)), kept);
  const tags = read("lib/client-tags.js");
  assert.ok(tags.includes('.normalize("NFD")') && tags.includes(".replace(/[\\u0300-\\u036f]/g, \"\")") && tags.includes(".toLowerCase()"), "mesma normalização de normalizeTagKey");
  const loader = read("lib/client-all-tab.js");
  assert.ok(loader.includes('.in("normalized_name", ALL_TAB_NEGATIVE_TAG_KEYS)'), "comparação exata, sem ilike");
  assert.ok(!/ilike|like\(/.test(loader));
});

test("exclusão na consulta: status + ids com etiqueta; na busca só Não contactar (arquivado e demais aparecem)", () => {
  const q = applyAllTabExclusions(fakeQuery(), { tagClientIds: ["c1", "c2"] });
  assert.deepEqual(q.calls, [
    ["not", "status", "in", `(${ALL_TAB_NEGATIVE_STATUSES.join(",")})`],
    ["not", "id", "in", "(c1,c2)"]
  ]);
  const searching = applyAllTabExclusions(fakeQuery(), { searching: true, tagClientIds: ["c1"] });
  assert.deepEqual(searching.calls, [["not", "status", "in", `(${CLIENT_STATUS.DO_NOT_CONTACT})`]]);
  assert.deepEqual(applyAllTabExclusions(fakeQuery()).calls.length, 1, "sem etiqueta marcada não filtra id");
});

test("lista (paginação/total) e contador da aba Todos usam a mesma exclusão, no servidor", () => {
  const code = read("lib/simulation-list-query.js");
  const page = code.slice(code.indexOf("export async function listSimulationClientsPage"), code.indexOf("if (filters.status && filters.status !== \"all\")"));
  assert.ok(page.includes("isAllTab && !searching ? loadAllTabTagClientIds(supabase) : Promise.resolve([])"));
  assert.ok(page.includes("query = applyAllTabExclusions(query, { searching, tagClientIds: allTabTagClientIds });"));
  assert.ok(page.includes('query = query.in("status", groupStatuses);'), "outras abas pelo grupo de status");
  const counters = code.slice(code.indexOf("export async function getSimulationClientCounters"));
  assert.ok(counters.includes("applyAllTabExclusions(allTotalQuery, { tagClientIds: await loadAllTabTagClientIds(supabase) })"));
  // Patrocinado inalterado
  assert.ok(code.includes('query.or(SPONSORED_ORIGIN_FILTER, { foreignTable: "client_origins" }).neq("status", CLIENT_STATUS.DO_NOT_CONTACT)'));
});

test("Henry/Alexa: grupo 'all' = contador da tela (mesma exclusão, sem Particular e Pago)", () => {
  const stock = read("lib/crm-metrics/funnel-stock.js");
  assert.ok(stock.includes("result.byGroup.all = allTab;"));
  assert.ok(stock.includes('.is("private_contact_at", null)'));
  assert.ok(stock.includes("applyAllTabExclusions(query, { tagClientIds: await loadAllTabExcludedTagClientIds(supabase) })"));
  assert.ok(stock.includes("neq(\"status\", CLIENT_STATUS.SALE_PAID)"));
  const keep = (status) => status;
  const result = aggregateStatusCounts(
    [{ status: "in_service", total: 5 }, { status: "restriction", total: 2 }, { status: "archived", total: 3 }],
    keep,
    [{ key: "all", statuses: [] }]
  );
  assert.equal(result.byGroup.all, 5);
  assert.equal(result.total, 10);
});
