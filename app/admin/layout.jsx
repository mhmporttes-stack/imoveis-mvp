import AdminBottomNav from "@/components/AdminBottomNav";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminPresenceHeartbeat from "@/components/AdminPresenceHeartbeat";
import AdminViewAsBanner from "@/components/AdminViewAsBanner";
import BrokerCelebrationGate from "@/components/celebrations/BrokerCelebrationGate";
import DailyMessageGate from "@/components/DailyMessageGate";
import NewClientSoundListener from "@/components/NewClientSoundListener";
import TopRankingBadge from "@/components/TopRankingBadge";
import WhatsappIndividualStatus from "@/components/WhatsappIndividualStatus";
import GoogleContactsStatus from "@/components/GoogleContactsStatus";
import SceneTransitionRoot from "@/components/motion/SceneTransitionRoot";
import SceneSkipCatcher from "@/components/motion/SceneSkipCatcher";
import { Manrope } from "next/font/google";
import { getAdminFromCookies } from "@/lib/admin-auth";
import { isAssociateProfile, isBrokerProfile, isGeneralAdminProfile, isManagerProfile } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

// Tipografia oficial do painel (escolha do dono em 2026-10-01, depois do
// comparativo Manrope × Inter). Carregada só nas rotas /admin — o site
// público continua com a pilha padrão de --font-ui (app/globals.css). A regra
// fica no :root (e não num wrapper) para valer também em modais renderizados
// por portal direto no <body>.
const manrope = Manrope({ subsets: ["latin"], display: "swap" });
const ADMIN_FONT_CSS = `:root{--font-ui:${manrope.style.fontFamily}, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;}`;

export default async function AdminLayout({ children }) {
  const auth = await getAdminFromCookies();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_FONT_CSS }} />
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
            {/* Os dois chips de integração ficam num grupo à parte, sempre
                um em cima do outro (pedido do dono, 2026-10-01: Google
                Contacts "solto" longe do WhatsApp parecia outra coisa) —
                o flex-wrap do header nunca mais separa um do outro. */}
            <div className="flex flex-col items-center gap-1.5">
              {/* Fixo em toda aba, igual o campeão semanal/melhor do dia
                  (pedido do dono, 2026-09-30: corretor não percebia o
                  próprio WhatsApp cair porque esse indicador só existia
                  dentro do Chat) — mesmo componente, agora sempre visível. */}
              <WhatsappIndividualStatus />
              {/* Integração paralela, independente do WhatsApp (pedido do
                  dono, 2026-10-01) — mesmo lugar, mesmo padrão visual, nunca
                  confundida com o status do WhatsApp. */}
              <GoogleContactsStatus />
            </div>
          </header>
        </div>
      ) : null}
      <SceneTransitionRoot>{children}</SceneTransitionRoot>
      <SceneSkipCatcher />
      {/* Navegação principal no celular (< md); do tablet para cima continua
          o AdminMenu do topo. Mesmos flags de perfil do AdminSectionNav. */}
      {auth.ok ? (
        <AdminBottomNav
          isAdmin={isGeneralAdminProfile(auth.profile)}
          isBroker={isBrokerProfile(auth.profile)}
          isAssociate={isAssociateProfile(auth.profile)}
          isManager={isManagerProfile(auth.profile)}
        />
      ) : null}
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
