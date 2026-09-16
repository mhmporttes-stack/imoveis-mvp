import "server-only";
import { randomUUID } from "crypto";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { listAdminProfiles } from "./admin-profiles";
import { computeCycleId, nextCycleLabel } from "./daily-message-cycle";

export { computeCycleId, nextCycleLabel };

const SETTINGS_ID = "daily_message_settings";
const DEFAULT_SETTINGS = {
  enabled: true,
  contentType: "alternate", // biblical | reflection | alternate
  startTime: "08:00",
  font: "cormorant_garamond"
};
export const DAILY_MESSAGE_FONTS = [
  { value: "playfair_display", label: "Playfair Display" },
  { value: "cormorant_garamond", label: "Cormorant Garamond" },
  { value: "libre_baskerville", label: "Libre Baskerville" },
  { value: "lora", label: "Lora" },
  { value: "cinzel", label: "Cinzel" }
];
const FONT_VALUES = new Set(DAILY_MESSAGE_FONTS.map((item) => item.value));

// Janela de tolerância usada como rede de segurança para o item 18 da
// especificação: se o horário configurado mudar no meio do dia, um usuário
// que já recebeu a mensagem automática de hoje não pode ganhar uma segunda
// só porque a fronteira do ciclo se deslocou. Antes de criar uma nova linha
// automática, sempre verificamos se já existe alguma nas últimas 20h — o que
// cobre qualquer reconfiguração razoável dentro do mesmo dia sem depender de
// o cycle_id (que é só uma string de deduplicação) continuar idêntico.
const RECENT_AUTO_GUARD_MS = 20 * 60 * 60 * 1000;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase não configurado.");
  return client;
}

/* ------------------------------ Configuração ----------------------------- */

export async function getDailyMessageSettings() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", SETTINGS_ID).maybeSingle();
  if (error) throw error;
  const stored = data?.setting_value || {};
  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : DEFAULT_SETTINGS.enabled,
    contentType: ["biblical", "reflection", "alternate"].includes(stored.contentType) ? stored.contentType : DEFAULT_SETTINGS.contentType,
    startTime: /^\d{2}:\d{2}$/.test(stored.startTime || "") ? stored.startTime : DEFAULT_SETTINGS.startTime,
    font: FONT_VALUES.has(stored.font) ? stored.font : DEFAULT_SETTINGS.font
  };
}

