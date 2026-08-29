import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import TestimonialForm from "@/components/TestimonialForm";
import { requireAdminPage } from "@/lib/admin-auth";
import { getTestimonial } from "@/lib/testimonials";

export const dynamic = "force-dynamic";

export default async function EditTestimonialPage({ params }) {
  await requireAdminPage();

  const { id } = await params;
  const testimonial = await getTestimonial(id);
  if (!testimonial) notFound();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Edição</p>
            <h1 className="mt-3 text-5xl font-black text-navy">Editar depoimento</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Atualize conteúdo, mídia, autorização, publicação e ordem.</p>
          </div>
          <AdminLogoutButton />
        </div>
      </section>
      <TestimonialForm testimonial={testimonial} />
    </main>
  );
}
