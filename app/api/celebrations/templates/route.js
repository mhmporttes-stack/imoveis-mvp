import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { listMessageTemplates, createMessageTemplate, formatCelebrationsError } from "@/lib/celebrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const templates = await listMessageTemplates(auth);
    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json();
    const template = await createMessageTemplate(auth, { triggerKey: payload.triggerKey, template: payload.template });
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: formatCelebrationsError(error) }, { status: 400 });
  }
}
