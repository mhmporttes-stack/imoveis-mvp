export const CLIENT_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  APPROVED: "approved"
};

export const CLIENT_STATUS_OPTIONS = [
  { key: "all", value: "all", label: "Todos" },
  { key: CLIENT_STATUS.PENDING, value: CLIENT_STATUS.PENDING, label: "Simulacao nao realizada" },
  { key: CLIENT_STATUS.COMPLETED, value: CLIENT_STATUS.COMPLETED, label: "Simulacao realizada" },
  { key: CLIENT_STATUS.APPROVED, value: CLIENT_STATUS.APPROVED, label: "Cliente aprovado" }
];

export const CLIENT_STATUS_META = {
  [CLIENT_STATUS.PENDING]: {
    label: "Simulacao nao realizada",
    badgeClass: "bg-red-50 text-red-700",
    activeClass: "border-red-200 bg-red-50 text-red-700"
  },
  [CLIENT_STATUS.COMPLETED]: {
    label: "Simulacao realizada",
    badgeClass: "bg-[#EAF3FF] text-brand",
    activeClass: "border-brand bg-[#EAF3FF] text-brand"
  },
  [CLIENT_STATUS.APPROVED]: {
    label: "Cliente aprovado",
    badgeClass: "bg-emerald-50 text-emerald-700",
    activeClass: "border-emerald-200 bg-emerald-50 text-emerald-700"
  }
};

export function normalizeClientStatus(value) {
  return Object.values(CLIENT_STATUS).includes(value) ? value : CLIENT_STATUS.PENDING;
}

export function clientStatusLabel(value) {
  return CLIENT_STATUS_META[normalizeClientStatus(value)]?.label || CLIENT_STATUS_META.pending.label;
}
