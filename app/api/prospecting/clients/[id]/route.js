import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { handleProspectingClientAction } from "@/lib/prospecting";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json(await handleProspectingClientAction((await params).id, body.action, auth, { reasonKey: body.reasonKey, reasonText: body.reasonText }));
  }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
