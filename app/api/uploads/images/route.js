import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { uploadPropertyImage } from "@/lib/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const propertyId = formData.get("propertyId") || "drafts";

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Nenhuma imagem foi enviada." }, { status: 400 });
    }

    if (!file.type?.startsWith("image/")) {
      return NextResponse.json({ error: "Envie apenas arquivos de imagem." }, { status: 400 });
    }

    const photo = await uploadPropertyImage(file, propertyId);
    return NextResponse.json(photo, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Nao foi possivel enviar a imagem." }, { status: 400 });
  }
}
