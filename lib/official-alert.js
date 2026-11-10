import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { phoneLookupCandidates, canonicalWhatsappPhone } from "./phone-utils";
import { OFFICIAL_CONVERSATION_SESSION_KEY } from "./client-phone-lookup";
import { decideAlertChannel, isRecipientWindowOpen } from "./official-alert-core.mjs";

// ALERTA PELO NÚMERO OFICIAL — função única e genérica (dono, 2026-11-10). Regras puras em lib/official-alert-core.mjs.
// Texto livre pelo Oficial ao WhatsApp do usuário SÓ com a janela de 24 h dele aberta (sem modelo da Meta, decisão do dono);
// Os avisos do CRM (sino + push) são um canal à parte e continuam como sempre (`crm`). Nunca lança por causa do canal WhatsApp:
// devolve { channel, reason } e quem chama decide. Não grava a mensagem no Chat (conversa com número da equipe não é cliente, WA-12).

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export function isOfficialConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Telefones do usuário (cadastro + números das sessões individuais) em formato canônico. */
export async function listUserPhones(userId) {
  const [{ data: user, error }, { data: sessions, error: sessionError }] = await Promise.all([
    db().from("admin_users").select("phone").eq("id", userId).maybeSingle(),
    db().from("whatsapp_individual_sessions").select("phone_number, known_phone_numbers").eq("user_id", userId)
  ]);
  if (error) throw error;
  if (sessionError) throw sessionError;
  const all = [user?.phone, ...(sessions || []).flatMap((row) => [row.phone_number, ...(row.known_phone_numbers || [])])];
  return [...new Set(all.map((phone) => canonicalWhatsappPhone(phone)).filter(Boolean))];
}

/** Última entrada do usuário no Oficial (qualquer um dos telefones dele) — base da janela de 24 h e da conferência das 08:00. */
export async function lastOfficialInboundAt(phones) {
  const candidates = [...new Set(phones.flatMap((phone) => phoneLookupCandidates(phone)))];
  if (!candidates.length) return null;
  const { data, error } = await db().from("whatsapp_conversations").select("last_inbound_at")
    .eq("session_key", OFFICIAL_CONVERSATION_SESSION_KEY).in("contact_phone", candidates).not("last_inbound_at", "is", null)
    .order("last_inbound_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0]?.last_inbound_at || null;
}

async function crmNotify({ userId, text, clientId, push }) {
  const now = new Date().toISOString();
  const { error } = await db().from("crm_notifications").insert({
    recipient_user_id: userId, client_id: clientId || null, title: push?.title || "Aviso", description: String(text).slice(0, 500), notification_type: "new_client", scheduled_at: now
  });
  if (error) console.warn("Alerta pelo Oficial: falha ao gravar o sino:", error.message || error);
  if (push) {
    const { sendPushToUser } = await import("./push-subscriptions");
    await sendPushToUser(userId, { kind: "new_client", title: push.title, body: push.body || String(text).slice(0, 120), url: push.url || "/admin" });
  }
}

/**
 * Avisa `userId`. Dois canais ADICIONAIS (dono, 2026-11-10: "os avisos do CRM continuam como hoje"): (1) CRM — sino + push, quando
 * `crm` (padrão true; quem já avisa pelo CRM por conta própria passa `crm: false`); (2) WhatsApp pelo Oficial, SÓ com a janela de
 * 24 h dele aberta e o Oficial configurado. `push` = { title, body, url }. Devolve { channel: "official" | "push", reason, crm }
 * (`channel` = se o WhatsApp saiu; "push" = só o CRM).
 */
export async function sendOfficialAlert({ userId, text, clientId = null, push = null, crm = true }) {
  const phones = await listUserPhones(userId);
  const lastInbound = phones.length ? await lastOfficialInboundAt(phones).catch((error) => { console.warn("Alerta pelo Oficial: falha ao ler a janela:", error?.message || error); return null; }) : null;
  const decision = decideAlertChannel({ hasPhone: phones.length > 0, windowOpen: isRecipientWindowOpen(lastInbound), officialConfigured: isOfficialConfigured() });
  let outcome = decision;
  if (decision.channel === "official") {
    try {
      const { sendWhatsappTextMessage } = await import("./whatsapp-master");
      await sendWhatsappTextMessage({ to: phones[0], text, allowRawRecipient: true });
    } catch (error) {
      console.warn("Alerta pelo Oficial: a Meta não aceitou o WhatsApp:", error?.message || error);
      outcome = { channel: "push", reason: "envio_recusado" };
    }
  }
  if (crm) await crmNotify({ userId, text, clientId, push });
  return { ...outcome, crm };
}
