import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { buildBrokerSimulationLink } from "./admin-profiles";
import { findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { getConversationForGuide } from "./whatsapp-chat";
import {
  AUTO_KINDS,
  GUIDE_KINDS,
  GUIDE_KIND_KEYS,
  classifyGuideKind,
  emptyGuideGraph,
  libraryEntries,
  restoreState,
  sanitizeGuideGraph,
  startState,
  validateGuideGraph
} from "./attendance-guide-core.mjs";
import { buildSeedGuides } from "./attendance-guide-seed.mjs";

// Guia de Atendimento: persistência (rascunho/publicado), sessão do corretor ao lado do Chat e progresso por cliente.
// A lógica de cada passo vive em attendance-guide-core.mjs (pura e testada).

export class AttendanceGuideError extends Error {
  constructor(message, { status = 400, details = null } = {}) {
    super(message);
    this.name = "AttendanceGuideError";
    this.status = status;
    this.details = details;
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function rowToGuide(row, extra = {}) {
  return {
    id: row.id,
    slug: row.slug || "",
    name: row.name,
    description: row.description || "",
    kind: row.kind,
    enabled: row.enabled !== false,
    sortOrder: row.sort_order ?? 100,
    graph: row.graph || emptyGuideGraph(),
    version: row.version,
    publishedVersion: row.published_version ?? null,
    hasUnpublishedChanges: row.published_version !== null && row.published_version !== undefined && row.published_version !== row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || null,
    ...extra
  };
}

// ---------------------------------------------------------------------------
// Modelos iniciais: na primeira vez que o Guia é usado (tabela vazia) cria Prospecção, Lead, Orgânico e o Banco de
// Objeções, já publicados. Ids fixos + ignoreDuplicates: seguro contra duas chamadas ao mesmo tempo e nunca
// sobrescreve o que a gestão editou. Só roda com a tabela VAZIA (apagar um modelo depois não o recria).
// ---------------------------------------------------------------------------

let seedChecked = false;

export async function ensureSeedGuides() {
  if (seedChecked) return;
  const { count, error } = await db().from("attendance_guides").select("id", { count: "exact", head: true });
  if (error) throw error;
  if ((count || 0) > 0) {
    seedChecked = true;
    return;
  }
  const now = new Date().toISOString();
  const rows = buildSeedGuides().map((guide) => ({
    id: guide.id,
    slug: guide.slug,
    name: guide.name,
    description: guide.description,
    kind: guide.kind,
    enabled: true,
    sort_order: guide.sortOrder,
    graph: guide.graph,
    published_graph: guide.graph,
    version: 1,
    published_version: 1,
    published_at: now
  }));
  const { error: insertError } = await db().from("attendance_guides").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  seedChecked = true;
}

// ---------------------------------------------------------------------------
// Gestão (admin/gestor): listar, criar, editar, publicar…
// ---------------------------------------------------------------------------

export async function listGuides() {
  await ensureSeedGuides();
  const { data, error } = await db().from("attendance_guides").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((row) => {
    const guide = rowToGuide(row);
    return { ...guide, graph: undefined, nodeCount: (row.graph?.nodes || []).filter((node) => node.type !== "start").length };
  });
}

export async function getGuide(id) {
  const { data, error } = await db().from("attendance_guides").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AttendanceGuideError("Guia não encontrado.", { status: 404 });
  return rowToGuide(data);
}

// Entradas do Banco de Objeções (versão PUBLICADA — é a que os corretores usam) para o editor escolher o destino
// dos cards "Abrir objeção".
export async function listLibraryOptions() {
  const { data, error } = await db().from("attendance_guides").select("id, name, published_graph").eq("kind", "library").not("published_graph", "is", null);
  if (error) throw error;
  return (data || []).map((row) => ({ guideId: row.id, guideName: row.name, entries: libraryEntries(row.id, row.published_graph) }));
}

async function publishedLibraryNodeKeys() {
  const { data } = await db().from("attendance_guides").select("id, published_graph").eq("kind", "library").not("published_graph", "is", null);
  const keys = new Set();
  for (const row of data || []) for (const node of row.published_graph?.nodes || []) keys.add(`${row.id}::${node.id}`);
  return keys;
}

export async function createGuide(payload = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const name = String(payload.name || "").trim().slice(0, 120) || "Novo guia";
  const kind = GUIDE_KIND_KEYS.includes(payload.kind) ? payload.kind : "custom";
  let graph;
  try {
    graph = payload.graph ? sanitizeGuideGraph(payload.graph) : emptyGuideGraph();
  } catch (error) {
    throw new AttendanceGuideError(error.message);
  }
  const { data, error } = await db().from("attendance_guides").insert({
    name,
    kind,
    description: String(payload.description || "").trim().slice(0, 300) || null,
    enabled: false, // novo guia só passa a valer depois de publicado
    sort_order: 100,
    graph,
    created_by: auth?.profile?.id || null,
    updated_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToGuide(data);
}

export async function updateGuide(id, payload = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const current = await getGuide(id);
  const patch = { updated_by: auth?.profile?.id || null, updated_at: new Date().toISOString() };
  let touchedContent = false;
  if (payload.name !== undefined) {
    const name = String(payload.name || "").trim().slice(0, 120);
    if (!name) throw new AttendanceGuideError("Dê um nome ao guia.");
    patch.name = name;
    touchedContent = true;
  }
  if (payload.description !== undefined) patch.description = String(payload.description || "").trim().slice(0, 300) || null;
  if (payload.kind !== undefined) {
    if (!GUIDE_KIND_KEYS.includes(payload.kind)) throw new AttendanceGuideError("Tipo de guia inválido.");
    patch.kind = payload.kind;
    touchedContent = true;
  }
  if (payload.graph !== undefined) {
    try {
      patch.graph = sanitizeGuideGraph(payload.graph);
    } catch (error) {
      throw new AttendanceGuideError(error.message);
    }
    touchedContent = true;
  }
  if (touchedContent) patch.version = current.version + 1;
  const { data, error } = await db().from("attendance_guides").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToGuide(data);
}

export async function setGuideEnabled(id, enabled, auth) {
  assertGeneralAdminOrManager(auth);
  const guide = await getGuide(id);
  if (enabled && guide.publishedVersion === null) throw new AttendanceGuideError("Publique o guia antes de ativá-lo.");
  const { data, error } = await db().from("attendance_guides").update({ enabled: Boolean(enabled), updated_by: auth?.profile?.id || null }).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToGuide(data);
}

export async function deleteGuide(id, auth) {
  assertGeneralAdminOrManager(auth);
  const guide = await getGuide(id);
  if (guide.kind === "library") {
    const { data } = await db().from("attendance_guides").select("id, name, published_graph").neq("id", id).not("published_graph", "is", null);
    const users = (data || []).filter((row) => JSON.stringify(row.published_graph || {}).includes(id));
    if (users.length) throw new AttendanceGuideError(`Este banco de objeções é usado por: ${users.map((row) => row.name).join(", ")}. Tire as referências antes de excluir.`);
  }
  const { error } = await db().from("attendance_guides").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true };
}

export async function duplicateGuide(id, auth) {
  assertGeneralAdminOrManager(auth);
  const source = await getGuide(id);
  return createGuide({ name: `${source.name} (cópia)`, description: source.description, kind: source.kind === "library" ? "custom" : source.kind, graph: source.graph }, auth);
}

// "Publicar": valida e copia o rascunho para a versão publicada — é a que os corretores usam.
export async function publishGuide(id, auth) {
  assertGeneralAdminOrManager(auth);
  const guide = await getGuide(id);
  const libraryNodes = await publishedLibraryNodeKeys();
  // O próprio banco pode ser referenciado por si: inclui os nós do rascunho.
  if (guide.kind === "library") for (const node of guide.graph.nodes) libraryNodes.add(`${guide.id}::${node.id}`);
  const { errors } = validateGuideGraph(guide.graph, { libraryNodes, isLibrary: guide.kind === "library" });
  if (errors.length) throw new AttendanceGuideError("Corrija os itens em vermelho antes de publicar.", { details: { errors } });
  const now = new Date().toISOString();
  const { data, error } = await db().from("attendance_guides").update({
    published_graph: guide.graph,
    published_version: guide.version,
    published_at: now,
    enabled: true,
    updated_by: auth?.profile?.id || null
  }).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToGuide(data);
}

// ---------------------------------------------------------------------------
// Corretor: guia da conversa aberta (versão PUBLICADA) + progresso por cliente
// ---------------------------------------------------------------------------

async function loadClientForGuide(conversation) {
  let clientId = conversation.client_id || null;
  if (!clientId) {
    const matches = await findLatestRegistrationIdsByPhones([conversation.contact_phone]);
    clientId = matches.get(conversation.contact_phone) || null;
  }
  if (!clientId) return { clientId: null, name: conversation.contact_name || "", prospectingContactId: null, acquisitionKind: "" };
  const [{ data: client }, { data: origin }] = await Promise.all([
    db().from("simulation_registrations").select("id, full_name, prospecting_contact_id").eq("id", clientId).maybeSingle(),
    db().from("client_origins").select("source_kind").eq("client_id", clientId).maybeSingle()
  ]);
  return {
    clientId,
    name: client?.full_name || conversation.contact_name || "",
    prospectingContactId: client?.prospecting_contact_id || null,
    acquisitionKind: origin?.source_kind || ""
  };
}

function subjectKeys(conversationId, clientId) {
  return { primary: clientId ? `client:${clientId}` : `conv:${conversationId}`, legacy: `conv:${conversationId}` };
}

function cleanState(input) {
  const str = (value) => String(value || "").slice(0, 60);
  const stack = (Array.isArray(input?.stack) ? input.stack : []).slice(-12).map((item) => ({ guideId: str(item?.guideId), nodeId: str(item?.nodeId) }));
  const path = (Array.isArray(input?.path) ? input.path : []).slice(-80).map((item) => ({
    guideId: str(item?.guideId),
    nodeId: str(item?.nodeId),
    label: String(item?.label || "").slice(0, 120),
    stack: (Array.isArray(item?.stack) ? item.stack : []).slice(-12).map((entry) => ({ guideId: str(entry?.guideId), nodeId: str(entry?.nodeId) }))
  }));
  return { guideId: str(input?.guideId), nodeId: str(input?.nodeId), stack, path };
}

// Guia da conversa: o do último progresso salvo (continua exatamente de onde parou) ou o que casa com a origem do cliente.
export async function getGuideSession({ conversationId, guideId = "" }, auth) {
  await ensureSeedGuides();
  const conversation = await getConversationForGuide(conversationId, auth);
  const client = await loadClientForGuide(conversation);
  const kind = classifyGuideKind({
    prospectingContactId: client.prospectingContactId,
    acquisitionKind: client.acquisitionKind,
    conversationOriginKind: conversation.origin?.kind || ""
  });

  const { data: rows, error } = await db().from("attendance_guides").select("id, name, kind, sort_order, published_graph, published_version").eq("enabled", true).not("published_graph", "is", null).order("sort_order", { ascending: true });
  if (error) throw error;
  const guides = rows || [];
  const usable = guides.filter((row) => row.kind !== "library");
  const libraries = guides.filter((row) => row.kind === "library");

  const keys = subjectKeys(conversationId, client.clientId);
  const { data: progressRows } = await db()
    .from("attendance_guide_progress")
    .select("id, subject_key, guide_id, state, updated_at")
    .in("subject_key", [keys.primary, keys.legacy])
    .order("updated_at", { ascending: false });
  const progress = progressRows || [];

  // Contato que virou cliente depois: leva o progresso da conversa para o cliente (uma vez).
  if (client.clientId) {
    for (const row of progress.filter((item) => item.subject_key === keys.legacy)) {
      if (progress.some((item) => item.subject_key === keys.primary && item.guide_id === row.guide_id)) continue;
      await db().from("attendance_guide_progress").update({ subject_key: keys.primary, client_id: client.clientId }).eq("id", row.id);
      row.subject_key = keys.primary;
    }
  }

  const autoGuide = usable.find((row) => row.kind === kind) || usable.find((row) => row.kind === "organic") || usable[0] || null;
  let chosen = null;
  if (guideId) chosen = usable.find((row) => row.id === guideId) || null;
  if (!chosen) {
    const lastProgress = progress.find((row) => usable.some((guide) => guide.id === row.guide_id));
    chosen = lastProgress ? usable.find((row) => row.id === lastProgress.guide_id) : autoGuide;
  }

  const graphs = {};
  for (const library of libraries) graphs[library.id] = library.published_graph;
  let state = null;
  if (chosen) {
    graphs[chosen.id] = chosen.published_graph;
    const savedRow = progress.find((row) => row.guide_id === chosen.id);
    const graphMap = new Map(Object.entries(graphs));
    state = restoreState(savedRow?.state || null, graphMap, chosen.id);
  }

  return {
    kind,
    kindLabel: GUIDE_KINDS[kind]?.label || "",
    autoGuideId: autoGuide?.id || null,
    guides: usable.map((row) => ({ id: row.id, name: row.name, kind: row.kind })),
    guide: chosen ? { id: chosen.id, name: chosen.name, kind: chosen.kind, version: chosen.published_version } : null,
    graphs,
    state,
    resumed: Boolean(chosen && progress.some((row) => row.guide_id === chosen.id)),
    client: { id: client.clientId, name: client.name },
    broker: { name: auth?.profile?.name || "", simulationLink: safeSimulationLink(auth?.profile) },
    autoKinds: AUTO_KINDS
  };
}

function safeSimulationLink(profile) {
  try {
    return buildBrokerSimulationLink(profile);
  } catch {
    return "";
  }
}

export async function saveGuideProgress({ conversationId, guideId, state }, auth) {
  const conversation = await getConversationForGuide(conversationId, auth);
  const { data: guide } = await db().from("attendance_guides").select("id, enabled, published_graph").eq("id", guideId).maybeSingle();
  if (!guide || !guide.published_graph || guide.enabled === false) throw new AttendanceGuideError("Guia não encontrado ou desativado.", { status: 404 });
  const client = await loadClientForGuide(conversation);
  const keys = subjectKeys(conversationId, client.clientId);
  const clean = cleanState(state);
  if (clean.guideId !== guideId && !clean.stack.length) clean.guideId = guideId;
  const row = {
    subject_key: keys.primary,
    client_id: client.clientId,
    conversation_id: conversationId,
    guide_id: guideId,
    state: clean,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  };
  const { error } = await db().from("attendance_guide_progress").upsert(row, { onConflict: "subject_key,guide_id" });
  if (error) throw error;
  return { ok: true };
}

// "Reiniciar": apaga o progresso deste guia para o cliente (volta ao primeiro card).
export async function resetGuideProgress({ conversationId, guideId }, auth) {
  const conversation = await getConversationForGuide(conversationId, auth);
  const client = await loadClientForGuide(conversation);
  const keys = subjectKeys(conversationId, client.clientId);
  const { error } = await db().from("attendance_guide_progress").delete().in("subject_key", [keys.primary, keys.legacy]).eq("guide_id", guideId);
  if (error) throw error;
  return { ok: true };
}

export { startState };
