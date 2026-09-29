import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { getSimulationRegistration } from "./simulation-registrations";
import { getCcaStatusStageByKey, getCcaStatusStage } from "./cca-status-stages";
import { getCca } from "./cca";
import { logClientJourneyEvent, resolveActorSnapshot } from "./client-journey";

// Motor do acompanhamento de aprovação pós-envio à CCA (client_cca_status_history).
// Nunca sobrescreve uma linha: toda mudança fecha a aberta (exited_at) e abre
// uma nova — histórico completo de por onde o cliente já passou. No máximo 1
// linha aberta por cliente (trava por índice único parcial no banco).
//
// Confirmado com o dono: isso NUNCA muda simulation_registrations.status —
// a única transição automática do status principal continua sendo a que já
// existe hoje (enviar à CCA → APPROVAL_PENDING, em lib/client-documents.js).

const AWAITING_CCA_RETURN_KEY = "awaiting_cca_return";

export function canManageClientCcaStatus() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Chamada de dentro de submitToCca (lib/client-documents.js), logo após o
// envio já ter sido validado ali — sem checagem de auth própria (o chamador
// já validou acesso/permissão do envio).
export async function openInitialCcaStatusOnSend({ clientId, ccaId, auth }) {
  const stage = await getCcaStatusStageByKey(AWAITING_CCA_RETURN_KEY);
  if (!stage) return null;

  await closeOpenRow(clientId);

  const { data, error } = await db().from("client_cca_status_history").insert({
    client_id: clientId,
    cca_id: ccaId,
    status_id: stage.id,
    entered_at: new Date().toISOString(),
    created_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;
  return rowToHistoryEntry(data, stage, null);
}

// Sem checagem de auth — uso interno (ex.: card do cliente, que já passou
// pela permissão de visualizar aquele cliente antes de chegar aqui).
export async function getCurrentCcaStatus(clientId) {
  if (!clientId) return null;
  const { data, error } = await db()
    .from("client_cca_status_history")
    .select("*")
    .eq("client_id", clientId)
    .is("exited_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [stage, cca] = await Promise.all([getCcaStatusStage(data.status_id), getCca(data.cca_id)]);
  return rowToHistoryEntry(data, stage, cca);
}

export async function changeCcaStatus({ clientId, statusId, ccaId, observation, auth }) {
  assertGeneralAdminOrManager(auth);
  if (!clientId) throw new Error("Cliente inválido.");
  if (!statusId) throw new Error("Selecione um status.");

  const current = await getCurrentCcaStatus(clientId);
  if (!current) throw new Error("Este cliente ainda não foi enviado a nenhuma CCA.");

  const stage = await getCcaStatusStage(statusId);
  if (!stage) throw new Error("Status inválido.");

  const nextCcaId = ccaId || current.cca?.id;
  const cca = nextCcaId ? await getCca(nextCcaId) : null;
  if (!cca) throw new Error("Selecione uma CCA válida.");

  await closeOpenRow(clientId);

  const { data, error } = await db().from("client_cca_status_history").insert({
    client_id: clientId,
    cca_id: cca.id,
    status_id: stage.id,
    observation: cleanObservation(observation),
    entered_at: new Date().toISOString(),
    created_by: auth?.profile?.id || null
  }).select("*").single();
  if (error) throw error;

  try {
    await logClientJourneyEvent({
      clientId,
      eventType: "cca_status_changed",
      actor: resolveActorSnapshot(auth),
      details: {
        fromStatusLabel: current.status?.label || null,
        toStatusLabel: stage.label,
        ccaName: cca.name,
        observation: cleanObservation(observation)
      }
    });
  } catch {
    // Timeline é best-effort — nunca derruba a mudança de status por causa dela.
  }

  return rowToHistoryEntry(data, stage, cca);
}

export async function listCcaStatusHistory(clientId, auth) {
  const registration = await getSimulationRegistration(clientId, auth);
  if (!registration) throw new Error("Cliente não encontrado.");

  const { data, error } = await db()
    .from("client_cca_status_history")
    .select("*")
    .eq("client_id", clientId)
    .order("entered_at", { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const statusIds = [...new Set(rows.map((row) => row.status_id))];
  const ccaIds = [...new Set(rows.map((row) => row.cca_id))];
  const [stages, ccas] = await Promise.all([
    Promise.all(statusIds.map((id) => getCcaStatusStage(id))),
    Promise.all(ccaIds.map((id) => getCca(id)))
  ]);
  const stageById = new Map(stages.filter(Boolean).map((stage) => [stage.id, stage]));
  const ccaById = new Map(ccas.filter(Boolean).map((cca) => [cca.id, cca]));

  return rows.map((row) => rowToHistoryEntry(row, stageById.get(row.status_id) || null, ccaById.get(row.cca_id) || null));
}

async function closeOpenRow(clientId) {
  const { error } = await db()
    .from("client_cca_status_history")
    .update({ exited_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .is("exited_at", null);
  if (error) throw error;
}

function cleanObservation(value) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 2000) : null;
}

function rowToHistoryEntry(row, stage, cca) {
  return {
    id: row.id,
    clientId: row.client_id,
    observation: row.observation || "",
    enteredAt: row.entered_at,
    exitedAt: row.exited_at,
    status: stage ? { id: stage.id, key: stage.key, label: stage.label } : null,
    cca: cca ? { id: cca.id, name: cca.name } : null
  };
}
