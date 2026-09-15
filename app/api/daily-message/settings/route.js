import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { getDailyMessageSettings, updateDailyMessageSettings } from "@/lib/daily-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getDailyMessageSettings());
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PATCH(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const payload = await request.json();
    return NextResponse.json(await updateDailyMessageSettings(payload, auth));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível salvar a configuração." }, { status: error?.status || 400 });
  }
}
