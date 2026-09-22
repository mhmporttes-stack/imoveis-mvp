import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";

export const runtime = "nodejs";

// Rota temporária: verifica se o WHATSAPP_ACCESS_TOKEN atual (configurado em
// produção) já enxerga o número/WABA novo, sem expor o token. Remover depois
// de usar.
export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const token = process.env.WHATSAPP_ACCESS_TOKEN || "";
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
  if (!token) return NextResponse.json({ error: "sem token configurado" }, { status: 400 });

  const newPhoneNumberId = "1331156153413943";
  const newWabaId = "1473372397974623";

  const [phoneRes, wabaRes] = await Promise.all([
    fetch(`https://graph.facebook.com/${version}/${newPhoneNumberId}?fields=verified_name,display_phone_number,quality_rating,platform_type,code_verification_status,name_status`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then((r) => r.json().then((body) => ({ status: r.status, body }))),
    fetch(`https://graph.facebook.com/${version}/${newWabaId}?fields=name,id`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then((r) => r.json().then((body) => ({ status: r.status, body })))
  ]);

  return NextResponse.json({
    currentEnvPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    currentEnvWabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    newPhoneNumberCheck: phoneRes,
    newWabaCheck: wabaRes
  });
}
