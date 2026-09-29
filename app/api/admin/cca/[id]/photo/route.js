import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getCca, setCcaPhoto } from "@/lib/cca";
import { deleteCcaAvatarByUrl, uploadCcaAvatar } from "@/lib/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const current = await getCca(id);
    if (!current) return NextResponse.json({ error: "CCA não encontrada." }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Nenhuma imagem foi enviada." }, { status: 400 });
    }

    const previousUrl = current.photoUrl;
    const uploaded = await uploadCcaAvatar(file, id);
    const cca = await setCcaPhoto(id, uploaded.url, auth);

    if (previousUrl) {
      await deleteCcaAvatarByUrl(previousUrl).catch(() => {});
    }

    return NextResponse.json({ cca }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível enviar a foto." }, { status: error?.status || 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const current = await getCca(id);
    if (!current) return NextResponse.json({ error: "CCA não encontrada." }, { status: 404 });

    const cca = await setCcaPhoto(id, "", auth);
    if (current.photoUrl) {
      await deleteCcaAvatarByUrl(current.photoUrl).catch(() => {});
    }

    return NextResponse.json({ cca });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível remover a foto." }, { status: error?.status || 400 });
  }
}
