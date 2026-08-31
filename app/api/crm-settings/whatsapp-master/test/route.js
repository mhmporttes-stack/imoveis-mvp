import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { testWhatsappMasterConnection } from "@/lib/whatsapp-master";

export const runtime = "nodejs";

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await testWhatsappMasterConnection(auth?.profile?.id || null);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível testar a conexão." }, { status: 400 });
  }
}
