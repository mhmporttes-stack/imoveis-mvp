export const CLIENT_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  DOCUMENTATION: "documentation_pending",
  APPROVED: "approved",
  ARCHIVED: "archived"
};

export const CLIENT_STATUS_OPTIONS = [
  { key: "all", value: "all", label: "Todos" },
  { key: CLIENT_STATUS.PENDING, value: CLIENT_STATUS.PENDING, label: "Simulação não realizada" },
  { key: CLIENT_STATUS.COMPLETED, value: CLIENT_STATUS.COMPLETED, label: "Simulação realizada" },
  { key: CLIENT_STATUS.DOCUMENTATION, value: CLIENT_STATUS.DOCUMENTATION, label: "Aguardando documentação" },
  { key: CLIENT_STATUS.APPROVED, value: CLIENT_STATUS.APPROVED, label: "Cliente aprovado" },
  { key: CLIENT_STATUS.ARCHIVED, value: CLIENT_STATUS.ARCHIVED, label: "Arquivado", filterLabel: "Arquivados" }
];

export const CLIENT_STATUS_META = {
  [CLIENT_STATUS.PENDING]: {
    label: "Simulação não realizada",
    badgeClass: "bg-red-50 text-red-700",
    activeClass: "border-red-200 bg-red-50 text-red-700"
  },
  [CLIENT_STATUS.COMPLETED]: {
    label: "Simulação realizada",
    badgeClass: "bg-[#EAF3FF] text-brand",
    activeClass: "border-brand bg-[#EAF3FF] text-brand"
  },
  [CLIENT_STATUS.DOCUMENTATION]: {
    label: "Aguardando documentação",
    badgeClass: "bg-yellow-50 text-yellow-800",
    activeClass: "border-yellow-200 bg-yellow-50 text-yellow-800"
  },
  [CLIENT_STATUS.APPROVED]: {
    label: "Cliente aprovado",
    badgeClass: "bg-emerald-50 text-emerald-700",
    activeClass: "border-emerald-200 bg-emerald-50 text-emerald-700"
  },
  [CLIENT_STATUS.ARCHIVED]: {
    label: "Arquivado",
    badgeClass: "bg-slate-100 text-slate-700",
    activeClass: "border-slate-300 bg-slate-100 text-slate-700"
  }
};

export function normalizeClientStatus(value) {
  return Object.values(CLIENT_STATUS).includes(value) ? value : CLIENT_STATUS.PENDING;
}

export function clientStatusLabel(value) {
  return CLIENT_STATUS_META[normalizeClientStatus(value)]?.label || CLIENT_STATUS_META.pending.label;
}
