// "Pulso do CRM" do Henry (HENRY-1 "Pulso", rascunho [PENDENTE DE VALIDAÇÃO] — conceito aprovado pelo dono em 2026-10-23,
// visual ainda em ajuste no protótipo). Em volta do anel da tela cheia aparecem cards com eventos REAIS do CRM.
// Núcleo PURO (sem banco, sem rede): tipos, configuração, montagem da lista de eventos a partir das linhas já lidas,
// trecho seguro da mensagem, agrupamento de rajadas, texto do card e escolha de posição livre. Testes:
// tests/henry-pulse.test.mjs. Leitura no servidor: lib/henry-pulse.js; tela: components/henry/HenryPulse.jsx.
import { containsSensitiveContent, firstName } from "./alexa-config-core.mjs";
import { AUTO_SEND_EVENTS } from "./simulation-auto-send-core.mjs";
import { CCA_SENT_EVENT } from "./cca-submission-core.mjs";

// Tipos (mesmos nomes, cores e etiquetas do protótipo aprovado).
export const HENRY_PULSE_TYPES = Object.freeze({
  whatsapp: { label: "WhatsApp", color: "#4fd18b", tag: "WHATSAPP" },
  messenger: { label: "Messenger", color: "#7aa8ff", tag: "MARKETPLACE" },
  instagram: { label: "Publicação", color: "#ff8fb1", tag: "INSTAGRAM" },
  lead: { label: "Cliente novo", color: "#e9c27a", tag: "ROLETA" },
  simulacao: { label: "Simulação", color: "#5cd6ff", tag: "SIMULAÇÃO" },
  cca: { label: "Envio à CCA", color: "#b59cff", tag: "DOCUMENTOS" },
  chegada: { label: "Chegada", color: "#9be7c4", tag: "PRESENÇA" },
  pontos: { label: "Pontos", color: "#ffd36b", tag: "RANKING" }
});
export const HENRY_PULSE_TYPE_KEYS = Object.freeze(Object.keys(HENRY_PULSE_TYPES));

// Parâmetros visuais: MESMOS nomes do protótipo (pulso-do-crm.html). Quando o dono mandar os valores finais, troque só
// estes padrões. beam: "type" (cor do tipo, padrão aprovado) | "gold" | "cyan".
export const HENRY_PULSE_DEFAULTS = Object.freeze({
  rate: 14, // eventos por minuto (no máximo)
  maxCards: 3, // cards ao mesmo tempo
  life: 6.5, // segundos do ciclo inteiro (linha sai → moldura e card → parado → puxado de volta para o Henry)
  cardOpacity: 0.95,
  trailOpacity: 0.28,
  beam: "type",
  pulse: 0.6, // pulso do anel ao receber (0–1)
  types: HENRY_PULSE_TYPE_KEYS
});

// Intensidade (tela "Voz e personalidade"): só ritmo e quantidade; o resto vem dos padrões acima.
export const HENRY_PULSE_INTENSITIES = Object.freeze({
  suave: { label: "Suave", rate: 8, maxCards: 2 },
  normal: { label: "Normal", rate: HENRY_PULSE_DEFAULTS.rate, maxCards: HENRY_PULSE_DEFAULTS.maxCards },
  intenso: { label: "Intenso", rate: 26, maxCards: 4 }
});

export const HENRY_PULSE_SNIPPET_MAX = 60;
export const HENRY_PULSE_ROW_LIMIT = 40; // por fonte, por consulta
export const HENRY_PULSE_MAX_EVENTS = 60; // na resposta
export const HENRY_PULSE_MAX_LOOKBACK_MS = 15 * 60 * 1000; // since nunca mais antigo que isto
export const HENRY_PULSE_DEFAULT_LOOKBACK_MS = 2 * 60 * 1000;

// henry_voice_assistant.pulse: { enabled, intensity, types, snippets }. Nasce DESLIGADO até a aprovação do visual.
export function henryPulseFromSetting(value) {
  const pulse = value?.pulse && typeof value.pulse === "object" ? value.pulse : {};
  const types = Array.isArray(pulse.types) ? HENRY_PULSE_TYPE_KEYS.filter((key) => pulse.types.includes(key)) : [...HENRY_PULSE_TYPE_KEYS];
  return {
    enabled: pulse.enabled === true,
    intensity: Object.hasOwn(HENRY_PULSE_INTENSITIES, pulse.intensity) ? pulse.intensity : "normal",
    types,
    snippets: pulse.snippets !== false
  };
}

