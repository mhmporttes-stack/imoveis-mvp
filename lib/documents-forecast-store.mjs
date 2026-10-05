// Gravação da "previsão de envio dos documentos" (round 4). SEM "server-only" e com o acesso ao banco INJETADO
// (`supabase`, `recordStatusChange`, `logJourney`) para ser testado com um banco falso (tests/documents-forecast.test.mjs).
// Quem liga isto ao banco real é lib/documents-forecast.js.
//
// Regras: ver lib/documents-forecast-core.mjs e docs/BUSINESS_RULES.md PRES-17. Resumo do que é gravado e QUANDO:
//  - sempre (menos "Não contactar"): o compromisso na linha de simulation_presentations (data, período, quando, contagem);
//  - cliente com responsável ATIVO e WhatsApp válido (e não arquivado): status -> "Aguardando documentação" (lista fechada de
//    origens, UPDATE condicionado ao status lido, histórico como 'sistema') + UMA atividade na agenda do corretor (a mesma é
//    atualizada se o cliente confirmar de novo) + evento na jornada;
//  - "Não contactar": nada é gravado e nada volta ao cliente (resultado `blocked`).
import { isPresentationToken } from "./simulation-presentation-core.mjs";
import { toWhatsAppDigits } from "./phone-utils.js";
import { resolveReceiveSimulationContact, RECEIVE_CONTACT_STATE } from "./receive-simulation-contact.mjs";
import {
  FORECAST_ACTIVITY_TITLE,
  FORECAST_ACTIVITY_TYPE,
  FORECAST_JOURNEY_EVENT,
  FORECAST_STATUS_CHANGED_BY,
  FORECAST_STATUS_SOURCE,
  buildBrokerWhatsappUrl,
  buildForecastActivity,
  buildDocumentsListMessage,
  buildForecastMessage,
  documentsListLink,
  documentsListImageUrl,
  canTouchClientOnForecast,
  forecastJourneyText,
  forecastScheduledAt,
  isForecastBlocked,
  nextStatusOnForecast
} from "./documents-forecast-core.mjs";

const PRESENTATIONS = "simulation_presentations";

function isMissingColumn(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42703" || code === "PGRST204" || (message.includes("docs_forecast") && (message.includes("does not exist") || message.includes("schema cache")));
}

/**
 * Atualiza (ou cria) a atividade da agenda deste cliente. Nunca duplica: procura uma atividade PENDENTE do mesmo cliente,
 * do tipo 'documentos' e com o título do sistema (mesmo se o corretor a reagendou: o reagendamento copia título e tipo);
 * se achar, muda data/observação e zera `notified_at` (o corretor é avisado de novo na nova hora); senão cria.
 */
export async function upsertForecastActivity({ supabase, clientId, responsibleUserId, data, periodo, now = new Date() }) {
  const fields = buildForecastActivity({ clientId, responsibleUserId, data, periodo });
  if (!fields) throw new Error("Atividade da previsão inválida.");
  const updatedAt = now.toISOString();
  const patch = {
    responsible_user_id: fields.responsible_user_id,
    scheduled_at: fields.scheduled_at,
    note: fields.note,
    notified_at: null,
    updated_at: updatedAt
  };

  const findExisting = async () => {
    const { data: rows, error } = await supabase
      .from("calendar_activities")
      .select("id")
      .eq("client_id", clientId)
      .eq("activity_type", FORECAST_ACTIVITY_TYPE)
      .eq("title", FORECAST_ACTIVITY_TITLE)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return rows?.[0] || null;
  };
  const updateExisting = async (id) => {
    const { error } = await supabase.from("calendar_activities").update(patch).eq("id", id);
    if (error) throw error;
    return { id, created: false, scheduledAt: fields.scheduled_at };
  };

  const existing = await findExisting();
  if (existing) return updateExisting(existing.id);

  const { data: inserted, error } = await supabase.from("calendar_activities").insert(fields).select("id").single();
  if (!error) return { id: inserted.id, created: true, scheduledAt: fields.scheduled_at };
  // 23505: duas confirmações quase juntas — o índice único parcial deixou passar só uma; a outra atualiza essa.
  if (String(error.code) === "23505") {
    const winner = await findExisting();
    if (winner) return updateExisting(winner.id);
  }
  throw error;
}

/**
 * Muda o status do cliente para "Aguardando documentação" se (e só se) o status atual está na lista fechada de origens.
 * UPDATE condicionado ao status lido (padrão de lib/whatsapp-client-status.js): quem chegou primeiro vale. Histórico como
 * 'sistema' (0 pontos; o marco "documentation" do ranking fica queimado — regra aceita pelo dono).
 */
export async function advanceClientStatusOnForecast({ supabase, recordStatusChange, client, now = new Date() }) {
  const next = nextStatusOnForecast(client.status);
  if (!next) return null;
  const changedAt = now.toISOString();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .update({ status: next, last_status_change_at: changedAt })
    .eq("id", client.id)
    .eq("status", client.status)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null; // o status mudou no meio do caminho
  await recordStatusChange({
    supabase,
    clientId: client.id,
    previousStatus: client.status,
    newStatus: next,
    changedAt,
    changedBy: FORECAST_STATUS_CHANGED_BY,
    source: FORECAST_STATUS_SOURCE
  });
  return { clientId: client.id, from: client.status, to: next };
}

