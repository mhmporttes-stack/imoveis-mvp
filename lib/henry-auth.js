import "server-only";
import { isOwnerAdminEmail, requireAdminApi } from "./admin-auth";
import { isHenryEligible } from "./henry-voice-core.mjs";

// Guard das rotas do assistente Henry (docs/BUSINESS_RULES.md HENRY-1): só o DONO, na conta real, fora de "Alterar conta" —
// os outros perfis recebem 403 (o componente nem é montado para eles; a barreira é a rota). Usado por /api/admin/henry e
// /api/admin/henry/lock (tela de bloqueio, HENRY-LOCK).
export async function requireHenryOwner(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return auth;
  if (!isHenryEligible({ ok: auth.ok, accountSwitchMode: auth.accountSwitchMode, isOwner: isOwnerAdminEmail(auth.user?.email) })) {
    return { ok: false, status: 403, error: "O assistente Henry é só do dono, na conta dele (fora de \"Alterar conta\")." };
  }
  return auth;
}
