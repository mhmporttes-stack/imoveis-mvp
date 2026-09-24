import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { getChatSummary } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await getChatSummary());
  } catch (error) {
    return chatErrorResponse(error);
  }
}
