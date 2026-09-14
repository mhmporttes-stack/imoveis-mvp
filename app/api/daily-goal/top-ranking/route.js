import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatDailyGoalError, getDailyGoalTopRanking } from "@/lib/daily-goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sem restrição de admin/gestor de propósito: o widget "Top 1 do dia" é
// global e precisa aparecer para qualquer corretor autenticado.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const ranking = await getDailyGoalTopRanking(auth);
    return NextResponse.json(ranking);
  } catch (error) {
    return NextResponse.json({ error: formatDailyGoalError(error) }, { status: error?.status || 400 });
  }
}
