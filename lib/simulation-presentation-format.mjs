// Formatação da Apresentação interativa da simulação — PURO, sem dependência de servidor
// (importado tanto pelo servidor quanto pelo player cliente).

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** R$ 232.000,00 (espaço não separável entre "R$" e o número, para não quebrar linha). */
export function formatBRL(value) {
  const number = Number(value);
  return BRL.format(Number.isFinite(number) ? number : 0);
}

/** "2026-10-03" ou ISO → "03/10/2026" sem deslocar o dia por fuso. */
export function formatDateBR(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
