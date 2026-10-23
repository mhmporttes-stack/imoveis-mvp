import Link from "next/link";
import { tabClasses } from "@/components/ui/Tabs";
import { Bell } from "lucide-react";
import { getAdminFromCookies } from "@/lib/admin-auth";
import {
  buildBrokerCaptacaoLink,
  buildBrokerSimulationLink,
  isGeneralAdminProfile,
  isBrokerProfile,
  isAssociateProfile,
  isManagerProfile
} from "@/lib/admin-profiles";
import { calculateCrmMetrics, countUnreadCrmNotifications } from "@/lib/crm";
import { listSimulationRegistrations } from "@/lib/simulation-registrations";
import Kpi from "@/components/ui/Kpi";

export default async function AdminSectionNav({ active = "properties" }) {
  const admin = await getAdminFromCookies();
  const profile = admin.ok ? admin.profile : null;
  const isAdmin = isGeneralAdminProfile(profile);
  const isBroker = isBrokerProfile(profile);
  const isAssociate = isAssociateProfile(profile);
  const isManager = isManagerProfile(profile);
  let brokerSummary = null;
  let unreadNotifications = 0;

  // Visual novo (dono, 2026-10-22): o menu saiu daqui — é o menu lateral do layout (AdminMenu, com a mesma lista de
  // getAdminMenuGroups e o Chat que some no modo lista impressa, PRO-15). Sobra só o bloco do gestor (sub-barra de
  // Desempenho e links pessoais); para os outros perfis nada é desenhado — por isso sai ANTES de qualquer leitura
  // (velocidade, dono 2026-10-22: o corretor/associado lia a carteira inteira a cada tela só para descartar). O
  // retorno automático da Prospecção, que pegava carona nessa leitura, roda no cron scheduled-activities.
  if (!isManager || isAdmin) return null;

  if (admin.ok && isBroker && !isAdmin) {
    try {
      const [registrations, unread] = await Promise.all([
        listSimulationRegistrations({ auth: admin }),
        countUnreadCrmNotifications(admin)
      ]);
      brokerSummary = calculateCrmMetrics(registrations);
      unreadNotifications = unread;
    } catch {
      brokerSummary = null;
    }
  }

  return (
    <div className={`mm-app-hide container-page space-y-2 ${isBroker ? "mb-3" : "mb-6"}`}>

      {/* Administrador geral navega pelo menu principal (AdminMenu > ownerGroups); a sub-barra abaixo agora só existe para o gestor. */}
      {isManager && ["performance", "daily-report", "financial", "ai-usage", "scoring", "online", "audit"].includes(active) ? (
        <nav className="mm-noscroll -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1" aria-label="Opções de desempenho">
          {/* Visão geral (dashboard operacional) segue a mesma paridade de acesso do gestor com o admin. */}
          <PerformanceLink active={active === "performance"} href="/admin/desempenho">Visão geral</PerformanceLink>
          <PerformanceLink active={active === "daily-report"} href="/admin/relatorio-diario">Relatório Diário</PerformanceLink>
          {/* Financeiro (receita/comissoes da imobiliaria) e exclusivo do administrador geral — gestor nem ve o link. */}
          {isAdmin ? <PerformanceLink active={active === "financial"} href="/admin/financeiro">Financeiro</PerformanceLink> : null}
          {/* Gastos de IA (custo real de tokens da Anthropic) — mesma restrição do Financeiro, é dinheiro saindo da imobiliária. */}
          {isAdmin ? <PerformanceLink active={active === "ai-usage"} href="/admin/gastos-ia">Gastos de IA</PerformanceLink> : null}
          {/* Pontuação: gestor acessa em modo somente leitura (sem editar regras/ajustes). */}
          <PerformanceLink active={active === "scoring"} href="/admin/desempenho/pontuacao">Pontuação</PerformanceLink>
          <PerformanceLink active={active === "online"} href="/admin/desempenho/online">Online</PerformanceLink>
          <PerformanceLink active={active === "audit"} href="/admin/desempenho/auditoria">Auditoria</PerformanceLink>
        </nav>
      ) : null}

      {isManager && !isAdmin ? (
        <div className={isBroker ? "space-y-2" : "space-y-3"}>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate">
            {!isBroker ? <>
              <a className="rounded-full border border-brand/20 bg-white px-4 py-2 text-brand" href={buildBrokerSimulationLink(profile)} target="_blank" rel="noreferrer">Meu link de simulação</a>
              <a className="rounded-full border border-brand/20 bg-white px-4 py-2 text-brand" href={buildBrokerCaptacaoLink(profile)} target="_blank" rel="noreferrer">Meu link de captação</a>
            </> : null}
            {isBroker ? <Link href="/admin/notificacoes" className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand/20 bg-white text-brand" aria-label="Notificações" title="Notificações">
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadNotifications ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] leading-5 text-white">{unreadNotifications}</span> : null}
            </Link> : null}
          </div>
          {brokerSummary ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="Clientes hoje" value={brokerSummary.clientsToday} />
              <Metric label="Aguardando ação" value={brokerSummary.awaitingAction} />
              <Metric label="Atividades hoje" value={brokerSummary.activitiesToday} />
              <Metric label="Atividades atrasadas" value={brokerSummary.overdueActivities} tone="danger" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Abas como pílulas (visual novo, dono, 2026-10-22) — mesmo desenho de components/ui/Tabs.jsx.
function PerformanceLink({ active, href, children }) {
  return <Link aria-current={active ? "page" : undefined} className={tabClasses(active)} href={href}>{children}</Link>;
}

function Metric({ label, value, tone = "default" }) {
  return (
    <Kpi label={label} value={value} tone={tone === "danger" && value ? "danger" : "default"} className={tone === "danger" && value ? "border-danger-line" : ""} />
  );
}
