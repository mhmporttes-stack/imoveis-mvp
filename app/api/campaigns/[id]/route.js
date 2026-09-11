import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { buildCampaignLink, deleteCampaign, formatCampaignError, updateCampaign } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const payload = await request.json();
    const campaign = await updateCampaign(id, payload);
    if (!campaign) {
      return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ campaign: { ...campaign, link: buildCampaignLink(campaign) } });
  } catch (error) {
    return NextResponse.json({ error: formatCampaignError(error) || "Não foi possível atualizar a campanha." }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    await deleteCampaign(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatCampaignError(error) || "Não foi possível excluir a campanha." }, { status: 400 });
  }
}
