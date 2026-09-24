import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { buildBrokerSimulationLink, getAdminProfileById, getSiteBaseUrl } from "./admin-profiles";
import { addTagToClient } from "./client-tags";
import { digitsOnly, toBrazilianE164 } from "./phone-utils";
import { sendWhatsappMessagePayload } from "./whatsapp-master";
import { materializeClientFromAutomationReply } from "./whatsapp-automation-replies";
import {
  DEFAULT_TRIGGER,
  NODE_TYPES,
  TRIGGER_PRIORITY,
  TRIGGER_TYPES,
  defaultCooldownHours,
  emptyGraph,
  firstName,
  isWithinBusinessHours,
  matchTrigger,
  runFlow,
  validateGraph,
  validateTrigger
} from "./whatsapp-flow-core.mjs";

// Fluxos do WhatsApp Master: persistência (rascunho/publicado), gatilhos ao
// chegar mensagem, execução de sessões e retomada por tempo (cron). A lógica
// de cada passo vive em whatsapp-flow-core.mjs (pura e testada); aqui só se
// liga isso ao banco, ao envio da Meta, ao Chat e ao CRM.

const WINDOW_MS = 24 * 60 * 60 * 1000;
const LOCK_MS = 60 * 1000;
const HUMAN_ATTENDING_MS = 2 * 60 * 60 * 1000;
const SESSION_STALE_MS = 30 * 60 * 60 * 1000;
const MAX_NODES = 80;
const MAX_EDGES = 240;
const MAX_GRAPH_BYTES = 300 * 1024;

