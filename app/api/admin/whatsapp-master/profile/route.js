import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getWhatsappBusinessProfile, updateWhatsappBusinessProfile, WhatsappProfileError } from "@/lib/whatsapp-profile";

export const runtime = "nodejs";

function errorResponse(error, fallback) {
  const status = error instanceof WhatsappProfileError ? error.status : 500;
  return NextResponse.json({ error: error instanceof WhatsappProfileError ? error.message : fallback }, { status });
}

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json({ profile: await getWhatsappBusinessProfile() });
  } catch (error) {
    return errorResponse(error, "Não foi possível carregar o perfil do WhatsApp.");
  }
}

export async function PATCH(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ profile: await updateWhatsappBusinessProfile(body) });
  } catch (error) {
    return errorResponse(error, "Não foi possível salvar o perfil do WhatsApp.");
  }
}
