import { NextResponse } from "next/server";
import { AttendanceGuideError } from "@/lib/attendance-guides";

export function guideErrorResponse(error, fallback) {
  if (error instanceof AttendanceGuideError) {
    return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  }
  // Erros de permissão (admin-access) e do Chat (WhatsappChatError) chegam com .status.
  if (error?.status && error?.message) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
