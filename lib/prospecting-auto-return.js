import "server-only";
import { CLIENT_STATUS } from "./client-status";
import { getSupabaseAdminClient } from "./supabase";

const ATTEMPT_LIMIT_MS = 2 * 24 * 60 * 60 * 1000;
const RETURN_BLOCK_MS = 30 * 24 * 60 * 60 * 1000;

export async function autoReturnStaleProspectingContacts(now = new Date()) {
  const db = getSupabaseAdminClient();
  if (!db) return 0;

  const cutoff = new Date(now.getTime() - ATTEMPT_LIMIT_MS).toISOString();
  const { data: contacts, error } = await db.from("prospecting_contacts")
    .select("id, registration_id, assigned_user_id, last_attempt_at")
    .eq("status", "claimed")
    .lte("last_attempt_at", cutoff);
  if (error) throw error;
  if (!contacts?.length) return 0;

  const registrationIds = contacts.map((contact) => contact.registration_id).filter(Boolean);
  if (!registrationIds.length) return 0;
  const { data: registrations, error: registrationError } = await db.from("simulation_registrations")
    .select("id, status")
    .in("id", registrationIds);
  if (registrationError) throw registrationError;
  const pendingIds = new Set((registrations || []).filter((item) => item.status === CLIENT_STATUS.AWAITING_RETURN).map((item) => item.id));
  const stale = contacts.filter((contact) => contact.registration_id && pendingIds.has(contact.registration_id));
  if (!stale.length) return 0;

  const availableAfter = new Date(now.getTime() + RETURN_BLOCK_MS).toISOString();

  // last_broker_id precisa copiar o assigned_user_id de cada contato antes de
  // zerá-lo, e o update do Supabase aplica o mesmo valor a toda a seleção —
  // por isso agrupamos por assigned_user_id (normalmente poucos corretores)
  // em vez de fazer um update por contato.
  const groups = new Map();
  for (const contact of stale) {
    const key = contact.assigned_user_id || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(contact);
  }

  const returned = [];
  for (const [assignedUserId, group] of groups) {
    const { data: updatedRows, error: contactError } = await db.from("prospecting_contacts")
      .update({ status: "recent_attempt", assigned_user_id: null, last_broker_id: assignedUserId || null, available_after: availableAfter, updated_at: now.toISOString() })
      .in("id", group.map((contact) => contact.id))
      .eq("status", "claimed")
      .select("id");
    if (contactError) throw contactError;
    const returnedIds = new Set((updatedRows || []).map((row) => row.id));
    for (const contact of group) if (returnedIds.has(contact.id)) returned.push(contact);
  }
  if (!returned.length) return 0;

  // Encerrar o ciclo de tentativas nao significa arquivar o cliente.
  // Apenas libera o responsavel para que o contato siga a regra de retorno
  // da fila, mantendo o atendimento em "Tentando contato".
  const returnedRegistrationIds = [...new Set(returned.map((contact) => contact.registration_id))];
  const { error: clientError } = await db.from("simulation_registrations")
    .update({ responsible_user_id: null, last_status_change_at: now.toISOString() })
    .in("id", returnedRegistrationIds)
    .eq("status", CLIENT_STATUS.AWAITING_RETURN);
  if (clientError) throw clientError;

  const { error: historyError } = await db.from("prospecting_history").insert(
    returned.map((contact) => ({ contact_id: contact.id, registration_id: contact.registration_id, user_id: contact.assigned_user_id, event_type: "auto_returned", details: { availableAfter, reason: "attempt_timeout_2_days" } }))
  );
  if (historyError) throw historyError;

  return returned.length;
}
