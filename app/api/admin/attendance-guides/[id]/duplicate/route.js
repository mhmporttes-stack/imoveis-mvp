import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { duplicateGuide } from "@/lib/attendance-guides";
import { guideErrorResponse } from "../../guide-errors";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ guide: await duplicateGuide((await params).id, auth) }, { status: 201 });
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível duplicar o guia.");
  }
}
