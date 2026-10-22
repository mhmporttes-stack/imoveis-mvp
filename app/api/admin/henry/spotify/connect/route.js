import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertHenrySpotifyOwner, disconnectSpotify, isSpotifyConfigured, spotifyRedirectUri } from "@/lib/henry-spotify";
import { SPOTIFY_STATE_COOKIE, buildSpotifyAuthorizeUrl } from "@/lib/henry-spotify-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Spotify do Henry (docs/BUSINESS_RULES.md HENRY-1), só o dono na conta real.
// GET    → redireciona para a autorização do Spotify (Authorization Code) com `state` anti-CSRF em cookie HttpOnly (10 min).
// DELETE → desconecta (apaga o refresh token guardado).
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
  const { auth, response } = await guard(request);
  if (!auth) return response;
  if (!isSpotifyConfigured()) return NextResponse.json({ error: "Spotify não configurado: cadastre SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET na Vercel." }, { status: 503 });
  const state = randomBytes(24).toString("hex");
  const redirect = NextResponse.redirect(buildSpotifyAuthorizeUrl({ clientId: process.env.SPOTIFY_CLIENT_ID, redirectUri: spotifyRedirectUri(), state }));
  redirect.cookies.set(SPOTIFY_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin/henry/spotify",
    maxAge: 600
  });
  return redirect;
}

export async function DELETE(request) {
  const { auth, response } = await guard(request);
  if (!auth) return response;
  try {
    await disconnectSpotify(auth);
    return NextResponse.json({ connected: false });
  } catch (error) {
    console.error("[henry] spotify: falha ao desconectar:", error?.message || "erro");
    return NextResponse.json({ error: "Não foi possível desconectar o Spotify." }, { status: 500 });
  }
}
