import { ipMatchesNetworks } from "./office-presence-core.mjs";

// Lote de SMS do CORRETOR só na imobiliária (PRO-18e, dono, 2026-11-02): o corretor só usa o lote enquanto a requisição de AGORA
// chega pelo Wi-Fi/IP da imobiliária. Mesma fonte de IP da ROL-2f (crm_settings 'office_presence' -> networks, lib/office-presence*):
// `ipMatchesNetworks` (IPv4 exato; IPv6 pelo /64) e o IP da requisição por `clientIpFromHeaders` (x-forwarded-for). Regras puras;
// testes em tests/sms-batch-office.test.mjs. Só o admin geral nunca é barrado (desde 2026-11-03 o gestor também é verificado).
export const SMS_BATCH_OFFICE_ONLY_CODE = "SMS_BATCH_OFFICE_ONLY";
export const SMS_BATCH_OFFICE_ONLY_MESSAGE = "O Lote de SMS só funciona no Wi-Fi da imobiliária. Conecte-se ao Wi-Fi do escritório.";
// Fora da imobiliária só estas gravações são aceitas: o SMS JÁ foi enviado e estava na fila do aparelho — não pode se perder.
export const SMS_BATCH_WHATSAPP_REQUIRED_CODE = "SMS_BATCH_WHATSAPP_REQUIRED";
export const SMS_BATCH_WHATSAPP_REQUIRED_MESSAGE = "Para usar o Lote de SMS, conecte o seu WhatsApp ao CRM (toque no ícone do WhatsApp no topo e leia o QR).";
export const SMS_BATCH_OFFICE_RECORD_ACTIONS = Object.freeze(["sent", "sent-2"]);

// { allowed, inOffice, unverified, recordOnly, reason }
// - scope: "team" | "broker" (smsBatchScope); só "team" (admin geral) fica de fora.
// - networks: lista cadastrada em Supervisão › Online. Vazia = não há como verificar: NÃO bloqueia (unverified = true).
// - action: nome da ação da rota ("load" para a leitura da lista).
export function smsOfficeDecision({ scope = "", networks = [], ip = "", action = "load" } = {}) {
  // Dono, 2026-11-03: vale para todo perfil que não é admin geral (corretor e gestor).
  if (!scope || scope === "team") return { allowed: true, inOffice: null, unverified: false, recordOnly: false, reason: "not_broker" };
  if (!Array.isArray(networks) || !networks.length) return { allowed: true, inOffice: null, unverified: true, recordOnly: false, reason: "no_networks" };
  if (ipMatchesNetworks(ip, networks)) return { allowed: true, inOffice: true, unverified: false, recordOnly: false, reason: "in_office" };
  if (SMS_BATCH_OFFICE_RECORD_ACTIONS.includes(action)) return { allowed: true, inOffice: false, unverified: false, recordOnly: true, reason: "queued_record" };
  return { allowed: false, inOffice: false, unverified: false, recordOnly: false, reason: "outside_office" };
}
