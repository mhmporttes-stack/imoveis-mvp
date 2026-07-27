import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createTag, listTags } from "@/lib/client-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    return NextResponse.json(await listTags());
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Nao foi possivel carregar as tags." }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const tag = await createTag(await request.json());
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Nao foi possivel criar a tag." }, { status: 400 });
  }
}
