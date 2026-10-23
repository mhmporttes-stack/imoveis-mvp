import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { generateWifiPresenceToken, getWifiPresenceStatus, revokeWifiPresenceToken, saveWifiPresenceTriggers } from "@/lib/presence-wifi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Configuração da "Chegada pelo Wi-Fi" (PRES-WIFI). Conta REAL do administrador geral; a lib ainda restringe ao dono
// (isWifiPresenceEligible). A chave nova aparece só na resposta de "token".
export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ status: await getWifiPresenceStatus(auth) });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível carregar." }, { status: error?.status || 500 });
  }
}

// action: "token" (gera/troca a chave), "revoke" (desativa a chave) ou "triggers" ({ plugOnDevice, plugOffDevice }).
export async function POST(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  try {
    if (body.action === "token") return NextResponse.json({ token: await generateWifiPresenceToken(auth) });
    if (body.action === "revoke") {
      await revokeWifiPresenceToken(auth);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "triggers") {
      await saveWifiPresenceTriggers(auth, { plugOnDevice: body.plugOnDevice, plugOffDevice: body.plugOffDevice });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível concluir a ação." }, { status: error?.status || 400 });
  }
}
