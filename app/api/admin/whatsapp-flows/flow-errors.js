import { NextResponse } from "next/server";
import { WhatsappFlowError } from "@/lib/whatsapp-flows";

export function flowErrorResponse(error, fallback) {
  if (error instanceof WhatsappFlowError) {
    return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  }
  // Erros de permissão de admin-access chegam com .status.
  if (error?.status && error?.message) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
