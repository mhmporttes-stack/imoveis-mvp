import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { createWhatsappFlow, listWhatsappFlows } from "@/lib/whatsapp-flows";
import { flowErrorResponse } from "./flow-errors";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ flows: await listWhatsappFlows() });
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível carregar os fluxos.");
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ flow: await createWhatsappFlow(body, auth) }, { status: 201 });
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível criar o fluxo.");
  }
}
