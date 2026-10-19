import AdminSectionNav from "@/components/AdminSectionNav";
import OnlinePresenceBoard from "@/components/OnlinePresenceBoard";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { canLoadAdminPresence, formatAdminPresenceError, getTeamPresence } from "@/lib/admin-presence";
import { newRenderId } from "@/lib/render-id.mjs";

export const dynamic = "force-dynamic";
// Online abre na hora (dono, 2026-10-19): pré-carregado ao abrir o painel (components/AdminWarmup.jsx) e reaproveitado
// por até 5 min, como Desempenho/Chat. Ao reaproveitar, a presença se atualiza em segundo plano (renderId).
export const unstable_dynamicStaleTime = 300;

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
      <OnlinePresenceBoard initialPresence={presence} initialError={error} renderId={newRenderId()} />
    </main>
  );
}
