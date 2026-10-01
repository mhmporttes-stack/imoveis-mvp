import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { adminGetDailyGoalAutoHistory } from "@/lib/daily-goal-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { searchParams } = new URL(request.url);
    const params = {
      brokerId: searchParams.get("brokerId") || null,
      status: searchParams.get("status") || null,
      attemptNumber: searchParams.get("attemptNumber") || null,
      from: searchParams.get("from") || null,
      to: searchParams.get("to") || null,
      scheduled: searchParams.get("scheduled") === "1"
    };
    return NextResponse.json(await adminGetDailyGoalAutoHistory(auth, params));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
