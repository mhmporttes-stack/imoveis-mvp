export const CLIENT_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  SIMULATION_SENT: "simulation_sent",
  IN_SERVICE: "in_service",
  AWAITING_RETURN: "awaiting_return",
  DOCUMENTATION: "documentation_pending",
  DOCUMENTS_PENDING: "documents_pending",
  APPROVAL_PENDING: "approval_pending",
  RESTRICTION: "restriction",
  SHIELDING: "shielding",
  APPROVED: "approved",
  REJECTED: "rejected",
  SALE_COMPLETED: "sale_completed",
  SALE_FORMS: "sale_forms",
  SALE_RESERVATION: "sale_reservation",
  SALE_CONTRACT: "sale_contract",
  SALE_CAIXA_SIGNATURE: "sale_caixa_signature",
  SALE_ITBI: "sale_itbi",
  SALE_REGISTRY: "sale_registry",
  SALE_PAYMENT: "sale_payment",
  ARCHIVED: "archived",
  DO_NOT_CONTACT: "do_not_contact"
};

export const CLIENT_STATUS_OPTIONS = [
  { key: "all", value: "all", label: "Todos" },
  { key: CLIENT_STATUS.PENDING, value: CLIENT_STATUS.PENDING, label: "Aguardando simulação" },
  { key: CLIENT_STATUS.COMPLETED, value: CLIENT_STATUS.COMPLETED, label: "Simulação realizada" },
  { key: CLIENT_STATUS.SIMULATION_SENT, value: CLIENT_STATUS.SIMULATION_SENT, label: "Simulação enviada" },
  { key: CLIENT_STATUS.IN_SERVICE, value: CLIENT_STATUS.IN_SERVICE, label: "Em atendimento" },
  { key: CLIENT_STATUS.AWAITING_RETURN, value: CLIENT_STATUS.AWAITING_RETURN, label: "Tentando contato" },
  { key: CLIENT_STATUS.DOCUMENTATION, value: CLIENT_STATUS.DOCUMENTATION, label: "Aguardando documentação" },
  { key: CLIENT_STATUS.DOCUMENTS_PENDING, value: CLIENT_STATUS.DOCUMENTS_PENDING, label: "Documentação pendente" },
  { key: CLIENT_STATUS.APPROVAL_PENDING, value: CLIENT_STATUS.APPROVAL_PENDING, label: "Aguardando aprovação" },
  { key: CLIENT_STATUS.RESTRICTION, value: CLIENT_STATUS.RESTRICTION, label: "Restrição" },
  { key: CLIENT_STATUS.SHIELDING, value: CLIENT_STATUS.SHIELDING, label: "Blindagem" },
  { key: CLIENT_STATUS.APPROVED, value: CLIENT_STATUS.APPROVED, label: "Cliente aprovado" },
  { key: CLIENT_STATUS.REJECTED, value: CLIENT_STATUS.REJECTED, label: "Reprovado" },
  { key: CLIENT_STATUS.SALE_CONTRACT, value: CLIENT_STATUS.SALE_CONTRACT, label: "Contrato" },
  { key: CLIENT_STATUS.SALE_COMPLETED, value: CLIENT_STATUS.SALE_COMPLETED, label: "Engenharia" },
  { key: CLIENT_STATUS.SALE_FORMS, value: CLIENT_STATUS.SALE_FORMS, label: "Formulários" },
  { key: CLIENT_STATUS.SALE_RESERVATION, value: CLIENT_STATUS.SALE_RESERVATION, label: "Reserva" },
  { key: CLIENT_STATUS.SALE_CAIXA_SIGNATURE, value: CLIENT_STATUS.SALE_CAIXA_SIGNATURE, label: "Assinatura Caixa" },
  { key: CLIENT_STATUS.SALE_ITBI, value: CLIENT_STATUS.SALE_ITBI, label: "ITBI" },
  { key: CLIENT_STATUS.SALE_REGISTRY, value: CLIENT_STATUS.SALE_REGISTRY, label: "Cartório" },
  { key: CLIENT_STATUS.SALE_PAYMENT, value: CLIENT_STATUS.SALE_PAYMENT, label: "Pagamento" },
  { key: CLIENT_STATUS.ARCHIVED, value: CLIENT_STATUS.ARCHIVED, label: "Arquivado", filterLabel: "Arquivados" },
  { key: CLIENT_STATUS.DO_NOT_CONTACT, value: CLIENT_STATUS.DO_NOT_CONTACT, label: "Não contactar" }
];

