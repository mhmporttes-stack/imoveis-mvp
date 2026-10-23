import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createChatShortcut, listChatShortcuts } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Atalhos do Chat: todos os usuários do Chat leem; só gestor/admin criam. ?chat=marketplace lista só os de texto do Chat do
// Marketplace (MKT-2f); sem ?chat, os do Chat do WhatsApp; ?all=1 (gestão) todos, de qualquer canal.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const params = new URL(request.url).searchParams;
    const all = params.get("all") === "1";
    const chat = all ? "" : params.get("chat") === "marketplace" ? "marketplace" : "whatsapp";
    return NextResponse.json({ shortcuts: await listChatShortcuts({ includeInactive: all, chat }) });
  } catch (error) {
    return chatErrorResponse(error);
  }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const form = await request.formData();
    const file = form.get("file");
    const shortcut = await createChatShortcut({
      label: String(form.get("label") || ""),
      kind: String(form.get("kind") || ""),
      body: String(form.get("body") || ""),
      channel: String(form.get("channel") || "whatsapp"),
      file: file && typeof file !== "string" ? { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type, fileName: file.name } : null
    }, auth);
    return NextResponse.json({ shortcut }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
