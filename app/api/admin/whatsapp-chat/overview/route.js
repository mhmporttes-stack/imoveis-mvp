import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getChatOverview } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = new URL(request.url).searchParams;
  try {
    return NextResponse.json(await getChatOverview({
      brokerId: params.get("broker") || "",
      situation: params.get("situation") || "",
      query: params.get("q") || ""
    }, auth));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