export async function updateDailyMessageSettings(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const current = await getDailyMessageSettings();
  const next = {
    enabled: payload?.enabled === undefined ? current.enabled : payload.enabled === true,
    contentType: ["biblical", "reflection", "alternate"].includes(payload?.contentType) ? payload.contentType : current.contentType,
    startTime: /^\d{2}:\d{2}$/.test(payload?.startTime || "") ? payload.startTime : current.startTime,
    font: FONT_VALUES.has(payload?.font) ? payload.font : current.font
  };
  const { error } = await db().from("crm_settings").upsert({
    id: SETTINGS_ID,
    setting_value: next,
    updated_by: auth?.profile?.id || null,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
  return next;
}

/* --------------------------- Seleção de cards ------------------------------ */

function pickContentType(contentType, lastSeenType) {
  if (contentType === "biblical" || contentType === "reflection") return contentType;
  // "alternate": alterna em relação ao ÚLTIMO tipo que aquele usuário
  // recebeu (histórico individual) — nunca sorteia tipos separadamente do
  // card em si, só decide QUAL card completo sortear a seguir.
  if (lastSeenType === "biblical") return "reflection";
  if (lastSeenType === "reflection") return "biblical";
  return Math.random() < 0.5 ? "biblical" : "reflection";
}

// Prioriza cards nunca vistos pelo usuário; esgotados os inéditos, permite
// reuso evitando os mais recentemente usados (menor last_used primeiro).
async function pickCardForUser(userId, contentType) {
  const { data: historyRows, error: historyError } = await db()
    .from("daily_message_user_history")
    .select("card_id, created_at, card:daily_message_cards(type)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (historyError) throw historyError;

  const lastSeenType = historyRows?.[0]?.card?.type || null;
  const type = pickContentType(contentType, lastSeenType);

  const { data: activeCards, error: cardsError } = await db()
    .from("daily_message_cards")
    .select("id")
    .eq("type", type)
    .eq("active", true);
  if (cardsError) throw cardsError;
  if (!activeCards?.length) return null;

  const lastUsedAt = new Map();
  for (const row of historyRows || []) {
    if (!lastUsedAt.has(row.card_id)) lastUsedAt.set(row.card_id, row.created_at);
  }

  const unseen = activeCards.filter((card) => !lastUsedAt.has(card.id));
  if (unseen.length) return unseen[Math.floor(Math.random() * unseen.length)].id;

  const byRecency = [...activeCards].sort((a, b) => new Date(lastUsedAt.get(a.id) || 0) - new Date(lastUsedAt.get(b.id) || 0));
  const oldestTimestamp = lastUsedAt.get(byRecency[0].id);
  const oldestTied = byRecency.filter((card) => lastUsedAt.get(card.id) === oldestTimestamp);
  return oldestTied[Math.floor(Math.random() * oldestTied.length)].id;
}

// Seleção para um disparo em grupo: todos os destinatários recebem o MESMO
// card, então a "não repetição" é avaliada de forma agregada — prioriza um
// card ativo do tipo elegível que o menor número possível de destinatários
// já tenha visto, desempatando pelo card usado há mais tempo no sistema
// como um todo.
async function pickCardForGroup(recipientUserIds, contentType) {
  const type = contentType === "alternate" ? (Math.random() < 0.5 ? "biblical" : "reflection") : contentType;

  const { data: activeCards, error: cardsError } = await db().from("daily_message_cards").select("id").eq("type", type).eq("active", true);
  if (cardsError) throw cardsError;
  if (!activeCards?.length) return null;

  const { data: historyRows, error: historyError } = await db()
    .from("daily_message_user_history")
    .select("card_id, user_id, created_at")
    .in("user_id", recipientUserIds.length ? recipientUserIds : ["00000000-0000-0000-0000-000000000000"]);
  if (historyError) throw historyError;

  const seenCountByCard = new Map();
  const lastUsedByCard = new Map();
  for (const row of historyRows || []) {
    seenCountByCard.set(row.card_id, (seenCountByCard.get(row.card_id) || 0) + 1);
    const prev = lastUsedByCard.get(row.card_id);
    if (!prev || row.created_at > prev) lastUsedByCard.set(row.card_id, row.created_at);
  }

  const scored = activeCards
    .map((card) => ({ id: card.id, seenCount: seenCountByCard.get(card.id) || 0, lastUsed: lastUsedByCard.get(card.id) || "" }))
    .sort((a, b) => a.seenCount - b.seenCount || (a.lastUsed > b.lastUsed ? 1 : a.lastUsed < b.lastUsed ? -1 : 0));

  const bestSeenCount = scored[0].seenCount;
  const candidates = scored.filter((card) => card.seenCount === bestSeenCount);
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

export async function pickRandomCardPreview(contentType) {
  const type = contentType === "alternate" ? (Math.random() < 0.5 ? "biblical" : "reflection") : contentType;
  const { data, error } = await db().from("daily_message_cards").select("*").eq("type", type).eq("active", true);
  if (error) throw error;
  if (!data?.length) return null;
  return rowToCard(data[Math.floor(Math.random() * data.length)]);
}

/* ------------------------ Pendência do ciclo automático -------------------- */

// Ponto único chamado pelo checkpoint seguro no CRM: prioriza disparo
// extraordinário pendente mais recente (item 38); se não houver, verifica/
// materializa a mensagem do ciclo automático do dia (se a função estiver
// ativa). Nunca sorteia dois cards para a mesma pendência — uma vez
// materializada a linha em daily_message_user_history, sempre retorna o
// MESMO card em chamadas seguintes até ser concluída.
export async function getPendingDailyMessageForUser(auth) {
  const userId = auth?.profile?.id;
  if (!userId) return null;

  const settings = await getDailyMessageSettings();

  const { data: pendingDispatch, error: dispatchError } = await db()
    .from("daily_message_user_history")
    .select("id, card_id, cycle_key, source, dispatch_id, status, shown_at, card:daily_message_cards(*)")
    .eq("user_id", userId)
    .eq("source", "dispatch")
    .neq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dispatchError) throw dispatchError;
  if (pendingDispatch) return toPendingPayload(pendingDispatch, settings.font);

  // "Ativa" (item 14) gate SÓ o ciclo automático — um disparo extraordinário
  // (acima) é mecanismo independente e continua funcionando mesmo com o
  // ciclo automático desligado (item 34).
  if (!settings.enabled) return null;

  const now = new Date();
  const cycleId = computeCycleId(settings.startTime, now);
  const cycleKey = `auto:${cycleId}`;

  const { data: existing, error: existingError } = await db()
    .from("daily_message_user_history")
    .select("id, card_id, cycle_key, source, dispatch_id, status, shown_at, card:daily_message_cards(*)")
    .eq("user_id", userId)
    .eq("cycle_key", cycleKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing.status === "completed" ? null : toPendingPayload(existing, settings.font);

  // Rede de segurança do item 18: se o usuário já tem QUALQUER linha
  // automática recente (independente do cycle_key exato), não cria outra —
  // evita duplicar a mensagem do dia quando o horário configurado muda
  // dentro do mesmo dia.
  const { data: recent, error: recentError } = await db()
    .from("daily_message_user_history")
    .select("id, card_id, cycle_key, source, dispatch_id, status, shown_at, created_at, card:daily_message_cards(*)")
    .eq("user_id", userId)
    .eq("source", "auto")
    .gte("created_at", new Date(now.getTime() - RECENT_AUTO_GUARD_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentError) throw recentError;
  if (recent) return recent.status === "completed" ? null : toPendingPayload(recent, settings.font);

  const cardId = await pickCardForUser(userId, settings.contentType);
  if (!cardId) return null;

  const { data: inserted, error: insertError } = await db()
    .from("daily_message_user_history")
    .insert({ user_id: userId, card_id: cardId, source: "auto", cycle_key: cycleKey, status: "shown", shown_at: now.toISOString() })
    .select("id, card_id, cycle_key, source, dispatch_id, status, shown_at, card:daily_message_cards(*)")
    .maybeSingle();
  if (insertError) {
    if (insertError.code === "23505") {
      // Corrida entre duas abas do mesmo usuário: outra já criou a linha
      // deste ciclo — busca e devolve a que ganhou.
      const { data: raceWinner } = await db()
        .from("daily_message_user_history")
        .select("id, card_id, cycle_key, source, dispatch_id, status, shown_at, card:daily_message_cards(*)")
        .eq("user_id", userId)
        .eq("cycle_key", cycleKey)
        .maybeSingle();
      return raceWinner && raceWinner.status !== "completed" ? toPendingPayload(raceWinner, settings.font) : null;
    }
    throw insertError;
  }
  return toPendingPayload(inserted, settings.font);
}

function toPendingPayload(row, font) {
  return {
    historyId: row.id,
    source: row.source,
    dispatchId: row.dispatch_id || null,
    card: { ...rowToCard(row.card), font }
  };
}

export async function markDailyMessageShown(historyId, auth) {
  const userId = auth?.profile?.id;
  if (!userId || !historyId) return;
  await db().from("daily_message_user_history").update({ status: "shown", shown_at: new Date().toISOString() }).eq("id", historyId).eq("user_id", userId).eq("status", "pending");
}

export async function completeDailyMessage(historyId, auth) {
  const userId = auth?.profile?.id;
  if (!userId) throw new Error("Usuário sem perfil ativo.");
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("daily_message_user_history")
    .update({ status: "completed", completed_at: now })
    .eq("id", historyId)
    .eq("user_id", userId)
    .neq("status", "completed")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/* --------------------------- Biblioteca (admin) ----------------------------- */

function rowToCard(row) {
  if (!row) return null;
  return {
    id: row.id,
    editorialId: row.editorial_id,
    type: row.type,
    mainText: row.main_text,
    sourceText: row.source_text,
    openingMessage: row.opening_message,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const CARD_TYPES = ["biblical", "reflection", "custom"];

export async function listDailyMessageCards({ search = "", type = "all", status = "all" } = {}, auth) {
  assertGeneralAdminOrManager(auth);
  let query = db().from("daily_message_cards").select("*").order("editorial_id", { ascending: true });
  if (CARD_TYPES.includes(type)) query = query.eq("type", type);
  if (status === "active") query = query.eq("active", true);
  if (status === "inactive") query = query.eq("active", false);
  const cleanSearch = String(search || "").trim();
  if (cleanSearch) query = query.or(`main_text.ilike.%${cleanSearch}%,source_text.ilike.%${cleanSearch}%,editorial_id.ilike.%${cleanSearch}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToCard);
}

// "Desativar todos" — aplica exatamente o mesmo filtro que está sendo
// exibido na Biblioteca (search/type/status), nunca a tabela inteira sem
// filtro de tipo (bloqueado já na tela, mas reforçado aqui: type precisa
// ser um dos 3 valores reais, nunca "all").
export async function bulkSetDailyMessageCardsActive({ search = "", type = "all", status = "all" } = {}, active, auth) {
  assertGeneralAdminOrManager(auth);
  if (!CARD_TYPES.includes(type)) throw new Error("Selecione uma categoria (Bíblicos, Reflexivos ou Meus) antes de desativar em massa.");

  let query = db().from("daily_message_cards").update({ active: active === true, updated_at: new Date().toISOString() }).eq("type", type);
  if (status === "active") query = query.eq("active", true);
  if (status === "inactive") query = query.eq("active", false);
  const cleanSearch = String(search || "").trim();
  if (cleanSearch) query = query.or(`main_text.ilike.%${cleanSearch}%,source_text.ilike.%${cleanSearch}%,editorial_id.ilike.%${cleanSearch}%`);

  const { data, error } = await query.select("id");
  if (error) throw error;
  return { updated: data?.length || 0 };
}

export async function createDailyMessageCard(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const record = normalizeCardPayload(payload);
  const { data, error } = await db().from("daily_message_cards").insert(record).select("*").single();
  if (error) throw error;
  return rowToCard(data);
}

export async function updateDailyMessageCard(id, payload, auth) {
  assertGeneralAdminOrManager(auth);
  const updates = {};
  if (payload.editorialId !== undefined) updates.editorial_id = String(payload.editorialId).trim();
  if (payload.type !== undefined) updates.type = CARD_TYPES.includes(payload.type) ? payload.type : "biblical";
  if (payload.mainText !== undefined) updates.main_text = String(payload.mainText).trim();
  if (payload.sourceText !== undefined) updates.source_text = String(payload.sourceText).trim();
  if (payload.openingMessage !== undefined) updates.opening_message = String(payload.openingMessage).trim();
  if (payload.active !== undefined) updates.active = payload.active === true;
  updates.updated_at = new Date().toISOString();
  const { data, error } = await db().from("daily_message_cards").update(updates).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToCard(data);
}

function normalizeCardPayload(payload) {
  const editorialId = String(payload?.editorialId || "").trim();
  const mainText = String(payload?.mainText || "").trim();
  const sourceText = String(payload?.sourceText || "").trim();
  const openingMessage = String(payload?.openingMessage || "").trim();
  const type = CARD_TYPES.includes(payload?.type) ? payload.type : "biblical";
  if (!editorialId || !mainText || !sourceText || !openingMessage) {
    throw new Error("Preencha ID editorial, texto principal, autor/referência e mensagem de início.");
  }
  return { editorial_id: editorialId, type, main_text: mainText, source_text: sourceText, opening_message: openingMessage, active: payload?.active !== false };
}

export async function getDailyMessageCardById(id) {
  const { data, error } = await db().from("daily_message_cards").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return rowToCard(data);
}

/* --------------------------- Disparo extraordinário -------------------------- */

export async function listDailyMessageRecipientCandidates(auth) {
  assertGeneralAdminOrManager(auth);
  const profiles = await listAdminProfiles();
  return profiles.filter((profile) => profile.status !== "inactive").map((profile) => ({ id: profile.id, name: profile.name, role: profile.role }));
}

export async function createDailyMessageDispatch(payload, auth) {
  assertGeneralAdminOrManager(auth);
  const audience = payload?.audience === "selected" ? "selected" : "all";
  let recipientIds = [];
  if (audience === "selected") {
    recipientIds = Array.from(new Set((payload?.recipientIds || []).filter((id) => typeof id === "string" && id)));
    if (!recipientIds.length) throw new Error("Selecione ao menos um corretor.");
  } else {
    const profiles = await listAdminProfiles();
    recipientIds = profiles.filter((profile) => profile.status !== "inactive").map((profile) => profile.id);
  }
  if (!recipientIds.length) throw new Error("Nenhum destinatário elegível encontrado.");

  const settings = await getDailyMessageSettings();
  let cardId = payload?.cardId || "";
  if (!cardId) {
    cardId = await pickCardForGroup(recipientIds, payload?.contentType || settings.contentType);
    if (!cardId) throw new Error("Nenhum card ativo disponível para o tipo selecionado.");
  } else {
    const card = await getDailyMessageCardById(cardId);
    if (!card || !card.active) throw new Error("Card inválido ou inativo.");
  }

  const idempotencyKey = String(payload?.idempotencyKey || "").trim() || randomUUID();

  const { data: existingDispatch } = await db().from("daily_message_dispatches").select("id, card_id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingDispatch) return { dispatchId: existingDispatch.id, cardId: existingDispatch.card_id, recipients: recipientIds.length, reused: true };

  const { data: dispatch, error: dispatchError } = await db()
    .from("daily_message_dispatches")
    .insert({ card_id: cardId, created_by: auth.profile.id, audience, idempotency_key: idempotencyKey })
    .select("id")
    .single();
  if (dispatchError) {
    if (dispatchError.code === "23505") {
      const { data: winner } = await db().from("daily_message_dispatches").select("id, card_id").eq("idempotency_key", idempotencyKey).maybeSingle();
      if (winner) return { dispatchId: winner.id, cardId: winner.card_id, recipients: recipientIds.length, reused: true };
    }
    throw dispatchError;
  }

  const rows = recipientIds.map((userId) => ({
    user_id: userId,
    card_id: cardId,
    source: "dispatch",
    cycle_key: `dispatch:${dispatch.id}`,
    dispatch_id: dispatch.id,
    status: "pending"
  }));
  const { error: rowsError } = await db().from("daily_message_user_history").upsert(rows, { onConflict: "user_id,cycle_key", ignoreDuplicates: true });
  if (rowsError) throw rowsError;

  return { dispatchId: dispatch.id, cardId, recipients: recipientIds.length, reused: false };
}

export async function listDailyMessageDispatchHistory(auth) {
  assertGeneralAdminOrManager(auth);
  const { data, error } = await db()
    .from("daily_message_dispatches")
    .select("id, card_id, created_at, audience, created_by, card:daily_message_cards(editorial_id, type, main_text, source_text), history:daily_message_user_history(user_id, status, shown_at, completed_at)")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    audience: row.audience,
    card: { editorialId: row.card?.editorial_id, type: row.card?.type, mainText: row.card?.main_text, sourceText: row.card?.source_text },
    recipients: row.history?.length || 0,
    completed: (row.history || []).filter((item) => item.status === "completed").length
  }));
}
