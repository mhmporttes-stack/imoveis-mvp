import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getOpportunitiesPageData } from "@/lib/opportunities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const params = new URL(request.url).searchParams;
    const filters = {
      category: params.get("category") || "",
      stage: params.get("stage") || "",
      responsibleUserId: params.get("responsibleUserId") || "",
      tag: params.get("tag") || "",
      minPriority: params.has("minPriority") ? Number(params.get("minPriority")) : null,
      hasFutureActivity: params.has("hasFutureActivity") ? params.get("hasFutureActivity") === "true" : null
    };

    const data = await getOpportunitiesPageData(auth, {
      filters,
      search: params.get("search") || "",
      sort: params.get("sort") || "priority",
      page: Number(params.get("page")) || 1,
      pageSize: Number(params.get("pageSize")) || undefined
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível carregar as oportunidades." }, { status: error?.status || 400 });
  }
}
