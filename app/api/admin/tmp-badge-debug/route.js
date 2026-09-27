import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnóstico TEMPORÁRIO do ícone do app (Badging API) — ver AGENTS.md: rota
// descartável, autenticada, sem "_" no nome, removida logo depois de usada.
// Só registra em log (nunca grava no banco); nunca lança erro para o cliente.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  console.log("[badge-debug]", JSON.stringify({ userId: auth.profile?.id, email: auth.user?.email, ...body }));
  return NextResponse.json({ ok: true });
}
