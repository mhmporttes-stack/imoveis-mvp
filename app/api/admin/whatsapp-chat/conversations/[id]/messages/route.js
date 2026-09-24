import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { recordAdminHeartbeat } from "@/lib/admin-presence";
import { sendChatMessage } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const message = await sendChatMessage((await params).id, body?.text, auth);
    await recordAdminHeartbeat(auth, { grace: true }).catch(() => {});
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
