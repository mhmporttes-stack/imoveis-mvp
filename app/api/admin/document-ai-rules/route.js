import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { listDocumentAiRules, saveDocumentAiRule } from "@/lib/document-ai-rules";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json({ rules: await listDocumentAiRules() }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
}

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json({ rule: await saveDocumentAiRule(await request.json(), auth) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
}
