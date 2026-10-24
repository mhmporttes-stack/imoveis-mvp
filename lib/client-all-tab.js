import "server-only";
import { ALL_TAB_NEGATIVE_TAG_KEYS } from "./client-all-tab-core.mjs";

const PAGE = 1000;

// Clientes com alguma etiqueta negativa da aba Todos (CLI-12a, lib/client-all-tab-core.mjs). Etiqueta pelo nome
// normalizado exato; vínculos lidos em blocos (sem o corte de 1.000 linhas do PostgREST). Erro sobe: sem a lista, o
// contador e a lista da aba Todos ficariam errados.
export async function loadAllTabExcludedTagClientIds(supabase) {
  const { data: tags, error } = await supabase.from("tags").select("id").in("normalized_name", ALL_TAB_NEGATIVE_TAG_KEYS);
  if (error) throw error;
  const tagIds = (tags || []).map((tag) => tag.id).filter(Boolean);
  if (!tagIds.length) return [];

  const ids = new Set();
  for (let from = 0; ; from += PAGE) {
    const { data, error: linkError } = await supabase
      .from("client_tags")
      .select("client_id, tag_id")
      .in("tag_id", tagIds)
      .order("client_id", { ascending: true })
      .order("tag_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (linkError) throw linkError;
    for (const row of data || []) if (row.client_id) ids.add(row.client_id);
    if (!data || data.length < PAGE) break;
  }
  return Array.from(ids);
}
