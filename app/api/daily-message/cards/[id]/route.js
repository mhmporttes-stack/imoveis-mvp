import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { updateDailyMessageCard } from "@/lib/daily-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  try {
    const payload = await request.json();
    const card = await updateDailyMessageCard(id, payload, auth);
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível atualizar o card." }, { status: error?.status || 400 });
  }
}
