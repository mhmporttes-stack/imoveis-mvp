import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatWhatsappBroadcastError } from "@/lib/whatsapp-broadcasts";
import { createSchedule, listSchedules } from "@/lib/whatsapp-broadcast-schedules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rotinas de disparo (ex.: todo dia às 8h, 30 mensagens da campanha X) — lista com estatísticas (enviados/entregues/
// lidos/respostas por corretor) e criação. A execução em si é o cron (app/api/cron/whatsapp-broadcast-dispatch).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ schedules: await listSchedules(auth) });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}

// Nasce sempre DESATIVADA (enabled: false) — ativar é uma ação separada e explícita.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ schedule: await createSchedule(body, auth) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