// PUT { pulse: { enabled?, intensity?, types?, snippets? } } → patch validado (ou erro).
export function parseHenryPulsePatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Configuração do Pulso inválida." };
  const patch = {};
  if ("enabled" in input) {
    if (typeof input.enabled !== "boolean") return { ok: false, error: "Pulso: liga/desliga inválido." };
    patch.enabled = input.enabled;
  }
  if ("snippets" in input) {
    if (typeof input.snippets !== "boolean") return { ok: false, error: "Pulso: trecho da mensagem inválido." };
    patch.snippets = input.snippets;
  }
  if ("intensity" in input) {
    if (!Object.hasOwn(HENRY_PULSE_INTENSITIES, input.intensity)) return { ok: false, error: "Pulso: intensidade inválida." };
    patch.intensity = input.intensity;
  }
  if ("types" in input) {
    if (!Array.isArray(input.types) || input.types.some((key) => !HENRY_PULSE_TYPE_KEYS.includes(key))) return { ok: false, error: "Pulso: tipo de evento inválido." };
    patch.types = HENRY_PULSE_TYPE_KEYS.filter((key) => input.types.includes(key));
  }
  if (!Object.keys(patch).length) return { ok: false, error: "Pulso: nada para salvar." };
  return { ok: true, patch };
}

// Configuração do componente (parâmetros do protótipo) a partir da configuração salva.
export function henryPulseConfig(setting = {}, overrides = {}) {
  const intensity = HENRY_PULSE_INTENSITIES[setting.intensity] || HENRY_PULSE_INTENSITIES.normal;
  return { ...HENRY_PULSE_DEFAULTS, rate: intensity.rate, maxCards: intensity.maxCards, types: Array.isArray(setting.types) ? setting.types : [...HENRY_PULSE_TYPE_KEYS], ...overrides };
}

// ?since= (ISO). Ausente/inválido → últimos 2 min; nunca mais antigo que 15 min nem no futuro.
export function parsePulseSince(value, now = Date.now()) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return new Date(now - HENRY_PULSE_DEFAULT_LOOKBACK_MS).toISOString();
  return new Date(Math.min(now, Math.max(ms, now - HENRY_PULSE_MAX_LOOKBACK_MS))).toISOString();
}

