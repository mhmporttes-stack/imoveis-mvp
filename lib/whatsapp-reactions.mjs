// Último evento por participante vence, inclusive remoção (emoji vazio).
export function latestReactionsByTarget(reactions, targetIds) {
  const visible = new Set(targetIds);
  const latest = new Map();
  for (const reaction of [...reactions].sort((a, b) => new Date(b.message_at) - new Date(a.message_at))) {
    const target = reaction.payload?.reaction?.message_id || reaction.metadata?.replyToMessageId;
    if (!visible.has(target) || reaction.status === "failed") continue;
    const sender = reaction.direction === "inbound" ? "customer" : "team";
    const key = `${target}:${sender}`;
    if (!latest.has(key)) latest.set(key, reaction.body || "");
  }
  return latest;
}
