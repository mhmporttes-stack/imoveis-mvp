// Formulário curto do link do SMS (dono, 2026-11-03, PRO-18h) — as perguntas. PURO e sem imports (entra no pacote do navegador;
// testado em tests/sms-batch-short-form.test.mjs). `smsContact` = { firstName, phoneMasked }, o ÚNICO dado do contato que o
// navegador recebe (lib/sms-batch-contact-core.mjs `smsContactView`). Sem ele as perguntas são exatamente as de sempre.
//  - sem a pergunta do nome;
//  - a do telefone vira "Seu WhatsApp é (14) 9****-1234?" com dois botões: Confirmar (o SERVIDOR usa o telefone do contato) e
//    Usar outro número (`otherPhone`: volta o campo de telefone normal, em branco, validado como sempre).
//  - telefone da base sem máscara (inválido): o campo de telefone normal.

export const CONFIRM_CONTACT_PHONE_STEP_ID = "confirmContactPhone";
export const USE_OTHER_PHONE = "other";

export function applySmsContactSteps(steps, smsContact, otherPhone = false) {
  if (!smsContact?.firstName) return steps;
  const withoutName = steps.filter((step) => step.id !== "fullName");
  if (!smsContact.phoneMasked || otherPhone) return withoutName;
  return withoutName.map((step) => (step.id === "phone"
    ? {
        id: CONFIRM_CONTACT_PHONE_STEP_ID,
        kind: "phoneConfirm",
        title: `Seu WhatsApp é ${smsContact.phoneMasked}?`,
        options: [
          { value: true, label: "Confirmar" },
          { value: USE_OTHER_PHONE, label: "Usar outro número" }
        ]
      }
    : step));
}

/** Só `true` (Confirmar) avança; "Usar outro número" troca a pergunta e nunca chega a ser validada como resposta. */
export function phoneConfirmError(value) {
  return value === true ? "" : "Escolha uma opção para continuar.";
}
