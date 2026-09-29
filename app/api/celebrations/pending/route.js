import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { evaluateAndListPendingCelebrations, formatCelebrationsError } from "@/lib/celebrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Qualquer usuário autenticado — cada um só recebe os PRÓPRIOS eventos
// (evaluateAndListPendingCelebrations é sempre escopado a auth.profile.id).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const pending = await evaluateAndListPendingCelebrations(auth);
    return NextResponse.json({ ok: true, pending });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}
