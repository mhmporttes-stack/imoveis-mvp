import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { resolveAcademyActor } from "@/lib/academy-access-core.mjs";
import { academyDisabledResponse, academyErrorResponse, getAcademyService } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Estado do próprio aluno (perfil efetivo da sessão; nunca um userId vindo do cliente). Sem gabarito.
export async function GET(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const service = getAcademyService();
    if (!service) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json(await service.loadStudent(resolveAcademyActor(auth)));
  } catch (error) {
    return academyErrorResponse(error);
  }
}
