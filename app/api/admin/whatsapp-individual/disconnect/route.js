import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { disconnectIndividualSession } from "@/lib/whatsapp-individual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.profile?.id;
  if (!userId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });

  try {
    const result = await disconnectIndividualSession(userId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Falha ao desconectar o WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Não foi possível desconectar." }, { status: 502 });
  }
}
