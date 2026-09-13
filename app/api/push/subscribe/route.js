import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { savePushSubscription } from "@/lib/push-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    await savePushSubscription({
      userId: auth.profile?.id,
      endpoint: body?.endpoint,
      keys: body?.keys,
      userAgent: request.headers.get("user-agent") || ""
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao salvar assinatura de push." }, { status: 400 });
  }
}
