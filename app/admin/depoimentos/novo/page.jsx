import AdminLogoutButton from "@/components/AdminLogoutButton";
import TestimonialForm from "@/components/TestimonialForm";
import { requireAdminPage } from "@/lib/admin-auth";

export default async function NewTestimonialPage() {
  await requireAdminPage();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo depoimento</p>
            <h1 className="mt-3 text-5xl font-black text-navy">Cadastrar depoimento</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Cadastre texto, imagem, vídeo e autorização antes de publicar.</p>
          </div>
          <AdminLogoutButton />
        </div>
      </section>
      <TestimonialForm />
    </main>
  );
}
