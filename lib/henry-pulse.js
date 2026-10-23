import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createHenryReadCache } from "./henry-voice-core.mjs";
import { AUTO_SEND_EVENTS } from "./simulation-auto-send-core.mjs";
import { CCA_SENT_EVENT } from "./cca-submission-core.mjs";
import { officeBonusEntries } from "./office-presence-bonus-core.mjs";
import { findInternalTeamPhone } from "./internal-phones";
import { loadArrivalEvents } from "./henry-voice-client-alerts";
import { HENRY_PULSE_ROW_LIMIT, HENRY_PULSE_TYPE_KEYS, buildPulseEvents } from "./henry-pulse-core.mjs";

// "Pulso do CRM" do Henry (HENRY-1 "Pulso", rascunho [PENDENTE DE VALIDAÇÃO]). SOMENTE LEITURA: monta "eventos desde X"
// a partir do que o CRM JÁ grava — nada é gravado aqui, nada vai a cliente nem a corretor. Só o dono (rota
// /api/admin/henry/pulse). Fontes (cada uma com limite de linhas e índice existente quando há):
//   WhatsApp: whatsapp_conversations.last_message_at (índice) → whatsapp_messages por conversa (índice conversation_id,
//             message_at) — só saída humana (sender_type user), fora Particular/grupo/apagada/telefone da equipe;
//   Marketplace: marketplace_conversations.last_message_at (índice) → marketplace_messages de saída enviadas;
//   Publicações: marketplace_listings publicadas (o Instagram não é registrado no CRM — A CONFIRMAR com o dono);
//   Roleta: lead_distribution_history (índice created_at);
//   Linha do tempo: client_journey_events simulation_auto_sent / document_sent_to_cca (sem índice por data — volume baixo);
//   Chegada: a MESMA leitura do aviso do Henry (loadArrivalEvents → buildArrivalEvents);
//   Pontos: office_presence_bonus_awards (decisão gravada uma vez por dia) → officeBonusEntries.
// Fonte que falhar não derruba as outras: o motivo vai ao log (sem dado) e a resposta lista a fonte em `failed`.

const cache = createHenryReadCache({ ttlMs: 10 * 1000, maxEntries: 30 });

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

const unique = (values) => [...new Set(values.filter(Boolean))];

async function loadWhatsapp(sinceIso) {
  const conversations = await rows(
    db()
      .from("whatsapp_conversations")
      .select("id, contact_phone, contact_name, client_id, private_at, deleted_at")
      .gte("last_message_at", sinceIso)
      .not("contact_phone", "like", "group:%")
      .is("private_at", null)
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false })
      .limit(HENRY_PULSE_ROW_LIMIT)
  );
  if (!conversations.length) return { messages: [], conversations: [] };
  const messages = await rows(
    db()
      .from("whatsapp_messages")
      .select("id, conversation_id, direction, sender_type, sender_user_id, message_type, body, status, message_at, created_at")
      .in("conversation_id", conversations.map((row) => row.id))
      .eq("direction", "outbound")
      .eq("sender_type", "user")
      .not("sender_user_id", "is", null)
      .gte("message_at", sinceIso)
      .order("message_at", { ascending: false })
      .limit(HENRY_PULSE_ROW_LIMIT)
  );
  // Conversa com telefone da equipe (WA-12) nunca entra: marcada aqui, descartada em buildPulseEvents.
  const used = new Set(messages.map((row) => row.conversation_id));
  const marked = await Promise.all(
    conversations.filter((row) => used.has(row.id)).map(async (row) => ({ ...row, internal: Boolean(await findInternalTeamPhone(row.contact_phone)) }))
  );
  return { messages, conversations: marked };
}

async function loadMarketplace(sinceIso) {
  const conversations = await rows(
    db().from("marketplace_conversations").select("id, contact_name").gte("last_message_at", sinceIso).order("last_message_at", { ascending: false }).limit(HENRY_PULSE_ROW_LIMIT)
  );
  if (!conversations.length) return { messages: [], conversations: [] };
  const messages = await rows(
    db()
      .from("marketplace_messages")
      .select("id, conversation_id, direction, sender_user_id, body, status, sent_at, message_at, created_at")
      .in("conversation_id", conversations.map((row) => row.id))
      .eq("direction", "outbound")
      .eq("status", "sent")
      .gte("message_at", sinceIso)
      .order("message_at", { ascending: false })
      .limit(HENRY_PULSE_ROW_LIMIT)
  );
  return { messages, conversations };
}

