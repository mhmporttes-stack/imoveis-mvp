import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { cleanSmsToken } from "./sms-batch-token-core.mjs";
import { isMissingLinksTable, linkSmsRegistration, listSmsClickers, listSmsLinksByRegistration, readSmsContact, recordSmsLink, recordSmsLinkClick, smsLinkSecret, smsTokenForContact } from "./sms-batch-links.mjs";

// Lote de SMS: link único por contato (PRO-18f) — cola fina com o banco real. Arquivo enxuto de propósito: a rota PÚBLICA de
// clique (/api/campaigns/track-view) e o cadastro (lib/simulation-registrations.js) o usam sem carregar o Lote inteiro.
// Tudo aqui é MELHOR ESFORÇO para o visitante/cadastro (nunca derruba a abertura do link nem o cadastro do cliente): falha
// real do banco vira aviso no log do servidor (não é silenciada), tabela ausente (migration pendente) é ignorada de propósito.

function client() {
  return hasSupabaseAdminConfig ? getSupabaseAdminClient() : null;
}

function warn(label, error) {
  if (!isMissingLinksTable(error)) console.warn(`Lote de SMS (link por contato): ${label}:`, error?.message || error);
}

export { smsTokenForContact, smsLinkSecret, listSmsClickers, listSmsLinksByRegistration };

/** Token do contato com o segredo do servidor ("" sem segredo: o link segue sem token). */
export function smsTokenFor(contactId) {
  return smsTokenForContact(contactId, smsLinkSecret());
}

/** Envio gravado (markSmsSent): cria/atualiza a linha do token. Nunca derruba o envio já gravado. */
export async function recordSmsLinkForSend({ contactId, phone, campaignId, sentBy }) {
  const db = client();
  const token = smsTokenFor(contactId);
  if (!db || !token) return { status: "skipped" };
  try {
    return await recordSmsLink(db, { token, contactId, phone, campaignId, sentBy });
  } catch (error) {
    warn("não gravou o token do envio", error);
    return { status: "skipped" };
  }
}

/** Clique vindo do navegador (track-view). Token fora do formato: nada. */
export async function recordSmsLinkClickSafe(token) {
  const db = client();
  if (!db || !cleanSmsToken(token)) return { counted: false };
  try {
    return await recordSmsLinkClick(db, token);
  } catch (error) {
    warn("clique não registrado", error);
    return { counted: false };
  }
}

/** Cadastro de cliente (novo ou reenvio) que veio com `attribution.sms_t`: liga o cliente ao token. */
export async function linkSmsRegistrationSafe(attribution, registrationId, campaignId = "") {
  const db = client();
  const token = cleanSmsToken(attribution?.sms_t);
  if (!db || !token || !registrationId) return { linked: false };
  try {
    return await linkSmsRegistration(db, token, registrationId, new Date(), campaignId);
  } catch (error) {
    warn("cadastro não ligado ao token", error);
    return { linked: false };
  }
}

/**
 * Contato (nome + telefone da base) do token, SÓ para o servidor completar o cadastro e montar a visão mascarada do formulário
 * curto (PRO-18h). null = não resolve (formulário igual ao de sempre). Falha real do banco: aviso no log e null — o formulário
 * volta ao de sempre; o cadastro nunca recebe dado que o servidor não conseguiu confirmar.
 */
export async function resolveSmsContact(token) {
  const db = client();
  if (!db || !cleanSmsToken(token)) return null;
  try {
    const smsContact = await readSmsContact(db, token);
    if (smsContact) return smsContact;
    // Fluxo do anúncio no número Oficial (WA-40): o link "Descubra seu poder de compra" leva um token do MESMO formato, que
    // resolve ao nome do perfil do WhatsApp + telefone do atendimento (formulário curto, sem as perguntas de nome/telefone).
    const { readOfficialAdFlowContact } = await import("./official-ad-flow");
    return await readOfficialAdFlowContact(cleanSmsToken(token));
  } catch (error) {
    warn("contato do token não resolvido", error);
    return null;
  }
}
