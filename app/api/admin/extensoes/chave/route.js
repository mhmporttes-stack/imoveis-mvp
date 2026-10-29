import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { generateInstagramExtensionToken } from "@/lib/browser-extensions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Chave do Seguidor do Instagram (igs_…; invalida a anterior). Aparece só nesta resposta; o banco guarda o hash.
export async function POST(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ token: await generateInstagramExtensionToken(auth) });
  } catch (error) {
    console.error("[extensoes] chave não gerada:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível gerar a chave." }, { status: 500 });
  }
}
