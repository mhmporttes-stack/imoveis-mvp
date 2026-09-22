import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { deleteWhatsappAutomationReply, updateWhatsappAutomationReply } from "@/lib/whatsapp-automation-replies";

export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const rule = await updateWhatsappAutomationReply(id, await request.json(), auth);
    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível atualizar a regra." }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    await deleteWhatsappAutomationReply(id, auth);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível excluir a regra." }, { status: 400 });
  }
}
