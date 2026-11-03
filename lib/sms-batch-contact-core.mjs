// Formulário curto do link do SMS (dono, 2026-11-03, PRO-18h) — regras PURAS (sem banco; testadas em
// tests/sms-batch-short-form.test.mjs). O contato do Lote já está na base com nome e telefone: com o token do link
// (`sms_t`) o formulário pula a pergunta do nome e troca a do telefone por "Seu WhatsApp é (14) 9****-1234?" (Confirmar /
// Usar outro número).
//
// PRIVACIDADE: o token é fraco (50 bits, vai em SMS). O navegador recebe o 1º nome e o telefone (o número inteiro aparece, por decisão do dono, 2026-11-03)
// (`smsContactView`); nome completo e telefone inteiro nunca saem do servidor. No cadastro quem completa nome e telefone é o
// SERVIDOR (`completeSmsContactPayload`), nunca o cliente. Sem token válido / contato que não resolve: nada muda (o
// formulário é exatamente o de sempre).
import { cleanSmsToken } from "./sms-batch-token-core.mjs";
import { isUsableContactName } from "./contact-name.mjs";
import { smsFirstName } from "./sms-batch-core.mjs";
import { sanitizeContactFullName } from "./whatsapp-referral.mjs";
import { toBrazilianE164, isValidBrazilianMobile, normalizeBrazilianMobileNational } from "./phone-utils.js";

const blank = (value) => !String(value ?? "").trim();

/** Nome da base que o formulário pode usar no lugar da pergunta: utilizável e com 1º nome confiável. "" = pergunta normal. */
export function smsContactFullName(name) {
  if (!isUsableContactName(name) || !smsFirstName(name)) return "";
  return sanitizeContactFullName(name);
}

/** Celular completo para a pessoa conferir: (14) 99999-3645 (dono, 2026-11-03: número inteiro evita confundir finais parecidos). */
export function formatSmsPhoneFull(phone) {
  const national = normalizeBrazilianMobileNational(phone);
  if (national.length !== 11) return "";
  return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
}

/** Telefone da base em E.164 válido, ou "" (nunca confirma número inválido). */
function smsContactPhone(phone) {
  const e164 = toBrazilianE164(phone);
  return e164 && isValidBrazilianMobile(e164) ? e164 : "";
}

/**
 * O que o navegador pode saber do contato do token: { firstName, phoneDisplay } ou null (sem contato / sem nome confiável).
 * `phoneDisplay` vem "" quando o telefone da base não é um celular válido (a tela mostra o campo normal).
 */
export function smsContactView(contact) {
  if (!smsContactFullName(contact?.name)) return null;
  return { firstName: smsFirstName(contact.name), phoneDisplay: smsContactPhone(contact?.phone) ? formatSmsPhoneFull(contact.phone) : "" };
}

/**
 * Cadastro (SERVIDOR): completa nome e telefone ausentes no payload a partir do contato do token.
 *  - nome: só se vier em branco (o digitado vale) e o nome da base for utilizável;
 *  - telefone: só se vier em branco E o payload trouxer `confirmContactPhone === true` (o cliente tocou em "Confirmar").
 *    Telefone digitado ("Usar outro número") sempre vale e vem validado como no fluxo normal.
 * Sem contato (sem token, token que não resolve): devolve o MESMO payload — idêntico a hoje.
 */
export function completeSmsContactPayload(payload, contact) {
  if (!contact) return payload;
  const next = { ...payload };
  if (blank(next.fullName)) {
    const fullName = smsContactFullName(contact.name);
    if (fullName) next.fullName = fullName;
  }
  if (blank(next.phone) && next.confirmContactPhone === true) {
    const phone = smsContactPhone(contact.phone);
    if (phone) next.phone = phone;
  }
  delete next.confirmContactPhone;
  return next;
}

/** Token do cadastro: `attribution.sms_t` válido (a mesma limpeza do clique), ou "". */
export function payloadSmsToken(payload) {
  return cleanSmsToken(payload?.attribution?.sms_t);
}

/** O cadastro precisa consultar o contato do token? (token válido E algo a completar — evita leitura à toa.) */
export function needsSmsContact(payload) {
  return Boolean(payloadSmsToken(payload)) && (blank(payload?.fullName) || (blank(payload?.phone) && payload?.confirmContactPhone === true));
}
