import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { deleteCcaStatusStage, updateCcaStatusStage } from "@/lib/cca-status-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ stage: await updateCcaStatusStage((await params).id, await request.json(), auth) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await deleteCcaStatusStage((await params).id, auth));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
