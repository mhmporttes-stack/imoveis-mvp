import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { listCelebrationHistory, formatCelebrationsError } from "@/lib/celebrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const brokerId = url.searchParams.get("brokerId") || "";
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";

  try {
    const history = await listCelebrationHistory(auth, { brokerId, startDate, endDate });
    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}
