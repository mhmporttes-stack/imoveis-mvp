import { handleCentral } from "@/lib/central/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  return handleCentral(request, "claim");
}
