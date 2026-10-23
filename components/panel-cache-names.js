// Nomes dos dados de telas do painel guardados no cache por conta (components/chat-view-cache.js, readViewerData).
// Arquivo separado para o AdminWarmup não importar as telas inteiras.
export const PERFORMANCE_CACHE_NAME = "performance:month";
// Lista de Clientes na visão padrão (sem filtros, página 1, 20 por página) — mesmo formato de /api/simulation-registrations/list.
export const CLIENTS_CACHE_NAME = "clients:default";
export const CLIENTS_DEFAULT_LIST_QUERY = "page=1&pageSize=20";
// Chat do Marketplace (dono, 2026-10-22: "Messenger deve carregar quando abrir o app"): lista por filtro
// (`marketplace-chat:list:<query>`, a padrão é "view=all") e as últimas conversas abertas (um objeto só, limitado).
export const MARKETPLACE_LIST_CACHE_PREFIX = "marketplace-chat:list:";
export const MARKETPLACE_DEFAULT_LIST_QUERY = "view=all";
export const MARKETPLACE_THREADS_CACHE_NAME = "marketplace-chat:threads";
// Agenda (ActivityCalendar): atividades de um mês por escopo (`calendar:<query>`); o AdminWarmup guarda o mês atual na
// visão padrão ("team" — a API decide o que cada perfil vê). Mesma URL nos dois lados, por isso a função fica aqui.
export const CALENDAR_CACHE_PREFIX = "calendar:";
export function calendarMonthQuery(month, scope) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 0, 0, 0);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
  return `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}${scope === "team" ? "&scope=team" : ""}`;
}
