import AdminSectionNav from "@/components/AdminSectionNav";
import ManualBrowser from "@/components/manual/ManualBrowser";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminProfile } from "@/lib/admin-profiles";
import { getVisibleManual, listVisibleNews } from "@/lib/manual";

export const dynamic = "force-dynamic";

export const metadata = { title: "Manual do CRM" };

// Manual do CRM (leitura). Só publicado e visível ao perfil efetivo, filtrado no servidor.
export default async function ManualPage() {
  const auth = await requireAdminPage();
  let topics = [];
  let news = [];
  let error = "";
  try {
    [{ topics }, { news }] = await Promise.all([getVisibleManual(auth), listVisibleNews(auth)]);
  } catch (err) {
    console.error("Manual do CRM: falha ao carregar", err?.message || err);
    error = "Tente novamente em instantes. Se continuar, avise a gestão.";
  }
  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="manual" />
      <ManualBrowser initialTopics={topics} initialNews={news} initialError={error} manageHref={isGeneralAdminProfile(auth.profile) ? "/admin/manual/gerenciar" : ""} />
    </main>
  );
}
