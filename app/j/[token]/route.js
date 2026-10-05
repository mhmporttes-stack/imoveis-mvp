import { NextResponse } from "next/server";
import { safeDecode } from "@/lib/short-links.mjs";

export const dynamic = "force-dynamic";

// Link curto da Minha Jornada: /j/{token} → /minha-jornada/{token} (o token continua sendo o mesmo).
export async function GET(request, { params }) {
  const { token } = await params;
  const url = request.nextUrl.clone();
  url.pathname = `/minha-jornada/${encodeURIComponent(safeDecode(String(token || "")))}`;
  return NextResponse.redirect(url, 307);
}
