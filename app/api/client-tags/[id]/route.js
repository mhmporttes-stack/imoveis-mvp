import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { deleteTag } from "@/lib/client-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  // Excluir etiqueta apaga os vínculos de TODOS os clientes (ON DELETE CASCADE):
  // só dono (admin) e gestor — decisão do dono em 2026-10-04.
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    const error = auth.status === 403 ? "Só o gestor ou o administrador pode excluir etiquetas." : auth.error;
    return NextResponse.json({ error }, { status: auth.status });
  }

  try {
    const result = await deleteTag((await params).id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Nao foi possivel excluir a tag." }, { status: 400 });
  }
}
