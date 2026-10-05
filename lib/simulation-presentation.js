import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getSimulation } from "./simulations";
import { DEFAULT_RECOMMENDATION_REASON } from "./simulation-mapper";
import {
  buildPresentationScenes,
  buildPublicPresentation,
  generatePresentationToken,
  isPresentationSchemaMissing,
  isPresentationToken
} from "./simulation-presentation-core.mjs";

// Apresentação interativa da simulação (link público /s/<token>). Toda leitura/escrita no banco desta
// funcionalidade passa por aqui. A tabela vem da migration 20261005120000_simulation_presentations.sql: enquanto ela
// não estiver aplicada, TODAS as funções toleram a ausência (`schemaReady: false`) e nada mais quebra.

const TABLE = "simulation_presentations";
const SELECT = "id, token, simulation_id, status, created_at, first_opened_at, last_opened_at, view_count, completed_at, last_scene";
export const PRESENTATION_SCHEMA_MESSAGE = "Recurso ainda não ativado no banco.";

function client() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  return supabase;
}

function rowToPresentation(row) {
  return {
    id: row.id,
    token: row.token,
    simulationId: row.simulation_id,
    status: row.status,
    createdAt: row.created_at,
    firstOpenedAt: row.first_opened_at || "",
    lastOpenedAt: row.last_opened_at || "",
    viewCount: row.view_count || 0,
    completedAt: row.completed_at || "",
    lastScene: row.last_scene || 0
  };
}

export function presentationUrl(token, origin = "") {
  const base = String(origin || "").replace(/\/$/, "") || "https://www.matheusmachadoimoveis.com.br";
  return `${base}/s/${token}`;
}

// A apresentação NÃO usa mais nenhum dado do corretor (sem botão "Falar com meu corretor", sem telefone nem link de WhatsApp):
// as cenas dependem só da simulação.
function sceneInput(simulation) {
  return { simulation, defaultReason: DEFAULT_RECOMMENDATION_REASON };
}

/** DTO público de uma simulação já carregada e autorizada (usado pela prévia do CRM). */
export function buildSimulationPresentationDto(simulation) {
  return buildPublicPresentation(sceneInput(simulation));
}

/** Quantas cenas a simulação gera hoje (para "cena 4 de 10" nas métricas do CRM). */
export function countPresentationScenes(simulation) {
  return buildPresentationScenes(sceneInput(simulation))?.length || 0;
}

/** Link ativo da simulação, ou null. `schemaReady:false` quando a migration ainda não foi aplicada. */
export async function getActivePresentation(simulationId) {
  const { data, error } = await client().from(TABLE).select(SELECT).eq("simulation_id", simulationId).eq("status", "active").maybeSingle();
  if (isPresentationSchemaMissing(error)) return { schemaReady: false, presentation: null };
  if (error) throw error;
  return { schemaReady: true, presentation: data ? rowToPresentation(data) : null };
}

async function insertPresentation({ simulation, userId }) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await client()
      .from(TABLE)
      .insert({
        token: generatePresentationToken(),
        simulation_id: simulation.id,
        registration_id: simulation.registrationId || null,
        created_by_user_id: userId || null
      })
      .select(SELECT)
      .single();
    if (isPresentationSchemaMissing(error)) return { schemaReady: false, presentation: null };
    if (!error) return { schemaReady: true, presentation: rowToPresentation(data) };
    if (error.code !== "23505") throw error;
    // 23505: ou o token colidiu (praticamente impossível) ou outro clique criou o link ativo ao mesmo tempo → reutiliza.
    const existing = await getActivePresentation(simulation.id);
    if (existing.presentation) return existing;
  }
  throw new Error("Não foi possível gerar o link da apresentação.");
}

/** Gera (ou devolve, se já existir) o link ativo da simulação. Idempotente: nunca cria um segundo link ativo. */
export async function ensurePresentation({ simulation, userId }) {
  const current = await getActivePresentation(simulation.id);
  if (!current.schemaReady || current.presentation) return current;
  return insertPresentation({ simulation, userId });
}

/** Revoga o link atual e cria um novo (o link antigo passa a responder 404). */
export async function regeneratePresentation({ simulation, userId }) {
  const { error } = await client()
    .from(TABLE)
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("simulation_id", simulation.id)
    .eq("status", "active");
  if (isPresentationSchemaMissing(error)) return { schemaReady: false, presentation: null };
  if (error) throw error;
  return insertPresentation({ simulation, userId });
}

/**
 * Página pública: token → DTO público. null para token fora do formato, inexistente, revogado, tabela ausente ou
 * simulação sem valores (para o visitante é sempre o mesmo 404). O MOTIVO vai para o log do servidor (sem dado pessoal:
 * só um código), para que um 404 inesperado seja diagnosticável.
 */
export async function getPublicPresentation(token) {
  const notFound = (reason) => {
    console.warn("[apresentacao] 404 publico:", reason);
    return null;
  };
  if (!isPresentationToken(token)) return notFound("token_fora_do_formato");
  const { data, error } = await client().from(TABLE).select("simulation_id, status").eq("token", token).maybeSingle();
  if (isPresentationSchemaMissing(error)) return notFound("migration_ausente");
  if (error) throw error;
  if (!data) return notFound("token_inexistente");
  if (data.status !== "active") return notFound("link_revogado");
  // Sem `auth`: o acesso é pelo token (capacidade). O DTO é a allowlist; a simulação completa nunca sai daqui.
  const simulation = await getSimulation(data.simulation_id);
  if (!simulation) return notFound("simulacao_inexistente");
  const dto = buildSimulationPresentationDto(simulation);
  if (!dto) return notFound("simulacao_sem_valores");
  return dto;
}

/** Registra um evento (função SQL atômica). Retorna false se o link não existe/está revogado ou a migration falta. */
export async function recordPresentationEvent(token, { tipo, cena, nova }) {
  if (!isPresentationToken(token)) return false;
  const { data, error } = await client().rpc("record_simulation_presentation_event", {
    p_token: token,
    p_tipo: tipo,
    p_cena: cena,
    p_nova_sessao: nova === true
  });
  if (isPresentationSchemaMissing(error)) return false;
  if (error) throw error;
  return data === true;
}
