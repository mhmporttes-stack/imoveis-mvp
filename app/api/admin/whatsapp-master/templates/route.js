import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertOwnerAdmin } from "@/lib/admin-access";
import { createWhatsappMessageTemplate, listWhatsappMessageTemplates } from "@/lib/whatsapp-master";

export const runtime = "nodejs";

// Gerenciamento genérico de modelos do WhatsApp — pra criar futuros
// modelos direto pelo site, sem precisar editar código. Só o dono: cria
// registro permanente na conta comercial da Meta.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    assertOwnerAdmin(auth);
    const templates = await listWhatsappMessageTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível listar os modelos." }, { status: error?.status || 400 });
  }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    assertOwnerAdmin(auth);
    const body = await request.json();
    const bodyExample = String(body.bodyExample || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const outcome = await createWhatsappMessageTemplate({
      name: body.name,
      category: body.category || "UTILITY",
      languageCode: body.languageCode || "pt_BR",
      bodyText: body.bodyText,
      bodyExample
    });
    return NextResponse.json({ ok: true, template: outcome });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível criar o modelo." }, { status: error?.status || 400 });
  }
}
