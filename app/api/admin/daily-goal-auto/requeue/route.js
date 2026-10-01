import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { adminRequeueBrokerQueue } from "@/lib/daily-goal-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reorganiza a fila de disparos de hoje de 1 corretor — pedido do dono,
// 2026-10-02 (botão no card da Supervisão > Meta Diária).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const result = await adminRequeueBrokerQueue(auth, body.brokerId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
