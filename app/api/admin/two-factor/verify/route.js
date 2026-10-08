import { NextResponse } from "next/server";
import { getAccessTokenFromRequest, requireOwnerPendingSecondFactorApi, setAdminSessionCookies } from "@/lib/admin-auth";
import { setTwoFactorCookies, verifySecondFactor } from "@/lib/admin-two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Etapa do código no login do dono (verificação em duas etapas, regra do dono 2026-10-08). A senha já foi conferida;
// este endpoint só emite a prova do 2º fator (cookie assinado) — nenhum dado do painel é lido aqui.
export async function POST(request) {
  const auth = await requireOwnerPendingSecondFactorApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === "recovery" ? "recovery" : "totp";
    const code = String(body?.code || "").slice(0, 32);
    if (!code.trim()) return NextResponse.json({ error: "Digite o código." }, { status: 400 });

    const accessToken = auth.session?.accessToken || getAccessTokenFromRequest(request);
    const result = await verifySecondFactor(auth.user, { code, mode, remember: body?.remember === true, accessToken });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const response = NextResponse.json({ ok: true });
    if (auth.session) setAdminSessionCookies(response, request, auth.session);
    setTwoFactorCookies(response, request, result.cookies);
    return response;
  } catch (error) {
    console.error("Falha na verificacao em duas etapas.", error?.message || error);
    return NextResponse.json({ error: "Não foi possível conferir o código agora. Tente novamente." }, { status: 500 });
  }
}
