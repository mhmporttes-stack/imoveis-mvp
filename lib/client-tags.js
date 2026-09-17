import { getSupabaseAdminClient } from "./supabase";

export const DEFAULT_TAG_COLORS = [
  "#0D4F8B",
  "#1D4ED8",
  "#047857",
  "#B91C1C",
  "#CA8A04",
  "#475569",
  "#7C3AED",
  "#0891B2",
  "#BE185D",
  "#1F2937"
];

export function normalizeTagName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeTagKey(value) {
  return normalizeTagName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function readableTagColor(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : DEFAULT_TAG_COLORS[0];
}

export async function listTags() {
  const supabase = getTagsClient();
  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []).map(rowToTag);
}

export async function createTag(payload = {}) {
  const name = normalizeTagName(payload.name);
  const normalizedName = normalizeTagKey(name);
  const color = readableTagColor(payload.color);

  if (!name) {
    throw new Error("Informe o nome da tag.");
  }

  const supabase = getTagsClient();
  const { data, error } = await supabase
    .from("tags")
    .upsert(
      {
        name,
        normalized_name: normalizedName,
        color
      },
      { onConflict: "normalized_name" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return rowToTag(data);
}

export async function deleteTag(id) {
  const supabase = getTagsClient();
  const { count, error: countError } = await supabase
    .from("client_tags")
    .select("*", { count: "exact", head: true })
    .eq("tag_id", id);

  if (countError) throw countError;

  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) throw error;

  return { removedClientLinks: count || 0 };
}

export async function setClientTags(clientId, tagIds = [], auth = null) {
  const supabase = getTagsClient();
  const cleanIds = Array.from(new Set((tagIds || []).map((item) => String(item || "").trim()).filter(Boolean)));

  const { data: currentRows, error: currentError } = await supabase
    .from("client_tags")
    .select("tag_id")
    .eq("client_id", clientId);
  if (currentError) throw currentError;
  const previousIds = (currentRows || []).map((row) => row.tag_id);

  const { error: deleteError } = await supabase
    .from("client_tags")
    .delete()
    .eq("client_id", clientId);

  if (deleteError) throw deleteError;

  if (cleanIds.length) {
    const { error: insertError } = await supabase.from("client_tags").insert(
      cleanIds.map((tagId) => ({
        client_id: clientId,
        tag_id: tagId
      }))
    );

    if (insertError) throw insertError;
  }

  // Linha do tempo de auditoria: registra só o QUE mudou (tags adicionadas/
  // removidas), nunca a lista inteira reescrita a cada save — best-effort,
  // nunca pode quebrar o save real das tags.
  const added = cleanIds.filter((id) => !previousIds.includes(id));
  const removed = previousIds.filter((id) => !cleanIds.includes(id));
  if (added.length || removed.length) {
    try {
      const { data: tagRows } = await supabase.from("tags").select("id,name").in("id", [...added, ...removed]);
      const nameById = new Map((tagRows || []).map((row) => [row.id, row.name]));
      const { logClientJourneyEvent, resolveActorSnapshot } = await import("./client-journey");
      const actor = resolveActorSnapshot(auth);
      for (const tagId of added) await logClientJourneyEvent({ clientId, eventType: "tag_added", actor, details: { tagName: nameById.get(tagId) || "" } });
      for (const tagId of removed) await logClientJourneyEvent({ clientId, eventType: "tag_removed", actor, details: { tagName: nameById.get(tagId) || "" } });
    } catch (timelineError) {
      console.warn("Falha ao registrar alteracao de tags na linha do tempo:", timelineError?.message || timelineError);
    }
  }

  return cleanIds;
}

export async function addTagToClient(clientId, tagName) {
  const name = normalizeTagName(tagName);
  if (!clientId || !name) return null;

  const tag = await createTag({ name });

  const supabase = getTagsClient();
  const { error } = await supabase
    .from("client_tags")
    .upsert({ client_id: clientId, tag_id: tag.id }, { onConflict: "client_id,tag_id", ignoreDuplicates: true });

  if (error) throw error;
  return tag;
}

export function rowToTag(row = {}) {
  return {
    id: row.id,
    name: row.name || "",
    normalizedName: row.normalized_name || normalizeTagKey(row.name),
    color: readableTagColor(row.color),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function getTagsClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase administrativo nao configurado para gerenciar tags.");
  }
  return supabase;
}
