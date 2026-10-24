import { NextResponse } from "next/server";
import { requireHenryOwner } from "@/lib/henry-auth";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import {
  HenryLockError,
  engageHenryLock,
  henryLockCookieOptions,
  henryLockTokenHash,
  leaveHenryFullscreen,
  resolveHenryLock,
  setHenryLockIdle,
  setHenryLockPin,
  unlockHenryLock
} from "@/lib/henry-lock";
import { HENRY_LOCK_COOKIE } from "@/lib/henry-lock-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tela de bloqueio do Henry (REGRA OFICIAL — dono, 2026-10-24, bloqueio só manual; docs/BUSINESS_RULES.md HENRY-LOCK). Só o dono (mesmo
// guard do Henry). Estado, tentativas e esperas ficam no SERVIDOR (lib/henry-lock.js); a senha nunca vai para log.
//   GET                                → { configured, locked, fullscreen, idleMinutes, waitSeconds }
//   POST { action: "engage" }          → bloqueia (cadeado da barra da tela cheia ou "Henry, bloqueia")
//   POST { action: "unlock", pin }     → desbloqueia e grava o cookie HttpOnly deste aparelho
//   POST { action: "touch" }           → devolve o estado (sem efeito desde 2026-10-24: não há trava por inatividade)
//   POST { action: "leave" }           → saiu da tela cheia desbloqueado (Henry pequeno = como antes)
//   POST { action: "set_pin", pin, currentPin? } → definir/trocar a senha (trocar exige a atual)
//   POST { action: "idle", minutes }   → grava os minutos (legado, SEM efeito desde 2026-10-24; a tela não oferece mais)

function lockError(error) {
  if (error instanceof HenryLockError) {
    return NextResponse.json({ error: error.message, ...(error.waitSeconds ? { waitSeconds: error.waitSeconds } : {}), ...(Number.isInteger(error.attemptsLeft) ? { attemptsLeft: error.attemptsLeft } : {}), ...(error.locked ? { locked: true } : {}) }, { status: error.status });
  }
  console.error("[henry-lock] falha:", error?.message || error);
  return NextResponse.json({ error: "Não foi possível falar com a tela de bloqueio agora." }, { status: 500 });
}

export async function GET(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await resolveHenryLock(auth, { tokenHash: henryLockTokenHash(request) }));
  } catch (error) {
    return lockError(error);
  }
}

export async function POST(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";
  const tokenHash = henryLockTokenHash(request);
  try {
    if (action === "engage") {
      const state = await engageHenryLock(auth);
      const response = NextResponse.json(state);
      response.cookies.set(HENRY_LOCK_COOKIE, "", henryLockCookieOptions({ clear: true }));
      return response;
    }
    if (action === "unlock" || action === "set_pin") {
      // Reforço contra rajada em paralelo (a contagem de erros e as esperas são a trava principal): 10 por minuto.
      if (!(await checkPublicRateLimit(`henry-pin:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 10, failClosed: true }))) {
        return NextResponse.json({ error: "Muitas tentativas seguidas. Espere um minuto." }, { status: 429 });
      }
      const pin = typeof body?.pin === "string" ? body.pin : "";
      if (action === "set_pin") return NextResponse.json(await setHenryLockPin(auth, { pin, currentPin: typeof body?.currentPin === "string" ? body.currentPin : "" }));
      const { token, state } = await unlockHenryLock(auth, pin);
      const response = NextResponse.json(state);
      response.cookies.set(HENRY_LOCK_COOKIE, token, henryLockCookieOptions());
      return response;
    }
    if (action === "touch") return NextResponse.json(await resolveHenryLock(auth, { tokenHash, touch: true }));
    if (action === "leave") return NextResponse.json(await leaveHenryFullscreen(auth));
    if (action === "idle") return NextResponse.json(await setHenryLockIdle(auth, body?.minutes));
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return lockError(error);
  }
}
