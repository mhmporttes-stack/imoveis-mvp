import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatWhatsappBroadcastError } from "@/lib/whatsapp-broadcasts";
import { deleteSchedule, updateSchedule } from "@/lib/whatsapp-broadcast-schedules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Editar (inclusive ativar/pausar/religar) ou excluir uma rotina de disparo.
export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ schedule: await updateSchedule((await params).id, body, auth) });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await deleteSchedule((await params).id, auth));
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
