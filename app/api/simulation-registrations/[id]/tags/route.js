import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { setClientTags } from "@/lib/client-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const tagIds = Array.isArray(body.tagIds) ? body.tagIds : [];
    await setClientTags((await params).id, tagIds);
    return NextResponse.json({ ok: true, tagIds });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Nao foi possivel atualizar as tags." }, { status: 400 });
  }
}
