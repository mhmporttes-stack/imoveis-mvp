import { test } from "node:test";
import assert from "node:assert/strict";
import { countFirstSalesInRange, findFirstSaleEntries } from "../lib/sales-count-core.mjs";
import { CLIENT_FUNNEL_SALE_STATUSES } from "../lib/client-status.js";

const isSale = (status) => CLIENT_FUNNEL_SALE_STATUSES.has(status);
const SEPTEMBER = { startIso: "2026-09-01T03:00:00.000Z", endIso: "2026-10-01T03:00:00.000Z" };
const OCTOBER = { startIso: "2026-10-01T03:00:00.000Z", endIso: "2026-11-01T03:00:00.000Z" };
const brokers = new Map([["c1", "b1"], ["c2", "b2"]]);

// VENDA (28/09) → CONFORMIDADE (02/10) → CARTÓRIO (05/10)
const history = [
  { client_id: "c1", new_status: "approved", changed_at: "2026-09-20T15:00:00Z" },
  { client_id: "c1", new_status: "sale_completed", changed_at: "2026-09-28T15:00:00Z" },
  { client_id: "c1", new_status: "sale_compliance", changed_at: "2026-10-02T15:00:00Z" },
  { client_id: "c1", new_status: "sale_registry", changed_at: "2026-10-05T15:00:00Z" }
];

test("VENDA → CONFORMIDADE → CARTÓRIO = exatamente 1 venda, na data original da VENDA", () => {
  const first = findFirstSaleEntries(history, isSale);
  assert.equal(first.size, 1);
  assert.equal(first.get("c1"), new Date("2026-09-28T15:00:00Z").getTime());

  const september = countFirstSalesInRange(first, SEPTEMBER, brokers);
  assert.equal(september.total, 1);
  assert.deepEqual([...september.perBroker], [["b1", 1]]);
});

test("mudança de mês: setembro +1, outubro 0 novas vendas desse cliente", () => {
  const first = findFirstSaleEntries(history, isSale);
  assert.equal(countFirstSalesInRange(first, SEPTEMBER, brokers).total, 1);
  const october = countFirstSalesInRange(first, OCTOBER, brokers);
  assert.equal(october.total, 0);
  assert.equal(october.perBroker.size, 0);
});

test("a ordem das linhas não muda a data: vale sempre a mais antiga", () => {
  const first = findFirstSaleEntries([...history].reverse(), isSale);
  assert.equal(first.get("c1"), new Date("2026-09-28T15:00:00Z").getTime());
});

test("ir e voltar (venda → aprovado → venda) não cria segunda venda nem muda a data", () => {
  const rows = [
    { client_id: "c1", new_status: "sale_completed", changed_at: "2026-09-28T15:00:00Z" },
    { client_id: "c1", new_status: "approved", changed_at: "2026-09-29T15:00:00Z" },
    { client_id: "c1", new_status: "sale_completed", changed_at: "2026-10-03T15:00:00Z" }
  ];
  const first = findFirstSaleEntries(rows, isSale);
  assert.equal(countFirstSalesInRange(first, SEPTEMBER).total, 1);
  assert.equal(countFirstSalesInRange(first, OCTOBER).total, 0);
});

test("a primeira entrada pode ser direto num status pós-venda (ex.: Conformidade)", () => {
  const rows = [{ client_id: "c2", new_status: "sale_compliance", changed_at: "2026-10-04T12:00:00Z" }];
  const first = findFirstSaleEntries(rows, isSale);
  assert.equal(countFirstSalesInRange(first, SEPTEMBER, brokers).total, 0);
  const october = countFirstSalesInRange(first, OCTOBER, brokers);
  assert.equal(october.total, 1);
  assert.deepEqual([...october.perBroker], [["b2", 1]]);
});

test("status fora de Venda e linhas sem data/cliente não contam", () => {
  const rows = [
    { client_id: "c1", new_status: "approved", changed_at: "2026-09-20T15:00:00Z" },
    { client_id: "c1", new_status: "sale_completed", changed_at: null },
    { client_id: "", new_status: "sale_completed", changed_at: "2026-09-20T15:00:00Z" }
  ];
  assert.equal(findFirstSaleEntries(rows, isSale).size, 0);
});

test("limites do período: início inclusivo, fim exclusivo", () => {
  const first = new Map([["c1", new Date(SEPTEMBER.endIso).getTime()]]);
  assert.equal(countFirstSalesInRange(first, SEPTEMBER).total, 0);
  assert.equal(countFirstSalesInRange(first, OCTOBER).total, 1);
});
