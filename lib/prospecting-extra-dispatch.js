import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getTodayInSaoPaulo } from "./daily-report";
import { getDailyGoalCompletionStatus, getDailyGoalWalletStatus } from "./daily-goal-wallet";
import { getDailyGoalAutoMessages } from "./daily-goal";
import { getIndividualSessionStatusForUser } from "./whatsapp-individual";
import { nextSequentialVariantIndex, renderAutoMessage } from "./daily-goal-auto-core.mjs";
import { attachClaimedContactToClient } from "./prospecting";
import {
  EXTRA_DISPATCH_COOLDOWN_MINUTES,
  EXTRA_DISPATCH_LIMIT,
  extraDispatchAvailability,
  extraDispatchErrorMessage
} from "./prospecting-extra-core.mjs";

// Prospecção extra pelo botão "Disparar" (pedido do dono, 2026-10-02). O
// clique NÃO envia nem abre o WhatsApp: reserva o contato e põe a 1ª
// mensagem na fila do corretor (daily_goal_auto_queue, source = 'extra'),
// enviada pelo MESMO motor da automação da Meta Diária (lib/daily-goal-auto.js),
// pelo WhatsApp conectado deste corretor, com os mesmos 4 modelos da 1ª
// tentativa e a cadência dele. Regras puras em prospecting-extra-core.mjs;
// limite de 10, cooldown e reserva atômicos no banco
// (enqueue_extra_prospecting_dispatch, migration 20261002240000).

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function requireBrokerId(auth) {
  const id = auth?.profile?.id;
  if (!auth?.ok || !id) throw new Error("Usuário sem perfil ativo.");
  return id;
}

function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "";
}

class ExtraDispatchError extends Error {
  constructor(message, status = 409, availability = null) {
    super(message);
    this.status = status;
    this.availability = availability;
  }
}

async function loadAvailability(brokerId) {
  const [completion, settingsResult, sessionStatus, stateResult] = await Promise.all([
    getDailyGoalCompletionStatus(brokerId),
    db().from("daily_goal_auto_settings").select("enabled, paused").eq("broker_id", brokerId).maybeSingle(),
    getIndividualSessionStatusForUser(brokerId),
    db().rpc("get_extra_prospecting_dispatch_state", { p_broker_id: brokerId, p_limit: EXTRA_DISPATCH_LIMIT, p_cooldown_minutes: EXTRA_DISPATCH_COOLDOWN_MINUTES })
  ]);
  if (settingsResult.error) throw settingsResult.error;
  if (stateResult.error) throw stateResult.error;
  const state = stateResult.data || {};
  return extraDispatchAvailability({
    metaUnlocked: Boolean(completion?.unlocked),
    automationActive: Boolean(settingsResult.data?.enabled && !settingsResult.data?.paused),
    sessionConnected: sessionStatus === "connected",
    cycleCount: state.cycle_count,
    openCount: state.open_count,
    cooldownUntil: state.cooldown_until
  });
}

// Estado do botão/cadeado da Prospecção (sempre do servidor; refresh, logout
// ou outro aparelho mostram o mesmo).
export async function getExtraDispatchStatus(auth) {
  return loadAvailability(requireBrokerId(auth));
}

export async function enqueueExtraProspectingDispatch(contactId, auth) {
  const brokerId = requireBrokerId(auth);
  // Meta 100%, automação ativa e WhatsApp conectado: checados aqui, no
  // servidor. Limite de 10 e cooldown são rechecados dentro da transação.
  const availability = await loadAvailability(brokerId);
  if (!availability.available) throw new ExtraDispatchError(availability.message, 409, availability);

  const [{ data: contact, error: contactError }, { data: broker, error: brokerError }, { data: settingsRow }] = await Promise.all([
    db().from("prospecting_contacts").select("id, name").eq("id", contactId).maybeSingle(),
    db().from("admin_users").select("name, gender").eq("id", brokerId).maybeSingle(),
    db().from("daily_goal_auto_settings").select("variant_cursor_attempt1").eq("broker_id", brokerId).maybeSingle()
  ]);
  if (contactError) throw contactError;
  if (brokerError) throw brokerError;
  if (!contact) throw new ExtraDispatchError("Contato não encontrado.", 404);

  // Os mesmos 4 modelos da 1ª tentativa da automação, na mesma rotação
  // sequencial (1A→1B→1C→1D) do corretor.
  const autoMessages = await getDailyGoalAutoMessages();
  const variants = autoMessages.message1 || [];
  const { index, nextCursor } = nextSequentialVariantIndex(settingsRow?.variant_cursor_attempt1 || 0, variants.length);
  const messageText = index >= 0 ? renderAutoMessage(variants[index], { primeiroNome: firstName(contact.name), nomeCorretor: firstName(broker?.name), corretorGender: broker?.gender || "" }) : "";

  const { data: result, error } = await db().rpc("enqueue_extra_prospecting_dispatch", {
    p_contact_id: contactId,
    p_broker_id: brokerId,
    p_today: getTodayInSaoPaulo(),
    p_limit: EXTRA_DISPATCH_LIMIT,
    p_cooldown_minutes: EXTRA_DISPATCH_COOLDOWN_MINUTES,
    p_message_text: messageText,
    p_variant_index: index >= 0 ? index : null
  });
  if (error) {
    const raw = String(error.message || "");
    if (raw.includes("WALLET_LIMIT_REACHED")) {
      const wallet = await getDailyGoalWalletStatus(brokerId).catch(() => null);
      const limitText = wallet?.limit ? `${wallet.current}/${wallet.limit}` : "o limite configurado";
      throw new ExtraDispatchError(`Sua carteira ativa está cheia (${limitText}). Conclua ou encerre atendimentos pendentes antes de puxar novos contatos da base.`);
    }
    const friendly = extraDispatchErrorMessage(raw);
    if (friendly) throw new ExtraDispatchError(friendly, 409, await loadAvailability(brokerId).catch(() => null));
    throw error;
  }

  if (result?.already) {
    return { queued: true, already: true, status: await loadAvailability(brokerId) };
  }

  try {
    const now = new Date().toISOString();
    const registration = await attachClaimedContactToClient(result.contact, brokerId, auth, now);
    // "claimed" com source 'extra_dispatch' é só a RESERVA: a atividade (Meta
    // e Ranking) conta quando a mensagem sai de verdade (daily_goal_attempts).
    const { error: historyError } = await db().from("prospecting_history").insert({
      contact_id: result.contact.id,
      registration_id: registration.id,
      user_id: brokerId,
      event_type: "claimed",
      details: { source: "extra_dispatch", queueId: result.queue_id }
    });
    if (historyError) throw historyError;
  } catch (prepareError) {
    await db().rpc("revert_extra_prospecting_dispatch", { p_queue_id: result.queue_id });
    throw prepareError;
  }

  if (settingsRow && index >= 0) {
    await db().from("daily_goal_auto_settings").update({ variant_cursor_attempt1: nextCursor }).eq("broker_id", brokerId);
  }

  return { queued: true, already: false, status: await loadAvailability(brokerId) };
}
