import "server-only";
import { clientDoNotContactPatch, contactDoNotContactPatch } from "./do-not-contact-core.mjs";
import { returnedToQueueClientPatch } from "./client-distribution-core.mjs";
import { assertGeneralAdminOrManager, assertOwnerAdmin } from "./admin-access";
import { getActingAdminEmail } from "./admin-auth";
import { isGeneralAdminAuth, isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { CLIENT_STATUS } from "./client-status";
import { toBrazilianE164 } from "./phone-utils";
import { ensureManualSimulationRegistration, getSimulationRegistration } from "./simulation-registrations";
import { getSupabaseAdminClient } from "./supabase";
import { autoReturnStaleProspectingContacts, hibernateEndedDailyGoalRounds } from "./prospecting-auto-return";
import { getTodayInSaoPaulo, getTimeGreeting } from "./daily-report";
import { getDailyGoalCompletionStatus, getDailyGoalWalletStatus, recordDoNotContactAudit } from "./daily-goal-wallet";
import { moveNamelessToEnd } from "./prospecting-queue-order.mjs";
import { clientMatchesContactPhone } from "./contact-client-link.mjs";
import { assertProspectingStatusChangeAllowed } from "./prospecting-status-lock";
import { assertCanReceiveProspecting, assertProspectingAccess, assertProspectingParticipation } from "./prospecting-eligibility";
import { assertContactsNotReserved, listManualReservedContactIds } from "./prospecting-manual-lists";
import { withoutReservedContacts } from "./prospecting-manual-list-core.mjs";
import { releaseActiveRoundsForContacts } from "./daily-goal-round-release.mjs";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// scope diferencia ORIGEM/PROPRIEDADE da base (quem a abasteceu), nunca quem
// está atendendo um contato (isso continua em assigned_user_id/last_broker_id,
// intocados). "company" = Base da Imobiliária (owner_user_id nulo, é a
// prospecção compartilhada que já existia); "mine" = Minha Base do corretor
// logado (owner_user_id = auth.profile.id).
export async function listProspectingContacts(auth, scope = "company") {
  if (!auth?.ok) throw new Error("Acesso negado.");
  // Prospecção SÓ com WhatsApp conectado (2026-10-02): corretor sem sessão conectada não acessa.
  await assertProspectingAccess(auth);
  await autoReturnStaleProspectingContacts();
  await hibernateEndedDailyGoalRounds();
  const now = new Date().toISOString();
  const [data, blocked, manualReserved] = await Promise.all([
    fetchAllRows(() => {
      let query = db().from("prospecting_contacts").select("*, assigned_user:admin_users!prospecting_contacts_assigned_user_id_fkey(name), last_broker:admin_users!prospecting_contacts_last_broker_id_fkey(name)").order("created_at", { ascending: false });
      query = scope === "mine" ? query.eq("owner_user_id", auth.profile?.id || "") : query.is("owner_user_id", null);
      // "recent_attempt" só entra na fila quando o prazo de espera (available_after,
      // 30 dias) já passou — vale para todo mundo, incluindo o administrador geral:
      // a fila mostra só o que está realmente disponível para atendimento agora.
      return query.or(`status.eq.available,and(status.eq.recent_attempt,available_after.lte.${now})`);
    }),
    listDoNotContactClientLinks(),
    // "Imprimir lista" (2026-10-04): contato reservado numa lista manual impressa não aparece na fila para
    // ninguém (nem para "Disparar"/atribuir). Tabela inexistente (migration pendente) = ninguém reservado.
    scope === "company" ? listManualReservedContactIds() : Promise.resolve(new Set())
  ]);
  // Marcar "não contactar novamente" só atualiza a LINHA de prospecting_contacts
  // que o corretor clicou, nunca as outras (mesmo cliente pode ter vários
  // telefones importados, cada um sua própria linha) — sem este filtro, o
  // cliente "voltava pra fila" porque um telefone irmão dele, nunca tocado,
  // continuava com status 'available'. Mesma trava (por registration_id OU
  // telefone) já usada nos RPCs de reivindicar contato, aplicada aqui na
  // LISTAGEM — achado real, 2026-09-30.
  const visible = withoutReservedContacts(data.filter((row) => !blocked.registrationIds.has(row.registration_id) && !blocked.phones.has(row.phone_normalized)), manualReserved);
  // Contato sem nome ("Sem nome", telefone no lugar do nome...) vai para o final da fila.
  return moveNamelessToEnd(visible.map(mapContact));
}

async function listDoNotContactClientLinks() {
  const rows = await fetchAllRows(() =>
    db().from("simulation_registrations").select("id, phone_normalized").in("status", [CLIENT_STATUS.DO_NOT_CONTACT, CLIENT_STATUS.SALE_COMPLETED])
  );
  return {
    registrationIds: new Set(rows.map((row) => row.id).filter(Boolean)),
    phones: new Set(rows.map((row) => row.phone_normalized).filter(Boolean))
  };
}

// Visão gerencial exclusiva do administrador principal: quantos contatos
// cada corretor já colocou na própria base individual.
export async function listBrokerBasesSummary(auth) {
  assertOwnerAdmin(auth);
  const profiles = await listAdminProfiles();
  const brokerProfiles = profiles.filter((profile) => profile.status !== "inactive" && !isOwnerAdminEmail(profile.email));
  // count "exact" com head:true pede ao Postgres a contagem real (sem trazer
  // linhas) — evita tanto o limite implícito de 1000 linhas do PostgREST
  // quanto o custo de transferir todos os contatos só para contá-los.
  const counts = await Promise.all(
    brokerProfiles.map((profile) => db().from("prospecting_contacts").select("id", { count: "exact", head: true }).eq("owner_user_id", profile.id))
  );

  return brokerProfiles
    .map((profile, index) => {
      const { count, error } = counts[index];
      if (error) throw error;
      return { brokerId: profile.id, name: profile.name, photoUrl: profile.photoUrl || "", contactCount: count || 0 };
    })
    .sort((a, b) => b.contactCount - a.contactCount || a.name.localeCompare(b.name, "pt-BR"));
}

// Drill-down somente leitura da base de um corretor específico, só para o
// administrador principal (visualizar, não prospectar em nome de outro).
export async function listBrokerOwnedContacts(brokerId, auth) {
  assertOwnerAdmin(auth);
  const data = await fetchAllRows(() =>
    db()
      .from("prospecting_contacts")
      .select("*, assigned_user:admin_users!prospecting_contacts_assigned_user_id_fkey(name), last_broker:admin_users!prospecting_contacts_last_broker_id_fkey(name)")
      .eq("owner_user_id", brokerId)
      .order("created_at", { ascending: false })
  );
  return moveNamelessToEnd(data.map(mapContact));
}

export async function importProspectingContacts(rows, auth, scope = "company") {
  if (scope === "mine") await assertProspectingAccess(auth);
  const ownerUserId = scope === "mine" ? requireOwnerScopeUserId(auth) : null;
  if (scope === "mine") {
    if (!auth?.ok || !ownerUserId) throw new Error("Usuário sem perfil ativo.");
  } else {
    assertGeneralAdminOrManager(auth);
  }

  const summary = { imported: 0, duplicates: 0, invalid: 0, doNotContact: 0 };
  const uniqueRows = new Map();

  for (const row of Array.isArray(rows) ? rows.slice(0, 30000) : []) {
    const suppliedName = row?.name || row?.Nome || "";
    const suppliedPhone = row?.phone || row?.whatsapp || row?.WhatsApp || row?.Telefone || "";
    const directPhone = toBrazilianE164(suppliedPhone);
    const reversedPhone = directPhone ? "" : toBrazilianE164(suppliedName);
    const name = clean(reversedPhone ? suppliedPhone : suppliedName).slice(0, 160);
    const phone = directPhone || reversedPhone;
    if (!name || !phone) { summary.invalid += 1; continue; }
    if (uniqueRows.has(phone)) { summary.duplicates += 1; continue; }
    uniqueRows.set(phone, { name, phone_normalized: phone, owner_user_id: ownerUserId });
  }

  // Duplicidade GLOBAL: verifica tanto a fila de prospecção (qualquer base,
  // company ou individual de qualquer corretor) quanto os clientes já
  // cadastrados no CRM (simulation_registrations) — nunca só dentro da base
  // que está recebendo a importação.
  const existingByPhone = new Map();
  const phonesToCheck = Array.from(uniqueRows.keys());
  await runBatches(chunks(phonesToCheck, 500), async (phones) => {
    const { data, error } = await db().from("prospecting_contacts").select("phone_normalized, status").in("phone_normalized", phones);
    if (error) throw error;
    for (const contact of data || []) existingByPhone.set(contact.phone_normalized, contact.status);
  });
  await runBatches(chunks(phonesToCheck, 500), async (phones) => {
    const { data, error } = await db().from("simulation_registrations").select("phone_normalized").in("phone_normalized", phones);
    if (error) throw error;
    for (const client of data || []) {
      if (!existingByPhone.has(client.phone_normalized)) existingByPhone.set(client.phone_normalized, "existing_client");
    }
  });

  const pending = [];
  for (const [phone, row] of uniqueRows) {
    const status = existingByPhone.get(phone);
    if (status === "do_not_contact") summary.doNotContact += 1;
    else if (status) summary.duplicates += 1;
    else pending.push(row);
  }

  await runBatches(chunks(pending, 500), async (batch) => {
    const { data, error } = await db().from("prospecting_contacts").upsert(batch, { onConflict: "phone_normalized", ignoreDuplicates: true }).select("phone_normalized");
    if (error) throw error;
    const imported = data?.length || 0;
    summary.imported += imported;
    summary.duplicates += batch.length - imported;
  });
  return summary;
}

function requireOwnerScopeUserId(auth) {
  const id = auth?.profile?.id;
  if (!id) throw new Error("Usuário sem perfil ativo.");
  return id;
}

// Antigo botão "WhatsApp" da Prospecção (reserva + abre wa.me). Desde
// 2026-10-02 a rota da Prospecção usa o "Disparar" (lib/prospecting-extra-dispatch.js);
// mantida porque attachClaimedContactToClient e a reserva atômica seguem as
// mesmas regras e servem de referência para a prospecção manual.
export async function claimProspectingContact(id, auth) {
  const userId = auth?.profile?.id;
  if (!auth?.ok || !userId) throw new Error("Usuário sem perfil ativo.");
  await assertProspectingParticipation(auth);
  const completion = await getDailyGoalCompletionStatus(userId);
  if (!completion.unlocked) {
    throw new Error(`A Prospecção Extra está bloqueada. Conclua as ${completion.required} atividades da meta do dia, incluindo os clientes pendentes (${completion.completed}/${completion.required}), antes de buscar novos contatos.`);
  }
  const now = new Date().toISOString();
  // Reivindicar UM contato da base geral/individual também consome espaço na
  // carteira ativa (a mesma daily_goal_rounds que a Meta Diária usa) — por
  // isso passa pela mesma trava atômica (RPC com pg_advisory_xact_lock por
  // corretor), nunca um update solto: sem isso, dois cliques quase
  // simultâneos no limite poderiam ultrapassá-lo.
  const { data: claimedRows, error } = await db().rpc("claim_single_prospecting_contact", { p_contact_id: id, p_broker_id: userId, p_today: getTodayInSaoPaulo() });
  if (error) {
    if (String(error.message || "").includes("WALLET_LIMIT_REACHED")) {
      const wallet = await getDailyGoalWalletStatus(userId).catch(() => null);
      const limitText = wallet?.limit ? `${wallet.current}/${wallet.limit}` : "o limite configurado";
      throw new Error(`Sua carteira ativa está cheia (${limitText}). Conclua ou encerre atendimentos pendentes antes de puxar novos contatos da base.`);
    }
    throw error;
  }
  const contact = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;
  if (!contact) throw new Error("Este contato já foi assumido ou ainda está bloqueado.");

  // Contato de base individual (owner_user_id preenchido) só pode ser
  // assumido pelo próprio dono da base — nem outro corretor, nem o
  // administrador geral pode prospectar em nome de outra pessoa. A checagem
  // fica no servidor (não só na tela): alterar a URL/ID não contorna isso.
  if (contact.owner_user_id && contact.owner_user_id !== userId) {
    await db().from("prospecting_contacts").update({ status: "available", assigned_user_id: null, updated_at: new Date().toISOString() }).eq("id", contact.id).eq("assigned_user_id", userId);
    throw new Error("Este contato pertence à base individual de outro corretor.");
  }

  try {
    const registration = await attachClaimedContactToClient(contact, userId, auth, now);
    await history(contact.id, registration.id, userId, "claimed");
    const whatsappUrl = buildGreetingUrl(contact);
    return { contact: mapContact({ ...contact, registration_id: registration.id }), registrationId: registration.id, whatsappUrl };
  } catch (claimError) {
    const revertedAt = new Date().toISOString();
    await db().from("prospecting_contacts").update({ status: "available", assigned_user_id: null, updated_at: revertedAt }).eq("id", contact.id).eq("assigned_user_id", userId);
    await db().from("daily_goal_rounds").update({ status: "ended_no_conversion", ended_at: revertedAt }).eq("prospecting_contact_id", contact.id).eq("broker_id", userId).eq("status", "active");
    throw claimError;
  }
}

// Contato recém-reservado (claim_single_prospecting_contact ou "Disparar")
// vira/vincula o cliente em "Tentando contato" com este corretor e a rodada
// de acompanhamento aponta para ele. Mesma lógica de sempre do botão
// WhatsApp, extraída para ser reaproveitada pelo "Disparar" (2026-10-02).
export async function attachClaimedContactToClient(contact, userId, auth, now = new Date().toISOString()) {
  let registration;
  // Correção preventiva P-01 (2026-10-01): o registration_id do contato só
  // vale se o telefone do cliente for o do contato — senão o vínculo é de
  // outra pessoa (homônimo preso ao mesmo cliente) e é ignorado.
  const trustedRegistrationId = await trustedLinkedRegistrationId(contact);
  if (trustedRegistrationId) {
    const { data, error: updateError } = await db().from("simulation_registrations")
      .update({ responsible_user_id: userId, status: CLIENT_STATUS.AWAITING_RETURN, prospecting_contact_id: contact.id, prospecting_assigned_pending: false, last_whatsapp_contact_at: now, last_status_change_at: now })
      .eq("id", trustedRegistrationId).select("*").single();
    if (updateError) throw updateError;
    registration = data;
  } else {
    registration = await ensureManualSimulationRegistration({ fullName: contact.name, phone: contact.phone_normalized, status: CLIENT_STATUS.AWAITING_RETURN, adminEmail: auth.user?.email, keepExistingIdentity: true }, auth);
    const { error: linkError } = await db().from("simulation_registrations").update({ prospecting_contact_id: contact.id, prospecting_assigned_pending: false, last_whatsapp_contact_at: now }).eq("id", registration.id);
    if (linkError) throw linkError;
    await db().from("prospecting_contacts").update({ registration_id: registration.id }).eq("id", contact.id);
  }
  // A rodada de acompanhamento (daily_goal_rounds) já foi criada DENTRO da
  // RPC de reserva, na mesma transação que reserva o espaço na carteira
  // ativa (trava de concorrência, migration 20260919143000). Só falta
  // vincular o client_id quando o cadastro foi criado agora mesmo (contato
  // sem registration_id prévio) ou quando o vínculo antigo foi ignorado (P-01:
  // a RPC gravou na rodada o cliente ERRADO).
  if (!trustedRegistrationId) {
    let roundQuery = db().from("daily_goal_rounds")
      .update({ client_id: registration.id })
      .eq("prospecting_contact_id", contact.id)
      .eq("broker_id", userId)
      .eq("status", "active");
    roundQuery = contact.registration_id ? roundQuery.or(`client_id.is.null,client_id.eq.${contact.registration_id}`) : roundQuery.is("client_id", null);
    const { error: linkRoundError } = await roundQuery;
    if (linkRoundError) console.warn("Não foi possível vincular o cliente à rodada de acompanhamento:", linkRoundError.message || linkRoundError);
  }
  return registration;
}

export async function updateProspectingContact(id, payload, auth) {
  assertGeneralAdminOrManager(auth);
  const updates = { updated_at: new Date().toISOString() };
  if (payload.name !== undefined) updates.name = clean(payload.name).slice(0, 160);
  if (payload.phone !== undefined) {
    const phone = toBrazilianE164(payload.phone);
    if (!phone) throw new Error("WhatsApp inválido.");
    updates.phone_normalized = phone;
  }
  if (payload.action === "unblock") Object.assign(updates, { status: "available", assigned_user_id: null, available_after: null, do_not_contact_at: null, do_not_contact_by: null });
  if (payload.assignedUserId !== undefined) {
    const assignedUserId = payload.assignedUserId || null;
    if (assignedUserId) {
      await assertContactsNotReserved([id]);
      const { data: user } = await db().from("admin_users").select("id").eq("id", assignedUserId).eq("status", "active").maybeSingle();
      if (!user) throw new Error("Corretor inválido ou inativo.");
      // Prospecção SÓ com WhatsApp conectado (2026-10-02): o destino precisa estar operacional.
      await assertCanReceiveProspecting(assignedUserId);
    }
    updates.assigned_user_id = assignedUserId;
    updates.status = assignedUserId ? "claimed" : "available";
  }
  const { data, error } = await db().from("prospecting_contacts").update(updates).eq("id", id).select("*").single();
  if (error) throw error;
  // Contato que saiu do corretor antigo (liberado, desbloqueado ou passado a outro) não pode deixar a rodada dele
  // ativa na carteira (Meta Diária); a rodada de quem continua/passa a ser responsável não é tocada.
  if (payload.assignedUserId !== undefined || payload.action === "unblock") {
    await releaseActiveRoundsForContacts(db(), [id], { exceptBrokerId: payload.assignedUserId || null });
  }
  if (payload.assignedUserId !== undefined && data.registration_id) {
    const { error: registrationError } = await db().from("simulation_registrations").update({ responsible_user_id: payload.assignedUserId || null }).eq("id", data.registration_id);
    if (registrationError) throw registrationError;
  }
  await history(id, data.registration_id, auth.profile.id, payload.action === "unblock" ? "unblocked" : "edited");
  return mapContact(data);
}

export async function getProspectingHistory(id, auth) {
  assertGeneralAdminOrManager(auth);
  const { data, error } = await db().from("prospecting_history").select("id, event_type, details, created_at, user:admin_users(name)").eq("contact_id", id).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((item) => ({ id: item.id, eventType: item.event_type, details: item.details || {}, createdAt: item.created_at, userName: item.user?.name || "Sistema" }));
}

export async function deleteProspectingContact(id, auth) {
  assertGeneralAdminOrManager(auth);
  const { error } = await db().from("prospecting_contacts").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteProspectingContacts(ids, auth) {
  assertGeneralAdminOrManager(auth);
  const contactIds = normalizeIds(ids);
  if (!contactIds.length) throw new Error("Selecione pelo menos um contato.");
  for (const batch of chunks(contactIds, 500)) {
    const { error } = await db().from("prospecting_contacts").delete().in("id", batch);
    if (error) throw error;
  }
  return { deleted: contactIds.length };
}

export async function assignProspectingContacts(ids, assignedUserId, auth) {
  assertGeneralAdminOrManager(auth);
  const contactIds = normalizeIds(ids);
  if (!contactIds.length) throw new Error("Selecione pelo menos um contato.");
  if (!assignedUserId) throw new Error("Selecione um corretor.");
  // Contato reservado numa lista manual impressa não vai para outro corretor (2026-10-04).
  await assertContactsNotReserved(contactIds);
  const { data: user, error: userError } = await db().from("admin_users").select("id").eq("id", assignedUserId).eq("status", "active").maybeSingle();
  if (userError) throw userError;
  if (!user) throw new Error("Corretor inválido ou inativo.");
  // Prospecção SÓ com WhatsApp conectado (2026-10-02): corretor sem a sessão conectada não
  // recebe clientes para prospecção. A supervisão do admin segue livre; só o DESTINO é checado.
  await assertCanReceiveProspecting(assignedUserId);

  let assigned = 0;
  for (const batch of chunks(contactIds, 500)) {
    const now = new Date().toISOString();
    const { data, error } = await db().from("prospecting_contacts").update({ assigned_user_id: assignedUserId, last_broker_id: assignedUserId, status: "claimed", available_after: null, updated_at: now }).in("id", batch).select("id, name, phone_normalized, registration_id");
    if (error) throw error;
    const rows = data || [];
    assigned += rows.length;
    // Contato reatribuído a outro corretor: a rodada ativa do corretor anterior sai da carteira dele.
    await releaseActiveRoundsForContacts(db(), rows.map((row) => row.id), { exceptBrokerId: assignedUserId });

    // Linha por linha, mas em paralelo dentro do lote (até 500) em vez de
    // sequencial — achado de performance, pente-fino 2026-09-30: atribuir um
    // lote grande levava dezenas de segundos de round-trips um atrás do
    // outro numa ação que a tela trata como síncrona.
    // Atribuição em massa é ação ADMINISTRATIVA (só admin/gestor): registra
    // quem REALMENTE executou, mesmo durante "Alterar conta" (decisão do dono,
    // 2026-10-01 — única exceção à regra de que ação operacional feita como o
    // corretor fica com o corretor emulado; ver .claude/rules/auth-permissoes.md).
    const actingAdminEmail = getActingAdminEmail(auth);
    await Promise.all(rows.map(async (row) => {
      // Só reaproveita o cliente vinculado se o telefone bater (P-01).
      if (row.registration_id && await trustedLinkedRegistrationId(row)) return;
      const registration = await ensureManualSimulationRegistration({
        fullName: row.name,
        phone: row.phone_normalized,
        responsibleUserId: assignedUserId,
        status: CLIENT_STATUS.PENDING,
        adminEmail: actingAdminEmail,
        keepExistingIdentity: true,
        acquisitionContext: {
          kind: "manual",
          label: `Cadastro manual — ${auth?.profile?.name || actingAdminEmail || "Equipe"}`,
          actor: actingAdminEmail || null,
          destination: "broker"
        }
      }, auth);
      row.registration_id = registration.id;
      const { error: contactLinkError } = await db().from("prospecting_contacts").update({ registration_id: row.registration_id }).eq("id", row.id);
      if (contactLinkError) throw contactLinkError;
    }));

    await Promise.all(rows.map(async (row) => {
      const { error: registrationError } = await db().from("simulation_registrations").update({
        responsible_user_id: assignedUserId,
        status: CLIENT_STATUS.PENDING,
        prospecting_contact_id: row.id,
        prospecting_assigned_pending: true,
        prospecting_assigned_by_user_id: auth.profile.id,
        last_status_change_at: now
      }).eq("id", row.registration_id);
      if (registrationError) throw registrationError;
    }));

    if (rows.length) {
      const { error: historyError } = await db().from("prospecting_history").insert(rows.map((row) => ({ contact_id: row.id, registration_id: row.registration_id || null, user_id: auth.profile.id, event_type: "bulk_assigned", details: { assignedUserId } })));
      if (historyError) throw historyError;
    }
  }
  return { assigned };
}

export async function handleProspectingClientAction(registrationId, action, auth, payload = {}) {
  const registration = await getSimulationRegistration(registrationId, auth);
  if (!registration?.prospectingContactId) throw new Error("Cliente sem vínculo com a prospecção.");
  const now = new Date();
  const contactId = registration.prospectingContactId;
  if (action === "return_to_queue") {
    if (!isOwnerAdminEmail(auth?.user?.email) && !isOwnerAdminEmail(auth?.profile?.email)) throw new Error("Apenas o usuário master pode devolver este cliente à fila.");
    if (registration.prospectingAssignedByUserId !== auth.profile.id) throw new Error("Este cliente não foi atribuído pelo seu usuário.");
    const { data: returned, error } = await db().from("prospecting_contacts").update({ status: "available", assigned_user_id: null, last_broker_id: registration.responsibleUserId || null, last_attempt_at: null, available_after: null, updated_at: now.toISOString() }).eq("id", contactId).not("assigned_user_id", "is", null).select("id").maybeSingle();
    if (error) throw error;
    if (!returned) throw new Error("Este contato já foi devolvido ou não está mais atribuído.");
    const { error: registrationError } = await db().from("simulation_registrations").update({ ...returnedToQueueClientPatch(now.toISOString(), { setStatus: true }), prospecting_assigned_pending: false, prospecting_assigned_by_user_id: null }).eq("id", registrationId);
    if (registrationError) throw registrationError;
    await releaseActiveRoundsForContacts(db(), [contactId], { now });
    await history(contactId, registrationId, auth.profile.id, "returned_to_queue", { immediate: true });
    return { removed: true };
  }
  if (action === "prospect") {
    // "Prospectar" = executar Prospecção: só com o WhatsApp conectado (2026-10-02). As demais
    // ações do card (atendimento, devolver, não contactar) são gestão do cliente e seguem livres.
    await assertProspectingParticipation(auth);
    if (!registration.prospectingAssignedPending) throw new Error("Este cliente já teve a prospecção iniciada.");
    const { data: contact, error: contactError } = await db().from("prospecting_contacts").select("*").eq("id", contactId).eq("assigned_user_id", registration.responsibleUserId).maybeSingle();
    if (contactError) throw contactError;
    if (!contact) throw new Error("Este contato não pertence mais a este corretor.");
    const { data: updated, error } = await db().from("simulation_registrations").update({ status: CLIENT_STATUS.AWAITING_RETURN, prospecting_assigned_pending: false, last_whatsapp_contact_at: now.toISOString(), last_status_change_at: now.toISOString() }).eq("id", registrationId).eq("prospecting_assigned_pending", true).select("id").maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("Este cliente já teve a prospecção iniciada.");
    await db().from("prospecting_contacts").update({ last_attempt_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", contactId);
    await history(contactId, registrationId, auth.profile.id, "prospecting_started");
    return { status: CLIENT_STATUS.AWAITING_RETURN, prospectingAssignedPending: false, whatsappUrl: buildGreetingUrl(contact) };
  }
  if (action === "in_service") {
    // Cliente de disparo sem resposta real não avança (trava 2026-10-02).
    await assertProspectingStatusChangeAllowed({ clientId: registrationId, currentStatus: registration.status, nextStatus: CLIENT_STATUS.IN_SERVICE, auth });
    const { error } = await db().from("simulation_registrations").update({ status: CLIENT_STATUS.IN_SERVICE, prospecting_assigned_pending: false, last_status_change_at: now.toISOString() }).eq("id", registrationId);
    if (error) throw error;
    await history(contactId, registrationId, auth.profile.id, "in_service");
    return { status: CLIENT_STATUS.IN_SERVICE, prospectingAssignedPending: false };
  }
  if (action === "return") {
    const availableAfter = new Date(now.getTime() + THIRTY_DAYS_MS).toISOString();
    let query = db().from("prospecting_contacts").update({ status: "recent_attempt", assigned_user_id: null, last_broker_id: registration.responsibleUserId || auth.profile.id, last_attempt_at: now.toISOString(), available_after: availableAfter, updated_at: now.toISOString() }).eq("id", contactId);
    if (!isGeneralAdminAuth(auth)) query = query.eq("assigned_user_id", auth.profile.id);
    const { data: returned, error } = await query.select("id").maybeSingle();
    if (error) throw error;
    if (!returned) throw new Error("Este contato não pertence mais a este corretor.");
    await db().from("simulation_registrations").update(returnedToQueueClientPatch(now.toISOString(), { setStatus: true })).eq("id", registrationId);
    // "sai da sua carteira": a rodada ativa do contato devolvido encerra junto (senão contava na carteira do corretor).
    await releaseActiveRoundsForContacts(db(), [contactId], { now });
    await history(contactId, registrationId, auth.profile.id, "returned", { availableAfter });
    return { removed: true };
  }
  if (action === "do_not_contact") {
    // Motivo obrigatório + auditoria completa + trava anti-abuso ANTES de
    // qualquer mutação — se a trava disparar (muitas ações repetidas em
    // pouco tempo), nada abaixo chega a ser executado.
    const normalized = await recordDoNotContactAudit({
      clientId: registrationId,
      contactId,
      brokerId: registration.responsibleUserId || null,
      reasonKey: payload.reasonKey,
      reasonText: payload.reasonText,
      executedBy: auth.profile.id,
      origin: "prospecting_client"
    });

    // Mantém a atribuição (regra do dono, 2026-10-02): o responsável do
    // cliente e o corretor do contato NÃO são zerados — "não contactar" só
    // bloqueia prospecção/automação (lib/do-not-contact-core.mjs).
    const { error } = await db().from("prospecting_contacts").update(contactDoNotContactPatch(now.toISOString(), auth.profile.id)).eq("id", contactId);
    if (error) throw error;
    await db().from("simulation_registrations").update(clientDoNotContactPatch(now.toISOString())).eq("id", registrationId);
    await history(contactId, registrationId, auth.profile.id, "do_not_contact", { reasonKey: normalized.reasonKey, reasonText: normalized.reasonText });
    return { removed: true };
  }
  throw new Error("Ação inválida.");
}

function mapContact(row) {
  const available = row.status === "available" || (row.status === "recent_attempt" && row.available_after && new Date(row.available_after) <= new Date());
  return { id: row.id, name: row.name, phone: row.phone_normalized, status: available ? "available" : row.status, availableAfter: row.available_after || "", assignedUserId: row.assigned_user_id || "", registrationId: row.registration_id || "", lastBrokerName: row.last_broker?.name || "" };
}

function buildGreetingUrl(contact) {
  const greeting = getTimeGreeting();
  const firstName = clean(contact.name).split(" ")[0] || "";
  return `https://wa.me/${contact.phone_normalized.replace(/\D/g, "")}?text=${encodeURIComponent(`${greeting} ${firstName}, tudo bem?`)}`;
}

async function history(contactId, registrationId, userId, eventType, details = {}) {
  const { error } = await db().from("prospecting_history").insert({ contact_id: contactId, registration_id: registrationId || null, user_id: userId || null, event_type: eventType, details });
  if (error) throw error;
}
function db() { const client = getSupabaseAdminClient(); if (!client) throw new Error("Supabase não configurado."); return client; }
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function normalizeIds(ids) { return [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 30000); }
function chunks(items, size) { const result = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
async function runBatches(batches, handler) { for (const group of chunks(batches, 5)) await Promise.all(group.map(handler)); }

// O PostgREST (Supabase) limita implicitamente a 1000 linhas qualquer select
// sem .range() explícito — sem isso, bases com mais de 1000 contatos (fila
// compartilhada e bases individuais grandes) eram silenciosamente cortadas.
// buildQuery é chamado de novo a cada página (query builders do supabase-js
// não são reutilizáveis entre requisições).
const FETCH_PAGE_SIZE = 1000;
async function fetchAllRows(buildQuery) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }
  return rows;
}

// registration_id gravado no contato, só se o cliente for desta pessoa
// (mesmo telefone). Vínculo de homônimo (bug P-01) devolve null.
async function trustedLinkedRegistrationId(contact) {
  if (!contact?.registration_id) return null;
  const { data, error } = await db().from("simulation_registrations").select("id, phone_normalized").eq("id", contact.registration_id).maybeSingle();
  if (error) throw error;
  if (data && clientMatchesContactPhone(data.phone_normalized, contact.phone_normalized)) return data.id;
  if (data) console.warn(`[prospeccao] vínculo contato→cliente ignorado (telefone não bate): contato ${contact.id}, cliente ${contact.registration_id}`);
  return null;
}
