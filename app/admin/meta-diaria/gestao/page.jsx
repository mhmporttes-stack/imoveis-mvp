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
