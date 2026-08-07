import { NextResponse } from "next/server";
import { uploadPropertyImage } from "@/lib/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Nenhuma imagem foi enviada." }, { status: 400 });
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return NextResponse.json({ error: "Envie imagens em JPG, PNG ou WEBP." }, { status: 400 });
    }

    const photo = await uploadPropertyImage(file, "captacoes");
    return NextResponse.json(photo, { status: 201 });
  } catch (error) {
    console.error("Captacao upload failed:", error?.message || error);
    return NextResponse.json({ error: error.message || "Nao foi possivel enviar a imagem." }, { status: 400 });
  }
}
