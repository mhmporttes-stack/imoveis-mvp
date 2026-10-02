// Telefones da EQUIPE (regra do dono, 2026-10-02): conversa de WhatsApp entre
// integrantes da equipe nunca vira cliente sozinha. Puro e testado
// (tests/internal-phones-core.test.mjs); a leitura do banco fica em
// lib/internal-phones.js.
//
// Identidade = telefone (nunca o nome): comparação por phoneComparisonKey,
// que já trata DDI, 9º dígito e formatação — o mesmo critério do resto do
// WhatsApp. LID nunca chega aqui: o microsserviço já converte para telefone
// (senderPn / mapa LID), e mensagem sem telefone é descartada antes.
import { phoneComparisonKey } from "./phone-utils.js";

// entries: [{ userId, name, phone }] — telefone do cadastro (admin_users.phone)
// e números de WhatsApp conectados/já conectados (whatsapp_individual_sessions).
export function buildInternalPhoneIndex(entries = []) {
  const index = new Map();
  for (const entry of entries) {
    const key = phoneComparisonKey(entry?.phone);
    // Chave curta demais = número inválido/incompleto; nunca casa por engano.
    if (!key || key.replace(/\D/g, "").length < 10) continue;
    if (!index.has(key)) index.set(key, { userId: entry.userId || null, name: entry.name || "" });
  }
  return index;
}

// -> { userId, name } do integrante da equipe dono deste telefone, ou null.
export function findInternalPhone(index, phone) {
  const key = phoneComparisonKey(phone);
  if (!key || !index) return null;
  return index.get(key) || null;
}
