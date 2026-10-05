import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { recordClientStatusChange } from "./client-status-history";
import { logClientJourneyEvent, resolveActorSnapshot } from "./client-journey";
import { getSimulationRegistration } from "./simulation-registrations";
import { getSimulation } from "./simulations";
import { countPresentationScenes, ensurePresentation } from "./simulation-presentation";
import { confirmDocumentsForecast, prepareDocumentsList } from "./documents-forecast-store.mjs";
import { DOCUMENTS_LIST_SENT_EVENT, canTouchClientOnForecast } from "./documents-forecast-core.mjs";

// Ligação do fluxo "previsão de envio dos documentos" (round 4) ao banco real. Regras e testes: documents-forecast-core.mjs e
// documents-forecast-store.mjs (puros/injetáveis). Nada aqui é público por conta própria: a rota pública só chama
// `confirmDocumentsForecastByToken`; as funções da ficha exigem `auth` (escopo de equipe).

function client() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  return supabase;
}

/** Confirmação do cliente na apresentação (rota pública). `input` já validado por parseForecastBody. */
export function confirmDocumentsForecastByToken(token, input) {
  return confirmDocumentsForecast({
    supabase: client(),
    recordStatusChange: recordClientStatusChange,
    logJourney: logClientJourneyEvent,
    token,
    input
  });
}

// Simulação mais recente do cliente QUE TEM valores (a lista só existe para uma apresentação válida).
async function findLatestSimulationWithValues(clientId, auth) {
  const { data, error } = await client()
    .from("simulations")
    .select("id")
    .eq("registration_id", clientId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  for (const row of data || []) {
    const simulation = await getSimulation(row.id, auth);
    if (simulation && countPresentationScenes(simulation) > 0) return simulation;
  }
  return null;
}

/** Ficha: prepara a mensagem (texto + link) da lista personalizada. Guard e escopo: getSimulationRegistration(id, auth). */
export async function prepareClientDocumentsList(clientId, auth, origin = "") {
  const registration = await getSimulationRegistration(clientId, auth);
  if (!registration) return { kind: "not_found" };
  const result = await prepareDocumentsList({
    client: { id: registration.id, fullName: registration.fullName, status: registration.status },
    findSimulation: () => findLatestSimulationWithValues(registration.id, auth),
    ensurePresentation: (simulation) => ensurePresentation({ simulation, userId: auth.profile?.id || "" }),
    origin
  });
  return result;
}

/** Ficha: o corretor confirmou o envio — registra na jornada (não muda status). Retorna false se o cliente não pode receber. */
export async function recordClientDocumentsListSent(clientId, auth) {
  const registration = await getSimulationRegistration(clientId, auth);
  if (!registration) return { kind: "not_found" };
  if (!canTouchClientOnForecast(registration.status)) return { kind: "blocked" };
  await logClientJourneyEvent({ clientId: registration.id, eventType: DOCUMENTS_LIST_SENT_EVENT, actor: resolveActorSnapshot(auth), details: { text: "Lista de documentos enviada" } });
  return { kind: "ok" };
}
