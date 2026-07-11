import { NextResponse } from "next/server";
import { ensureDailyBackup } from "@/lib/backup";
import { requireAdminApi } from "@/lib/admin-auth";
import { canManageProperties, createProperty } from "@/lib/properties";
import { listPublicProperties } from "@/lib/public-properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listPublicProperties());
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageProperties()) {
    return NextResponse.json({ error: "Painel administrativo desativado em producao." }, { status: 503 });
  }

  try {
    const property = await createProperty(await request.json());
    await ensureDailyBackup();
    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Não foi possível cadastrar o empreendimento." }, { status: 400 });
  }
}
