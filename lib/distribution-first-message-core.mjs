// 1ª mensagem pelo Chat para cliente recebido pela DISTRIBUIÇÃO automática (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-19).
// "Para cliente recebido pela distribuição automática (roleta, fila de espera, reativação), a 1ª mensagem é
// OBRIGATORIAMENTE pelo Chat do CRM." Exceção à proteção "Chat só responde" (assertIndividualChatReplyOnly, 2026-10-05):
// pela sessão pessoal do corretor, conversa em que o cliente ainda não escreveu pode receber a 1ª mensagem SE o cliente
// chegou a ele pela distribuição e ele continua o responsável. Demais casos (contato frio, cliente transferido à mão,
// cliente de outro) seguem só respondendo. Motivo: a mensagem enviada pelo celular/WhatsApp Web nem sempre chega ao CRM
// (cópia que a sessão não decifra) e o cliente voltava para a fila mesmo atendido. Testes: tests/distribution-first-message.test.mjs.

// Folga entre a troca do responsável e o registro da distribuição (o histórico é gravado logo depois do UPDATE).
export const DISTRIBUTION_MATCH_TOLERANCE_MS = 2 * 60 * 1000;
const DISTRIBUTION_EVENTS = new Set(["assigned", "auto_transferred"]);

const time = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : NaN;
};

// client: { responsible_user_id, responsible_changed_at, pending_distribution_at }; latestDistribution: última linha de
// lead_distribution_history do cliente ({ event_type, to_user_id, created_at }); sessionOwnerId: dono do número que envia.
export function isDistributionFirstMessageAllowed({ client, latestDistribution, sessionOwnerId }) {
  const responsible = client?.responsible_user_id || "";
  if (!responsible || !sessionOwnerId || responsible !== sessionOwnerId) return false;
  // Na fila de espera/reativação o cliente só está "segurado" (pelo dono, FUN-11): não foi recebido por ninguém.
  if (client?.pending_distribution_at) return false;
  if (!latestDistribution || !DISTRIBUTION_EVENTS.has(latestDistribution.event_type)) return false;
  if (latestDistribution.to_user_id !== responsible) return false;
  // Transferência MANUAL depois da distribuição (grava responsible_changed_at, não o histórico da roleta) -> já não é
  // "recebido pela distribuição".
  const changedAt = time(client?.responsible_changed_at);
  const distributedAt = time(latestDistribution.created_at);
  if (!Number.isFinite(distributedAt)) return false;
  if (Number.isFinite(changedAt) && distributedAt < changedAt - DISTRIBUTION_MATCH_TOLERANCE_MS) return false;
  return true;
}
