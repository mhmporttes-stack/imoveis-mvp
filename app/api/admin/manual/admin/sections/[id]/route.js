import { requireAdminApi, requireGeneralAdminApi } from "@/lib/admin-auth";
import * as manual from "@/lib/manual";
import { manualRoute, readJson } from "@/app/api/admin/manual/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH: { status, cascade? } muda o status (Rascunho/Aguardando/Publicado/Descartado); caso contrário edita os campos.
export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await readJson(request);
  return manualRoute(request, async (auth) => {
    if (body.status !== undefined) return manual.setStatus(auth, "section", id, body.status, { cascade: body.cascade === true });
    return manual.updateSection(auth, id, body);
  }, requireGeneralAdminApi);
}
