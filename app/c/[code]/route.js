import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { isUuid, safeDecode } from "@/lib/short-links.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Link curto de campanha/patrocinado: /c/{codigo} → /simulacao?c={id da campanha}. O código é campaigns.short_code
// (também aceita o próprio id). Código desconhecido cai na simulação padrão (nunca em página de erro).
export async function GET(request, { params }) {
  const { code } = await params;
  const clean = safeDecode(String(code || "")).trim().toLowerCase();
  const url = request.nextUrl.clone();
  url.pathname = "/simulacao";

  let campaignId = "";
  if (isUuid(clean)) {
    campaignId = clean;
  } else if (/^[a-z0-9]{3,32}$/.test(clean)) {
    try {
      const supabase = getSupabaseAdminClient();
      const { data } = await supabase.from("campaigns").select("id").eq("short_code", clean).maybeSingle();
      campaignId = data?.id || "";
    } catch {
      campaignId = "";
    }
  }
  if (campaignId) url.searchParams.set("c", campaignId);
  return NextResponse.redirect(url, 307);
}
