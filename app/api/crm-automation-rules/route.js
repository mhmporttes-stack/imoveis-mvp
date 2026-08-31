import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { createAutomationRule, listAutomationRules } from "@/lib/crm-automations";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ rules: await listAutomationRules() });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível carregar as regras." }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ rule: await createAutomationRule(await request.json(), auth) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível criar a regra." }, { status: 400 });
  }
}
