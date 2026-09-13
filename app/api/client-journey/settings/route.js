import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { saveJourneySettings } from "@/lib/client-journey";
export async function PUT(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await saveJourneySettings(await request.json(), auth)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error.status === 403 ? 403 : 400 }); }
}
