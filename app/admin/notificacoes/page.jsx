import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import CrmNotificationsList from "@/components/CrmNotificationsList";
import { requireAdminPage } from "@/lib/admin-auth";
import { listCrmNotifications } from "@/lib/crm";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const auth = await requireAdminPage();
  let notifications = [];
  try {
    notifications = await listCrmNotifications(auth);
  } catch {
    notifications = [];
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <PageHeader title="Notificações" description="Acompanhe alertas internos e atividades que exigem atenção." />
      <AdminSectionNav active="notifications" />
      <CrmNotificationsList initialNotifications={notifications} />
    </main>
  );
}

function PageHeader({ title, description }) {
  return (
    <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
        <h1 className="mt-3 text-5xl font-black text-navy">{title}</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">{description}</p>
      </div>
      <AdminLogoutButton />
    </section>
  );
}
