import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { classifyClientOrigin } from "@/lib/crm-automations";
import { listClientPopups } from "@/lib/client-popups";

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
//
// Janelinha de cliente novo (REGRA OFICIAL — dono, 2026-10-24, CLI-16): no MESMO ciclo, com `popups=1` (só enviado com
// a página visível e a janelinha montada), devolve também `popups` (lib/client-popups.js, escopo no servidor). Falha das
// janelinhas não derruba o som: volta em `popupsError` (e no log), visível no console do navegador.
async function readPopups(auth, params) {
  if (params.get("popups") !== "1") return {};
  try {
    const result = await listClientPopups(auth, { since: params.get("popupsSince") || "" });
    return { popups: result.popups, popupsCursor: result.cursor };
  } catch (error) {
    console.error("[client-popups] falha ao ler as janelinhas de cliente novo:", error?.message || error);
    return { popupsError: error?.message || "Não foi possível ler os clientes novos." };
  }
}

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const brokerId = auth.profile?.id;
  const serverTime = new Date().toISOString();
  if (!brokerId) return NextResponse.json({ ok: true, clients: [], serverTime });

  const params = new URL(request.url).searchParams;
  const since = params.get("since") || serverTime;
  const popupsPromise = readPopups(auth, params);

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

    return NextResponse.json({ ok: true, clients, serverTime, ...(await popupsPromise) });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível verificar novos clientes." }, { status: 400 });
  }
}
