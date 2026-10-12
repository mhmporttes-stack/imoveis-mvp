import Link from "next/link";
import AdminSectionNav from "@/components/AdminSectionNav";
import ClientWorkspace from "@/components/clients/ClientWorkspace";
import { buildBrokerSimulationLink, isBrokerProfile, isGeneralAdminAuth, isManagerProfile, isOwnerAdminEmail, listAdminProfiles } from "@/lib/admin-profiles";
import { requireAdminPage } from "@/lib/admin-auth";
import { listCalendarActivitiesForClients } from "@/lib/calendar-activities";
import { listTags } from "@/lib/client-tags";
import {
  getPendingClientsCount,
  getSimulationClientCounters,
  listSimulationClientsPage
} from "@/lib/simulation-list-query";
import { canManageSimulations } from "@/lib/simulations";
import { newRenderId } from "@/lib/render-id.mjs";
import { chatViewerKey } from "@/lib/chat-viewer-key.mjs";

export const dynamic = "force-dynamic";
// Voltar para Clientes na hora (pedido do dono, 2026-10-12): o navegador reaproveita esta tela por até 5 min em vez de
// esperar o servidor refazer tudo; ao reaproveitar, a lista se atualiza sozinha em segundo plano (useClientList,
// renderId). Sair da conta / "Alterar conta" chamam router.refresh(), que descarta o reaproveitamento.
export const unstable_dynamicStaleTime = 300;

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
    needsFirstContact: searchParams?.needsFirstContact === "1",
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
  const pinClientId = resolvedSearchParams?.clientId || "";

  // Visão padrão (sem filtros nem cliente fixado na URL): a lista vem pela própria tela, da MESMA API
  // (/api/simulation-registrations/list), e abre na hora com a lista já guardada desta conta (pré-carregada pelo AdminWarmup
  // ou da visita anterior, components/chat-view-cache.js) — desempenho, 2026-10-12. Links com filtro seguem montando no servidor.
  const isDefaultView = !pinClientId && JSON.stringify(filters) === JSON.stringify(filtersFromSearchParams({}));
  if (isDefaultView) {
    try {
      const [tagsResult, adminProfilesResult] = await Promise.all([listTags(), needsAdminProfiles ? listAdminProfiles() : Promise.resolve([])]);
      tags = tagsResult;
      adminProfiles = scopeAdminProfiles(adminProfilesResult, auth, isManager, needsAdminProfiles);
      initialData = { deferred: true, page: 1, pageSize: 20 };
    } catch (error) {
      loadError = error?.message || "Não foi possível carregar a lista de clientes.";
    }
  } else try {
    // Atividades da agenda dos clientes da página: encadeadas na própria busca da página, em paralelo com o resto
    // (antes esperavam tudo terminar — uma ida ao banco a mais em fila). Falha nelas = sem atividades, como antes.
    const pagePromise = listSimulationClientsPage({ auth, filters, page: 1, pageSize: 20, pinClientId });
    const activitiesPromise = pagePromise
      .then((pageResult) => listCalendarActivitiesForClients(pageResult.items.map((client) => client.id), auth))
      .then((activitiesByClient) => Object.fromEntries(activitiesByClient))
      .catch(() => ({}));
    const [pageResult, counters, pendingClientsCount, tagsResult, adminProfilesResult, clientActivities] = await Promise.all([
      pagePromise,
      getSimulationClientCounters({ auth, filters }),
      getPendingClientsCount({ auth }),
      listTags(),
      needsAdminProfiles ? listAdminProfiles() : Promise.resolve([]),
      activitiesPromise
    ]);

    tags = tagsResult;
    adminProfiles = scopeAdminProfiles(adminProfilesResult, auth, isManager, needsAdminProfiles);

    // renderId: identifica esta renderização — se o navegador reaproveitar a tela, a lista sabe que precisa se atualizar.
    initialData = { ...pageResult, counters, pendingClientsCount, clientActivities, renderId: newRenderId() };
  } catch (error) {
    loadError = error?.message || "Não foi possível carregar a lista de clientes.";
  }

  return (
    <main className="bg-mist pb-14 pt-3 md:pt-14">
      <AdminSectionNav active="simulations" />
      {!initialData ? (
        <SimulationError error={loadError} />
      ) : (
        <ClientWorkspace
          key={JSON.stringify(filters)}
          initialData={initialData}
          viewerKey={chatViewerKey(auth)}
          initialFilters={filters}
          adminProfiles={adminProfiles}
          canManageResponsibleUsers={isGeneralAdmin || isManager}
          canReturnAssignedProspecting={isOwnerAdminEmail(auth.user?.email) || isOwnerAdminEmail(auth.profile?.email)}
          isOwner={isOwnerAdminEmail(auth.user?.email) || isOwnerAdminEmail(auth.profile?.email)}
          brokerSimulationLink={isBrokerProfile(auth.profile) ? buildBrokerSimulationLink(auth.profile) : ""}
          tags={tags}
        />
      )}
    </main>
  );
}

// Gestor só escolhe responsáveis da própria equipe; admin vê todos; demais perfis não escolhem.
function scopeAdminProfiles(adminProfilesResult, auth, isManager, needsAdminProfiles) {
  if (!needsAdminProfiles) return [];
  return isManager
    ? adminProfilesResult.filter((profile) => (auth.profile.managedUserIds || [auth.profile.id]).includes(profile.id))
    : adminProfilesResult;
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
