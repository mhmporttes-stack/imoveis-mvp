import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertOwnerAdmin } from "@/lib/admin-access";
import { assignProspectingContacts, deleteProspectingContacts } from "@/lib/prospecting";

export const runtime = "nodejs";

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    // Excluir/transferir em massa na base de OUTRO corretor (drill-down de
    // "Bases dos Corretores") é restrito ao administrador principal — nunca
    // a qualquer admin geral/gestor. A fila compartilhada (sem context)
    // segue com a permissão original, inalterada.
    if (body.context === "broker") assertOwnerAdmin(auth);
    if (body.action === "delete") return NextResponse.json(await deleteProspectingContacts(body.ids, auth));
    if (body.action === "assign") return NextResponse.json(await assignProspectingContacts(body.ids, body.assignedUserId, auth));
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível atualizar os contatos." }, { status: error?.status || 400 });
  }
}
