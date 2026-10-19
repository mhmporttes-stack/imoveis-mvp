import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getSimulation } from "./simulations";
import { AUTO_PRESENTATION_LOCKED_MESSAGE, isAutomaticSimulationSource } from "./simulation-status-lock-core.mjs";
import { toWhatsAppDigits } from "./phone-utils";
import { RECEIVE_CONTACT_STATE, resolveReceiveSimulationContact } from "./receive-simulation-contact.mjs";
import { DEFAULT_RECOMMENDATION_REASON } from "./simulation-mapper";
import { isPresentationApprovalStatus } from "./client-status";
import { loadPropertyEntryResults, loadPropertyPhotos } from "./simulation-presentation-entry";
import {
  buildApprovalPresentation,
  buildPresentationScenes,
  buildPublicPresentation,
  withReceiveListFlag,
  withPaymentStrategy,
  generatePresentationToken,
  isPresentationSchemaMissing,
  isPresentationToken
} from "./simulation-presentation-core.mjs";

// Apresentação interativa da simulação (link público /s/<token>). Toda leitura/escrita no banco desta
// funcionalidade passa por aqui. A tabela vem da migration 20261005120000_simulation_presentations.sql: enquanto ela
// não estiver aplicada, TODAS as funções toleram a ausência (`schemaReady: false`) e nada mais quebra.

const TABLE = "simulation_presentations";
const SELECT = "id, token, simulation_id, status, created_at, first_opened_at, last_opened_at, view_count, completed_at, last_scene";
// "Apresentação de aprovação" AUTOMÁTICA (REGRA OFICIAL — dono, 2026-10-19; substitui a chave manual do PRES-21): o link
// mostra o roteiro de CRÉDITO APROVADO enquanto o cliente estiver em "Cliente aprovado" ou etapa posterior (Reunião, Venda)
// — derivado da etapa ATUAL do cadastro a cada abertura, então vale para qualquer caminho de mudança de status (card,
// ficha, automação, API, SQL) e desliga sozinho se o cliente voltar. As colunas approval_enabled_at/by (migration
// 20261006180000) ficam só como histórico da chave manual antiga; nada mais as lê nem grava.
export function isApprovalPresentation(simulation) {
  return isPresentationApprovalStatus(simulation?.registration?.status);
}
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
function sceneInput(simulation, entryResults = {}, propertyPhotos = {}) {
  return { simulation, defaultReason: DEFAULT_RECOMMENDATION_REASON, entryResults, propertyPhotos };
}

/**
 * Existe responsável ATIVO com WhatsApp válido? (Round 4: decide se o botão "Receber lista de documentos" aparece.) Só um
 * booleano sai daqui: o telefone e o link do corretor nunca entram no DTO. Falha de consulta = botão oculto (e log).
 */
export async function canReceiveDocumentsList(simulation) {
  const responsibleUserId = simulation?.registration?.responsibleUserId || "";
  if (!responsibleUserId) return false;
  try {
    const { data, error } = await client().from("admin_users").select("id, status, phone").eq("id", responsibleUserId).maybeSingle();
    if (error) throw error;
    const contact = resolveReceiveSimulationContact({
      responsibleUserId,
      broker: data ? { status: data.status, whatsappDigits: toWhatsAppDigits(data.phone) } : null
    });
    return contact.state === RECEIVE_CONTACT_STATE.READY;
  } catch (error) {
    console.error("[apresentacao] nao foi possivel verificar o WhatsApp do responsavel:", error?.message || error);
    return false;
  }
}

/**
 * DTO público de uma simulação já carregada e autorizada (usado pela página pública e pela prévia do CRM).
 * `approval: true` (cliente aprovado ou etapa posterior — `isApprovalPresentation`) → roteiro de CRÉDITO APROVADO com os valores ATUAIS da
 * simulação (o corretor os corrige para os da aprovação); sem lista de documentos nem botões de contato.
 */
