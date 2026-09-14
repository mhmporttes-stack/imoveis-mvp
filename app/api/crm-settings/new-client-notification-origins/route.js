import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getNewClientNotificationSettings, updateNewClientNotificationSettings } from "@/lib/crm-automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await getNewClientNotificationSettings()); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
}

export async function PATCH(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json(await updateNewClientNotificationSettings(body, auth));
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
