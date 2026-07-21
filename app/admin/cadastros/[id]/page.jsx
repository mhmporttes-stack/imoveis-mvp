import Link from "next/link";
import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import DeleteRegistrationButton from "@/components/DeleteRegistrationButton";
import RegistrationDetails from "@/components/RegistrationDetails";
import { requireAdminPage } from "@/lib/admin-auth";
import {
  canManageSimulationRegistrations,
  formatSimulationRegistrationError,
  getSimulationRegistration
} from "@/lib/simulation-registrations";

export const dynamic = "force-dynamic";

export default async function AdminRegistrationDetailsPage({ params }) {
  await requireAdminPage();
  const { id } = await params;

  if (!canManageSimulationRegistrations()) {
    return <RegistrationDetailsError error="Supabase administrativo não configurado para visualizar cadastros." />;
  }

  let registration = null;
  try {
    registration = await getSimulationRegistration(id);
  } catch (error) {
    return <RegistrationDetailsError error={formatSimulationRegistrationError(error)} />;
  }

  if (!registration) notFound();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Cadastro de simulação</p>
          <h1 className="mt-3 text-[clamp(2.4rem,5vw,4rem)] font-black leading-tight text-navy">
            {registration.fullName}
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Respostas enviadas pelo formulário público de simulação de financiamento.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/admin/cadastros" className="premium-button-secondary">Voltar aos cadastros</Link>
          <AdminLogoutButton />
        </div>
      </section>

      <RegistrationDetails registration={registration} />
      <div className="mt-6">
        <DeleteRegistrationButton registrationId={registration.id} registrationName={registration.fullName} />
      </div>
    </main>
  );
}

function RegistrationDetailsError({ error }) {
  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao abrir cadastro</p>
        <h1 className="mt-3 text-4xl font-black text-navy">Não foi possível carregar este cadastro.</h1>
        <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
        <Link href="/admin/cadastros" className="mt-8 inline-flex premium-button-primary">Voltar aos cadastros</Link>
      </section>
    </main>
  );
}
