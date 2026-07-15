import Link from "next/link";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AdminTestimonialList from "@/components/AdminTestimonialList";
import { requireAdminPage } from "@/lib/admin-auth";
import { canManageTestimonials, formatTestimonialError, listTestimonials } from "@/lib/testimonials";

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

  let testimonials = [];
  let loadError = "";

  try {
    testimonials = await listTestimonials();
  } catch (error) {
    loadError = formatTestimonialError(error);
  }

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
      {loadError ? (
        <section className="container-page rounded-[28px] border border-red-200 bg-white p-8 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-red-700">Erro ao carregar depoimentos</p>
          <h2 className="mt-3 text-3xl font-black text-navy">A pagina abriu, mas o Supabase retornou um erro.</h2>
          <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">
            {loadError}
          </p>
          <p className="mt-4 max-w-3xl leading-8 text-muted">
            Confira se a migration da tabela <strong>public.testimonials</strong> foi executada no Supabase e se a chave
            <strong> SUPABASE_SERVICE_ROLE_KEY</strong> esta correta na Vercel.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/admin/depoimentos" className="premium-button-primary">Tentar novamente</Link>
            <Link href="/admin" className="premium-button-secondary">Voltar ao painel</Link>
          </div>
        </section>
      ) : (
        <AdminTestimonialList testimonials={testimonials} />
      )}
    </main>
  );
}
