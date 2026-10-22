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
