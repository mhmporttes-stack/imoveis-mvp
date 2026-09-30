import { NextResponse } from "next/server";
import { completeGoogleOAuthConnection } from "@/lib/google-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// O Google redireciona pra cá depois do consentimento (GOOGLE_CONTACTS_REDIRECT_URI
// precisa apontar exatamente pra esta rota). O "state" já identifica QUAL
// corretor iniciou (assinado em buildGoogleAuthUrl/lib/google-contacts.js) —
// não depende de sessão/cookie aqui, então funciona mesmo se o Google abrir
// numa aba nova. Sempre volta pro CRM (nunca deixa o navegador preso no
// Google em caso de erro).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL(`/admin?googleContacts=cancelado`, request.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(`/admin?googleContacts=erro`, request.url));
  }

  try {
    await completeGoogleOAuthConnection({ code, state });
    return NextResponse.redirect(new URL(`/admin?googleContacts=conectado`, request.url));
  } catch (error) {
    console.error("Falha ao concluir a conexão do Google Contacts:", error?.message || error);
    return NextResponse.redirect(new URL(`/admin?googleContacts=erro`, request.url));
  }
}
