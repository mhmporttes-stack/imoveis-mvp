import { ProviderError } from "../utils/errors.js";
import { sanitizeText } from "../utils/logger.js";

// Cliente HTTP mínimo da Graph API (WhatsApp Cloud API oficial da Meta).
// Referências: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
//
// Regra de classificação (o que importa para NÃO reenviar às cegas):
//  - A Graph respondeu com um objeto `error` → o pedido foi recusado (nenhuma mensagem criada): temporária ou permanente
//    conforme o código.
//  - Sem resposta definitiva (tempo esgotado, conexão caída depois de enviar, 5xx sem corpo da Graph) → `unknown` em
//    operações de envio: pode ter saído. Antes de mandar o pedido (DNS/conexão recusada) → temporária.

const TEMPORARY_CODES = new Set(["1", "2", "4", "80007", "130429", "131000", "131016", "131056", "131057", "133004", "2494100"]);
const RATE_LIMIT_CODES = new Set(["4", "80007", "130429", "131056"]);
const AUTH_CODES = new Set(["0", "3", "10", "190", "131005"]);
const RESTRICTED_CODES = new Set(["368", "130497", "131031", "131042"]);
const QUALITY_CODES = new Set(["131048", "131064"]);
const DISCONNECTED_CODES = new Set(["33", "131045", "133010"]);
const TEMPLATE_CODES = new Set(["131063", "132000", "132001", "132005", "132007", "132012", "132015", "132016", "132018"]);
// O cliente pediu para não receber marketing da empresa: vai para a lista de não contato.
export const RECIPIENT_OPT_OUT_CODES = new Set(["131050"]);

export function classifyGraphError(httpStatus, error) {
  const code = String(error?.code ?? "");
  const message = sanitizeText(error?.message || error?.error_user_msg || `HTTP ${httpStatus}`);
  if (AUTH_CODES.has(code) || (Number(code) >= 200 && Number(code) <= 299) || httpStatus === 401) {
    return new ProviderError(message, { kind: "permanent", code, httpStatus, instanceImpact: "auth" });
  }
  if (RESTRICTED_CODES.has(code)) return new ProviderError(message, { kind: "permanent", code, httpStatus, instanceImpact: "restricted" });
  if (QUALITY_CODES.has(code)) return new ProviderError(message, { kind: "permanent", code, httpStatus, instanceImpact: "quality" });
  if (DISCONNECTED_CODES.has(code)) return new ProviderError(message, { kind: "permanent", code, httpStatus, instanceImpact: "disconnected" });
  if (TEMPLATE_CODES.has(code)) return new ProviderError(message, { kind: "permanent", code, httpStatus, instanceImpact: "template" });
  if (TEMPORARY_CODES.has(code) || httpStatus === 429) {
    return new ProviderError(message, { kind: "temporary", code, httpStatus, instanceImpact: RATE_LIMIT_CODES.has(code) || httpStatus === 429 ? "rate_limited" : null });
  }
  if (code) return new ProviderError(message, { kind: "permanent", code, httpStatus });
  return null;
}

const PRE_SEND_NETWORK = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

export function createGraphClient({ baseUrl, version, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  const root = `${String(baseUrl).replace(/\/+$/, "")}/${version}`;

  async function request(method, path, { token, query, json, body, headers = {}, sendOperation = false, authScheme = "Bearer" } = {}) {
    if (!token) throw new ProviderError("Credencial do provedor não configurada.", { kind: "permanent", instanceImpact: "not_configured" });
    const url = new URL(`${root}${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    const init = { method, headers: { Authorization: `${authScheme} ${token}`, ...headers }, signal: AbortSignal.timeout(timeoutMs) };
    if (json !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(json);
    } else if (body !== undefined) {
      init.body = body;
    }
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const causeCode = error?.cause?.code || error?.code || "";
      const preSend = PRE_SEND_NETWORK.has(causeCode);
      const kind = sendOperation && !preSend ? "unknown" : "temporary";
      throw new ProviderError(sanitizeText(`Falha de rede com a Graph API (${error?.name || "erro"} ${causeCode})`), { kind, code: causeCode || error?.name || null });
    }
    const text = await response.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (response.ok) return data ?? {};
    const classified = data?.error ? classifyGraphError(response.status, data.error) : null;
    if (classified) throw classified;
    if (response.status >= 500 || response.status === 0) {
      throw new ProviderError(`Graph API respondeu ${response.status} sem erro identificável.`, { kind: sendOperation ? "unknown" : "temporary", httpStatus: response.status });
    }
    if (response.status === 429) throw new ProviderError("Graph API: limite de requisições.", { kind: "temporary", httpStatus: 429, instanceImpact: "rate_limited" });
    throw new ProviderError(`Graph API respondeu ${response.status}.`, { kind: "permanent", httpStatus: response.status });
  }

  return { request, root };
}
