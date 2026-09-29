import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { listCelebrationTriggers, updateCelebrationTrigger, formatCelebrationsError } from "@/lib/celebrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const triggers = await listCelebrationTriggers(auth);
    return NextResponse.json({ triggers });
  } catch (error) {
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}

export async function PATCH(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json();
    const triggers = await updateCelebrationTrigger(payload.key, { enabled: payload.enabled, config: payload.config, animationMode: payload.animationMode }, auth);
    return NextResponse.json({ triggers });
  } catch (error) {
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}
