import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recordAdminHeartbeat } from "@/lib/admin-presence";
import { sendChatMedia, sendUploadedChatMedia } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anexo (foto, vídeo, GIF, figurinha, PDF, áudio gravado) enviado pelo
// atendente. Dois formatos:
//  - multipart (arquivo até ~4 MB, limite da Vercel — fotos já reduzidas no navegador);
//  - JSON {path, mimeType, fileName, caption, asGif} para arquivo que o
//    navegador já enviou direto ao storage (vídeo até 16 MB, ver upload-target).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const id = (await params).id;
    let message;
    if ((request.headers.get("content-type") || "").includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      message = await sendUploadedChatMedia(id, {
        path: body?.path,
        mimeType: body?.mimeType,
        fileName: body?.fileName,
        caption: String(body?.caption || ""),
        asGif: body?.asGif === true
      }, auth);
    } else {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") return NextResponse.json({ error: "Envie um arquivo." }, { status: 400 });
      const buffer = Buffer.from(await file.arrayBuffer());
      message = await sendChatMedia(id, {
        buffer,
        mimeType: file.type,
        fileName: file.name,
        caption: String(form.get("caption") || ""),
        asGif: form.get("asGif") === "1"
      }, auth);
    }
    await recordAdminHeartbeat(auth, { grace: true }).catch(() => {});
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
