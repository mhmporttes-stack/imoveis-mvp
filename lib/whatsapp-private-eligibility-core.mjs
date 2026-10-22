// Quem NÃO pode ir para conversa Particular (regra do dono, 2026-10-22 — WA-19b):
// "Um cliente que teve início/entrou no CRM pelo número oficial, link meu [do Matheus] ou da roleta, ou pelo chat do
// Marketplace não deve ter opção de ser colocado em conversa particular."
// Puro e testado (tests/whatsapp-private-eligibility.test.mjs). Fonte única: a barreira do servidor
// (setChatConversationPrivate, lib/whatsapp-chat.js) e o botão do Chat leem esta função — não crie outra checagem.
// A origem é a da ENTRADA do cliente (acquisition_context, gravado no cadastro e nunca reescrito); distribution_type
// só serve de reserva para cadastro antigo sem origem gravada (uma redistribuição posterior não muda a entrada).

const OFFICIAL_SESSION_KEY = "00000000-0000-0000-0000-000000000000";

// Origens gravadas por quem cadastra o cliente a partir do número oficial (lib/whatsapp-sponsored-lead.js e
// lib/whatsapp-automation-replies.js): contato direto, anúncio de WhatsApp e resposta ao Disparo.
const OFFICIAL_KINDS = new Set(["whatsapp_organic", "whatsapp_ad", "whatsapp_reply"]);
// Link da roleta (?ref=equipe) e Link Geral do site (vai pela roleta desde 2026-09-30) — lib/lead-origin.js.
const ROULETTE_KINDS = new Set(["roulette_link", "site"]);
// Destino gravado pela distribuição automática (roleta, fila de espera, "Atendimento automático" do anúncio).
const ROULETTE_DESTINATIONS = new Set(["roulette", "owner_waiting"]);
const ROULETTE_DISTRIBUTION_TYPES = new Set(["round_robin", "whatsapp_ad_waiting"]);
const MARKETPLACE_KIND = "facebook_marketplace";

export const PRIVATE_BLOCK_LABELS = {
  official: "pelo número oficial",
  owner_link: "pelo link do Matheus",
  roulette: "pela roleta",
  marketplace: "pelo Chat do Marketplace"
};

function normalizeRef(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

// Motivo do bloqueio (official | owner_link | roulette | marketplace) ou null quando pode ir para Particular.
// conversation: { session_key }; client: { acquisition_context, distribution_type } do cadastro ligado (ou null);
// ownerRefs: referências de link do dono (simulation_ref, captacao_ref, short_ref); hasMarketplaceConversation: o
// cliente está ligado a uma conversa do Chat do Marketplace (marketplace_conversations.client_id).
export function motivoBloqueioParticular({ conversation = null, client = null, ownerRefs = [], hasMarketplaceConversation = false } = {}) {
  const sessionKey = conversation?.session_key ?? conversation?.sessionKey ?? null;
  if (sessionKey === OFFICIAL_SESSION_KEY) return "official";
  if (hasMarketplaceConversation) return "marketplace";
  if (!client) return null;
  const context = client.acquisition_context && typeof client.acquisition_context === "object" ? client.acquisition_context : {};
  const kind = String(context.kind || "");
  if (kind === MARKETPLACE_KIND) return "marketplace";
  if (OFFICIAL_KINDS.has(kind)) return "official";
  if (kind === "broker_link") {
    const ref = normalizeRef(context.metadata?.broker_ref);
    const owner = new Set((ownerRefs || []).map(normalizeRef).filter(Boolean));
    if (ref && owner.has(ref)) return "owner_link";
  }
  if (ROULETTE_KINDS.has(kind) || ROULETTE_DESTINATIONS.has(String(context.destination || ""))) return "roulette";
  if (!kind && ROULETTE_DISTRIBUTION_TYPES.has(String(client.distribution_type || ""))) return "roulette";
  return null;
}

export function clientePodeSerParticular(input = {}) {
  return motivoBloqueioParticular(input) === null;
}

export function privateBlockedMessage(reason) {
  const via = PRIVATE_BLOCK_LABELS[reason] || "pelo número oficial, roleta, link do Matheus ou Marketplace";
  return `Este cliente veio ${via} e não pode ir para conversa particular.`;
}
