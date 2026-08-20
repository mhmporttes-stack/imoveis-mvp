import Link from "next/link";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AdminFinancialDashboard from "@/components/AdminFinancialDashboard";
import { requirePrimaryAdminPage } from "@/lib/admin-auth";
import { canManageFinancial, formatFinancialError, listFinancialSales } from "@/lib/financial";

export const dynamic = "force-dynamic";

export default async function AdminFinancialPage() {
  await requirePrimaryAdminPage();

  if (!canManageFinancial()) {
    return <FinancialDisabled />;
  }

  let sales = [];

  try {
    sales = await listFinancialSales();
  } catch (error) {
    return <FinancialError error={formatFinancialError(error)} />;
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Financeiro</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Acompanhe VGV, comissões, repasses, recebimentos e valores em aberto das vendas realizadas.
          </p>
        </div>
        <AdminLogoutButton />
      </section>

      <AdminSectionNav active="financial" />
      <AdminFinancialDashboard initialSales={sales} />
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
