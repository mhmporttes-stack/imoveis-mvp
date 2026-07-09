import { NextResponse } from "next/server";
import { ensureDailyBackup } from "@/lib/backup";
import { deleteProperty, getProperty, updateProperty } from "@/lib/properties";
import { canUseLocalDatabase } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const property = getProperty(id);
  if (!property) {
    return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
  }
  return NextResponse.json(property);
}

export async function PUT(request, { params }) {
  if (!canUseLocalDatabase) {
    return NextResponse.json({ error: "Painel administrativo desativado em producao." }, { status: 503 });
  }

  try {
    const { id } = await params;
    const property = updateProperty(id, await request.json());
    if (!property) {
      return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
    }
    await ensureDailyBackup();
    return NextResponse.json(property);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Não foi possível atualizar o empreendimento." }, { status: 400 });
  }
}

export async function DELETE(_request, { params }) {
  if (!canUseLocalDatabase) {
    return NextResponse.json({ error: "Painel administrativo desativado em producao." }, { status: 503 });
  }

  const { id } = await params;
  const ok = deleteProperty(id);
  await ensureDailyBackup();
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
