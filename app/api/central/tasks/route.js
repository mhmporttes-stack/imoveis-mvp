import { handleCentral } from "@/lib/central/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  return handleCentral(request, "createTask");
}

// listarTarefas: somente leitura. Sem PUT/PATCH/DELETE exportados = 405 pelo Next.
export async function GET(request) {
  return handleCentral(request, "listTasks");
}
