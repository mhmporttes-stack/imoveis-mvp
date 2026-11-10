import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { findInternalTeamPhone } from "./internal-phones";
import { sendOfficialAlert } from "./official-alert";
import {
  ACCEPTED_REPLY_TEXT, CHECKING_REPLY_TEXT, LATE_REPLY_LOOKBACK_MS, OFFER_KINDS, OFFER_STATES, UNAVAILABLE_REPLY_TEXT, addLateAccept, buildOfferText, decideOfferExpiry, decideOfferReply, lateLosers, offerExpiresAt
} from "./roulette-offer-core.mjs";

// OFERTA AO PRÓXIMO DA ROLETA — serviço reutilizável (dono, 2026-11-10; BUSINESS_RULES WA-40). Regras puras em
// lib/roulette-offer-core.mjs. Estado em `roulette_offers` (migration 20261110120000, NÃO aplicada): quem foi oferecido, prazo e a
// ordem já consultada — idempotente (índice único: uma oferta pendente por cliente; aceite/vencimento por UPDATE condicional).
// O aviso ao corretor sai por sendOfficialAlert: sino + push (como sempre) E, adicionalmente, WhatsApp pelo Oficial se a janela dele estiver aberta. A resposta dele chega no webhook
// do Oficial como mensagem de número da equipe (WA-12: não vira cliente nem dispara fluxo) e é casada pelo telefone.
// Resposta tardia (quem já passou da vez): fila de aceite tardio em `late_accepts` — regras em roulette-offer-core.mjs.

const TABLE = "roulette_offers";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

const nowIso = () => new Date().toISOString();

// Quem cuida do resultado de cada tipo de oferta (import dinâmico: evita ciclo com o fluxo do anúncio).
async function handlerFor(kind) {
  if (kind === OFFER_KINDS.adFlow) {
    const flow = await import("./official-ad-flow");
    return { onAccepted: flow.completeAdFlowOffer, onExhausted: flow.exhaustAdFlowOffer, clientAvailable: flow.isAdFlowOfferClientAvailable, onLateAfterEnd: flow.completeAdFlowOfferAfterEnd };
  }
  return null; // OFFER_KINDS.general: o 2º interruptor ainda não está ligado ao sorteio da roleta geral
}

async function sendOffer(offer, userId) {
  const clientName = offer.context?.clientName || "";
  const outcome = await sendOfficialAlert({
    userId,
    text: buildOfferText({ clientName, firstContext: offer.context?.stepLabel || "" }),
    clientId: offer.client_id,
    push: { title: "Cliente esperando — você é o próximo", body: `${clientName || "Um cliente"} está esperando. Responda "sim" no WhatsApp oficial para receber.`, url: "/admin/simulacoes" }
  });
  console.info(JSON.stringify({ source: "roulette-offer", event: "offered", offerId: offer.id, channel: outcome.channel, reason: outcome.reason }));
  return outcome;
}

async function replyToTeam(phone, text) {
  try {
    const { sendWhatsappTextMessage } = await import("./whatsapp-master");
    await sendWhatsappTextMessage({ to: phone, text, allowRawRecipient: true });
  } catch (error) {
    console.warn("Oferta da roleta: falha ao responder ao corretor:", error?.message || error);
  }
}

// Quem respondeu tarde e NÃO levou: "não está mais disponível" (cada um uma vez — a oferta já não está pendente).
async function notifyLateLosers(offer, winnerId) {
  for (const item of lateLosers(offer, winnerId)) if (item.phone) await replyToTeam(item.phone, UNAVAILABLE_REPLY_TEXT);
}

/**
 * Abre a oferta e consulta o 1º candidato. `candidateOrder` = ordem do rodízio (já filtrada). Sem candidatos → { exhausted: true } sem
 * gravar nada. Já existe oferta pendente para o cliente → devolve a existente (idempotente).
 */
