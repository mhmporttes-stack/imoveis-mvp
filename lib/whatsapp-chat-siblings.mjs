import { conversationSessionOwner } from "./whatsapp-chat-scope.mjs";

// Mesmo cliente nos DOIS números do corretor (regra do dono, 2026-10-17 — WA-34): no Chat ele aparece UMA vez por corretor.
// No banco nada muda: continuam duas conversas (telefone + dono + número, WA-15) e cada uma responde pelo próprio número.
// Este módulo é só a regra pura de APRESENTAÇÃO: quais conversas são "irmãs" e qual delas representa o cliente.
//
// Irmãs = mesmo dono do WhatsApp pessoal (session_key) + mesmo telefone, ambas não excluídas e do MESMO lado do Particular
// (uma conversa Particular nunca empresta prévia/"não lida" para a lista de clientes, nem o contrário). Número oficial,
// grupos e conversas excluídas nunca se juntam com nada.

export function siblingKey(row) {
  const owner = conversationSessionOwner(row);
  const phone = String(row?.contact_phone || "");
  if (!owner || !phone || phone.startsWith("group:") || row?.deleted_at) return "";
  return `${owner}|${phone}|${row?.private_at ? "p" : "c"}`;
}

function newestFirst(a, b) {
  const diff = new Date(b?.last_message_at || 0).getTime() - new Date(a?.last_message_at || 0).getTime();
  if (diff) return diff;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

// rows = conversas do resultado (já filtradas pela aba/busca); siblings = conversas vivas que podem ser irmãs delas (pode
// repetir as de rows); accepts(member, row) = a irmã também entraria nesta aba/busca? Cada cliente fica representado pela
// conversa MAIS RECENTE que entra na aba — a mesma em qualquer página (a irmã mais nova, se entra na aba, já saiu numa página
// anterior), então "Carregar mais" nunca repete o cliente. Devolve { rows (mesma ordem, sem as irmãs), members (id da
// representante -> todas as irmãs, mais nova primeiro) }.
export function collapseSiblingRows(rows = [], siblings = [], accepts = () => false) {
  const groups = new Map();
  for (const row of [...rows, ...siblings]) {
    const key = siblingKey(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, new Map());
    const group = groups.get(key);
    if (!group.has(row.id)) group.set(row.id, row);
  }
  const inResult = new Set(rows.map((row) => row.id));
  const members = new Map();
  const kept = [];
  for (const row of rows) {
    const key = siblingKey(row);
    const group = key ? [...groups.get(key).values()].sort(newestFirst) : [];
    if (group.length < 2) {
      kept.push(row);
      continue;
    }
    const representative = group.find((member) => member.id === row.id || inResult.has(member.id) || accepts(member, row));
    if (representative?.id !== row.id) continue;
    kept.push(row);
    members.set(row.id, group);
  }
  return { rows: kept, members };
}

// Conversa ABERTA ao tocar no cliente (e por onde a resposta sai): a irmã em que o cliente escreveu por último — responder
// pelo número em que ele está falando. Sem mensagem do cliente em nenhuma, a mais recente.
export function replyConversation(members = []) {
  const withInbound = members.filter((member) => member?.last_inbound_at);
  if (!withInbound.length) return [...members].sort(newestFirst)[0] || null;
  return withInbound.sort((a, b) => new Date(b.last_inbound_at).getTime() - new Date(a.last_inbound_at).getTime())[0];
}

// Contadores (não lidas, aguardando nós...): cada cliente conta UMA vez. Agrupa as conversas em clientes (as sem irmã ficam
// sozinhas) — cada grupo vem com a mais recente primeiro.
export function groupConversationsOnce(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = siblingKey(row) || `id:${row.id}`;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(row.id, row);
  }
  return [...groups.values()].map((group) => [...group.values()].sort(newestFirst));
}
