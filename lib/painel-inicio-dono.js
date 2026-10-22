import "server-only";
import { isGeneralAdminAuth, listVisibleTeamProfiles } from "./admin-profiles";
import { getTeamPresence } from "./admin-presence";
import { getOwnerTeamDailyOverview } from "./daily-goal";
import { countOverdueActivitiesByResponsible } from "./crm-pending-counts";
import { listOnlineRouletteBrokerIds, loadRouletteQueueEntries } from "./lead-distribution";
import { listMyCooledDecisions } from "./cooled-clients";
import { listMyPendingAlerts } from "./crm-alerts";
import { getMarketplaceAttention } from "./marketplace-chat";
import { getTimeGreeting } from "./daily-report";
import { saoPauloNow } from "./alexa-config-core.mjs";
import { buildOwnerAssistantText, buildOwnerAttentions, buildOwnerTeamRows, firstNameOf } from "./painel-inicio-dono-core.mjs";

// Início do DONO (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md INI-5): equipe e "Atenções" montadas SÓ com as
// fontes que já existem, todas em paralelo e cada uma isolada (a que falhar vira "não foi possível conferir", nunca zero):
//  - meta do dia por corretor = getOwnerTeamDailyOverview (a mesma da Meta Diária da equipe, TeamDailyPerformance);
//  - presença e WhatsApp (ativo/ocioso/desconectado) = getTeamPresence (painel Online);
//  - aguardando resposta por corretor = getChatSummary({ byBroker }) (vem pronto em `base`, de getPainelInicio);
//  - atividades atrasadas por corretor = countOverdueActivitiesByResponsible (mesmos filtros do contador "Agenda");
//  - roleta: aptos = listOnlineRouletteBrokerIds; fila = loadRouletteQueueEntries (régua planWaitingQueue/reativação);
//  - clientes esfriados aguardando a decisão = listMyCooledDecisions (FUN-15); alertas Importantes = listMyPendingAlerts;
//  - Marketplace = getMarketplaceAttention (MKT-2g + respostas falhas). Pesado: a página carrega isto por streaming.

function settle(promise, label) {
  return promise.then((value) => ({ ok: true, value })).catch((error) => {
    console.error(`Início do dono: falha ao carregar ${label}:`, error?.message || error);
    return { ok: false, value: null, label };
  });
}

// Fila da roleta: quem tem posição de entrega (fila de espera comum + fila de reativação), na régua dos entregadores
// (mesma leitura do filtro "Roleta" da lista de Clientes). Quem está "fora da fila" (bloqueio de 30 dias etc.) não conta.
async function rouletteQueueCount() {
  const entries = await loadRouletteQueueEntries();
  let count = 0;
  for (const entry of entries.values()) if (Number.isFinite(entry.position)) count += 1;
  return count;
}

export async function getPainelInicioDono(auth, base) {
  if (!isGeneralAdminAuth(auth)) return null;
  const { minutes } = saoPauloNow(new Date());
  const profiles = await listVisibleTeamProfiles(auth);
  const ids = profiles.map((profile) => profile.id);

  const [presence, meta, overdue, eligible, queue, cooled, alerts, marketplace] = await Promise.all([
    settle(getTeamPresence(auth), "presença da equipe"),
    settle(getOwnerTeamDailyOverview({ period: "today" }, auth), "meta do dia"),
    settle(countOverdueActivitiesByResponsible(ids), "atividades atrasadas"),
    settle(listOnlineRouletteBrokerIds(), "aptos da roleta"),
    settle(rouletteQueueCount(), "fila da roleta"),
    settle(listMyCooledDecisions(auth), "clientes esfriados"),
    settle(listMyPendingAlerts(auth), "alertas"),
    settle(getMarketplaceAttention(), "Marketplace")
  ]);
  // `base` pode chegar como promessa (Henry lê o Início e este resumo ao mesmo tempo); objeto pronto = como sempre.
  const baseValue = await base;

  const rows = buildOwnerTeamRows({
    profiles,
    presence: presence.value,
    metaBrokers: meta.ok ? meta.value.brokers || [] : null,
    awaitingByBroker: baseValue?.awaitingByBroker || null,
    overdueByBroker: overdue.value
  });
  const unavailable = [presence, meta, overdue, eligible, queue, cooled, alerts, marketplace].filter((item) => !item.ok).map((item) => item.label);
  const attentions = buildOwnerAttentions({
    minutesOfDay: minutes,
    rows,
    roulette: eligible.ok || queue.ok ? { eligibleCount: eligible.ok ? eligible.value.length : null, queueCount: queue.ok ? queue.value : 0 } : null,
    cooledDecisions: cooled.ok ? cooled.value.items.length : null,
    importantAlerts: alerts.ok ? alerts.value.important.length : null,
    marketplace: marketplace.value,
    toReview: baseValue?.kpis?.toReview ?? null,
    unavailable
  });
  const text = buildOwnerAssistantText({
    greeting: getTimeGreeting(),
    firstName: firstNameOf(auth.profile?.name),
    leadsTotal: baseValue?.kpis?.leadsToday?.total ?? null,
    awaitingReply: baseValue?.awaitingReply ?? null,
    urgent: baseValue?.assistant?.urgent || null,
    rows,
    attentions
  });
  return { text, rows, attentions, metaAvailable: meta.ok };
}
