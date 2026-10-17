import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { loadVisualPresence } from "./admin-presence";
import { isRouletteEligibleClient, ROULETTE_INELIGIBLE_STATUSES } from "./client-distribution-core.mjs";
import { isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { pendingRouletteRowsToDeliver, waitingQueueBatchSize } from "./pending-roulette-core.mjs";

export async function listLeadDistributionDashboard() {
  const supabase = getSupabaseAdminClient();
  const [{ data: users, error: usersError }, { data: registrations, error: registrationsError }, { data: state, error: stateError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from("admin_users").select("id, name, email, role, status, lead_distribution_enabled, lead_distribution_position").in("role", ["admin", "manager", "broker", "associate"]),
    supabase.from("simulation_registrations").select("responsible_user_id").not("responsible_user_id", "is", null),
    supabase.from("lead_distribution_state").select("last_broker_id, updated_at").eq("id", "default").maybeSingle(),
    supabase.from("lead_distribution_history").select("id, registration_id, client_name, event_type, created_at, details, from_user:admin_users!from_user_id(name), to_user:admin_users!to_user_id(name)").order("created_at", { ascending: false }).limit(100)
  ]);
  // Status VISUAL (mesma aparência do painel Online) — a escolha real da
  // roleta é feita no SQL, só pela atividade real (ROL-2b).
  let presenceByUser = new Map();
  try {
    const visual = await loadVisualPresence((users || []).map((user) => user.id));
    presenceByUser = new Map([...visual].map(([id, presence]) => [id, presence.status]));
  } catch (presenceError) {
    console.warn("Falha ao carregar presença da roleta:", presenceError?.message || presenceError);
  }
  if (usersError) throw usersError;
  if (registrationsError) throw registrationsError;
  if (stateError) throw stateError;
  if (historyError) throw historyError;

  const registrationIds = [...new Set((history || []).map(item => item.registration_id).filter(Boolean))];
  const originResult = registrationIds.length ? await supabase.from("client_origins").select("client_id,source_label").in("client_id", registrationIds) : { data: [], error: null };
  if (originResult.error) throw originResult.error;
  const originByClient = new Map((originResult.data || []).map(item => [item.client_id, item.source_label]));

  const counts = (registrations || []).reduce((result, item) => {
    result[item.responsible_user_id] = (result[item.responsible_user_id] || 0) + 1;
    return result;
  }, {});
  const brokers = (users || []).map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    enabled: user.lead_distribution_enabled === true,
    position: Number(user.lead_distribution_position) || 999999,
    clientCount: counts[user.id] || 0,
    presence: presenceByUser.get(user.id) || "offline"
  })).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"));

  return {
    brokers,
    history: (history || []).map((item) => ({
      id: item.id,
      registrationId: item.registration_id,
      clientName: item.client_name,
      sourceLabel: originByClient.get(item.registration_id) || "Origem não identificada",
      eventType: item.event_type,
      createdAt: item.created_at,
      presenceTier: item.details?.presenceTier || "",
      skipped: Array.isArray(item.details?.skipped) ? item.details.skipped : [],
      fromUserName: item.from_user?.name || "",
      toUserName: item.to_user?.name || "Sem responsável"
    })),
    lastBrokerId: state?.last_broker_id || "",
    lastAssignedAt: state?.updated_at || ""
  };
}

