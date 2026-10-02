import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { getIndividualSessionStatusForUser } from "./whatsapp-individual";
import { isGeneralAdminAuth, isGeneralAdminProfile } from "./admin-profiles";
import {
  PROSPECTING_NOT_ELIGIBLE_CODE,
  PROSPECTING_RECEIVE_BLOCKED_MESSAGE,
  decideProspectingGate,
  gateRequiresWhatsapp,
  isSessionOperational,
  participationRequiresWhatsapp
} from "./prospecting-eligibility-core.mjs";

// Barreiras da regra "Prospecção só com WhatsApp conectado" (2026-10-02, regras puras em
// lib/prospecting-eligibility-core.mjs). Tudo roda no SERVIDOR — a tela só reflete. Nada aqui
// desconecta sessão, apaga histórico ou mexe em cliente: só impede participar/executar.

export class ProspectingNotEligibleError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProspectingNotEligibleError";
    this.status = 403;
    this.code = PROSPECTING_NOT_ELIGIBLE_CODE;
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Gate para quem está LOGADO (kind: "participate" = executar/receber; "access" = abrir a
// tela/rotas da Prospecção como corretor). -> { allowed, message, code, sessionStatus }
export async function getProspectingGate(auth, kind = "participate") {
  const profile = auth?.profile;
  const isGeneralAdmin = isGeneralAdminAuth(auth);
  // Sem exigência para este perfil/ação (ex.: administrador geral): nem consulta a sessão.
  if (!gateRequiresWhatsapp({ kind, role: profile?.role, isGeneralAdmin })) {
    return { allowed: true, message: "", code: "", sessionStatus: null };
  }
  const sessionStatus = profile?.id ? await getIndividualSessionStatusForUser(profile.id) : null;
  return { ...decideProspectingGate({ kind, role: profile?.role, isGeneralAdmin, sessionStatus }), sessionStatus };
}

export async function assertProspectingParticipation(auth) {
  const gate = await getProspectingGate(auth, "participate");
  if (!gate.allowed) throw new ProspectingNotEligibleError(gate.message);
}

export async function assertProspectingAccess(auth) {
  const gate = await getProspectingGate(auth, "access");
  if (!gate.allowed) throw new ProspectingNotEligibleError(gate.message);
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

// Atribuição administrativa de contatos da Prospecção: o corretor de destino precisa estar
// operacional (supervisão do admin continua livre; só o DESTINO é checado).
export async function assertCanReceiveProspecting(userId) {
  if (!(await isUserEligibleToProspect(userId))) throw new ProspectingNotEligibleError(PROSPECTING_RECEIVE_BLOCKED_MESSAGE);
}
