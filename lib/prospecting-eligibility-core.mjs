// Prospecção SÓ COM WHATSAPP CONECTADO (regra do dono, 2026-10-02) — regras PURAS,
// testadas em tests/prospecting-eligibility.test.mjs. A leitura do banco e as barreiras
// ficam em lib/prospecting-eligibility.js.
//
// Elegível para participar da Prospecção = a sessão do WhatsApp pessoal do corretor está
// REALMENTE conectada ("connected"). Número cadastrado no perfil não basta, e estados
// intermediários (reconnecting, qr_required, disconnected, sem sessão) não contam.
// O administrador geral (dono) fica de fora da exigência: a regra é sobre o CORRETOR
// participar/executar Prospecção — funções administrativas e de supervisão nunca são bloqueadas.

export const PROSPECTING_CONNECT_MESSAGE = "Conecte seu WhatsApp para acessar a Prospecção.";
export const PROSPECTING_RECEIVE_BLOCKED_MESSAGE = "Este corretor está com o WhatsApp desconectado e não pode receber clientes para a Prospecção.";
export const PROSPECTING_NOT_ELIGIBLE_CODE = "WHATSAPP_NOT_CONNECTED";
export const OPERATIONAL_SESSION_STATUS = "connected";

export function isSessionOperational(sessionStatus) {
  return sessionStatus === OPERATIONAL_SESSION_STATUS;
}

// PARTICIPAR/EXECUTAR (receber clientes, gerar cota da Meta Diária, enfileirar disparo,
// registrar tentativa): todo mundo, menos o administrador geral.
export function participationRequiresWhatsapp({ isGeneralAdmin = false } = {}) {
  return !isGeneralAdmin;
}

// ACESSAR a tela/rotas da Prospecção como corretor: só corretor e associado (administrador
// geral e gestor mantêm as ferramentas de supervisão; o que EXECUTAM por si continua
// exigindo conexão via participationRequiresWhatsapp).
export function accessRequiresWhatsapp({ role = "", isGeneralAdmin = false } = {}) {
  return !isGeneralAdmin && (role === "broker" || role === "associate");
}

export function gateRequiresWhatsapp({ kind = "participate", role = "", isGeneralAdmin = false } = {}) {
  return kind === "access"
    ? accessRequiresWhatsapp({ role, isGeneralAdmin })
    : participationRequiresWhatsapp({ isGeneralAdmin });
}

// -> { allowed, message, code }
export function decideProspectingGate({ kind = "participate", role = "", isGeneralAdmin = false, sessionStatus = null } = {}) {
  if (!gateRequiresWhatsapp({ kind, role, isGeneralAdmin }) || isSessionOperational(sessionStatus)) return { allowed: true, message: "", code: "" };
  return { allowed: false, message: PROSPECTING_CONNECT_MESSAGE, code: PROSPECTING_NOT_ELIGIBLE_CODE };
}
