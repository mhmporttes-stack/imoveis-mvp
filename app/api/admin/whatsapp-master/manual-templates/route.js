import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { getManualSummaryTemplates, MANUAL_SUMMARY_VARIABLES, saveManualSummaryTemplate } from "@/lib/whatsapp-manual-summary";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const templates = await getManualSummaryTemplates();
    return NextResponse.json({ templates, variables: MANUAL_SUMMARY_VARIABLES });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível carregar os modelos." }, { status: error?.status || 400 });
  }
}

export async function PUT(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const templates = await saveManualSummaryTemplate(body.period, body.template);
    return NextResponse.json({ ok: true, templates });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível salvar o modelo." }, { status: error?.status || 400 });
  }
}
