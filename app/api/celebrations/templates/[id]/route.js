import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { updateMessageTemplate, deleteMessageTemplate, formatCelebrationsError } from "@/lib/celebrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const payload = await request.json();
    const template = await updateMessageTemplate(auth, id, { template: payload.template, active: payload.active });
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    await deleteMessageTemplate(auth, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}
