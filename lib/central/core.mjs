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
// listarTarefas (somente leitura). Query string: so digitos/enum; qualquer coisa fora disso = 400.
export const LIST_DEFAULT_LIMIT = 10;
export const LIST_MAX_LIMIT = 50;
export const LIST_MAX_HOURS = 24 * 365;
export const LIST_SUMMARY_CHARS = 200;
const STATUSES = ["AGUARDANDO", "EM_EXECUCAO", "AGUARDANDO_DECISAO", "CONCLUIDA", "ERRO"];
const intParam = (min, max) =>
  z.string().regex(/^\d{1,5}$/).transform(Number).pipe(z.number().int().min(min).max(max));
export const listSchema = z.strictObject({
  status: z.enum(STATUSES).optional(),
  tipo: z.enum(["consulta", "escrita", "eco"]).optional(),
  limite: intParam(1, LIST_MAX_LIMIT).optional(),
  horas: intParam(1, LIST_MAX_HOURS).optional(),
  ordenar_por: z.enum(["created_at", "updated_at"]).optional()
});

// Rota legada do aprovador: {decision}. Quem decidiu NUNCA vem do corpo: o servidor grava o papel da credencial.
export const decisionSchema = z.strictObject({
  decision: z.enum(["approve", "reject"])
});
// aprovarTarefa/rejeitarTarefa/retomarTarefa: sem campos (o task_id vai no caminho).
export const emptySchema = z.strictObject({});
// Papeis que podem decidir (aprovar/rejeitar): `chatgpt` (operacao MCP pedida pelo dono) e `approver`.
// Retomar e so do `approver`.
export const DECIDER_ROLES = ["chatgpt", "approver"];

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

