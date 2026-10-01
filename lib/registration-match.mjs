// Escolha do cadastro existente para uma pessoa (antes dentro de
// findMatchingRegistration, lib/simulation-registrations.js) — puro e
// testado em tests/registration-match.test.mjs. Identidade é o TELEFONE,
// nunca o nome (bug P-01: homônimos com telefones diferentes viravam o mesmo
// cliente).
import { digitsOnly, isSamePhone } from "./phone-utils.js";

export function normalizeComparablePhone(value) {
  let phone = digitsOnly(value);
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("55") && phone.length > 11) phone = phone.slice(2);
  if (phone.startsWith("55") && phone.length > 11) phone = phone.slice(2);
  return phone;
}

export function pickRegistrationByPhone(registrations, draft, options = {}) {
  const draftPhone = normalizeComparablePhone(draft?.phoneNormalized || draft?.phone);

  // Todos os cadastros com este telefone (mais recente primeiro). Um telefone pode ter mais de um
  // atendimento; escolher só o mais recente escondia o card do Chat quando outro cadastro já existia.
  const phoneMatches = (registrations || []).filter((registration) => {
    const phone = normalizeComparablePhone(registration.phoneNormalized || registration.phone);
    // isSamePhone: mesmo número em formatos diferentes (com/sem 9º dígito, +55, máscara).
    return draftPhone && phone && (phone === draftPhone || phone.endsWith(draftPhone) || draftPhone.endsWith(phone) || isSamePhone(phone, draftPhone));
  });

  if (!phoneMatches.length) return null;

  // Formulário de link: o card criado pelo WhatsApp (anúncio/Chat) que ainda não tem simulação é
  // o card que o formulário deve COMPLETAR — nunca um segundo card para a mesma pessoa.
  if (options.preferOpenChatCard && options.hasSimulationData) {
    const openChatCard = phoneMatches.find((registration) => (
      String(registration.acquisitionKind || "").startsWith("whatsapp") && !options.hasSimulationData(registration)
    ));
    if (openChatCard) return openChatCard;
  }
  // Link pessoal: prefere o atendimento do MESMO corretor do link (em vez do mais recente de outro).
  if (options.preferResponsibleUserId) {
    const sameBroker = phoneMatches.find((registration) => registration.responsibleUserId === options.preferResponsibleUserId);
    if (sameBroker) return sameBroker;
  }
  return phoneMatches[0];
}
