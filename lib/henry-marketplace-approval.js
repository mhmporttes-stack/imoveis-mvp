import "server-only";
import { isOwnerAdminEmail } from "./admin-auth";
import { isHenryEligible } from "./henry-voice-core.mjs";
import { approveAwaitingMarketplaceConversations, listAwaitingOwnerApproval } from "./marketplace-chat";
import { buildHenryApprovalDetail, buildHenryApprovalReply, pickAwaitingForApproval } from "./henry-away-core.mjs";

// 3ª escrita do Henry (REGRA OFICIAL — dono, 2026-10-26, HENRY-1 / MKT-2m): "pode atender"/"aprova"/"libera" no bom dia
// aprova as conversas do acumulado do Marketplace que aguardam a aprovação dele. Aprovar = a MESMA entrega do botão
// "Aprovar atendimento" (approveAwaitingMarketplaceConversations → distribute: roleta / fila de espera). Só o dono, conta
// real, fora de "Alterar conta" (a rota do Henry já passa por requireHenryOwner; aqui a 2ª trava). Treino nunca aprova.
export async function approveMarketplaceByHenry(auth, { cliente = "" } = {}, { training = false } = {}) {
  if (!isHenryEligible({ ok: auth?.ok === true, accountSwitchMode: auth?.accountSwitchMode, isOwner: isOwnerAdminEmail(auth?.user?.email) })) {
    return { approved: 0, reply: "Liberar atendimento só o Matheus faz, na conta dele.", detail: null };
  }
  const picked = pickAwaitingForApproval(await listAwaitingOwnerApproval(), String(cliente || "").slice(0, 60));
  if (!picked.length) return { approved: 0, reply: buildHenryApprovalReply([], { none: true }), detail: null };
  const results = await approveAwaitingMarketplaceConversations(auth, picked.map((row) => row.id), { training });
  const approved = results.filter((item) => item.approved).length;
  if (approved) console.info(`[henry] atendimento do Marketplace liberado (${approved}).`);
  return { approved, simulated: training, reply: buildHenryApprovalReply(results, { training }), detail: buildHenryApprovalDetail(results, { training }) };
}
