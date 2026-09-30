import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getDailyGoalAutoStatus } from "@/lib/daily-goal-auto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Só leitura — o corretor não liga/pausa mais a própria automação (pedido do
// dono, 2026-09-30, ver components/DailyGoalAutoPanel.jsx). O POST que
// existia aqui (action: enable/disable/pause/resume) foi removido de
// propósito: mesmo que a UI já não mostre esses botões, a barreira real
// precisa estar no servidor (regra do projeto — a tela escondendo um botão
// nunca é a barreira de autorização). Controle passou a ser 100% do admin/
// gestor, via /api/admin/daily-goal-auto (adminSetDailyGoalAutoEnabled/
// adminSetDailyGoalAutoPaused).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getDailyGoalAutoStatus(auth));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error?.status || 400 });
  }
}
