import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getSimulationRegistration } from "./simulation-registrations";
import { assertGeneralAdminOrManager } from "./admin-access";
import { DOCUMENT_TYPE_OPTIONS } from "./document-type-options";
import { toWhatsAppDigits } from "./phone-utils";

function db() {
  return getSupabaseAdminClient();
}

function labelFor(documentType) {
  return DOCUMENT_TYPE_OPTIONS.find((option) => option.key === documentType)?.label || documentType;
}

function dedupe(list) {
  return Array.from(new Set(list));
}

// Monta a mensagem pronta pro corretor (item 1 do pedido) — sempre gestor/
// admin, nunca o corretor comum (é ele quem recebe o aviso). Cruza o
// checklist ATUAL do cliente (mesma fonte usada na tela) em 3 categorias:
// - "Documentação pendente": requisitos calculados pelo motor que ainda
//   faltam (document_id nulo, status ausente/pendencia).
// - "Documentos vencidos": documentos REALMENTE enviados mas com validade
//   vencida (extracted_data.expired, marcado pela IA na classificação).
// - "Documentos inelegíveis": documentos enviados mas ilegíveis ou com dado
//   divergente — não servem como estão.
// Retorna null quando não há nada a avisar (nenhum item nas 3 categorias).
export async function buildBrokerAlertMessage(clientId, auth) {
  assertGeneralAdminOrManager(auth);
  const registration = await getSimulationRegistration(clientId, auth);
  if (!registration) throw new Error("Cliente não encontrado.");

  const { data: items, error } = await db().from("client_document_checklist_items").select("document_id, document_type, status, extracted_data").eq("client_id", clientId);
  if (error) throw error;

  const pending = [];
  const expired = [];
  const ineligible = [];

  for (const row of items || []) {
    const label = labelFor(row.document_type);
    if (!row.document_id) {
      if (row.status === "ausente" || row.status === "pendencia") pending.push(label);
    } else {
      if (row.extracted_data?.expired) expired.push(label);
      if (row.status === "ilegivel" || row.status === "divergencia") ineligible.push(label);
    }
  }

  const pendingList = dedupe(pending);
  const expiredList = dedupe(expired);
  const ineligibleList = dedupe(ineligible);
  if (!pendingList.length && !expiredList.length && !ineligibleList.length) return null;

  const brokerName = await getBrokerName(registration.responsibleUserId);
  const brokerPhone = await getBrokerPhone(registration.responsibleUserId);

  const parts = [`Olá${brokerName ? " " + brokerName.split(" ")[0] : ""}! Segue um alerta sobre a documentação de um cliente seu:`, "", `Cliente: ${registration.fullName}`, `Telefone: ${registration.phone || "não informado"}`];
  if (pendingList.length) parts.push("", "📋 Documentação pendente:", ...pendingList.map((label) => `• ${label}`));
  if (expiredList.length) parts.push("", "⏰ Documentos vencidos:", ...expiredList.map((label) => `• ${label}`));
  if (ineligibleList.length) parts.push("", "⚠️ Documentos inelegíveis:", ...ineligibleList.map((label) => `• ${label}`));

  const message = parts.join("\n");
  return {
    message,
    brokerName,
    brokerPhone,
    whatsappUrl: brokerPhone ? `https://wa.me/${toWhatsAppDigits(brokerPhone)}?text=${encodeURIComponent(message)}` : null
  };
}

async function getBrokerName(brokerId) {
  if (!brokerId) return "";
  const { data } = await db().from("admin_users").select("name").eq("id", brokerId).maybeSingle();
  return data?.name || "";
}

async function getBrokerPhone(brokerId) {
  if (!brokerId) return "";
  const { data } = await db().from("admin_users").select("phone").eq("id", brokerId).maybeSingle();
  return data?.phone || "";
}
