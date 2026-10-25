import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { isOwnerAdminEmail } from "./admin-auth";
import { isHenryEligible } from "./henry-voice-core.mjs";
import { sendSupervisionMessage } from "./supervision-messages";
import {
  normalizeTeamAlertText,
  resolveTeamAlertRecipient,
  teamAlertAskReply,
  teamAlertNotFoundReply,
  teamAlertSentDetail,
  teamAlertSentReply
} from "./henry-team-alert-core.mjs";

// Henry manda recado para alguém da equipe (HENRY-1 "Recado à equipe", dono 2026-10-25 — regras em
// lib/henry-team-alert-core.mjs). O envio é EXATAMENTE a mensagem da Supervisão da Meta Diária (sendSupervisionMessage:
// tabela supervision_messages, balão central fixo na tela do destinatário até "OK"/resposta, push "Mensagem da supervisão").
// Envia direto, sem confirmação ("Sem sim, ele apenas envia"). Só o dono, conta real, fora de "Alterar conta" (a rota já
// passa por requireHenryOwner; aqui a 2ª trava). Treino (training = true) nunca envia.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function loadActiveTeam() {
  const { data, error } = await db().from("admin_users").select("id, name, gender, status").eq("status", "active");
  if (error) throw error;
  return data || [];
}

// → { sent, reply, detail, recipientId? }. sent = true só quando a mensagem foi gravada (nunca no treino).
export async function sendHenryTeamAlert(auth, { destinatario = "", texto = "" } = {}, { training = false } = {}) {
  if (!isHenryEligible({ ok: auth?.ok === true, accountSwitchMode: auth?.accountSwitchMode, isOwner: isOwnerAdminEmail(auth?.user?.email) })) {
    return { sent: false, reply: "Recado para a equipe só o Matheus manda, na conta dele.", detail: null };
  }
  const spoken = String(destinatario || "").slice(0, 60);
  const text = normalizeTeamAlertText(texto);
  if (!text) return { sent: false, reply: "Qual é o recado?", detail: null };
  const match = resolveTeamAlertRecipient(spoken, await loadActiveTeam(), { ownerId: auth?.profile?.id || "" });
  if (match.kind === "many") return { sent: false, reply: teamAlertAskReply(match.options), detail: null, options: match.options.map((user) => user.name) };
  if (match.kind !== "one") return { sent: false, reply: teamAlertNotFoundReply(spoken), detail: null };
  const user = match.user;
  if (training) return { sent: false, simulated: true, reply: teamAlertSentReply(user, text, { training: true }), detail: teamAlertSentDetail(user, text, { training: true }) };
  await sendSupervisionMessage(auth, { recipientId: user.id, body: text, origin: "henry" });
  console.info("[henry] recado à equipe enviado (supervisão).");
  return { sent: true, recipientId: user.id, reply: teamAlertSentReply(user, text), detail: teamAlertSentDetail(user, text) };
}
