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
      <AdminSectionNav active="notifications" />
      <CrmNotificationsList initialNotifications={notifications} />
    </main>
  );
}
