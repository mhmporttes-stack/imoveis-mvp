import AdminSectionNav from "@/components/AdminSectionNav";
import AlexaSettings from "@/components/alexa/AlexaSettings";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { getAlexaEnvStatus, loadAlexaSettings } from "@/lib/alexa-service";
import { ALEXA_EVENTS } from "@/lib/alexa-config-core.mjs";

export const dynamic = "force-dynamic";

export default async function AdminAlexaPage() {
  await requireGeneralAdminPage();
  const { settings, meta } = await loadAlexaSettings();

  return (
    <main className="bg-mist py-14">
      <AdminSectionNav active="alexa" />
      <AlexaSettings initialSettings={settings} initialMeta={meta} env={getAlexaEnvStatus()} events={ALEXA_EVENTS} />
    </main>
  );
}
