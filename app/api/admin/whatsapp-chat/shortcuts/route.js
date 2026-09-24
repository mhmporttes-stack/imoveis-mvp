import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createChatShortcut, listChatShortcuts } from "@/lib/whatsapp-chat";
import { chatErrorResponse } from "../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Atalhos do Chat: todos os usuários do Chat leem; só gestor/admin criam.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const all = new URL(request.url).searchParams.get("all") === "1";
    return NextResponse.json({ shortcuts: await listChatShortcuts({ includeInactive: all }) });
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
      file: file && typeof file !== "string" ? { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type, fileName: file.name } : null
    }, auth);
    return NextResponse.json({ shortcut }, { status: 201 });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
