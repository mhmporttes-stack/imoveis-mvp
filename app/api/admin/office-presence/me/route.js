import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getMyOfficeStatus } from "@/lib/office-presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Situação do PRÓPRIO usuário na regra "veio à imobiliária" (aviso no app).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getMyOfficeStatus(auth));
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao consultar." }, { status: 400 });
  }
}
