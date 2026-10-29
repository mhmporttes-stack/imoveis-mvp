import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin-auth";
import { ECON_SCHEMA_MESSAGE, getMyAlertPreferences, isMissingEconSchema, setMyAlertPreference } from "@/lib/economic-indicators";
import { ECON_INDICATORS } from "@/lib/economic-indicators-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = z.object({ code: z.enum(ECON_INDICATORS.filter((i) => i.alert).map((i) => i.code)), enabled: z.boolean() });

// Preferências de alerta econômico: SEMPRE do próprio usuário real (em "Alterar conta" não se mexe na preferência de outro,
// mesmo critério da Central de Alertas, lib/crm-alerts.js recipientOf).
function ownerId(auth) {
  return auth.accountSwitchMode ? "" : auth.profile?.id || "";
}

function handle(error, fallback) {
  if (isMissingEconSchema(error)) return NextResponse.json({ error: ECON_SCHEMA_MESSAGE }, { status: 503 });
  console.error(`Alertas econômicos: ${fallback}`, error?.message || error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const me = ownerId(auth);
  if (!me) return NextResponse.json({ preferences: [], readOnly: true });
  try {
    return NextResponse.json({ preferences: await getMyAlertPreferences(me), readOnly: false });
  } catch (error) {
    return handle(error, "Não foi possível carregar as preferências.");
  }
}

export async function PUT(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const me = ownerId(auth);
  if (!me) return NextResponse.json({ error: "Em \"Alterar conta\" as preferências não podem ser mudadas." }, { status: 403 });
  const parsed = BODY.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Preferência inválida." }, { status: 400 });
  try {
    return NextResponse.json({ preferences: await setMyAlertPreference(me, parsed.data.code, parsed.data.enabled), readOnly: false });
  } catch (error) {
    return handle(error, "Não foi possível salvar a preferência.");
  }
}
