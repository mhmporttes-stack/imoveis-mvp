import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { getJourneySettings } from "@/lib/client-journey";
import AdminSectionNav from "@/components/AdminSectionNav";
import JourneySettings from "@/components/JourneySettings";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requireBrokerManagementPage();
  return <><h1 className="sr-only">Minha Jornada</h1><AdminSectionNav active="client-journey" /><JourneySettings initial={await getJourneySettings()} /></>;
}
