import Link from "next/link";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { getAdReentryReport } from "@/lib/ad-reentries";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90];

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function AdReentriesPage({ searchParams }) {
  const auth = await requireBrokerManagementPage();
  const params = await searchParams;
  const days = PERIODS.includes(Number(params?.dias)) ? Number(params.dias) : 30;

  let report = { periodDays: days, total: 0, brokers: [] };
  let error = "";
  try {
    report = await getAdReentryReport({ days }, auth);
  } catch (loadError) {
    console.error("Ad reentry report failed:", loadError?.message || loadError);
    error = "Não foi possível carregar o relatório agora.";
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="reentries" />
      <div className="container-page space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-black text-navy">Reentradas por anúncio</h1>
          <p className="max-w-2xl text-sm font-semibold text-muted">
            Clientes que já estavam no CRM e voltaram a preencher o formulário por um anúncio. Cada um aparece com o corretor que o atendia na época.
          </p>
          <nav className="flex gap-2 text-xs font-bold" aria-label="Período">
            {PERIODS.map((period) => (
              <Link key={period} href={`/admin/desempenho/reentradas?dias=${period}`} className={`rounded-full border px-4 py-2 ${period === days ? "border-brand bg-brand text-white" : "border-brand/20 bg-white text-brand"}`}>
                {period} dias
              </Link>
            ))}
          </nav>
        </header>

        {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : null}

        {!error ? (
          <p className="text-sm font-bold text-navy">
            {report.total} {report.total === 1 ? "reentrada" : "reentradas"} nos últimos {report.periodDays} dias
          </p>
        ) : null}

        {!error && !report.brokers.length ? (
          <p className="rounded-2xl border border-line bg-white p-6 text-sm font-semibold text-muted">Nenhuma reentrada no período.</p>
        ) : null}

        <div className="space-y-4">
          {report.brokers.map((broker) => (
            <section key={broker.brokerId || "sem-responsavel"} className="rounded-2xl border border-line bg-white p-5 shadow-soft">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-black text-navy">{broker.brokerName}</h2>
                <span className="text-sm font-black text-brand">{broker.total}</span>
              </div>
              <ul className="mt-3 divide-y divide-line text-sm">
                {broker.clients.map((client, index) => (
                  <li key={`${client.clientId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/admin/simulacoes/${client.clientId}`} className="font-bold text-brand hover:underline">{client.clientName}</Link>
                    <span className="text-xs font-semibold text-muted">{[client.campaignName, formatDate(client.at)].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
