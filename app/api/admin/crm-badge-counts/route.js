import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getCrmPendingCounts } from "@/lib/crm-pending-counts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await getCrmPendingCounts(auth));
  } catch (error) {
    console.error("Erro ao contar pendências do CRM:", error);
    return NextResponse.json({ error: "Não foi possível contar as pendências." }, { status: 500 });
  }
}
