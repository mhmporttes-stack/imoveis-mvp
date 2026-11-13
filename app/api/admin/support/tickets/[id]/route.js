import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertSupportQueueAccess, getSupportTicket, replySupportTicket, setSupportTicketKind } from "@/lib/support-tickets";
import { supportErrorResponse } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ficha: o dono (conta real) vê tudo; o autor vê só o próprio; outro usuário recebe 404.
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    return NextResponse.json({ ticket: await getSupportTicket(auth, id) });
  } catch (error) {
    return supportErrorResponse(error, "Não consegui abrir o chamado.");
  }
}

// Só o dono: { kind: "bug" | "not_bug" | "improvement" | null } marca o tipo; { reply: "..." } responde ao corretor.
export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    assertSupportQueueAccess(auth);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body?.reply === "string") return NextResponse.json(await replySupportTicket(auth, id, body.reply));
    if ("kind" in (body || {})) return NextResponse.json(await setSupportTicketKind(auth, id, body.kind ?? null));
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  } catch (error) {
    return supportErrorResponse(error, "Não consegui atualizar o chamado.");
  }
}