export async function buildSimulationPresentationDto(simulation, { approval = false } = {}) {
  // Valores de cada imóvel sugerido: o MESMO motor do card do cliente → Empreendimento, calculado na hora (PRES-20).
  // Fotos do cadastro lidas AGORA: o link já enviado ao cliente acompanha as imagens que o corretor editar depois.
  const [entryResults, propertyPhotos] = await Promise.all([loadPropertyEntryResults(simulation), loadPropertyPhotos(simulation)]);
  // Aprovado: o roteiro de crédito aprovado MANTÉM a "Estratégia de pagamento" (PRES-24; dono, 2026-10-19), com a mesma base.
  if (approval) return withPaymentStrategy(buildApprovalPresentation(sceneInput(simulation, entryResults, propertyPhotos)), simulation);
  const dto = buildPublicPresentation(sceneInput(simulation, entryResults, propertyPhotos));
  if (!dto) return null;
  // "Estratégia de pagamento" (PRES-24): só a base da simulação (financiamento, taxa, prazo, sistema, parcela), quando existe.
  return withPaymentStrategy(withReceiveListFlag(dto, await canReceiveDocumentsList(simulation)), simulation);
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

// REGRA OFICIAL (dono, 2026-10-19 — SIM-AUTO): simulação automática do site só ganha link depois que o corretor marca
// "Simulação OK" ou conclui a correção (aí o `created_by` deixa de ser o automático). Nenhum caminho cria link antes.
export class AutoPresentationLockedError extends Error {
  constructor() {
    super(AUTO_PRESENTATION_LOCKED_MESSAGE);
    this.name = "AutoPresentationLockedError";
    this.code = "AUTO_SIMULATION_NOT_REVIEWED";
    this.status = 409;
  }
}

function assertPresentationAllowed(simulation) {
  if (isAutomaticSimulationSource(simulation?.createdBy)) throw new AutoPresentationLockedError();
}

/** Gera (ou devolve, se já existir) o link ativo da simulação. Idempotente: nunca cria um segundo link ativo. */
export async function ensurePresentation({ simulation, userId }) {
  assertPresentationAllowed(simulation);
  const current = await getActivePresentation(simulation.id);
  if (!current.schemaReady || current.presentation) return current;
  return insertPresentation({ simulation, userId });
}

/** Revoga o link atual e cria um novo (o link antigo passa a responder 404). */
export async function regeneratePresentation({ simulation, userId }) {
  assertPresentationAllowed(simulation);
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
/**
 * DTO público do link. `simulationOnly: true` (imagens da lista de documentos e do resumo) ignora a aprovação:
 * esses arquivos são sempre da SIMULAÇÃO (a lista de documentos não existe no roteiro de aprovação).
 */
export async function getPublicPresentation(token, options = {}) {
  return (await resolvePublicPresentation(token, options)).dto;
}

/** Motivo público "apresentação em atualização" (SIM-AUTO): o link existe, mas a simulação voltou a ser automática e
 * aguarda a conferência do corretor — a página mostra um aviso amigável em vez do 404 cru. */
export const PRESENTATION_UPDATING_REASON = "simulacao_automatica_nao_conferida";

/** Mesma resolução de `getPublicPresentation`, devolvendo também o motivo (`reason`) quando não há DTO. */
export async function resolvePublicPresentation(token, { simulationOnly = false } = {}) {
  const notFound = (reason) => {
    console.warn("[apresentacao] 404 publico:", reason);
    return { dto: null, reason };
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
  // Defesa extra (SIM-AUTO): simulação automática não conferida nunca abre para o cliente, nem por link já existente.
  if (isAutomaticSimulationSource(simulation.createdBy)) return notFound(PRESENTATION_UPDATING_REASON);
  const approval = simulationOnly ? false : isApprovalPresentation(simulation);
  const dto = await buildSimulationPresentationDto(simulation, { approval });
  if (!dto) return notFound("simulacao_sem_valores");
  return { dto, reason: "" };
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
