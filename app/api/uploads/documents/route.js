import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { uploadPropertyDocument } from "@/lib/media-storage";

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
      return NextResponse.json({ error: "Nenhum arquivo foi enviado." }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Envie apenas arquivos PDF." }, { status: 400 });
    }

    const document = await uploadPropertyDocument(file, propertyId);
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Nao foi possivel enviar o PDF." }, { status: 400 });
  }
}
