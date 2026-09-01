import "server-only";
import { assertGeneralAdmin } from "./admin-access";
import { isGeneralAdminAuth } from "./admin-profiles";
import { CLIENT_STATUS } from "./client-status";
import { toBrazilianE164 } from "./phone-utils";
import { ensureManualSimulationRegistration, getSimulationRegistration } from "./simulation-registrations";
import { getSupabaseAdminClient } from "./supabase";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function listProspectingContacts(auth) {
  if (!auth?.ok) throw new Error("Acesso negado.");
  let query = db().from("prospecting_contacts").select("*, assigned_user:admin_users!prospecting_contacts_assigned_user_id_fkey(name), last_broker:admin_users!prospecting_contacts_last_broker_id_fkey(name)").order("created_at", { ascending: false });
  if (!isGeneralAdminAuth(auth)) query = query.in("status", ["available", "recent_attempt"]);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapContact);
}

export async function importProspectingContacts(rows, auth) {
  assertGeneralAdmin(auth);
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
    uniqueRows.set(phone, { name, phone_normalized: phone });
  }

  const existingByPhone = new Map();
  await runBatches(chunks(Array.from(uniqueRows.keys()), 500), async (phones) => {
    const { data, error } = await db().from("prospecting_contacts").select("phone_normalized, status").in("phone_normalized", phones);
    if (error) throw error;
    for (const contact of data || []) existingByPhone.set(contact.phone_normalized, contact.status);
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

export async function claimProspectingContact(id, auth) {
  const userId = auth?.profile?.id;
  if (!auth?.ok || !userId) throw new Error("Usuário sem perfil ativo.");
  const now = new Date().toISOString();
  const { data: contact, error } = await db().from("prospecting_contacts")
    .update({ status: "claimed", assigned_user_id: userId, last_broker_id: userId, last_attempt_at: now, available_after: null, updated_at: now })
    .eq("id", id).is("assigned_user_id", null)
    .or(`status.eq.available,and(status.eq.recent_attempt,available_after.lte.${now})`)
    .select("*").maybeSingle();
  if (error) throw error;
  if (!contact) throw new Error("Este contato já foi assumido ou ainda está bloqueado.");

  try {
    let registration;
    if (contact.registration_id) {
      const { data, error: updateError } = await db().from("simulation_registrations")
        .update({ responsible_user_id: userId, status: CLIENT_STATUS.AWAITING_RETURN, prospecting_contact_id: contact.id, last_whatsapp_contact_at: now, last_status_change_at: now })
        .eq("id", contact.registration_id).select("*").single();
      if (updateError) throw updateError;
      registration = data;
    } else {
      registration = await ensureManualSimulationRegistration({ fullName: contact.name, phone: contact.phone_normalized, status: CLIENT_STATUS.AWAITING_RETURN, adminEmail: auth.user?.email }, auth);
      const { error: linkError } = await db().from("simulation_registrations").update({ prospecting_contact_id: contact.id, last_whatsapp_contact_at: now }).eq("id", registration.id);
      if (linkError) throw linkError;
      await db().from("prospecting_contacts").update({ registration_id: registration.id }).eq("id", contact.id);
    }
    await history(contact.id, registration.id, userId, "claimed");
    return { contact: mapContact({ ...contact, registration_id: registration.id }), registrationId: registration.id, whatsappUrl: buildGreetingUrl(contact) };
  } catch (claimError) {
    await db().from("prospecting_contacts").update({ status: "available", assigned_user_id: null, updated_at: new Date().toISOString() }).eq("id", contact.id).eq("assigned_user_id", userId);
    throw claimError;
  }
}

export async function updateProspectingContact(id, payload, auth) {
  assertGeneralAdmin(auth);
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
      const { data: user } = await db().from("admin_users").select("id").eq("id", assignedUserId).eq("status", "active").maybeSingle();
      if (!user) throw new Error("Corretor inválido ou inativo.");
    }
    updates.assigned_user_id = assignedUserId;
    updates.status = assignedUserId ? "claimed" : "available";
  }
  const { data, error } = await db().from("prospecting_contacts").update(updates).eq("id", id).select("*").single();
  if (error) throw error;
  if (payload.assignedUserId !== undefined && data.registration_id) {
    const { error: registrationError } = await db().from("simulation_registrations").update({ responsible_user_id: payload.assignedUserId || null }).eq("id", data.registration_id);
    if (registrationError) throw registrationError;
  }
  await history(id, data.registration_id, auth.profile.id, payload.action === "unblock" ? "unblocked" : "edited");
  return mapContact(data);
}

