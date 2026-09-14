import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listBrokerOwnedContacts } from "@/lib/prospecting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { brokerId } = await params;
    return NextResponse.json(await listBrokerOwnedContacts(brokerId, auth));
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error?.status || 400 }); }
}
