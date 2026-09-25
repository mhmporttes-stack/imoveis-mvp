import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { createGuide, listGuides } from "@/lib/attendance-guides";
import { guideErrorResponse } from "./guide-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gestão do Guia de Atendimento: só admin e gestor (o corretor só USA — rota /session).
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ guides: await listGuides() });
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível carregar os guias.");
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ guide: await createGuide(body, auth) }, { status: 201 });
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível criar o guia.");
  }
}
