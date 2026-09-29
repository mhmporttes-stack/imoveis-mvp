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
      <AdminSectionNav active="online" />
      <OnlinePresenceBoard initialPresence={presence} initialError={error} />
      <Footer />
    </main>
  );
}
