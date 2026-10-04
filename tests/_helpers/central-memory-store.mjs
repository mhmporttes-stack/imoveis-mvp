// Store simulado da ponte para testes (mesma semantica das funcoes SQL + do UPDATE condicional de retomada).
// Nenhum teste que usa isto chama Claude, rede ou banco.
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../../lib/central/core.mjs";

export const CHATGPT = "c".repeat(40) + "-chatgpt-secret-aaaaaaaa";
export const EXECUTOR = "e".repeat(40) + "-executor-secret-bbbbbbb";
export const APPROVER = "a".repeat(40) + "-approver-secret-ccccccc";
const row = (role, secret, active = true) => ({ role, secret_sha256: sha256Hex(secret), active });
export const CREDS = [row("chatgpt", CHATGPT), row("executor", EXECUTOR), row("approver", APPROVER)];

export function memoryStore({ now = () => Date.now(), creds = CREDS } = {}) {
  const tasks = new Map();
  const iso = (ms) => new Date(ms).toISOString();
  let tick = 0;
  const touch = (t) => { t.updated_at = `${iso(now())}#${++tick}`; };
  const counters = new Map();
  return {
    tasks,
    async getCredentials() {
      if (creds === "erro") throw new Error("falha no banco");
      return creds;
    },
    async create(r) {
      if (r.idempotency_key) {
        for (const t of tasks.values()) if (t.origem === r.origem && t.idempotency_key === r.idempotency_key) return { task: t, created: false };
      }
      const t = { id: randomUUID(), attempts: 0, max_attempts: 3, resultado: null, erro: null, approved_at: null, decided_by: null, created_at: iso(now()), completed_at: null, locked_by: null, lease_expires_at: null, ...r };
      touch(t);
      tasks.set(t.id, t);
      return { task: t, created: true };
    },
    async get(id) {
      const t = tasks.get(id);
      return t ? structuredClone(t) : null;
    },
    async claim(worker, lease) {
      const t = [...tasks.values()].find((x) => x.status === "AGUARDANDO" && (["consulta", "eco"].includes(x.tipo) || x.approved_at));
      if (!t) return null;
      Object.assign(t, { status: "EM_EXECUCAO", attempts: t.attempts + 1, locked_by: worker, lease_expires_at: iso(now() + lease * 1000) });
      touch(t);
      return structuredClone(t);
    },
    async complete(id, worker, status, resultado, erro) {
      const t = tasks.get(id);
      if (!t || t.status !== "EM_EXECUCAO" || t.locked_by !== worker) return null;
      Object.assign(t, { status, resultado, erro, completed_at: iso(now()), locked_by: null, lease_expires_at: null });
      touch(t);
      return structuredClone(t);
    },
    async renew(id, worker, lease) {
      const t = tasks.get(id);
      if (!t || t.status !== "EM_EXECUCAO" || t.locked_by !== worker) return null;
      t.lease_expires_at = iso(now() + lease * 1000);
      return structuredClone(t);
    },
    async requeueOwn() {
      return 0;
    },
    // Igual a central_decide_task: unica transicao AGUARDANDO_DECISAO -> AGUARDANDO/ERRO (atomica).
    async decide(id, approve, by) {
      const t = tasks.get(id);
      if (!t || t.status !== "AGUARDANDO_DECISAO") return null;
      Object.assign(t, approve ? { status: "AGUARDANDO", approved_at: iso(now()) } : { status: "ERRO", erro: "Rejeitada na decisao.", completed_at: iso(now()) }, { decided_by: by });
      touch(t);
      return structuredClone(t);
    },
    // Igual ao UPDATE condicional do store Supabase.
    async resume(task, payload) {
      const t = tasks.get(task.id);
      if (!t || t.status !== "ERRO" || !t.approved_at || t.attempts !== task.attempts || t.updated_at !== task.updated_at) return null;
      Object.assign(t, { status: "AGUARDANDO", erro: null, completed_at: null, payload });
      touch(t);
      return structuredClone(t);
    },
    async list() {
      return [];
    },
    async rateLimit(key, _w, max) {
      const n = (counters.get(key) || 0) + 1;
      counters.set(key, n);
      return n <= max;
    }
  };
}

export const hdr = (token, extra = {}) => ({ get: (k) => ({ authorization: token ? `Bearer ${token}` : undefined, ...extra })[k.toLowerCase()] ?? null });
