import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { completeDailyMessage } from "@/lib/daily-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { historyId } = await params;
  try {
    const completed = await completeDailyMessage(historyId, auth);
    return NextResponse.json({ ok: true, completed });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível registrar a conclusão." }, { status: 400 });
  }
}
