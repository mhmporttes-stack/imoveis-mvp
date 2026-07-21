import { NextResponse } from "next/server";
import {
  clearAdminSessionCookies,
  requireAdminApi,
  setAdminSessionCookies,
  verifyAdminAccessToken
} from "@/lib/admin-auth";

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

    const response = NextResponse.json({ ok: true, user: { email: result.user.email } });
    setAdminSessionCookies(response, request, { accessToken, refreshToken });
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
  const response = NextResponse.json({ error: result.error }, { status: result.status });
  clearAdminSessionCookies(response, request);
  return response;
}
