// Núcleo puro (testável) da proteção "atendimento humano ativo" contra a redistribuição automática.
// Um cliente NÃO volta para a roleta quando, depois que o responsável atual o recebeu (responsible_changed_at, ou a
// criação), uma pessoa: (1) RESPONDEU pelo Chat (last_human_reply_at) ou (2) ASSUMIU o atendimento (assumed_at).
// O que veio de um responsável anterior não protege quem recebeu depois.

export function pickProtectedClientIds(conversationRows, clients) {
  const lastSignalByClient = new Map();
  for (const row of conversationRows || []) {
    if (!row?.client_id) continue;
    for (const value of [row.last_human_reply_at, row.assumed_at]) {
      if (!value) continue;
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) continue;
      if (!lastSignalByClient.has(row.client_id) || time > lastSignalByClient.get(row.client_id)) lastSignalByClient.set(row.client_id, time);
    }
  }
  const protectedIds = new Set();
  for (const client of clients || []) {
    const signal = lastSignalByClient.get(client.id);
    if (!signal) continue;
    const anchor = new Date(client.responsible_changed_at || client.created_at || 0).getTime();
    if (signal >= anchor) protectedIds.add(client.id);
  }
  return protectedIds;
}
