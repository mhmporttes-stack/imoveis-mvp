import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { deleteGuide, getGuide, updateGuide } from "@/lib/attendance-guides";
import { guideErrorResponse } from "../guide-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ guide: await getGuide((await params).id) });
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível abrir o guia.");
  }
}

// Salva o RASCUNHO (não muda o que os corretores veem até "Publicar").
export async function PATCH(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ guide: await updateGuide((await params).id, body, auth) });
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível salvar o guia.");
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await deleteGuide((await params).id, auth));
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível excluir o guia.");
  }
}
