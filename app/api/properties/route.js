import { NextResponse } from "next/server";
import { ensureDailyBackup } from "@/lib/backup";
import { createProperty, listProperties } from "@/lib/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureDailyBackup();
  return NextResponse.json(listProperties());
}

export async function POST(request) {
  try {
    const property = createProperty(await request.json());
    ensureDailyBackup();
    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Não foi possível cadastrar o empreendimento." }, { status: 400 });
  }
}
