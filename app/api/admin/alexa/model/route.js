import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { listAdminProfiles } from "@/lib/admin-profiles";
import { auditModel, buildInteractionModel } from "@/lib/alexa-v2/model-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Modelo de interação da Alexa gerado com os corretores ATIVOS do cadastro do CRM
// (id, nome completo e apelidos de lib/alexa-v2/broker-aliases.mjs). Só leitura,
// só administrador geral. Cole o JSON no Console da Alexa (Build -> JSON Editor).
//   GET ?brokers=1  -> só a lista de corretores (alimenta scripts/alexa-brokers.json)
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const profiles = await listAdminProfiles();
    const brokers = profiles
      .filter((profile) => profile.role !== "admin" && profile.status !== "inactive" && profile.name)
      .map((profile) => ({ id: profile.id, name: String(profile.name).trim().split(/\s+/)[0], fullName: String(profile.name).replace(/[^\p{L}\s'-]/gu, "").replace(/\s+/g, " ").trim(), gender: profile.gender || "" }));
    if (new URL(request.url).searchParams.get("brokers")) return NextResponse.json({ brokers });
    const model = buildInteractionModel({ brokers });
    return NextResponse.json({ problems: auditModel(model), brokers: brokers.length, model });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível gerar o modelo." }, { status: 500 });
  }
}
