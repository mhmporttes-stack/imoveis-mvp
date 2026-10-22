import AdminSectionNav from "@/components/AdminSectionNav";
import ActivityCalendar from "@/components/ActivityCalendar";
import { requireAdminPage } from "@/lib/admin-auth";
import { chatViewerKey } from "@/lib/chat-viewer-key.mjs";

export const metadata = {
  title: "Calendário | Matheus Machado"
};

export const dynamic = "force-dynamic";

export default async function AdminCalendarPage({ searchParams }) {
  const auth = await requireAdminPage();
  const pendingOnly = (await searchParams)?.pending === "1";

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="calendar" />
      <ActivityCalendar pendingOnly={pendingOnly} viewerKey={chatViewerKey(auth)} />
    </main>
  );
}
