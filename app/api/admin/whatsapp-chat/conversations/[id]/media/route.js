import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recordAdminHeartbeat } from "@/lib/admin-presence";
import { sendChatMedia } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anexo (foto, PDF, áudio gravado) enviado pelo atendente. Corpo até ~4 MB
// (limite da Vercel) — o navegador já reduz fotos antes de enviar.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Envie um arquivo." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const message = await sendChatMedia((await params).id, {
      buffer,
      mimeType: file.type,
      fileName: file.name,
      caption: String(form.get("caption") || "")
    }, auth);
    await recordAdminHeartbeat(auth, { grace: true }).catch(() => {});
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
