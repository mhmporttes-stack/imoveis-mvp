import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertHenrySpotifyOwner, playSpotifyAfterOpen } from "@/lib/henry-spotify";
import { isSpotifyUri } from "@/lib/henry-spotify-core.mjs";
import { readHenrySettings, synthesizeHenryShort } from "@/lib/henry-voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // espera o aparelho aparecer por até ~10 s

// Spotify do Henry (docs/BUSINESS_RULES.md HENRY-1), só o dono na conta real.
// POST { uri, volume? } → depois de a tela abrir o app pela URI (`open_spotify`), espera um aparelho aparecer e toca a URI nele.
// Resposta { ok, reply, audio }: reply vazio quando tocou; senão a frase curta (com a voz do Henry quando houver).
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
  // Volume opcional (bom dia com música: baixo, para não competir com a voz).
  const volume = Number.isInteger(body?.volume) && body.volume >= 0 && body.volume <= 100 ? body.volume : null;
  const result = await playSpotifyAfterOpen(body.uri, { volume });
  let audio = null;
  if (result.reply) {
    const { style } = await readHenrySettings().catch(() => ({ style: null }));
    audio = await synthesizeHenryShort(auth, result.reply, style).catch(() => null);
  }
  return NextResponse.json({ ok: result.ok, reply: result.reply, audio });
}
