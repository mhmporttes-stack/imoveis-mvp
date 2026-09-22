import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listCalendarActivitiesForClients } from "@/lib/calendar-activities";
import {
  getPendingClientsCount,
  getSimulationClientCounters,
  listSimulationClientsPage
} from "@/lib/simulation-list-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint server-side da tela Clientes (/admin/simulacoes): busca, filtros,
// macro status, substatus e paginação são resolvidos aqui, no banco — nunca
// mais carregando a base inteira de cadastros para o navegador filtrar.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  const filters = {
    query: params.get("query") || "",
    responsibleUserId: params.get("responsibleUserId") || "all",
    tagId: params.get("tagId") || "all",
    pendingOnly: params.get("pending") === "1",
    staleContactOnly: params.get("staleContact") === "1",
    noFutureActivityOnly: params.get("noFutureActivity") === "1",
    statusGroup: params.get("statusGroup") || "all",
    status: params.get("status") || "all"
  };
  const page = Number(params.get("page")) || 1;
  const pageSize = Number(params.get("pageSize")) || undefined;

  try {
    const [pageResult, counters, pendingClientsCount] = await Promise.all([
      listSimulationClientsPage({ auth, filters, page, pageSize }),
      getSimulationClientCounters({ auth, filters }),
      getPendingClientsCount({ auth })
    ]);

    let clientActivities = {};
    try {
      const activitiesByClient = await listCalendarActivitiesForClients(
        pageResult.items.map((client) => client.id),
        auth
      );
      clientActivities = Object.fromEntries(activitiesByClient);
    } catch {
      clientActivities = {};
    }

    return NextResponse.json({
      items: pageResult.items,
      total: pageResult.total,
      totalPages: pageResult.totalPages,
      page: pageResult.page,
      pageSize: pageResult.pageSize,
      counters,
      pendingClientsCount,
      clientActivities
    });
  } catch (error) {
    console.error("Falha ao listar clientes:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível carregar a lista de clientes." }, { status: 500 });
  }
}
