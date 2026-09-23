import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { getMetaAdsConfigStatus } from "@/lib/meta-ads-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnóstico de leitura — nunca devolve o token, só o estado de
// configuração/sincronização. Usado pela futura tela de Gestão de Tráfego e
// para conferir manualmente se intraday/consolidação/backfill estão saudáveis.
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request, "Apenas o administrador geral pode ver o status da integração com a Meta Ads.");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const configStatus = getMetaAdsConfigStatus();
  if (!configStatus.configured) {
    return NextResponse.json({ configured: false, missing: configStatus.missing });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const [{ data: accounts, error: accountsError }, { data: syncState, error: syncStateError }] = await Promise.all([
      supabase.from("meta_ad_accounts").select("ad_account_id, name, currency, timezone_name, last_synced_at"),
      supabase.from("meta_ad_sync_state").select("*")
    ]);
    if (accountsError) throw accountsError;
    if (syncStateError) throw syncStateError;

    const { count: entityCount } = await supabase.from("meta_ad_entities").select("*", { count: "exact", head: true });
    const { count: insightRowCount } = await supabase.from("meta_ad_insights").select("*", { count: "exact", head: true });

    return NextResponse.json({
      configured: true,
      accounts: accounts || [],
      syncState: syncState || [],
      entityCount: entityCount || 0,
      insightRowCount: insightRowCount || 0
    });
  } catch (error) {
    console.error("Falha ao consultar status da integração com a Meta Ads.", error);
    return NextResponse.json({ error: error?.message || "Falha ao consultar status." }, { status: 500 });
  }
}
