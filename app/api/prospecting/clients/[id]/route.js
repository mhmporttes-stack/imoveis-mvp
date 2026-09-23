import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recordAdminGrace } from "@/lib/admin-presence";
import { handleProspectingClientAction } from "@/lib/prospecting";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const result = await handleProspectingClientAction((await params).id, body.action, auth, { reasonKey: body.reasonKey, reasonText: body.reasonText });
    if (body.action === "prospect") await recordAdminGrace(auth);
    return NextResponse.json(result);
  }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
