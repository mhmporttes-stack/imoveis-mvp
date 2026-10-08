import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { WhatsappRegisterError, getNumberRegistrationStatus, registerNumber } from "@/lib/whatsapp-register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(error, fallback) {
  const known = error instanceof WhatsappRegisterError;
  return NextResponse.json({ error: known ? error.message : fallback }, { status: known ? error.status : 500, headers: NO_STORE });
}

// Estado do registro do número oficial (somente administrador geral).
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ registration: await getNumberRegistrationStatus() }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Não foi possível consultar o número na Meta.");
  }
}

// Registra o número na Cloud API com o PIN de 6 dígitos que o dono digitou (o PIN não é gravado nem registrado em log).
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ registration: await registerNumber(body?.pin) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Não foi possível registrar o número.");
  }
}
