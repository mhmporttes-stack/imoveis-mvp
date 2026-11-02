// Supabase falso, em memória, só com o que o Lote de SMS usa (select/insert/update/delete encadeados, in/eq/is/not/gt/lte,
// order/range/limit/single/maybeSingle, count). Reproduz as travas do banco que importam ao Lote: chave primária de
// sms_batch_reservations (um contato = um corretor) e o índice único campaigns_sms_batch_broker_unique.
// Carregado como módulo único (o loader troca lib/supabase por ele); os dados vivem em `DB`.
import { randomUUID } from "node:crypto";

export const DB = {};
export const hasSupabaseAdminConfig = true;
export const hasSupabasePublicConfig = true;

// Consultas feitas por tabela desde o último resetDb (prova de que a tela não dispara centenas de consultas).
export const stats = { total: 0, byTable: {} };

export function resetDb(seed = {}) {
  for (const key of Object.keys(DB)) delete DB[key];
  Object.assign(DB, seed);
  stats.total = 0;
  stats.byTable = {};
}

export function getSupabaseAdminClient() {
  return { from: (table) => new Query(table) };
}
export const getSupabasePublicClient = getSupabaseAdminClient;

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.sorts = [];
    this.op = "select";
  }
  select(_cols, options) { if (options?.count) this.count = true; return this; }
  insert(values) { this.op = "insert"; this.values = values; return this; }
  update(values) { this.op = "update"; this.values = values; return this; }
  upsert(values) { this.op = "upsert"; this.values = values; return this; }
  delete() { this.op = "delete"; return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  neq(column, value) { this.filters.push((row) => row[column] !== value); return this; }
  is(column, value) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  gt(column, value) { this.filters.push((row) => row[column] > value); return this; }
  gte(column, value) { this.filters.push((row) => row[column] >= value); return this; }
  lte(column, value) { this.filters.push((row) => row[column] <= value); return this; }
  not(column, operator, value) {
    if (operator === "in") {
      const list = String(value).replace(/[()]/g, "").split(",").filter(Boolean);
      this.filters.push((row) => !list.includes(row[column]));
    } else if (operator === "is") this.filters.push((row) => (row[column] ?? null) !== value);
    return this;
  }
  order(column, { ascending = true } = {}) { this.sorts.push([column, ascending]); return this; }
  range(from, to) { this.window = [from, to + 1]; return this; }
  limit(count) { this.max = count; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "one"; return this; }
  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }

  run() {
    stats.total += 1;
    stats.byTable[this.table] = (stats.byTable[this.table] || 0) + 1;
    const rows = (DB[this.table] ??= []);
    const matched = rows.filter((row) => this.filters.every((test) => test(row)));
    let out;
    if (this.op === "insert") {
      const created = (Array.isArray(this.values) ? this.values : [this.values]).map((value) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...value }));
      for (const row of created) {
        const clash = (this.table === "campaigns" && row.broker_id && rows.some((other) => other.broker_id === row.broker_id && other.name === row.name && other.kind === row.kind && !other.deleted_at))
          || (this.table === "sms_batch_reservations" && rows.some((other) => other.contact_id === row.contact_id));
        if (clash) return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      rows.push(...created);
      out = created;
    } else if (this.op === "update") {
      matched.forEach((row) => Object.assign(row, this.values));
      out = matched;
    } else if (this.op === "upsert") {
      out = [];
    } else if (this.op === "delete") {
      DB[this.table] = rows.filter((row) => !matched.includes(row));
      out = matched;
    } else {
      out = [...matched];
      for (const [column, ascending] of [...this.sorts].reverse()) {
        out.sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1));
      }
    }
    if (this.count && this.op === "select") return { data: null, count: out.length, error: null };
    if (this.window) out = out.slice(this.window[0], this.window[1]);
    if (this.max != null) out = out.slice(0, this.max);
    if (this.singleMode) {
      if (out.length) return { data: out[0], error: null };
      return this.singleMode === "one" ? { data: null, error: { code: "PGRST116", message: "no rows" } } : { data: null, error: null };
    }
    return { data: out, error: null };
  }
}
