import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { deleteTestimonial, formatTestimonialError, getTestimonial, updateTestimonial } from "@/lib/testimonials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const testimonial = await getTestimonial(id);
    if (!testimonial) {
      return NextResponse.json({ error: "Depoimento nao encontrado." }, { status: 404 });
    }

    return NextResponse.json(testimonial);
  } catch (error) {
    return NextResponse.json({ error: formatTestimonialError(error) }, { status: 400 });
  }
}

export async function PUT(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const testimonial = await updateTestimonial(id, await request.json());
    if (!testimonial) {
      return NextResponse.json({ error: "Depoimento nao encontrado." }, { status: 404 });
    }

    return NextResponse.json(testimonial);
  } catch (error) {
    return NextResponse.json({ error: formatTestimonialError(error) || "Nao foi possivel atualizar o depoimento." }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await params;
    const ok = await deleteTestimonial(id);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  } catch (error) {
    return NextResponse.json({ error: formatTestimonialError(error) || "Nao foi possivel excluir o depoimento." }, { status: 400 });
  }
}
