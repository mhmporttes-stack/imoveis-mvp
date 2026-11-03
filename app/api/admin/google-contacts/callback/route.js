import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { completeGoogleSmsConnection } from "@/lib/sms-google-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retorno do Google (PRO-18g). A URI de redirecionamento cadastrada no Google Cloud precisa ser exatamente esta rota.
// Também exige o admin geral REAL logado e confere que o `state` foi assinado para ELE (anti-CSRF). Sempre volta ao CRM.
const BACK = "/admin/lote-sms";

export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.redirect(new URL(auth.status === 401 ? "/admin/login" : `${BACK}?google=sem_permissao`, request.url));
  const params = new URL(request.url).searchParams;
  if (params.get("error")) return NextResponse.redirect(new URL(`${BACK}?google=cancelado`, request.url));
  const code = params.get("code");
  const state = params.get("state");
  const userId = auth.user?.id;
  if (!code || !state || !userId) return NextResponse.redirect(new URL(`${BACK}?google=erro`, request.url));
  try {
    await completeGoogleSmsConnection({ code, state, userId });
    return NextResponse.redirect(new URL(`${BACK}?google=conectado`, request.url));
  } catch (error) {
    console.error("Google Contatos (Lote de SMS): falha ao concluir a conexão:", error?.message || error);
    return NextResponse.redirect(new URL(`${BACK}?google=erro`, request.url));
  }
}
