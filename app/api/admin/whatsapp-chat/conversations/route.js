import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { listChatConversations } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = new URL(request.url).searchParams;
  try {
    const conversations = await listChatConversations({
      filter: params.get("filter") || "all",
      query: params.get("q") || "",
      before: params.get("before") || ""
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
