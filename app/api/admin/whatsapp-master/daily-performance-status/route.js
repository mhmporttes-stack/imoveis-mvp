import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertOwnerAdmin } from "@/lib/admin-access";
import { getDailyGoalPerformanceWhatsappStatus } from "@/lib/daily-goal-performance-whatsapp";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    assertOwnerAdmin(auth);
    const status = await getDailyGoalPerformanceWhatsappStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível consultar o status." }, { status: error?.status || 400 });
  }
}
