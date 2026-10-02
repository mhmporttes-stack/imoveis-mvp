import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { acknowledgeAlert } from "@/lib/crm-alerts";
import { alertErrorResponse } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Entendi" do alerta Importante (ciência do próprio destinatário).
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await acknowledgeAlert(auth, (await params).id));
  } catch (error) {
    return alertErrorResponse(error);
  }
}
