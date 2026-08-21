import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AdminUsersManager from "@/components/AdminUsersManager";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import {
  buildBrokerCaptacaoLink,
  buildBrokerSimulationLink,
  formatBrokerSchemaError,
  listAdminProfiles
} from "@/lib/admin-profiles";
import { formatSimulationRegistrationError, listSimulationRegistrations } from "@/lib/simulation-registrations";

export const dynamic = "force-dynamic";

export default async function AdminBrokersPage() {
  const auth = await requireGeneralAdminPage();

  let users = [];
  let registrations = [];
  let error = "";

  try {
    users = await listAdminProfiles();
  } catch (loadError) {
    error = formatBrokerSchemaError(loadError);
  }

  try {
    registrations = await listSimulationRegistrations({ auth });
  } catch (loadError) {
    if (!error) error = formatSimulationRegistrationError(loadError);
  }

  const counts = buildCounts(registrations);
  const usersWithLinks = users.map((user) => ({
    ...user,
    simulationLink: buildBrokerSimulationLink(user),
    captacaoLink: buildBrokerCaptacaoLink(user)
  }));

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Corretores</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Cadastre usuários, gerencie acessos e copie links exclusivos de simulação e captação.
          </p>
        </div>
        <AdminLogoutButton />
      </section>

      <AdminSectionNav active="brokers" />
      {error ? <BrokersError error={error} /> : <AdminUsersManager initialUsers={usersWithLinks} counts={counts} />}
    </main>
  );
}

function buildCounts(registrations = []) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
  const today = formatter.format(new Date());

  return registrations.reduce((acc, registration) => {
    const key = registration.responsibleUserId || "unassigned";
    if (!acc[key]) acc[key] = { total: 0, today: 0 };
    acc[key].total += 1;

    if (registration.createdAt && formatter.format(new Date(registration.createdAt)) === today) {
      acc[key].today += 1;
    }

    return acc;
  }, {});
}

function BrokersError({ error }) {
  return (
    <section className="container-page rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar corretores</p>
      <h2 className="mt-3 text-3xl font-black text-navy">Não foi possível carregar os usuários.</h2>
      <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
    </section>
  );
}
