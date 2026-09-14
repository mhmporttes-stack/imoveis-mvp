import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatDailyGoalError, getBrokerDailyGoal } from "@/lib/daily-goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getBrokerDailyGoal(auth));
  } catch (error) {
    return NextResponse.json({ error: formatDailyGoalError(error) }, { status: error?.status || 400 });
  }
}
