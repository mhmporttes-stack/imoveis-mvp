import { requireAdminApi, requireGeneralAdminApi } from "@/lib/admin-auth";
import * as manual from "@/lib/manual";
import { manualRoute, readJson } from "@/app/api/admin/manual/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await readJson(request);
  return manualRoute(request, (auth) => manual.createTopic(auth, body), requireGeneralAdminApi);
}
