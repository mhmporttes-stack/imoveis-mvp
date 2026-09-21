import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createCca, listCca } from "@/lib/cca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const onlyActive = new URL(request.url).searchParams.get("onlyActive") === "1";
    return NextResponse.json({ cca: await listCca(auth, { onlyActive }) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ cca: await createCca(await request.json(), auth) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
