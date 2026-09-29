import { notFound } from "next/navigation";
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
      <TestimonialForm testimonial={testimonial} canPublish />
    </main>
  );
}