/**
 * Confirmação pública (POST /api/s/<token>/documentos-previsao), já com o corpo validado por parseForecastBody.
 * Resultados: { kind: "not_found" } | { kind: "unavailable" } | { kind: "blocked" } |
 *             { kind: "ok", url, statusChanged, activity, recorded }
 * `url` só existe quando há responsável ativo com WhatsApp válido.
 */
export async function confirmDocumentsForecast({ supabase, recordStatusChange, logJourney, token, input, now = new Date() }) {
  if (!isPresentationToken(token)) return { kind: "not_found" };

  const { data: presentation, error: presentationError } = await supabase
    .from(PRESENTATIONS)
    .select("id, simulation_id, registration_id, status, docs_forecast_count")
    .eq("token", token)
    .maybeSingle();
  if (presentationError) {
    if (isMissingColumn(presentationError)) return { kind: "unavailable" };
    throw presentationError;
  }
  if (!presentation || presentation.status !== "active") return { kind: "not_found" };

  const { data: simulation, error: simulationError } = await supabase
    .from("simulations")
    .select("id, client_name, registration_id")
    .eq("id", presentation.simulation_id)
    .maybeSingle();
  if (simulationError) throw simulationError;

  const registrationId = presentation.registration_id || simulation?.registration_id || "";
  let client = null;
  if (registrationId) {
    const { data, error } = await supabase
      .from("simulation_registrations")
      .select("id, full_name, status, responsible_user_id")
      .eq("id", registrationId)
      .maybeSingle();
    if (error) throw error;
    client = data || null;
  }
  if (client && isForecastBlocked(client.status)) return { kind: "blocked" };

  let contact = { state: RECEIVE_CONTACT_STATE.WAITING };
  if (client?.responsible_user_id) {
    const { data: broker, error } = await supabase.from("admin_users").select("id, status, phone").eq("id", client.responsible_user_id).maybeSingle();
    if (error) throw error;
    contact = resolveReceiveSimulationContact({
      responsibleUserId: client.responsible_user_id,
      broker: broker ? { status: broker.status, whatsappDigits: toWhatsAppDigits(broker.phone) } : null
    });
  }
  const ready = contact.state === RECEIVE_CONTACT_STATE.READY;

  // Compromisso na apresentação (sempre; a data não é mostrada ao cliente depois).
  const { data: saved, error: saveError } = await supabase
    .from(PRESENTATIONS)
    .update({
      docs_forecast_date: input.data,
      docs_forecast_period: input.periodo,
      docs_forecast_at: now.toISOString(),
      docs_forecast_count: Math.min((Number(presentation.docs_forecast_count) || 0) + 1, 30000) // smallint: nunca estoura
    })
    .eq("id", presentation.id)
    .select("id")
    .maybeSingle();
  if (saveError) {
    if (isMissingColumn(saveError)) return { kind: "unavailable" };
    throw saveError;
  }
  if (!saved) return { kind: "not_found" };

  let statusChanged = null;
  let activity = null;
  if (client && ready && canTouchClientOnForecast(client.status)) {
    activity = await upsertForecastActivity({ supabase, clientId: client.id, responsibleUserId: client.responsible_user_id, data: input.data, periodo: input.periodo, now });
    statusChanged = await advanceClientStatusOnForecast({ supabase, recordStatusChange, client, now });
  }
  if (client) {
    await logJourney({
      clientId: client.id,
      eventType: FORECAST_JOURNEY_EVENT,
      actor: null,
      details: { text: forecastJourneyText(input), date: input.data, period: input.periodo, scheduledAt: forecastScheduledAt(input.data, input.periodo) }
    });
  }

  const message = buildForecastMessage({ fullName: client?.full_name || simulation?.client_name || "", data: input.data, periodo: input.periodo });
  return {
    kind: "ok",
    url: ready ? buildBrokerWhatsappUrl(contact.phone, message) : "",
    statusChanged,
    activity,
    recorded: true
  };
}

/**
 * Botão "Enviar lista de documentos" da ficha: monta a mensagem (texto + link) para o CORRETOR conferir e enviar.
 * Não grava status, não envia nada. O servidor garante a apresentação da simulação mais recente do cliente (get-or-create
 * idempotente: nunca cria um segundo link ativo) só para obter o token do link da lista personalizada.
 * `client`: { id, fullName, status }; `findSimulation()` → simulação com valores (ou null); `ensurePresentation(simulation)` →
 * { schemaReady, presentation }.
 * Resultados: { kind: "blocked" } (arquivado / não contactar) | { kind: "no_simulation" } | { kind: "unavailable" } |
 *             { kind: "ok", message, link }
 */
export async function prepareDocumentsList({ client, findSimulation, ensurePresentation, origin = "" }) {
  if (!client || !canTouchClientOnForecast(client.status)) return { kind: "blocked" };
  const simulation = await findSimulation();
  if (!simulation) return { kind: "no_simulation" };
  const result = await ensurePresentation(simulation);
  if (!result?.schemaReady || !result.presentation?.token) return { kind: "unavailable" };
  const link = documentsListLink(result.presentation.token, origin);
  const imageUrl = documentsListImageUrl(result.presentation.token, origin);
  return { kind: "ok", link, imageUrl, message: buildDocumentsListMessage({ fullName: client.fullName }) };
}
