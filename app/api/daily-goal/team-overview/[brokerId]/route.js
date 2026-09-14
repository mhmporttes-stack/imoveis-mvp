import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatDailyGoalError, getOwnerBrokerDailyDetail } from "@/lib/daily-goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { brokerId } = await params;
    const url = new URL(request.url);
    const queryParams = { period: url.searchParams.get("period") || "today" };
    return NextResponse.json(await getOwnerBrokerDailyDetail(brokerId, queryParams, auth));
  } catch (error) {
    return NextResponse.json({ error: formatDailyGoalError(error) }, { status: error?.status || 400 });
  }
}
