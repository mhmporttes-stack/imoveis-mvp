import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { normalizeSlot } from "@/lib/whatsapp-session-slots.mjs";
import { connectIndividualSession } from "@/lib/whatsapp-individual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Inicia/retoma a sessão pessoal de WhatsApp (Baileys) do usuário LOGADO —
// nunca de outro id vindo do corpo da requisição. O microsserviço devolve o
// QR (base64) quando precisa ser escaneado de novo; se já havia credenciais
// salvas, reconecta sem QR nenhum.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.profile?.id;
  if (!userId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });

  try {
    // phoneNumber opcional (pedido do dono, 2026-09-30): pareamento por
    // código numérico em vez de escanear o QR.
    let phoneNumber = "";
    let rawSlot;
    try {
      const body = await request.json();
      phoneNumber = String(body?.phoneNumber || "");
      rawSlot = body?.slot;
    } catch {
      // Corpo vazio (clique normal de "Conectar", sem número) — QR como sempre, Número 1.
    }
    // Número 1 ou 2 do PRÓPRIO usuário (2026-10-08); nunca outro id.
    const slot = normalizeSlot(rawSlot);
    if (!slot) return NextResponse.json({ error: "Número de WhatsApp inválido." }, { status: 400 });
    const result = await connectIndividualSession(userId, phoneNumber, { slot });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Falha ao conectar o WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Não foi possível conectar." }, { status: 502 });
  }
}
