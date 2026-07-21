import Link from "next/link";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminRegistrationList from "@/components/AdminRegistrationList";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireAdminPage } from "@/lib/admin-auth";
import {
  canManageSimulationRegistrations,
  formatSimulationRegistrationError,
  listSimulationRegistrations
} from "@/lib/simulation-registrations";

export const dynamic = "force-dynamic";

export default async function AdminRegistrationsPage() {
  await requireAdminPage();

  if (!canManageSimulationRegistrations()) {
    return <RegistrationsDisabled />;
  }

  let registrations = [];
  let loadError = "";

  try {
    registrations = await listSimulationRegistrations();
  } catch (error) {
    loadError = formatSimulationRegistrationError(error);
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Cadastros</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Acompanhe os clientes que preencheram a simulação de financiamento pelo site.
          </p>
        </div>
        <AdminLogoutButton />
      </section>

      <AdminSectionNav active="registrations" />
      {loadError ? <RegistrationsError error={loadError} /> : <AdminRegistrationList registrations={registrations} />}
    </main>
  );
}

function RegistrationsDisabled() {
  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Cadastros</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Módulo temporariamente desativado</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          Configure o Supabase administrativo para visualizar os cadastros enviados pelo formulário.
        </p>
        <Link href="/admin" className="mt-8 inline-flex premium-button-primary">Voltar ao painel</Link>
      </section>
    </main>
  );
}

function RegistrationsError({ error }) {
  return (
    <section className="container-page rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar cadastros</p>
      <h2 className="mt-3 text-3xl font-black text-navy">A página abriu, mas o Supabase retornou um erro.</h2>
      <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
      <p className="mt-4 max-w-3xl leading-8 text-muted">
        Confira se a migration <strong>supabase/migrations/20260721_simulation_registrations.sql</strong> foi executada no SQL Editor do Supabase.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/admin/cadastros" className="premium-button-primary">Tentar novamente</Link>
        <Link href="/admin" className="premium-button-secondary">Voltar ao painel</Link>
      </div>
    </section>
  );
}
