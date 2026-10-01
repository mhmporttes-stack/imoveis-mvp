import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { markSupervisionMessageSeen } from "@/lib/supervision-messages";
import { supervisionErrorResponse } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// O balão desta mensagem apareceu na tela do destinatário.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    return NextResponse.json(await markSupervisionMessageSeen(auth, id));
  } catch (error) {
    return supervisionErrorResponse(error);
  }
}
