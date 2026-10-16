import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ensureDailyBackup } from "@/lib/backup";
import { requireFinancialManagerApi } from "@/lib/admin-auth";
import { canManageProperties, deleteProperty, savePropertyContact, updateProperty } from "@/lib/properties";
import { hasPropertyContactInput } from "@/lib/property-contact-core.mjs";
import { getPublicProperty } from "@/lib/public-properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const property = await getPublicProperty(id);
  if (!property) {
    return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
  }
  return NextResponse.json(property);
}

export async function PUT(request, { params }) {
  const auth = await requireFinancialManagerApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageProperties()) {
    return NextResponse.json({ error: "Painel administrativo desativado em producao." }, { status: 503 });
  }

  try {
    const { id } = await params;
    const payload = await request.json();
    const property = await updateProperty(id, payload);
    if (!property) {
      return NextResponse.json({ error: "Empreendimento não encontrado." }, { status: 404 });
    }
    // Contato do imóvel (interno, 2026-10-16): esta rota já é só admin/gestor (requireFinancialManagerApi).
    // Só grava quando o formulário mandou os campos — outro chamador do PUT nunca apaga o contato.
    if (hasPropertyContactInput(payload)) await savePropertyContact(id, payload);
    await ensureDailyBackup();
    // Site atualiza na hora ao publicar/editar (dono, 2026-10-15: "aprovei e não vi no site" — a página guardava
    // a lista por até 60 s). Falha aqui nunca derruba o salvamento.
    try {
      revalidatePath("/");
      revalidatePath(`/empreendimentos/${id}`);
    } catch (revalidateError) {
      console.warn("Não foi possível atualizar o cache do site:", revalidateError?.message || revalidateError);
    }
    return NextResponse.json(property);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível atualizar o empreendimento." }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireFinancialManagerApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageProperties()) {
    return NextResponse.json({ error: "Painel administrativo desativado em producao." }, { status: 503 });
  }

  try {
    const { id } = await params;
    const ok = await deleteProperty(id);
    await ensureDailyBackup();
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível excluir o empreendimento." }, { status: 400 });
  }
}