export class WhatsappFlowError extends Error {
  constructor(message, { status = 400, details = null } = {}) {
    super(message);
    this.name = "WhatsappFlowError";
    this.status = status;
    this.details = details;
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// ---------------------------------------------------------------------------
// Fluxos (CRUD)
// ---------------------------------------------------------------------------

function rowToFlow(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    status: row.status,
    trigger: row.trigger || DEFAULT_TRIGGER,
    graph: row.graph || emptyGraph(),
    publishedTrigger: row.published_trigger || null,
    version: row.version,
    publishedVersion: row.published_version ?? null,
    hasUnpublishedChanges: row.status !== "draft" && row.published_version !== row.version,
    triggeredCount: row.triggered_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || null,
    ...extra
  };
}

function normalizeTrigger(input = {}) {
  const type = TRIGGER_TYPES.includes(input.type) ? input.type : "keyword";
  const keywords = (Array.isArray(input.keywords) ? input.keywords : [])
    .map((word) => String(word || "").trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 30);
  const cooldown = Number(input.cooldownHours);
  return {
    type,
    keywords: type === "keyword" ? keywords : [],
    match: input.match === "exact" ? "exact" : "contains",
    cooldownHours: Number.isFinite(cooldown) ? Math.min(Math.max(Math.round(cooldown), 0), 720) : defaultCooldownHours(type)
  };
}

function sanitizeGraph(input) {
  const nodesInput = Array.isArray(input?.nodes) ? input.nodes : [];
  const edgesInput = Array.isArray(input?.edges) ? input.edges : [];
  if (nodesInput.length > MAX_NODES) throw new WhatsappFlowError(`O fluxo pode ter no máximo ${MAX_NODES} blocos.`);
  if (edgesInput.length > MAX_EDGES) throw new WhatsappFlowError("Ligações demais no fluxo.");

  const nodes = nodesInput.map((node) => ({
    id: String(node?.id || "").slice(0, 40),
    type: NODE_TYPES.includes(node?.type) ? node.type : "message",
    x: Math.round(Number(node?.x) || 0),
    y: Math.round(Number(node?.y) || 0),
    data: node?.data && typeof node.data === "object" ? node.data : {}
  })).filter((node) => node.id);

  const seenPorts = new Set();
  const edges = [];
  for (const edge of edgesInput) {
    const from = String(edge?.from || "");
    const port = String(edge?.port || "");
    const to = String(edge?.to || "");
    if (!from || !port || !to) continue;
    const key = `${from}::${port}`;
    if (seenPorts.has(key)) continue; // uma ligação por saída
    seenPorts.add(key);
    edges.push({ id: String(edge?.id || `${from}-${port}-${to}`).slice(0, 120), from, port, to });
  }

  const graph = { nodes, edges };
  if (JSON.stringify(graph).length > MAX_GRAPH_BYTES) throw new WhatsappFlowError("O fluxo ficou grande demais.");
  return graph;
}

export async function listWhatsappFlows() {
  const { data, error } = await db().from("whatsapp_flows").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data || [];

  const live = new Map();
  await Promise.all(rows.map(async (row) => {
    const { count } = await db()
      .from("whatsapp_flow_sessions")
      .select("id", { count: "exact", head: true })
      .eq("flow_id", row.id)
      .in("status", ["active", "waiting"]);
    live.set(row.id, count || 0);
  }));

  return rows.map((row) => {
    const flow = rowToFlow(row, { liveSessions: live.get(row.id) || 0 });
    // A lista não precisa do grafo inteiro.
    return { ...flow, graph: undefined, nodeCount: (row.graph?.nodes || []).length };
  });
}

export async function getWhatsappFlow(id) {
  const { data, error } = await db().from("whatsapp_flows").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new WhatsappFlowError("Fluxo não encontrado.", { status: 404 });
  return rowToFlow(data);
}

export async function createWhatsappFlow(payload = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const name = String(payload.name || "").trim().slice(0, 120) || "Novo fluxo";
  const { data, error } = await db().from("whatsapp_flows").insert({
    name,
    description: String(payload.description || "").trim().slice(0, 300) || null,
    trigger: normalizeTrigger(payload.trigger || DEFAULT_TRIGGER),
    graph: payload.graph ? sanitizeGraph(payload.graph) : emptyGraph(),
    created_by: auth?.profile?.id || null,
    updated_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToFlow(data);
}

export async function updateWhatsappFlow(id, payload = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const current = await getWhatsappFlow(id);
  const patch = { updated_by: auth?.profile?.id || null, updated_at: new Date().toISOString(), version: current.version + 1 };
  if (payload.name !== undefined) {
    const name = String(payload.name || "").trim().slice(0, 120);
    if (!name) throw new WhatsappFlowError("Dê um nome ao fluxo.");
    patch.name = name;
  }
  if (payload.description !== undefined) patch.description = String(payload.description || "").trim().slice(0, 300) || null;
  if (payload.trigger !== undefined) patch.trigger = normalizeTrigger(payload.trigger);
  if (payload.graph !== undefined) patch.graph = sanitizeGraph(payload.graph);

  const { data, error } = await db().from("whatsapp_flows").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToFlow(data);
}

export async function deleteWhatsappFlow(id, auth) {
  assertGeneralAdminOrManager(auth);
  const { error } = await db().from("whatsapp_flows").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true };
}

export async function duplicateWhatsappFlow(id, auth) {
  assertGeneralAdminOrManager(auth);
  const source = await getWhatsappFlow(id);
  return createWhatsappFlow({ name: `${source.name} (cópia)`, description: source.description, trigger: source.trigger, graph: source.graph }, auth);
}

// "Ativar" / "Atualizar": valida e copia o rascunho para a versão publicada —
// é a publicada que roda. Só conversas NOVAS usam a versão nova; as que já
// estão em andamento terminam com o snapshot com que começaram.
export async function publishWhatsappFlow(id, auth) {
  assertGeneralAdminOrManager(auth);
  const flow = await getWhatsappFlow(id);
  const triggerErrors = validateTrigger(flow.trigger);
  const { errors } = validateGraph(flow.graph);
  if (triggerErrors.length || errors.length) {
    throw new WhatsappFlowError("Corrija os itens em vermelho antes de ativar o fluxo.", {
      details: { trigger: triggerErrors, errors }
    });
  }
  const now = new Date().toISOString();
  const { data, error } = await db().from("whatsapp_flows").update({
    status: "active",
    published_trigger: flow.trigger,
    published_graph: flow.graph,
    published_version: flow.version,
    published_at: now,
    updated_by: auth?.profile?.id || null
  }).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToFlow(data);
}

export async function setWhatsappFlowStatus(id, status, auth) {
  assertGeneralAdminOrManager(auth);
  if (!["active", "paused"].includes(status)) throw new WhatsappFlowError("Status inválido.");
  const flow = await getWhatsappFlow(id);
  if (status === "active" && flow.publishedVersion === null) {
    throw new WhatsappFlowError("Ative o fluxo pelo editor (botão Ativar) antes de retomar.");
  }
  const { data, error } = await db().from("whatsapp_flows").update({ status }).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToFlow(data);
}

export async function listWhatsappFlowActivity(id, { limit = 60 } = {}) {
  const { data, error } = await db()
    .from("whatsapp_flow_logs")
    .select("id, session_id, contact_phone, node_id, kind, detail, created_at")
    .eq("flow_id", id)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 60, 1), 200));
  if (error) throw error;
  const { data: sessions } = await db()
    .from("whatsapp_flow_sessions")
    .select("id, contact_phone, status, end_reason, error, started_at, ended_at")
    .eq("flow_id", id)
    .order("started_at", { ascending: false })
    .limit(15);
  return { logs: data || [], sessions: sessions || [] };
}

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------

