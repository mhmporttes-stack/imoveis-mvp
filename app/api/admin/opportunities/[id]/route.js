import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getOpportunityDetail } from "@/lib/opportunities";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    const opportunity = await getOpportunityDetail(id, auth);
    if (!opportunity) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    return NextResponse.json({ opportunity });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível carregar a oportunidade." }, { status: error?.status || 400 });
  }
}
