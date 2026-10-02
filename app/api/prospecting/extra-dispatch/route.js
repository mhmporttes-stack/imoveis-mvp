import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getExtraDispatchStatus } from "@/lib/prospecting-extra-dispatch";
import { ProspectingNotEligibleError } from "@/lib/prospecting-eligibility";
import { getOpenRestriction } from "@/lib/whatsapp-restriction";
import { RESTRICTED_MANUAL_MESSAGE } from "@/lib/daily-goal-compensation-view-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Estado do botão "Disparar"/cadeado da Prospecção do usuário logado
// (Meta 100%, X/10, cooldown) — sempre calculado no servidor.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await getExtraDispatchStatus(auth)); }
  catch (error) {
    // Restrição VALIDADA (PRO-14): o disparo automático/fila extra segue INDISPONÍVEL (o POST continua
    // estrito), mas a tela recebe um estado explícito em vez de erro genérico. Só apresentação.
    if (error instanceof ProspectingNotEligibleError && auth?.profile?.id) {
      const open = await getOpenRestriction(auth.profile.id).catch(() => null);
      if (open?.validation_status === "validated") {
        return NextResponse.json({ available: false, reason: "whatsapp_restricted", automaticDispatch: "unavailable_restricted", message: RESTRICTED_MANUAL_MESSAGE, count: 0, limit: 10, open: 0 });
      }
    }
    return NextResponse.json({ error: error.message || "Não foi possível carregar os disparos." }, { status: error?.status || 400 });
  }
}
