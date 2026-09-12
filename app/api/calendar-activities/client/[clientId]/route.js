import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listCalendarActivitiesForClient } from "@/lib/calendar-activities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { clientId } = await params;
    const activities = await listCalendarActivitiesForClient(clientId, auth);
    return NextResponse.json({ activities });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível carregar as atividades do cliente." }, { status: 400 });
  }
}
