import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { getOfficialAdFlowSettingsView, saveOfficialAdFlowConfig } from "@/lib/official-ad-flow";
import { listKeepaliveToday } from "@/lib/official-window-keepalive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Configuração do "Fluxo do anúncio no número Oficial" (dono, 2026-11-10 — WA-40): liga/desliga, tempos, horário, participantes e
// rodízio, imóveis sugeridos. Só admin e gestor (requireBrokerManagementApi). GET também devolve o "Bom dia de hoje" por corretor.
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const [view, keepalive] = await Promise.all([getOfficialAdFlowSettingsView(), listKeepaliveToday().catch((error) => {
      console.error("Falha ao listar o bom dia de hoje:", error?.message || error);
      return { day: "", items: [], error: "Não foi possível carregar o bom dia de hoje." };
    })]);
    return NextResponse.json({ ...view, keepalive });
  } catch (error) {
    console.error("Falha ao carregar a configuração do fluxo do anúncio:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível carregar a configuração." }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie uma configuração válida." }, { status: 400 });
  }
  try {
    return NextResponse.json({ config: await saveOfficialAdFlowConfig(body?.config, auth) });
  } catch (error) {
    console.error("Falha ao salvar a configuração do fluxo do anúncio:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar a configuração." }, { status: 500 });
  }
}
