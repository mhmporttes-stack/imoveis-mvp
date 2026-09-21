import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AdminAiUsageDashboard from "@/components/AdminAiUsageDashboard";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { getAiUsageReport } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

// Cotação fixa configurável (item 3 do pedido) — mais simples e mais
// previsível que buscar uma cotação ao vivo pra um painel só informativo;
// ajustar via env var sempre que a cotação real mudar muito, sem precisar
// alterar código nem fazer deploy de novo.
const USD_BRL_RATE = Number(process.env.USD_BRL_RATE) || 5.3;

export default async function AdminAiUsagePage() {
  const auth = await requireGeneralAdminPage();

  let entries = [];
  let error = "";
  try {
    ({ entries } = await getAiUsageReport(auth));
  } catch (loadError) {
    error = loadError?.message || "Não foi possível carregar o extrato de gastos de IA.";
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Gastos de IA</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Extrato de cada análise de documentação feita pela IA, com estimativa de custo — acompanhe aqui sem precisar entrar no console da Anthropic.
          </p>
        </div>
        <AdminLogoutButton />
      </section>

      <AdminSectionNav active="ai-usage" />

      {error ? (
        <section className="container-page rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar extrato</p>
          <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
        </section>
      ) : (
        <AdminAiUsageDashboard initialEntries={entries} usdBrlRate={USD_BRL_RATE} />
      )}
    </main>
  );
}
