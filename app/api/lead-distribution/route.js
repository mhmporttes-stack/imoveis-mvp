import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { reorderLeadDistribution } from "@/lib/lead-distribution";
import { listLeadDistributionDashboard } from "@/lib/lead-distribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await listLeadDistributionDashboard());
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível carregar a roleta." }, { status: 400 });
  }
}

export async function PATCH(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { order } = await request.json();
    return NextResponse.json({ order: await reorderLeadDistribution(order) });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível reorganizar a fila." }, { status: 400 });
  }
}
