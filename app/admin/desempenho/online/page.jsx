import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import Footer from "@/components/Footer";
import OnlinePresenceBoard from "@/components/OnlinePresenceBoard";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { canLoadAdminPresence, formatAdminPresenceError, getTeamPresence } from "@/lib/admin-presence";

export const dynamic = "force-dynamic";

export default async function AdminOnlinePresencePage() {
  const auth = await requireBrokerManagementPage();

  let presence = { online: 0, away: 0, offline: 0, members: [] };
  let error = "";

  if (canLoadAdminPresence()) {
    try {
      presence = await getTeamPresence(auth);
    } catch (loadError) {
      error = formatAdminPresenceError(loadError);
    }
  } else {
    error = "Configure o Supabase para carregar a presença da equipe.";
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Online</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Acompanhe quem está usando o CRM agora — presença baseada em atividade real, não apenas login.
          </p>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="online" />
      <OnlinePresenceBoard initialPresence={presence} initialError={error} />
      <Footer />
    </main>
  );
}
