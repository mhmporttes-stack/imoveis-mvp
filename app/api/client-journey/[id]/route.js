import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getPrivateJourney, actOnJourney } from "@/lib/client-journey";
export const dynamic = "force-dynamic";
async function handle(request, context, write) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const id = (await context.params).id;
    const detail = write ? await actOnJourney(id, (await request.json()).action, auth) : await getPrivateJourney(id, auth);
    const { registration, ...result } = detail;
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.status === 403 ? "Acesso não autorizado." : error.message || "Não foi possível atualizar a jornada." }, { status: error.status === 403 ? 403 : 400 });
  }
}
export const GET = (request, context) => handle(request, context, false);
export const POST = (request, context) => handle(request, context, true);
