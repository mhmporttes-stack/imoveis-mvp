import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { canManageTestimonials, createTestimonial, formatTestimonialError, listTestimonials } from "@/lib/testimonials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageTestimonials()) {
    return NextResponse.json({ error: "Supabase nao configurado para gerenciar depoimentos." }, { status: 503 });
  }

  try {
    return NextResponse.json(await listTestimonials());
  } catch (error) {
    return NextResponse.json({ error: formatTestimonialError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageTestimonials()) {
    return NextResponse.json({ error: "Supabase nao configurado para gerenciar depoimentos." }, { status: 503 });
  }

  try {
    const testimonial = await createTestimonial(await request.json());
    return NextResponse.json(testimonial, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: formatTestimonialError(error) || "Nao foi possivel cadastrar o depoimento." }, { status: 400 });
  }
}
