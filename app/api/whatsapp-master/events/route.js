import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { listWhatsappMasterEvents } from "@/lib/whatsapp-master";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const events = await listWhatsappMasterEvents({
      limit: Number(url.searchParams.get("limit")) || 30,
      beforeCreatedAt: url.searchParams.get("before") || ""
    });
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível carregar as mensagens." }, { status: 400 });
  }
}
