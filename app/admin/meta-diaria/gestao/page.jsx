import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import DailyGoalAdmin from "@/components/DailyGoalAdmin";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { formatDailyGoalError, getDailyGoalSettings } from "@/lib/daily-goal";

export const dynamic = "force-dynamic";

export default async function MetaDiariaGestaoPage() {
  const auth = await requireBrokerManagementPage();
  let settings = null;
  let error = "";

  try {
    settings = await getDailyGoalSettings(auth);
  } catch (loadError) {
    error = formatDailyGoalError(loadError);
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Gestão</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Meta Diária</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            Configure a cadência, as mensagens e acompanhe a execução e conversão da equipe.
          </p>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="daily-goal-admin" />
      {error ? (
        <section className="container-page rounded-[24px] border border-red-200 bg-white p-8 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar</p>
          <p className="mt-3 font-bold text-red-800">{error}</p>
        </section>
      ) : (
        <DailyGoalAdmin initialSettings={settings} />
      )}
    </main>
  );
}
