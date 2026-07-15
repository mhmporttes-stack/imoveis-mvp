import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import {
  canManageSimulations,
  deleteSimulation,
  formatSimulationError,
  getSimulation,
  updateSimulation
} from "@/lib/simulations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulations()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar simulações." }, { status: 503 });
  }

  try {
    const simulation = await getSimulation((await params).id);
    if (!simulation) {
      return NextResponse.json({ error: "Simulação não encontrada." }, { status: 404 });
    }
    return NextResponse.json(simulation);
  } catch (error) {
    return NextResponse.json({ error: formatSimulationError(error) }, { status: 400 });
  }
}

export async function PUT(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulations()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar simulações." }, { status: 503 });
  }

  try {
    const simulation = await updateSimulation((await params).id, await request.json(), auth.user?.email || "");
    return NextResponse.json(simulation);
  } catch (error) {
    return NextResponse.json({ error: formatSimulationError(error) }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulations()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar simulações." }, { status: 503 });
  }

  try {
    await deleteSimulation((await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatSimulationError(error) }, { status: 400 });
  }
}
