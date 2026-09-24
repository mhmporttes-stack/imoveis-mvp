import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { deleteWhatsappFlow, getWhatsappFlow, updateWhatsappFlow } from "@/lib/whatsapp-flows";
import { flowErrorResponse } from "../flow-errors";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    return NextResponse.json({ flow: await getWhatsappFlow(id) });
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível abrir o fluxo.");
  }
}

export async function PATCH(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ flow: await updateWhatsappFlow(id, body, auth) });
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível salvar o fluxo.");
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    return NextResponse.json(await deleteWhatsappFlow(id, auth));
  } catch (error) {
    return flowErrorResponse(error, "Não foi possível excluir o fluxo.");
  }
}
