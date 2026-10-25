import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { HENRY_SPEECH_DUCK_RATIO } from "@/lib/henry-spotify-core.mjs";
import { assertHenrySpotifyOwner, duckHenrySpotify, readHenryNowPlaying, restoreHenrySpotify } from "@/lib/henry-spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Player do Spotify do Henry (docs/BUSINESS_RULES.md HENRY-1), só o dono na conta real.
// GET → "Tocando agora" { isPlaying, name, artists, image, tempo } (ondas sonoras da tela cheia; consulta leve a cada ~18 s).
// POST { action: "duck" } → abaixa para ~15% enquanto ele escuta ({ ducked, previous, level });
// POST { action: "duck", speech: true } → fala do Henry: 25% do volume atual, um passo (dono, 2026-10-24);
// POST { action: "restore", volume, expect?, expectFrom? } → volta o volume guardado pela tela (subida gradual: só se o
// Spotify ainda estiver entre `expectFrom` e `expect`, o que o Henry pôs — nunca sobrescreve o ajuste manual).
// duck aceita userVolume/lastLevel (memória da tela): Spotify ainda no nível do Henry → o "antes" é o do dono (sem encadear).
const percentOrNull = (value) => (Number.isInteger(value) && value >= 0 && value <= 100 ? value : null);

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
    if (body?.action === "duck") return NextResponse.json(await duckHenrySpotify({ ratio: body?.speech === true ? HENRY_SPEECH_DUCK_RATIO : null, userVolume: percentOrNull(body?.userVolume), lastLevel: percentOrNull(body?.lastLevel) }));
    if (body?.action === "restore") {
      if (!Number.isInteger(body?.volume) || body.volume < 0 || body.volume > 100) return NextResponse.json({ error: "Volume inválido." }, { status: 400 });
      return NextResponse.json(await restoreHenrySpotify(body.volume, { expect: percentOrNull(body?.expect), expectFrom: percentOrNull(body?.expectFrom) }));
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    console.warn(`[henry] volume do Spotify falhou (${error?.status || error?.name || "erro"}).`);
    return NextResponse.json({ error: "Não consegui mudar o volume do Spotify agora." }, { status: 502 });
  }
}