export const CLIENT_STATUS_META = {
  [CLIENT_STATUS.PENDING]: {
    label: "Aguardando simulação",
    badgeClass: "bg-red-50 text-red-700",
    activeClass: "border-red-200 bg-red-50 text-red-700",
    counterClass: "bg-red-50 text-red-700"
  },
  [CLIENT_STATUS.COMPLETED]: {
    label: "Simulação realizada",
    badgeClass: "bg-[#EAF3FF] text-brand",
    activeClass: "border-brand bg-[#EAF3FF] text-brand",
    counterClass: "bg-[#EEF4FB] text-navy"
  },
  [CLIENT_STATUS.SIMULATION_SENT]: {
    label: "Simulação enviada",
    badgeClass: "bg-blue-50 text-blue-700",
    activeClass: "border-blue-200 bg-blue-50 text-blue-700",
    counterClass: "bg-blue-50 text-blue-700"
  },
  [CLIENT_STATUS.IN_SERVICE]: {
    label: "Em atendimento",
    badgeClass: "bg-cyan-50 text-cyan-700",
    activeClass: "border-cyan-200 bg-cyan-50 text-cyan-700",
    counterClass: "bg-cyan-50 text-cyan-700"
  },
  [CLIENT_STATUS.AWAITING_RETURN]: {
    label: "Tentando contato",
    badgeClass: "bg-amber-50 text-amber-800",
    activeClass: "border-amber-200 bg-amber-50 text-amber-800",
    counterClass: "bg-amber-50 text-amber-800"
  },
  [CLIENT_STATUS.DOCUMENTATION]: {
    label: "Aguardando documentação",
    badgeClass: "bg-yellow-50 text-yellow-800",
    activeClass: "border-yellow-200 bg-yellow-50 text-yellow-800",
    counterClass: "bg-yellow-50 text-yellow-800"
  },
  [CLIENT_STATUS.DOCUMENTS_PENDING]: {
    label: "Documentação pendente",
    badgeClass: "bg-orange-50 text-orange-700",
    activeClass: "border-orange-200 bg-orange-50 text-orange-700",
    counterClass: "bg-orange-50 text-orange-700"
  },
  [CLIENT_STATUS.APPROVAL_PENDING]: {
    label: "Aguardando aprovação",
    badgeClass: "bg-sky-50 text-sky-700",
    activeClass: "border-sky-200 bg-sky-50 text-sky-700",
    counterClass: "bg-sky-50 text-sky-700"
  },
  [CLIENT_STATUS.RESTRICTION]: {
    label: "Restrição",
    badgeClass: "bg-red-50 text-red-700",
    activeClass: "border-red-200 bg-red-50 text-red-700",
    counterClass: "bg-red-50 text-red-700"
  },
  [CLIENT_STATUS.SHIELDING]: {
    label: "Blindagem",
    badgeClass: "bg-indigo-50 text-indigo-700",
    activeClass: "border-indigo-200 bg-indigo-50 text-indigo-700",
    counterClass: "bg-indigo-50 text-indigo-700"
  },
  [CLIENT_STATUS.APPROVED]: {
    label: "Cliente aprovado",
    badgeClass: "bg-emerald-50 text-emerald-700",
    activeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    counterClass: "bg-emerald-50 text-emerald-700"
  },
  [CLIENT_STATUS.REJECTED]: {
    label: "Reprovado",
    badgeClass: "bg-rose-50 text-rose-700",
    activeClass: "border-rose-200 bg-rose-50 text-rose-700",
    counterClass: "bg-rose-50 text-rose-700"
  },
  [CLIENT_STATUS.SALE_COMPLETED]: {
    label: "Engenharia",
    badgeClass: "bg-green-50 text-green-700",
    activeClass: "border-green-200 bg-green-50 text-green-700",
    counterClass: "bg-green-50 text-green-700"
  },
  [CLIENT_STATUS.SALE_FORMS]: {
    label: "Formulários",
    badgeClass: "bg-green-50 text-green-700",
    activeClass: "border-green-200 bg-green-50 text-green-700",
    counterClass: "bg-green-50 text-green-700"
  },
  [CLIENT_STATUS.SALE_RESERVATION]: {
    label: "Reserva",
    badgeClass: "bg-green-50 text-green-700",
    activeClass: "border-green-200 bg-green-50 text-green-700",
    counterClass: "bg-green-50 text-green-700"
  },
  [CLIENT_STATUS.SALE_CONTRACT]: {
    label: "Contrato",
    badgeClass: "bg-indigo-50 text-indigo-700",
    activeClass: "border-indigo-200 bg-indigo-50 text-indigo-700",
    counterClass: "bg-indigo-50 text-indigo-700"
  },
  [CLIENT_STATUS.SALE_CAIXA_SIGNATURE]: {
    label: "Assinatura Caixa",
    badgeClass: "bg-green-50 text-green-700",
    activeClass: "border-green-200 bg-green-50 text-green-700",
    counterClass: "bg-green-50 text-green-700"
  },
  [CLIENT_STATUS.SALE_ITBI]: {
    label: "ITBI",
    badgeClass: "bg-green-50 text-green-700",
    activeClass: "border-green-200 bg-green-50 text-green-700",
    counterClass: "bg-green-50 text-green-700"
  },
  [CLIENT_STATUS.SALE_REGISTRY]: {
    label: "Cartório",
    badgeClass: "bg-green-50 text-green-700",
    activeClass: "border-green-200 bg-green-50 text-green-700",
    counterClass: "bg-green-50 text-green-700"
  },
  [CLIENT_STATUS.SALE_PAYMENT]: {
    label: "Pagamento",
    badgeClass: "bg-green-50 text-green-700",
    activeClass: "border-green-200 bg-green-50 text-green-700",
    counterClass: "bg-green-50 text-green-700"
  },
  [CLIENT_STATUS.ARCHIVED]: {
    label: "Arquivado",
    badgeClass: "bg-slate-100 text-slate-700",
    activeClass: "border-slate-300 bg-slate-100 text-slate-700",
    counterClass: "bg-slate-100 text-slate-700"
  },
  [CLIENT_STATUS.DO_NOT_CONTACT]: {
    label: "Não contactar",
    badgeClass: "bg-red-50 text-red-700",
    activeClass: "border-red-200 bg-red-50 text-red-700",
    counterClass: "bg-red-50 text-red-700"
  }
};

