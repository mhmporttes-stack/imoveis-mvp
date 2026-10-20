import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getMarketplaceChatSettings, saveMarketplaceChatSettings } from "@/lib/marketplace-chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Liga/desliga a sincronização, horário e limite de envios por hora — só o administrador geral (o dono).
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ settings: await getMarketplaceChatSettings() });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar a configuração." }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  try {
    return NextResponse.json({ settings: await saveMarketplaceChatSettings(body, auth) });
  } catch {
    return NextResponse.json({ error: "Não foi possível salvar a configuração." }, { status: 500 });
  }
}
