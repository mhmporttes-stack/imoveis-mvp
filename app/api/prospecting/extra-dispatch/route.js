import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getExtraDispatchStatus } from "@/lib/prospecting-extra-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Estado do botão "Disparar"/cadeado da Prospecção do usuário logado
// (Meta 100%, X/10, cooldown) — sempre calculado no servidor.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await getExtraDispatchStatus(auth)); }
  catch (error) { return NextResponse.json({ error: error.message || "Não foi possível carregar os disparos." }, { status: error?.status || 400 }); }
}
