// Supabase falso, em memória, só com o que o Chat do WhatsApp usa — para testar
// a identidade da conversa (telefone + sessão) sem rede. Reproduz as travas do
// banco que importam: UNIQUE(contact_phone, session_key) nas conversas e o
// índice do dedupe do WhatsApp pessoal. `uniqueMode: "legacy"` reproduz o banco
// ANTIGO (UNIQUE(contact_phone) e wa_message_id global) para provar o bug.
import { randomUUID } from "node:crypto";

export const NIL = "00000000-0000-0000-0000-000000000000";

function getPath(row, path) {
  if (path.includes("->>")) {
    const [col, key] = path.split("->>");
    return row?.[col]?.[key];
  }
  if (path.startsWith("scope.")) return row?.scope?.[path.slice(6)];
  return row?.[path];
}

function parseList(text) {
  return String(text).replace(/^\(|\)$/g, "").split(",").map((v) => v.trim()).filter(Boolean);
}

function matchOrClause(row, clause) {
  // "col.op.value" separados por vírgula (nível raso, como o app usa)
  return String(clause).split(/,(?![^()]*\))/).some((part) => {
    const [col, op, ...rest] = part.split(".");
    const value = rest.join(".");
    const cell = getPath(row, col);
    if (op === "is") return value === "null" ? cell == null : String(cell) === value;
    if (op === "in") return parseList(value).includes(String(cell));
    if (op === "eq") return String(cell) === value;
    if (op === "ilike") return String(cell ?? "").toLowerCase().includes(value.replace(/%/g, "").toLowerCase());
    if (op === "gt") return Number(cell) > Number(value);
    return false;
  });
}

