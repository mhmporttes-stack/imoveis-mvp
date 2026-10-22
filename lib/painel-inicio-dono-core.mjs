// Núcleo PURO (testável) do Início do DONO (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md INI-5): "No resumo do
// dia, no MEU perfil de dono, eu quero algo mais completo, falando sobre os corretores, sobre as atenções que eu tenho
// que tomar". Só junta e ordena números que as fontes existentes já entregam (lib/painel-inicio-dono.js): nenhuma
// definição nova de meta, presença, espera, atraso ou fila mora aqui. Valor null = fonte indisponível (nunca vira zero).

// Limiares de apresentação [COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — a confirmar com o dono].
export const META_LOW_PERCENT = 50; // "corretor abaixo de 50% da meta"
export const META_LATE_FROM_MINUTES = 16 * 60; // "perto do fim do dia" = a partir das 16:00 (São Paulo)
export const ROULETTE_WATCH_FROM_MINUTES = 8 * 60; // "ninguém apto na roleta" só conta das 8:00…
export const ROULETTE_WATCH_UNTIL_MINUTES = 20 * 60; // …às 20:00 (de madrugada é o normal)

export function firstNameOf(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function joinPt(parts) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

// Nomes curtos para frase: "Ana, Bruno e mais 2".
export function namesList(names = [], max = 3) {
  const list = names.filter(Boolean);
  if (list.length <= max) return joinPt(list);
  return `${list.slice(0, max).join(", ")} e mais ${list.length - max}`;
}

// "Aguardando resposta" do Chat separado por corretor. items: [{ brokerId, clientId, name, lastMessageAt, waitingMinutes }]
// (cada item = um cliente aguardando, já na régua do getChatSummary). Devolve [{ brokerId, count, oldest }], maior primeiro.
export function groupAwaitingByBroker(items = []) {
  const byBroker = new Map();
  for (const item of items) {
    const key = item?.brokerId || null;
    if (!byBroker.has(key)) byBroker.set(key, { brokerId: key, count: 0, oldest: null });
    const bucket = byBroker.get(key);
    bucket.count += 1;
    const at = new Date(item.lastMessageAt || 0).getTime();
    if (!bucket.oldest || at < bucket.oldest.at) bucket.oldest = { at, name: item.name || "", clientId: item.clientId || null, waitingMinutes: item.waitingMinutes ?? null };
  }
  return [...byBroker.values()]
    .map(({ brokerId, count, oldest }) => ({ brokerId, count, oldest: oldest ? { name: oldest.name, clientId: oldest.clientId, waitingMinutes: oldest.waitingMinutes } : null }))
    .sort((a, b) => b.count - a.count);
}

// Estado do WhatsApp a partir dos ícones do painel Online (whatsappPresenceIcons): algum número ativo → "active";
// conectado mas ocioso (ROL-2e) → "idle"; nenhum conectado → "off". Sem dado → null.
export function whatsappStateOf(icons) {
  if (!Array.isArray(icons) || !icons.length) return null;
  if (icons.some((icon) => icon?.connected && icon.state === "active")) return "active";
  if (icons.some((icon) => icon?.connected)) return "idle";
  return "off";
}

const PRESENCE_ORDER = { online: 0, away: 1, offline: 2 };

// Uma linha por pessoa da equipe (profiles = listVisibleTeamProfiles). Cada fonte pode faltar (null).
export function buildOwnerTeamRows({ profiles = [], presence = null, metaBrokers = null, awaitingByBroker = null, overdueByBroker = null } = {}) {
  const presenceById = new Map((presence?.members || []).map((member) => [member.id, member]));
  const metaById = metaBrokers ? new Map(metaBrokers.map((broker) => [broker.brokerId, broker])) : null;
  const awaitingById = awaitingByBroker ? new Map(awaitingByBroker.map((item) => [item.brokerId, item])) : null;
  return profiles
    .filter((profile) => profile?.id)
    .map((profile) => {
      const member = presenceById.get(profile.id);
      const meta = metaById?.get(profile.id);
      const awaiting = awaitingById ? awaitingById.get(profile.id) || { count: 0, oldest: null } : null;
      return {
        id: profile.id,
        name: profile.name || profile.email || "Usuário",
        firstName: firstNameOf(profile.name || profile.email),
        photoUrl: profile.photoUrl || "",
        inRoulette: profile.leadDistributionEnabled === true,
        presence: presence ? member?.status || "offline" : null,
        whatsapp: presence ? whatsappStateOf(member?.whatsapp) : null,
        metaPercent: metaById ? (meta ? meta.meta?.percent ?? null : null) : null,
        pending: meta?.meta?.pending || null,
        awaiting: awaiting ? awaiting.count : null,
        oldest: awaiting?.oldest || null,
        overdue: overdueByBroker ? overdueByBroker.get(profile.id) ?? 0 : null
      };
    })
    .sort((a, b) => (PRESENCE_ORDER[a.presence] ?? 3) - (PRESENCE_ORDER[b.presence] ?? 3) || a.name.localeCompare(b.name, "pt-BR"));
}

// Lista "Atenções" do dono, na ordem de prioridade (o que trava a entrada de clientes primeiro). Cada item tem link para
// a tela certa. `unavailable`: fontes que falharam — viram aviso "não foi possível conferir", nunca silêncio.
export function buildOwnerAttentions({
  minutesOfDay = 0,
  rows = [],
  roulette = null, // { eligibleCount, queueCount } | null
  cooledDecisions = null,
  importantAlerts = null,
  marketplace = null, // { extensionSilentMinutes, failedReplies } | null
  toReview = null,
  unavailable = []
} = {}) {
  const items = [];
  const push = (key, tone, text, href) => items.push({ key, tone, text, href });

  const watchRoulette = minutesOfDay >= ROULETTE_WATCH_FROM_MINUTES && minutesOfDay < ROULETTE_WATCH_UNTIL_MINUTES;
  if (roulette) {
    const queue = Number(roulette.queueCount) || 0;
    if (watchRoulette && roulette.eligibleCount === 0) {
      push("roulette_empty", "danger", queue ? `Ninguém apto na roleta e ${plural(queue, "cliente esperando", "clientes esperando")} na fila.` : "Ninguém apto na roleta agora.", "/admin/simulacoes?responsibleUserId=roulette");
    } else if (queue) {
      push("roulette_queue", "warning", `${plural(queue, "cliente esperando", "clientes esperando")} na fila da roleta.`, "/admin/simulacoes?responsibleUserId=roulette");
    }
  }

  const inRoulette = rows.filter((row) => row.inRoulette);
  const off = inRoulette.filter((row) => row.whatsapp === "off").map((row) => row.firstName);
  const idle = inRoulette.filter((row) => row.whatsapp === "idle").map((row) => row.firstName);
  if (off.length) push("whatsapp_off", "danger", `WhatsApp desconectado de quem está na roleta: ${namesList(off)}.`, "/admin/desempenho/online");
  if (idle.length) push("whatsapp_idle", "warning", `WhatsApp ocioso de quem está na roleta: ${namesList(idle)}.`, "/admin/desempenho/online");

  if (cooledDecisions) push("cooled", "danger", `${plural(cooledDecisions, "cliente esfriado aguarda", "clientes esfriados aguardam")} a sua decisão.`, "/admin/desempenho/esfriados");
  if (importantAlerts) push("alerts", "danger", `${plural(importantAlerts, "alerta importante", "alertas importantes")} sem ciência.`, "/admin/notificacoes");

  if (marketplace?.extensionSilentMinutes != null) push("marketplace_extension", "danger", `Extensão do Marketplace sem sinal há ${marketplace.extensionSilentMinutes} minutos.`, "/admin/chat/marketplace");
  if (marketplace?.failedReplies) push("marketplace_failed", "warning", `${plural(marketplace.failedReplies, "resposta falhou", "respostas falharam")} no Marketplace nas últimas 24 horas.`, "/admin/chat/marketplace");

  if (minutesOfDay >= META_LATE_FROM_MINUTES) {
    const low = rows.filter((row) => row.metaPercent != null && row.metaPercent < META_LOW_PERCENT).sort((a, b) => a.metaPercent - b.metaPercent);
    if (low.length) push("meta_low", "warning", `Abaixo de ${META_LOW_PERCENT}% da meta: ${namesList(low.map((row) => `${row.firstName} (${row.metaPercent}%)`))}.`, "/admin/meta-diaria");
  }

  if (toReview) push("to_review", "warning", `${plural(toReview, "simulação automática", "simulações automáticas")} a conferir.`, "/admin/simulacoes?status=auto_simulation");

  if (unavailable.length) push("unavailable", "muted", `Não foi possível conferir agora: ${joinPt(unavailable)}.`, null);
  return items;
}

// Frase do resumo do DONO (sem IA), curta: leads, equipe on-line, aguardando resposta + mais urgente e quantas atenções.
export function buildOwnerAssistantText({ greeting = "Olá", firstName = "", leadsTotal = null, awaitingReply = null, urgent = null, rows = [], attentions = [] } = {}) {
  const parts = [firstName ? `${greeting}, ${firstName}.` : `${greeting}.`];
  if (Number.isFinite(leadsTotal)) parts.push(leadsTotal ? `Hoje entraram ${plural(leadsTotal, "lead", "leads")}.` : "Nenhum lead novo hoje ainda.");
  const withPresence = rows.filter((row) => row.presence);
  if (withPresence.length) parts.push(`Equipe: ${withPresence.filter((row) => row.presence === "online").length} de ${withPresence.length} on-line.`);
  if (awaitingReply) {
    const name = firstNameOf(urgent?.name);
    parts.push(`${plural(awaitingReply, "cliente aguarda resposta", "clientes aguardam resposta")}${name ? `; o mais antigo é ${name}` : ""}.`);
  }
  const real = attentions.filter((item) => item.tone !== "muted");
  parts.push(real.length ? `${plural(real.length, "atenção", "atenções")} para você: ${real[0].text}` : "Nenhuma atenção pendente para você agora.");
  return parts.join(" ");
}
