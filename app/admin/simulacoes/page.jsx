import Link from "next/link";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AdminSimulationList from "@/components/AdminSimulationList";
import { isGeneralAdminAuth, isManagerProfile, isOwnerAdminEmail, listAdminProfiles } from "@/lib/admin-profiles";
import { requireAdminPage } from "@/lib/admin-auth";
import { listCalendarActivitiesForClients } from "@/lib/calendar-activities";
import { listTags } from "@/lib/client-tags";
import {
  getPendingClientsCount,
  getSimulationClientCounters,
  listSimulationClientsPage
} from "@/lib/simulation-list-query";
import { canManageSimulations } from "@/lib/simulations";

export const dynamic = "force-dynamic";

// Filtros que a tela aceita vindo por link externo (ex.: painel de
// Desempenho) — preservados aqui para a primeira renderização (SSR) já
// abrir com o mesmo recorte, igual ao comportamento anterior.
function filtersFromSearchParams(searchParams) {
  return {
    query: searchParams?.query || "",
    responsibleUserId: searchParams?.responsibleUserId || "all",
    tagId: "all",
    pendingOnly: searchParams?.pending === "1",
    staleContactOnly: searchParams?.staleContact === "1",
    noFutureActivityOnly: searchParams?.noFutureActivity === "1",
    statusGroup: searchParams?.statusGroup || "all",
    status: searchParams?.status || "all"
  };
}

export default async function AdminSimulationsPage({ searchParams }) {
  const auth = await requireAdminPage();
  const resolvedSearchParams = (await searchParams) || {};

  if (!canManageSimulations()) {
    return <SimulationDisabled />;
  }

  let adminProfiles = [];
  let tags = [];
  let initialData = null;
  let loadError = "";

  const isGeneralAdmin = isGeneralAdminAuth(auth);
  const isManager = isManagerProfile(auth.profile);
  const needsAdminProfiles = isGeneralAdmin || isManager;
  const filters = filtersFromSearchParams(resolvedSearchParams);

  try {
    const [pageResult, counters, pendingClientsCount, tagsResult, adminProfilesResult] = await Promise.all([
      listSimulationClientsPage({ auth, filters, page: 1 }),
      getSimulationClientCounters({ auth, filters }),
      getPendingClientsCount({ auth }),
      listTags(),
      needsAdminProfiles ? listAdminProfiles() : Promise.resolve([])
    ]);

    tags = tagsResult;
    adminProfiles = needsAdminProfiles
      ? (isManager
        ? adminProfilesResult.filter((profile) => (auth.profile.managedUserIds || [auth.profile.id]).includes(profile.id))
        : adminProfilesResult)
      : [];

    let clientActivities = {};
    try {
      const activitiesByClient = await listCalendarActivitiesForClients(pageResult.items.map((client) => client.id), auth);
      clientActivities = Object.fromEntries(activitiesByClient);
    } catch {
      clientActivities = {};
    }

    initialData = { ...pageResult, counters, pendingClientsCount, clientActivities };
  } catch (error) {
    loadError = error?.message || "Não foi possível carregar a lista de clientes.";
  }

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Clientes</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Acompanhe cadastros recebidos, simulações realizadas e clientes aguardando atendimento.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/admin/simulacoes/nova" className="premium-button-primary">Novo cliente</Link>
          <AdminLogoutButton />
        </div>
      </section>
      <AdminSectionNav active="simulations" />
      {!initialData ? (
        <SimulationError error={loadError} />
      ) : (
        <AdminSimulationList
          initialData={initialData}
          initialFilters={filters}
          adminProfiles={adminProfiles}
          canManageResponsibleUsers={isGeneralAdmin || isManager}
          canReturnAssignedProspecting={isOwnerAdminEmail(auth.user?.email) || isOwnerAdminEmail(auth.profile?.email)}
          isOwner={isOwnerAdminEmail(auth.user?.email) || isOwnerAdminEmail(auth.profile?.email)}
          tags={tags}
        />
      )}
    </main>
  );
}

function SimulationDisabled() {
  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Gerador de Simulações</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Módulo temporariamente desativado</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          Configure o Supabase administrativo para salvar e recuperar simulações.
        </p>
        <Link href="/admin" className="mt-8 inline-flex premium-button-primary">Voltar ao painel</Link>
      </section>
    </main>
  );
}

function SimulationError({ error }) {
  return (
    <section className="container-page rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar simulações</p>
      <h2 className="mt-3 text-3xl font-black text-navy">A página abriu, mas o Supabase retornou um erro.</h2>
      <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
      <p className="mt-4 max-w-3xl leading-8 text-muted">
        Confira se as migrations do Supabase foram executadas, incluindo as colunas de usuário responsável quando usar corretores.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/admin/simulacoes" className="premium-button-primary">Tentar novamente</Link>
        <Link href="/admin" className="premium-button-secondary">Voltar ao painel</Link>
      </div>
    </section>
  );
}
