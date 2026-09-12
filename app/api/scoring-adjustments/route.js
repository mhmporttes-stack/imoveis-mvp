import { NextResponse } from "next/server";
import { requireBrokerManagementApi, requireGeneralAdminApi } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";
import { createManualAdjustment, formatScoringRulesError, listManualAdjustments } from "@/lib/scoring-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const brokerIds = isGeneralAdminAuth(auth)
      ? null
      : (isManagerProfile(auth.profile) ? (auth.profile.managedUserIds || [auth.profile.id]) : [auth.profile.id]);

    const adjustments = await listManualAdjustments(auth, { brokerIds, limit: 100 });
    return NextResponse.json({ adjustments });
  } catch (error) {
    return NextResponse.json({ error: formatScoringRulesError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request, "Apenas o administrador geral pode lançar ajustes manuais de pontuação.");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const payload = await request.json();
    const adjustment = await createManualAdjustment({
      brokerId: payload.brokerId,
      points: payload.type === "remove" ? -Math.abs(Number(payload.points)) : Math.abs(Number(payload.points)),
      reason: payload.reason
    }, auth);
    return NextResponse.json({ adjustment });
  } catch (error) {
    return NextResponse.json({ error: formatScoringRulesError(error) }, { status: 400 });
  }
}
