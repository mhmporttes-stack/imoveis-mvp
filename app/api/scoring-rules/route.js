import { NextResponse } from "next/server";
import { requireBrokerManagementApi, requireGeneralAdminApi } from "@/lib/admin-auth";
import { formatScoringRulesError, listCurrentScoringRules, updateScoringRule } from "@/lib/scoring-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rules = await listCurrentScoringRules(auth);
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json({ error: formatScoringRulesError(error) }, { status: 400 });
  }
}

export async function PATCH(request) {
  const auth = await requireGeneralAdminApi(request, "Apenas o administrador geral pode alterar regras de pontuação.");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const payload = await request.json();
    const rules = await updateScoringRule(payload.ruleKey, { points: payload.points, active: payload.active }, auth);
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json({ error: formatScoringRulesError(error) }, { status: 400 });
  }
}
