"use client";

import { useEffect, useState } from "react";
import AdminBottomNav from "@/components/AdminBottomNav";
import AdminMenu from "@/components/AdminMenu";
import AdminTopBar from "@/components/AdminTopBar";
import AdminScrollReveal from "@/components/motion/AdminScrollReveal";
import ClientWorkspace from "@/components/clients/ClientWorkspace";
import DailyGoalDashboard from "@/components/DailyGoalDashboard";
import DailyGoalCompensationNotice from "@/components/DailyGoalCompensationNotice";
import PerformanceOverviewDashboard from "@/components/PerformanceOverviewDashboard";
import TeamDailyPerformance from "@/components/TeamDailyPerformance";
import WhatsappChat from "@/components/WhatsappChat";
import MarketplaceChat from "@/components/marketplace/MarketplaceChat";
import * as chatMarketplace from "../_fixtures/chat-marketplace";
import SupervisionMessageGate from "@/components/supervision/SupervisionMessageGate";
import { installMockFetch } from "../_lib/mock-fetch";
import { FONTES } from "../_lib/fonts";
import Fundacao from "./Fundacao";
import * as comum from "../_fixtures/comum";
import * as clientes from "../_fixtures/clientes";
import * as chat from "../_fixtures/chat";
import * as metaDiaria from "../_fixtures/meta-diaria";
import * as desempenho from "../_fixtures/desempenho";
import * as supervisao from "../_fixtures/supervisao";
import * as alertas from "../_fixtures/alertas";
import AlertCenterGate from "@/components/alerts/AlertCenterGate";
import AdsBoard from "@/components/ads/AdsBoard";
import OnlinePresenceBoard from "@/components/OnlinePresenceBoard";
import * as online from "../_fixtures/online";
import * as anuncios from "../_fixtures/anuncios";
import FinancialHealthTab from "@/components/FinancialHealthTab";
import * as financeiroSaude from "../_fixtures/financeiro-saude";
import AdminFinancialDashboard from "@/components/AdminFinancialDashboard";
import * as financeiroVendas from "../_fixtures/financeiro-vendas";
import AutoClick from "./AutoClick";
import ActivityCalendar from "@/components/ActivityCalendar";
import CaixaSimulator from "@/components/CaixaSimulator";
import AdminUsersManager from "@/components/AdminUsersManager";
import CampaignsManager from "@/components/CampaignsManager";
import AdminAiUsageDashboard from "@/components/AdminAiUsageDashboard";
import DailyGoalAdmin from "@/components/DailyGoalAdmin";
import AutomationRulesManager from "@/components/AutomationRulesManager";
import CrmNotificationsList from "@/components/CrmNotificationsList";
import ProspectingTabs from "@/components/ProspectingTabs";
import AdminViewAsSelector from "@/components/AdminViewAsSelector";
import DocumentAiRulesManager from "@/components/DocumentAiRulesManager";
import GuideManager from "@/components/guide/GuideManager";
import AdminPropertyList from "@/components/AdminPropertyList";
import * as telas from "../_fixtures/telas";
import ManualBrowser from "@/components/manual/ManualBrowser";
import ManualAdmin from "@/components/manual/ManualAdmin";
import * as manual from "../_fixtures/manual";
import * as rankingTopo from "../_fixtures/ranking-topo";
import TopRankingBadge from "@/components/TopRankingBadge";
import CooledClientsInbox from "@/components/cooled/CooledClientsInbox";
import NotificationHistoryButton from "@/components/alerts/NotificationHistoryButton";
import WhatsappIndividualStatus from "@/components/WhatsappIndividualStatus";
import GoogleContactsStatus from "@/components/GoogleContactsStatus";
import Cenas from "./Cenas";
import PainelInicio, { InicioFunil, InicioFunilCarregando, InicioKpisMes, InicioKpisMesCarregando } from "@/components/inicio/PainelInicio";
import * as inicio from "../_fixtures/inicio";

