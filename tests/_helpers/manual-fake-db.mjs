// Banco simulado em memória (subconjunto do query builder do Supabase) — só para testes do Manual.
const UNIQUE = {
  manual_topics: [["slug"]], manual_sections: [["topic_id", "slug"]], manual_news: [["slug"]],
  manual_section_versions: [["section_id", "version"]], manual_news_reads: [["news_id", "user_id"]]
};
const DEFAULTS = {
  manual_topics: { audiences: ["all"], status: "draft", description: "", icon: "", sort_order: 0, updated_at: null },
  manual_sections: { audiences: ["all"], status: "draft", body: "", sort_order: 0, published_version_id: null, last_updated_at: null },
  manual_news: { audiences: ["all"], status: "draft", body: "", important: false, requires_ack: false, badge_until: null, suggested_section_id: null, suggested_body: null, published_at: null }
};

export function createFakeDb(initial = {}) {
  const tables = {
    manual_topics: [], manual_sections: [], manual_news: [], manual_section_versions: [], manual_news_reads: [], admin_users: [],
    ...initial
  };
  const writes = [];
  let counter = 0;
  const uid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function from(table) {
    const state = { op: "select", filters: [], patch: null, rows: null, opts: null, single: null };
    const rows = () => tables[table];
    const matches = (row) => state.filters.every((f) => (f.type === "eq" ? row[f.col] === f.val : f.vals.includes(row[f.col])));
    const conflict = (row) => (UNIQUE[table] || []).some((cols) => rows().some((r) => cols.every((c) => r[c] === row[c])));
    const insertRow = (input) => {
      const row = { ...(DEFAULTS[table] || {}), ...clone(input) };
      if (!row.id && table !== "manual_news_reads" && table !== "admin_users") row.id = uid();
      if (conflict(row)) return { error: { code: "23505", message: "duplicate" } };
      rows().push(row);
      writes.push({ table, op: "insert", row: clone(row) });
      return { row };
    };
    function execute() {
      if (state.op === "select") {
        const data = rows().filter(matches).map(clone);
        if (state.single === "maybe") return { data: data[0] || null, error: null };
        if (state.single === "one") return data[0] ? { data: data[0], error: null } : { data: null, error: { message: "no rows" } };
        return { data, error: null };
      }
      if (state.op === "insert") {
        const out = [];
        for (const input of [].concat(state.rows)) {
          const r = insertRow(input);
          if (r.error) return { data: null, error: r.error };
          out.push(clone(r.row));
        }
        return { data: state.single ? out[0] : out, error: null };
      }
      if (state.op === "update") {
        const hit = rows().filter(matches);
        hit.forEach((r) => { Object.assign(r, clone(state.patch)); writes.push({ table, op: "update", patch: clone(state.patch) }); });
        const data = hit.map(clone);
        return { data: state.single ? data[0] || null : data, error: null };
      }
      if (state.op === "upsert") {
        const cols = String(state.opts?.onConflict || "id").split(",");
        for (const input of [].concat(state.rows)) {
          const found = rows().find((r) => cols.every((c) => r[c] === input[c]));
          if (found) { if (!state.opts?.ignoreDuplicates) Object.assign(found, clone(input)); continue; }
          const r = insertRow(input);
          if (r.error) return { data: null, error: r.error };
        }
        return { data: null, error: null };
      }
      return { data: null, error: { message: "op" } };
    }
    const b = {
      select() { return b; },
      eq(col, val) { state.filters.push({ type: "eq", col, val }); return b; },
      in(col, vals) { state.filters.push({ type: "in", col, vals }); return b; },
      order() { return b; }, limit() { return b; },
      single() { state.single = state.op === "select" ? "one" : true; return b; },
      maybeSingle() { state.single = state.op === "select" ? "maybe" : true; return b; },
      insert(r) { state.op = "insert"; state.rows = r; return b; },
      update(p) { state.op = "update"; state.patch = p; return b; },
      upsert(r, opts) { state.op = "upsert"; state.rows = r; state.opts = opts; return b; },
      then(res, rej) { return Promise.resolve().then(execute).then(res, rej); }
    };
    return b;
  }
  return { from, tables, writes };
}
