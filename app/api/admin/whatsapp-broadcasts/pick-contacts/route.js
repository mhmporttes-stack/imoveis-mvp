import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatWhatsappBroadcastError } from "@/lib/whatsapp-broadcasts";
import { pickBaseContacts } from "@/lib/whatsapp-broadcast-schedules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sorteio de N contatos da Base da Imobiliária para uma campanha: primeiro os NUNCA contatados (ao acaso) e, só se
// faltar, os de contato mais ANTIGO. Não cria nada — a tela usa o resultado para preencher a seleção de contatos
// (createBroadcast continua sendo quem grava, do jeito de sempre).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const result = await pickBaseContacts({ count: body.count, minDays: body.minDays }, auth);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
