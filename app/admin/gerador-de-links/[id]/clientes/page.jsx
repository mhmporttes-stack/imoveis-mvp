import Link from "next/link";
import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { formatCampaignError, getCampaign, listCampaignClients } from "@/lib/campaigns";
import { clientStatusLabel } from "@/lib/client-status";

export const dynamic = "force-dynamic";

export default async function CampaignClientsPage({ params }) {
  await requireBrokerManagementPage();
  const { id } = await params;

  let campaign = null;
  let clients = [];
  let error = "";

  try {
    campaign = await getCampaign(id);
  } catch (loadError) {
    error = formatCampaignError(loadError);
  }

  if (!error && !campaign) notFound();

  if (!error) {
    try {
      clients = await listCampaignClients(id);
    } catch (loadError) {
      error = formatCampaignError(loadError);
    }
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Gerador de Links</p>
          <h1 className="mt-3 text-5xl font-black text-navy">{campaign?.name || "Clientes da campanha"}</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Cadastros que chegaram através deste link de campanha.
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
        )}
      </section>
    </main>
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
