import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import DailyGoalDashboard from "@/components/DailyGoalDashboard";
import { requireAdminPage } from "@/lib/admin-auth";
import { canLoadDailyGoal, formatDailyGoalError, getBrokerDailyGoal } from "@/lib/daily-goal";

export const dynamic = "force-dynamic";

export default async function MetaDiariaPage() {
  const auth = await requireAdminPage();
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
      <section className="container-page mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Meta Diária</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            Sua cadência de prospecção e reativação de hoje — o sistema já monta a fila, você só executa.
          </p>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="daily-goal" />
      {error ? (
        <section className="container-page rounded-[24px] border border-red-200 bg-white p-8 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar</p>
          <p className="mt-3 font-bold text-red-800">{error}</p>
        </section>
      ) : (
        <DailyGoalDashboard initialGoal={goal} />
      )}
    </main>
  );
}
