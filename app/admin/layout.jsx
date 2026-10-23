import AdminBottomNav from "@/components/AdminBottomNav";
import AdminMenu from "@/components/AdminMenu";
import AdminTopBar from "@/components/AdminTopBar";
import AdminScrollReveal from "@/components/motion/AdminScrollReveal";
import AdminWarmup from "@/components/AdminWarmup";
import HenryVoiceAssistant from "@/components/henry/HenryVoiceAssistant";
import { chatViewerKey } from "@/lib/chat-viewer-key.mjs";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminPresenceHeartbeat from "@/components/AdminPresenceHeartbeat";
import AdminViewAsBanner from "@/components/AdminViewAsBanner";
import NotificationHistoryButton from "@/components/alerts/NotificationHistoryButton";
import CooledClientsInbox from "@/components/cooled/CooledClientsInbox";
import DeferredPanelGates from "@/components/DeferredPanelGates";
import FirstAccessGate from "@/components/FirstAccessGate";
import NewClientSoundListener from "@/components/NewClientSoundListener";
import OfficePresenceNotice from "@/components/OfficePresenceNotice";
import TopRankingBadge from "@/components/TopRankingBadge";
import WhatsappIndividualStatus from "@/components/WhatsappIndividualStatus";
import HideInFinanceiroApp from "@/components/HideInFinanceiroApp";
import GoogleContactsStatus from "@/components/GoogleContactsStatus";
import SceneTransitionRoot from "@/components/motion/SceneTransitionRoot";
import { ADMIN_FONT_CSS } from "@/components/admin-font";
import Link from "next/link";
import { getAdminFromCookies, isOwnerAdminEmail } from "@/lib/admin-auth";
import { resolvePresenceProfileId } from "@/lib/admin-presence-core.mjs";
import { isAcademyEnabled } from "@/lib/academy-flags";
import { AcademyMenuProvider } from "@/components/AcademyMenuContext";
import { isAssociateProfile, isBrokerProfile, isGeneralAdminAuth, isGeneralAdminProfile, isManagerProfile } from "@/lib/admin-profiles";
import { WhatsappAccessProvider } from "@/components/WhatsappAccessProvider";
import { hiddenNavKeys, isBasicMode, isEffectivelyBlocked } from "@/lib/whatsapp-access-core.mjs";
import { readChatHiddenForNav } from "@/lib/whatsapp-manual-disconnect";
import { printedListModeAppliesTo } from "@/lib/whatsapp-manual-disconnect-core.mjs";

export const dynamic = "force-dynamic";

// Tipografia oficial do painel: components/admin-font.js (a mesma das telas de entrada, app/painel-acesso).

