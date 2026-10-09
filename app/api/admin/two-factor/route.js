import { NextResponse } from "next/server";
import { getAccessTokenFromRequest, requireRealTwoFactorApi, setAdminSessionCookies } from "@/lib/admin-auth";
import {
  clearTwoFactorCookies,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  getTwoFactorStatus,
  regenerateRecoveryCodes,
  setTwoFactorCookies,
  startTwoFactorEnrollment
} from "@/lib/admin-two-factor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Configuração da verificação em duas etapas (regra do dono, 2026-10-08; gestores em 2026-10-09): só a conta REAL do dono ou
// de um gestor. Quando já está ativada, requireRealTwoFactorApi já exige o 2º fator desta sessão (lib/admin-auth.js).
async function requireOwner(request) {
  return requireRealTwoFactorApi(request);
}

export async function GET(request) {
  const auth = await requireOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getTwoFactorStatus(auth.user.id));
  } catch (error) {
    console.error("Falha ao ler a verificacao em duas etapas.", error?.message || error);
    return NextResponse.json({ error: "Não foi possível carregar a verificação em duas etapas." }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    const mode = body?.mode === "recovery" ? "recovery" : "totp";
    const code = String(body?.code || "").slice(0, 32);
    const accessToken = auth.session?.accessToken || getAccessTokenFromRequest(request);

    if (action === "start") return finish(request, auth, await startTwoFactorEnrollment(auth.user));
    if (!code.trim()) return NextResponse.json({ error: "Digite o código." }, { status: 400 });
    if (action === "confirm") return finish(request, auth, await confirmTwoFactorEnrollment(auth.user, code, accessToken));
    if (action === "regenerate") return finish(request, auth, await regenerateRecoveryCodes(auth.user, { code, mode, accessToken }));
    if (action === "disable") {
      const result = await disableTwoFactor(auth.user, { code, mode });
      const response = finish(request, auth, result);
      if (result.ok) clearTwoFactorCookies(response, request, { includeDevice: true });
      return response;
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    console.error("Falha na configuracao da verificacao em duas etapas.", error?.message || error);
    return NextResponse.json({ error: "Não foi possível concluir agora. Tente novamente." }, { status: 500 });
  }
}

function finish(request, auth, result) {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { cookies, ...payload } = result;
  const response = NextResponse.json(payload);
  if (auth.session) setAdminSessionCookies(response, request, auth.session);
  if (cookies) setTwoFactorCookies(response, request, cookies);
  return response;
}
