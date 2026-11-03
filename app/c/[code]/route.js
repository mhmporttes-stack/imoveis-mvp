import { getSupabaseAdminClient } from "@/lib/supabase";
import { isUuid, safeDecode } from "@/lib/short-links.mjs";
import { SHARE_DESCRIPTION, SHARE_IMAGE, SHARE_IMAGE_ALT, SHARE_TITLE } from "@/lib/simulacao-share.mjs";
import { sharePreviewResponse } from "@/lib/share-preview-html.mjs";
import { SMS_TOKEN_PARAM, SMS_TOKEN_QUERY, cleanSmsToken } from "@/lib/sms-batch-token-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Link curto de campanha/patrocinado: /c/{codigo} → /simulacao?c={id da campanha}. O código é campaigns.short_code
// (também aceita o próprio id). Código desconhecido cai na simulação padrão (nunca em página de erro). Responde 200
// com a prévia (Open Graph) e leva a pessoa ao destino na hora.
export async function GET(request, { params }) {
  const { code } = await params;
  const clean = safeDecode(String(code || "")).trim().toLowerCase();
  const target = request.nextUrl.clone();
  target.pathname = "/simulacao";

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
  if (campaignId) target.searchParams.set("c", campaignId);
  // Lote de SMS (PRO-18f): `?t=<token do contato>` vira `sms_t` no destino (o formulário o captura como a UTM). Esta rota NÃO grava
  // nada (a prévia do iMessage/WhatsApp também chega aqui): o clique só conta quando o navegador abre o formulário (track-view).
  // Token ausente ou fora do formato: comportamento de sempre, sem erro.
  const smsToken = cleanSmsToken(request.nextUrl.searchParams.get(SMS_TOKEN_PARAM));
  if (smsToken) {
    target.searchParams.delete(SMS_TOKEN_PARAM);
    target.searchParams.set(SMS_TOKEN_QUERY, smsToken);
  }
  return sharePreviewResponse(request, target, { title: SHARE_TITLE, description: SHARE_DESCRIPTION, image: SHARE_IMAGE, imageAlt: SHARE_IMAGE_ALT });
}
