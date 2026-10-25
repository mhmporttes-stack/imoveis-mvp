import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { runTransferStatusBackfill } from "@/lib/transfer-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ajuste dos transferidos ATUAIS (REGRA OFICIAL — dono, 2026-10-25): transferidos ainda sem atendimento do novo
// responsável (mesma definição do card "Novos atendimentos", CLI-7b) vão para "Tentando contato" + etiqueta do status
// anterior. Só admin geral REAL (fora de "Alterar conta"). GET = só conta (nada é gravado). POST com
// { "confirm": "aplicar" } aplica (idempotente).
export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await runTransferStatusBackfill({ apply: false }));
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível contar os transferidos." }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== "aplicar") return NextResponse.json({ error: "Envie { \"confirm\": \"aplicar\" } para aplicar." }, { status: 400 });
  try {
    return NextResponse.json(await runTransferStatusBackfill({ apply: true }));
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível aplicar a regra aos transferidos." }, { status: 500 });
  }
}
