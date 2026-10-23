import AdminSectionNav from "@/components/AdminSectionNav";
import AutomationRulesManager from "@/components/AutomationRulesManager";
import AlertCenterAdmin from "@/components/alerts/AlertCenterAdmin";
import ClientVoiceAudioSettings from "@/components/ClientVoiceAudioSettings";
import CelebrationsManager from "@/components/celebrations/CelebrationsManager";
import DailyMessageAdmin from "@/components/DailyMessageAdmin";
import LeadDistributionDashboard from "@/components/LeadDistributionDashboard";
import NewClientSoundSettings from "@/components/NewClientSoundSettings";
import WhatsappAutomationRepliesManager from "@/components/WhatsappAutomationRepliesManager";
import WhatsappDisparoManager from "@/components/WhatsappDisparoManager";
import WhatsappMasterForm from "@/components/WhatsappMasterForm";
import WhatsappMasterInbox from "@/components/WhatsappMasterInbox";
import WhatsappProfileEditor from "@/components/WhatsappProfileEditor";
import WhatsappNumberRegistration from "@/components/WhatsappNumberRegistration";
import WhatsappTemplateManager from "@/components/WhatsappTemplateManager";
import FlowsManager from "@/components/flows/FlowsManager";
import { listWhatsappFlows } from "@/lib/whatsapp-flows";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, listAdminProfiles } from "@/lib/admin-profiles";
import { listAutomationRules } from "@/lib/crm-automations";
import { getWhatsappMasterSettings } from "@/lib/crm";
import { getDailyMessageSettings } from "@/lib/daily-message";
import { listLeadDistributionDashboard } from "@/lib/lead-distribution";
import { canLoadCelebrations, listCelebrationTriggers, listMessageTemplates, formatCelebrationsError } from "@/lib/celebrations";
import { getWhatsappMasterDisplaySettings, getWhatsappMasterEnvironmentStatus, listWhatsappMasterEvents, listWhatsappMessageTemplates } from "@/lib/whatsapp-master";
import { listWhatsappAutomationReplies } from "@/lib/whatsapp-automation-replies";
import Link from "next/link";
import { redirect } from "next/navigation";
import { tabClasses } from "@/components/ui/Tabs";

export const dynamic = "force-dynamic";

const TABS = ["rules", "roulette", "daily-message", "incentivo", "alertas", "audio-voz", "whatsapp-master", "flows", "disparos"];

export default async function AutomationsPage({ searchParams }) {
  const auth = await requireBrokerManagementPage("/admin/simulacoes");
  const tabParam = (await searchParams)?.tab;
  // O Chat saiu daqui e virou página própria (ao lado de Clientes) — o link
  // antigo continua funcionando. WhatsApp Manual foi removido (2026-09-27):
  // link antigo cai na aba padrão.
  if (tabParam === "whatsapp-chat") redirect("/admin/chat");
  const tab = TABS.includes(tabParam) ? tabParam : "rules";
  const [rules, users, distribution, dailyMessageSettings, whatsappData, whatsappTemplates, flows, celebrationsData] = await Promise.all([
    tab === "rules" ? listAutomationRules() : Promise.resolve([]),
    tab === "rules" || tab === "incentivo" ? listAdminProfiles() : Promise.resolve([]),
    tab === "roulette" ? listLeadDistributionDashboard() : Promise.resolve(null),
    tab === "daily-message" ? getDailyMessageSettings() : Promise.resolve(null),
    tab === "whatsapp-master" ? loadWhatsappMasterData() : Promise.resolve(null),
    tab === "rules" ? listWhatsappMessageTemplates().catch(() => []) : Promise.resolve([]),
    tab === "flows" ? listWhatsappFlows().catch(() => null) : Promise.resolve(null),
    tab === "incentivo" ? loadCelebrationsData(auth) : Promise.resolve(null)
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
      ) : tab === "incentivo" ? (
        celebrationsData?.error ? (
          <p className="container-page rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{celebrationsData.error}</p>
        ) : (
          <CelebrationsManager
            initialTriggers={celebrationsData?.triggers || []}
            initialTemplates={celebrationsData?.templates || []}
            brokers={users.filter((user) => user.status === "active")}
            adminName={(auth.profile?.name || "").split(/\s+/)[0] || ""}
          />
        )
      ) : tab === "whatsapp-master" ? (
        <>
          <WhatsappMasterForm initialSettings={whatsappData.settings} environment={whatsappData.environment} />
          {isGeneralAdminAuth(auth) ? <WhatsappNumberRegistration /> : null}
          {isGeneralAdminAuth(auth) ? <WhatsappProfileEditor /> : null}
          <WhatsappTemplateManager />
          <WhatsappAutomationRepliesManager initialRules={whatsappData.automationReplies} />
          <WhatsappMasterInbox initialEvents={whatsappData.events} />
        </>
      ) : tab === "flows" ? (
        flows ? <FlowsManager initialFlows={flows} /> : <p className="container-page rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">Não foi possível carregar os fluxos. Verifique se a migration dos Fluxos foi aplicada no banco.</p>
      ) : tab === "alertas" ? (
        isGeneralAdminAuth(auth) ? <AlertCenterAdmin /> : <p className="container-page rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-navy">A Central de Alertas é configurada pelo administrador geral.</p>
      ) : tab === "audio-voz" ? (
        // Áudio com a voz do dono (VOZ-1, dono 2026-10-23): só o admin geral configura (a API também exige).
        isGeneralAdminAuth(auth) ? <ClientVoiceAudioSettings /> : <p className="container-page rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-navy">O áudio com voz é configurado pelo administrador geral.</p>
      ) : tab === "disparos" ? (
        <WhatsappDisparoManager />
      ) : (
        <LeadDistributionDashboard initialData={distribution} />
      )}
    </main>
  );
}

async function loadCelebrationsData(auth) {
  if (!canLoadCelebrations()) return { error: "Configure o Supabase para carregar o Incentivo." };
  try {
    const [triggers, templates] = await Promise.all([listCelebrationTriggers(auth), listMessageTemplates(auth)]);
    return { triggers, templates };
  } catch (error) {
    return { error: formatCelebrationsError(error) };
  }
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
  { key: "incentivo", label: "Incentivo", href: "/admin/automacoes?tab=incentivo" },
  { key: "alertas", label: "Alertas", href: "/admin/automacoes?tab=alertas" },
  { key: "audio-voz", label: "Áudio com voz", href: "/admin/automacoes?tab=audio-voz" },
  { key: "whatsapp-master", label: "WhatsApp Master", href: "/admin/automacoes?tab=whatsapp-master" },
  { key: "flows", label: "Fluxos", href: "/admin/automacoes?tab=flows" },
  { key: "disparos", label: "Disparos", href: "/admin/automacoes?tab=disparos" }
];

function AutomationSubmenu({ active }) {
  return (
    <nav aria-label="Automações" className="container-page mm-noscroll mb-4 flex gap-1.5 overflow-x-auto py-1">
      {SUBMENU_ITEMS.map((item) => (
        <Link key={item.key} href={item.href} aria-current={active === item.key ? "page" : undefined} className={tabClasses(active === item.key)}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
