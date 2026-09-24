import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { updateWhatsappProfilePhoto, WhatsappProfileError } from "@/lib/whatsapp-profile";

export const runtime = "nodejs";

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") throw new WhatsappProfileError("Envie uma imagem.");
    const buffer = Buffer.from(await file.arrayBuffer());
    return NextResponse.json({ profile: await updateWhatsappProfilePhoto({ buffer, mimeType: file.type }) });
  } catch (error) {
    const known = error instanceof WhatsappProfileError;
    return NextResponse.json({ error: known ? error.message : "Não foi possível atualizar a foto." }, { status: known ? error.status : 500 });
  }
}
