import Link from "next/link";
import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { formatCampaignError, getCampaign, getCampaignStatusBreakdown, listCampaignClients } from "@/lib/campaigns";
import { clientStatusLabel } from "@/lib/client-status";

export const dynamic = "force-dynamic";

export default async function CampaignClientsPage({ params }) {
  await requireBrokerManagementPage();
  const { id } = await params;

  let campaign = null;
  let clients = [];
  let statusBreakdown = [];
  let error = "";

  try {
    campaign = await getCampaign(id);
  } catch (loadError) {
    error = formatCampaignError(loadError);
  }

  if (!error && !campaign) notFound();

  if (!error) {
    try {
      [clients, statusBreakdown] = await Promise.all([listCampaignClients(id), getCampaignStatusBreakdown(id)]);
    } catch (loadError) {
      error = formatCampaignError(loadError);
    }
  }

  const conversion = campaign?.viewCount > 0 ? (campaign.submissionCount / campaign.viewCount) * 100 : null;

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Gerador de Links</p>
          <h1 className="mt-3 text-5xl font-black text-navy">{campaign?.name || "Performance do link"}</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Desempenho e funil dos cadastros que chegaram através deste link.
          </p>
        </div>
        <AdminLogoutButton />
      </section>

      <AdminSectionNav active="campaign-links" />

      <section className="container-page">
        <Link href="/admin/gerador-de-links" className="mb-5 inline-block font-bold text-brand hover:underline">
          ← Voltar para o Gerador de Links
        </Link>

        {error ? (
          <article className="rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro</p>
            <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
          </article>
        ) : (
          <div className="grid gap-6">
            <div className="grid grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-4">
              <StatCard label="Cliques" value={campaign?.viewCount || 0} />
              <StatCard label="Cadastros" value={campaign?.submissionCount || 0} />
              <StatCard label="Únicos" value={campaign?.clientCount || 0} />
              <StatCard label="Conversão" value={conversion === null ? "—" : `${conversion.toFixed(1)}%`} />
            </div>

            {statusBreakdown.length ? (
              <article className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
                <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Funil deste link</p>
                <h2 className="mt-2 text-2xl font-black text-navy">Onde os clientes estão hoje</h2>
                <p className="mt-2 text-sm font-bold text-muted">
                  Baseado nos {clients.length} cadastro{clients.length === 1 ? "" : "s"} ainda ativos no CRM — o total histórico de cadastros ({campaign?.clientCount || 0}) inclui também quem já foi excluído/arquivado e não some da estatística.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {statusBreakdown.map((stage) => (
                    <div key={stage.status} className="flex items-center justify-between rounded-2xl border border-line bg-mist px-4 py-3">
                      <span className="font-bold text-navy">{stage.label}</span>
                      <span className="text-xl font-black text-brand">{stage.count}</span>
                    </div>
                  ))}
                </div>
              </article>
            ) : null}

            <div className="grid gap-4">
            {clients.map((client) => (
              <Link
                key={client.originId}
                href={`/admin/cadastros/${client.id}`}
                className="flex flex-col gap-2 rounded-[24px] border border-line bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-brand hover:shadow-lg sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-xl font-black text-navy">{client.fullName || "Sem nome"}</h3>
                  <p className="font-bold text-muted">{client.phone || "Sem telefone"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-muted">
                  <span className="rounded-full bg-mist px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-navy">
                    {clientStatusLabel(client.status)}
                  </span>
                  <span>Cadastro: {formatDate(client.registeredViaLinkAt)}</span>
                </div>
              </Link>
            ))}

            {!clients.length ? (
              <article className="rounded-[28px] border border-line bg-white p-8 text-center font-black text-navy shadow-soft">
                Nenhum cadastro chegou por este link ainda.
              </article>
            ) : null}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value }) {
  return (
    <article className="rounded-2xl border border-line bg-white p-4 text-center shadow-soft">
      <p className="text-2xl font-black text-navy">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
    </article>
  );
}

function formatDate(value) {
  if (!value) return "Não informado";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
  } catch {
    return "Não informado";
  }
}
