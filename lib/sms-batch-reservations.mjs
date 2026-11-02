// Reserva de contatos do Lote de SMS dos corretores (dono, 2026-11-02): um contato da base só pode estar no lote de UM
// corretor por vez, por 24 h. A garantia de "nunca dois corretores com o mesmo contato" é a CHAVE PRIMÁRIA de
// sms_batch_reservations (contact_id): o INSERT é atômico no banco, quem perde a corrida recebe 23505 e não leva o contato.
// Reserva vencida (expires_at <= agora) não vale: é apagada antes de reservar e ignorada na leitura — sem reserva fantasma.
// Só usa o client do Supabase recebido (testado com um banco falso em tests/sms-batch-brokers.test.mjs).
import { SMS_BATCH_RESERVATION_HOURS } from "./sms-batch-core.mjs";

export const SMS_RESERVATIONS_TABLE = "sms_batch_reservations";
const CHUNK = 200;

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));

export function isMissingReservationsTable(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function must(result) {
  if (result.error) throw result.error;
  return result.data;
}

/** Reservas VÁLIDAS (não vencidas) dos contatos informados: [{ contact_id, broker_id, expires_at }]. */
export async function listActiveReservations(client, contactIds = [], now = new Date()) {
  const rows = [];
  for (const part of chunk([...new Set(contactIds)], CHUNK)) {
    rows.push(...(must(await client.from(SMS_RESERVATIONS_TABLE).select("contact_id, broker_id, expires_at").in("contact_id", part).gt("expires_at", now.toISOString())) || []));
  }
  return rows;
}

/** Contatos que o corretor tem reservados agora (mais antigos primeiro): [contact_id]. */
export async function listBrokerReservedContactIds(client, brokerId, now = new Date()) {
  const rows = must(await client.from(SMS_RESERVATIONS_TABLE).select("contact_id, reserved_at").eq("broker_id", brokerId).gt("expires_at", now.toISOString()).order("reserved_at", { ascending: true }));
  return (rows || []).map((row) => row.contact_id);
}

/**
 * Reserva, em ordem, até `limit` dos contatos para o corretor. Devolve os ids que de fato ficaram reservados para ele
 * (os que outro corretor já tinha reservado ficam de fora). Idempotente para o próprio corretor (reserva dele não é perdida).
 */
export async function reserveSmsContacts({ client, brokerId, contactIds = [], limit = 0, now = new Date(), hours = SMS_BATCH_RESERVATION_HOURS }) {
  const ids = [...new Set(contactIds)];
  const room = Math.max(0, Math.floor(Number(limit) || 0));
  if (!brokerId || !ids.length || !room) return [];
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + hours * 3600000).toISOString();
  // Reserva vencida de qualquer corretor sai do caminho (a chave primária só barra reserva válida).
  for (const part of chunk(ids, CHUNK)) must(await client.from(SMS_RESERVATIONS_TABLE).delete().lte("expires_at", nowIso).in("contact_id", part));
  const rowFor = (contactId) => ({ contact_id: contactId, broker_id: brokerId, reserved_at: nowIso, expires_at: expiresAt });

  // O próprio corretor já tem alguns reservados: não tenta de novo.
  const mine = new Set((await listActiveReservations(client, ids, now)).filter((row) => row.broker_id === brokerId).map((row) => row.contact_id));
  const wanted = ids.filter((id) => !mine.has(id));
  const reserved = [];
  const batch = wanted.slice(0, room);
  if (batch.length) {
    // Um INSERT só (atômico). Se alguém reservou algum deles no meio, o banco recusa o lote todo (23505): cai para um a um.
    const bulk = await client.from(SMS_RESERVATIONS_TABLE).insert(batch.map(rowFor));
    if (!bulk.error) reserved.push(...batch);
    else if (bulk.error.code !== "23505") throw bulk.error;
    else {
      for (const id of wanted) {
        if (reserved.length >= room) break;
        const single = await client.from(SMS_RESERVATIONS_TABLE).insert(rowFor(id));
        if (!single.error) reserved.push(id);
        else if (single.error.code !== "23505") throw single.error;
      }
    }
  }
  return [...ids.filter((id) => mine.has(id)), ...reserved];
}

/** Libera a reserva do corretor (contato enviado, indisponível ou devolvido). */
export async function releaseSmsReservation(client, contactId, brokerId) {
  must(await client.from(SMS_RESERVATIONS_TABLE).delete().eq("contact_id", contactId).eq("broker_id", brokerId));
}
