import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";
import { normalizeGraphVersion, sanitizeMetaError } from "./whatsapp-master";
import { MAX_INBOUND_MEDIA_BYTES, audioContentType, audioExtensionForMime, baseMime, inboundAudioMediaId } from "./whatsapp-media-utils.mjs";

// Mídia RECEBIDA do cliente (hoje: áudio). Fluxo: o webhook traz só o ID da mídia →
// o SERVIDOR consulta a mídia na Meta (token só aqui), baixa o arquivo, guarda em storage
// PRIVADO e vincula à mensagem (metadata.media). O navegador nunca vê o token nem a URL
// temporária da Meta: o Chat toca o áudio por uma rota autenticada do CRM
// (/api/admin/whatsapp-chat/media/<id>), que confere a permissão da conversa.
//
// Estados em whatsapp_messages.metadata.media.status: "stored" | "failed" (com o motivo e o
// nº de tentativas — nada é inventado quando a Meta não entrega mais a mídia).

export const INBOUND_MEDIA_BUCKET = process.env.SUPABASE_INBOUND_MEDIA_BUCKET || "whatsapp-inbound-media";
const FETCH_TIMEOUT_MS = 20000;

let bucketReady = false;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function ensurePrivateBucket() {
  if (bucketReady) return;
  const supabase = db();
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(error.message || "Não foi possível verificar o storage.");
  if (!buckets?.some((bucket) => bucket.name === INBOUND_MEDIA_BUCKET)) {
    const { error: createError } = await supabase.storage.createBucket(INBOUND_MEDIA_BUCKET, { public: false, fileSizeLimit: MAX_INBOUND_MEDIA_BYTES });
    if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
      throw new Error(createError.message || "Não foi possível criar o storage privado de mídias.");
    }
  }
  bucketReady = true;
}

// Consulta a mídia na Graph API e baixa o arquivo (autenticado, só no servidor).
export async function fetchMetaMedia(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  if (!token) throw new Error("Credenciais da Meta Cloud API não configuradas.");
  const version = normalizeGraphVersion(process.env.WHATSAPP_GRAPH_API_VERSION);
  const headers = { Authorization: `Bearer ${token}` };

  const infoResponse = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const info = await infoResponse.json().catch(() => ({}));
  if (!infoResponse.ok || info?.error) throw new Error(sanitizeMetaError(info?.error));
  if (!info?.url) throw new Error("A Meta não devolveu o endereço da mídia.");
  if (Number(info.file_size) > MAX_INBOUND_MEDIA_BYTES) throw new Error("Arquivo de mídia acima do limite.");

  const fileResponse = await fetch(info.url, { headers, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!fileResponse.ok) throw new Error(`A Meta recusou o download da mídia (HTTP ${fileResponse.status}).`);
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  if (!buffer.length) throw new Error("A Meta devolveu um arquivo vazio.");
  if (buffer.length > MAX_INBOUND_MEDIA_BYTES) throw new Error("Arquivo de mídia acima do limite.");
  if (info.sha256) {
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== String(info.sha256).toLowerCase()) throw new Error("O arquivo baixado não confere com o hash informado pela Meta.");
  }
  return { buffer, mime: String(info.mime_type || fileResponse.headers.get("content-type") || "") };
}

async function saveMediaState(row, media) {
  const metadata = { ...(row.metadata || {}), media };
  const { error } = await db().from("whatsapp_messages").update({ metadata }).eq("id", row.id);
  if (error) console.warn("Falha ao gravar o estado da mídia da mensagem:", error.message);
  row.metadata = metadata;
  return media;
}

// Garante que o áudio recebido está no storage. Idempotente: se já está guardado, não baixa de novo
// (force=true ignora e tenta de novo — usado pelo "Tentar novamente"). Nunca lança: devolve o estado.
export async function ensureInboundAudioStored(row, { force = false } = {}) {
  const current = row.metadata?.media;
  if (!force && current?.status === "stored" && current?.path) return current;

  const mediaId = inboundAudioMediaId(row.payload);
  if (!mediaId) return saveMediaState(row, { status: "failed", error: "Mensagem sem identificador de mídia.", attempts: (current?.attempts || 0) + 1, lastAttemptAt: new Date().toISOString() });

  try {
    const { buffer, mime } = await fetchMetaMedia(mediaId);
    await ensurePrivateBucket();
    const finalMime = mime || String(row.payload?.audio?.mime_type || "audio/ogg");
    const path = `audio/${row.conversation_id}/${row.id}.${audioExtensionForMime(finalMime)}`;
    const { error } = await db().storage.from(INBOUND_MEDIA_BUCKET).upload(path, buffer, { contentType: baseMime(finalMime) || "audio/ogg", upsert: true, cacheControl: "31536000" });
    if (error) throw new Error(error.message || "Não foi possível guardar o áudio.");
    return saveMediaState(row, { status: "stored", bucket: INBOUND_MEDIA_BUCKET, path, mime: finalMime, size: buffer.length, source: "meta", storedAt: new Date().toISOString(), attempts: (current?.attempts || 0) + 1 });
  } catch (error) {
    return saveMediaState(row, {
      status: "failed",
      error: String(error?.message || "Falha ao baixar a mídia").slice(0, 300),
      attempts: (current?.attempts || 0) + 1,
      lastAttemptAt: new Date().toISOString()
    });
  }
}

// Bytes do áudio já guardado.
export async function readStoredMedia(media) {
  const { data, error } = await db().storage.from(media.bucket || INBOUND_MEDIA_BUCKET).download(media.path);
  if (error || !data) throw new Error(error?.message || "Áudio não encontrado no storage.");
  return { buffer: Buffer.from(await data.arrayBuffer()), contentType: audioContentType(media.mime) };
}

// Webhook: baixa os áudios das mensagens NOVAS já projetadas no Chat. Melhor esforço com prazo curto —
// se falhar (ou a Meta demorar), o Chat tenta de novo sob demanda quando alguém abrir o áudio.
export async function downloadInboundAudiosForEvents(events, { budgetMs = 9000 } = {}) {
  const metaIds = (events || [])
    .filter((event) => event.event_type === "message" && event.direction === "inbound" && event.message_type === "audio" && event.message_id)
    .map((event) => event.message_id);
  if (!metaIds.length) return { attempted: 0 };

  const { data: rows, error } = await db().from("whatsapp_messages").select("*").in("meta_message_id", metaIds);
  if (error) throw error;
  const work = Promise.all((rows || []).map((row) => ensureInboundAudioStored(row)));
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, budgetMs))]);
  return { attempted: (rows || []).length };
}
