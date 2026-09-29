import AdminSectionNav from "@/components/AdminSectionNav";
import ActivityCalendar from "@/components/ActivityCalendar";
import Footer from "@/components/Footer";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata = {
  title: "Calendário | Matheus Machado"
};

export const dynamic = "force-dynamic";

export default async function AdminCalendarPage({ searchParams }) {
  await requireAdminPage();
  const pendingOnly = (await searchParams)?.pending === "1";

  return (
    <main className="min-h-screen bg-[#f4f7fb] py-14">
      <AdminSectionNav active="calendar" />
      <ActivityCalendar pendingOnly={pendingOnly} />
      <Footer />
    </main>
  );
}
