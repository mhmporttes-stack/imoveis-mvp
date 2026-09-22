import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { createWhatsappAutomationReply, listWhatsappAutomationReplies } from "@/lib/whatsapp-automation-replies";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ rules: await listWhatsappAutomationReplies() });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível carregar as regras." }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const rule = await createWhatsappAutomationReply(await request.json(), auth);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível criar a regra." }, { status: 400 });
  }
}
