import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { disconnectGoogleContactsForBroker } from "@/lib/google-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Desconecta SÓ o Google Contacts do corretor logado — nunca toca no
// WhatsApp individual (tabela/serviço totalmente separados).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const brokerId = auth.profile?.id;
  if (!brokerId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });

  try {
    await disconnectGoogleContactsForBroker(brokerId);
    return NextResponse.json({ status: "disconnected" });
  } catch (error) {
    console.error("Falha ao desconectar o Google Contacts:", error?.message || error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
