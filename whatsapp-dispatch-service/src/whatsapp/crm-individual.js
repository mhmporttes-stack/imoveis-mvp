import { ProviderError, UnsupportedOperationError } from "../utils/errors.js";
import { digitsOf } from "../utils/phone.js";
import { sanitizeText } from "../utils/logger.js";

// Adaptador opcional para o whatsapp-individual-service JÁ EXISTENTE (Railway, Baileys), pelas rotas HTTP que ele
// já expõe (whatsapp-individual-service/src/server.js), autenticadas por X-Service-Secret:
//   GET  /sessions/:userId/status → { status, phoneNumber?, lastConnectedAt?, error? }
//   POST /sessions/:userId/send   { to, text } → { waMessageId, remoteJid }  (409 NOT_CONNECTED, 422 NOT_ON_WHATSAPP)
// Não suportado por esse serviço (e portanto aqui): template, consulta de status de mensagem, confirmação de entrega
// para este serviço (os eventos vão para o CRM), perfil comercial e foto do próprio número, criação de sessão
// (QR/pareamento continuam pelo CRM).
export const CRM_INDIVIDUAL_PROVIDER = "crm_individual";

export function createCrmIndividualAdapter({ config, fetchImpl = globalThis.fetch }) {
  const baseUrl = String(config.WHATSAPP_INDIVIDUAL_SERVICE_URL || "").replace(/\/+$/, "");
  const secret = config.WHATSAPP_INDIVIDUAL_SERVICE_SECRET || "";
  const timeoutMs = config.SEND_TIMEOUT_MS;

  function userIdOf(instance) {
    return String(instance.provider_config?.crm_user_id || "");
  }

  async function call(method, path, json, { sendOperation = false } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Service-Secret": secret },
        body: json ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const code = error?.cause?.code || error?.name || "";
      const preSend = ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"].includes(code);
      throw new ProviderError(`Falha de rede com o whatsapp-individual-service (${code}).`, { kind: sendOperation && !preSend ? "unknown" : "temporary", code });
    }
    const data = await response.json().catch(() => null);
    if (response.ok) return data || {};
    const message = sanitizeText(data?.error || `HTTP ${response.status}`);
    if (response.status === 401) throw new ProviderError(message, { kind: "permanent", httpStatus: 401, instanceImpact: "auth" });
    if (response.status === 409) throw new ProviderError(message, { kind: "temporary", httpStatus: 409, code: data?.code || "NOT_CONNECTED", instanceImpact: "disconnected" });
    if (response.status === 422) throw new ProviderError(message, { kind: "permanent", httpStatus: 422, code: data?.code || "NOT_ON_WHATSAPP" });
    if (response.status === 503 || response.status === 429) throw new ProviderError(message, { kind: "temporary", httpStatus: response.status });
    if (response.status === 400) throw new ProviderError(message, { kind: "permanent", httpStatus: 400 });
    // 500 do serviço depois de chamar o WhatsApp: a mensagem pode ter saído.
    throw new ProviderError(message, { kind: sendOperation ? "unknown" : "temporary", httpStatus: response.status });
  }

  return {
    provider: CRM_INDIVIDUAL_PROVIDER,
    connectionType: "crm_individual_session",
    supports(op) {
      return ["validateRegistration", "checkConnection", "sendMessage"].includes(op);
    },
    configurationStatus(instance) {
      if (!baseUrl || !secret) return { ok: false, reason: "WHATSAPP_INDIVIDUAL_SERVICE_URL/WHATSAPP_INDIVIDUAL_SERVICE_SECRET não configurados" };
      if (!userIdOf(instance)) return { ok: false, reason: "provider_config.crm_user_id ausente" };
      return { ok: true };
    },
    validateRegistration(instance) {
      return /^[0-9a-f-]{36}$/i.test(userIdOf(instance)) ? [] : ["provider_config.crm_user_id deve ser o id (uuid) do usuário do CRM dono da sessão"];
    },
    async checkConnection(instance) {
      const data = await call("GET", `/sessions/${encodeURIComponent(userIdOf(instance))}/status`);
      const status = String(data.status || "");
      const details = { provider_status: status || null, last_connected_at: data.lastConnectedAt || null };
      if (status !== "connected") return { connected: false, state: "disconnected", reason: `session_${status || "unknown"}`, details };
      if (data.phoneNumber && digitsOf(data.phoneNumber) !== digitsOf(instance.phone_e164)) {
        return { connected: false, state: "error", reason: "phone_mismatch", details };
      }
      return { connected: true, state: "connected", details };
    },
    async sendMessage(instance, { to, campaign }) {
      if (campaign.message_type !== "text") {
        throw new ProviderError("O whatsapp-individual-service não envia templates da Meta.", { kind: "permanent", code: "unsupported_message_type" });
      }
      const data = await call("POST", `/sessions/${encodeURIComponent(userIdOf(instance))}/send`, { to: digitsOf(to), text: campaign.text_body }, { sendOperation: true });
      if (!data.waMessageId) throw new ProviderError("Serviço não devolveu o id da mensagem.", { kind: "unknown" });
      return { providerMessageId: `crm_individual:${data.waMessageId}`, pacingStatus: null };
    },
    async getProfile() { throw new UnsupportedOperationError(CRM_INDIVIDUAL_PROVIDER, "getProfile"); },
    async updateProfile() { throw new UnsupportedOperationError(CRM_INDIVIDUAL_PROVIDER, "updateProfile"); },
    async uploadProfilePhoto() { throw new UnsupportedOperationError(CRM_INDIVIDUAL_PROVIDER, "uploadProfilePhoto"); },
    async getMessageStatus() { throw new UnsupportedOperationError(CRM_INDIVIDUAL_PROVIDER, "getMessageStatus"); }
  };
}
