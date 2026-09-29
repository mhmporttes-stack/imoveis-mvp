import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { markCelebrationShown, formatCelebrationsError } from "@/lib/celebrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    await markCelebrationShown(auth, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}