async function loadBonuses(sinceIso) {
  const awards = await rows(db().from("office_presence_bonus_awards").select("award_date, kind, winners, decided_at").gte("decided_at", sinceIso).limit(10));
  return awards.flatMap((award) => officeBonusEntries([award]).map((entry) => ({ ...entry, day: award.award_date, decidedAt: award.decided_at })));
}

const SOURCES = {
  whatsapp: (sinceIso) => loadWhatsapp(sinceIso),
  marketplace: (sinceIso) => loadMarketplace(sinceIso),
  listings: (sinceIso) =>
    rows(db().from("marketplace_listings").select("id, title, neighborhood, status, published_at").eq("status", "published").gte("published_at", sinceIso).limit(HENRY_PULSE_ROW_LIMIT)),
  distributions: (sinceIso) =>
    rows(db().from("lead_distribution_history").select("id, registration_id, client_name, event_type, to_user_id, created_at").gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(HENRY_PULSE_ROW_LIMIT)),
  journey: (sinceIso) =>
    rows(
      db()
        .from("client_journey_events")
        .select("id, client_id, event_type, actor, actor_name, details, occurred_at")
        .in("event_type", [AUTO_SEND_EVENTS.sent, CCA_SENT_EVENT])
        .gte("occurred_at", sinceIso)
        .order("occurred_at", { ascending: false })
        .limit(HENRY_PULSE_ROW_LIMIT)
    ),
  arrivals: (sinceIso, ownerId) => loadArrivalEvents({ fromIso: sinceIso, ownerId }),
  bonuses: (sinceIso) => loadBonuses(sinceIso)
};

// Fontes necessárias para os tipos ligados (tipo desligado = fonte nem é consultada).
const SOURCE_TYPES = { whatsapp: ["whatsapp"], marketplace: ["messenger"], listings: ["instagram"], distributions: ["lead"], journey: ["simulacao", "cca"], arrivals: ["chegada"], bonuses: ["pontos"] };

async function loadPulse({ sinceIso, ownerId, types, snippets }) {
  const names = Object.keys(SOURCES).filter((name) => SOURCE_TYPES[name].some((type) => types.includes(type)));
  const settled = await Promise.allSettled(names.map((name) => SOURCES[name](sinceIso, ownerId)));
  const data = {};
  const failed = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") data[names[index]] = result.value;
    else {
      failed.push(names[index]);
      console.warn(`[henry] pulso: fonte ${names[index]} indisponível (${result.reason?.code || result.reason?.name || "erro"}).`);
    }
  });
  const whatsapp = data.whatsapp || { messages: [], conversations: [] };
  const marketplace = data.marketplace || { messages: [], conversations: [] };
  const clientIds = unique([...whatsapp.conversations.map((row) => row.client_id), ...(data.distributions || []).map((row) => row.registration_id), ...(data.journey || []).map((row) => row.client_id)]);
  const [users, clients] = await Promise.all([
    rows(db().from("admin_users").select("id, name, email, photo_url")),
    clientIds.length ? rows(db().from("simulation_registrations").select("id, full_name, private_contact_at").in("id", clientIds)) : []
  ]);
  const events = buildPulseEvents({
    whatsapp: whatsapp.messages,
    marketplace: marketplace.messages,
    listings: data.listings || [],
    distributions: data.distributions || [],
    journey: data.journey || [],
    arrivals: data.arrivals || [],
    bonuses: data.bonuses || [],
    users: new Map(users.map((user) => [user.id, user])),
    clients: new Map(clients.map((client) => [client.id, client])),
    conversations: new Map(whatsapp.conversations.map((row) => [row.id, row])),
    marketplaceConversations: new Map(marketplace.conversations.map((row) => [row.id, row])),
    snippets,
    types,
    ownerId
  });
  return { events, failed };
}

// sinceIso já validado por parsePulseSince. Cache curto (10 s) por janela de 10 s + opções: polls seguidos (outra aba,
// recarregar) não refazem as consultas.
export async function readHenryPulse(auth, { sinceIso, types = HENRY_PULSE_TYPE_KEYS, snippets = true } = {}) {
  const bucket = Math.floor(Date.parse(sinceIso) / 10000);
  const key = `${bucket}:${snippets ? 1 : 0}:${[...types].sort().join(",")}`;
  return cache.read(key, () => loadPulse({ sinceIso: new Date(bucket * 10000).toISOString(), ownerId: auth?.profile?.id || "", types, snippets }));
}
