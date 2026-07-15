import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import {
  canManageSimulations,
  createSimulation,
  formatSimulationError,
  listSimulations
} from "@/lib/simulations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulations()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar simulações." }, { status: 503 });
  }

  try {
    return NextResponse.json(await listSimulations());
  } catch (error) {
    return NextResponse.json({ error: formatSimulationError(error) }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageSimulations()) {
    return NextResponse.json({ error: "Supabase não configurado para gerenciar simulações." }, { status: 503 });
  }

  try {
    const simulation = await createSimulation(await request.json(), auth.user?.email || "");
    return NextResponse.json(simulation, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: formatSimulationError(error) }, { status: 400 });
  }
}
