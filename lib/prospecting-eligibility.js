import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getIndividualSessionStatusForUser } from "./whatsapp-individual";
import { isGeneralAdminAuth, isGeneralAdminProfile } from "./admin-profiles";
import { getOpenRestriction } from "./whatsapp-restriction";
import {
  PROSPECTING_NOT_ELIGIBLE_CODE,
  PROSPECTING_RECEIVE_BLOCKED_MESSAGE,
  decideProspectingGate,
  gateNeedsGoalStatus,
  gateRequiresWhatsapp,
  isSessionOperational,
  participationRequiresWhatsapp
} from "./prospecting-eligibility-core.mjs";

// Barreiras da regra "Prospecção só com WhatsApp conectado" (2026-10-02, regras puras em
// lib/prospecting-eligibility-core.mjs). Tudo roda no SERVIDOR — a tela só reflete. Nada aqui
// desconecta sessão, apaga histórico ou mexe em cliente: só impede participar/executar.
// Exceção (REGRA OFICIAL — dono, 2026-10-02): restrição de WhatsApp VALIDADA libera a Meta Diária
// manual e, com 100% da Meta, a Prospecção manual — nunca o disparo automático (strict).

export class ProspectingNotEligibleError extends Error {
  constructor(message, code = PROSPECTING_NOT_ELIGIBLE_CODE) {
    super(message);
    this.name = "ProspectingNotEligibleError";
    this.status = 403;
    this.code = code;
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Gate para quem está LOGADO (kind: "participate" = executar/receber; "access" = abrir a
// tela/rotas da Prospecção como corretor; "daily_goal" = executar a Meta Diária manual).
// strict: fluxo que exige sessão conectada de verdade (disparo automático/fila extra).
// -> { allowed, message, code, sessionStatus }
export async function getProspectingGate(auth, kind = "participate", { strict = false } = {}) {
  const profile = auth?.profile;
  const isGeneralAdmin = isGeneralAdminAuth(auth);
  // Sem exigência para este perfil/ação (ex.: administrador geral): nem consulta a sessão.
  if (!gateRequiresWhatsapp({ kind, role: profile?.role, isGeneralAdmin })) {
    return { allowed: true, message: "", code: "", sessionStatus: null };
  }
  const sessionStatus = profile?.id ? await getIndividualSessionStatusForUser(profile.id) : null;
  // Restrição VALIDADA só é consultada com a sessão NÃO conectada; "informada" nunca libera nada.
  let restriction = null;
  if (profile?.id && !strict && !isSessionOperational(sessionStatus)) {
    restriction = (await getOpenRestriction(profile.id))?.validation_status || null;
  }
  const input = { kind, role: profile?.role, isGeneralAdmin, sessionStatus, restriction, strict };
  let goalComplete = false;
  if (gateNeedsGoalStatus(input)) {
    const { getDailyGoalCompletionStatus } = await import("./daily-goal-wallet"); // import tardio: evita ciclo de módulos
    goalComplete = Boolean((await getDailyGoalCompletionStatus(profile.id)).unlocked);
  }
  return { ...decideProspectingGate({ ...input, goalComplete }), sessionStatus };
}

async function assertGate(auth, kind, options) {
  const gate = await getProspectingGate(auth, kind, options);
  if (!gate.allowed) throw new ProspectingNotEligibleError(gate.message, gate.code);
}

export async function assertProspectingParticipation(auth, options = {}) {
  await assertGate(auth, "participate", options);
}

export async function assertProspectingAccess(auth, options = {}) {
  await assertGate(auth, "access", options);
}

// Tentativa manual da Meta Diária: conectado OU restrição validada.
export async function assertDailyGoalParticipation(auth) {
  await assertGate(auth, "daily_goal", {});
}

// Por id de usuário (cron da Meta Diária, geração da cota, atribuição administrativa):
// pode receber/participar? Administrador geral sempre pode (fora da exigência).
export async function isUserEligibleToProspect(userId) {
  if (!userId) return false;
  const { data: profile, error } = await db().from("admin_users").select("id, role, email").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!profile) return false;
  if (!participationRequiresWhatsapp({ isGeneralAdmin: isGeneralAdminProfile(profile) })) return true;
  return isSessionOperational(await getIndividualSessionStatusForUser(userId));
}

// Meta Diária (geração da cota e execução manual): conectado OU restrição VALIDADA aberta.
// Desconectado simples e restrição só informada continuam sem Meta Diária.
export async function isUserEligibleForDailyGoal(userId) {
  if (await isUserEligibleToProspect(userId)) return true;
  const open = await getOpenRestriction(userId);
  return open?.validation_status === "validated";
}

// Atribuição administrativa de contatos da Prospecção: o corretor de destino precisa estar
// operacional (supervisão do admin continua livre; só o DESTINO é checado).
export async function assertCanReceiveProspecting(userId) {
  if (!(await isUserEligibleToProspect(userId))) throw new ProspectingNotEligibleError(PROSPECTING_RECEIVE_BLOCKED_MESSAGE);
}
