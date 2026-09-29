import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { createManualCelebration, formatCelebrationsError } from "@/lib/celebrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json();
    await createManualCelebration(auth, {
      brokerId: payload.brokerId,
      templateId: payload.templateId,
      freeText: payload.freeText,
      animation: payload.animation
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}
