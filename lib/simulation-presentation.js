import "server-only";
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, verifyAdminAccessToken } from "./admin-auth";
import { getSupabaseAdminClient } from "./supabase";
import { getSimulation } from "./simulations";
import { AUTO_PRESENTATION_LOCKED_MESSAGE, isAutoPresentationLocked } from "./simulation-status-lock-core.mjs";
import { isPresentationContactReady } from "./receive-simulation-contact.mjs";
import { DEFAULT_RECOMMENDATION_REASON } from "./simulation-mapper";
import { isPresentationApprovalStatus } from "./client-status";
import { loadPropertyEntryResults, loadPropertyPhotos } from "./simulation-presentation-entry";
import {
  buildApprovalPresentation,
  buildPresentationScenes,
  buildPublicPresentation,
  withReceiveListFlag,
  withPaymentStrategy,
  firstNameOf,
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
 * Existe responsável ATIVO? (Round 4: decide se o botão "Receber lista de documentos" aparece. Desde a PRES-25 o contato vai
 * ao número OFICIAL, então o telefone pessoal do responsável não conta mais — incidente 2026-10-20.) Só um
 * booleano e (dono, 2026-10-19) o PRIMEIRO NOME do responsável saem daqui — para a folha dizer "quem te responde é {nome}"
 * (PRES-3 permite o primeiro nome do corretor; PRES-9: telefone e link nunca entram no DTO). Falha de consulta = botão
 * oculto (e log).
 */
export async function loadReceiveListContact(simulation) {
  const responsibleUserId = simulation?.registration?.responsibleUserId || "";
  if (!responsibleUserId) return { ready: false, firstName: "" };
  try {
    const { data, error } = await client().from("admin_users").select("id, status, name").eq("id", responsibleUserId).maybeSingle();
    if (error) throw error;
    // PRES-25: o contato sai pelo número OFICIAL; basta responsável ativo (o telefone pessoal dele não entra mais).
    const ready = isPresentationContactReady({ responsibleUserId, broker: data ? { status: data.status } : null });
    return { ready, firstName: ready ? firstNameOf(data?.name || "") : "" };
  } catch (error) {
    console.error("[apresentacao] nao foi possivel verificar o WhatsApp do responsavel:", error?.message || error);
    return { ready: false, firstName: "" };
  }
}

export async function canReceiveDocumentsList(simulation) {
  return (await loadReceiveListContact(simulation)).ready;
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
  const contact = await loadReceiveListContact(simulation);
  return withPaymentStrategy(withReceiveListFlag(dto, contact.ready, contact.firstName), simulation);
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

// SIM-AUTO (dono, 2026-10-19): simulação automática só ganhava link depois da conferência do corretor. REVOGADA pelo dono
// em 2026-10-23 ("Remova essa regra já validamos e os valores batem"): a trava só volta se AUTO_PRESENTATION_LOCK_ENABLED
// (lib/simulation-status-lock-core.mjs) for religada.
export class AutoPresentationLockedError extends Error {
  constructor() {
    super(AUTO_PRESENTATION_LOCKED_MESSAGE);
    this.name = "AutoPresentationLockedError";
    this.code = "AUTO_SIMULATION_NOT_REVIEWED";
    this.status = 409;
  }
}

function assertPresentationAllowed(simulation) {
  if (isAutoPresentationLocked(simulation?.createdBy)) throw new AutoPresentationLockedError();
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
  // Defesa extra (SIM-AUTO): com a trava ligada, simulação automática não conferida não abre para o cliente (revogada em 2026-10-23).
  if (isAutoPresentationLocked(simulation.createdBy)) return notFound(PRESENTATION_UPDATING_REASON);
  const approval = simulationOnly ? false : isApprovalPresentation(simulation);
  const dto = await buildSimulationPresentationDto(simulation, { approval });
  if (!dto) return notFound("simulacao_sem_valores");
  return { dto, reason: "" };
}

const EVENTS_TABLE = "simulation_presentation_events";

/**
 * Grava uma linha em `simulation_presentation_events` (toque/abertura; migration 20261020100000). A tabela pode ainda não
 * existir (migration atrasada): aí a falha é SÓ registrada no log e a apresentação segue (o deploy não depende dela).
 * Outros erros sobem (rota responde 503 e o log mostra o motivo). Sem IP nem user-agent.
 */
async function insertPresentationEventRow(presentationId, { tipo, alvo = null, cena = null, equipe = false }) {
  const { error } = await client().from(EVENTS_TABLE).insert({ presentation_id: presentationId, tipo, alvo, cena, equipe: equipe === true });
  if (!error) return;
  if (isPresentationSchemaMissing(error)) {
    console.warn("[apresentacao] tabela de eventos ausente (migration 20261020100000 nao aplicada): evento descartado", tipo);
    return;
  }
  throw error;
}

async function findActivePresentationId(token) {
  const { data, error } = await client().from(TABLE).select("id, status").eq("token", token).maybeSingle();
  if (isPresentationSchemaMissing(error)) return null;
  if (error) throw error;
  return data && data.status === "active" ? data.id : null;
}

/**
 * Registra um evento. Retorna false se o link não existe/está revogado ou a migration falta.
 * - abriu/cena/concluiu: função SQL atômica de sempre (contadores e marcos em simulation_presentations);
 * - abriu de NOVA sessão também vira uma linha em simulation_presentation_events (com a marca `equipe`);
 * - toque (lote A, 2026-10-19): só a linha em simulation_presentation_events (alvo da lista fechada + cena exata).
 */
export async function recordPresentationEvent(token, { tipo, cena, nova, alvo, equipe }) {
  if (!isPresentationToken(token)) return false;
  if (tipo === "toque") {
    const presentationId = await findActivePresentationId(token);
    if (!presentationId) return false;
    await insertPresentationEventRow(presentationId, { tipo, alvo, cena, equipe });
    return true;
  }
  const { data, error } = await client().rpc("record_simulation_presentation_event", {
    p_token: token,
    p_tipo: tipo,
    p_cena: cena,
    p_nova_sessao: nova === true
  });
  if (isPresentationSchemaMissing(error)) return false;
  if (error) throw error;
  if (data === true && tipo === "abriu" && nova === true) {
    const presentationId = await findActivePresentationId(token);
    if (presentationId) await insertPresentationEventRow(presentationId, { tipo, equipe });
  }
  return data === true;
}

/**
 * Quem está abrindo o link tem sessão válida do painel (corretor, gestor, admin)? Lido no SERVIDOR da página pública, só
 * para marcar as métricas como "equipe" — nunca vai para o DTO. Só confere o token de acesso (sem renovar a sessão: renovar
 * aqui trocaria o refresh token sem gravar o cookie novo e derrubaria o login da pessoa). Sem cookie: nenhuma consulta.
 */
export async function isPanelSessionViewer() {
  try {
    const accessToken = (await cookies()).get(ADMIN_ACCESS_COOKIE)?.value || "";
    if (!accessToken) return false;
    return (await verifyAdminAccessToken(accessToken)).ok === true;
  } catch (error) {
    console.warn("[apresentacao] nao foi possivel conferir a sessao do painel:", error?.message || error);
    return false;
  }
}
