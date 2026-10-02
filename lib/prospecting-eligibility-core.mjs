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

// RESTRIÇÃO DO WHATSAPP (REGRA OFICIAL — dono, 2026-10-02). Sem sessão conectada:
//  - sem restrição / restrição só INFORMADA (aguardando validação): NADA liberado (como antes);
//  - restrição VALIDADA: libera a Meta Diária em modo MANUAL (kind "daily_goal"); a Prospecção
//    MANUAL ("participate"/"access") só libera ao atingir 100% da Meta Diária (goalComplete);
//  - o DISPARO AUTOMÁTICO nunca é liberado por restrição (kind com strict:true — o dispatcher
//    segue exigindo sessão "connected").
export const PROSPECTING_RESTRICTED_GOAL_MESSAGE = "Com a restrição do WhatsApp validada, a Prospecção libera quando você concluir 100% da Meta Diária.";
export const PROSPECTING_RESTRICTED_GOAL_CODE = "WHATSAPP_RESTRICTED_GOAL_PENDING";
export const RESTRICTION_VALIDATED = "validated";

export function isRestrictionValidated(restriction) {
  return restriction === RESTRICTION_VALIDATED;
}

// -> { allowed, message, code }
// restriction: "validated" | "informed" | null ; goalComplete: Meta Diária em 100% (só consultado
// quando importa) ; strict: automático/qualquer fluxo que exige "connected" de verdade.
export function decideProspectingGate({
  kind = "participate", role = "", isGeneralAdmin = false, sessionStatus = null,
  restriction = null, goalComplete = false, strict = false
} = {}) {
  if (!gateRequiresWhatsapp({ kind, role, isGeneralAdmin }) || isSessionOperational(sessionStatus)) return { allowed: true, message: "", code: "" };
  if (!strict && isRestrictionValidated(restriction)) {
    if (kind === "daily_goal") return { allowed: true, message: "", code: "" };
    if (goalComplete) return { allowed: true, message: "", code: "" };
    return { allowed: false, message: PROSPECTING_RESTRICTED_GOAL_MESSAGE, code: PROSPECTING_RESTRICTED_GOAL_CODE };
  }
  return { allowed: false, message: PROSPECTING_CONNECT_MESSAGE, code: PROSPECTING_NOT_ELIGIBLE_CODE };
}

// A decisão precisa saber se a Meta Diária está em 100%? (evita consulta cara quando não importa)
export function gateNeedsGoalStatus({ kind = "participate", role = "", isGeneralAdmin = false, sessionStatus = null, restriction = null, strict = false } = {}) {
  return !strict && kind !== "daily_goal" && isRestrictionValidated(restriction)
    && gateRequiresWhatsapp({ kind, role, isGeneralAdmin }) && !isSessionOperational(sessionStatus);
}
