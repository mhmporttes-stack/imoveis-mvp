import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminPresenceHeartbeat from "@/components/AdminPresenceHeartbeat";
import AdminViewAsBanner from "@/components/AdminViewAsBanner";
import BrokerCelebrationGate from "@/components/celebrations/BrokerCelebrationGate";
import DailyMessageGate from "@/components/DailyMessageGate";
import NewClientSoundListener from "@/components/NewClientSoundListener";
import TopRankingBadge from "@/components/TopRankingBadge";
import WhatsappIndividualStatus from "@/components/WhatsappIndividualStatus";
import SceneTransitionRoot from "@/components/motion/SceneTransitionRoot";
import SceneSkipCatcher from "@/components/motion/SceneSkipCatcher";
import { getAdminFromCookies } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }) {
  const auth = await getAdminFromCookies();

  return (
    <>
      {auth.ok ? <AdminPresenceHeartbeat userId={auth.profile?.id} /> : null}
      {auth.ok ? <NewClientSoundListener userId={auth.profile?.id} /> : null}
      {auth.ok ? <DailyMessageGate userId={auth.profile?.id} /> : null}
      {auth.ok ? <BrokerCelebrationGate userId={auth.profile?.id} /> : null}
      {auth.ok ? (
        // Ranking no início da página, no fluxo normal: rola junto com o
        // conteúdo e nunca fica sobre os cards de clientes.
        <div>
          {auth.accountSwitchMode ? (
            <AdminViewAsBanner name={auth.profile.name} category={roleLabel(auth.profile.role)} />
          ) : null}
          {/* pt-[env(safe-area-inset-top)]: no iPhone com notch/Dynamic
              Island (PWA em modo standalone, viewport-fit=cover já
              configurado), o topo da tela fica por baixo da barra de
              status do sistema — sem esse respiro o conteúdo do cabeçalho
              nasceria atrás dela. O fundo da barra continua se estendendo
              até o topo real (comportamento padrão esperado em PWAs). */}
          <header className="admin-ranking-header flex min-h-12 flex-wrap items-center justify-center gap-2 border-b border-line bg-white px-3 pt-[env(safe-area-inset-top)] sm:min-h-14 sm:px-6">
            <TopRankingBadge />
            {/* Fixo em toda aba, igual o campeão semanal/melhor do dia
                (pedido do dono, 2026-09-30: corretor não percebia o próprio
                WhatsApp cair porque esse indicador só existia dentro do
                Chat) — mesmo componente, agora sempre visível. */}
            <WhatsappIndividualStatus />
          </header>
        </div>
      ) : null}
      <SceneTransitionRoot>{children}</SceneTransitionRoot>
      <SceneSkipCatcher />
      {auth.ok ? (
        <div className="container-page flex justify-center py-10">
          <AdminLogoutButton />
        </div>
      ) : null}
    </>
  );
}

function roleLabel(role) {
  if (role === "admin") return "Administrador geral";
  if (role === "manager") return "Gestor";
  if (role === "associate") return "Associado";
  return "Corretor";
}
