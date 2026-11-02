import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getIndividualSessionStatusForUser } from "@/lib/whatsapp-individual";
import { getOpenRestriction } from "@/lib/whatsapp-restriction";
import { isChatDisabled } from "@/lib/chat-control";
import { isPrintedListModeAuth } from "@/lib/whatsapp-manual-disconnect";
import { isWhatsappServiceDown } from "@/lib/whatsapp-service-health";

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
    // printedListMode (PRO-15, 2026-10-15): WhatsApp desconectado (não banido/restrito) = sem Chat; o card abre fora.
    // serviceDown (WA-13d, dono 2026-11-02): serviço do WhatsApp fora do ar (lease/health/falhas de envio, com cache de ~1 min no
    // servidor) -> o botão abre o app/WhatsApp Web. Uma leitura para todos os cartões.
    const [sessionStatus, open, printedListMode, serviceDown, chatDisabled] = await Promise.all([getIndividualSessionStatusForUser(userId), getOpenRestriction(userId), isPrintedListModeAuth(auth), isWhatsappServiceDown(), isChatDisabled()]);
    return NextResponse.json({ userId, sessionStatus: sessionStatus || null, restricted: Boolean(open) && sessionStatus !== "connected", chatDisabled, printedListMode, serviceDown });
  } catch (error) {
    console.error("Falha ao ler o estado do WhatsApp para o card:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler o estado." }, { status: 500 });
  }
}
