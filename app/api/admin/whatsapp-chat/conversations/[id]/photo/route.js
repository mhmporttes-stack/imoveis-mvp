import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getChatContactPhotoUrl } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Foto de perfil do contato (guardada no Storage privado): redireciona para uma URL assinada curta.
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = await getChatContactPhotoUrl((await params).id, auth);
    if (!url) return NextResponse.json({ error: "Sem foto." }, { status: 404 });
    const response = NextResponse.redirect(url, 302);
    response.headers.set("Cache-Control", "private, max-age=1800");
    return response;
  } catch (error) {
    return chatErrorResponse(error);
  }
}
