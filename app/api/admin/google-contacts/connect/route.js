import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { buildGoogleSmsAuthUrl } from "@/lib/sms-google-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lote de SMS -> Google Contatos (PRO-18g). Navegação do navegador (não fetch): leva o dono à tela de consentimento do Google.
// Só o admin geral REAL (nunca "Alterar conta"). Nenhum dado de cliente passa por aqui; o state é preso a quem iniciou.
const BACK = "/admin/lote-sms";

export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.redirect(new URL(auth.status === 401 ? "/admin/login" : `${BACK}?google=sem_permissao`, request.url));
  const userId = auth.user?.id;
  if (!userId) return NextResponse.redirect(new URL(`${BACK}?google=erro`, request.url));
  try {
    return NextResponse.redirect(buildGoogleSmsAuthUrl(userId));
  } catch (error) {
    if (error?.status !== 409) console.error("Google Contatos (Lote de SMS): não foi possível iniciar a conexão:", error?.message || error);
    return NextResponse.redirect(new URL(`${BACK}?google=${error?.status === 409 ? "nao_configurado" : "erro"}`, request.url));
  }
}
