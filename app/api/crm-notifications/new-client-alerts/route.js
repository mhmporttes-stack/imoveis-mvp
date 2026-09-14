import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { classifyClientOrigin } from "@/lib/crm-automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sinal cru para o alerta sonoro de "Cliente se cadastrou pelo formulário"
// (Gestão > Automações) — não passa pelo motor de crm_automation_rules nem
// por crm_notifications (aquelas regras são editáveis pelo usuário e podem
// ser desligadas/reconfiguradas sem relação com este alerta). Consulta
// direta em simulation_registrations, sempre escopada ao próprio usuário
// logado (o corretor só ouve alerta de cliente atribuído a ele mesmo) —
// por isso qualquer usuário autenticado pode chamar, mesmo sem acesso a
// Gestão: o listener global precisa funcionar para o corretor destinatário.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const brokerId = auth.profile?.id;
  const serverTime = new Date().toISOString();
  if (!brokerId) return NextResponse.json({ ok: true, clients: [], serverTime });

  const since = new URL(request.url).searchParams.get("since") || serverTime;

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("simulation_registrations")
      .select("id, client_code, full_name, created_at, prospecting_contact_id, acquisition_context")
      .eq("responsible_user_id", brokerId)
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw error;

    const clients = (data || [])
      .filter((row) => classifyClientOrigin(row) === "form")
      .map((row) => ({ id: row.id, clientCode: row.client_code || "", fullName: row.full_name || "Cliente", createdAt: row.created_at }));

    return NextResponse.json({ ok: true, clients, serverTime });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível verificar novos clientes." }, { status: 400 });
  }
}
