import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { normalizeSlot } from "@/lib/whatsapp-session-slots.mjs";
import { disconnectIndividualSession } from "@/lib/whatsapp-individual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.accountSwitchMode) return NextResponse.json({ error: "Em \"Alterar conta\" não é possível mexer no WhatsApp da outra pessoa. Entre com a própria conta." }, { status: 403 });
  const userId = auth.profile?.id;
  if (!userId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });

  // Número 1 ou 2 do PRÓPRIO usuário (2026-10-08); corpo vazio = Número 1 (como antes).
  let rawSlot;
  try {
    rawSlot = (await request.json())?.slot;
  } catch {
    rawSlot = undefined;
  }
  const slot = normalizeSlot(rawSlot);
  if (!slot) return NextResponse.json({ error: "Número de WhatsApp inválido." }, { status: 400 });

  try {
    const result = await disconnectIndividualSession(userId, { slot });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Falha ao desconectar o WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Não foi possível desconectar." }, { status: 502 });
  }
}
