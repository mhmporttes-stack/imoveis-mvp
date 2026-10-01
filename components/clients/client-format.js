import { CLIENT_STATUS, isOverdueActivityClient, isStaleContactClient, mergeActivitySignal } from "@/lib/client-status";
import { formatBrazilianPhone, toWhatsAppDigits } from "@/lib/phone-utils";

// Formatação e sinais da Lista de clientes (redesenho 2026-10). Mesmas regras
// do AdminSimulationList — quando o redesenho substituir a tela antiga, este
// passa a ser o único lugar delas.

// Mesmas opções aceitas pelo servidor (lib/simulation-list-query.js). A tela
// nova abre com 20 por página (a página passa pageSize: 20 na carga inicial).
export const PAGE_SIZE_OPTIONS = [5, 10, 20];

export const ACTIVITY_TYPE_OPTIONS = [
  { value: "follow_up", label: "Follow-up" },
  { value: "documentacao", label: "Documentação" },
  { value: "ligacao", label: "Ligação" },
  { value: "reuniao", label: "Reunião" },
  { value: "visita", label: "Visita" },
  { value: "outro", label: "Outro" }
];

export const TAG_COLORS = [
  { label: "Azul institucional", value: "#0D4F8B" },
  { label: "Azul vivo", value: "#1D4ED8" },
  { label: "Verde", value: "#047857" },
  { label: "Vermelho", value: "#B91C1C" },
  { label: "Amarelo", value: "#CA8A04" },
  { label: "Cinza", value: "#475569" },
  { label: "Roxo", value: "#7C3AED" },
  { label: "Ciano", value: "#0891B2" },
  { label: "Rosa", value: "#BE185D" },
  { label: "Preto suave", value: "#1F2937" }
];

export const DEFAULT_FILTERS = {
  query: "",
  responsibleUserId: "all",
  tagId: "all",
  pendingOnly: false,
  staleContactOnly: false,
  noFutureActivityOnly: false,
  needsFirstContact: false,
  statusGroup: "all",
  status: "all"
};

export function ensureArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

// Cliente não arquivado sem atividade futura e sem contato há mais de 3 dias
// (mesma regra do selo "Pendentes" do topo).
export function isPendingClient(client, extraActivities) {
  if ([CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT].includes(client.status)) return false;
  const merged = mergeActivitySignal(client, extraActivities);
  const now = Date.now();
  const scheduledAt = new Date(merged.scheduledActivityAt || "").getTime();
  if (Number.isFinite(scheduledAt) && scheduledAt > now) return false;
  const referenceAt = new Date(client.lastWhatsappContactAt || client.createdAt || "").getTime();
  return Number.isFinite(referenceAt) && referenceAt < now - (3 * 24 * 60 * 60 * 1000);
}

// Único sinal de urgência por cliente, por prioridade (atividade atrasada >
// sem contato > aguardando ação) — mesmos sinais de antes, sem score novo.
export function getUrgencySignal(client, extraActivities) {
  if (isOverdueActivityClient(client)) return { key: "overdue", label: "Atividade atrasada", tone: "danger" };
  if (isStaleContactClient(client)) return { key: "stale", label: "Sem contato há +3 dias", tone: "warning" };
  if (isPendingClient(client, extraActivities)) return { key: "pending", label: "Aguardando ação", tone: "warning" };
  return null;
}

