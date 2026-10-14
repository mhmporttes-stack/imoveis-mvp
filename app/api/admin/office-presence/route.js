import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { clientIpFromHeaders } from "@/lib/office-presence-core.mjs";
import {
  getOfficeNetworkPanel,
  markCurrentOfficeNetwork,
  releaseOfficeToday,
  removeOfficeNetwork,
  setOfficeRuleEnabled
} from "@/lib/office-presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ROL-2f — presença na imobiliária. Dono e gestora: ver a rede, marcar a rede
// atual e "Liberar hoje" (gestora só a própria equipe). Só o administrador
// geral liga/desliga a regra e remove rede (checado em lib/office-presence.js).
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request, "Apenas o administrador ou a gestora podem ver esta configuração.");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getOfficeNetworkPanel(auth, clientIpFromHeaders(request.headers)));
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao carregar a configuração." }, { status: 400 });
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request, "Apenas o administrador ou a gestora podem alterar esta configuração.");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const ip = clientIpFromHeaders(request.headers);
    if (body.action === "mark-network") await markCurrentOfficeNetwork(auth, ip);
    else if (body.action === "remove-network") await removeOfficeNetwork(auth, String(body.key || ""));
    else if (body.action === "set-enabled") await setOfficeRuleEnabled(auth, body.enabled === true);
    else if (body.action === "release") return NextResponse.json(await releaseOfficeToday(auth, String(body.userId || ""), body.reason === "arrived" ? "arrived" : "external"));
    else return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    return NextResponse.json(await getOfficeNetworkPanel(auth, ip));
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao salvar." }, { status: 400 });
  }
}
