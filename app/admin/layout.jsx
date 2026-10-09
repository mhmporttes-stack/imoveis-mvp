import AdminBottomNav from "@/components/AdminBottomNav";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminPresenceHeartbeat from "@/components/AdminPresenceHeartbeat";
import AdminViewAsBanner from "@/components/AdminViewAsBanner";
import AlertCenterGate from "@/components/alerts/AlertCenterGate";
import BrokerCelebrationGate from "@/components/celebrations/BrokerCelebrationGate";
import DailyMessageGate from "@/components/DailyMessageGate";
import NewClientSoundListener from "@/components/NewClientSoundListener";
import SupervisionMessageGate from "@/components/supervision/SupervisionMessageGate";
import TopRankingBadge from "@/components/TopRankingBadge";
import WhatsappIndividualStatus from "@/components/WhatsappIndividualStatus";
import GoogleContactsStatus from "@/components/GoogleContactsStatus";
import SceneTransitionRoot from "@/components/motion/SceneTransitionRoot";
import SceneSkipCatcher from "@/components/motion/SceneSkipCatcher";
import { Manrope } from "next/font/google";
import Link from "next/link";
import { getAdminFromCookies, isOwnerAdminEmail } from "@/lib/admin-auth";
import { resolvePresenceProfileId } from "@/lib/admin-presence-core.mjs";
import { isAcademyEnabled } from "@/lib/academy-flags";
import { AcademyMenuProvider } from "@/components/AcademyMenuContext";
import { isAssociateProfile, isBrokerProfile, isGeneralAdminProfile, isManagerProfile } from "@/lib/admin-profiles";
import { WhatsappAccessProvider } from "@/components/WhatsappAccessProvider";
import { isBasicMode, isEffectivelyBlocked } from "@/lib/whatsapp-access-core.mjs";

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
  // Acesso WhatsApp bloqueado (2026-10-04): conexão/status da sessão, Chat e Meta Diária do corretor não são renderizados.
  const whatsappBlocked = auth.ok && isEffectivelyBlocked(auth.profile);

  return (
    <AcademyMenuProvider enabled={isAcademyEnabled()}>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_FONT_CSS }} />
      {/* Presença é do usuário REAL: em "Alterar conta" não usa o id do corretor emulado. */}
      {auth.ok ? <AdminPresenceHeartbeat userId={resolvePresenceProfileId(auth)} /> : null}
      {auth.ok ? <NewClientSoundListener userId={auth.profile?.id} /> : null}
      {auth.ok ? <DailyMessageGate userId={auth.profile?.id} /> : null}
      {auth.ok ? <BrokerCelebrationGate userId={auth.profile?.id} /> : null}
      {auth.ok && !auth.accountSwitchMode ? <SupervisionMessageGate userId={auth.profile?.id} /> : null}
      {/* Central de Alertas (Informativo/Importante) — fora de "Alterar conta", como a Supervisão. */}
      {auth.ok && !auth.accountSwitchMode ? <AlertCenterGate userId={auth.profile?.id} /> : null}
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
            {/* Os indicadores de integração ficam DENTRO dos cards do ranking
                (WhatsApp no Campeão da Semana, Google Contacts no Melhor do
                Dia, mesma coluna a ~75% da largura) — ver TopRankingBadge.
                WhatsApp é fixo em toda aba (pedido do dono, 2026-09-30:
                corretor não percebia o próprio WhatsApp cair). */}
            <TopRankingBadge
              weeklyIndicator={whatsappBlocked ? null : <WhatsappIndividualStatus align="end" />}
              dailyIndicator={<GoogleContactsStatus align="end" />}
            />
          </header>
        </div>
      ) : null}
      <WhatsappAccessProvider blocked={whatsappBlocked} basic={auth.ok && isBasicMode(auth.profile)}><SceneTransitionRoot>{children}</SceneTransitionRoot></WhatsappAccessProvider>
      <SceneSkipCatcher />
      {/* Navegação principal no celular (< md); do tablet para cima continua
          o AdminMenu do topo. Mesmos flags de perfil do AdminSectionNav. */}
      {auth.ok ? (
        <AdminBottomNav
          isAdmin={isGeneralAdminProfile(auth.profile)}
          isBroker={isBrokerProfile(auth.profile)}
          isAssociate={isAssociateProfile(auth.profile)}
          isManager={isManagerProfile(auth.profile)}
          whatsappBlocked={whatsappBlocked}
        />
      ) : null}
      {auth.ok ? (
        <div className="admin-page-footer container-page flex flex-col items-center gap-3 py-10">
          <AdminLogoutButton />
          {/* Verificação em duas etapas: só a conta REAL do dono (regra do dono, 2026-10-08). */}
          {isOwnerAdminEmail((auth.realUser || auth.user)?.email) ? (
            <Link className="text-sm font-extrabold text-brand transition hover:text-navy" href="/admin/seguranca">
              Segurança da conta (verificação em duas etapas)
            </Link>
          ) : null}
        </div>
      ) : null}
    </AcademyMenuProvider>
  );
}

function roleLabel(role) {
  if (role === "admin") return "Administrador geral";
  if (role === "manager") return "Gestor";
  if (role === "associate") return "Associado";
  return "Corretor";
}