// Escolhe o próximo corretor da roleta levando a PRESENÇA em conta (online
// primeiro, quem está offline é pulado sem perder o lugar) — regra em
// supabase/migrations/20260924100000_round_robin_presence_aware.sql. Devolve
// também a camada usada e quem foi pulado (nomes) para o histórico da roleta.
// Se a regra por presença falhar (ex.: migration ainda não aplicada), cai na
// função antiga (sem presença) em vez de derrubar o cadastro do lead.
export async function assignRoundRobinLead({ excludedBrokerId = null } = {}) {
  const supabase = getSupabaseAdminClient();
  const args = excludedBrokerId ? { excluded_broker_id: excludedBrokerId } : {};

  const { data, error } = await supabase.rpc("pick_round_robin_broker", args);
  if (error) {
    // Qualquer falha da regra por presença cai na função antiga (sem presença):
    // captar o lead nunca pode depender desta lógica nova.
    console.warn("Roleta por presença indisponível, usando a fila simples:", error.message || error);
    const legacy = await supabase.rpc("assign_round_robin_lead", args);
    if (legacy.error) throw legacy.error;
    return { brokerId: legacy.data || null, tier: "", skippedNames: [] };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const skippedIds = row?.skipped_ids || [];
  let skippedNames = [];
  if (skippedIds.length) {
    const { data: users } = await supabase.from("admin_users").select("id, name").in("id", skippedIds);
    const nameById = new Map((users || []).map((user) => [user.id, user.name]));
    skippedNames = skippedIds.map((id) => nameById.get(id)).filter(Boolean);
  }
  return { brokerId: row?.picked_broker_id || null, tier: row?.picked_tier || "", skippedNames };
}

// Fila "aguardando distribuição": cadastros que a roleta criou sem corretor
// porque ninguém estava on-line (pending_distribution_at marcado na criação,
// tanto pelo formulário público quanto pelo Chat). Chamado a cada rodada do
// cron scheduled-activities (a cada 2 min) — o mais antigo da fila sai primeiro,
// mas no máximo 1 cliente por corretor on-line por rodada (regra do dono
// 2026-10-08: quem entra primeiro não leva a fila toda; os outros têm 2 min
// para ficar on-line). A ordem de QUEM recebe entre vários on-line é a fila
// normal da roleta (pick_round_robin_broker).
export async function reassignPendingRouletteLeads({ limit = 25 } = {}) {
  const supabase = getSupabaseAdminClient();
  // Clientes da fila de reativação do FUN-15l têm entrega própria (lib/cooled-clients-reactivation.js): não ocupam o lote
  // nem são entregues por aqui.
  const reactivationIds = await listCooledReactivationQueuedClientIds();
  let candidatesQuery = supabase
    .from("simulation_registrations")
    .select("id, full_name, phone_normalized, status, distribution_type, direct_broker_link, prospecting_contact_id, responsible_user_id")
    .not("pending_distribution_at", "is", null)
    .not("status", "in", `(${ROULETTE_INELIGIBLE_STATUSES.join(",")})`); // inelegível não ocupa vaga do lote
  if (reactivationIds.length) candidatesQuery = candidatesQuery.not("id", "in", `(${reactivationIds.join(",")})`);
  const { data: candidates, error } = await candidatesQuery
    .order("pending_distribution_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  if (!candidates?.length) return { assigned: 0 };

  // Quem já tem um corretor escolhido (transferência manual) sai da fila de espera: só o cliente SEM responsável
  // ou segurado pelo dono (último caso, regra FUN-11) é entregue pela roleta.
  const ownerId = (await listAdminProfiles()).find((profile) => isOwnerAdminEmail(profile.email))?.id || "";
  const { deliver, release } = pendingRouletteRowsToDeliver(candidates, ownerId);
  if (release.length) {
    const { error: releaseError } = await supabase.from("simulation_registrations").update({ pending_distribution_at: null }).in("id", release.map((client) => client.id));
    if (releaseError) console.warn("Falha ao tirar da fila de espera quem já tem corretor:", releaseError.message || releaseError);
  }
  if (!deliver.length) return { assigned: 0 };

  // Elegibilidade (decisão do dono, 2026-10-03): quem não pode receber contato/distribuição NUNCA entra na
  // roleta — Não contactar, arquivado, status negativos, link pessoal/canal direto e contato em bloqueio de
  // 30 dias (available_after). Fica fora da fila de entrega (sem responsável), nunca atribuído.
  const contactIds = [...new Set(deliver.map((client) => client.prospecting_contact_id).filter(Boolean))];
  const availableAfterByContact = new Map();
  if (contactIds.length) {
    const { data: contacts, error: contactsError } = await supabase.from("prospecting_contacts").select("id, available_after").in("id", contactIds);
    if (contactsError) throw contactsError;
    for (const contact of contacts || []) availableAfterByContact.set(contact.id, contact.available_after);
  }
  const pending = deliver.filter((client) => isRouletteEligibleClient({ ...client, available_after: availableAfterByContact.get(client.prospecting_contact_id) || null }));
  if (!pending.length) return { assigned: 0 };

  // No máximo 1 cliente da fila por corretor on-line nesta rodada (regra do dono 2026-10-08, cron a cada 2 min).
  const onlineBrokers = await countOnlineRouletteBrokers();
  const maxDeliveries = waitingQueueBatchSize(pending.length, onlineBrokers);
  if (!maxDeliveries) return { assigned: 0 };
  const servedThisRound = new Set();

  // Quem perdeu o cliente pelo prazo de atendimento (foi para a espera porque ninguém mais estava on-line) não o
  // recebe de volta: a fila entrega a OUTRO corretor (regra do dono 2026-10-08).
  const lostBy = await listWaitingQueueLosers(pending.map((client) => client.id));

  let assigned = 0;
  for (const registration of pending) {
    if (servedThisRound.size >= maxDeliveries) break;
    const excludedBrokerId = lostBy.get(registration.id) || null;
    const roulette = await assignRoundRobinLead({ excludedBrokerId });
    if (!roulette.brokerId) {
      if (excludedBrokerId) continue; // só quem o perdeu está on-line: espera o próximo corretor
      break;
    }
    if (servedThisRound.has(roulette.brokerId)) continue;
    servedThisRound.add(roulette.brokerId);

    // responsible_changed_at = agora: o prazo de 5 min da REDISTRIBUIÇÃO DE LEADS conta da ENTREGA, não da criação
    // (antes, cliente entregue pela fila nunca era redistribuído, ou era tirado do corretor em menos de 5 min).
    const { error: updateError } = await supabase
      .from("simulation_registrations")
      .update({
        responsible_user_id: roulette.brokerId,
        pending_distribution_at: null,
        responsible_changed_at: new Date().toISOString(),
        ...(registration.responsible_user_id ? { previous_responsible_user_id: registration.responsible_user_id } : {})
      })
      .eq("id", registration.id)
      .not("pending_distribution_at", "is", null);
    if (updateError) {
      console.warn("Falha ao atribuir cliente da fila de espera da roleta:", updateError.message || updateError);
      continue;
    }

    try {
      await recordLeadDistributionHistory({
        registration: { id: registration.id, fullName: registration.full_name },
        eventType: "assigned",
        toUserId: roulette.brokerId,
        details: { presenceTier: roulette.tier, skipped: roulette.skippedNames, fromWaitingQueue: true }
      });
    } catch (historyError) {
      console.warn("Falha ao registrar histórico da fila de espera da roleta:", historyError?.message || historyError);
    }

    try {
      const { logClientJourneyEvent } = await import("./client-journey");
      await logClientJourneyEvent({
        clientId: registration.id,
        eventType: "responsible_assigned",
        actor: { email: "sistema", name: "Sistema", role: "automacao" },
        details: { source: "roleta_fila_espera", brokerId: roulette.brokerId }
      });
    } catch (journeyError) {
      console.warn("Falha ao registrar evento de jornada da fila de espera da roleta:", journeyError?.message || journeyError);
    }

    try {
      await supabase.from("crm_notifications").insert({
        recipient_user_id: roulette.brokerId,
        client_id: registration.id,
        title: "Novo lead para você",
        description: `${registration.full_name || "Um cliente"} estava aguardando um corretor on-line e foi enviado(a) para você pela roleta.`,
        notification_type: "new_client",
        scheduled_at: new Date().toISOString()
      });
    } catch (notifyError) {
      console.warn("Falha ao avisar o corretor da fila de espera da roleta:", notifyError?.message || notifyError);
    }

    assigned += 1;
  }
  return { assigned };
}

// Clientes na fila de reativação do FUN-15l (cooled_client_cases.reactivation_status = 'queued'). Migration
// 20261017120000 ainda não aplicada (coluna inexistente): fila vazia — a fila de espera comum segue como antes.
export async function listCooledReactivationQueuedClientIds() {
  const { data, error } = await getSupabaseAdminClient()
    .from("cooled_client_cases")
    .select("client_id")
    .eq("reactivation_status", "queued")
    .limit(2000);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
  return [...new Set((data || []).map((row) => row.client_id).filter(Boolean))];
}

// Coluna/tabela que ainda não existe no banco (migration não aplicada).
export function isMissingSchemaError(error) {
  return /42703|42P01|PGRST204|PGRST205/.test(`${error?.code || ""} ${error?.message || ""}`) || /column .* does not exist/i.test(String(error?.message || ""));
}

// Regra do dono (2026-10-08): o corretor que recebeu pela roleta e não atendeu no prazo (REDISTRIBUIÇÃO DE LEADS),
// sem outro corretor on-line para receber, perde o cliente — ele vai para o dono na fila de espera e a fila o
// entrega ao PRÓXIMO corretor que ficar on-line (nunca de volta a quem o perdeu).
export async function moveClientToRouletteWaitingQueue(client, { rule = null } = {}) {
  const supabase = getSupabaseAdminClient();
  const ownerId = (await listAdminProfiles()).find((profile) => isOwnerAdminEmail(profile.email) && profile.status === "active")?.id || "";
  const fromUserId = client.responsible_user_id || null;
  if (!ownerId || !fromUserId || fromUserId === ownerId) return { moved: false };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .update({ responsible_user_id: ownerId, previous_responsible_user_id: fromUserId, responsible_changed_at: now, pending_distribution_at: now })
    .eq("id", client.id)
    .eq("responsible_user_id", fromUserId)
    .select("id");
  if (error) throw error;
  if (!data?.length) return { moved: false };

  try {
    await recordLeadDistributionHistory({
      registration: { id: client.id, fullName: client.full_name },
      eventType: "auto_transferred",
      fromUserId,
      toUserId: ownerId,
      details: { toWaitingQueue: true, ruleId: rule?.id || "", ruleName: rule?.name || "", reason: "Prazo de atendimento excedido e nenhum outro corretor on-line: aguardando o próximo corretor" }
    });
  } catch (historyError) {
    console.warn("Falha ao registrar ida para a fila de espera da roleta:", historyError?.message || historyError);
  }
  return { moved: true, ownerId };
}

// Último corretor que perdeu cada cliente para a fila de espera (lead_distribution_history, details.toWaitingQueue).
async function listWaitingQueueLosers(ids) {
  const result = new Map();
  if (!ids.length) return result;
  const { data, error } = await getSupabaseAdminClient()
    .from("lead_distribution_history")
    .select("registration_id, from_user_id, created_at")
    .in("registration_id", ids)
    .eq("event_type", "auto_transferred")
    .eq("details->>toWaitingQueue", "true")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("Falha ao ler quem perdeu o cliente para a fila de espera:", error.message || error);
    return result;
  }
  for (const row of data || []) {
    if (!result.has(row.registration_id) && row.from_user_id) result.set(row.registration_id, row.from_user_id);
  }
  return result;
}

async function countOnlineRouletteBrokers() {
  return (await listOnlineRouletteBrokerIds()).length;
}

// Mesmo critério de "on-line" de pick_round_robin_broker: ativo, na roleta e com atividade nos últimos 5 minutos, com
// número do WhatsApp ativo (ROL-2d/2e) e presença na imobiliária (ROL-2f). Também usada pela fila de reativação do
// FUN-15l (lib/cooled-clients-reactivation.js) — não reimplemente esse critério em outro lugar.
export async function listOnlineRouletteBrokerIds() {
  const supabase = getSupabaseAdminClient();
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: presence, error } = await supabase.from("admin_presence").select("user_id").gte("last_activity_at", since);
  if (error) throw error;
  const ids = [...new Set((presence || []).map((row) => row.user_id).filter(Boolean))];
  if (!ids.length) return [];
  const { data: users, error: usersError } = await supabase
    .from("admin_users")
    .select("id")
    .in("id", ids)
    .eq("status", "active")
    .eq("lead_distribution_enabled", true)
    .in("role", ["admin", "manager", "broker", "associate"]);
  if (usersError) throw usersError;
  // ROL-2d/ROL-2e (dono, 2026-10-13): só conta quem tem ao menos 1 número do WhatsApp conectado e ativo — mesma regra do
  // pick_round_robin_broker (whatsapp_user_has_active_number).
  const userIds = (users || []).map((user) => user.id);
  if (!userIds.length) return [];
  // ROL-2e (2026-10-13): número conectado mas ocioso (4 h sem mensagem entre 8h e 21h) não conta.
  const { data: numbers, error: numbersError } = await supabase.rpc("whatsapp_number_activity", { p_user_ids: userIds });
  if (numbersError) throw numbersError;
  const withNumber = [...new Set((numbers || []).filter((row) => row.active).map((row) => row.user_id))];
  if (!withNumber.length) return [];
  // ROL-2f (2026-10-13): só conta quem veio à imobiliária (sempre todos com a regra desligada).
  const { data: present, error: presentError } = await supabase.rpc("office_presence_eligible_ids", { p_user_ids: withNumber });
  if (presentError) throw presentError;
  return [...new Set((present || []).map((row) => (typeof row === "string" ? row : row?.office_presence_eligible_ids || row?.id || "")).filter(Boolean))];
}

