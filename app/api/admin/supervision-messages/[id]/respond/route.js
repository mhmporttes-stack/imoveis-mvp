import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { respondSupervisionMessage } from "@/lib/supervision-messages";
import { supervisionErrorResponse } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { action: "ack" | "reply", body } — destinatário confirma com OK ou
// responde com texto. Só o destinatário, e uma vez só.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  try {
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json(await respondSupervisionMessage(auth, id, payload));
  } catch (error) {
    return supervisionErrorResponse(error);
  }
}
