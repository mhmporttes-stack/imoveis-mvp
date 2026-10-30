// Regras puras dos reconhecimentos (RAN-9). Testadas em tests/celebrations-core.test.mjs.
import { saoPauloDateOf } from "./celebrations-ranking-core.mjs";

// Marcos da Meta Diária, do mais alto para o mais baixo (200% tem animação própria, não configurável).
export const DAILY_GOAL_MILESTONES = [
  { key: "daily_goal_200", defaultThreshold: 200, forcedAnimation: "combo_200" },
  { key: "daily_goal_150", defaultThreshold: 150, forcedAnimation: null },
  { key: "daily_goal_100", defaultThreshold: 100, forcedAnimation: null }
];

// O marco a registrar para um percentual: SÓ o mais alto alcançado entre os gatilhos ligados (pulou marcos de uma
// vez → mostra só o mais alto). Devolve null se nenhum foi alcançado. Antes o laço tentava o marco de baixo quando o
// de cima já existia, e um 100% aparecia depois do 150% no mesmo dia (caso real de 2026-10-01).
export function highestDailyGoalMilestone(percent, triggers) {
  const value = Number(percent) || 0;
  for (const milestone of DAILY_GOAL_MILESTONES) {
    const trigger = triggers?.get?.(milestone.key);
    if (!trigger?.enabled) continue;
    const threshold = Number(trigger.config?.threshold) || milestone.defaultThreshold;
    if (value >= threshold) return { ...milestone, threshold };
  }
  return null;
}

export function shiftPlainDate(day, days) {
  const [year, month, date] = String(day).split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + days));
  return value.toISOString().slice(0, 10);
}

// Meta batida detectada no servidor (disparo automático, fechamento do dia) só gera reconhecimento para hoje ou
// ontem (até 24 h depois do fim do dia, decisão do dono 2026-10-29) — nunca para dias antigos.
export function isRecognitionDayAllowed(day, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return false;
  return day === today || day === shiftPlainDate(today, -1);
}

// Data REAL do reconhecimento: na meta diária é o dia da meta (o evento pode ser gravado no fechamento, de madrugada
// do dia seguinte); nos demais, o dia em que o evento foi gerado (São Paulo).
export function recognitionEventDate({ trigger_key: triggerKey, event_key: eventKey, created_at: createdAt } = {}) {
  if (String(triggerKey || "").startsWith("daily_goal_")) {
    const match = String(eventKey || "").match(/:(\d{4}-\d{2}-\d{2})$/);
    if (match) return match[1];
  }
  return createdAt ? saoPauloDateOf(createdAt) : "";
}

function formatPlainDateChip(day) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" })
    .format(new Date(Date.UTC(year, month - 1, date, 12)))
    .replace(".", "");
}

// Texto do reconhecimento: [nome], [N] e [N+1] (o próximo dia da sequência: "vamos buscar o [N+1]º"). [N+1] vem
// antes de [N] para a troca não comer o começo dele.
export function resolveMessageText(template, { name, n } = {}) {
  let message = String(template || "").replace(/\[nome\]/g, name || "Corretor");
  if (n !== undefined && n !== null) {
    message = message.replace(/\[N\+1\]/g, String(Number(n) + 1)).replace(/\[N\]/g, String(n));
  }
  return message;
}

// Texto de reserva (banco de textos sem nenhuma variação ativa). Só os gatilhos de sequência têm texto próprio.
export function fallbackMessageFor(triggerKey, { name, n } = {}) {
  const who = name || "Corretor";
  if (triggerKey === "goal_streak" && n) return `${who}, esse é o ${n}º dia seguido de meta batida! 🔥`;
  if (triggerKey === "ranking_streak" && n) return `${who}, você manteve a liderança diária por ${n} dias seguidos. Vamos buscar o ${Number(n) + 1}º e manter a liderança! 👑`;
  return `Parabéns, ${who}! 🎉`;
}

// Selo de data da cena: "Hoje" só quando o evento é de hoje; "Ontem" para ontem; senão "Dia" com a data.
export function recognitionDateChip(eventDate, today) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(eventDate || "")) ? eventDate : today;
  const label = day === today ? "Hoje" : day === shiftPlainDate(today, -1) ? "Ontem" : "Dia";
  return { label, value: formatPlainDateChip(day) };
}
