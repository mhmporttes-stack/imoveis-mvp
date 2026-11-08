import { NextResponse } from "next/server";
import { safeDecode } from "@/lib/short-links.mjs";
import { internalRewriteTarget } from "@/lib/public-origin-core.mjs";

export const dynamic = "force-dynamic";

// Link curto da Minha Jornada: /j/{token} → /minha-jornada/{token} (o token continua sendo o mesmo).
export async function GET(request, { params }) {
  const { token } = await params;
  const url = internalRewriteTarget(request.nextUrl.clone(), request.headers);
  url.pathname = `/minha-jornada/${encodeURIComponent(safeDecode(String(token || "")))}`;
  return NextResponse.redirect(url, 307);
}
