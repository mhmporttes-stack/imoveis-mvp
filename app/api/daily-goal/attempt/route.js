import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatDailyGoalError, registerDailyGoalAttempt } from "@/lib/daily-goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await registerDailyGoalAttempt(body?.roundId, body?.message, auth));
  } catch (error) {
    return NextResponse.json({ error: formatDailyGoalError(error) }, { status: error?.status || 400 });
  }
}
