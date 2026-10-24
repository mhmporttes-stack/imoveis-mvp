import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_STATUS } from "./client-status";
import { loadRecentAttendanceByClient } from "./client-attendance";
import { responsibleSteps } from "./henry-voice-client-alerts-core.mjs";

// Leitura ÚNICA de "cliente que chegou a um corretor" (entregue pela roleta/fila/redistribuição/reativação/Marketplace,
// transferido à mão, link pessoal ou cadastrado para ele). Usada pelo aviso de voz do Henry (HENRY-1, dono 2026-10-23) e
// pela janelinha de cliente novo (dono, 2026-10-24). SOMENTE LEITURA: lê o que as entregas já gravam —
// lead_distribution_history, simulation_registrations.responsible_changed_at/created_at e client_journey_events
// responsible_transferred (as fontes da FUN-15h). O "atendimento" vem da definição única (lib/client-attendance*) mais o
// contato gravado no cliente. Não crie outra leitura de "cliente novo/transferido".

const DISTRIBUTION_EVENTS = ["assigned", "auto_transferred"];
export const ARRIVAL_CANDIDATE_LIMIT = 100;
const SKIP_STATUSES = new Set([CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT]);
const REGISTRATION_COLUMNS = "id, full_name, created_at, status, responsible_user_id, pending_distribution_at, private_contact_at, direct_broker_link, distribution_type, last_whatsapp_contact_at, acquisition_context, prospecting_contact_id";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Cliente que ainda está na fila de espera, segurado pelo anúncio (WA-18), em Particular, arquivado ou Não contactar não
// é "entregue a um corretor": não vira aviso (o da entrega real vem quando ele sair da fila).
export function isAnnounceable(registration) {
  return Boolean(registration?.responsible_user_id)
    && !registration.pending_distribution_at
    && !registration.private_contact_at
    && registration.distribution_type !== "whatsapp_ad_waiting"
    && !SKIP_STATUSES.has(registration.status);
}

// Para os clientes `ids`: cadastros avisáveis, passos de responsável (responsibleSteps) e o último atendimento conhecido
// (maior entre last_whatsapp_contact_at e lib/client-attendance desde o cadastro). Quem decide se "foi atendido" é quem
// chama (o Henry conta desde o cadastro; a janelinha, desde o recebimento).
export async function loadClientArrivals(ids, { now = Date.now() } = {}) {
  const unique = [...new Set((ids || []).filter(Boolean))].slice(0, ARRIVAL_CANDIDATE_LIMIT);
  if (!unique.length) return [];
  const [registrations, distribution, journey] = await Promise.all([
    rows(db().from("simulation_registrations").select(REGISTRATION_COLUMNS).in("id", unique)),
    rows(db().from("lead_distribution_history").select("registration_id, from_user_id, to_user_id, details, created_at").in("registration_id", unique).in("event_type", DISTRIBUTION_EVENTS).order("created_at", { ascending: true }).limit(1000)),
    rows(db().from("client_journey_events").select("client_id, details, occurred_at").in("client_id", unique).eq("event_type", "responsible_transferred").order("occurred_at", { ascending: true }).limit(1000))
  ]);
  const eligible = registrations.filter(isAnnounceable);
  if (!eligible.length) return [];

  const oldest = eligible.reduce((min, row) => Math.min(min, Date.parse(row.created_at) || now), now);
  const attendance = await loadRecentAttendanceByClient(db(), { sinceIso: new Date(oldest).toISOString(), clientIds: eligible.map((row) => row.id) });
  const latest = (row) => [row.last_whatsapp_contact_at, attendance.get(row.id)]
    .filter((value) => Number.isFinite(Date.parse(value || "")))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";

  return eligible.map((registration) => ({
    registration,
    steps: responsibleSteps({
      distribution: distribution.filter((row) => row.registration_id === registration.id),
      journey: journey.filter((row) => row.client_id === registration.id)
    }),
    lastAttendanceAt: latest(registration)
  }));
}
