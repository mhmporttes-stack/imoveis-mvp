import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { updateIndividualSessionSettings } from "@/lib/whatsapp-individual";
import { isSlotDispatchEnabled, normalizeSlot } from "@/lib/whatsapp-session-slots.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Apelido ("Pessoal", "Trabalho"...) e chave "Usar para disparo" de UM número (1 ou 2) do usuário LOGADO
// (2026-10-08). Sempre o próprio perfil (auth.profile.id) — nunca um id vindo do corpo.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.profile?.id;
  if (!userId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }
  const slot = body?.slot === undefined ? null : normalizeSlot(body.slot);
  if (!slot) return NextResponse.json({ error: "Número de WhatsApp inválido." }, { status: 400 });
  const patch = {};
  if (typeof body.label === "string") patch.label = body.label;
  if (typeof body.dispatchEnabled === "boolean") patch.dispatchEnabled = body.dispatchEnabled;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });

  try {
    const row = await updateIndividualSessionSettings(userId, slot, patch);
    return NextResponse.json({ slot, label: row?.label || "", dispatchEnabled: isSlotDispatchEnabled(row || { slot }) });
  } catch (error) {
    console.error("Falha ao salvar o número do WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar." }, { status: 500 });
  }
}