// Retorna {ok:true, role} ou uma resposta de erro. Cookies/cabecalhos de admin nunca sao lidos.
// credentials: linhas de central_credentials [{role, secret_sha256, active}]. Falha fechado (503) sem linha ativa valida do papel.
// `role` pode ser um papel ou uma lista de papeis aceitos; o `role` devolvido e o da credencial usada (auditoria).
export function authorize(headers, role, credentials) {
  const accepted = Array.isArray(role) ? role : [role];
  const hashes = {};
  for (const row of Array.isArray(credentials) ? credentials : []) {
    const h = typeof row?.secret_sha256 === "string" ? row.secret_sha256.toLowerCase() : "";
    if (row?.active === true && ROLES.includes(row.role) && HEX64.test(h)) hashes[row.role] = h;
  }
  const present = Object.values(hashes);
  if (!accepted.some((r) => hashes[r]) || new Set(present).size !== present.length) {
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
  if (!accepted.includes(matched)) {
    return { ...fail(403, "credencial_sem_permissao", "Esta credencial nao acessa este recurso."), authFailure: true };
  }
  return { ok: true, role: matched };
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
const truncate = (value, max) => {
  const str = typeof value === "string" ? sanitizeText(value) : "";
  return str.length > max ? { text: `${str.slice(0, max)}...`, truncated: true } : { text: str, truncated: false };
};
// Allowlist explicita: nada alem destes campos sai na listagem (sem payload bruto, resultado completo,
// idempotency_key, attempts, lease, decided_by, locked_*). instruction_text e dado NAO CONFIAVEL: so string truncada.
const listItemView = (t) => {
  const summary = truncate(t?.payload?.instruction_text, LIST_SUMMARY_CHARS);
  const err = t.erro ? truncate(t.erro, LIST_SUMMARY_CHARS) : null;
  return {
    task_id: t.id,
    status: t.status,
    tipo: t.tipo,
    origem: t.origem,
    executor: typeof t.locked_by === "string" && t.locked_by ? t.locked_by.slice(0, 64) : null,
    instruction_summary: summary.text,
    instruction_truncated: summary.truncated,
    created_at: t.created_at,
    updated_at: t.updated_at ?? null,
    completed_at: t.completed_at ?? null,
    has_result: typeof t.resultado === "string" && t.resultado.length > 0,
    awaiting_decision: t.status === "AGUARDANDO_DECISAO",
    error_summary: err ? err.text : null,
    error_truncated: err ? err.truncated : false
  };
};
const executorView = (t) => ({
  ...publicView(t),
  payload: t.payload,
  attempts: t.attempts,
  lease_expires_at: t.lease_expires_at,
  // Para o executor REVALIDAR a aprovacao no momento de executar (nunca confiar so no tipo do envelope).
  approved_at: t.approved_at ?? null,
  decided_by: t.decided_by ?? null
});

export const auditEvents = (t) => (Array.isArray(t?.payload?.audit) ? t.payload.audit : []);
// Resposta das operacoes de decisao/retomada: estado + auditoria minima (quem/quando). Sem payload.
const decisionView = (t) => ({
  ...publicView(t),
  approved_at: t.approved_at ?? null,
  decided_by: t.decided_by ?? null,
  resume_count: auditEvents(t).filter((e) => e?.event === "resume").length
});

// Maquina de estados da decisao (so em AGUARDANDO_DECISAO; o resto e idempotente ou 409).
//  aprovar: AGUARDANDO_DECISAO -> AGUARDANDO (approved_at, decided_by). Repetir em tarefa ja aprovada e ainda na fila = estado atual, sem efeito.
//  rejeitar: AGUARDANDO_DECISAO -> ERRO (sem approved_at, com decided_by). Repetir em tarefa rejeitada = estado atual, sem efeito.
//  qualquer outra combinacao (rejeitada/concluida/em execucao/consulta...) = 409.
export const isRejected = (t) => t?.status === "ERRO" && !t.approved_at && Boolean(t.decided_by);
export const isApprovedQueued = (t) =>
  t?.status === "AGUARDANDO" && t.tipo === "escrita" && Boolean(t.approved_at) && Boolean(t.decided_by);
export function classifyDecision(task, approve) {
  if (approve && isApprovedQueued(task)) return "replay";
  if (!approve && isRejected(task)) return "replay";
  return "conflict";
}
// Retomada (so `approver`): ERRO com approved_at (ja aprovada pelo canal) e tentativas sobrando -> AGUARDANDO.
// Repetir em tarefa ja retomada e ainda na fila = estado atual, sem efeito.
export const isResumable = (t) =>
  t?.status === "ERRO" && t.tipo === "escrita" && Boolean(t.approved_at) && Boolean(t.decided_by) &&
  Number(t.attempts) < Number(t.max_attempts);
export const isResumedQueued = (t) =>
  isApprovedQueued(t) && auditEvents(t).some((e) => e?.event === "resume");

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
  return { granted: true, role: auth.role };
}

export function createHandlers({ store }) {
  const run = (fn) => async (ctx) => {
    try {
      return await fn(ctx);
    } catch {
      return fail(500, "erro_interno", "Erro interno.");
    }
  };
  // g: null = liberado; resposta = negado. gRole: {role} = liberado (papel da credencial usada, para auditoria); resposta = negado.
  const g = async (ctx, role, key, limit) => {
    const r = await gate({ ...ctx, role, limitKey: key, limit, store });
    return r?.granted ? null : r;
  };
  const gRole = (ctx, roles, key, limit) => gate({ ...ctx, role: roles, limitKey: key, limit, store });
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

    // Somente leitura. Nunca devolve o resultado completo (isso e verResultado) nem campos internos.
    listTasks: run(async (ctx) => {
      const denied = await g(ctx, "chatgpt", "list", 60);
      if (denied) return denied;
      const parsed = listSchema.safeParse(ctx.query && typeof ctx.query === "object" ? ctx.query : {});
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.flatMap((i) => (i.path.length ? [String(i.path[0])] : [])))].slice(0, 5);
        return fail(400, "parametros_invalidos", `Parametros invalidos${fields.length ? `: ${fields.join(", ")}` : ""}.`);
      }
      const q = parsed.data;
      const limit = q.limite ?? LIST_DEFAULT_LIMIT;
      const orderBy = q.ordenar_por || "created_at";
      const rows = await store.list({ status: q.status, tipo: q.tipo, limit, hours: q.horas, orderBy });
      const tasks = (Array.isArray(rows) ? rows : []).slice(0, limit).map(listItemView);
      return respond(200, { ok: true, count: tasks.length, limit, order: `${orderBy} desc`, tasks });
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

    // Rota legada do aprovador (so credencial `approver`): mesma maquina de estados de aprovarTarefa/rejeitarTarefa.
    decide: run(async (ctx) => {
      const denied = await g(ctx, "approver", "approver", 30);
      if (denied) return denied;
      const bad = badId(ctx.id);
      if (bad) return bad;
      const { data, error } = parseBody(ctx.rawBody, decisionSchema);
      if (error) return error;
      return applyDecision(ctx.id, data.decision === "approve", "approver");
    }),

    // aprovarTarefa / rejeitarTarefa: credencial `chatgpt` (operacao MCP) OU `approver`. decided_by = papel da credencial.
    approveTask: run((ctx) => decideAs(ctx, true)),
    rejectTask: run((ctx) => decideAs(ctx, false)),

    // retomarTarefa: so `approver` (nunca `chatgpt`). ERRO ja aprovada -> AGUARDANDO; preserva task_id/approved_at/decided_by.
    resumeTask: run(async (ctx) => {
      const denied = await g(ctx, "approver", "approver", 30);
      if (denied) return denied;
      const bad = badId(ctx.id);
      if (bad) return bad;
      const { error } = parseBody(ctx.rawBody, emptySchema);
      if (error) return error;
      const task = await store.get(ctx.id);
      if (!task) return fail(404, "nao_encontrada", "Tarefa nao encontrada.");
      if (isResumedQueued(task)) return respond(200, { ok: true, idempotent_replay: true, ...decisionView(task) });
      if (!isResumable(task)) return fail(409, "estado_invalido", "Tarefa nao pode ser retomada neste estado.");
      const audit = [
        ...auditEvents(task),
        {
          event: "resume",
          by: "approver",
          at: new Date().toISOString(),
          from_status: "ERRO",
          attempts: task.attempts,
          prev_error: truncate(task.erro, 200).text
        }
      ].slice(-20);
      const resumed = await store.resume(task, { ...task.payload, audit });
      if (!resumed) {
        // corrida: outra chamada mudou a tarefa entre a leitura e a escrita; reavalia o estado atual.
        const now = await store.get(ctx.id);
        if (now && isResumedQueued(now)) return respond(200, { ok: true, idempotent_replay: true, ...decisionView(now) });
        return fail(409, "estado_invalido", "Tarefa nao pode ser retomada neste estado.");
      }
      return respond(200, { ok: true, idempotent_replay: false, ...decisionView(resumed) });
    })
  };

  // Aplica a decisao: so a transicao AGUARDANDO_DECISAO e atomica no banco (central_decide_task).
  // Repeticao da mesma decisao devolve o estado atual sem efeito; qualquer outro estado = 409 generico.
  async function applyDecision(id, approve, by) {
    const task = await store.get(id);
    if (!task) return fail(404, "nao_encontrada", "Tarefa nao encontrada.");
    if (task.status === "AGUARDANDO_DECISAO") {
      const decided = await store.decide(id, approve, by);
      if (decided) return respond(200, { ok: true, idempotent_replay: false, ...decisionView(decided) });
      const again = await store.get(id); // corrida: outra decisao entrou primeiro
      if (again && classifyDecision(again, approve) === "replay") {
        return respond(200, { ok: true, idempotent_replay: true, ...decisionView(again) });
      }
      return fail(409, "estado_invalido", "Tarefa nao esta aguardando decisao.");
    }
    if (classifyDecision(task, approve) === "replay") {
      return respond(200, { ok: true, idempotent_replay: true, ...decisionView(task) });
    }
    return fail(409, "estado_invalido", "Tarefa nao esta aguardando decisao.");
  }

  async function decideAs(ctx, approve) {
    const granted = await gRole(ctx, DECIDER_ROLES, "decision", 30);
    if (!granted?.granted) return granted;
    const bad = badId(ctx.id);
    if (bad) return bad;
    const { error } = parseBody(ctx.rawBody, emptySchema);
    if (error) return error;
    return applyDecision(ctx.id, approve, granted.role);
  }
}