export default async function AdminLayout({ children }) {
  const auth = await getAdminFromCookies();
  // Acesso WhatsApp bloqueado (2026-10-04): conexão/status da sessão, Chat e Meta Diária do corretor não são renderizados.
  const whatsappBlocked = auth.ok && isEffectivelyBlocked(auth.profile);
  // Modo lista impressa (PRO-15, 2026-10-15): WhatsApp desconectado (não banido/restrito) tira o Chat do menu.
  const chatHidden = auth.ok && !whatsappBlocked && (await readChatHiddenForNav(auth));

  return (
    <AcademyMenuProvider enabled={isAcademyEnabled()}>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_FONT_CSS }} />
      {/* Presença é do usuário REAL: em "Alterar conta" não usa o id do corretor emulado. */}
      {auth.ok ? <AdminPresenceHeartbeat userId={resolvePresenceProfileId(auth)} /> : null}
      {auth.ok ? <NewClientSoundListener userId={auth.profile?.id} /> : null}
      {/* App "Financeiro" da tela inicial: sem mensagens/celebrações/alertas do painel por cima (só o Financeiro). */}
      <HideInFinanceiroApp>
      {/* Primeiro acesso do dia do DONO (INI-4, 2026-10-22): abre o Início e a Alexa fala o bom dia (servidor). Só a conta
          real do dono, fora de "Alterar conta"; a rota confere de novo. Outros perfis: nada muda. */}
      {auth.ok && !auth.accountSwitchMode && isOwnerAdminEmail(auth.user?.email) ? <FirstAccessGate /> : null}
      {/* Mensagem do Dia, Celebração, Supervisão e Central de Alertas: carregados quando a tela fica ociosa
          (components/DeferredPanelGates.jsx — velocidade, etapa 3). Mesmas condições de sempre: Supervisão e Central de
          Alertas (Informativo/Importante) ficam fora de "Alterar conta". */}
      {auth.ok ? (
        <DeferredPanelGates
          daily={{ userId: auth.profile?.id, userName: auth.profile?.name || "" }}
          celebration={{ userId: auth.profile?.id, userName: auth.profile?.name || "", userPhotoUrl: auth.profile?.photoUrl || "" }}
          supervision={auth.accountSwitchMode ? null : { userId: auth.profile?.id }}
          alerts={auth.accountSwitchMode ? null : { userId: auth.profile?.id }}
        />
      ) : null}
      </HideInFinanceiroApp>
      {/* O provider envolve o cabeçalho, o menu lateral e a barra inferior: o modo lista impressa (PRO-15) é relido no
          cliente e o Chat volta sozinho quando o WhatsApp reconecta, sem fechar o app (components/WhatsappAccessProvider.jsx). */}
      <WhatsappAccessProvider blocked={whatsappBlocked} basic={auth.ok && isBasicMode(auth.profile)} chatHidden={chatHidden} liveCheck={auth.ok && printedListModeAppliesTo({ role: auth.profile?.role || "", isGeneralAdmin: isGeneralAdminAuth(auth) })}>
      {auth.ok ? (
        // Menu lateral do computador (visual novo, dono, 2026-10-22): mesmos grupos de getAdminMenuGroups; no celular a
        // navegação continua na barra inferior.
        <AdminMenu
          {...navFlags(auth, whatsappBlocked, chatHidden)}
          user={{ name: auth.profile?.name || "", photoUrl: auth.profile?.photoUrl || "", roleLabel: roleLabel(auth.profile?.role) }}
        />
      ) : null}
      {auth.ok ? (
        // Cabeçalho e ranking no início da página, no fluxo normal: rolam junto com o
        // conteúdo e nunca ficam sobre os cards de clientes.
        <div className="mm-app-hide">
          {auth.accountSwitchMode ? (
            <AdminViewAsBanner name={auth.profile.name} category={roleLabel(auth.profile.role)} />
          ) : null}
          {/* Título/subtítulo da tela, busca, atalhos, sol/lua, Online e "Visualizar como corretor" (só admin geral real,
              fora do "Alterar conta"). O respiro do iPhone (safe-area) fica no próprio cabeçalho. */}
          <AdminTopBar
            {...navFlags(auth, whatsappBlocked, chatHidden)}
            canViewAs={!auth.accountSwitchMode && isGeneralAdminProfile(auth.realProfile || auth.profile)}
            extraShortcuts={auth.accountSwitchMode ? null : (
              <>
                {isOwnerAdminEmail(auth.user?.email) || isManagerProfile(auth.profile) ? <CooledClientsInbox align="end" variant="topbar" /> : null}
                <NotificationHistoryButton align="end" variant="topbar" />
              </>
            )}
          />
          {/* Campeão da semana / Melhor do dia em todas as telas, menos o Chat (app/globals.css esconde no Chat).
              Os indicadores de integração ficam DENTRO dos cards do ranking
              (WhatsApp no Campeão da Semana, Google Contacts no Melhor do
              Dia) — ver TopRankingBadge. Sino e "esfriados" foram para o cabeçalho (crítica do visual novo, 2026-10-22). WhatsApp é fixo em toda aba (pedido do dono, 2026-09-30:
              corretor não percebia o próprio WhatsApp cair). */}
          <header className="admin-ranking-header container-page flex flex-wrap items-center gap-2">
            <TopRankingBadge
              weeklyIndicator={whatsappBlocked ? null : <WhatsappIndividualStatus align="end" />}
              dailyIndicator={<GoogleContactsStatus align="end" />}
            />
          </header>
        </div>
      ) : null}
      {/* ROL-2f: aviso "fora da roleta, venha à imobiliária" (só para quem participa da roleta e não veio). */}
      {auth.ok && !auth.accountSwitchMode ? (
        <HideInFinanceiroApp>
          <OfficePresenceNotice />
        </HideInFinanceiroApp>
      ) : null}
      {/* Entrada dos blocos por rolagem (visual novo): respeita "reduzir movimento"; o Chat fica de fora. */}
      {auth.ok ? <AdminScrollReveal /> : null}
      {/* Assistente de voz "Henry" (HENRY-1, dono 2026-10-22): só o dono, conta real, fora de "Alterar conta"; a rota
          /api/admin/henry confere de novo. Computador: escuta contínua; celular (app): tocar no anel para falar. */}
      {auth.ok && !auth.accountSwitchMode && isOwnerAdminEmail(auth.user?.email) ? (
        <HideInFinanceiroApp>
          <HenryVoiceAssistant />
        </HideInFinanceiroApp>
      ) : null}
      <SceneTransitionRoot>{children}</SceneTransitionRoot>
      {/* Indicador "carregando" da transição de cena (SceneSkipCatcher) removido a pedido do dono (2026-10-12): ficava
          girando parado sobre a Meta Diária. A tela de baixo já fica interativa; nada mais depende dele. */}
      {/* Navegação principal no celular (< md); do tablet para cima é o menu lateral (AdminMenu). Mesmos flags de perfil. */}
      {/* Pré-carrega Clientes, a barra, o cabeçalho e depois todo o menu do perfil (celular e computador, 2026-10-22). */}
      {auth.ok ? <AdminWarmup {...warmupTargets(auth, whatsappBlocked, chatHidden)} nav={navFlags(auth, whatsappBlocked, chatHidden)} /> : null}
      {auth.ok ? (
        <AdminBottomNav {...navFlags(auth, whatsappBlocked, chatHidden)} />
      ) : null}
      </WhatsappAccessProvider>
      {auth.ok ? (
        <div className="admin-page-footer container-page flex flex-col items-center gap-3 py-10">
          <AdminLogoutButton />
          {/* Verificação em duas etapas: só a conta REAL do dono ou de um gestor (regra do dono, 2026-10-08/09). */}
          {isOwnerAdminEmail((auth.realUser || auth.user)?.email) || isManagerProfile(auth.realProfile || auth.profile) ? (
            <Link className="mm-app-hide text-sm font-extrabold text-brand transition hover:text-navy" href="/admin/seguranca">
              Segurança da conta (verificação em duas etapas)
            </Link>
          ) : null}
        </div>
      ) : null}
    </AcademyMenuProvider>
  );
}

