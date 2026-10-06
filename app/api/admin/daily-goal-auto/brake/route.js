import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { adminReleaseAutoBrake } from "@/lib/daily-goal-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Libera o FREIO AUTOMÁTICO dos envios do WhatsApp de um corretor (REGRA OFICIAL — dono, 2026-10-06). Só admin/gestor
// (gestor só da própria equipe — checado em adminReleaseAutoBrake). A pausa por freio só sai por aqui (ou pelo controle de
// pausa/liga da Meta Diária, que também exige admin/gestor).
export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const state = await adminReleaseAutoBrake(auth, body?.brokerId);
    return NextResponse.json({ released: true, brake: state });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