export const CLIENT_STATUS_VALUES = Object.values(CLIENT_STATUS);

export function normalizeClientStatus(value) {
  return CLIENT_STATUS_VALUES.includes(value) ? value : CLIENT_STATUS.PENDING;
}

export function clientStatusLabel(value) {
  return CLIENT_STATUS_META[normalizeClientStatus(value)]?.label || CLIENT_STATUS_META.pending.label;
}

// Mesmo conjunto de status "em andamento" usado em lib/crm.js (calculateCrmMetrics).
// Mantido aqui também para permitir reuso em funções puras client-safe (sem "server-only").
export const ACTIVE_CLIENT_STATUS_VALUES = new Set([
  CLIENT_STATUS.PENDING,
  CLIENT_STATUS.COMPLETED,
  CLIENT_STATUS.SIMULATION_SENT,
  CLIENT_STATUS.IN_SERVICE,
  CLIENT_STATUS.AWAITING_RETURN,
  CLIENT_STATUS.DOCUMENTATION,
  CLIENT_STATUS.DOCUMENTS_PENDING,
  CLIENT_STATUS.APPROVAL_PENDING,
  CLIENT_STATUS.SHIELDING,
  CLIENT_STATUS.APPROVED
]);

const NO_CONTACT_ALERT_MS = 3 * 24 * 60 * 60 * 1000;

