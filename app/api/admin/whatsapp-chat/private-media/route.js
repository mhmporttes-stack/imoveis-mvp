import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listPrivateMediaGallery } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Aba "Mídias" de Particular (WA-35, dono 2026-10-23). Login aqui; a barreira de quem vê (administrador geral, como
// para abrir Particular) fica em listPrivateMediaGallery — 403 para os demais.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await listPrivateMediaGallery(auth, {
      type: params.get("type") || "",
      brokerId: params.get("broker") || "",
      cursor: params.get("cursor") || ""
    }));
  } catch (error) {
    return chatErrorResponse(error);
  }
}
