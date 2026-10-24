// Puro (sem banco, sem "server-only") — decide para onde o botão "Receber
// minha simulação" (tela final do formulário) leva o cliente. Testado em
// tests/receive-simulation-contact.test.mjs.
//
// Regra do dono (WA-10, 2026-10-01, docs/BUSINESS_RULES.md): o botão abre o
// WhatsApp do corretor RESPONSÁVEL pelo cadastro recém-criado — inclusive
// quando ele foi escolhido pela roleta. Nunca abre o WhatsApp de outro
// corretor, do Matheus ou do número oficial "por reserva":
//   - sem responsável (fila de espera da roleta)  -> "waiting"
//   - responsável inativo, sem telefone ou com
//     telefone inválido                           -> "unavailable"
//   - responsável ativo com WhatsApp válido        -> "ready" + phone
import { FORM_COMPLETION_MESSAGE } from "./whatsapp-form-completion.mjs";
import { withContactCode } from "./whatsapp-contact-code-core.mjs";

export const RECEIVE_CONTACT_STATE = {
  READY: "ready",
  WAITING: "waiting",
  UNAVAILABLE: "unavailable"
};

// `broker`: { status, whatsappDigits } do responsável (whatsappDigits já
// normalizado por toWhatsAppDigits — "" quando inválido).
export function resolveReceiveSimulationContact({ responsibleUserId, broker } = {}) {
  if (!responsibleUserId) return { state: RECEIVE_CONTACT_STATE.WAITING };
  const digits = String(broker?.whatsappDigits || "");
  if (!broker || broker.status !== "active" || !/^55\d{10,11}$/.test(digits)) {
    return { state: RECEIVE_CONTACT_STATE.UNAVAILABLE };
  }
  return { state: RECEIVE_CONTACT_STATE.READY, phone: digits };
}

// Contato da apresentação /s/<token> ("Receber lista de documentos", "Agendar atendimento", "Falar com meu corretor").
// Desde a PRES-25 (dono, 2026-10-18; oficial desde 2026-10-09) o cliente é levado ao número OFICIAL e a conversa fica com o
// responsável — o WhatsApp PESSOAL do responsável não é mais usado nesse caminho. Basta responsável ATIVO (a conversa e a
// atividade precisam de alguém para atender). Exigir telefone pessoal escondia o botão de todo cliente de quem não tem
// telefone no cadastro de usuário (incidente 2026-10-20: clientes do dono, cliente "não consegue prosseguir em documentos").
export function isPresentationContactReady({ responsibleUserId, broker } = {}) {
  return Boolean(responsibleUserId) && Boolean(broker) && broker.status === "active";
}

// Link do botão "Receber minha simulação" (WA-10/PRES-25): número devolvido pela rota (hoje sempre o OFICIAL) + mensagem
// pronta do pós-formulário + "Código do atendimento". Fonte ÚNICA do link — usada pelo botão e pela abertura automática.
export function buildReceiveSimulationWhatsappUrl(phone, registrationId) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(withContactCode(FORM_COMPLETION_MESSAGE, registrationId))}`;
}

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Ficha direto no WhatsApp: ao confirmar a última pergunta (cadastro salvo),
// o cliente é levado sozinho ao WhatsApp com a mensagem pronta — a mensagem abre a janela do Oficial e a SIM-AUTO-ENVIO
// manda o link da simulação por lá. Abre só UMA vez, só com o link pronto ("ready" + número válido) e só quando a tela
// pediu (`autoOpen`, só o formulário). "waiting"/"unavailable" seguem a reserva da WA-10 (aviso, sem abrir nada).
export function shouldAutoOpenWhatsapp({ autoOpen = false, state = "", phone = "", alreadyOpened = false } = {}) {
  return Boolean(autoOpen) && !alreadyOpened && state === RECEIVE_CONTACT_STATE.READY && /^\d{12,13}$/.test(String(phone || ""));
}

// Espera curta antes de o BOTÃO abrir sozinho (caso em que a tela de reserva já está aberta, ex.: espera → pronto).
// Bem abaixo da espera de 2 min da SIM-AUTO-ENVIO (AUTO_SEND_DELAY_MS) antes de decidir o canal.
export const AUTO_OPEN_WHATSAPP_DELAY_MS = 1200;

// Consulta da rota /api/whatsapp-contact — mesma para o formulário (abertura direta) e para o botão de reserva.
export function buildReceiveContactQuery({ registrationId = "", accessToken = "", brokerRef = "" } = {}) {
  if (registrationId && accessToken) return `?registrationId=${encodeURIComponent(registrationId)}&token=${encodeURIComponent(accessToken)}`;
  return brokerRef ? `?ref=${encodeURIComponent(brokerRef)}` : "";
}

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24, refinada no mesmo dia] "Ele deve abrir no botão anterior já, sem essa outra
// aba": o formulário abre o WhatsApp direto do botão "Enviar informações" (sem tela intermediária). Devolve o link quando a
// rota respondeu "ready" com número válido; "" = espera/indisponível/erro → tela de reserva da WA-10.
export function resolveFormWhatsappRedirect({ state = "", phone = "", registrationId = "" } = {}) {
  if (!shouldAutoOpenWhatsapp({ autoOpen: true, state, phone })) return "";
  return buildReceiveSimulationWhatsappUrl(phone, registrationId);
}

// Se ~3 s depois de mandar abrir o WhatsApp a página ainda está visível, a troca de app não aconteceu: mostra a tela com o
// botão de reserva ("Abrir o WhatsApp"). Também abaixo dos 2 min da SIM-AUTO-ENVIO.
export const FORM_WHATSAPP_FALLBACK_MS = 3000;
export function shouldShowWhatsappFallback(visibilityState) {
  return visibilityState === "visible";
}