// Trecho da mensagem: até 60 caracteres, sem link/e-mail, e NUNCA com CPF, telefone, número longo, valor ou palavra
// sensível (mesma barreira da Alexa, containsSensitiveContent) — se tiver, o trecho some (o card continua).
export function pulseSnippet(text, max = HENRY_PULSE_SNIPPET_MAX) {
  const clean = String(text || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/\S+@\S+\.\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || containsSensitiveContent(clean) || /\d[\d\s().-]{6,}\d/.test(clean)) return "";
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// Primeiro nome legível (sem número/telefone; contato salvo como "5514999…" vira "").
export function pulseFirstName(name) {
  return firstName(name);
}

// Cor estável por corretor (avatar sem foto), da paleta do protótipo.
const BROKER_COLORS = ["#5cd6ff", "#ff9fb8", "#b59cff", "#9be7c4", "#ffd36b", "#7aa8ff", "#e9c27a", "#4fd18b"];
export function pulseBrokerColor(id) {
  let hash = 0;
  for (const char of String(id || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BROKER_COLORS[hash % BROKER_COLORS.length];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clientLink = (id) => (UUID.test(String(id || "")) ? { path: `/admin/simulacoes?clientId=${id}`, clientId: id } : null);
const chatLink = (clientId) => (UUID.test(String(clientId || "")) ? { path: `/admin/chat?client=${clientId}` } : { path: "/admin/chat" });
const marketplaceLink = (id) => (UUID.test(String(id || "")) ? { path: `/admin/chat/marketplace?conversa=${id}` } : { path: "/admin/chat/marketplace" });

const MEDIA_LABELS = { image: "enviou uma foto", video: "enviou um vídeo", audio: "enviou um áudio", ptt: "enviou um áudio", document: "enviou um arquivo", sticker: "enviou uma figurinha", view_once: "enviou uma mídia" };

// Conversa do WhatsApp que NUNCA entra no Pulso: Particular (private_at), grupo (group:), apagada, contato da equipe
// (internal = telefone da equipe, marcado pelo servidor com findInternalTeamPhone) e cliente marcado como contato pessoal.
export function isPulseHiddenConversation(conversation, client = null) {
  if (!conversation) return true;
  if (conversation.private_at || conversation.deleted_at || conversation.internal) return true;
  if (String(conversation.contact_phone || "").startsWith("group:")) return true;
  return Boolean(client?.private_contact_at);
}

// Monta a lista unificada ("eventos desde X"), mais recente por último, com payload mínimo:
// { id, type, at, broker: { name, photo, color } | null, client, snippet?, tag?, detail?, link }.
// Nunca telefone, CPF, documento, e-mail nem texto de conversa Particular/grupo/interna.
// Entradas = linhas cruas já lidas pelo servidor (lib/henry-pulse.js) + mapas de usuários, clientes e conversas.
export function buildPulseEvents({
  whatsapp = [],
  marketplace = [],
  listings = [],
  distributions = [],
  journey = [],
  arrivals = [],
  bonuses = [],
  users = new Map(),
  clients = new Map(),
  conversations = new Map(),
  marketplaceConversations = new Map(),
  snippets = true,
  types = HENRY_PULSE_TYPE_KEYS,
  ownerId = "",
  limit = HENRY_PULSE_MAX_EVENTS
} = {}) {
  const allowed = new Set(types);
  const events = [];
  const broker = (id) => {
    const user = users.get(id);
    if (!user) return null;
    return { name: pulseFirstName(user.name) || "Equipe", photo: typeof user.photo_url === "string" && /^https:\/\//.test(user.photo_url) ? user.photo_url : "", color: pulseBrokerColor(user.id) };
  };
  const clientName = (id) => pulseFirstName(clients.get(id)?.full_name);
  const push = (event) => {
    if (allowed.has(event.type) && event.at && Number.isFinite(Date.parse(event.at))) events.push(event);
  };

  for (const row of whatsapp) {
    // Só mensagem HUMANA de saída (corretor no Chat). Automação, cliente e nota interna ficam fora.
    if (row?.direction !== "outbound" || row.sender_type !== "user" || !row.sender_user_id || row.status === "failed") continue;
    const conversation = conversations.get(row.conversation_id);
    const client = conversation?.client_id ? clients.get(conversation.client_id) : null;
    if (isPulseHiddenConversation(conversation, client)) continue;
    const text = row.message_type === "text" || row.message_type === "interactive" || row.message_type === "button" ? (snippets ? pulseSnippet(row.body) : "") : MEDIA_LABELS[row.message_type] || "";
    push({
      id: `wa:${row.id}`,
      type: "whatsapp",
      at: row.message_at || row.created_at,
      broker: broker(row.sender_user_id),
      client: (client ? pulseFirstName(client.full_name) : "") || pulseFirstName(conversation.contact_name),
      snippet: text,
      group: `whatsapp:${row.sender_user_id}`,
      link: chatLink(conversation.client_id)
    });
  }

  for (const row of marketplace) {
    if (row?.direction !== "outbound" || row.status !== "sent") continue; // nota interna e fila ainda não enviada ficam fora
    const conversation = marketplaceConversations.get(row.conversation_id);
    if (!conversation) continue;
    push({
      id: `mkt:${row.id}`,
      type: "messenger",
      at: row.sent_at || row.message_at || row.created_at,
      broker: row.sender_user_id ? broker(row.sender_user_id) : null,
      client: pulseFirstName(conversation.contact_name),
      snippet: snippets ? pulseSnippet(row.body) : "",
      group: `messenger:${row.sender_user_id || "auto"}`,
      link: marketplaceLink(conversation.id)
    });
  }

  for (const row of listings) {
    if (row?.status !== "published" || !row.published_at) continue;
    push({
      id: `pub:${row.id}`,
      type: "instagram",
      at: row.published_at,
      broker: null,
      client: "",
      tag: "MARKETPLACE",
      detail: String(row.neighborhood || row.title || "").replace(/\s+/g, " ").trim().slice(0, 60),
      link: { path: "/admin/imoveis" }
    });
  }

  for (const row of distributions) {
    const client = clients.get(row?.registration_id);
    if (!row?.to_user_id || client?.private_contact_at) continue;
    push({
      id: `lead:${row.id}`,
      type: "lead",
      at: row.created_at,
      broker: broker(row.to_user_id),
      client: pulseFirstName(client?.full_name || row.client_name),
      transferred: row.event_type === "auto_transferred",
      link: clientLink(row.registration_id)
    });
  }

  for (const row of journey) {
    const client = clients.get(row?.client_id);
    if (!client || client.private_contact_at) continue;
    if (row.event_type === AUTO_SEND_EVENTS.sent) {
      push({ id: `sim:${row.id}`, type: "simulacao", at: row.occurred_at, broker: null, client: clientName(row.client_id), link: clientLink(row.client_id) });
    } else if (row.event_type === CCA_SENT_EVENT) {
      const actorId = [...users.values()].find((user) => user.email && user.email === row.actor)?.id || "";
      push({
        id: `cca:${row.id}`,
        type: "cca",
        at: row.occurred_at,
        broker: actorId ? broker(actorId) : row.actor_name ? { name: pulseFirstName(row.actor_name), photo: "", color: pulseBrokerColor(row.actor) } : null,
        client: clientName(row.client_id),
        detail: String(row.details?.ccaName || "").replace(/\s+/g, " ").trim().slice(0, 30),
        link: clientLink(row.client_id)
      });
    }
  }

  // Chegada: a MESMA definição do aviso do Henry (buildArrivalEvents, já filtrada pelo servidor; o dono fica fora).
  for (const row of arrivals) {
    if (!row?.userId || row.userId === ownerId) continue;
    push({ id: `chegada:${row.userId}:${row.day}`, type: "chegada", at: row.at, broker: broker(row.userId), client: "", link: { path: "/admin/desempenho/online" } });
  }

  // Pontos: lançamentos do bônus da imobiliária (officeBonusEntries), na hora em que a decisão foi gravada.
  for (const row of bonuses) {
    if (!row?.brokerId || !row.points) continue;
    push({ id: `pontos:${row.kind}:${row.day}:${row.brokerId}`, type: "pontos", at: row.decidedAt || row.occurredAt, broker: broker(row.brokerId), client: "", points: row.points, detail: String(row.action || "").slice(0, 60), link: { path: "/admin/desempenho/pontuacao" } });
  }

  const seen = new Set();
  return events
    .filter((event) => (seen.has(event.id) ? false : seen.add(event.id)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-limit);
}

// Rajada: eventos do MESMO grupo (mesmo corretor e canal) a menos de windowMs um do outro viram um card só
// ("Bruna enviou 5 mensagens"). Mantém a ordem; o card agrupado fica com o horário e o link do último.
export function groupPulseBursts(events = [], { windowMs = 90 * 1000 } = {}) {
  const out = [];
  const open = new Map();
  for (const event of events) {
    if (!event?.group) {
      out.push(event);
      continue;
    }
    const current = open.get(event.group);
    if (current && Date.parse(event.at) - Date.parse(current.at) <= windowMs) {
      current.count += 1;
      current.at = event.at;
      current.link = event.link;
      current.ids.push(event.id);
      current.clients = [...new Set([...current.clients, event.client].filter(Boolean))];
      continue;
    }
    const fresh = { ...event, count: 1, ids: [event.id], clients: event.client ? [event.client] : [] };
    open.set(event.group, fresh);
    out.push(fresh);
  }
  return out;
}

const plural = (count, one, many) => (count === 1 ? one : many);

// Avatar do card (protótipo v13, dono 2026-10-23): canal (WhatsApp, Messenger, Instagram/publicação) → ícone do canal;
// simulação automática → ícone de casa; evento de corretor (roleta, CCA, chegada, pontos) → FOTO real do perfil
// (admin_users.photo_url) com anel de 1,5 px na cor dele; sem foto → inicial num círculo na cor do corretor.
export const HENRY_PULSE_ICON_TYPES = Object.freeze(["whatsapp", "messenger", "instagram", "simulacao"]);
export function pulseAvatar(event) {
  if (HENRY_PULSE_ICON_TYPES.includes(event?.type)) return { kind: "icon", icon: event.type };
  const color = event?.broker?.color || HENRY_PULSE_TYPES[event?.type]?.color || "#5cd6ff";
  if (event?.broker?.photo) return { kind: "photo", url: event.broker.photo, color };
  return { kind: "initial", letter: pulseCardText(event).initial, color };
}

// Texto do card (como no protótipo): { tag, who, what, trail, initial }.
export function pulseCardText(event) {
  const type = HENRY_PULSE_TYPES[event?.type] || HENRY_PULSE_TYPES.whatsapp;
  const name = event?.broker?.name || "";
  const client = event?.client || "";
  const count = event?.count || 1;
  const many = count > 1;
  const base = { tag: event?.tag || type.tag, initial: (name || type.label)[0]?.toUpperCase() || "•" };
  switch (event?.type) {
    case "whatsapp":
      return many
        ? { ...base, who: `${name || "Equipe"} enviou ${count} mensagens`, what: event.clients?.length ? `Para ${event.clients.slice(0, 3).join(", ")}` : "No WhatsApp", trail: `${name} enviou ${count} mensagens` }
        : { ...base, who: `${name || "Equipe"} → ${client || "cliente"}`, what: event.snippet || "Mensagem enviada", trail: `${name} enviou mensagem para ${client || "um cliente"}` };
    case "messenger":
      return many
        ? { ...base, initial: name ? base.initial : "M", who: `${name || "Messenger"}: ${count} respostas`, what: "No Marketplace", trail: `${count} respostas no Marketplace` }
        : { ...base, initial: name ? base.initial : "M", who: `${name || "Messenger"} → ${client || "cliente"}`, what: event.snippet || (name ? "Resposta enviada" : "Resposta automática enviada"), trail: `${name || "Extensão"} respondeu ${client || "um cliente"} no Marketplace` };
    case "instagram":
      return { ...base, initial: "P", who: "Imóvel publicado", what: event.detail || "Novo anúncio", trail: `Publicação no ${base.tag === "MARKETPLACE" ? "Marketplace" : "Instagram"}` };
    case "lead":
      return event.transferred
        ? { ...base, who: `Transferido → ${name}`, what: `${client || "Cliente"} foi para ${name}`, trail: `${client || "Cliente"} transferido para ${name}` }
        : { ...base, who: `Novo cliente → ${name}`, what: `${client || "Cliente"} entrou pela roleta`, trail: `${client || "Cliente"} entrou e foi para ${name}` };
    case "simulacao":
      return { ...base, initial: "S", who: `Simulação → ${client || "cliente"}`, what: "Enviada automaticamente", trail: `Simulação automática enviada para ${client || "um cliente"}` };
    case "cca":
      return { ...base, who: `${event.detail || "CCA"} ← ${client || "cliente"}`, what: name ? `Documentos enviados por ${name}` : "Documentos enviados", trail: `Documentos de ${client || "um cliente"} enviados à ${event.detail || "CCA"}` };
    case "chegada":
      return { ...base, who: `${name} chegou`, what: "Na imobiliária agora", trail: `${name} chegou na imobiliária` };
    case "pontos":
      return { ...base, who: `+${event.points} ${plural(event.points, "pt", "pts")} · ${name}`, what: event.detail || "Bônus", trail: `${name} ganhou ${event.points} pontos` };
    default:
      return { ...base, who: name || type.label, what: "", trail: type.label };
  }
}

// Posição livre para um card (porte do freeSpot do protótipo, aprovado pelo dono em 2026-10-23):
// computador (largura ≥ 820 ou mouse) = só nas faixas laterais, FORA da coluna do anel (o card nunca fica por cima
// do Henry), espaçado dos cards vivos da mesma faixa; celular = em volta do anel (pode cruzar). random injetável (testes).
export const HENRY_PULSE_CARD_W = 270;
export const HENRY_PULSE_WIDE = 820;
const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
// wide = largura ≥ 820 OU mouse (pointer: fine), decidido pela tela; só o lado onde o card cabe INTEIRO fora da coluna.
export function pickPulseSpot({ W, H, cx, cy, R, live = [], cardW = HENRY_PULSE_CARD_W, gap = 70, random = Math.random, topSafe = 110, bottomSafe = 120, wide = W >= HENRY_PULSE_WIDE, cardH = 58 }) {
  const leftMax = cx - R - gap - cardW;
  const rightMin = cx + R + gap;
  const fitsL = leftMax >= 24;
  const fitsR = rightMin <= W - cardW - 24;
  for (let tries = 0; tries < 40; tries += 1) {
    let x;
    let y;
    if (wide) {
      const left = fitsL && fitsR ? random() < 0.5 : fitsL;
      x = left ? 24 + random() * Math.max(10, leftMax - 24) : rightMin + random() * Math.max(10, W - cardW - 24 - rightMin);
      y = topSafe + random() * Math.max(10, H - topSafe - bottomSafe);
      if (left ? x + cardW > cx - R - gap / 2 : x < cx + R + gap / 2) continue;
    } else {
      const angle = random() * Math.PI * 2;
      const dist = R + 60 + random() * Math.min(W, H) * 0.2;
      x = cx + Math.cos(angle) * dist - cardW / 2;
      y = cy + Math.sin(angle) * dist;
      // Celular: pode cruzar o anel (dono aceitou), mas o card nunca cobre o MEIO dele — senão o feixe não tem para onde ir.
      const nearX = clampValue(cx, x, x + cardW);
      const nearY = clampValue(cy, y, y + cardH);
      if (Math.hypot(nearX - cx, nearY - cy) < R * 0.75) continue;
    }
    if (x < 12 || x > W - cardW - 12 || y < 60 || y > H - 70) continue;
    if (live.every((card) => Math.abs(card.x - x) > cardW * 0.7 || Math.abs(card.y - y) > 120)) return { x, y, side: wide ? (x < cx ? "left" : "right") : "around" };
  }
  return wide ? { x: Math.max(12, Math.min(W - cardW - 12, rightMin)), y: topSafe + 20 + random() * Math.max(10, H - topSafe - bottomSafe - 40), side: "right" } : { x: Math.max(12, cx - cardW / 2), y: Math.min(H - 70, cy + R + 24), side: "around" };
}

// Ponto da Bézier cúbica do feixe (sai do anel, ondula e chega no lado do card mais próximo do anel).
export function pulseBeamCurve({ sx, sy, tx, ty, bend = 0.3, wobble = 0 }) {
  const len = Math.hypot(tx - sx, ty - sy) || 1;
  const nx = -(ty - sy) / len;
  const ny = (tx - sx) / len;
  const b = bend * len;
  const w = wobble * len;
  const c1x = sx + (tx - sx) * 0.35 + nx * (b + w);
  const c1y = sy + (ty - sy) * 0.35 + ny * (b + w);
  const c2x = sx + (tx - sx) * 0.75 + nx * (b * 0.4 - w);
  const c2y = sy + (ty - sy) * 0.75 + ny * (b * 0.4 - w);
  return (u) => {
    const m = 1 - u;
    return [m * m * m * sx + 3 * m * m * u * c1x + 3 * m * u * u * c2x + u * u * u * tx, m * m * m * sy + 3 * m * m * u * c1y + 3 * m * u * u * c2y + u * u * u * ty];
  };
}

// Ciclo de vida do card e da linha (protótipo v10, pedidos do dono em 2026-10-23; o card NÃO sobe mais — "Subida" saiu
// do protótipo), k = idade / life (0–1):
// 1) 0–0,15 a linha sai do Henry e vai até o ponto do card (card invisível); 2) 0,15–0,24 desenha a moldura ondulada
// (rect, com ease) e o card aparece dentro dela entre 0,22 e 0,30, sem crescer; 3) 0,30–0,70 fica parado;
// 4) 0,70–1 pull = ease(...): a linha puxa card e moldura de volta para dentro do Henry — o centro do card vai em linha
// reta até o anel (raio × 0,85), a escala cai de 1 para 0,15 e opacidade/moldura apagam a partir de pull 0,55; a linha
// continua ligada; 5) k ≥ 1: o anel recebe um pulso (o Henry "engole" o card). Movimento reduzido: sem puxada (o card
// só apaga no fim).
export const HENRY_PULSE_PHASES = Object.freeze({ reach: 0.15, rect: 0.24, shown: 0.3, pull: 0.7 });
export const HENRY_PULSE_SWALLOW = 0.6; // pulso do anel ao "engolir" o card = pulse × 0,6
export function pulseEase(v) {
  return v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
}
export function pulsePhase(k, { reduced = false } = {}) {
  const P = HENRY_PULSE_PHASES;
  const appear = k < P.rect - 0.02 ? 0 : Math.min(1, (k - (P.rect - 0.02)) / (P.shown - P.rect + 0.02));
  const pull = reduced || k < P.pull ? 0 : pulseEase((k - P.pull) / (1 - P.pull));
  const fadeOut = reduced ? (k < 0.85 ? 1 : Math.max(0, 1 - (k - 0.85) / 0.15)) : 1 - Math.max(0, (pull - 0.55) / 0.45);
  const beam = k < P.reach ? pulseEase(k / P.reach) : 1;
  // Moldura: rect = quanto do contorno está desenhado (0–1; null = ainda não chegou); apaga junto com o card (fadeOut).
  const rect = k < P.reach ? null : Math.min(1, (k - P.reach) / (P.rect - P.reach));
  return { appear, pull, fadeOut, beam, rect, frame: rect === null ? null : fadeOut, scale: 1 - 0.85 * pull };
}

// Posição do card durante a puxada: o CENTRO vai em linha reta até o ponto do anel na direção do card (raio × 0,85).
export function pulsePullPosition({ x, y, w, h }, { cx, cy, R }, pull) {
  const ccx = x + w / 2;
  const ccy = y + h / 2;
  const angle = Math.atan2(ccy - cy, ccx - cx);
  const destX = cx + Math.cos(angle) * R * 0.85;
  const destY = cy + Math.sin(angle) * R * 0.85;
  return { x: x + (destX - ccx) * pull, y: y + (destY - ccy) * pull };
}

// Moldura orgânica (protótipo v8, dono 2026-10-23): contorno ondulado que "respira" em volta da informação. Forma base =
// superelipse (expoente 2,4) com semi-eixos (largura/2 + 14, altura/2 + 12), centrada no card; o raio é modulado por
// ondas lentas (zero com movimento reduzido). O feixe chega no ponto voltado para o anel (pulseBlobStartAngle); dali a
// moldura é desenhada nos dois sentidos até fechar (comprimento aproximado pulseBlobPerimeter).
export function pulseBlobShape({ left, top, width, height, born = 0, t = 0, reduced = false }) {
  const mx = left + width / 2;
  const my = top + height / 2;
  const ax = width / 2 + 14;
  const ay = height / 2 + 12;
  const seed = born * 0.001;
  const point = (th) => {
    const co = Math.cos(th);
    const si = Math.sin(th);
    const r0 = 1 / Math.pow(Math.pow(Math.abs(co / ax), 2.4) + Math.pow(Math.abs(si / ay), 2.4), 1 / 2.4);
    const wave = reduced ? 0 : 0.08 * Math.sin(3 * th + t * 0.0013 + seed) + 0.05 * Math.sin(5 * th - t * 0.0019 + seed * 1.7) + 0.03 * Math.sin(8 * th + t * 0.003 + seed * 0.6);
    return [mx + co * r0 * (1 + wave), my + si * r0 * (1 + wave)];
  };
  return { mx, my, perimeter: Math.PI * (ax + ay) * 1.08, point };
}
export function pulseBlobStartAngle({ mx, my }, cx, cy) {
  return Math.atan2(cy - my, cx - mx);
}
