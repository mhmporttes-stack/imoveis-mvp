import Link from "next/link";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AdminTestimonialList from "@/components/AdminTestimonialList";
import { requireAdminPage } from "@/lib/admin-auth";
import { canManageTestimonials, listTestimonials } from "@/lib/testimonials";

export const dynamic = "force-dynamic";

export default async function AdminTestimonialsPage() {
  await requireAdminPage();

  if (!canManageTestimonials()) {
    return (
      <main className="bg-mist py-14">
        <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Depoimentos</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Depoimentos desativados</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            Configure o Supabase para gerenciar depoimentos em produção.
          </p>
          <Link href="/admin" className="mt-8 inline-flex premium-button-primary">Voltar ao painel</Link>
        </section>
      </main>
    );
  }

  const testimonials = await listTestimonials();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área administrativa</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Depoimentos</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Gerencie relatos, imagens, vídeos, publicação e ordem de exibição.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/admin/depoimentos/novo" className="premium-button-primary">Novo depoimento</Link>
          <AdminLogoutButton />
        </div>
      </section>
      <AdminSectionNav active="testimonials" />
      <AdminTestimonialList testimonials={testimonials} />
    </main>
  );
}
