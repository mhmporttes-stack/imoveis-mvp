import { phoneComparisonKey } from "./phone-utils.js";

// Pontos do Lote de SMS do CORRETOR (PRO-18d, dono, 2026-11-02): "cada mensagem enviada pelo corretor no Lote de SMS pontua com a
// MESMA quantidade de pontos da prospecção". Regra pura; testes em tests/sms-batch-points.test.mjs.
//
// Sem tabela de pontos própria: os pontos são SEMPRE recalculados dos envios reais (`sms_batch_sends`, eventos `sent` = 1ª e
// `sent_2` = 2ª), como todo o ranking, e valem a regra `prospecting` vigente no instante de cada envio (getRulePointsAt).
// Idempotente por construção: um envio = no máximo UMA pontuação (a mesma linha lida duas vezes, ou gravada duas vezes por
// corrida, soma uma vez só: chave campanha + telefone + evento), "Desfazer" apaga a linha (some a pontuação) e número
// inválido/inativo (`invalid`/`inactive`) tira o envio da pontuação — nunca soma pontos a mais.
// Só pontua o lote DO CORRETOR (campanha "SMS - Lote da base" com broker_id; o pontuado é o dono da campanha); o lote da equipe
// (sem broker_id) não pontua ninguém. NÃO é tentativa de prospecção para nenhuma outra regra (contagem de Prospecção, teto
// diário, funil, Meta Diária): vira só uma fonte de pontos à parte no ranking/extrato.
export const SMS_POINTS_EVENTS = Object.freeze({ FIRST: "sent", SECOND: "sent_2" });
const NEGATIVE_EVENTS = new Set(["invalid", "inactive"]);

export function smsPointsLabel(event) {
  return event === SMS_POINTS_EVENTS.SECOND ? "Lote de SMS — 2ª mensagem" : "Lote de SMS — 1ª mensagem";
}

// sends: linhas de sms_batch_sends { id, campaign_id, event, created_at, phone_normalized } (qualquer evento);
// campaigns: [{ id, broker_id }] (só as com broker_id contam). Devolve os envios que pontuam:
// [{ sendId, brokerId, event, createdAt, label }], em ordem cronológica.
export function smsScoringEvents({ sends = [], campaigns = [] } = {}) {
  const brokerByCampaign = new Map(campaigns.filter((row) => row?.id && row.broker_id).map((row) => [row.id, row.broker_id]));
  const negative = new Set();
  for (const row of sends) {
    if (NEGATIVE_EVENTS.has(row?.event) && brokerByCampaign.has(row.campaign_id)) negative.add(`${row.campaign_id}|${phoneComparisonKey(row.phone_normalized)}`);
  }
  const kept = new Map();
  for (const row of sends) {
    if (row?.event !== SMS_POINTS_EVENTS.FIRST && row?.event !== SMS_POINTS_EVENTS.SECOND) continue;
    const brokerId = brokerByCampaign.get(row.campaign_id);
    const atMs = Date.parse(row.created_at || "");
    if (!brokerId || !Number.isFinite(atMs)) continue;
    const phoneKey = phoneComparisonKey(row.phone_normalized) || String(row.phone_normalized || "");
    if (negative.has(`${row.campaign_id}|${phoneKey}`)) continue;
    const key = `${row.campaign_id}|${phoneKey}|${row.event}`;
    const current = kept.get(key);
    if (!current || atMs < current.atMs) kept.set(key, { atMs, sendId: row.id, brokerId, event: row.event, createdAt: new Date(atMs).toISOString(), label: smsPointsLabel(row.event) });
  }
  return [...kept.values()].sort((a, b) => a.atMs - b.atMs).map(({ atMs, ...event }) => event);
}
