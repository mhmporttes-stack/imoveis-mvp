import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { fetchIndividualProfilePicture, listIndividualSessionRows } from "./whatsapp-individual";
import { INBOUND_MEDIA_BUCKET } from "./whatsapp-media";
import { conversationSessionOwner } from "./whatsapp-chat-scope.mjs";
import { CONTACT_PHOTO_PREFIX, contactPhotoPath, pickPhotoSession, shouldRefreshContactPhoto, CONTACT_PHOTO_BATCH } from "./whatsapp-contact-photo-core.mjs";

// Foto do cliente no Chat (pedido do dono, 2026-10-09). Busca em segundo plano (after() da rota da lista), pelo
// WhatsApp CONECTADO de quem está na conversa (dono da sessão; senão o atendente), no máximo a cada 7 dias por
// conversa e poucas por vez. A imagem é guardada no Storage privado (a URL do WhatsApp expira) e servida pela rota
// autenticada /api/admin/whatsapp-chat/conversations/[id]/photo. Número oficial: a Meta não fornece a foto.
// Regras puras: lib/whatsapp-contact-photo-core.mjs.

const db = () => getSupabaseAdminClient();
const MAX_BYTES = 1024 * 1024;

export async function refreshContactPhotos(conversationIds = []) {
  const ids = [...new Set(conversationIds.filter(Boolean))].slice(0, 60);
  if (!ids.length) return { refreshed: 0 };
  const { data, error } = await db()
    .from("whatsapp_conversations")
    .select("id, contact_phone, session_key, session_slot, assigned_user_id, profile_photo_checked_at")
    .in("id", ids);
  if (error) throw error;
  const due = (data || []).filter((row) => shouldRefreshContactPhoto(row.profile_photo_checked_at)).slice(0, CONTACT_PHOTO_BATCH);
  let refreshed = 0;
  for (const row of due) {
    try {
      if (await refreshOne(row)) refreshed += 1;
    } catch (failure) {
      console.warn("Falha ao buscar foto do contato:", failure?.message || failure);
    }
  }
  return { refreshed };
}

async function refreshOne(row) {
  // Reserva atômica: duas listas abertas ao mesmo tempo não buscam a mesma foto.
  const now = new Date().toISOString();
  let claim = db().from("whatsapp_conversations").update({ profile_photo_checked_at: now }).eq("id", row.id);
  claim = row.profile_photo_checked_at ? claim.eq("profile_photo_checked_at", row.profile_photo_checked_at) : claim.is("profile_photo_checked_at", null);
  const { data: claimed, error: claimError } = await claim.select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return false;

  const owner = conversationSessionOwner(row);
  const candidates = [];
  if (owner) candidates.push({ userId: owner, rows: await listIndividualSessionRows(owner), slot: row.session_slot || 1 });
  else if (row.assigned_user_id) candidates.push({ userId: row.assigned_user_id, rows: await listIndividualSessionRows(row.assigned_user_id), slot: null });
  const session = pickPhotoSession(candidates);
  if (!session) {
    // Sem WhatsApp conectado agora: tenta de novo em 1 dia (não em 7).
    await db().from("whatsapp_conversations").update({ profile_photo_checked_at: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString() }).eq("id", row.id);
    return false;
  }

  const { url } = await fetchIndividualProfilePicture(session.userId, { to: row.contact_phone, slot: session.slot });
  if (!url) {
    await db().from("whatsapp_conversations").update({ profile_photo_url: null }).eq("id", row.id);
    return true;
  }
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`download da foto: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error("foto vazia ou grande demais");
  const path = contactPhotoPath(row.id);
  const { error: uploadError } = await db().storage.from(INBOUND_MEDIA_BUCKET).upload(path, buffer, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
  if (uploadError) throw uploadError;
  const { error: saveError } = await db().from("whatsapp_conversations").update({ profile_photo_url: `${CONTACT_PHOTO_PREFIX}${path}#${Date.now()}` }).eq("id", row.id);
  if (saveError) throw saveError;
  return true;
}

// URL assinada curta da foto guardada (a rota autenticada redireciona para ela).
export async function signedContactPhotoUrl(storedValue) {
  const value = String(storedValue || "");
  if (!value.startsWith(CONTACT_PHOTO_PREFIX)) return "";
  const path = value.slice(CONTACT_PHOTO_PREFIX.length).split("#")[0];
  const { data, error } = await db().storage.from(INBOUND_MEDIA_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data?.signedUrl || "";
}
