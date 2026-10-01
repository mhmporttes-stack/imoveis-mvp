import { NextResponse } from "next/server";
import { uploadPropertyImage } from "@/lib/media-storage";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";
import { ALLOWED_IMAGE_TYPES, detectImageType } from "@/lib/image-signature.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota PÚBLICA por desenho (o formulário de captação é preenchido pelo
// proprietário do imóvel, sem login). Proteções (decisão do dono,
// 2026-10-01): limite de envios que BLOQUEIA se não puder ser checado
// (failClosed), tipo validado pelo conteúdo real do arquivo (não pelo MIME
// do navegador) e limpeza diária de fotos nunca vinculadas a uma captação
// (lib/captacao-upload-cleanup.js, chamada pelo cron scheduled-activities).
export async function POST(request) {
  try {
    const allowed = await checkPublicRateLimit(buildRateLimitKey(request, "upload"), { windowSeconds: 300, maxAttempts: 10, failClosed: true });
    if (!allowed) {
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

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Envie imagens em JPG, PNG ou WEBP." }, { status: 400 });
    }

    // O tipo informado pelo navegador pode ser falso: só aceita se os bytes
    // do arquivo forem de fato JPEG/PNG/WEBP, e grava com o tipo detectado.
    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedType = detectImageType(buffer);
    if (!detectedType) {
      return NextResponse.json({ error: "O arquivo enviado não é uma imagem JPG, PNG ou WEBP válida." }, { status: 400 });
    }
    const verifiedFile = new File([buffer], file.name || "foto", { type: detectedType });

    const photo = await uploadPropertyImage(verifiedFile, "captacoes");
    return NextResponse.json(photo, { status: 201 });
  } catch (error) {
    console.error("Captacao upload failed:", error?.message || error);
    return NextResponse.json({ error: error.message || "Nao foi possivel enviar a imagem." }, { status: 400 });
  }
}
