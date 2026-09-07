import { NextResponse } from "next/server";
import {
  ADMIN_VIEW_AS_COOKIE,
  requireRealGeneralAdminApi
} from "@/lib/admin-auth";
import { getAdminProfileById, isActiveAdminProfile } from "@/lib/admin-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { profileId } = await request.json();
  const profile = await getAdminProfileById(profileId);
  if (!profile || !isActiveAdminProfile(profile)) {
    return NextResponse.json({ error: "Selecione um usuario ativo." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, redirectTo: landingPath(profile.role) });
  response.cookies.set(ADMIN_VIEW_AS_COOKIE, profile.id, cookieOptions(request));
  return response;
}

export async function DELETE(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_VIEW_AS_COOKIE, "", { ...cookieOptions(request), maxAge: 0 });
  return response;
}

function cookieOptions(request) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: request.nextUrl?.protocol === "https:" || process.env.VERCEL === "1"
  };
}

function landingPath(role) {
  if (role === "manager") return "/admin/simulacoes";
  if (role === "admin") return "/admin/corretores";
  return "/admin/simulacoes";
}
