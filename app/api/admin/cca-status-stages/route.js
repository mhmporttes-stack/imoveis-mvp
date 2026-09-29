import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createCcaStatusStage, listCcaStatusStages } from "@/lib/cca-status-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const onlyActive = new URL(request.url).searchParams.get("onlyActive") === "1";
    return NextResponse.json({ stages: await listCcaStatusStages(auth, { onlyActive }) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ stage: await createCcaStatusStage(await request.json(), auth) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
