// Ponte ChatGPT -> Central de Comando (fase 1): nucleo puro (sem Supabase/Next), testavel com store simulado.
// Todo texto vindo do ChatGPT e NAO CONFIAVEL: vira dado dentro de um envelope e nunca decide permissao.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_TEXT = 4000;
export const LEASE_SECONDS = 120;
export const AUTO_TYPES = ["consulta", "eco"]; // unicos tipos de execucao automatica
export const ROLES = ["chatgpt", "executor", "approver"];
const HEX64 = /^[0-9a-f]{64}$/;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const sanitizeText = (value) => String(value).replace(CONTROL_CHARS, "").trim();

const text = (max, min = 1) => z.string().transform(sanitizeText).pipe(z.string().min(min).max(max));
const workerId = z.string().regex(/^[A-Za-z0-9._-]{3,64}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const createSchema = z.strictObject({
  tipo: z.string().max(32).optional(),
  instruction_text: text(MAX_TEXT),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  origem: z.enum(["chatgpt", "smoke-test"]).optional()
});
export const claimSchema = z.strictObject({
  worker_id: workerId,
  lease_seconds: z.number().int().min(10).max(600).optional()
});
export const resultSchema = z.strictObject({
  worker_id: workerId,
  status: z.enum(["CONCLUIDA", "ERRO"]),
  resultado: text(8000, 0).optional(),
  erro: text(500, 0).optional()
});
export const renewSchema = z.strictObject({
  worker_id: workerId,
  lease_seconds: z.number().int().min(10).max(600).optional()
});
export const requeueSchema = z.strictObject({ worker_id: workerId });
export const decisionSchema = z.strictObject({
  decision: z.enum(["approve", "reject"]),
  decided_by: workerId.optional()
});

// O servidor decide o tipo: qualquer valor fora da lista automatica (ou ausencia) = "escrita".
export function normalizeTipo(raw) {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return AUTO_TYPES.includes(t) ? t : "escrita";
}

export function buildEnvelope(tipo, instructionText) {
  return { schema: 1, trust: "untrusted", source: "chatgpt", tipo, instruction_text: instructionText };
}

// A chave nunca e guardada: o banco so tem o SHA-256 (hex, 64 chars) de cada papel (tabela central_credentials).
export const sha256Hex = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");

const respond = (status, body) => ({ status, body });
const fail = (status, code, message) => respond(status, { ok: false, error: { code, message } });

// Retorna {ok:true} ou uma resposta de erro. Cookies/cabecalhos de admin nunca sao lidos.
// credentials: linhas de central_credentials [{role, secret_sha256, active}]. Falha fechado (503) sem linha ativa valida do papel.
export function authorize(headers, role, credentials) {
  const hashes = {};
  for (const row of Array.isArray(credentials) ? credentials : []) {
    const h = typeof row?.secret_sha256 === "string" ? row.secret_sha256.toLowerCase() : "";
    if (row?.active === true && ROLES.includes(row.role) && HEX64.test(h)) hashes[row.role] = h;
  }
  const present = Object.values(hashes);
  if (!hashes[role] || new Set(present).size !== present.length) {
    return fail(503, "central_indisponivel", "Ponte nao configurada.");
  }
  const auth = typeof headers.get === "function" ? headers.get("authorization") : headers.authorization;
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const bad = () => ({ ...fail(401, "nao_autorizado", "Credencial ausente ou invalida."), authFailure: true });
  if (!token) return bad();
  const given = Buffer.from(sha256Hex(token), "hex"); // comprimento fixo (32 bytes)
  let matched = null;
  for (const r of ROLES) {
    if (hashes[r] && timingSafeEqual(given, Buffer.from(hashes[r], "hex"))) matched = r;
  }
  if (!matched) return bad();
  if (matched !== role) {
    return { ...fail(403, "credencial_sem_permissao", "Esta credencial nao acessa este recurso."), authFailure: true };
  }
  return { ok: true };
}

function parseBody(raw, schema) {
  if (Buffer.byteLength(raw || "", "utf8") > MAX_BODY_BYTES) return { error: fail(413, "corpo_grande", "Corpo grande demais.") };
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return { error: fail(400, "json_invalido", "JSON invalido.") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || i.code))].slice(0, 5);
    return { error: fail(400, "payload_invalido", `Campos invalidos: ${fields.join(", ")}.`) };
  }
  return { data: parsed.data };
}

const publicView = (t) => ({
  task_id: t.id,
  status: t.status,
  tipo: t.tipo,
  origem: t.origem,
  resultado: t.resultado ?? null,
  erro: t.erro ?? null,
  created_at: t.created_at,
  completed_at: t.completed_at ?? null
});
const executorView = (t) => ({
  ...publicView(t),
  payload: t.payload,
  attempts: t.attempts,
  lease_expires_at: t.lease_expires_at
});

