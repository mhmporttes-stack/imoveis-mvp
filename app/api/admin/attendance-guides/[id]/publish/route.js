import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { publishGuide } from "@/lib/attendance-guides";
import { guideErrorResponse } from "../../guide-errors";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ guide: await publishGuide((await params).id, auth) });
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível publicar o guia.");
  }
}
