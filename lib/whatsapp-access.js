import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdmin } from "./admin-access";
import { getActingAdminEmail } from "./admin-auth";
import { isGeneralAdminProfile } from "./admin-profiles";
import { WHATSAPP_ACCESS_BLOCKED_CODE, WHATSAPP_ACCESS_BLOCKED_MESSAGE } from "./whatsapp-access-core.mjs";

// Controle individual de acesso aos recursos WhatsApp (2026-10-04). Fonte única: admin_users.whatsapp_access_blocked
// (padrão false = LIBERADO). Regras puras em lib/whatsapp-access-core.mjs. Bloquear só IMPEDE o uso operacional:
// nunca desconecta sessão nem apaga credenciais, fila, histórico, cliente, funil ou pontuação.

export class WhatsappAccessBlockedError extends Error {
  constructor(message = WHATSAPP_ACCESS_BLOCKED_MESSAGE) {
    super(message);
    this.name = "WhatsappAccessBlockedError";
    this.status = 403;
    this.code = WHATSAPP_ACCESS_BLOCKED_CODE;
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Administrador geral nunca é bloqueado (a função só devolve true para quem tem a marca e não é o dono).
export async function isWhatsappAccessBlocked(userId) {
  if (!userId) return false;
  const { data, error } = await db().from("admin_users").select("id, role, email, whatsapp_access_blocked").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data || isGeneralAdminProfile(data)) return false;
  return data.whatsapp_access_blocked === true;
}

// Última barreira, no ponto de envio/conexão da sessão do corretor (vale para cron, Chat, automações e qualquer
// chamador futuro): lança WhatsappAccessBlockedError (403, código estável) se o dono da sessão está bloqueado.
export async function assertWhatsappAccessAllowed(userId) {
  if (await isWhatsappAccessBlocked(userId)) throw new WhatsappAccessBlockedError();
}

// Conjunto de corretores bloqueados (o cron consulta UMA vez por ciclo).
export async function listWhatsappBlockedUserIds() {
  const { data, error } = await db().from("admin_users").select("id, role, email").eq("whatsapp_access_blocked", true);
  if (error) throw error;
  return new Set((data || []).filter((row) => !isGeneralAdminProfile(row)).map((row) => row.id));
}

// O administrador geral libera/bloqueia UM corretor, com auditoria. Ao LIBERAR, a fila pendente é
// reprogramada ANTES de a flag virar — a retomada nunca compensa o período parado (ver resumeBrokerQueueAfterUnblock).
export async function setWhatsappAccessBlocked(auth, brokerId, blocked) {
  // Só o administrador geral altera (o gestor VÊ o estado no card, que para ele é somente leitura — mesma regra dos demais
  // controles do card). O corretor nunca chega aqui: assertGeneralAdmin recusa qualquer outro perfil.
  assertGeneralAdmin(auth);
  if (!brokerId) throw new Error("Informe o corretor.");
  if (typeof blocked !== "boolean") throw new Error("Informe se o acesso fica bloqueado ou liberado.");

  const { data: target, error: targetError } = await db().from("admin_users").select("id, name, role, email, whatsapp_access_blocked").eq("id", brokerId).maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("Corretor não encontrado.");
  if (isGeneralAdminProfile(target)) throw new Error("O administrador geral não pode ter o acesso ao WhatsApp bloqueado.");

  const previous = target.whatsapp_access_blocked === true;
  if (previous === blocked) return { brokerId, blocked, changed: false };

  if (!blocked) {
    // Import tardio: lib/daily-goal-auto.js importa este módulo (ciclo).
    const { resumeBrokerQueueAfterUnblock } = await import("./daily-goal-auto");
    await resumeBrokerQueueAfterUnblock(brokerId);
  }

  const { error: updateError } = await db().from("admin_users").update({ whatsapp_access_blocked: blocked, updated_at: new Date().toISOString() }).eq("id", brokerId);
  if (updateError) throw updateError;

  const actor = auth?.realProfile || auth?.profile || {};
  const { error: auditError } = await db().from("whatsapp_access_audit").insert({
    broker_id: brokerId,
    previous_blocked: previous,
    new_blocked: blocked,
    changed_by: actor.id || null,
    changed_by_name: actor.name || null,
    changed_by_email: getActingAdminEmail(auth) || actor.email || null
  });
  if (auditError) {
    // A mudança já valeu; o rastro nunca pode sumir em silêncio.
    console.error(`Falha ao gravar a auditoria do acesso WhatsApp (corretor ${brokerId}):`, auditError.message);
  }
  return { brokerId, blocked, changed: true };
}

// Chat desativado pelo dono (lib/chat-control.js): corretor/associado não recebem push de conversa (nem veem o Chat).
export async function isChatPushSuppressed(userId) {
  if (!userId) return false;
  const { isChatDisabled, isChatRestrictedProfile } = await import("./chat-control");
  if (!(await isChatDisabled())) return false;
  const { data } = await db().from("admin_users").select("role").eq("id", userId).maybeSingle();
  return isChatRestrictedProfile(data);
}
