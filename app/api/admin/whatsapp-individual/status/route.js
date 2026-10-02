import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getIndividualSessionRow } from "@/lib/whatsapp-individual";
import { endRestrictionIfConnected } from "@/lib/whatsapp-restriction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status da sessão do usuário LOGADO, lido direto da tabela (o microsserviço
// já mantém a linha atualizada — via webhook e escrita direta) em vez de
// chamar o microsserviço a cada poll da tela: mais simples e não depende do
// serviço estar de pé para o Chat continuar respondendo rápido.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.profile?.id;
  if (!userId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });

  try {
    const row = await getIndividualSessionRow(userId);
    // Conectou: encerra a restrição informada (se houver) — status operacional apenas.
    await endRestrictionIfConnected(userId, row?.status).catch(() => {});
    // Código de pareamento expira em poucos minutos no WhatsApp (e morre se o
    // serviço reiniciar): passados 3 min sem conectar, a tela volta a
    // oferecer um código novo em vez de mostrar um código morto (2026-10-02).
    const pairingExpired = row?.status === "pairing_code_required" && Date.now() - new Date(row?.updated_at || 0).getTime() > 3 * 60 * 1000;
    if (pairingExpired) {
      return NextResponse.json({ status: "disconnected", phoneNumber: row?.phone_number || "", qr: "", qrExpiresAt: null, pairingCode: "", lastConnectedAt: row?.last_connected_at || null, lastError: "pairing_expired" });
    }
    return NextResponse.json({
      status: row?.status || "disconnected",
      phoneNumber: row?.phone_number || "",
      qr: row?.qr_data || "",
      qrExpiresAt: row?.qr_expires_at || null,
      pairingCode: row?.pairing_code || "",
      lastConnectedAt: row?.last_connected_at || null,
      lastError: row?.last_error || ""
    });
  } catch (error) {
    console.error("Falha ao ler o status do WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler o status." }, { status: 500 });
  }
}
