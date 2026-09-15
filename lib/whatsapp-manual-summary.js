import "server-only";
import { getOwnerTeamDailyOverview } from "./daily-goal";
import { pickPerformanceTier } from "./daily-goal-performance-whatsapp";

// Alternativa ao envio automático (que depende de modelo aprovado pela
// Meta): aqui só se monta o TEXTO pronto — quem manda de verdade é o
// dono/gestor, abrindo o próprio WhatsApp num link wa.me com a mensagem já
// preenchida. Como não passa pela API da Meta, não tem restrição de modelo
// nenhuma — o texto pode ser livre, incluindo o tom exato pedido ("bateu a
// meta, foi bem", "dobrou a meta, espetacular", "não bateu, não foi tão
// bem").
export const MANUAL_SUMMARY_PERIODS = [
  { value: "today", label: "Resumo diário" },
  { value: "last7", label: "Resumo semanal" },
  { value: "last30", label: "Resumo mensal" }
];

const TIMEFRAME_LABEL = { today: "hoje", last7: "essa semana", last30: "esse mês" };
const SUMMARY_NOUN = { today: "do seu dia", last7: "da sua semana", last30: "do seu mês" };

export async function buildManualWhatsappSummary({ brokerId, period }) {
  const periodKey = MANUAL_SUMMARY_PERIODS.some((option) => option.value === period) ? period : "today";
  const ownerAuth = { ok: true, user: { email: "mhmporttes@gmail.com" }, profile: { id: "", role: "admin" } };
  const overview = await getOwnerTeamDailyOverview({ period: periodKey }, ownerAuth);
  const broker = overview.brokers.find((row) => row.brokerId === brokerId);
  if (!broker) throw new Error("Corretor não encontrado.");

  const { done, total, percent } = broker.meta;
  const { contatos, atendimentos, simulacoes } = broker.funnel;
  const timeframe = TIMEFRAME_LABEL[periodKey];
  const tier = pickPerformanceTier(percent);

  const lead = tier === "top"
    ? `🚀 Você dobrou a meta ${timeframe}, resultado espetacular!`
    : tier === "good"
      ? `🎯 Você bateu a meta ${timeframe}, mandou muito bem!`
      : `Resumo ${SUMMARY_NOUN[periodKey]}: você não bateu a meta ${timeframe} — vamos com tudo na próxima!`;

  const message = [
    `Olá ${broker.name || "tudo bem"}! ${lead}`,
    "",
    `Meta: ${done}/${total} (${percent}%)`,
    `Contatos: ${contatos}`,
    `Atendimentos: ${atendimentos}`,
    `Simulações: ${simulacoes}`
  ].join("\n");

  return { message, brokerName: broker.name || "Corretor", periodLabel: overview.range.label };
}
