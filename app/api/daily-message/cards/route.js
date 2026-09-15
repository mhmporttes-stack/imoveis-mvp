import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { createDailyMessageCard, listDailyMessageCards } from "@/lib/daily-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const url = new URL(request.url);
    const cards = await listDailyMessageCards({
      search: url.searchParams.get("search") || "",
      type: url.searchParams.get("type") || "all",
      status: url.searchParams.get("status") || "all"
    }, auth);
    return NextResponse.json({ ok: true, cards });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível listar os cards." }, { status: error?.status || 400 });
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const payload = await request.json();
    const card = await createDailyMessageCard(payload, auth);
    return NextResponse.json({ ok: true, card }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível criar o card." }, { status: error?.status || 400 });
  }
}
