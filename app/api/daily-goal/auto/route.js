import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getDailyGoalAutoStatus, setDailyGoalAutoEnabled, setDailyGoalAutoPausedByBroker } from "@/lib/daily-goal-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getDailyGoalAutoStatus(auth));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}

// action: "enable" | "disable" | "pause" | "resume"
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { action } = await request.json();
    if (action === "enable") return NextResponse.json(await setDailyGoalAutoEnabled(auth, true));
    if (action === "disable") return NextResponse.json(await setDailyGoalAutoEnabled(auth, false));
    if (action === "pause") return NextResponse.json(await setDailyGoalAutoPausedByBroker(auth, true));
    if (action === "resume") return NextResponse.json(await setDailyGoalAutoPausedByBroker(auth, false));
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
