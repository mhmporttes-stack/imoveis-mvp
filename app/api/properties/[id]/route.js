import { NextResponse } from "next/server";
import { ensureDailyBackup } from "@/lib/backup";
import { requireAdminApi } from "@/lib/admin-auth";
import { canManageProperties, deleteProperty, updateProperty } from "@/lib/properties";
import { getPublicProperty } from "@/lib/public-properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const property = await getPublicProperty(id);
  if (!property) {
    return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
  }
  return NextResponse.json(property);
}

export async function PUT(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageProperties()) {
    return NextResponse.json({ error: "Painel administrativo desativado em producao." }, { status: 503 });
  }

  try {
    const { id } = await params;
    const property = await updateProperty(id, await request.json());
    if (!property) {
      return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
    }
    await ensureDailyBackup();
    return NextResponse.json(property);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível atualizar o empreendimento." }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageProperties()) {
    return NextResponse.json({ error: "Painel administrativo desativado em producao." }, { status: 503 });
  }

  const { id } = await params;
  const ok = await deleteProperty(id);
  await ensureDailyBackup();
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