export async function recordLeadDistributionHistory({ registration, eventType, fromUserId = null, toUserId = null, details = {} }) {
  const { error } = await getSupabaseAdminClient().from("lead_distribution_history").insert({
    registration_id: registration.id,
    client_name: registration.fullName || registration.full_name || "Cliente",
    event_type: eventType,
    from_user_id: fromUserId,
    to_user_id: toUserId,
    details
  });
  if (error) throw error;
}

export async function reorderLeadDistribution(order = []) {
  const ids = [...new Set(order.filter((id) => typeof id === "string" && id))];
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("admin_users").select("id").in("id", ids).in("role", ["admin", "manager", "broker", "associate"]);
  if (error) throw error;
  if ((data || []).length !== ids.length) throw new Error("A fila contém um corretor inválido.");
  const updates = await Promise.all(ids.map((id, index) => supabase.from("admin_users").update({ lead_distribution_position: index + 1 }).eq("id", id)));
  const updateError = updates.find((result) => result.error)?.error;
  if (updateError) throw updateError;
  const { error: stateError } = await supabase.from("lead_distribution_state").upsert({ id: "default", last_broker_id: ids.at(-1) || null, updated_at: new Date().toISOString() });
  if (stateError) throw stateError;
  return ids;
}

// "Devolver para a roleta" (pedido do dono, 2026-10-09): admin/gestor tira o cliente do corretor atual e a roleta
// escolhe o próximo corretor ON-LINE (nunca quem o perdeu). Ninguém on-line: fica com o dono na fila de espera e a fila
// o entrega ao próximo que entrar (ROL-2b). Linha do tempo: responsible_transferred com transferType "roulette" — NÃO é
// transferência manual, então a redistribuição automática volta a valer para o cliente.
// `cooledReactivation` (FUN-15l, dono 2026-10-17): transferência do fluxo de clientes que esfriaram NÃO entrega direto —
// o cliente vai para o FIM da fila de reativação (com o dono, FUN-11) e lib/cooled-clients-reactivation.js entrega.
export async function returnClientToRoulette(clientId, auth, { cooledReactivation = null } = {}) {
  const { assertCanAccessResponsibleUser, assertGeneralAdminOrManager } = await import("./admin-access");
  assertGeneralAdminOrManager(auth);
  const client = await loadClientForRouletteReturn(clientId);
  if (client.responsible_user_id) assertCanAccessResponsibleUser(auth, client.responsible_user_id);
  if (cooledReactivation) {
    return moveClientToRoulette(client, auth, {
      queueOnly: true,
      waitingReason: "Cliente que esfriou transferido pela gestão: fila de reativação, aguardando um corretor on-line",
      extraDetails: { cooledReactivation: "queued", caseId: cooledReactivation.caseId || null }
    });
  }
  return moveClientToRoulette(client, auth, { reason: "Devolvido à roleta pela gestão", waitingReason: "Devolvido à roleta: nenhum corretor on-line, aguardando o próximo" });
}

