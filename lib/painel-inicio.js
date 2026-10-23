import "server-only";
import { applyResponsibleUserScope } from "./admin-access";
import { isAssociateProfile, isBrokerProfile, isGeneralAdminAuth, isManagerProfile } from "./admin-profiles";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_STATUS, CLIENT_STATUS_FILTER_GROUPS } from "./client-status";
import { getTimeGreeting, getTodayInSaoPaulo, zonedPlainDateToUtcIso } from "./daily-report";
import { getCrmPendingCounts } from "./crm-pending-counts";
import { getChatResponseTimes, getChatSummary } from "./whatsapp-chat";
import { getPerformanceOverview, OVERVIEW_PERIODS } from "./performance-overview";
import { isChatDisabled, isChatRestrictedProfile } from "./chat-control";
import { isEffectivelyBlocked } from "./whatsapp-access-core.mjs";
import { readChatHiddenForNav } from "./whatsapp-manual-disconnect";
import { buildAssistantText, firstNameOf, funnelBars, leadOriginBreakdown } from "./painel-inicio-core.mjs";

// Tela "Início" (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md INI-1): resumo do dia montado SÓ com as fontes
// que já existem, no escopo do perfil (admin = tudo; gestor = equipe; corretor = os dele; associado = do corretor
// vinculado). Nenhuma definição nova: pendências = getCrmPendingCounts (mesmos números do balão do cabeçalho);
// aguardando resposta = getChatSummary; tempo de resposta = MET-6; funil/aprovados/vendas = getPerformanceOverview.

const DOCUMENTATION_STATUSES = CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key === "documentation").statuses;
const DOCS_STALE_DAYS = 7;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// O Chat existe para esta pessoa? (mesmas travas do menu e da página /admin/chat: acesso WhatsApp bloqueado, modo
// lista impressa — PRO-15 — e Chat desligado pelo dono para corretor/associado.)
async function isChatAvailable(auth) {
  if (isEffectivelyBlocked(auth.profile)) return false;
  if (await readChatHiddenForNav(auth)) return false;
  if (isChatRestrictedProfile(auth.profile) && (await isChatDisabled())) return false;
  return true;
}

// Uma consulta "head" (só a contagem) no escopo do perfil.
async function scopedCount(auth, build) {
  const { count, error } = await build(applyResponsibleUserScope(db().from("simulation_registrations").select("id", { count: "exact", head: true }), auth));
  if (error) throw error;
  return count || 0;
}

async function loadLeadsToday(auth, todayStartIso) {
  const { data, error } = await applyResponsibleUserScope(
    db().from("simulation_registrations").select("id, acquisition_context").gte("created_at", todayStartIso).limit(2000),
    auth
  );
  if (error) throw error;
  return leadOriginBreakdown(data || []);
}

// Cada bloco carrega sozinho: a falha de um vira "indisponível" na tela (com o erro no log), nunca um zero falso.
function settle(promise, label) {
  return promise.then((value) => ({ ok: true, value })).catch((error) => {
    console.error(`Início: falha ao carregar ${label}:`, error?.message || error);
    return { ok: false, value: null };
  });
}

export async function getPainelInicio(auth) {
  const todayStartIso = zonedPlainDateToUtcIso(getTodayInSaoPaulo());
  const staleBeforeIso = new Date(Date.now() - DOCS_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const chatAvailable = await isChatAvailable(auth);

  const [pending, chat, response, leads, toReview, docs, docsStale] = await Promise.all([
    settle(getCrmPendingCounts(auth), "pendências"),
    chatAvailable ? settle(getChatSummary(auth, { includeOldestAwaiting: true, byBroker: isGeneralAdminAuth(auth) }), "resumo do Chat") : null,
    chatAvailable ? settle(getChatResponseTimes(auth, { sinceIso: todayStartIso }), "tempo de resposta") : null,
    settle(loadLeadsToday(auth, todayStartIso), "leads de hoje"),
    // SIM-AUTO: simulação automática aguardando a conferência do corretor.
    settle(scopedCount(auth, (query) => query.eq("status", CLIENT_STATUS.AUTO_SIMULATION)), "simulações a conferir"),
    settle(scopedCount(auth, (query) => query.in("status", DOCUMENTATION_STATUSES)), "aguardando documentos"),
    settle(scopedCount(auth, (query) => query.in("status", DOCUMENTATION_STATUSES).lt("last_status_change_at", staleBeforeIso)), "documentos parados")
  ]);

  const pendingCounts = pending.ok ? pending.value : null;
  const chatSummary = chat?.ok ? chat.value : null;
  const awaitingReply = chatSummary ? chatSummary.awaitingReply : null;
  const urgent = chatSummary?.oldestAwaiting || null;
  const overdue = pendingCounts ? pendingCounts.agenda : null;
  const toReviewCount = toReview.ok ? toReview.value : null;

  return {
    chatAvailable,
    assistant: {
      text: buildAssistantText({
        greeting: getTimeGreeting(),
        firstName: firstNameOf(auth.profile?.name),
        awaitingReply,
        toReview: toReviewCount,
        overdue,
        urgent
      }),
      urgent: urgent ? { name: urgent.name, clientId: urgent.clientId, waitingMinutes: urgent.waitingMinutes ?? null } : null
    },
    kpis: {
      leadsToday: leads.ok ? leads.value : null,
      response: chatAvailable ? (response?.ok ? response.value : null) : undefined,
      toReview: toReviewCount,
      docs: docs.ok ? { total: docs.value, stale: docsStale.ok ? docsStale.value : null, staleDays: DOCS_STALE_DAYS } : null
    },
    pending: pendingCounts
      ? { ...pendingCounts, chat: chatSummary ? chatSummary.unreadMessages || 0 : 0 }
      : null,
    awaitingReply,
    // Só no admin geral (Início do dono, INI-5): os mesmos aguardando resposta por corretor.
    awaitingByBroker: chatSummary?.awaitingByBroker || null,
    overdue
  };
}

// Corretores do funil por perfil (mesmo filtro "Funil comercial" do Desempenho, brokerIds de getPerformanceOverview):
// admin geral = todos (sem filtro); gestor = equipe (managedUserIds); corretor = ele; associado = o corretor vinculado.
export function funnelBrokerIdsFor(auth) {
  const profile = auth?.profile;
  if (isGeneralAdminAuth(auth)) return null;
  if (isManagerProfile(profile)) return profile.managedUserIds?.length ? profile.managedUserIds : [profile.id];
  if (isAssociateProfile(profile)) return profile.linkedBrokerId ? [profile.linkedBrokerId] : [];
  if (isBrokerProfile(profile)) return [profile.id];
  return [];
}

// "Funil do mês", "Aprovados no mês" e "Vendas no mês": a MESMA conta do Desempenho (MET-4 / MET-12), mês corrente.
export async function getPainelInicioMes(auth) {
  const brokerIds = funnelBrokerIdsFor(auth);
  if (Array.isArray(brokerIds) && !brokerIds.length) return null;
  const overview = await getPerformanceOverview({ period: OVERVIEW_PERIODS.THIS_MONTH, ...(brokerIds ? { brokerIds } : {}) }, auth);
  const stage = (key) => overview.funnel.find((item) => item.key === key)?.value || 0;
  return {
    rangeLabel: overview.range.label,
    approved: stage("approved"),
    sales: stage("sale"),
    bars: funnelBars(overview.funnel)
  };
}
