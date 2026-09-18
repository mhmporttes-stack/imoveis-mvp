import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatDailyGoalError, getDailyGoalSettings, updateDailyGoalMessages, updateDailyGoalQuota, updateDailyGoalWalletConfig } from "@/lib/daily-goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getDailyGoalSettings(auth));
  } catch (error) {
    return NextResponse.json({ error: formatDailyGoalError(error) }, { status: error?.status || 400 });
  }
}

export async function PATCH(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    if (body.quota !== undefined) await updateDailyGoalQuota(body.quota, auth);
    if (body.messages !== undefined) await updateDailyGoalMessages(body.messages, auth);
    if (body.wallet !== undefined) await updateDailyGoalWalletConfig(body.wallet, auth);
    return NextResponse.json(await getDailyGoalSettings(auth));
  } catch (error) {
    return NextResponse.json({ error: formatDailyGoalError(error) }, { status: error?.status || 400 });
  }
}
