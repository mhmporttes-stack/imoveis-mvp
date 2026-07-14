import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { updateTestimonialPublication } from "@/lib/testimonials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const payload = await request.json();
    const testimonial = await updateTestimonialPublication(id, payload?.isPublished === true);
    if (!testimonial) {
      return NextResponse.json({ error: "Depoimento nao encontrado." }, { status: 404 });
    }

    return NextResponse.json(testimonial);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Nao foi possivel alterar a publicacao." }, { status: 400 });
  }
}
