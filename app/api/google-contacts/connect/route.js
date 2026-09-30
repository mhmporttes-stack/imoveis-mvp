import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { buildGoogleAuthUrl } from "@/lib/google-contacts";
import { isGoogleContactsConfigured } from "@/lib/google-contacts-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Navegação direta do navegador (link/clique em "Conectar Google", não
// fetch) — redireciona pra tela de consentimento do PRÓPRIO Google, sempre
// pro corretor logado (nunca aceita brokerId de fora).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.redirect(new URL("/admin/login", request.url));
  const brokerId = auth.profile?.id;
  if (!brokerId) return NextResponse.redirect(new URL("/admin?googleContacts=erro", request.url));

  if (!isGoogleContactsConfigured()) {
    return NextResponse.redirect(new URL("/admin?googleContacts=nao_configurado", request.url));
  }

  return NextResponse.redirect(buildGoogleAuthUrl(brokerId));
}
