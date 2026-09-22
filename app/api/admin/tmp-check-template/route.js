import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { listWhatsappMessageTemplates } from "@/lib/whatsapp-master";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const templates = await listWhatsappMessageTemplates();
    return NextResponse.json({ count: templates.length, templates: templates.map((t) => ({ id: t.id, name: t.name, language: t.language, status: t.status, category: t.category })) });
  } catch (error) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
