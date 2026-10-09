import Link from "next/link";
import AdminSectionNav from "@/components/AdminSectionNav";
import AdminFinancialDashboard from "@/components/AdminFinancialDashboard";
import { requireFinancialAccessPage } from "@/lib/admin-auth";
import { canManageFinancial, formatFinancialError, isExpectedReceiptOwner, listFinancialSales } from "@/lib/financial";
import { getHealthSettings, listExpenseOccurrences, listOperatingExpenses } from "@/lib/financial-health";
import { DEFAULT_HEALTH_SETTINGS, buildExpensePanel } from "@/lib/financial-health-core.mjs";
import { getTodayInSaoPaulo } from "@/lib/daily-report";
import { isGeneralAdminAuth, isManagerProfile, listAdminProfiles } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

export default async function AdminFinancialPage({ searchParams }) {
  const { aba } = (await searchParams) || {};
  const auth = await requireFinancialAccessPage();

  if (!canManageFinancial()) {
    return <FinancialDisabled />;
  }

  let sales = [];
  let financialUsers = [];

  try {
    const canEdit = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);
    [sales, financialUsers] = await Promise.all([listFinancialSales(auth), canEdit ? listAdminProfiles() : Promise.resolve([])]);
  } catch (error) {
    return <FinancialError error={formatFinancialError(error)} />;
  }

  // Aba "Saúde": só admin geral (dados da empresa inteira). Falha aqui (ex.: migration
  // ainda não aplicada) nunca derruba o resto do Financeiro — a aba mostra o aviso.
  let health = null;
  if (isGeneralAdminAuth(auth)) {
    try {
      const [expenses, settings, occurrences] = await Promise.all([listOperatingExpenses(), getHealthSettings(), listExpenseOccurrences()]);
      const today = getTodayInSaoPaulo();
      // panel: compromissos do mês (vencidas, vencem esta semana, total a pagar/pago, próximos) — só admin geral (este bloco)
      health = { expenses, settings, occurrences, today, panel: buildExpensePanel({ expenses, overrides: occurrences, today }), error: "" };
    } catch (error) {
      console.error("Nao foi possivel carregar a aba Saude do financeiro.", error);
      health = { expenses: [], occurrences: [], settings: { ...DEFAULT_HEALTH_SETTINGS }, today: getTodayInSaoPaulo(), panel: null, error: "Não foi possível carregar a aba Saúde. Verifique se a migration 20261002120000_financial_health.sql e 20261002190000_financial_expense_occurrences.sql e 20261003130000_financial_variable_expenses.sql foram aplicadas." };
    }
  }

  return (
    <main className="bg-mist py-14">
      <AdminSectionNav active="financial" />
      <AdminFinancialDashboard initialSales={sales} financialUsers={financialUsers} currentUser={auth.profile} health={health} canManageForecast={isExpectedReceiptOwner(auth)} canEdit={isGeneralAdminAuth(auth) || isManagerProfile(auth.profile)} initialTab={aba === "saude" ? "saude" : ""} />
    </main>
  );
}

function FinancialDisabled() {
  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Financeiro</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Módulo financeiro temporariamente desativado</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          Configure o Supabase administrativo para gerenciar vendas, comissões e recebimentos.
        </p>
        <Link href="/admin" className="mt-8 inline-flex premium-button-primary">Voltar ao painel</Link>
      </section>
    </main>
  );
}

function FinancialError({ error }) {
  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-red-200 bg-white p-10 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar financeiro</p>
        <h1 className="mt-3 text-5xl font-black text-navy">A página abriu, mas o Supabase retornou um erro.</h1>
        <p className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
        <p className="mt-4 max-w-3xl leading-8 text-muted">
          Confira se a migration <strong>supabase/migrations/20260820_financial_module.sql</strong> foi executada no SQL Editor do Supabase.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/admin/financeiro" className="premium-button-primary">Tentar novamente</Link>
          <Link href="/admin" className="premium-button-secondary">Voltar ao painel</Link>
        </div>
      </section>
    </main>
  );
}
