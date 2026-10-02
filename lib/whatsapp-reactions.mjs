import { reactionTargetRefId } from "./whatsapp-message-actions.mjs";

// Último evento por participante vence, inclusive remoção (emoji vazio).
// Vale para os dois canais: Meta (payload.reaction.message_id /
// metadata.replyToMessageId) e sessão individual (metadata.reaction_target_wa_id).
export function latestReactionsByTarget(reactions, targetIds) {
  const visible = new Set(targetIds);
  const latest = new Map();
  for (const reaction of [...reactions].sort((a, b) => new Date(b.message_at) - new Date(a.message_at))) {
    const target = reactionTargetRefId(reaction);
    if (!visible.has(target) || reaction.status === "failed") continue;
    const sender = reaction.direction === "inbound" ? "customer" : "team";
    const key = `${target}:${sender}`;
    if (!latest.has(key)) latest.set(key, reaction.body || "");
  }
  return latest;
}