// FUN-15 (REGRA OFICIAL — dono, 2026-10-16): "quando essa opção ['Cliente não respondeu mais'] for selecionada como
// motivo, o cliente vai para a roleta direto, sem passar por aprovação". Mesmo efeito do "Transferir" da decisora
// (moveClientToRoulette), mas disparado pelo motivo do PRÓPRIO responsável: em vez do guard de gestão, a barreira é o
// caso — quem chama (answerCooledCase, lib/cooled-clients.js) já validou que o caso é deste corretor, e aqui só passa se
// o cliente ainda está com ele (`expectedResponsibleId`, conferido de novo no UPDATE). Não use para outro fluxo.
export async function returnClientToRouletteByCooledNoResponse(clientId, auth, { expectedResponsibleId, caseId, cooledReactivation = false } = {}) {
  if (!expectedResponsibleId) throw new Error("Responsável do caso não informado.");
  const client = await loadClientForRouletteReturn(clientId);
  if (client.responsible_user_id !== expectedResponsibleId) throw new Error("O responsável deste cliente mudou. Atualize a tela.");
  return moveClientToRoulette(client, auth, {
    // FUN-15l (dono, 2026-10-17): com a fila de reativação, vai para o FIM da fila em vez de ser entregue direto.
    queueOnly: Boolean(cooledReactivation),
    reason: "Transferido automaticamente: o corretor informou que o cliente não respondeu mais",
    waitingReason: cooledReactivation
      ? "Transferido automaticamente (cliente não respondeu mais): fila de reativação, aguardando um corretor on-line"
      : "Transferido automaticamente (cliente não respondeu mais): nenhum corretor on-line, aguardando o próximo",
    extraDetails: { automatic: true, trigger: "cooled_no_response", caseId: caseId || null, ...(cooledReactivation ? { cooledReactivation: "queued" } : {}) }
  });
}

