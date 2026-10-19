import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertCanAccessResponsibleUser } from "./admin-access";
import { logClientJourneyEvent, resolveActorSnapshot } from "./client-journey";
import { CLIENT_STATUS } from "./client-status";
import {
  DOCUMENT_RECEIVED_OFFLINE_EVENT,
  DOCUMENT_RECEIVED_OFFLINE_EVENTS,
  DOCUMENT_RECEIVED_OFFLINE_UNDONE_EVENT,
  OFFLINE_JOURNEY_TEXT,
  OFFLINE_UNDONE_JOURNEY_TEXT,
  canOfferDocumentReceivedOffline,
  canUndoOfflineMark,
  offlineMarkFromEvents
} from "./document-received-offline-core.mjs";

// "Recebi documentos por fora" (REGRA OFICIAL do dono, 2026-10-19; regras puras em document-received-offline-core.mjs).
// Só grava um evento na linha do tempo: nada de status, last_whatsapp_contact_at, atividade ou ponto.

export class OfflineDocumentError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = "OfflineDocumentError";
    this.status = status;
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function readOfflineState(supabase, clientIds) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  const state = new Map();
  if (!ids.length) return state;
  const [batches, events] = await Promise.all([
    supabase.from("client_document_batches").select("client_id").in("client_id", ids),
    supabase.from("client_journey_events").select("client_id, event_type, occurred_at").in("client_id", ids).in("event_type", DOCUMENT_RECEIVED_OFFLINE_EVENTS)
  ]);
  if (batches.error) throw batches.error;
  if (events.error) throw events.error;
  const withBatch = new Set((batches.data || []).map((row) => row.client_id));
  for (const id of ids) {
    const rows = (events.data || []).filter((row) => row.client_id === id);
    state.set(id, { hasBatch: withBatch.has(id), mark: offlineMarkFromEvents(rows) });
  }
  return state;
}

/**
 * Sinal do card (lista de clientes): só para quem está em "Aguardando documentação" sem lote salvo. Acrescenta ao item
 * `documentsOffline = { receivedAt }` ("" = ainda não marcado). Melhor esforço como os outros sinais do card: falha de
 * leitura só esconde a ação (e fica no log), nunca derruba a lista.
 */
export async function applyDocumentsOfflineSignal(supabase, items) {
  const candidates = (items || []).filter((item) => item?.status === CLIENT_STATUS.DOCUMENTATION);
  if (!candidates.length) return items;
  try {
    const state = await readOfflineState(supabase, candidates.map((item) => item.id));
    for (const item of candidates) {
      const entry = state.get(item.id);
      if (!entry || !canOfferDocumentReceivedOffline({ status: item.status, hasBatch: entry.hasBatch })) continue;
      item.documentsOffline = { receivedAt: entry.mark?.receivedAt || "" };
    }
  } catch (error) {
    console.warn("Falha ao ler 'Recebi documentos por fora' dos cards:", error?.message || error);
  }
  return items;
}

/** Marca (ou desfaz, `undo: true`) o 1º documento recebido por fora. Escopo pelo responsável do cliente. */
export async function setDocumentReceivedOffline({ auth, clientId, undo = false }) {
  const { data: client, error } = await db().from("simulation_registrations").select("id, status, responsible_user_id").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client) throw new OfflineDocumentError("Cliente não encontrado.", 404);
  assertCanAccessResponsibleUser(auth, client.responsible_user_id || "");
  const state = (await readOfflineState(db(), [client.id])).get(client.id);
  if (undo) {
    if (!canUndoOfflineMark(state?.mark)) throw new OfflineDocumentError("O prazo para desfazer já passou.");
  } else {
    if (!canOfferDocumentReceivedOffline({ status: client.status, hasBatch: state?.hasBatch })) {
      throw new OfflineDocumentError("Só dá para marcar em \"Aguardando documentação\" e antes de salvar documentos no CRM.");
    }
    if (state?.mark) return { receivedAt: state.mark.receivedAt };
  }
  // O evento é o ÚNICO efeito desta ação: `strict` faz a falha de gravação chegar à tela (nunca "marcado" sem gravar).
  await logClientJourneyEvent({
    clientId: client.id,
    eventType: undo ? DOCUMENT_RECEIVED_OFFLINE_UNDONE_EVENT : DOCUMENT_RECEIVED_OFFLINE_EVENT,
    actor: resolveActorSnapshot(auth),
    details: { text: undo ? OFFLINE_UNDONE_JOURNEY_TEXT : OFFLINE_JOURNEY_TEXT },
    strict: true
  });
  if (undo) return { receivedAt: "" };
  const after = (await readOfflineState(db(), [client.id])).get(client.id);
  return { receivedAt: after?.mark?.receivedAt || new Date().toISOString() };
}
