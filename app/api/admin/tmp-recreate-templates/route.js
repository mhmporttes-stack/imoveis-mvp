import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

const TARGET_NAMES = ["alameda", "apresentacao", "abordagem", "bom_dia"];

export async function POST(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";

  const db = getSupabaseAdminClient();
  const { data: rows, error } = await db
    .from("whatsapp_templates")
    .select("name, language, category, components")
    .in("name", TARGET_NAMES);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const row of rows) {
    const response = await fetch(`https://graph.facebook.com/${version}/${businessAccountId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: row.name, language: row.language, category: row.category, components: row.components })
    });
    const payload = await response.json().catch(() => ({}));
    results.push({ name: row.name, status: response.status, payload });
  }

  return NextResponse.json({ results });
}