// FUN-15l (dono, 2026-10-17): rotina da fila de reativação (sem usuário) põe o cliente no FIM da fila — backfill dos
// transferidos sem contato e devolução de quem não mandou mensagem em 3 min. Só passa se o cliente ainda está com
// `expectedResponsibleId` (conferido de novo no UPDATE). Não use para outro fluxo.
export async function queueCooledClientForReactivation(clientId, { expectedResponsibleId = null, caseId = null, trigger = "", reason = "" } = {}) {
  const client = await loadClientForRouletteReturn(clientId);
  if ((client.responsible_user_id || null) !== (expectedResponsibleId || null)) throw new Error("O responsável deste cliente mudou.");
  return moveClientToRoulette(client, null, {
    queueOnly: true,
    waitingReason: reason || "Fila de reativação: aguardando um corretor on-line",
    extraDetails: { automatic: true, cooledReactivation: "queued", trigger, caseId }
  });
}

async function loadClientForRouletteReturn(clientId) {
  const { data: client, error } = await getSupabaseAdminClient()
    .from("simulation_registrations")
    .select("id, full_name, status, responsible_user_id, direct_broker_link, distribution_type")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!client) throw new Error("Cliente não encontrado.");
  if (ROULETTE_INELIGIBLE_STATUSES.includes(client.status)) throw new Error("Este cliente não pode voltar para a roleta (arquivado, Não contactar ou etapa encerrada).");
  return client;
}

