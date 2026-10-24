import { NextResponse } from "next/server";
import { requireHenryOwner } from "@/lib/henry-auth";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import { HenryLockError, henryLockCookieOptions } from "@/lib/henry-lock";
import { HENRY_LOCK_COOKIE } from "@/lib/henry-lock-core.mjs";
import {
  PasskeyError,
  finishHenryPasskeyRegistration,
  finishHenryPasskeyUnlock,
  getHenryPasskeyStatus,
  passkeyRpFromRequest,
  removeHenryPasskey,
  startHenryPasskeyRegistration,
  startHenryPasskeyUnlock
} from "@/lib/admin-passkeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Face ID / Windows Hello para desbloquear a tela do Henry (REGRA OFICIAL — dono, 2026-10-24; docs/BUSINESS_RULES.md
// HENRY-LOCK "Face ID"). Só o dono (mesmo guard do Henry, que já exige a sessão com senha + 2FA). O login do CRM não muda.
//   GET                                          → { available, devices: [{ id, deviceName, createdAt, lastUsedAt }] }
//   POST { action: "register_options", code }    → código do app autenticador conferido agora → opções do cadastro
//   POST { action: "register", response, deviceName? } → guarda a chave pública deste aparelho
//   POST { action: "remove", id }                → remove um aparelho
//   POST { action: "unlock_options" }            → desafio do desbloqueio
//   POST { action: "unlock", response }          → assinatura conferida = mesmo que a senha certa (cookie deste aparelho)

function passkeyError(error) {
  if (error instanceof PasskeyError || error instanceof HenryLockError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[passkey] falha:", error?.message || error);
  return NextResponse.json({ error: "Não foi possível usar o Face ID agora. Use a senha." }, { status: 500 });
}

export async function GET(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getHenryPasskeyStatus(auth));
  } catch (error) {
    return passkeyError(error);
  }
}

export async function POST(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";
  try {
    if (action === "remove") return NextResponse.json(await removeHenryPasskey(auth, body?.id));
    if (!["register_options", "register", "unlock_options", "unlock"].includes(action)) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    // Reforço contra rajada (o código do app tem a própria trava de 5 erros; o desafio é de uso único): 10 por minuto.
    if (!(await checkPublicRateLimit(`henry-passkey:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 10, failClosed: true }))) {
      return NextResponse.json({ error: "Muitas tentativas seguidas. Espere um minuto." }, { status: 429 });
    }
    const rp = passkeyRpFromRequest(request);
    if (action === "register_options") {
      const code = typeof body?.code === "string" ? body.code : "";
      return NextResponse.json({ options: await startHenryPasskeyRegistration(auth, { code, rp }) });
    }
    if (action === "register") {
      const device = await finishHenryPasskeyRegistration(auth, {
        response: body?.response,
        rp,
        deviceName: typeof body?.deviceName === "string" ? body.deviceName : "",
        userAgent: request.headers.get("user-agent") || ""
      });
      return NextResponse.json({ device });
    }
    if (action === "unlock_options") return NextResponse.json({ options: await startHenryPasskeyUnlock(auth, { rp }) });
    const { token, state } = await finishHenryPasskeyUnlock(auth, { response: body?.response, rp });
    const response = NextResponse.json(state);
    response.cookies.set(HENRY_LOCK_COOKIE, token, henryLockCookieOptions());
    return response;
  } catch (error) {
    return passkeyError(error);
  }
}
