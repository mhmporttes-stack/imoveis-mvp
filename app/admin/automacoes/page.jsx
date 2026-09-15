import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AutomationRulesManager from "@/components/AutomationRulesManager";
import DailyMessageAdmin from "@/components/DailyMessageAdmin";
import LeadDistributionDashboard from "@/components/LeadDistributionDashboard";
import NewClientSoundSettings from "@/components/NewClientSoundSettings";
import WhatsappManualSender from "@/components/WhatsappManualSender";
import WhatsappMasterForm from "@/components/WhatsappMasterForm";
import WhatsappMasterInbox from "@/components/WhatsappMasterInbox";
import WhatsappTemplateManager from "@/components/WhatsappTemplateManager";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { isOwnerAdminEmail, listAdminProfiles } from "@/lib/admin-profiles";
import { listAutomationRules } from "@/lib/crm-automations";
import { getWhatsappMasterSettings } from "@/lib/crm";
import { getDailyGoalPerformanceWhatsappStatus } from "@/lib/daily-goal-performance-whatsapp";
import { getDailyMessageSettings } from "@/lib/daily-message";
import { listLeadDistributionDashboard } from "@/lib/lead-distribution";
import { getWhatsappMasterDisplaySettings, getWhatsappMasterEnvironmentStatus, listWhatsappMasterEvents, listWhatsappMessageTemplates } from "@/lib/whatsapp-master";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TABS = ["rules", "roulette", "daily-message", "whatsapp-master"];

export default async function AutomationsPage({ searchParams }) {
  const auth = await requireBrokerManagementPage("/admin/simulacoes");
  const tabParam = (await searchParams)?.tab;
  const tab = TABS.includes(tabParam) ? tabParam : "rules";
  const [rules, users, distribution, dailyMessageSettings, whatsappData, whatsappTemplates] = await Promise.all([
    tab === "rules" ? listAutomationRules() : Promise.resolve([]),
    tab === "rules" ? listAdminProfiles() : Promise.resolve([]),
    tab === "roulette" ? listLeadDistributionDashboard() : Promise.resolve(null),
    tab === "daily-message" ? getDailyMessageSettings() : Promise.resolve(null),
    tab === "whatsapp-master" ? loadWhatsappMasterData() : Promise.resolve(null),
    tab === "rules" ? listWhatsappMessageTemplates().catch(() => []) : Promise.resolve([])
  ]);

  return (
    <main className="min-h-screen bg-mist py-14">
      <Header />
      <AdminSectionNav active="automations" />
      <AutomationSubmenu active={tab} />
      {tab === "rules" ? (
        <>
          <div className="container-page mb-4"><NewClientSoundSettings userId={auth.profile?.id} /></div>
          <AutomationRulesManager initialRules={rules} users={users.filter((user) => user.status === "active")} whatsappTemplates={whatsappTemplates} />
        </>
      ) : tab === "daily-message" ? (
        <DailyMessageAdmin initialSettings={dailyMessageSettings} />
      ) : tab === "whatsapp-master" ? (
        <>
          <WhatsappMasterForm initialSettings={whatsappData.settings} environment={whatsappData.environment} />
          <WhatsappManualSender brokers={whatsappData.brokers} />
          <WhatsappTemplateManager initialStatus={whatsappData.dailyPerformanceStatus} />
          <WhatsappMasterInbox initialEvents={whatsappData.events} />
        </>
      ) : (
        <LeadDistributionDashboard initialData={distribution} />
      )}
    </main>
  );
}

async function loadWhatsappMasterData() {
  const settings = getWhatsappMasterDisplaySettings(await getWhatsappMasterSettings());
  const environment = getWhatsappMasterEnvironmentStatus();

  let events = [];
  try {
    events = await listWhatsappMasterEvents({ limit: 30 });
  } catch {
    events = [];
  }

  let dailyPerformanceStatus = { templates: [], templatesError: "", lastSentDate: "", lastResults: [] };
  try {
    dailyPerformanceStatus = await getDailyGoalPerformanceWhatsappStatus();
  } catch {
    dailyPerformanceStatus = { templates: [], templatesError: "Falha ao carregar status.", lastSentDate: "", lastResults: [] };
  }

  const profiles = await listAdminProfiles();
  const brokers = profiles
    .filter((profile) => profile.status === "active" && !isOwnerAdminEmail(profile.email))
    .map((profile) => ({ id: profile.id, name: profile.name, phone: profile.phone || "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return { settings, environment, events, dailyPerformanceStatus, brokers };
}

function AutomationSubmenu({ active }) {
  return <nav className="container-page mb-4 grid grid-cols-4 rounded-xl border border-navy/[0.07] bg-white p-0.5 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
    <Link className={`rounded-[10px] px-4 py-1.5 text-center text-[13px] font-black ${active === "rules" ? "bg-navy text-white" : "text-navy"}`} href="/admin/automacoes">Regras</Link>
    <Link className={`rounded-[10px] px-4 py-1.5 text-center text-[13px] font-black ${active === "roulette" ? "bg-navy text-white" : "text-navy"}`} href="/admin/automacoes?tab=roulette">Roleta</Link>
    <Link className={`rounded-[10px] px-4 py-1.5 text-center text-[13px] font-black ${active === "daily-message" ? "bg-navy text-white" : "text-navy"}`} href="/admin/automacoes?tab=daily-message">Mensagem do Dia</Link>
    <Link className={`rounded-[10px] px-4 py-1.5 text-center text-[13px] font-black ${active === "whatsapp-master" ? "bg-navy text-white" : "text-navy"}`} href="/admin/automacoes?tab=whatsapp-master">WhatsApp Master</Link>
  </nav>;
}

function Header() {
  return (
    <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Automações</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">Regras internas configuráveis do CRM.</p>
      </div>
      <AdminLogoutButton />
    </section>
  );
}
