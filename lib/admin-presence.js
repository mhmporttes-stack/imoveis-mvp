import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { listVisibleTeamProfiles } from "./admin-profiles";

export const PRESENCE_STATUS = { ONLINE: "online", AWAY: "away", OFFLINE: "offline" };

// Janelas de status — sempre DERIVADAS da idade de last_activity_at na hora
// da leitura, nunca de um evento de login/logout (fechar o navegador/PWA sem
// logout não pode manter alguém "online" para sempre). "Ausente" cobre quem
// ainda tem presença conhecida mas parou de interagir; depois da janela de
// ausência, cai para offline sozinho, sem depender de nenhum evento externo.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const AWAY_WINDOW_MS = 15 * 60 * 1000;

const STATUS_ORDER = { [PRESENCE_STATUS.ONLINE]: 0, [PRESENCE_STATUS.AWAY]: 1, [PRESENCE_STATUS.OFFLINE]: 2 };

export function canLoadAdminPresence() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function requireProfileId(auth) {
  const id = auth?.profile?.id;
  if (!auth?.ok || !id) throw new Error("Usuário sem perfil ativo.");
  return id;
}

function deriveStatus(lastActivityAt, now) {
  if (!lastActivityAt) return PRESENCE_STATUS.OFFLINE;
  const elapsed = now - new Date(lastActivityAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return PRESENCE_STATUS.OFFLINE;
  if (elapsed <= ONLINE_WINDOW_MS) return PRESENCE_STATUS.ONLINE;
  if (elapsed <= AWAY_WINDOW_MS) return PRESENCE_STATUS.AWAY;
  return PRESENCE_STATUS.OFFLINE;
}

// Chamado pelo heartbeat do navegador (components/AdminPresenceHeartbeat.jsx):
// carregamento da página, volta de segundo plano (PWA/mobile), navegação e um
// timer periódico enquanto a aba está visível — nunca por clique individual.
// Upsert simples (1 linha por usuário): idempotente por natureza, nunca soma
// nada, só marca "visto pela última vez agora".
export async function recordAdminHeartbeat(auth) {
  const userId = requireProfileId(auth);
  const now = new Date().toISOString();
  const { error } = await db()
    .from("admin_presence")
    .upsert({ user_id: userId, last_activity_at: now, updated_at: now }, { onConflict: "user_id" });
  if (error) throw error;
}

// Presença da equipe visível para quem pergunta — MESMA regra de
// visibilidade já usada no Ranking/Desempenho (listVisibleTeamProfiles):
// administrador geral vê todo mundo, gestor só a própria equipe. A lista de
// quem pode aparecer já sai filtrada antes de qualquer busca de presença —
// não há como pedir a presença de alguém fora desse escopo, mesmo chamando a
// API diretamente.
export async function getTeamPresence(auth) {
  assertGeneralAdminOrManager(auth);
  const profiles = await listVisibleTeamProfiles(auth);
  const ids = profiles.map((profile) => profile.id);
  if (!ids.length) return { online: 0, away: 0, offline: 0, members: [] };

  const { data, error } = await db().from("admin_presence").select("user_id, last_activity_at").in("user_id", ids);
  if (error) throw error;
  const lastActivityByUser = new Map((data || []).map((row) => [row.user_id, row.last_activity_at]));

  const now = Date.now();
  const members = profiles
    .map((profile) => {
      const lastActivityAt = lastActivityByUser.get(profile.id) || null;
      return {
        id: profile.id,
        name: profile.name || profile.email || "Usuário",
        photoUrl: profile.photoUrl || "",
        status: deriveStatus(lastActivityAt, now),
        lastActivityAt
      };
    })
    .sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (orderDiff !== 0) return orderDiff;
      const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bTime - aTime;
    });

  const counts = { online: 0, away: 0, offline: 0 };
  for (const member of members) counts[member.status] += 1;

  return { ...counts, members, generatedAt: new Date(now).toISOString() };
}

export function formatAdminPresenceError(error) {
  const message = error?.message || String(error || "");
  if (message.toLowerCase().includes("admin_presence")) {
    return "A tabela public.admin_presence ainda não existe no Supabase. Execute a migration supabase/migrations/20260916_admin_presence.sql.";
  }
  return message || "Não foi possível carregar a presença da equipe.";
}
