import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { claimProspectingContact, deleteProspectingContact, getProspectingHistory, updateProspectingContact } from "@/lib/prospecting";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await getProspectingHistory((await params).id, auth)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await claimProspectingContact((await params).id, auth)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 409 }); }
}
export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await updateProspectingContact((await params).id, await request.json(), auth)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { await deleteProspectingContact((await params).id, auth); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
