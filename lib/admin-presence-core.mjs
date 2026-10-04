// Puro (sem banco, sem "server-only") — regras de presença testáveis em
// tests/admin-presence-core.test.mjs.
//
// Duas leituras da mesma atividade, de propósito separadas (regra do dono,
// 2026-10-01, ROL-2b em docs/BUSINESS_RULES.md):
//   - ROLETA (elegibilidade): `admin_presence.last_activity_at` = hora REAL da
//     última atividade no CRM (clique, tecla, clique no WhatsApp, envio pelo
//     Chat). On-line = até 5 min depois disso, sem nenhuma extensão.
//     pick_round_robin_broker (SQL) lê essa coluna direto.
//   - VISUAL (painel Online, seletor 🟢 do Chat, painel da roleta): mantém a
//     tolerância que já existia depois de uma ação de WhatsApp — uma marca
//     `kind='grace'` em admin_presence_activity conta como atividade até
//     GRACE_EXTENSION_MS depois do minuto em que aconteceu. Isso preserva o
//     comportamento visual de antes sem gravar hora no futuro na coluna que a
//     roleta usa.

export const PRESENCE_STATUS = { ONLINE: "online", AWAY: "away", OFFLINE: "offline" };
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export const AWAY_WINDOW_MS = 30 * 60 * 1000;
export const GRACE_EXTENSION_MS = 5 * 60 * 1000;

function toMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function deriveStatus(lastActivityAt, now) {
  if (!lastActivityAt) return PRESENCE_STATUS.OFFLINE;
  const elapsed = now - new Date(lastActivityAt).getTime();
  if (!Number.isFinite(elapsed)) return PRESENCE_STATUS.OFFLINE;
  if (elapsed < 0) return PRESENCE_STATUS.ONLINE;
  if (elapsed <= ONLINE_WINDOW_MS) return PRESENCE_STATUS.ONLINE;
  if (elapsed <= AWAY_WINDOW_MS) return PRESENCE_STATUS.AWAY;
  return PRESENCE_STATUS.OFFLINE;
}

// Referência usada SÓ para o status visual: a mais recente entre a atividade
// real e (última marca de tolerância + extensão). Devolve ISO ou null.
export function visualActivityReference(lastActivityAt, lastGraceMinuteAt) {
  const realMs = toMs(lastActivityAt);
  const graceMs = toMs(lastGraceMinuteAt);
  const best = Math.max(realMs, graceMs ? graceMs + GRACE_EXTENSION_MS : 0);
  return best ? new Date(best).toISOString() : null;
}

export function deriveVisualStatus(lastActivityAt, lastGraceMinuteAt, now) {
  return deriveStatus(visualActivityReference(lastActivityAt, lastGraceMinuteAt), now);
}

// ---------------------------------------------------------------------------
// Presença pertence SÓ ao usuário REAL da sessão (regra do dono, 2026-10-04).
// Durante "Alterar conta" (auth.accountSwitchMode) o perfil efetivo
// (auth.profile) é o do corretor EMULADO; ele não pode receber presença, tempo
// online/pontos nem ficar elegível na roleta por causa do navegador do admin.
// Nesse modo o sinal é carimbado no admin REAL (auth.realProfile) — quem de
// fato está na frente da tela. Ações operacionais (tentativa, atendimento)
// continuam atribuídas ao emulado por outros caminhos; isto vale só para o
// carimbo de presença. Devolve "" quando não há perfil real com id.
export function resolvePresenceProfileId(auth) {
  if (!auth?.ok) return "";
  const profile = auth.accountSwitchMode ? auth.realProfile : auth.profile;
  return profile?.id || "";
}

// Grava presença (admin_presence + marca do minuto em admin_presence_activity)
// com um cliente Supabase injetado — separado de lib/admin-presence.js (que é
// "server-only") para ser testável sem banco. `warn` recebe falhas do
// histórico (best-effort: a presença em si nunca depende da tabela de minutos).
export async function writePresenceSignal(client, userId, { grace = false, nowMs = Date.now(), warn = () => {} } = {}) {
  const now = new Date(nowMs).toISOString();

  const { error } = await client
    .from("admin_presence")
    .upsert({ user_id: userId, last_activity_at: now, updated_at: now }, { onConflict: "user_id" });
  if (error) throw error;

  try {
    const minuteAt = new Date(Math.floor(nowMs / 60000) * 60000).toISOString();
    const { error: activityError } = await client
      .from("admin_presence_activity")
      .upsert(
        { user_id: userId, minute_at: minuteAt, kind: grace ? "grace" : "interaction" },
        grace ? { onConflict: "user_id,minute_at" } : { onConflict: "user_id,minute_at", ignoreDuplicates: true }
      );
    if (activityError) warn("Histórico de presença indisponível:", activityError.message);
  } catch (activityError) {
    warn("Histórico de presença indisponível:", activityError?.message || activityError);
  }
}

// Texto relativo da última atividade ("Última atividade há 5 min / 1h / 1 dia").
// Sempre PISO (nunca arredonda para cima): 90 min = "há 1h"; 36 h = "há 1 dia".
export function formatRelativeActivityText(status, lastActivityAt, now = Date.now()) {
  if (!lastActivityAt) return "Sem atividade registrada";
  if (status === PRESENCE_STATUS.ONLINE) return "Ativo agora";

  const elapsedMs = now - new Date(lastActivityAt).getTime();
  const minutes = Math.max(1, Math.floor(elapsedMs / 60000));
  if (minutes < 60) return `Última atividade há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Última atividade há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Última atividade há ${days} dia${days > 1 ? "s" : ""}`;
}
