import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getAlexaEnvStatus, loadAlexaSettings, saveAlexaSettings } from "@/lib/alexa-service";
import { AlexaSettingsError } from "@/lib/alexa-config-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Só o administrador geral lê ou altera a Alexa. A resposta nunca inclui
// token nem ID do dispositivo — apenas se estão configurados (booleanos).
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { settings, meta } = await loadAlexaSettings();
    return NextResponse.json({ settings, meta, env: getAlexaEnvStatus() });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar a configuração da Alexa." }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie uma configuração válida." }, { status: 400 });
  }
  try {
    const settings = await saveAlexaSettings(body, auth.profile?.id || null);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AlexaSettingsError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível salvar a configuração da Alexa." }, { status: 500 });
  }
}
