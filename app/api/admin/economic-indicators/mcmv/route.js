import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { isAdminPermissionError } from "@/lib/admin-access";
import { getMcmvSettings, saveMcmvSettings } from "@/lib/economic-indicators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MCMV no Radar Econômico (dono, 2026-10-29 — ECON-2): faixas/teto cadastrados à mão, só pelo administrador geral.
// Os demais perfis só veem o que o Radar mostra (/api/admin/economic-indicators/radar).
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ mcmv: await getMcmvSettings() });
  } catch (error) {
    console.error("Radar Econômico: falha ao ler o MCMV:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível carregar o cadastro do MCMV." }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    const result = await saveMcmvSettings(body, auth);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ mcmv: result.value });
  } catch (error) {
    if (isAdminPermissionError(error)) return NextResponse.json({ error: error.message }, { status: 403 });
    console.error("Radar Econômico: falha ao salvar o MCMV:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar o cadastro do MCMV." }, { status: 500 });
  }
}
