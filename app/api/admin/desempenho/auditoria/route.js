import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { createAttendanceAudit, listAttendanceAudits, suggestNextAuditRange } from "@/lib/attendance-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?brokerId= — histórico de auditorias do corretor + sugestão de próximo
// período (sem sobreposição com a última). Gestor/admin, escopo já checado
// dentro de listAttendanceAudits/suggestNextAuditRange.
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const brokerId = new URL(request.url).searchParams.get("brokerId") || "";
  if (!brokerId) return NextResponse.json({ error: "Informe o corretor." }, { status: 400 });

  try {
    const [history, suggestedRange] = await Promise.all([
      listAttendanceAudits(brokerId, auth),
      suggestNextAuditRange(brokerId, auth)
    ]);
    return NextResponse.json({ history, suggestedRange });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível carregar o histórico." }, { status: error.status || 400 });
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json();
    const audit = await createAttendanceAudit({
      brokerId: String(payload.brokerId || ""),
      startDate: String(payload.startDate || ""),
      endDate: String(payload.endDate || ""),
      auth
    });
    return NextResponse.json({ audit });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível gerar a auditoria." }, { status: error.status || 400 });
  }
}
