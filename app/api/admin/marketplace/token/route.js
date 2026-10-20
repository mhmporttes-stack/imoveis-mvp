import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { generatePublisherToken } from "@/lib/marketplace-listings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Gera a chave pessoal da extensão (invalida a anterior). A chave só aparece nesta resposta; o banco guarda o hash.
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ token: await generatePublisherToken(auth) });
  } catch {
    return NextResponse.json({ error: "Não foi possível gerar a chave." }, { status: 500 });
  }
}
