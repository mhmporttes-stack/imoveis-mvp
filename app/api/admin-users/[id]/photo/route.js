import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { getAdminProfileById, updateAdminProfile } from "@/lib/admin-profiles";
import { deleteBrokerAvatarByUrl, uploadBrokerAvatar } from "@/lib/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const current = await getAdminProfileById(id);
    if (!current) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Nenhuma imagem foi enviada." }, { status: 400 });
    }

    const previousUrl = current.photoUrl;
    const uploaded = await uploadBrokerAvatar(file, id);
    const user = await updateAdminProfile(id, { photoUrl: uploaded.url });

    if (previousUrl) {
      await deleteBrokerAvatarByUrl(previousUrl).catch(() => {});
    }

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível enviar a foto." }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const current = await getAdminProfileById(id);
    if (!current) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

    const user = await updateAdminProfile(id, { photoUrl: "" });
    if (current.photoUrl) {
      await deleteBrokerAvatarByUrl(current.photoUrl).catch(() => {});
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível remover a foto." }, { status: 400 });
  }
}
