import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertHenrySpotifyOwner, duckHenrySpotify, readHenryNowPlaying, restoreHenrySpotify } from "@/lib/henry-spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Player do Spotify do Henry (docs/BUSINESS_RULES.md HENRY-1), só o dono na conta real.
// GET → "Tocando agora" { isPlaying, name, artists, image, tempo } (ondas sonoras da tela cheia; consulta leve a cada ~18 s).
// POST { action: "duck" } → abaixa para ~15% enquanto ele escuta/fala ({ ducked, previous });
// POST { action: "restore", volume } → volta o volume guardado pela tela.
async function guard(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  try {
    assertHenrySpotifyOwner(auth);
  } catch (error) {
    return { response: NextResponse.json({ error: error.message }, { status: 403 }) };
  }
  return { auth };
}

export async function GET(request) {
  const { response } = await guard(request);
  if (response) return response;
  try {
    return NextResponse.json(await readHenryNowPlaying());
  } catch (error) {
    console.warn(`[henry] tocando agora indisponível (${error?.message === "spotify_revoked" ? "revogado" : error?.status || error?.name || "erro"}).`);
    return NextResponse.json({ error: "Não consegui ler o Spotify agora." }, { status: 502 });
  }
}

export async function POST(request) {
  const { response } = await guard(request);
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  try {
    if (body?.action === "duck") return NextResponse.json(await duckHenrySpotify());
    if (body?.action === "restore") {
      if (!Number.isInteger(body?.volume) || body.volume < 0 || body.volume > 100) return NextResponse.json({ error: "Volume inválido." }, { status: 400 });
      return NextResponse.json(await restoreHenrySpotify(body.volume));
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    console.warn(`[henry] volume do Spotify falhou (${error?.status || error?.name || "erro"}).`);
    return NextResponse.json({ error: "Não consegui mudar o volume do Spotify agora." }, { status: 502 });
  }
}