async function gate({ headers, ip, role, limitKey, limit, store }) {
  let credentials;
  try {
    credentials = await store.getCredentials();
  } catch {
    return fail(503, "central_indisponivel", "Ponte nao configurada.");
  }
  const auth = authorize(headers, role, credentials);
  if (!auth.ok) {
    if (auth.authFailure) {
      const allowed = await store.rateLimit(`central:authfail:${ip || "local"}`, 60, 10);
      if (!allowed) return fail(429, "muitas_tentativas", "Muitas tentativas. Aguarde.");
    }
    return auth;
  }
  if (!(await store.rateLimit(`central:${limitKey}`, 60, limit))) {
    return fail(429, "limite_excedido", "Limite por minuto excedido.");
  }
  return null;
}

export function createHandlers({ store }) {
  const run = (fn) => async (ctx) => {
    try {
      return await fn(ctx);
    } catch {
      return fail(500, "erro_interno", "Erro interno.");
    }
  };
  const g = (ctx, role, key, limit) => gate({ ...ctx, role, limitKey: key, limit, store });
  const badId = (id) => (uuid.safeParse(id).success ? null : fail(400, "id_invalido", "task_id invalido."));

  return {
    createTask: run(async (ctx) => {
      const denied = await g(ctx, "chatgpt", "create", 30);
      if (denied) return denied;
      const { data, error } = parseBody(ctx.rawBody, createSchema);
      if (error) return error;
      const tipo = normalizeTipo(data.tipo);
      const { task, created } = await store.create({
        origem: data.origem || "chatgpt",
        tipo,
        status: AUTO_TYPES.includes(tipo) ? "AGUARDANDO" : "AGUARDANDO_DECISAO",
        payload: buildEnvelope(tipo, data.instruction_text),
        idempotency_key: data.idempotency_key || null
      });
      return respond(created ? 201 : 200, { ok: true, idempotent_replay: !created, ...publicView(task) });
    }),

    getTask: run(async (ctx) => {
      const denied = await g(ctx, "chatgpt", "status", 120);
      if (denied) return denied;
      const bad = badId(ctx.id);
      if (bad) return bad;
      const task = await store.get(ctx.id);
      if (!task) return fail(404, "nao_encontrada", "Tarefa nao encontrada.");
      return respond(200, { ok: true, ...publicView(task) });
    }),

    claim: run(async (ctx) => {
      const denied = await g(ctx, "executor", "executor", 120);
      if (denied) return denied;
      const { data, error } = parseBody(ctx.rawBody, claimSchema);
      if (error) return error;
      const task = await store.claim(data.worker_id, data.lease_seconds || LEASE_SECONDS);
      return respond(200, { ok: true, task: task ? executorView(task) : null });
    }),

    result: run(async (ctx) => {
      const denied = await g(ctx, "executor", "executor", 120);
      if (denied) return denied;
      const bad = badId(ctx.id);
      if (bad) return bad;
      const { data, error } = parseBody(ctx.rawBody, resultSchema);
      if (error) return error;
      const task = await store.complete(ctx.id, data.worker_id, data.status, data.resultado ?? null, data.erro ?? null);
      if (!task) return fail(409, "lease_invalido", "Tarefa nao esta em execucao por este executor.");
      return respond(200, { ok: true, ...publicView(task) });
    }),

    renew: run(async (ctx) => {
      const denied = await g(ctx, "executor", "executor", 120);
      if (denied) return denied;
      const bad = badId(ctx.id);
      if (bad) return bad;
      const { data, error } = parseBody(ctx.rawBody, renewSchema);
      if (error) return error;
      const task = await store.renew(ctx.id, data.worker_id, data.lease_seconds || LEASE_SECONDS);
      if (!task) return fail(409, "lease_invalido", "Tarefa nao esta em execucao por este executor.");
      return respond(200, { ok: true, lease_expires_at: task.lease_expires_at });
    }),

    requeue: run(async (ctx) => {
      const denied = await g(ctx, "executor", "executor", 120);
      if (denied) return denied;
      const { data, error } = parseBody(ctx.rawBody, requeueSchema);
      if (error) return error;
      return respond(200, { ok: true, requeued: await store.requeueOwn(data.worker_id) });
    }),

    decide: run(async (ctx) => {
      const denied = await g(ctx, "approver", "approver", 30);
      if (denied) return denied;
      const bad = badId(ctx.id);
      if (bad) return bad;
      const { data, error } = parseBody(ctx.rawBody, decisionSchema);
      if (error) return error;
      const task = await store.decide(ctx.id, data.decision === "approve", data.decided_by || "approver");
      if (!task) return fail(409, "estado_invalido", "Tarefa nao esta aguardando decisao.");
      return respond(200, { ok: true, ...publicView(task) });
    })
  };
}
