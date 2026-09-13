import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { sendPushToUser } from "@/lib/push-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint para disparar um push de teste para o próprio usuário logado —
// usado para validar manualmente que a assinatura/envio estão funcionando.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await sendPushToUser(auth.profile?.id, {
      title: "Painel Matheus",
      body: "Notificações push ativadas com sucesso.",
      url: "/admin/simulacoes"
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao enviar push de teste." }, { status: 500 });
  }
}