// Próxima atividade (agendamento legado ou atividade extra pendente), a mais
// próxima primeiro — atrasadas antes das futuras.
export function getNextActivity(client, activities = []) {
  const candidates = [];
  if (client.scheduledActivityAt) {
    candidates.push({ at: client.scheduledActivityAt, note: client.scheduledActivityNote || "", legacy: true });
  }
  for (const activity of activities) {
    if (activity.status !== "pending") continue;
    candidates.push({ at: activity.scheduledActivityAt, note: activity.note || activity.title || "", legacy: false });
  }
  const valid = candidates
    .map((item) => ({ ...item, time: new Date(item.at || "").getTime() }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time);
  if (!valid.length) return null;
  const next = valid[0];
  return { ...next, overdue: next.time < Date.now(), count: valid.length };
}

export function clientPhone(client) {
  return formatBrazilianPhone(client.registration?.phoneNormalized || client.registration?.phone || "");
}

export function hasValidWhatsApp(client) {
  return Boolean(toWhatsAppDigits(client.registration?.phoneNormalized || client.registration?.phone));
}

export function initialsOf(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return `${parts[0][0] || ""}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
}

export function getSaoPauloDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric"
  }).formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: Number(partMap.day),
    hour: partMap.hour === "24" ? "00" : partMap.hour,
    minute: partMap.minute,
    month: Number(partMap.month),
    year: Number(partMap.year)
  };
}

function dayNumber(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

// "Hoje 14:30", "Amanhã 09:00", "Ontem 18:10", "qui 02/10 15:00", "12/09/2026".
export function formatWhen(value, { withTime = true } = {}) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const today = getSaoPauloDateParts(new Date());
  const parts = getSaoPauloDateParts(date);
  const diff = dayNumber(parts) - dayNumber(today);
  const time = withTime ? ` ${parts.hour}:${parts.minute}` : "";
  if (diff === 0) return `Hoje${time}`;
  if (diff === 1) return `Amanhã${time}`;
  if (diff === -1) return `Ontem${time}`;
  const dm = `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}`;
  if (Math.abs(diff) < 7) {
    const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" }).format(date).replace(".", "");
    return `${weekday} ${dm}${time}`;
  }
  return parts.year === today.year ? `${dm}${time}` : `${dm}/${parts.year}`;
}

// "agora", "há 3 h", "há 2 dias", "há 3 meses" — para último contato/cadastro.
export function formatAgo(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const today = getSaoPauloDateParts(new Date());
  const parts = getSaoPauloDateParts(date);
  const days = Math.max(0, dayNumber(today) - dayNumber(parts));
  if (days === 0) {
    const hours = Math.floor((Date.now() - date.getTime()) / 3600000);
    if (hours < 1) return "agora há pouco";
    return `hoje, ${parts.hour}:${parts.minute}`;
  }
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.max(1, ((today.year - parts.year) * 12) + today.month - parts.month);
  if (months < 12) return months === 1 ? "há 1 mês" : `há ${months} meses`;
  const years = Math.max(1, Math.floor(months / 12));
  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}

export function formatFullDateTime(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "Data a confirmar";
  const parts = getSaoPauloDateParts(date);
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year} às ${parts.hour}:${parts.minute}`;
}

export function getScheduleDraft(registration = {}) {
  const date = new Date(registration.scheduledActivityAt || "");
  if (!Number.isFinite(date.getTime())) {
    return { date: "", time: "", type: registration.scheduledActivityType || "follow_up", note: registration.scheduledActivityNote || "" };
  }
  const parts = getSaoPauloDateParts(date);
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    time: `${parts.hour}:${parts.minute}`,
    type: registration.scheduledActivityType || "follow_up",
    note: registration.scheduledActivityNote || ""
  };
}

export function buildDraftSimulationPayload(registration = {}) {
  return {
    registrationId: registration.id,
    clientName: registration.fullName || "Cliente sem nome",
    clientWhatsApp: formatBrazilianPhone(registration.phoneNormalized || registration.phone),
    simulationDate: new Date().toISOString().slice(0, 10),
    simulationType: "usado",
    financingValue: "",
    subsidyValue: "",
    firstInstallment: "",
    lastInstallment: "",
    downPaymentValue: registration.availablePurchaseResource || "",
    fgtsValue: "",
    showExpandedPower: false,
    publicNote: "",
    internalNote: [
      `WhatsApp do cadastro: ${toWhatsAppDigits(registration.phoneNormalized || registration.phone)}`,
      "Aguardando simulação"
    ].filter(Boolean).join("\n"),
    outputMode: "individual",
    properties: []
  };
}
