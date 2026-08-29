import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { uploadTestimonialMedia } from "@/lib/media-storage";

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
    const kind = formData.get("kind") || "images";
    const testimonialId = formData.get("testimonialId") || "drafts";

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Nenhum arquivo foi enviado." }, { status: 400 });
    }

    const media = await uploadTestimonialMedia(file, kind, testimonialId);
    return NextResponse.json(media, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Nao foi possivel enviar o arquivo." }, { status: 400 });
  }
}
