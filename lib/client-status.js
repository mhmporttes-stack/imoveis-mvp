export const CLIENT_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  DOCUMENTATION: "documentation_pending",
  DOCUMENTS_PENDING: "documents_pending",
  APPROVAL_PENDING: "approval_pending",
  SHIELDING: "shielding",
  APPROVED: "approved",
  REJECTED: "rejected",
  SALE_COMPLETED: "sale_completed",
  ARCHIVED: "archived"
};

export const CLIENT_STATUS_OPTIONS = [
  { key: "all", value: "all", label: "Todos" },
  { key: CLIENT_STATUS.PENDING, value: CLIENT_STATUS.PENDING, label: "Aguardando simulação" },
  { key: CLIENT_STATUS.COMPLETED, value: CLIENT_STATUS.COMPLETED, label: "Simulação realizada" },
  { key: CLIENT_STATUS.DOCUMENTATION, value: CLIENT_STATUS.DOCUMENTATION, label: "Aguardando documentação" },
  { key: CLIENT_STATUS.DOCUMENTS_PENDING, value: CLIENT_STATUS.DOCUMENTS_PENDING, label: "Documentação pendente" },
  { key: CLIENT_STATUS.APPROVAL_PENDING, value: CLIENT_STATUS.APPROVAL_PENDING, label: "Aguardando aprovação" },
  { key: CLIENT_STATUS.SHIELDING, value: CLIENT_STATUS.SHIELDING, label: "Blindagem" },
  { key: CLIENT_STATUS.APPROVED, value: CLIENT_STATUS.APPROVED, label: "Cliente aprovado" },
  { key: CLIENT_STATUS.REJECTED, value: CLIENT_STATUS.REJECTED, label: "Reprovado" },
  { key: CLIENT_STATUS.SALE_COMPLETED, value: CLIENT_STATUS.SALE_COMPLETED, label: "Venda realizada" },
  { key: CLIENT_STATUS.ARCHIVED, value: CLIENT_STATUS.ARCHIVED, label: "Arquivado", filterLabel: "Arquivados" }
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
    label: "Venda realizada",
    badgeClass: "bg-green-50 text-green-700",
    activeClass: "border-green-200 bg-green-50 text-green-700",
    counterClass: "bg-green-50 text-green-700"
  },
  [CLIENT_STATUS.ARCHIVED]: {
    label: "Arquivado",
    badgeClass: "bg-slate-100 text-slate-700",
    activeClass: "border-slate-300 bg-slate-100 text-slate-700",
    counterClass: "bg-slate-100 text-slate-700"
  }
};

export const CLIENT_STATUS_VALUES = Object.values(CLIENT_STATUS);

export function normalizeClientStatus(value) {
  return CLIENT_STATUS_VALUES.includes(value) ? value : CLIENT_STATUS.PENDING;
}

export function clientStatusLabel(value) {
  return CLIENT_STATUS_META[normalizeClientStatus(value)]?.label || CLIENT_STATUS_META.pending.label;
}