// `queueOnly`: não sorteia ninguém agora — o cliente vai direto para a fila de espera com o dono (fila de reativação do
// FUN-15l; não mexe na posição de ninguém na roleta).
async function moveClientToRoulette(client, auth, { reason = "", waitingReason, extraDetails = null, queueOnly = false }) {
  const supabase = getSupabaseAdminClient();

  const fromUserId = client.responsible_user_id || null;
  const now = new Date().toISOString();
  const roulette = queueOnly ? { brokerId: null, tier: "", skippedNames: [] } : await assignRoundRobinLead({ excludedBrokerId: fromUserId });
  const ownerId = roulette.brokerId ? "" : (await listAdminProfiles()).find((profile) => isOwnerAdminEmail(profile.email) && profile.status === "active")?.id || "";
  if (queueOnly && !ownerId) throw new Error("Administrador principal não encontrado para segurar a fila de reativação.");
  const toUserId = roulette.brokerId || ownerId || fromUserId;
  const waiting = !roulette.brokerId;

  // Só vale se o responsável ainda é o que foi lido: dois cliques ao mesmo tempo (ou uma transferência manual no meio) não
  // redistribuem o cliente duas vezes nem sobrescrevem a decisão manual.
  let returnUpdate = supabase
    .from("simulation_registrations")
    .update({
      responsible_user_id: toUserId,
      previous_responsible_user_id: fromUserId,
      responsible_changed_at: now,
      pending_distribution_at: waiting ? now : null,
      distribution_type: "round_robin",
      direct_broker_link: false
    })
    .eq("id", client.id);
  returnUpdate = fromUserId ? returnUpdate.eq("responsible_user_id", fromUserId) : returnUpdate.is("responsible_user_id", null);
  const { data: returnedRows, error: updateError } = await returnUpdate.select("id");
  if (updateError) throw updateError;
  if (!returnedRows?.length) throw new Error("O responsável deste cliente mudou enquanto a roleta rodava. Atualize a tela e confira antes de tentar de novo.");

  const { logClientJourneyEvent, resolveActorSnapshot } = await import("./client-journey");
  const names = new Map(((await supabase.from("admin_users").select("id, name").in("id", [fromUserId, toUserId].filter(Boolean))).data || []).map((row) => [row.id, row.name]));
  await Promise.allSettled([
    recordLeadDistributionHistory({
      registration: { id: client.id, fullName: client.full_name },
      eventType: "auto_transferred",
      fromUserId,
      toUserId,
      details: { manualReturnToRoulette: true, toWaitingQueue: waiting, presenceTier: roulette.tier, skipped: roulette.skippedNames, reason: waiting ? waitingReason : reason, ...(extraDetails || {}) }
    }),
    logClientJourneyEvent({
      clientId: client.id,
      eventType: "responsible_transferred",
      actor: resolveActorSnapshot(auth),
      details: { fromId: fromUserId, fromName: names.get(fromUserId) || "", toId: toUserId, toName: names.get(toUserId) || "", transferType: "roulette", waitingQueue: waiting, ...(extraDetails || {}) }
    }),
    roulette.brokerId
      ? supabase.from("crm_notifications").insert({
        recipient_user_id: roulette.brokerId,
        client_id: client.id,
        title: "Novo lead para você",
        description: `${client.full_name || "Um cliente"} foi devolvido(a) à roleta e enviado(a) para você.`,
        notification_type: "new_client",
        scheduled_at: now
      })
      : Promise.resolve()
  ]);
  return { toUserId, toName: names.get(toUserId) || "", waiting };
}
