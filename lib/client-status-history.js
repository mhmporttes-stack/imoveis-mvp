import { CLIENT_STATUS, normalizeClientStatus } from "./client-status";

const STATUS_HISTORY_TABLE = "client_status_history";

export async function recordClientStatusChange({
  supabase,
  clientId,
  previousStatus,
  newStatus,
  changedAt,
  changedBy
}) {
  if (!supabase || !clientId || newStatus === undefined) return null;

  const previous = previousStatus ? normalizeClientStatus(previousStatus) : null;
  const next = normalizeClientStatus(newStatus);
  if (previous === next) return null;

  const { data, error } = await supabase
    .from(STATUS_HISTORY_TABLE)
    .insert({
      client_id: clientId,
      previous_status: previous,
      new_status: next,
      changed_at: changedAt || new Date().toISOString(),
      changed_by: normalizeChangedBy(changedBy)
    })
    .select("*")
    .single();

  if (error) {
    if (isClientStatusHistorySchemaError(error)) {
      console.warn(
        "client_status_history ainda nao existe. Execute a migration supabase/migrations/20260814_client_status_history.sql."
      );
      return null;
    }
    throw error;
  }

  return data;
}

export function isClientStatusHistorySchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes(STATUS_HISTORY_TABLE) ||
    message.includes("schema cache") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

export function statusHistoryEventLabel(status) {
  const normalized = normalizeClientStatus(status);
  const labels = {
    [CLIENT_STATUS.PENDING]: "Cliente aguardando simulação",
    [CLIENT_STATUS.COMPLETED]: "Simulação realizada",
    [CLIENT_STATUS.DOCUMENTATION]: "Cliente aguardando documentação",
    [CLIENT_STATUS.DOCUMENTS_PENDING]: "Documentação recebida com pendência",
    [CLIENT_STATUS.APPROVAL_PENDING]: "Cliente enviado para aprovação",
    [CLIENT_STATUS.SHIELDING]: "Cliente em blindagem",
    [CLIENT_STATUS.APPROVED]: "Crédito aprovado",
    [CLIENT_STATUS.REJECTED]: "Crédito não aprovado",
    [CLIENT_STATUS.SALE_COMPLETED]: "Venda realizada",
    [CLIENT_STATUS.ARCHIVED]: "Cliente arquivado"
  };

  return labels[normalized] || "Status atualizado";
}

function normalizeChangedBy(value = "") {
  return String(value || "").trim().toLowerCase() || null;
}
