import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { createDailyMessageDispatch, listDailyMessageDispatchHistory } from "@/lib/daily-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ ok: true, dispatches: await listDailyMessageDispatchHistory(auth) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível carregar o histórico." }, { status: error?.status || 400 });
  }
}

// Item 40 (proteção contra duplo disparo): o cliente envia um idempotencyKey
// próprio gerado uma única vez por fluxo de confirmação; reenviar o mesmo
// valor (duplo clique, retry de rede) devolve o disparo já criado em vez de
// criar um segundo.
export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const payload = await request.json();
    const result = await createDailyMessageDispatch(payload, auth);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível disparar a mensagem." }, { status: error?.status || 400 });
  }
}
