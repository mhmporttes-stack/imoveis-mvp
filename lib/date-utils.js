const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

export function formatDateSaoPaulo(value) {
  const date = parseDate(value);
  if (!date) return "Sem data";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: SAO_PAULO_TIME_ZONE
  }).format(date);
}

export function formatDateTimeSaoPaulo(value) {
  const date = parseDate(value);
  if (!date) return "Nao informado";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SAO_PAULO_TIME_ZONE
  }).format(date).replace(",", " as");
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = text.includes("T") ? new Date(text) : new Date(`${text}T12:00:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
