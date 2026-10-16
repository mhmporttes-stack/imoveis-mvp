import { NextResponse } from "next/server";
import { requireFinancialManagerApi } from "@/lib/admin-auth";
import { listPropertyContacts } from "@/lib/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Contatos de imóvel já cadastrados (autocomplete do formulário). Dado interno: mesmo guard da edição de imóveis.
export async function GET(request) {
  const auth = await requireFinancialManagerApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    return NextResponse.json({ contacts: await listPropertyContacts() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível carregar os contatos." }, { status: 500 });
  }
}
