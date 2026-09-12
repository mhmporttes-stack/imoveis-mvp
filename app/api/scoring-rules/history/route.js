import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { formatScoringRulesError, listScoringRuleHistory } from "@/lib/scoring-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const history = await listScoringRuleHistory(auth);
    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json({ error: formatScoringRulesError(error) }, { status: 400 });
  }
}