export async function getProspectingHistory(id, auth) {
  assertGeneralAdmin(auth);
  const { data, error } = await db().from("prospecting_history").select("id, event_type, details, created_at, user:admin_users(name)").eq("contact_id", id).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((item) => ({ id: item.id, eventType: item.event_type, details: item.details || {}, createdAt: item.created_at, userName: item.user?.name || "Sistema" }));
}

export async function deleteProspectingContact(id, auth) {
  assertGeneralAdmin(auth);
  const { error } = await db().from("prospecting_contacts").delete().eq("id", id);
  if (error) throw error;
}

export async function handleProspectingClientAction(registrationId, action, auth) {
  const registration = await getSimulationRegistration(registrationId, auth);
  if (!registration?.prospectingContactId) throw new Error("Cliente sem vínculo com a prospecção.");
  const now = new Date();
  const contactId = registration.prospectingContactId;
  if (action === "in_service") {
    const { error } = await db().from("simulation_registrations").update({ status: CLIENT_STATUS.IN_SERVICE, last_status_change_at: now.toISOString() }).eq("id", registrationId);
    if (error) throw error;
    await history(contactId, registrationId, auth.profile.id, "in_service");
    return { status: CLIENT_STATUS.IN_SERVICE };
  }
  if (action === "return") {
    const availableAfter = new Date(now.getTime() + THIRTY_DAYS_MS).toISOString();
    let query = db().from("prospecting_contacts").update({ status: "recent_attempt", assigned_user_id: null, last_broker_id: registration.responsibleUserId || auth.profile.id, last_attempt_at: now.toISOString(), available_after: availableAfter, updated_at: now.toISOString() }).eq("id", contactId);
    if (!isGeneralAdminAuth(auth)) query = query.eq("assigned_user_id", auth.profile.id);
    const { data: returned, error } = await query.select("id").maybeSingle();
    if (error) throw error;
    if (!returned) throw new Error("Este contato não pertence mais a este corretor.");
    await db().from("simulation_registrations").update({ responsible_user_id: null, status: CLIENT_STATUS.ARCHIVED, last_status_change_at: now.toISOString() }).eq("id", registrationId);
    await history(contactId, registrationId, auth.profile.id, "returned", { availableAfter });
    return { removed: true };
  }
  if (action === "do_not_contact") {
    const { error } = await db().from("prospecting_contacts").update({ status: "do_not_contact", assigned_user_id: null, do_not_contact_by: auth.profile.id, do_not_contact_at: now.toISOString(), available_after: null, updated_at: now.toISOString() }).eq("id", contactId);
    if (error) throw error;
    await db().from("simulation_registrations").update({ responsible_user_id: null, status: CLIENT_STATUS.ARCHIVED, last_status_change_at: now.toISOString() }).eq("id", registrationId);
    await history(contactId, registrationId, auth.profile.id, "do_not_contact");
    return { removed: true };
  }
  throw new Error("Ação inválida.");
}

function mapContact(row) {
  const available = row.status === "available" || (row.status === "recent_attempt" && row.available_after && new Date(row.available_after) <= new Date());
  return { id: row.id, name: row.name, phone: row.phone_normalized, status: available ? "available" : row.status, availableAfter: row.available_after || "", assignedUserId: row.assigned_user_id || "", registrationId: row.registration_id || "", lastBrokerName: row.last_broker?.name || "" };
}

function buildGreetingUrl(contact) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const greeting = minutes >= 360 && minutes < 720 ? "Bom dia" : minutes >= 720 && minutes < 1120 ? "Boa tarde" : "Boa noite";
  const firstName = clean(contact.name).split(" ")[0] || "";
  return `https://wa.me/${contact.phone_normalized.replace(/\D/g, "")}?text=${encodeURIComponent(`${greeting} ${firstName}, tudo bem?`)}`;
}

async function history(contactId, registrationId, userId, eventType, details = {}) {
  const { error } = await db().from("prospecting_history").insert({ contact_id: contactId, registration_id: registrationId || null, user_id: userId || null, event_type: eventType, details });
  if (error) throw error;
}
function db() { const client = getSupabaseAdminClient(); if (!client) throw new Error("Supabase não configurado."); return client; }
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function chunks(items, size) { const result = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
async function runBatches(batches, handler) { for (const group of chunks(batches, 5)) await Promise.all(group.map(handler)); }
