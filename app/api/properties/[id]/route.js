import { NextResponse } from "next/server";
import { ensureDailyBackup } from "@/lib/backup";
import { deleteProperty, getProperty, updateProperty } from "@/lib/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const property = getProperty(params.id);
  if (!property) {
    return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
  }
  return NextResponse.json(property);
}

export async function PUT(request, { params }) {
  try {
    const property = updateProperty(params.id, await request.json());
    if (!property) {
      return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
    }
    ensureDailyBackup();
    return NextResponse.json(property);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Não foi possível atualizar o empreendimento." }, { status: 400 });
  }
}

export async function DELETE(_request, { params }) {
  const ok = deleteProperty(params.id);
  ensureDailyBackup();
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
