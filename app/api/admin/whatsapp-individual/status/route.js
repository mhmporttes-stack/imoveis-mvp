import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listIndividualSessionRows } from "@/lib/whatsapp-individual";
import { endRestrictionIfConnected } from "@/lib/whatsapp-restriction";
import { WHATSAPP_SLOTS, aggregateSessionStatus, isSlotDispatchEnabled, normalizeSlot } from "@/lib/whatsapp-session-slots.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Código de pareamento expira em poucos minutos no WhatsApp (e morre se o
// serviço reiniciar): passados 3 min sem conectar, a tela volta a
// oferecer um código novo em vez de mostrar um código morto (2026-10-02).
function slotView(slot, row) {
  const pairingExpired = row?.status === "pairing_code_required" && Date.now() - new Date(row?.updated_at || 0).getTime() > 3 * 60 * 1000;
  const base = {
    slot,
    label: row?.label || "",
    dispatchEnabled: isSlotDispatchEnabled(row || { slot }),
    configured: Boolean(row)
  };
  if (pairingExpired) {
    return { ...base, status: "disconnected", phoneNumber: row?.phone_number || "", qr: "", qrExpiresAt: null, pairingCode: "", lastConnectedAt: row?.last_connected_at || null, lastError: "pairing_expired" };
  }
  return {
    ...base,
    status: row?.status || "disconnected",
    phoneNumber: row?.phone_number || "",
    qr: row?.qr_data || "",
    qrExpiresAt: row?.qr_expires_at || null,
    pairingCode: row?.pairing_code || "",
    lastConnectedAt: row?.last_connected_at || null,
    lastError: row?.last_error || ""
  };
}

// Status dos números (até 2) do usuário LOGADO, lido direto da tabela (o microsserviço
// já mantém a linha atualizada — via webhook e escrita direta) em vez de
// chamar o microsserviço a cada poll da tela: mais simples e não depende do
// serviço estar de pé para o Chat continuar respondendo rápido.
// `?slot=` (1 padrão) escolhe qual número vai nos campos de topo (compatível com a tela antiga);
// `slots` traz os dois e `overallStatus` o estado agregado (conectado se qualquer um estiver).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.profile?.id;
  if (!userId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });
  const slot = normalizeSlot(request.nextUrl.searchParams.get("slot"));
  if (!slot) return NextResponse.json({ error: "Número de WhatsApp inválido." }, { status: 400 });

  try {
    const rows = await listIndividualSessionRows(userId);
    const overallStatus = aggregateSessionStatus(rows) || "disconnected";
    // Conectou: encerra a restrição informada (se houver) — status operacional apenas.
    await endRestrictionIfConnected(userId, overallStatus).catch(() => {});
    const slots = WHATSAPP_SLOTS.map((value) => slotView(value, rows.find((row) => (normalizeSlot(row.slot) || 1) === value) || null));
    return NextResponse.json({ ...slots.find((item) => item.slot === slot), overallStatus, slots });
  } catch (error) {
    console.error("Falha ao ler o status do WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler o status." }, { status: 500 });
  }
}
