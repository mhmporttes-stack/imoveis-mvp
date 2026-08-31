import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getWhatsappMasterSettings, updateWhatsappMasterSettings } from "@/lib/crm";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json({ settings: await getWhatsappMasterSettings() });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível carregar a configuração." }, { status: 400 });
  }
}

export async function PATCH(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json();
    return NextResponse.json({ settings: await updateWhatsappMasterSettings(payload, auth) });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível salvar a configuração." }, { status: 400 });
  }
}
