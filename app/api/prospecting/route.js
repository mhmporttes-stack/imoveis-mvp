import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { importProspectingContacts, listProspectingContacts } from "@/lib/prospecting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const scope = new URL(request.url).searchParams.get("scope") === "mine" ? "mine" : "company";
  try { return NextResponse.json(await listProspectingContacts(auth, scope)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const scope = body.scope === "mine" ? "mine" : "company";
    return NextResponse.json(await importProspectingContacts(body.rows, auth, scope));
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
