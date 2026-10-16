// Corretor transfere o PRÓPRIO cliente (REGRA OFICIAL, dono 2026-10-16 — CLI-7a):
// "o corretor, ele deve ter o poder de transferir o cliente dele para outro corretor, tá, caso queira. Para mim,
// para outro corretor, para a Carol." Só perfil efetivo corretor (associado NÃO), só cliente do qual ele é o
// responsável, só para usuário ativo que recebe cliente (admin/dono, gestor, corretor) — nunca associado nem
// "sem responsável". Quem recebe não precisa aceitar; motivo não é obrigatório. A gravação continua sendo a
// transferência manual de sempre (updateSimulationRegistration); aqui fica só a decisão, pura e testada
// (tests/broker-client-transfer.test.mjs). Admin geral e gestor seguem a CLI-7 (assertCanAccessResponsibleUser).

export const BROKER_TRANSFER_TARGET_ROLES = Object.freeze(["admin", "manager", "broker"]);

export function canBrokerTransferOwnClients(profile) {
  return profile?.role === "broker" && Boolean(profile?.id) && !profile?.isFallback;
}

export function isBrokerTransferTarget(profile, actorId) {
  return Boolean(profile?.id)
    && profile.id !== actorId
    && profile.status === "active"
    && BROKER_TRANSFER_TARGET_ROLES.includes(profile.role);
}

// Lista do seletor (só id e nome — nada de e-mail/telefone vai para a tela do corretor).
export function brokerTransferTargets(profiles = [], actorId = "") {
  return (Array.isArray(profiles) ? profiles : [])
    .filter((profile) => isBrokerTransferTarget(profile, actorId))
    .map((profile) => ({ id: profile.id, name: profile.name || "Sem nome" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// "" = pode transferir; senão, a mensagem do motivo da recusa.
export function brokerTransferDenial({ actor, currentResponsibleUserId, target }) {
  if (!canBrokerTransferOwnClients(actor)) return "Apenas o corretor responsável pode transferir este cliente.";
  if (!currentResponsibleUserId || currentResponsibleUserId !== actor.id) return "Você só pode transferir clientes dos quais é o responsável.";
  if (!isBrokerTransferTarget(target, actor.id)) return "Escolha um corretor, gestor ou administrador ativo para receber o cliente.";
  return "";
}
