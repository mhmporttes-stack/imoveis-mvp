import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getIndividualSessionStatusForUser } from "@/lib/whatsapp-individual";
import { getOpenRestriction } from "@/lib/whatsapp-restriction";
import { isChatDisabled } from "@/lib/chat-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Estado REAL do WhatsApp do usuário (efetivo) para o botão "WhatsApp" do card do
// cliente (lib/client-card-whatsapp-core.mjs). SOMENTE LEITURA: não encerra
// restrição, não altera status nem elegibilidade. Qualquer perfil ativo; só
// devolve o estado do próprio usuário efetivo (atribuição operacional segue o
// corretor emulado em "Alterar conta").
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.profile?.id;
  if (!userId) return NextResponse.json({ error: "Usuário sem perfil administrativo." }, { status: 403 });
  try {
    // Botão do card (dono, 2026-10-09): só sai do CRM quando o WhatsApp do corretor está desconectado — ou quando o Chat
    // inteiro está desligado. O Chat híbrido (envio pessoal desligado) NÃO manda mais para o WhatsApp Web/app.
    const [sessionStatus, open, chatDisabled] = await Promise.all([getIndividualSessionStatusForUser(userId), getOpenRestriction(userId), isChatDisabled()]);
    return NextResponse.json({ userId, sessionStatus: sessionStatus || null, restricted: Boolean(open) && sessionStatus !== "connected", chatDisabled });
  } catch (error) {
    console.error("Falha ao ler o estado do WhatsApp para o card:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler o estado." }, { status: 500 });
  }
}
