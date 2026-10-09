import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { returnClientToRoulette } from "@/lib/lead-distribution";

// "Devolver para a roleta" do seletor de corretor do card (só admin/gestor).
export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const result = await returnClientToRoulette((await params).id, auth);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível devolver o cliente para a roleta." }, { status: 400 });
  }
}
