import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertHenrySpotifyOwner, playSpotifyAfterOpen } from "@/lib/henry-spotify";
import { isSpotifyUri } from "@/lib/henry-spotify-core.mjs";
import { readHenrySettings, synthesizeHenryShort } from "@/lib/henry-voice";
import { HENRY_FALLBACK_REPLY, safeHenryReply } from "@/lib/henry-voice-core.mjs";
import { musicPlayingLine } from "@/lib/henry-voice-narration.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // espera o aparelho aparecer por até ~10 s

// Spotify do Henry (docs/BUSINESS_RULES.md HENRY-1), só o dono na conta real.
// POST { uri, announce?, name?, artists? } → depois de a tela abrir o app pela URI (`open_spotify`), espera um aparelho
// aparecer e toca a URI nele. Resposta { ok, reply, audio }: tocou → "Pronto, tá tocando! <nome>." (dono, 2026-10-23;
// nome/artista que a busca já mostrou na tela, passando pela barreira da fala); senão a frase curta do erro.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    assertHenrySpotifyOwner(auth);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (!isSpotifyUri(body?.uri)) return NextResponse.json({ error: "Item do Spotify inválido." }, { status: 400 });
  // Sem volume (dono, 2026-10-24: o play não mexe no volume do Spotify); `volume` antigo no corpo é ignorado.
  const result = await playSpotifyAfterOpen(body.uri);
  if (result.ok && body?.announce !== false) {
    const line = safeHenryReply(musicPlayingLine({ name: typeof body?.name === "string" ? body.name : "", artists: typeof body?.artists === "string" ? body.artists : "" }));
    result.reply = line === HENRY_FALLBACK_REPLY ? "Pronto, tá tocando!" : line;
  }
  let audio = null;
  if (result.reply) {
    const { style } = await readHenrySettings().catch(() => ({ style: null }));
    audio = await synthesizeHenryShort(auth, result.reply, style).catch(() => null);
  }
  return NextResponse.json({ ok: result.ok, reply: result.reply, audio });
}
