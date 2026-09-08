import { NextResponse } from "next/server";
import { requireFinancialManagerApi } from "@/lib/admin-auth";
import { getProperty } from "@/lib/properties";
import {
  canManageEmpreendimentoRegras,
  getEmpreendimentoRegras,
  upsertEmpreendimentoRegras
} from "@/lib/simulacao-entrada/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireFinancialManagerApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageEmpreendimentoRegras()) {
    return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  }

  try {
    const { id } = await params;
    const row = await getEmpreendimentoRegras(id);
    return NextResponse.json({ empreendimento: row });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Nao foi possivel carregar as regras de entrada." }, { status: 400 });
  }
}

export async function PUT(request, { params }) {
  const auth = await requireFinancialManagerApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageEmpreendimentoRegras()) {
    return NextResponse.json({ error: "Supabase administrativo nao configurado." }, { status: 503 });
  }

  try {
    const { id } = await params;
    const property = await getProperty(id);
    if (!property) {
      return NextResponse.json({ error: "Empreendimento nao encontrado." }, { status: 404 });
    }

    const body = await request.json();
    const regras = { ...body.regras, id, nome: property.name };

    const row = await upsertEmpreendimentoRegras({
      id,
      nome: property.name,
      ativo: body.ativo !== false,
      regras,
      updatedByEmail: auth.user?.email
    });

    return NextResponse.json({ empreendimento: row });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Nao foi possivel salvar as regras de entrada." }, { status: 400 });
  }
}