// Cada tela reproduz o <main> da página real (app/admin/...) com o
// componente real e dados 100% fictícios. Ao criar uma tela nova aqui,
// espelhe o wrapper da página correspondente.
const TELAS = {
  inicio: {
    // Início (INI-1, dono, 2026-10-22). ?variante=vazio (dia sem pendências) | carregando (mês ainda chegando).
    path: "/admin/inicio",
    titulo: "Início (resumo do dia)",
    active: "inicio",
    rotas: [],
    render: (perfil, variante) => {
      const { data, month } = inicio.dataFor(perfil, variante);
      const loading = variante === "carregando";
      return (
        <main className="min-h-screen bg-mist pb-14 pt-3 md:pt-6">
          <PainelInicio
            data={data}
            monthKpis={loading ? <InicioKpisMesCarregando /> : <InicioKpisMes month={month} />}
            funnel={loading ? <InicioFunilCarregando /> : <InicioFunil month={month} />}
          />
        </main>
      );
    }
  },
  cenas: {
    // Cenas do visual novo (?variante=mensagem|mensagem-longa|reconhecimento:gatilho:animação|meta).
    path: "/admin/meta-diaria",
    titulo: "Cenas (Mensagem do dia, Reconhecimento, anel da Meta)",
    active: "daily-goal",
    rotas: metaDiaria.routes,
    semMenu: true,
    render: (perfil, variante) => <Cenas variante={variante} />
  },
  online: {
    path: "/admin/desempenho/online",
    titulo: "Supervisão › Online",
    active: "online",
    rotas: online.routes,
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        {/* Só no navegador: os horários fictícios são relativos à hora atual e o servidor da vitrine renderiza segundos
            antes — na virada do minuto o texto divergia e o Next acusava erro de hidratação (só na vitrine). */}
        <ClientOnly><OnlinePresenceBoard initialPresence={online.presence} /></ClientOnly>
      </main>
    )
  },
  anuncios: {
    // Área Anúncios (só admin geral).
    path: "/admin/anuncios",
    titulo: "Anúncios",
    active: "ads",
    rotas: anuncios.routes,
    render: (perfil, variante) => (
      <main className="pb-14 md:pt-8">
        <AdsBoard initialData={anuncios.data} />
      </main>
    )
  },
  // Telas repaginadas no visual novo (frente C, 2026-10-22): wrapper igual ao <main> da página real.
  agenda: {
    path: "/admin/calendario",
    titulo: "Agenda",
    active: "calendar",
    rotas: telas.routes,
    // ?variante=Fernando abre o detalhe da atividade (AutoClick).
    render: (perfil, variante) => (<main className="min-h-screen bg-mist py-14"><ActivityCalendar />{variante ? <AutoClick passos={variante} /> : null}</main>)
  },
  "simulador-caixa": {
    path: "/admin/simulador-caixa",
    titulo: "Simulador Caixa",
    active: "caixa-simulator",
    rotas: [],
    render: () => (<main className="min-h-screen bg-mist py-14"><CaixaSimulator /></main>)
  },
  corretores: {
    path: "/admin/corretores",
    titulo: "Corretores › Usuários",
    active: "brokers",
    rotas: [],
    render: () => (<main className="bg-mist py-14"><AdminUsersManager {...telas.props.usuarios} /></main>)
  },
  "gerador-links": {
    path: "/admin/gerador-de-links",
    titulo: "Gerador de Links",
    active: "campaign-links",
    rotas: telas.routes,
    render: () => (<main className="bg-mist py-14"><CampaignsManager {...telas.props.campanhas} /></main>)
  },
  "gastos-ia": {
    path: "/admin/gastos-ia",
    titulo: "Gastos de IA",
    active: "ai-usage",
    rotas: [],
    render: () => (<main className="bg-mist py-14"><AdminAiUsageDashboard {...telas.props.gastosIa} /></main>)
  },
  "meta-gestao": {
    path: "/admin/meta-diaria/gestao",
    titulo: "Meta Diária › Gestão",
    active: "daily-goal-admin",
    rotas: [],
    render: () => (<main className="min-h-screen bg-mist py-14"><DailyGoalAdmin {...telas.props.metaGestao} /></main>)
  },
  automacoes: {
    path: "/admin/automacoes",
    titulo: "Automações › Regras",
    active: "automations",
    rotas: [],
    render: () => (<main className="min-h-screen bg-mist py-14"><AutomationRulesManager {...telas.props.automacoes} /></main>)
  },
  notificacoes: {
    path: "/admin/notificacoes",
    titulo: "Notificações",
    active: "notifications",
    rotas: [],
    render: () => (<main className="min-h-screen bg-mist py-14"><CrmNotificationsList {...telas.props.notificacoes} /></main>)
  },
  prospeccao: {
    path: "/admin/prospeccao",
    titulo: "Prospecção",
    active: "prospecting",
    rotas: telas.routes,
    render: () => (<main className="min-h-screen bg-mist py-14"><ProspectingTabs {...telas.props.prospeccao} /></main>)
  },
  "alterar-conta": {
    path: "/admin/corretores",
    titulo: "Corretores › Alterar conta",
    active: "brokers",
    rotas: [],
    render: () => (<main className="bg-mist py-14"><AdminViewAsSelector {...telas.extras.alterarConta} /></main>)
  },
  "regras-ia": {
    path: "/admin/documentacao/regras",
    titulo: "Documentação › Regras da IA",
    active: "document-rules",
    rotas: [],
    render: () => (<main className="min-h-screen bg-mist py-14"><DocumentAiRulesManager {...telas.extras.regrasIa} /></main>)
  },
  guia: {
    path: "/admin/guia-atendimento",
    titulo: "Guia de Atendimento",
    active: "attendance-guide",
    rotas: [],
    render: () => (<main className="min-h-screen bg-mist py-14"><GuideManager {...telas.extras.guias} /></main>)
  },
  imoveis: {
    path: "/admin",
    titulo: "Imóveis (cadastro)",
    active: "properties",
    rotas: [],
    render: () => (<main className="min-h-screen bg-mist py-14"><AdminPropertyList {...telas.extras.imoveis} /></main>)
  },
  "ranking-topo": {
    // Cabeçalho do ranking como em app/admin/layout.jsx (?variante=completo|sem-dia|vazio|posicao).
    path: "/admin/simulacoes",
    titulo: "Cabeçalho do ranking (Campeão da semana / Melhor do dia)",
    active: "simulations",
    rotas: rankingTopo.routes,
    semMenu: true,
    render: () => (
      <>
        <div className="mm-app-hide">
          <header className="admin-ranking-header flex min-h-12 flex-wrap items-center justify-center gap-2 border-b border-line bg-white px-3 pt-[env(safe-area-inset-top)] sm:min-h-14 sm:px-6">
            <TopRankingBadge weeklyIndicator={<WhatsappIndividualStatus align="end" />} dailyIndicator={<GoogleContactsStatus align="end" />} />
          </header>
        </div>
        <main className="bg-mist pb-14 pt-3 md:pt-14">
          <div className="container-page"><p className="text-sm font-bold text-muted">Conteúdo da tela abaixo do cabeçalho.</p></div>
        </main>
      </>
    )
  },
  fundacao: {
    titulo: "Fundação (sistema visual)",
    active: "",
    rotas: [],
    semMenu: true,
    render: () => <Fundacao />
  },
  clientes: {
    path: "/admin/simulacoes",
    titulo: "Lista de clientes",
    active: "simulations",
    rotas: clientes.routes,
    render: (perfil) => (
      <main className="bg-mist pb-14 pt-3 md:pt-14">
        <ClientWorkspace {...clientes.propsFor(perfil)} />
      </main>
    )
  },
  chat: {
    path: "/admin/chat",
    titulo: "Chat",
    active: "chat",
    rotas: chat.routes,
    render: (perfil) => (
      <main className="bg-mist pt-3 md:pt-6">
        <WhatsappChat appMode {...chat.propsFor(perfil)} />
      </main>
    )
  },
  "chat-marketplace": {
    path: "/admin/chat/marketplace",
    titulo: "Chat Marketplace",
    active: "marketplace-chat",
    rotas: chatMarketplace.routes,
    render: (perfil) => (
      <main className="bg-mist pt-3 md:pt-6">
        <MarketplaceChat {...chatMarketplace.propsFor(perfil)} />
      </main>
    )
  },
  "meta-diaria": {
    path: "/admin/meta-diaria",
    titulo: "Meta Diária (corretor)",
    active: "daily-goal",
    rotas: metaDiaria.routes,
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <DailyGoalDashboard initialGoal={metaDiaria.brokerGoal} />
      </main>
    )
  },
  "meta-diaria-compensacao": {
    path: "/admin/meta-diaria",
    titulo: "Meta Diária — compensação por restrição validada",
    active: "daily-goal",
    rotas: metaDiaria.routes,
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <div className="container-page mb-6 space-y-3">
          {metaDiaria.compensationVariants.map((variant) => (
            <div key={variant.label}>
              <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted">{variant.label}</p>
              <DailyGoalCompensationNotice notice={variant.notice} />
            </div>
          ))}
        </div>
        <DailyGoalDashboard initialGoal={{ ...metaDiaria.brokerGoal, compensation: metaDiaria.compensationVariants[2].notice }} />
      </main>
    )
  },
  "meta-diaria-equipe": {
    path: "/admin/meta-diaria",
    titulo: "Meta Diária (visão do dono)",
    active: "daily-goal",
    rotas: [...supervisao.routes, ...metaDiaria.routes],
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <TeamDailyPerformance initialOverview={metaDiaria.teamOverview} />
      </main>
    )
  },
  "meta-diaria-gestora": {
    path: "/admin/meta-diaria",
    titulo: "Meta Diária (visão da gestora — só a equipe dela)",
    active: "daily-goal",
    rotas: [...supervisao.routes, ...metaDiaria.routes],
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <section className="container-page mb-6">
          <div className="mx-auto max-w-3xl">
            <DailyGoalDashboard variant="card" initialGoal={{ ...metaDiaria.brokerGoal, compensation: metaDiaria.compensationVariants[2].notice }} />
          </div>
        </section>
        <TeamDailyPerformance initialOverview={metaDiaria.managerOverview} viewer="manager" />
      </main>
    )
  },
  "supervisao-corretor": {
    path: "/admin/meta-diaria",
    titulo: "Mensagem da supervisão (corretor)",
    active: "daily-goal",
    rotas: [...supervisao.routes, ...metaDiaria.routes],
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <DailyGoalDashboard initialGoal={metaDiaria.brokerGoal} />
        <SupervisionMessageGate userId="vitrine-corretor-ana" />
      </main>
    )
  },
  alertas: {
    path: "/admin/meta-diaria",
    titulo: "Central de Alertas (corretor)",
    active: "daily-goal",
    rotas: [...alertas.routes, ...metaDiaria.routes],
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <DailyGoalDashboard initialGoal={metaDiaria.brokerGoal} />
        <AlertCenterGate userId="vitrine-corretor-eduardo" />
      </main>
    )
  },
  "financeiro-saude": {
    path: "/admin/financeiro",
    titulo: "Financeiro > Saúde (só admin geral; ?variante=semcaixa|vazio)",
    active: "financial",
    rotas: financeiroSaude.routes,
    // Reproduz o wrapper de AdminFinancialDashboard (container-page) com o componente real da aba.
    render: (perfil, variante) => (
      <main className="bg-mist py-14">
        <section className="container-page space-y-6">
          <FinancialHealthTab {...financeiroSaude.propsFor(variante)} />
        </section>
      </main>
    )
  },
  "financeiro-vendas": {
    path: "/admin/financeiro",
    titulo: "Financeiro > Resumo, Vendas e Recebimentos (?variante=Vendas|Marta cliques em sequência)",
    active: "financial",
    rotas: financeiroVendas.routes,
    render: (perfil, variante) => (
      <main className="bg-mist py-14">
        <AdminFinancialDashboard {...financeiroVendas.propsFor(perfil)} />
        <AutoClick passos={variante} />
      </main>
    )
  },
  manual: {
    path: "/admin/manual",
    titulo: "Manual do CRM (?variante=vazio|erro, ou cliques separados por barra ex.: Novidades|Primeiros passos)",
    active: "manual",
    rotas: manual.routes,
    render: (perfil, variante) => (
      <main className="min-h-screen bg-mist py-14">
        <ManualBrowser
          initialTopics={variante === "vazio" || variante === "erro" ? [] : manual.topics}
          /* cliques opcionais: ver AutoClick abaixo */
          initialNews={variante === "vazio" || variante === "erro" ? [] : manual.news}
          initialError={variante === "erro" ? "Tente novamente em instantes. Se continuar, avise a gestão." : ""}
          manageHref={perfil === "admin" ? "/admin/manual/gerenciar" : ""}
        />
        {variante && variante !== "vazio" && variante !== "erro" ? <AutoClick passos={variante} /> : null}
      </main>
    )
  },
  "manual-gerenciar": {
    path: "/admin/manual/gerenciar",
    titulo: "Manual do CRM — administração (?variante=dono|outraconta|outro-admin, depois |cliques separados por barra, ex.: dono|Aprovação)",
    active: "manual",
    rotas: manual.routes,
    render: (perfil, variante) => (
      <main className="min-h-screen bg-mist py-14">
        <ManualAdmin initial={manual.adminOverview} isOwner={variante.split("|")[0] === "dono"} ownerViewingAsOther={variante.split("|")[0] === "outraconta"} />
        <AutoClick passos={variante.split("|").slice(1).join("|")} />
      </main>
    )
  },
  desempenho: {
    path: "/admin/desempenho",
    titulo: "Desempenho",
    active: "performance",
    rotas: desempenho.routes,
    render: () => (
      <main className="min-h-screen bg-mist py-14">
        <PerformanceOverviewDashboard initialOverview={desempenho.overview} initialError="" />
      </main>
    )
  }
};

