import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { adminListDailyGoalAutoSettings, adminSetDailyGoalAutoPaused, adminSetDailyGoalAutoEnabled, adminSetBrokerDailyCapOverride, adminSetBrokerPolicyV2, adminResumeDailyGoalAutoSlot } from "@/lib/daily-goal-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ brokers: await adminListDailyGoalAutoSettings(auth) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}

export async function PATCH(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    if (body.brokerId && "resumeSlot" in body) {
      // Retoma UM número pausado por 403/logout (admin ou gestora da equipe — checado na função).
      await adminResumeDailyGoalAutoSlot(auth, body.brokerId, body.resumeSlot);
    } else if (body.brokerId && "policyV2Enabled" in body) {
      // Chave da política nova de disparos por corretor — só administrador geral (checado em adminSetBrokerPolicyV2).
      await adminSetBrokerPolicyV2(auth, body.brokerId, body.policyV2Enabled === true);
    } else if (body.brokerId && "enabled" in body) {
      await adminSetDailyGoalAutoEnabled(auth, body.brokerId, body.enabled);
    } else if (body.brokerId && "dailyCapOverride" in body && !("paused" in body)) {
      await adminSetBrokerDailyCapOverride(auth, body.brokerId, body.dailyCapOverride);
    } else {
      await adminSetDailyGoalAutoPaused(auth, body.brokerId, body.paused, body.reason);
    }
    return NextResponse.json({ brokers: await adminListDailyGoalAutoSettings(auth) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
