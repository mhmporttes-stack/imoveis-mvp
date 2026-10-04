import { NextResponse } from "next/server";
import { isGeneralAdmin, requireAdminApi } from "@/lib/admin-auth";
import { isManagerProfile } from "@/lib/admin-profiles";
import { createTag, createTagKeepingExisting, listTags } from "@/lib/client-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    return NextResponse.json(await listTags());
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Nao foi possivel carregar as tags." }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const payload = await request.json();
    // Qualquer perfil logado cria etiqueta NOVA. Repetir o nome de uma que já
    // existe só recolore (upsert) para dono/gestor; corretor e associado
    // recebem a etiqueta existente intacta (200), sem alterar cor/nome.
    if (!isGeneralAdmin(auth) && !isManagerProfile(auth.profile)) {
      const { tag, created } = await createTagKeepingExisting(payload);
      return NextResponse.json(tag, { status: created ? 201 : 200 });
    }
    const tag = await createTag(payload);
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Nao foi possivel criar a tag." }, { status: 400 });
  }
}
