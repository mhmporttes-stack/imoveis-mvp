import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getDailyGoalAutoDefaults, adminUpdateDailyGoalAutoGlobalConfig } from "@/lib/daily-goal-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getDailyGoalAutoDefaults());
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}

export async function PATCH(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const payload = await request.json();
    return NextResponse.json(await adminUpdateDailyGoalAutoGlobalConfig(auth, payload));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
