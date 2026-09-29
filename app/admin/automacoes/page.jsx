import AdminSectionNav from "@/components/AdminSectionNav";
import AutomationRulesManager from "@/components/AutomationRulesManager";
import DailyMessageAdmin from "@/components/DailyMessageAdmin";
import LeadDistributionDashboard from "@/components/LeadDistributionDashboard";
import NewClientSoundSettings from "@/components/NewClientSoundSettings";
import WhatsappAutomationRepliesManager from "@/components/WhatsappAutomationRepliesManager";
import WhatsappDisparoManager from "@/components/WhatsappDisparoManager";
import WhatsappMasterForm from "@/components/WhatsappMasterForm";
import WhatsappMasterInbox from "@/components/WhatsappMasterInbox";
import WhatsappProfileEditor from "@/components/WhatsappProfileEditor";
import WhatsappTemplateManager from "@/components/WhatsappTemplateManager";
import FlowsManager from "@/components/flows/FlowsManager";
import { listWhatsappFlows } from "@/lib/whatsapp-flows";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, listAdminProfiles } from "@/lib/admin-profiles";
import { listAutomationRules } from "@/lib/crm-automations";
import { getWhatsappMasterSettings } from "@/lib/crm";
import { getDailyMessageSettings } from "@/lib/daily-message";
import { listLeadDistributionDashboard } from "@/lib/lead-distribution";
import { getWhatsappMasterDisplaySettings, getWhatsappMasterEnvironmentStatus, listWhatsappMasterEvents, listWhatsappMessageTemplates } from "@/lib/whatsapp-master";
import { listWhatsappAutomationReplies } from "@/lib/whatsapp-automation-replies";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TABS = ["rules", "roulette", "daily-message", "whatsapp-master", "flows", "disparos"];

export default async function AutomationsPage({ searchParams }) {
  const auth = await requireBrokerManagementPage("/admin/simulacoes");
  const tabParam = (await searchParams)?.tab;
  // O Chat saiu daqui e virou página própria (ao lado de Clientes) — o link
  // antigo continua funcionando. WhatsApp Manual foi removido (2026-09-27):
  // link antigo cai na aba padrão.
  if (tabParam === "whatsapp-chat") redirect("/admin/chat");
  const tab = TABS.includes(tabParam) ? tabParam : "rules";
  const [rules, users, distribution, dailyMessageSettings, whatsappData, whatsappTemplates, flows] = await Promise.all([
    tab === "rules" ? listAutomationRules() : Promise.resolve([]),
    tab === "rules" ? listAdminProfiles() : Promise.resolve([]),
    tab === "roulette" ? listLeadDistributionDashboard() : Promise.resolve(null),
    tab === "daily-message" ? getDailyMessageSettings() : Promise.resolve(null),
    tab === "whatsapp-master" ? loadWhatsappMasterData() : Promise.resolve(null),
    tab === "rules" ? listWhatsappMessageTemplates().catch(() => []) : Promise.resolve([]),
    tab === "flows" ? listWhatsappFlows().catch(() => null) : Promise.resolve(null)
  ]);

  return (
    <main className="min-h-screen bg-mist py-14">
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
          {isGeneralAdminAuth(auth) ? <WhatsappProfileEditor /> : null}
          <WhatsappTemplateManager />
          <WhatsappAutomationRepliesManager initialRules={whatsappData.automationReplies} />
          <WhatsappMasterInbox initialEvents={whatsappData.events} />
        </>
      ) : tab === "flows" ? (
        flows ? <FlowsManager initialFlows={flows} /> : <p className="container-page rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">Não foi possível carregar os fluxos. Verifique se a migration dos Fluxos foi aplicada no banco.</p>
      ) : tab === "disparos" ? (
        <WhatsappDisparoManager />
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

  let automationReplies = [];
  try {
    automationReplies = await listWhatsappAutomationReplies();
  } catch {
    automationReplies = [];
  }

  return { settings, environment, events, automationReplies };
}

const SUBMENU_ITEMS = [
  { key: "rules", label: "Regras", href: "/admin/automacoes" },
  { key: "roulette", label: "Roleta", href: "/admin/automacoes?tab=roulette" },
  { key: "daily-message", label: "Mensagem do Dia", href: "/admin/automacoes?tab=daily-message" },
  { key: "whatsapp-master", label: "WhatsApp Master", href: "/admin/automacoes?tab=whatsapp-master" },
  { key: "flows", label: "Fluxos", href: "/admin/automacoes?tab=flows" },
  { key: "disparos", label: "Disparos", href: "/admin/automacoes?tab=disparos" }
];

function AutomationSubmenu({ active }) {
  return (
    <nav className="container-page mb-4 flex flex-wrap justify-center gap-1.5 rounded-xl border border-navy/[0.07] bg-white p-1 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
      {SUBMENU_ITEMS.map((item) => (
        <Link key={item.key} href={item.href} className={`rounded-[10px] px-4 py-1.5 text-center text-[13px] font-black ${active === item.key ? "bg-navy text-white" : "text-navy"}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
