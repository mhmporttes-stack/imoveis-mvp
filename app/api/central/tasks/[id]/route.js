import { handleCentral } from "@/lib/central/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  return handleCentral(request, "getTask", id);
}
