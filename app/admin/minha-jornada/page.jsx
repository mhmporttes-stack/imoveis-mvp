import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { getJourneySettings } from "@/lib/client-journey";
import AdminSectionNav from "@/components/AdminSectionNav";
import JourneySettings from "@/components/JourneySettings";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requireBrokerManagementPage();
  return <><header className="container-page py-8"><h1 className="text-3xl font-black text-navy">Minha Jornada</h1></header><AdminSectionNav active="client-journey" /><JourneySettings initial={await getJourneySettings()} /></>;
}
