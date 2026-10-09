import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getChatContactPresence } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Online / visto por último" do contato (só WhatsApp pessoal conectado; o número oficial não informa).
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await getChatContactPresence((await params).id, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
