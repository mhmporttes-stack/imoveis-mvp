import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { markCrmNotificationRead } from "@/lib/crm";

export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const notification = await markCrmNotificationRead((await params).id, auth);
    return NextResponse.json({ notification });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível atualizar a notificação." }, { status: 400 });
  }
}
