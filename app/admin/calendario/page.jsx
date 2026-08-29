import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import ActivityCalendar from "@/components/ActivityCalendar";
import Footer from "@/components/Footer";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata = {
  title: "Calendário | Matheus Machado"
};

export const dynamic = "force-dynamic";

export default async function AdminCalendarPage() {
  await requireAdminPage();

  return (
    <main className="min-h-screen bg-[#f4f7fb] py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Calendário</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Acompanhe as atividades agendadas dos clientes.
          </p>
        </div>
        <AdminLogoutButton />
      </section>

      <AdminSectionNav active="calendar" />
      <ActivityCalendar />
      <Footer />
    </main>
  );
}
