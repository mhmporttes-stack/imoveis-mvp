import "server-only";
import { getSupabaseAdminClient } from "./supabase";

// Ponte de compatibilidade: os fluxos antigos continuam lendo
// simulation_registrations, enquanto cliente e atendimento passam a ser
// sincronizados em uma estrutura propria. Nenhum dado antigo e removido.
export async function syncCrmClientAttendance(registration = {}) {
  const db = getSupabaseAdminClient();
  const phone = String(registration.phoneNormalized || registration.phone_normalized || registration.phone || "").trim();
  const name = String(registration.fullName || registration.full_name || "Cliente").trim() || "Cliente";
  const registrationId = registration.id;
  if (!db || !phone || !registrationId) return null;

  const { data: client, error: clientError } = await db
    .from("crm_clients")
    .upsert({ canonical_phone: phone, full_name: name, updated_at: new Date().toISOString() }, { onConflict: "canonical_phone" })
    .select("id")
    .single();
  if (clientError) throw clientError;

  const attendance = {
    client_id: client.id,
    legacy_registration_id: registrationId,
    responsible_user_id: registration.responsibleUserId || registration.responsible_user_id || null,
    status: registration.status || "pending",
    updated_at: new Date().toISOString()
  };
  const { data, error } = await db
    .from("crm_attendances")
    .upsert(attendance, { onConflict: "legacy_registration_id" })
    .select("id, client_id, legacy_registration_id, responsible_user_id, status")
    .single();
  if (error) throw error;
  return data;
}
