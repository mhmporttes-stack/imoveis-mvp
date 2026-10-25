import { readCredential } from "../config/index.js";
import { UnsupportedOperationError } from "../utils/errors.js";
import { createGraphClient } from "./graph-client.js";
import { validateCloudRegistration, checkCloudConnection } from "./instances.js";
import { sendCloudMessage } from "./messages.js";
import { getCloudProfile, updateCloudProfile, uploadCloudProfilePhoto } from "./profile.js";
import { createCrmIndividualAdapter, CRM_INDIVIDUAL_PROVIDER } from "./crm-individual.js";

// Interface padronizada de provedor. Cada adaptador implementa (quando o provedor suporta):
//   supports(op) · configurationStatus(instance) · validateRegistration(instance) · checkConnection(instance)
//   sendMessage(instance, { to, campaign, callbackData }) · getMessageStatus(instance, message)
//   getProfile(instance) · updateProfile(instance, fields) · uploadProfilePhoto(instance, { url })
//   readDisplayName(instance)
// Eventos de conexão, entrega e mensagens de entrada chegam pelo webhook (whatsapp/webhooks.js).
// Operação não suportada lança UnsupportedOperationError — nunca simula sucesso.

export const META_CLOUD_PROVIDER = "meta_cloud_api";

export function createMetaCloudAdapter({ config, fetchImpl = globalThis.fetch, env = process.env }) {
  const graph = createGraphClient({
    baseUrl: config.WA_GRAPH_BASE_URL, version: config.WA_GRAPH_API_VERSION, fetchImpl, timeoutMs: config.SEND_TIMEOUT_MS
  });
  const tokenOf = (instance) => readCredential(instance.credential_ref || "WA_CLOUD_ACCESS_TOKEN", env);

  return {
    provider: META_CLOUD_PROVIDER,
    connectionType: "cloud_api",
    supports(op) {
      return ["validateRegistration", "checkConnection", "sendMessage", "getProfile", "updateProfile", "uploadProfilePhoto", "readDisplayName"].includes(op);
    },
    configurationStatus(instance) {
      if (!tokenOf(instance)) return { ok: false, reason: `token ausente na variável ${instance.credential_ref || "WA_CLOUD_ACCESS_TOKEN"}` };
      const problems = validateCloudRegistration(instance);
      return problems.length ? { ok: false, reason: problems.join("; ") } : { ok: true };
    },
    validateRegistration: validateCloudRegistration,
    checkConnection: (instance) => checkCloudConnection(graph, tokenOf(instance), instance),
    sendMessage: (instance, payload) => sendCloudMessage(graph, tokenOf(instance), instance, payload),
    // A Cloud API não tem consulta de status por mensagem: a confirmação vem só pelo webhook.
    async getMessageStatus() { throw new UnsupportedOperationError(META_CLOUD_PROVIDER, "getMessageStatus"); },
    getProfile: (instance) => getCloudProfile(graph, tokenOf(instance), instance),
    updateProfile: (instance, fields) => updateCloudProfile(graph, tokenOf(instance), instance, fields),
    uploadProfilePhoto: (instance, { url }) =>
      uploadCloudProfilePhoto(graph, tokenOf(instance), instance, { url, appId: config.WA_APP_ID, fetchImpl, timeoutMs: config.SEND_TIMEOUT_MS }),
    async readDisplayName(instance) {
      const result = await checkCloudConnection(graph, tokenOf(instance), instance);
      return { verifiedName: result.details.verified_name, nameStatus: result.details.name_status };
    }
  };
}

export function createAdapterRegistry({ config, fetchImpl, env } = {}) {
  const adapters = new Map();
  adapters.set(META_CLOUD_PROVIDER, createMetaCloudAdapter({ config, fetchImpl, env }));
  adapters.set(CRM_INDIVIDUAL_PROVIDER, createCrmIndividualAdapter({ config, fetchImpl }));
  return {
    get(provider) {
      const adapter = adapters.get(provider);
      if (!adapter) throw new Error(`Provedor desconhecido: ${provider}`);
      return adapter;
    },
    // Usado só pelos testes para injetar um adaptador de teste (nome deixa isso explícito).
    registerForTests(provider, adapter) {
      adapters.set(provider, adapter);
    },
    providers: () => [...adapters.keys()]
  };
}
