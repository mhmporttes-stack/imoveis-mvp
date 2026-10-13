import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getAdsBoard } from "@/lib/meta-ads-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS = new Set(["today", "7d", "30d"]);

// Área Anúncios — somente leitura (só administrador geral).
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request, "Apenas o administrador geral pode ver os anúncios.");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const period = new URL(request.url).searchParams.get("period");
    const data = await getAdsBoard({ period: PERIODS.has(period) ? period : "7d" });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Falha ao carregar a área Anúncios.", error);
    return NextResponse.json({ error: error?.message || "Não foi possível carregar os anúncios." }, { status: 500 });
  }
}
