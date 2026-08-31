import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import WhatsappMasterForm from "@/components/WhatsappMasterForm";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { getWhatsappMasterSettings } from "@/lib/crm";
import { getWhatsappMasterDisplaySettings, getWhatsappMasterEnvironmentStatus } from "@/lib/whatsapp-master";

export const dynamic = "force-dynamic";

export default async function WhatsappMasterPage() {
  await requireGeneralAdminPage("/admin/simulacoes");
  const settings = getWhatsappMasterDisplaySettings(await getWhatsappMasterSettings());
  const environment = getWhatsappMasterEnvironmentStatus();

  return (
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Notificações internas</p>
          <h1 className="mt-3 text-5xl font-black text-navy">WhatsApp Master</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">Configuração do número oficial da equipe.</p>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="whatsapp-master" />
      <WhatsappMasterForm initialSettings={settings} environment={environment} />
    </main>
  );
}
