import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { saveDocumentAiRule, deleteDocumentAiRule } from "@/lib/document-ai-rules";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json({ rule: await saveDocumentAiRule(await request.json(), auth, (await params).id) }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
}

export async function DELETE(request, { params }) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { await deleteDocumentAiRule((await params).id, auth); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
}