export function createFakeSupabase({ uniqueMode = "session" } = {}) {
  const tables = { whatsapp_conversations: [], whatsapp_messages: [], simulation_registrations: [], admin_users: [] };
  const state = { tables, rpcCalls: [] };
  const table = (name) => (tables[name] ??= []);

  // Dois números por corretor (2026-10-08): a conversa é (telefone, sessão, número 1/2).
  const conversationUnique = uniqueMode === "legacy" ? ["contact_phone"] : ["contact_phone", "session_key", "session_slot"];
  const messageIndividualUnique = (a, b) => (uniqueMode === "legacy"
    ? a.metadata?.wa_message_id && a.metadata.wa_message_id === b.metadata?.wa_message_id
    : a.metadata?.wa_message_id && a.metadata.wa_message_id === b.metadata?.wa_message_id && a.session_user_id === b.session_user_id);
  // ON CONFLICT aceito pelo banco atual (índice novo da parte 1 de 20261008160000).
  const conversationConflictTargets = uniqueMode === "legacy" ? [["contact_phone"]] : [["contact_phone", "session_key", "session_slot"]];

  function conflict(table, rows, candidate, ignoreId) {
    return rows.find((row) => {
      if (row.id === ignoreId) return false;
      if (table === "whatsapp_conversations") return conversationUnique.every((col) => row[col] === candidate[col]);
      if (table === "whatsapp_messages") {
        if (candidate.meta_message_id && row.meta_message_id === candidate.meta_message_id) return true;
        if (candidate.channel === "whatsapp_individual" && row.channel === "whatsapp_individual") return messageIndividualUnique(row, candidate);
      }
      return false;
    });
  }

  function withDefaults(table, row) {
    const now = new Date().toISOString();
    const base = { id: randomUUID(), created_at: now };
    if (table === "whatsapp_conversations") {
      return { ...base, status: "open", unread_count: 0, origin: {}, session_key: NIL, session_slot: 1, assigned_user_id: null, client_id: null, deleted_at: null, last_message_at: null, last_message_preview: null, last_message_direction: null, last_inbound_at: null, account_channel: null, account_user_id: null, updated_at: now, ...row };
    }
    if (table === "whatsapp_messages") {
      return { ...base, channel: "whatsapp_cloud_api", session_user_id: null, session_slot: 1, metadata: {}, status: "received", meta_message_id: null, message_at: now, sender_user_id: null, ...row };
    }
    return { ...base, ...row };
  }

  class Query {
    constructor(table) {
      this.table = table; this.op = "select"; this.filters = []; this.orders = []; this.limitN = null;
      this.cols = "*"; this.payload = null; this.returning = false; this.opts = {}; this.expect = null;
    }
    select(cols = "*") { this.cols = cols; if (this.op !== "select") this.returning = true; return this; }
    insert(payload) { this.op = "insert"; this.payload = payload; return this; }
    upsert(payload, opts = {}) { this.op = "upsert"; this.payload = payload; this.opts = opts; return this; }
    update(payload) { this.op = "update"; this.payload = payload; return this; }
    delete() { this.op = "delete"; return this; }
    eq(col, val) { this.filters.push((r) => getPath(r, col) === val); return this; }
    neq(col, val) { this.filters.push((r) => getPath(r, col) !== val); return this; }
    in(col, arr) { this.filters.push((r) => (arr || []).includes(getPath(r, col))); return this; }
    is(col, val) { this.filters.push((r) => (val === null ? getPath(r, col) == null : getPath(r, col) === val)); return this; }
    gt(col, val) { this.filters.push((r) => getPath(r, col) > val); return this; }
    gte(col, val) { this.filters.push((r) => getPath(r, col) >= val); return this; }
    lt(col, val) { this.filters.push((r) => getPath(r, col) < val); return this; }
    not(col, op, val) {
      this.filters.push((r) => {
        const cell = getPath(r, col);
        if (op === "is") return val === null ? cell != null : cell !== val;
        if (op === "in") return !parseList(val).includes(String(cell));
        return true;
      });
      return this;
    }
    or(clause) { this.filters.push((r) => matchOrClause(r, clause)); return this; }
    order(col, { ascending = true } = {}) { this.orders.push({ col, ascending }); return this; }
    limit(n) { this.limitN = n; return this; }
    maybeSingle() { this.expect = "maybe"; return this; }
    single() { this.expect = "single"; return this; }

    rows() {
      let rows = table(this.table).map((row) => ({ ...row }));
      const embed = /scope:simulation_registrations/.test(this.cols);
      if (embed) {
        rows = rows
          .map((row) => ({ ...row, scope: tables.simulation_registrations.find((reg) => reg.id === row.client_id) || null }))
          .filter((row) => row.scope);
      }
      if (/whatsapp_conversations!inner/.test(this.cols)) {
        rows = rows
          .map((row) => ({ ...row, whatsapp_conversations: table("whatsapp_conversations").find((c) => c.id === row.conversation_id) || null }))
          .filter((row) => row.whatsapp_conversations);
      }
      for (const filter of this.filters) rows = rows.filter(filter);
      for (const { col, ascending } of [...this.orders].reverse()) {
        rows.sort((a, b) => {
          const x = getPath(a, col); const y = getPath(b, col);
          if (x == null && y == null) return 0;
          if (x == null) return ascending ? -1 : 1;
          if (y == null) return ascending ? 1 : -1;
          return (x > y ? 1 : x < y ? -1 : 0) * (ascending ? 1 : -1);
        });
      }
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      return rows;
    }

    run() {
      const store = table(this.table);
      let affected = [];
      let error = null;
      if (this.op === "select") {
        affected = this.rows();
      } else if (this.op === "insert" || this.op === "upsert") {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        if (this.op === "upsert") {
          const wanted = String(this.opts.onConflict || "").split(",").map((c) => c.trim()).filter(Boolean);
          if (this.table === "whatsapp_conversations" && !conversationConflictTargets.some((target) => target.join() === wanted.join())) {
            return { data: null, error: { code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" } };
          }
        }
        for (const raw of list) {
          const row = withDefaults(this.table, raw);
          const clash = conflict(this.table, store, row);
          if (clash) {
            if (this.op === "upsert" && this.opts.ignoreDuplicates) continue;
            if (this.op === "upsert") { Object.assign(clash, raw); affected.push({ ...clash }); continue; }
            error = { code: "23505", message: "duplicate key value violates unique constraint" };
            break;
          }
          store.push(row);
          affected.push({ ...row });
        }
      } else if (this.op === "update") {
        for (const live of store) {
          const view = this.table === "whatsapp_conversations" && /scope:/.test(this.cols) ? live : live;
          if (!this.filters.every((f) => f(view))) continue;
          const next = { ...live, ...this.payload };
          const clash = conflict(this.table, store, next, live.id);
          if (clash) { error = { code: "23505", message: "duplicate key value violates unique constraint" }; break; }
          Object.assign(live, this.payload);
          affected.push({ ...live });
        }
      } else if (this.op === "delete") {
        for (let i = store.length - 1; i >= 0; i -= 1) if (this.filters.every((f) => f(store[i]))) affected.push(...store.splice(i, 1));
      }
      if (error) return { data: null, error };
      if (this.op !== "select" && !this.returning) return { data: null, error: null };
      if (this.expect === "single") return affected.length === 1 ? { data: affected[0], error: null } : { data: null, error: { code: "PGRST116", message: "single row expected" } };
      if (this.expect === "maybe") {
        if (affected.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
        return { data: affected[0] || null, error: null };
      }
      return { data: affected, error: null };
    }
    then(resolve, reject) { try { resolve(this.run()); } catch (e) { reject?.(e); } }
  }

  const client = {
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      state.rpcCalls.push({ name, args });
      const conv = (id) => tables.whatsapp_conversations.find((c) => c.id === id);
      if (name === "whatsapp_chat_apply_inbound") {
        const c = conv(args.p_conversation_id);
        const newer = !c.last_message_at || args.p_at >= c.last_message_at;
        Object.assign(c, {
          unread_count: c.unread_count + Math.max(args.p_count, 0),
          last_message_preview: newer ? args.p_preview : c.last_message_preview,
          last_message_direction: newer ? "inbound" : c.last_message_direction,
          last_message_at: newer ? args.p_at : c.last_message_at,
          last_inbound_at: args.p_at,
          contact_name: c.contact_name || args.p_name || null,
          client_id: c.client_id || args.p_client_id || null
        });
      } else if (name === "whatsapp_chat_apply_outbound") {
        const c = conv(args.p_conversation_id);
        const newer = !c.last_message_at || args.p_at >= c.last_message_at;
        Object.assign(c, {
          last_message_preview: newer ? args.p_preview : c.last_message_preview,
          last_message_direction: newer ? "outbound" : c.last_message_direction,
          last_message_at: newer ? args.p_at : c.last_message_at,
          status: args.p_mark_in_service && c.status === "open" ? "in_service" : c.status
        });
      } else if (name === "whatsapp_get_or_create_client_for_broker") {
        const existing = tables.simulation_registrations.find((r) => args.p_candidates.includes(r.phone_normalized));
        const registration = existing || (() => { const r = withDefaults("simulation_registrations", { full_name: args.p_full_name, phone: args.p_phone, phone_normalized: args.p_phone_normalized, responsible_user_id: args.p_broker_id }); tables.simulation_registrations.push(r); return r; })();
        const c = conv(args.p_conversation_id);
        if (c && !c.client_id) c.client_id = registration.id;
        if (c && !c.assigned_user_id) c.assigned_user_id = registration.responsible_user_id;
      }
      return { data: null, error: null };
    }
  };
  return { client, state, tables };
}
