import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listBrokerBasesSummary } from "@/lib/prospecting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await listBrokerBasesSummary(auth)); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