function ClientOnly({ children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? children : null;
}

const PAPEIS = { admin: "Administrador geral", gestor: "Gestor", corretor: "Corretor", associado: "Associado" };

const PERFIS = {
  admin: { isAdmin: true },
  gestor: { isManager: true },
  corretor: { isBroker: true },
  associado: { isAssociate: true }
};

export default function VitrineClient({ tela, perfil, estado, limpo, fonte, variante = "" }) {
  const atual = TELAS[tela];
  const perfilValido = PERFIS[perfil] ? perfil : "admin";
  const fonteValida = FONTES[fonte] ? fonte : "manrope";

  // Instalado durante o render (antes dos efeitos dos filhos dispararem
  // o primeiro fetch). Idempotente.
  installMockFetch([...(atual?.rotas || []), ...rankingTopo.routes, ...comum.routes], estado);

  useEffect(() => {
    document.body.classList.add("admin-scroll-fix");
    return () => document.body.classList.remove("admin-scroll-fix");
  }, []);

  // Comparativo de tipografia: troca --font-ui só nesta página.
  useEffect(() => {
    const { className, stack } = FONTES[fonteValida];
    const root = document.documentElement;
    const classes = className ? className.split(" ") : [];
    root.classList.add(...classes);
    if (stack) root.style.setProperty("--font-ui", stack);
    return () => {
      root.classList.remove(...classes);
      root.style.removeProperty("--font-ui");
    };
  }, [fonteValida]);

  if (!atual) return <Indice />;

  return (
    <>
      {!limpo ? <BarraDev tela={tela} perfil={perfilValido} estado={estado} fonte={fonteValida} /> : null}
      {/* Casca do painel como em app/admin/layout.jsx (visual novo, 2026-10-22): menu lateral, cabeçalho e ranking. */}
      {!atual.semMenu ? (
        <>
          <AdminMenu {...PERFIS[perfilValido]} currentPath={atual.path || ""} user={{ name: "Matheus Demo", photoUrl: "", roleLabel: PAPEIS[perfilValido] }} />
          <div className="mm-app-hide">
            <AdminTopBar {...PERFIS[perfilValido]} currentPath={atual.path || ""} canViewAs={perfilValido === "admin"} extraShortcuts={<>{perfilValido === "admin" || perfilValido === "gestor" ? <CooledClientsInbox align="end" variant="topbar" /> : null}<NotificationHistoryButton align="end" variant="topbar" /></>} />
            {atual.path?.startsWith("/admin/chat") ? null : (
              <header className="admin-ranking-header container-page flex flex-wrap items-center gap-2">
                <TopRankingBadge weeklyIndicator={<WhatsappIndividualStatus align="end" />} dailyIndicator={<GoogleContactsStatus align="end" />} />
              </header>
            )}
          </div>
        </>
      ) : null}
      <div id="vitrine-root">{atual.render(perfilValido, variante)}</div>
      {atual.path?.startsWith("/admin/chat") ? null : <AdminScrollReveal rootId="vitrine-root" />}
      <AdminBottomNav {...PERFIS[perfilValido]} currentPath={atual.path || ""} />
    </>
  );
}

function BarraDev({ tela, perfil, estado, fonte }) {
  const link = (next) => {
    const params = new URLSearchParams({ tela, perfil, estado, fonte, ...next });
    return `/dev/vitrine?${params.toString()}`;
  };
  return (
    <div className="sticky top-0 z-[100] flex flex-wrap items-center gap-2 bg-amber-300 px-3 py-1.5 text-xs font-bold text-black">
      <a href="/dev/vitrine" className="underline">Vitrine (dev)</a>
      <span>· {TELAS[tela].titulo}</span>
      <span>· perfil:</span>
      {Object.keys(PERFIS).map((item) => (
        <a key={item} href={link({ perfil: item })} className={item === perfil ? "underline" : "opacity-70"}>{item}</a>
      ))}
      <span>· estado:</span>
      {["normal", "carregando", "erro"].map((item) => (
        <a key={item} href={link({ estado: item })} className={item === estado ? "underline" : "opacity-70"}>{item}</a>
      ))}
      <span>· fonte:</span>
      {Object.keys(FONTES).map((item) => (
        <a key={item} href={link({ fonte: item })} className={item === fonte ? "underline" : "opacity-70"}>{item}</a>
      ))}
      <a href={link({ limpo: "1" })} className="ml-auto opacity-70">sem esta barra</a>
    </div>
  );
}

function Indice() {
  return (
    <main className="container-page py-10">
      <h1 className="text-2xl font-black text-navy">Vitrine de componentes (somente desenvolvimento)</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Componentes reais com dados fictícios, sem login e sem tocar em API ou banco. Parâmetros: <code>tela</code>, <code>perfil</code> (admin, gestor, corretor, associado), <code>estado</code> (normal, carregando, erro) e <code>fonte</code> (atual, manrope, inter) e <code>limpo=1</code> para screenshot.
      </p>
      <ul className="mt-6 space-y-2">
        {Object.entries(TELAS).map(([key, item]) => (
          <li key={key}>
            <a className="font-bold text-brand underline" href={`/dev/vitrine?tela=${key}`}>{item.titulo}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