// Pré-carregamento (components/AdminWarmup.jsx): as telas que a barra inferior mostra para esta conta
// (AdminBottomNav: Online/Clientes/Chat/Desempenho no admin geral; Meta/Clientes/Chat/Agenda no gestor;
// Simulador/Clientes/Chat/Agenda no corretor e associado; hiddenNavKeys tira o Chat de quem tem WhatsApp bloqueado).
function warmupTargets(auth, whatsappBlocked, chatHidden = false) {
  const isAdmin = isGeneralAdminProfile(auth.profile);
  const isManager = !isAdmin && isManagerProfile(auth.profile);
  const hidden = hiddenNavKeys({
    blocked: whatsappBlocked,
    chatHidden,
    isBrokerOrAssociate: (isBrokerProfile(auth.profile) || isAssociateProfile(auth.profile)) && !isManagerProfile(auth.profile) && !isAdmin
  });
  const chat = !hidden.has("chat");
  return {
    viewerKey: chatViewerKey(auth),
    chat,
    performance: isAdmin,
    clients: true,
    // Chat do Marketplace está na barra de todos os perfis (AdminBottomNav); escopo da lista decidido no servidor.
    marketplace: true,
    fullRoutes: [
      "/admin/simulacoes",
      ...(chat ? ["/admin/chat"] : []),
      "/admin/chat/marketplace",
      // Admin geral (dono, 2026-10-19): "Online" no lugar da Meta Diária — a Meta saiu da barra dele em 2026-10-13 e
      // continuava sendo montada ao abrir o app (visão da equipe inteira, pesada). Online só lê a presença da equipe.
      ...(isAdmin ? ["/admin/desempenho/online", "/admin/desempenho"] : []),
      // Meta Diária NÃO é montada ao abrir o app para nenhum perfil (dono, 2026-10-19, MD-16): monta só quando a pessoa
      // abre a Meta. A entrega dos contatos do dia é do servidor (automação, lib/daily-goal-auto.js).
      // Simulador Caixa (barra do corretor/associado): a página não consulta o banco, só confere o login.
      ...(!isAdmin && !isManager ? ["/admin/simulador-caixa"] : [])
    ],
    lightRoutes: isAdmin ? [] : ["/admin/calendario"]
  };
}

// Flags de perfil da navegação (menu lateral, cabeçalho e barra inferior) — as mesmas de sempre do AdminSectionNav.
function navFlags(auth, whatsappBlocked, chatHidden) {
  return {
    isAdmin: isGeneralAdminProfile(auth.profile),
    isBroker: isBrokerProfile(auth.profile),
    isAssociate: isAssociateProfile(auth.profile),
    isManager: isManagerProfile(auth.profile),
    whatsappBlocked,
    chatHidden
  };
}

function roleLabel(role) {
  if (role === "admin") return "Administrador geral";
  if (role === "manager") return "Gestor";
  if (role === "associate") return "Associado";
  return "Corretor";
}
