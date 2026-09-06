import AdminMenu from "@/components/AdminMenu";
import Link from "next/link";
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

export default async function AdminSectionNav({ active = "properties" }) {
  const admin = await getAdminFromCookies();
  const profile = admin.ok ? admin.profile : null;
  const isAdmin = isGeneralAdminProfile(profile);
  const isBroker = isBrokerProfile(profile);
  const isAssociate = isAssociateProfile(profile);
  const isManager = isManagerProfile(profile);
  let brokerSummary = null;
  let unreadNotifications = 0;

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
    <div className="container-page mb-6 space-y-2">
      <AdminMenu active={active} isAdmin={isAdmin} isBroker={isBroker} isAssociate={isAssociate} isManager={isManager} />

      {isAdmin && ["performance", "daily-report", "financial"].includes(active) ? (
        <nav className="grid grid-cols-3 rounded-xl border border-navy/[0.07] bg-white p-0.5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]" aria-label="Opções de desempenho">
          <PerformanceLink active={active === "performance"} href="/admin/desempenho">Visão geral</PerformanceLink>
          <PerformanceLink active={active === "daily-report"} href="/admin/relatorio-diario">Relatório Diário</PerformanceLink>
          <PerformanceLink active={active === "financial"} href="/admin/financeiro">Financeiro</PerformanceLink>
        </nav>
      ) : null}

      {isBroker && !isAdmin ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate">
            <a className="rounded-full border border-brand/20 bg-white px-4 py-2 text-brand" href={buildBrokerSimulationLink(profile)} target="_blank" rel="noreferrer">Meu link de simulação</a>
            <a className="rounded-full border border-brand/20 bg-white px-4 py-2 text-brand" href={buildBrokerCaptacaoLink(profile)} target="_blank" rel="noreferrer">Meu link de captação</a>
            <Link href="/admin/notificacoes" className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-brand/20 bg-white text-brand" aria-label="Notificações" title="Notificações">
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadNotifications ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] leading-5 text-white">{unreadNotifications}</span> : null}
            </Link>
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

function PerformanceLink({ active, href, children }) {
  return <Link className={`rounded-[10px] px-3 py-1.5 text-center text-[13px] font-black ${active ? "bg-navy text-white" : "text-navy hover:bg-brand/10"}`} href={href}>{children}</Link>;
}

function Metric({ label, value, tone = "default" }) {
  return (
    <div className={`rounded-2xl border bg-white px-4 py-3 ${tone === "danger" && value ? "border-red-200" : "border-line"}`}>
      <p className="text-2xl font-black text-navy">{value}</p>
      <p className="text-xs font-bold text-muted">{label}</p>
    </div>
  );
}
