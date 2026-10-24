// Aba "Todos" da tela Clientes sem situação negativa (REGRA OFICIAL — dono, 2026-10-23, CLI-12a). Parte pura (testável):
// quais etiquetas tiram o cliente da aba e como a exclusão entra numa consulta do Supabase. Status negativos:
// ALL_TAB_NEGATIVE_STATUSES (lib/client-status.js). Leitura das etiquetas no banco: lib/client-all-tab.js.
import { allTabExcludedStatuses } from "./client-status.js";

// Etiquetas que tiram o cliente da aba Todos, pelo nome normalizado gravado em tags.normalized_name (único; mesma
// normalização de normalizeTagKey em lib/client-tags.js: espaços colapsados, sem acento, minúsculas). Comparação exata,
// nunca por trecho de texto: "RENDA INSUFICIENTE" e "IR ABAIXO DO SUFICIENTE" ficam na aba (decisão do dono, 2026-10-23).
export const ALL_TAB_NEGATIVE_TAG_NAMES = ["SEM WHATSAPP", "OUTRA CIDADE", "RESTRIÇÃO"];
export const ALL_TAB_NEGATIVE_TAG_KEYS = ["sem whatsapp", "outra cidade", "restricao"];

// Aplica a exclusão da aba Todos numa consulta de simulation_registrations. Pesquisando por nome/telefone, só "Não
// contactar" fica fora (os demais negativos aparecem, como os arquivados sempre apareceram na busca).
export function applyAllTabExclusions(query, { searching = false, tagClientIds = [] } = {}) {
  let next = query.not("status", "in", `(${allTabExcludedStatuses({ searching }).join(",")})`);
  if (!searching && tagClientIds.length) next = next.not("id", "in", `(${tagClientIds.join(",")})`);
  return next;
}
