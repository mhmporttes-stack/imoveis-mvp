import { NextResponse } from "next/server";
import {
  isOwnerAdminEmail,
  clearAdminSessionCookies,
  clearAdminViewAsCookie,
  requireAdminApi,
  setAdminSessionCookies,
  verifyAdminAccessToken
} from "@/lib/admin-auth";
import { TWO_FACTOR_DEVICE_COOKIE, checkOwnerSecondFactor, clearTwoFactorCookies } from "@/lib/admin-two-factor";
import { TWO_FACTOR_REQUIRED_CODE, isSecondFactorMissing } from "@/lib/admin-two-factor-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const result = await requireAdminApi(request);
  if (!result.ok) {
    return authErrorResponse(result, request);
  }

  const response = NextResponse.json({ ok: true, user: { email: result.user.email } });

  if (result.session) {
    setAdminSessionCookies(response, request, result.session);
  }

  return response;
}

export async function POST(request) {
  try {
    const { accessToken, refreshToken } = await request.json();
    const result = await verifyAdminAccessToken(accessToken);

    if (!result.ok) {
      return authErrorResponse(result, request);
    }

    // Dono com verificação em duas etapas ativada: a senha abre só a etapa do código (os guards de lib/admin-auth.js
    // barram o painel até lá). Aparelho lembrado por 30 dias entra direto.
    let twoFactorRequired = false;
    if (isOwnerAdminEmail(result.user.email)) {
      const check = await checkOwnerSecondFactor({
        userId: result.user.id,
        accessToken,
        sessionProof: "",
        deviceProof: request.cookies.get(TWO_FACTOR_DEVICE_COOKIE)?.value || ""
      });
      if (check.error) return NextResponse.json({ error: check.error }, { status: 503 });
      twoFactorRequired = isSecondFactorMissing({ isOwner: true, ...check });
    }

    const response = NextResponse.json({ ok: true, twoFactorRequired, user: { email: result.user.email } });
    setAdminSessionCookies(response, request, { accessToken, refreshToken });
    clearAdminViewAsCookie(response, request);
    clearTwoFactorCookies(response, request);
    return response;
  } catch {
    return NextResponse.json({ error: "Nao foi possivel iniciar a sessao administrativa." }, { status: 400 });
  }
}

export async function DELETE(request) {
  const response = NextResponse.json({ ok: true });
  clearAdminSessionCookies(response, request);
  return response;
}

function authErrorResponse(result, request) {
  // Etapa do código pendente: mantém a sessão da senha para a tela de verificação (não é logout).
  if (result.code === TWO_FACTOR_REQUIRED_CODE) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  const response = NextResponse.json({ error: result.error }, { status: result.status });
  clearAdminSessionCookies(response, request);
  return response;
}