// Etapas do funil comercial, na ordem em que aparecem no painel de Desempenho.
// Centraliza o mapeamento status -> etapa para evitar regras divergentes entre telas.
export const CLIENT_FUNNEL_STAGES = [
  { key: "service", label: "Atendimentos", statuses: [CLIENT_STATUS.IN_SERVICE] },
  { key: "simulation", label: "Simulações", statuses: [CLIENT_STATUS.COMPLETED, CLIENT_STATUS.SIMULATION_SENT] },
  { key: "documentation", label: "Documentação", statuses: [CLIENT_STATUS.DOCUMENTATION, CLIENT_STATUS.DOCUMENTS_PENDING] },
  { key: "approval", label: "Aprovações", statuses: [CLIENT_STATUS.APPROVED] },
  {
    key: "sale",
    label: "Vendas",
    statuses: [
      CLIENT_STATUS.SALE_COMPLETED,
      CLIENT_STATUS.SALE_FORMS,
      CLIENT_STATUS.SALE_RESERVATION,
      CLIENT_STATUS.SALE_CONTRACT,
      CLIENT_STATUS.SALE_CAIXA_SIGNATURE,
      CLIENT_STATUS.SALE_ITBI,
      CLIENT_STATUS.SALE_REGISTRY,
      CLIENT_STATUS.SALE_PAYMENT
    ]
  }
];

export const CLIENT_FUNNEL_SALE_STATUSES = new Set(
  CLIENT_FUNNEL_STAGES.find((stage) => stage.key === "sale").statuses
);

export function getClientFunnelStage(status) {
  const normalized = normalizeClientStatus(status);
  return CLIENT_FUNNEL_STAGES.find((stage) => stage.statuses.includes(normalized))?.key || "";
}

function validTimestamp(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : null;
}

export function hasFutureScheduledActivity(client, now = Date.now()) {
  const scheduledAt = validTimestamp(client?.scheduledActivityAt);
  const completed = Boolean(client?.scheduledActivityCompletedAt);
  return scheduledAt !== null && !completed && scheduledAt >= now;
}

// Regra já usada pelo CRM (Clientes > "Clientes pendentes"): cliente não arquivado,
// sem atividade futura agendada e sem contato registrado há mais de 3 dias.
export function isClientAwaitingAction(client, now = Date.now()) {
  if (!client) return false;
  const status = normalizeClientStatus(client.status);
  if (status === CLIENT_STATUS.ARCHIVED || status === CLIENT_STATUS.DO_NOT_CONTACT) return false;

  const scheduledAt = validTimestamp(client.scheduledActivityAt);
  if (scheduledAt !== null && scheduledAt > now) return false;

  const referenceAt = validTimestamp(client.lastWhatsappContactAt || client.createdAt);
  return referenceAt !== null && referenceAt < now - NO_CONTACT_ALERT_MS;
}

// Cliente ativo (em algum estágio do funil) sem nenhuma atividade futura agendada.
// Mesma regra usada em calculateCrmMetrics (lib/crm.js) para "awaitingAction".
export function isAwaitingFutureActivityClient(client, now = Date.now()) {
  if (!client) return false;
  const status = normalizeClientStatus(client.status);
  if (!ACTIVE_CLIENT_STATUS_VALUES.has(status)) return false;
  return !hasFutureScheduledActivity(client, now);
}

// Cliente não arquivado sem nenhum contato (WhatsApp) registrado há mais de N dias,
// independente de haver ou não atividade futura agendada.
export function isStaleContactClient(client, now = Date.now(), thresholdMs = NO_CONTACT_ALERT_MS) {
  if (!client) return false;
  const status = normalizeClientStatus(client.status);
  if (status === CLIENT_STATUS.ARCHIVED || status === CLIENT_STATUS.DO_NOT_CONTACT) return false;

  const referenceAt = validTimestamp(client.lastWhatsappContactAt || client.createdAt);
  return referenceAt !== null && referenceAt < now - thresholdMs;
}

export function isOverdueActivityClient(client, now = Date.now()) {
  const scheduledAt = validTimestamp(client?.scheduledActivityAt);
  const completed = Boolean(client?.scheduledActivityCompletedAt);
  return scheduledAt !== null && !completed && scheduledAt < now;
}
