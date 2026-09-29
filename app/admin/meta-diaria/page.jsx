import AdminSectionNav from "@/components/AdminSectionNav";
import DailyGoalDashboard from "@/components/DailyGoalDashboard";
import TeamDailyPerformance from "@/components/TeamDailyPerformance";
import SceneTransitionLink from "@/components/motion/SceneTransitionLink";
import SceneGate from "@/components/motion/SceneGate";
import { isOwnerAdminEmail, requireAdminPage } from "@/lib/admin-auth";
import { canLoadDailyGoal, formatDailyGoalError, getBrokerDailyGoal, getOwnerTeamDailyOverview } from "@/lib/daily-goal";

export const dynamic = "force-dynamic";

export default async function MetaDiariaPage() {
  const auth = await requireAdminPage();
  // Visão gerencial da equipe é exclusiva do administrador principal (mesma
  // identificação usada em todo o app — isOwnerAdminEmail); qualquer outro
  // perfil (corretor, gestor, outro administrador) continua na tela normal,
  // sem nenhuma alteração de comportamento.
  const isOwner = isOwnerAdminEmail(auth.user?.email);

  if (isOwner) {
    return <OwnerMetaDiariaView auth={auth} />;
  }

  let goal = null;
  let error = "";

  if (canLoadDailyGoal()) {
    try {
      goal = await getBrokerDailyGoal(auth);
    } catch (loadError) {
      error = formatDailyGoalError(loadError);
    }
  } else {
    error = "Configure o Supabase para carregar a Meta Diária.";
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-8">
        <SceneTransitionLink href="/admin/simulacoes" direction="backward" className="block text-sm font-black uppercase tracking-[0.18em] text-brand">
          ← Painel principal
        </SceneTransitionLink>
      </section>
      <AdminSectionNav active="daily-goal" />
      {error ? (
        <section className="container-page rounded-[24px] border border-red-200 bg-white p-8 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar</p>
          <p className="mt-3 font-bold text-red-800">{error}</p>
        </section>
      ) : (
        <SceneGate>
          <DailyGoalDashboard initialGoal={goal} />
        </SceneGate>
      )}
    </main>
  );
}

async function OwnerMetaDiariaView({ auth }) {
  let overview = null;
  let error = "";

  if (canLoadDailyGoal()) {
    try {
      overview = await getOwnerTeamDailyOverview({ period: "today" }, auth);
    } catch (loadError) {
      error = formatDailyGoalError(loadError);
    }
  } else {
    error = "Configure o Supabase para carregar a Meta Diária.";
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-8">
        <SceneTransitionLink href="/admin/simulacoes" direction="backward" className="block text-sm font-black uppercase tracking-[0.18em] text-brand">
          ← Painel principal
        </SceneTransitionLink>
      </section>
      <AdminSectionNav active="daily-goal" />
      {error ? (
        <section className="container-page rounded-[24px] border border-red-200 bg-white p-8 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar</p>
          <p className="mt-3 font-bold text-red-800">{error}</p>
        </section>
      ) : (
        <TeamDailyPerformance initialOverview={overview} />
      )}
    </main>
  );
}
