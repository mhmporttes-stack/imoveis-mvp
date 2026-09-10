import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import CampaignsManager from "@/components/CampaignsManager";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { buildCampaignLink, canManageCampaigns, formatCampaignError, listCampaigns } from "@/lib/campaigns";
import { listAdminProfiles } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

export default async function AdminCampaignLinksPage() {
  await requireBrokerManagementPage();

  if (!canManageCampaigns()) {
    return <CampaignsDisabled />;
  }

  let campaigns = [];
  let brokers = [];
  let error = "";

  try {
    campaigns = (await listCampaigns()).map((campaign) => ({ ...campaign, link: buildCampaignLink(campaign) }));
  } catch (loadError) {
    error = formatCampaignError(loadError);
  }

  try {
    const profiles = await listAdminProfiles();
    brokers = profiles.filter((profile) => ["admin", "broker"].includes(profile.role) && profile.status === "active");
  } catch {
    brokers = [];
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Gestão</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Gerador de Links</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Crie URLs exclusivas de campanha, vinculadas à roleta ou a um corretor específico, e acompanhe automaticamente a origem de cada cadastro.
          </p>
        </div>
        <AdminLogoutButton />
      </section>

      <AdminSectionNav active="campaign-links" />

      {error ? <CampaignsError error={error} /> : <CampaignsManager initialCampaigns={campaigns} brokers={brokers} />}
    </main>
  );
}

function CampaignsDisabled() {
  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-line bg-white p-8 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Gerador de Links</p>
        <h2 className="mt-3 text-3xl font-black text-navy">Supabase administrativo não configurado.</h2>
        <p className="mt-4 text-muted">Configure as variáveis do Supabase para gerenciar campanhas.</p>
      </section>
    </main>
  );
}

function CampaignsError({ error }) {
  return (
    <section className="container-page rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar campanhas</p>
      <h2 className="mt-3 text-3xl font-black text-navy">Não foi possível carregar o Gerador de Links.</h2>
      <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
    </section>
  );
}
