import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Número público do WhatsApp oficial (API) — usado pelo botão "Receber minha
// simulação" da tela final do formulário. É o mesmo número que já aparece nas
// mensagens enviadas aos clientes, nunca um segredo; a rota existe só para o
// navegador saber para onde abrir o wa.me sem hardcode nem variável NEXT_PUBLIC.
export async function GET() {
  let digits = String(process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || "").replace(/\D/g, "");
  if (digits && !(digits.startsWith("55") && digits.length >= 12)) digits = `55${digits}`;
  return NextResponse.json({ phone: digits || null }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
}