function windowOpen(lastInboundAt) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;
}

async function loadConversationByPhone(phone) {
  const { data, error } = await db()
    .from("whatsapp_conversations")
    .select("id, contact_phone, contact_name, client_id, status, last_inbound_at, origin")
    .eq("contact_phone", phone)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadLiveSession(phone) {
  const { data, error } = await db()
    .from("whatsapp_flow_sessions")
    .select("*")
    .eq("contact_phone", phone)
    .in("status", ["active", "waiting"])
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function acquireLock(sessionId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    const { data, error } = await db()
      .from("whatsapp_flow_sessions")
      .update({ lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
      .eq("id", sessionId)
      .in("status", ["active", "waiting"])
      .or(`lock_until.is.null,lock_until.lt.${now.toISOString()}`)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return null;
}

export async function endLiveFlowSession(phone, reason) {
  if (!phone) return;
  await db()
    .from("whatsapp_flow_sessions")
    .update({ status: "handoff", end_reason: reason, ended_at: new Date().toISOString(), wait_until: null, lock_until: null, awaiting: null })
    .eq("contact_phone", phone)
    .in("status", ["active", "waiting"]);
}

// Variáveis iniciais: nome, primeiro nome, telefone e o link de simulação
// (do corretor responsável, se o cliente já tem um; senão o link público).
async function buildBaseContext(conversation) {
  const ctx = { clientId: conversation.client_id || null, responsibleId: null, clientName: "", vars: {} };
  if (ctx.clientId) {
    const { data } = await db().from("simulation_registrations").select("full_name, responsible_user_id").eq("id", ctx.clientId).maybeSingle();
    ctx.clientName = data?.full_name || "";
    ctx.responsibleId = data?.responsible_user_id || null;
  }
  const name = ctx.clientName || conversation.contact_name || "";
  let link = `${getSiteBaseUrl()}/simulacao`;
  let brokerName = "";
  if (ctx.responsibleId) {
    const broker = await getAdminProfileById(ctx.responsibleId).catch(() => null);
    if (broker) {
      link = buildBrokerSimulationLink(broker);
      brokerName = broker.name || "";
    }
  }
  ctx.vars = {
    nome: name,
    primeiro_nome: firstName(name),
    telefone: conversation.contact_phone,
    link_simulacao: link,
    corretor: brokerName
  };
  return ctx;
}

async function setConversationStatus(conversationId, status) {
  await db().from("whatsapp_conversations").update({ status, updated_at: new Date().toISOString() }).eq("id", conversationId);
}

function makeDeps({ session, conversation, ctx, logs, flowId }) {
  const phone = conversation.contact_phone;
  return {
    canSend: () => windowOpen(conversation.last_inbound_at),
    log: (kind, nodeId, detail) => logs.push({ kind, node_id: nodeId, detail: detail || {} }),

    send: async (outgoing, node) => {
      const sent = await sendWhatsappMessagePayload({ to: phone, message: outgoing.message });
      try {
        const { recordOutboundAutomationMessage } = await import("./whatsapp-chat");
        const display = outgoing.display;
        await recordOutboundAutomationMessage({
          phone,
          text: display.text,
          metaMessageId: sent.messageId,
          automationId: flowId,
          metadata: {
            kind: "flow",
            flowId,
            nodeId: node.id,
            buttons: display.list ? display.list.items : display.buttons,
            ...(display.link ? { link: display.link } : {})
          }
        });
      } catch (chatError) {
        console.warn("Falha ao registrar a mensagem do fluxo no CHAT:", chatError?.message || chatError);
      }
    },

    evaluateCondition: async (data) => {
      switch (data.kind) {
        case "business_hours":
          return isWithinBusinessHours(data);
        case "is_client":
          return Boolean(ctx.clientId);
        case "has_broker":
          return Boolean(ctx.responsibleId);
        case "ad_origin":
          return conversation.origin?.kind === "meta_ad";
        default:
          return false;
      }
    },

    runActions: async (actions, vars) => {
      const result = { vars: {}, detail: {} };
      for (const action of actions) {
        if (action.type === "roulette") {
          if (!ctx.clientId) {
            const outcome = await materializeClientFromAutomationReply({ phone, name: vars.nome || conversation.contact_name || "" });
            if (outcome.registrationId) {
              ctx.clientId = outcome.registrationId;
              await db().from("whatsapp_conversations").update({ client_id: outcome.registrationId, updated_at: new Date().toISOString() }).eq("id", conversation.id);
            }
            if (outcome.brokerProfile) {
              result.vars.corretor = outcome.brokerProfile.name || "";
              result.vars.link_simulacao = buildBrokerSimulationLink(outcome.brokerProfile);
              ctx.responsibleId = outcome.brokerProfile.id || ctx.responsibleId;
              result.detail.roleta = "cliente_criado";
            } else {
              result.detail.roleta = outcome.alreadyExisted ? "cliente_ja_existia" : "sem_corretor_disponivel";
            }
          } else {
            result.detail.roleta = "cliente_ja_existia";
          }
        } else if (action.type === "tag") {
          if (ctx.clientId) {
            await addTagToClient(ctx.clientId, action.tag);
            result.detail.etiqueta = action.tag;
          } else {
            result.detail.etiqueta = "ignorada_sem_cliente";
          }
        } else if (action.type === "finish") {
          await setConversationStatus(conversation.id, "finished");
        } else if (action.type === "handoff") {
          await setConversationStatus(conversation.id, "open");
          return { ...result, handoff: true };
        } else if (action.type === "stop") {
          return { ...result, stop: true };
        }
      }
      return result;
    }
  };
}

const TERMINAL_STATUSES = new Set(["completed", "handoff", "expired", "failed"]);

// Executa um passo da sessão (já com o lock) e grava o novo estado.
async function executeSession(lockedRow, conversation, input) {
  const logs = [];
  const flowId = lockedRow.flow_id;
  const ctx = await buildBaseContext(conversation);
  const sessionState = {
    currentNodeId: lockedRow.current_node_id,
    pendingTarget: lockedRow.pending_target,
    awaiting: lockedRow.awaiting,
    vars: { ...ctx.vars, ...(lockedRow.vars || {}) },
    retries: lockedRow.retries || 0
  };
  const deps = makeDeps({ session: lockedRow, conversation, ctx, logs, flowId });
  deps.onHandoff = async () => setConversationStatus(conversation.id, "open");

  const nowIso = new Date().toISOString();
  let patch;
  try {
    const result = await runFlow({ graph: lockedRow.graph, flowId, session: sessionState, input, deps });
    if (result.ignored) {
      patch = { lock_until: null };
    } else {
      const terminal = TERMINAL_STATUSES.has(result.status);
      patch = {
        status: terminal ? result.status : "waiting",
        current_node_id: result.session.currentNodeId,
        pending_target: result.session.pendingTarget,
        awaiting: result.session.awaiting,
        vars: result.session.vars,
        retries: result.session.retries,
        wait_until: result.waitUntil ? result.waitUntil.toISOString() : null,
        lock_until: null,
        end_reason: result.endReason || null,
        updated_at: nowIso,
        ended_at: terminal ? nowIso : null
      };
      if (input?.kind === "reply") patch.last_input_at = nowIso;
      if (terminal) logs.push({ kind: "end", node_id: null, detail: { status: result.status, reason: result.endReason } });
    }
  } catch (error) {
    // Falha de envio/ação: o fluxo para e a conversa vai para uma pessoa —
    // um robô com defeito nunca pode deixar o cliente sem resposta.
    const message = String(error?.message || "Falha ao executar o fluxo").slice(0, 500);
    logs.push({ kind: "error", node_id: sessionState.currentNodeId, detail: { message } });
    await setConversationStatus(conversation.id, "open").catch(() => {});
    patch = { status: "failed", end_reason: "erro", error: message, lock_until: null, wait_until: null, awaiting: null, updated_at: nowIso, ended_at: nowIso };
    console.error("Falha ao executar Fluxo do WhatsApp:", message);
  }

  await db().from("whatsapp_flow_sessions").update(patch).eq("id", lockedRow.id);
  if (logs.length) {
    await db().from("whatsapp_flow_logs").insert(logs.map((entry) => ({
      ...entry,
      session_id: lockedRow.id,
      flow_id: flowId,
      contact_phone: conversation.contact_phone
    })));
  }
  const { broadcastChatChanged } = await import("./whatsapp-chat");
  await broadcastChatChanged();
}

async function startSession(flow, conversation) {
  const { data, error } = await db().from("whatsapp_flow_sessions").insert({
    flow_id: flow.id,
    flow_version: flow.published_version,
    contact_phone: conversation.contact_phone,
    conversation_id: conversation.id,
    status: "active",
    graph: flow.published_graph,
    current_node_id: "start",
    vars: {},
    last_input_at: new Date().toISOString()
  }).select("*").single();
  if (error) {
    if (error.code === "23505") return null; // já existe sessão viva para este telefone
    throw error;
  }
  await db().rpc("increment_whatsapp_flow_count", { p_id: flow.id });
  const locked = await acquireLock(data.id);
  if (!locked) return null;
  await executeSession(locked, conversation, null);
  return data;
}

// Chamado pelo webhook para cada mensagem NOVA do cliente. Devolve true se um
// fluxo tratou a mensagem (então a resposta automática por palavra-chave não
// deve rodar).
export async function processFlowInbound(event) {
  const phone = event?.sender_phone;
  if (!phone) return false;
  const conversation = await loadConversationByPhone(phone);
  if (!conversation) return false;

  const message = event.raw_payload?.message || {};
  const type = event.message_type || message.type || "text";
  const text = String(event.message_text || "");
  const replyId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || "";

  // 1) Cliente no meio de um fluxo: a mensagem é a resposta.
  const live = await loadLiveSession(phone);
  if (live) {
    const stale = Date.now() - new Date(live.updated_at).getTime() > SESSION_STALE_MS;
    if (!stale) {
      const locked = await acquireLock(live.id);
      if (!locked) return true;
      await executeSession(locked, conversation, { kind: "reply", text, replyId });
      return true;
    }
    await db().from("whatsapp_flow_sessions").update({ status: "expired", end_reason: "sem_atividade", ended_at: new Date().toISOString(), lock_until: null, wait_until: null }).eq("id", live.id);
  }

  // 2) Nenhuma sessão: procura um fluxo ativo cujo gatilho case.
  const { data: flows, error } = await db().from("whatsapp_flows").select("*").eq("status", "active").not("published_graph", "is", null);
  if (error) throw error;
  if (!flows?.length) return false;

  const isTextual = ["text", "button", "interactive"].includes(type);
  const { count: inboundCount } = await db()
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("direction", "inbound");
  const context = {
    text: isTextual ? text : "",
    isFirstMessage: (inboundCount || 0) <= 1,
    hasReferral: Boolean(message.referral)
  };

  // "Atendente presente" = uma pessoa (não automação) enviou mensagem a este
  // cliente há pouco. Não usa o status da conversa: ele fica "Em atendimento"
  // para sempre depois da primeira resposta e travaria os fluxos daí em diante.
  const { count: recentHumanMessages } = await db
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("sender_type", "user")
    .gt("message_at", new Date(Date.now() - HUMAN_ATTENDING_MS).toISOString());
  const humanIsAttending = (recentHumanMessages || 0) > 0;

  const candidates = flows
    .filter((flow) => matchTrigger(flow.published_trigger, context))
    // Uma pessoa acabou de responder este cliente: só palavra-chave (pedido
    // explícito do cliente) pode iniciar um fluxo por cima.
    .filter((flow) => !humanIsAttending || flow.published_trigger?.type === "keyword")
    .sort((a, b) => (TRIGGER_PRIORITY[a.published_trigger.type] - TRIGGER_PRIORITY[b.published_trigger.type]) || (new Date(a.created_at) - new Date(b.created_at)));

  for (const flow of candidates) {
    const cooldown = Number(flow.published_trigger?.cooldownHours) || 0;
    if (cooldown > 0) {
      const since = new Date(Date.now() - cooldown * 60 * 60 * 1000).toISOString();
      const { count } = await db()
        .from("whatsapp_flow_sessions")
        .select("id", { count: "exact", head: true })
        .eq("flow_id", flow.id)
        .eq("contact_phone", phone)
        .gt("started_at", since);
      if (count) continue;
    }
    const started = await startSession(flow, conversation);
    if (started) return true;
  }
  return false;
}

// Cron (a cada minuto): retoma esperas vencidas e prazos de "se não
// responder"; encerra sessões abandonadas.
export async function processDueFlowSessions({ limit = 25 } = {}) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await db()
    .from("whatsapp_flow_sessions")
    .select("id, contact_phone, awaiting")
    .eq("status", "waiting")
    .lte("wait_until", nowIso)
    .order("wait_until", { ascending: true })
    .limit(limit);
  if (error) throw error;

  let processed = 0;
  for (const item of due || []) {
    const locked = await acquireLock(item.id);
    if (!locked) continue;
    const conversation = await loadConversationByPhone(locked.contact_phone);
    if (!conversation) {
      await db().from("whatsapp_flow_sessions").update({ status: "failed", end_reason: "conversa_inexistente", ended_at: nowIso, lock_until: null }).eq("id", locked.id);
      continue;
    }
    await executeSession(locked, conversation, locked.awaiting ? { kind: "timeout" } : { kind: "resume" });
    processed += 1;
  }

  const staleBefore = new Date(Date.now() - SESSION_STALE_MS).toISOString();
  const { data: expired } = await db()
    .from("whatsapp_flow_sessions")
    .update({ status: "expired", end_reason: "sem_atividade", ended_at: nowIso, lock_until: null })
    .in("status", ["active", "waiting"])
    .is("wait_until", null)
    .lt("updated_at", staleBefore)
    .select("id");

  return { processed, expired: (expired || []).length };
}

export function normalizePhoneForFlows(phone) {
  return toBrazilianE164(phone) || (digitsOnly(phone) ? `+${digitsOnly(phone)}` : "");
}
