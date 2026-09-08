import { NextResponse } from "next/server";
import { uploadPropertyImage } from "@/lib/media-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadAttempts = new Map();
const MAX_UPLOADS_PER_WINDOW = 10;
const WINDOW_MS = 5 * 60_000;

function isRateLimited(request) {
  const key = request.headers.get("x-forwarded-for") || "local";
  const now = Date.now();
  const entry = uploadAttempts.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    uploadAttempts.set(key, { windowStart: now, count: 1 });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_UPLOADS_PER_WINDOW;
}

export async function POST(request) {
  try {
    if (isRateLimited(request)) {
      return NextResponse.json(
        { error: "Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente." },
        { status: 429 }
      );
    }

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
