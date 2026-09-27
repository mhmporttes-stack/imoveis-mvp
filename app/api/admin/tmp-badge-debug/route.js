import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnóstico TEMPORÁRIO do ícone do app (Badging API) — ver AGENTS.md: rota
// descartável, autenticada, sem "_" no nome, removida logo depois de usada
// (junto da tabela tmp_badge_debug). Gravado no banco (não em log da Vercel,
// sem acesso nesta sessão) só para eu conseguir ler; nunca lança erro pro
// cliente.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  try {
    await getSupabaseAdminClient()
      .from("tmp_badge_debug")
      .insert({ payload: { userId: auth.profile?.id, email: auth.user?.email, ...body } });
  } catch (error) {
    console.error("Falha ao gravar diagnóstico do badge:", error?.message || error);
  }
  return NextResponse.json({ ok: true });
}
