import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { buildCampaignLink, canManageCampaigns, createCampaign, formatCampaignError, listCampaigns } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageCampaigns()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar campanhas." }, { status: 503 });
  }

  try {
    const url = new URL(request.url);
    const result = await listCampaigns({
      period: url.searchParams.get("period") || "",
      startDate: url.searchParams.get("startDate") || "",
      endDate: url.searchParams.get("endDate") || "",
      type: url.searchParams.get("type") || "all",
      search: url.searchParams.get("search") || ""
    });
    return NextResponse.json({ ...result, campaigns: result.campaigns.map(withLink) });
  } catch (error) {
    return NextResponse.json({ error: formatCampaignError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageCampaigns()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar campanhas." }, { status: 503 });
  }

  try {
    const payload = await request.json();
    const campaign = await createCampaign(payload);
    return NextResponse.json({ campaign: withLink(campaign) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: formatCampaignError(error) || "Não foi possível criar a campanha." }, { status: 400 });
  }
}

function withLink(campaign) {
  return { ...campaign, link: buildCampaignLink(campaign) };
}
