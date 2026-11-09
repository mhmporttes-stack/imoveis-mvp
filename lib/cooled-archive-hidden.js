import "server-only";
import { CLIENT_STATUS } from "./client-status";
import { isOwnerAdminEmail } from "./admin-profiles";
import { COOLED_ARCHIVE_TAG, canSeeCooledTransferArchive } from "./cooled-transfer-archive-core.mjs";

// Clientes arquivados pela regra do cliente frio transferido (FUN-15q, dono, 2026-11-09): só o dono os vê. Este módulo é
// só a LEITURA dos ids (usada por lib/simulation-list-query.js e lib/simulation-registrations.js); a rotina que arquiva
// é lib/cooled-transfer-archive.js. Fica separado para não puxar a rotina pesada para as telas.
const PAGE = 1000;
const CHUNK = 150;

export function viewerSeesCooledArchive(auth) {
  return canSeeCooledTransferArchive({ ok: auth?.ok, accountSwitchMode: auth?.accountSwitchMode, isOwnerEmail: isOwnerAdminEmail(auth?.user?.email) });
}

// Marca (etiqueta "Frio arquivado") E ainda arquivado: se o dono tirar o cliente do arquivo, ele volta a aparecer.
// Erro sobe: sem a lista, as telas dos corretores mostrariam o cliente escondido.
export async function loadCooledArchiveHiddenIds(supabase) {
  const { data: tag, error } = await supabase.from("tags").select("id").eq("normalized_name", COOLED_ARCHIVE_TAG.key).maybeSingle();
  if (error) throw error;
  if (!tag?.id) return [];
  const linked = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: linkError } = await supabase.from("client_tags").select("client_id").eq("tag_id", tag.id).order("client_id", { ascending: true }).range(from, from + PAGE - 1);
    if (linkError) throw linkError;
    linked.push(...(data || []).map((row) => row.client_id));
    if (!data || data.length < PAGE) break;
  }
  const ids = [];
  for (let from = 0; from < linked.length; from += CHUNK) {
    const { data, error: rowsError } = await supabase.from("simulation_registrations").select("id").in("id", linked.slice(from, from + CHUNK)).eq("status", CLIENT_STATUS.ARCHIVED);
    if (rowsError) throw rowsError;
    ids.push(...(data || []).map((row) => row.id));
  }
  return ids;
}

// Contexto para as telas: ids escondidos + se quem olha é o dono real.
export async function loadCooledArchiveContext(supabase, auth) {
  return { hiddenIds: await loadCooledArchiveHiddenIds(supabase), viewerIsOwner: viewerSeesCooledArchive(auth) };
}

// Para as leituras fora da tela Clientes (agenda, aniversários, ficha, listagens gerais): ids a esconder de QUEM olha.
// Sem `auth` (rotina interna) ou dono real: nada escondido; qualquer outro perfil: todos.
export async function loadCooledArchiveHiddenIdsForViewer(supabase, auth) {
  if (!auth || viewerSeesCooledArchive(auth)) return [];
  return loadCooledArchiveHiddenIds(supabase);
}

// Ficha de UM cliente: arquivado por esta regra e quem olha não é o dono real.
export async function isCooledArchiveHiddenFor(supabase, auth, { clientId, status }) {
  if (!auth || !clientId || status !== CLIENT_STATUS.ARCHIVED || viewerSeesCooledArchive(auth)) return false;
  const { data: tag, error } = await supabase.from("tags").select("id").eq("normalized_name", COOLED_ARCHIVE_TAG.key).maybeSingle();
  if (error) throw error;
  if (!tag?.id) return false;
  const { data, error: linkError } = await supabase.from("client_tags").select("client_id").eq("tag_id", tag.id).eq("client_id", clientId).maybeSingle();
  if (linkError) throw linkError;
  return Boolean(data);
}