export async function startRouletteOffer({ kind, clientId, refId = null, candidateOrder = [], timeoutSec = 60, context = {}, now = new Date() }) {
  if (!candidateOrder.length) return { exhausted: true };
  const first = candidateOrder[0];
  const { data, error } = await db().from(TABLE).insert({
    kind, client_id: clientId, ref_id: refId, state: OFFER_STATES.pending, current_user_id: first, candidate_order: candidateOrder, asked_user_ids: [], late_accepts: [],
    timeout_sec: timeoutSec, offered_at: now.toISOString(), expires_at: offerExpiresAt(now, timeoutSec), context
  }).select("*").single();
  if (error?.code === "23505") return { alreadyPending: true };
  if (error) throw error;
  await sendOffer(data, first);
  return { offerId: data.id, userId: first };
}

// Fecha a oferta a favor de `userId` (UPDATE condicional = idempotente) e executa a transferência do tipo. Devolve { transferred }.
async function acceptOffer(offer, userId, now, { phone = "", fromExpiry = false } = {}) {
  let query = db().from(TABLE).update({ state: OFFER_STATES.accepted, accepted_by: userId, accepted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", offer.id).eq("state", OFFER_STATES.pending).eq("current_user_id", offer.current_user_id);
  if (!fromExpiry) query = query.gt("expires_at", now.toISOString()); // aceite direto só dentro do prazo
  const { data: accepted, error } = await query.select("*");
  if (error) throw error;
  if (!accepted?.length) return { transferred: false, lost: true };
  const handler = await handlerFor(offer.kind);
  const result = handler ? await handler.onAccepted(accepted[0], userId, now) : { transferred: false };
  if (phone) await replyToTeam(phone, result?.transferred ? ACCEPTED_REPLY_TEXT : UNAVAILABLE_REPLY_TEXT);
  await notifyLateLosers(accepted[0], userId);
  return result;
}

/** Cron (a cada minuto): oferta vencida → aceite tardio leva; senão próximo candidato; ninguém → esgotada (o tipo decide o resto). */
export async function processRouletteOffers({ now = new Date(), limit = 20 } = {}) {
  const { data: offers, error } = await db().from(TABLE).select("*").eq("state", OFFER_STATES.pending).lte("expires_at", now.toISOString()).order("expires_at", { ascending: true }).limit(limit);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return { skipped: "sem_tabela" };
    throw error;
  }
  const counts = { next: 0, lateWinner: 0, exhausted: 0, errors: 0 };
  for (const offer of offers || []) {
    try {
      const decision = decideOfferExpiry({ offer, now });
      if (decision.action === "late_winner") {
        const result = await acceptOffer(offer, decision.winner.userId, now, { phone: decision.winner.phone, fromExpiry: true });
        if (!result.lost) counts.lateWinner += 1;
      } else if (decision.action === "next") {
        const { data: moved, error: moveError } = await db().from(TABLE)
          .update({ current_user_id: decision.userId, asked_user_ids: decision.asked, expires_at: offerExpiresAt(now, offer.timeout_sec || 60), updated_at: now.toISOString() })
          .eq("id", offer.id).eq("state", OFFER_STATES.pending).eq("current_user_id", offer.current_user_id).select("*");
        if (moveError) throw moveError;
        if (moved?.length) {
          counts.next += 1;
          await sendOffer(moved[0], decision.userId);
        }
      } else if (decision.action === "exhausted") {
        const { data: closed, error: closeError } = await db().from(TABLE).update({ state: OFFER_STATES.exhausted, asked_user_ids: decision.asked, updated_at: now.toISOString() })
          .eq("id", offer.id).eq("state", OFFER_STATES.pending).select("*");
        if (closeError) throw closeError;
        if (closed?.length) {
          counts.exhausted += 1;
          const handler = await handlerFor(offer.kind);
          if (handler) await handler.onExhausted(closed[0], now);
        }
      }
    } catch (offerError) {
      counts.errors += 1;
      console.error("Oferta da roleta: falha ao avançar:", offerError?.message || offerError);
    }
  }
  return counts;
}

async function loadOfferForUser(userId, now) {
  const since = new Date(now.getTime() - LATE_REPLY_LOOKBACK_MS).toISOString();
  const { data, error } = await db().from(TABLE).select("*").gte("updated_at", since).order("updated_at", { ascending: false }).limit(40);
  if (error) throw error;
  const mine = (data || []).filter((offer) => offer.current_user_id === userId || (offer.asked_user_ids || []).includes(userId));
  return mine.find((offer) => offer.state === OFFER_STATES.pending && offer.current_user_id === userId) || mine[0] || null;
}

/**
 * Webhook do Oficial: mensagens de NÚMERO DA EQUIPE. Casa "sim"/"ok" com a oferta do corretor (pelo telefone): aceita na vez dele;
 * quem já passou da vez entra na fila de aceite tardio ("deixa eu verificar"); oferta já encerrada → transfere se ninguém levou,
 * senão "não está mais disponível". Devolve o Set de telefones tratados (o webhook os tira de Fluxos, palavra-chave e resposta
 * fora do horário). Nunca lança.
 */
export async function processRouletteOfferReplies(events = [], now = new Date()) {
  const handled = new Set();
  for (const event of events || []) {
    if (event.event_type !== "message" || event.direction !== "inbound" || !event.sender_phone) continue;
    try {
      const team = await findInternalTeamPhone(event.sender_phone);
      if (!team?.userId) continue;
      const offer = await loadOfferForUser(team.userId, now);
      if (!offer) continue;
      const handler = offer.state === OFFER_STATES.exhausted ? await handlerFor(offer.kind) : null;
      const clientAvailable = handler ? await handler.clientAvailable(offer) : false;
      const decision = decideOfferReply({ offer, userId: team.userId, text: event.message_text, now, clientAvailable });
      if (decision.action === "accept") {
        const result = await acceptOffer(offer, team.userId, now, { phone: event.sender_phone });
        if (result.lost) await replyToTeam(event.sender_phone, UNAVAILABLE_REPLY_TEXT); // perdeu a corrida (prazo/outro corretor)
        handled.add(event.sender_phone);
      } else if (decision.action === "queue") {
        // Idempotente: relê a oferta fresca e só grava se o corretor ainda não está na fila.
        const late = addLateAccept(offer.late_accepts || [], { userId: team.userId, phone: event.sender_phone, at: now, position: decision.position });
        const { data: queued, error } = await db().from(TABLE).update({ late_accepts: late, updated_at: now.toISOString() })
          .eq("id", offer.id).eq("state", OFFER_STATES.pending).eq("updated_at", offer.updated_at).select("id");
        if (error) throw error;
        if (queued?.length) await replyToTeam(event.sender_phone, CHECKING_REPLY_TEXT);
        handled.add(event.sender_phone);
      } else if (decision.action === "claim_after_end") {
        const result = handler?.onLateAfterEnd ? await handler.onLateAfterEnd(offer, team.userId, now) : { transferred: false };
        await replyToTeam(event.sender_phone, result?.transferred ? ACCEPTED_REPLY_TEXT : UNAVAILABLE_REPLY_TEXT);
        handled.add(event.sender_phone);
      } else if (decision.action === "unavailable") {
        await replyToTeam(event.sender_phone, UNAVAILABLE_REPLY_TEXT);
        handled.add(event.sender_phone);
      } else if (decision.action === "duplicate" || (offer.state === OFFER_STATES.pending && offer.current_user_id === team.userId)) {
        handled.add(event.sender_phone); // repetiu a resposta / conversando com a oferta aberta: nada mais responde
      }
    } catch (error) {
      if (error?.code === "42P01" || error?.code === "PGRST205") continue; // migration ainda não aplicada: sem ofertas
      console.error("Oferta da roleta: falha ao tratar a resposta do corretor:", error?.message || error);
    }
  }
  return handled;
}
