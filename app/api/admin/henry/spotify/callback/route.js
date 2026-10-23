import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { assertHenrySpotifyOwner, connectSpotify, isSpotifyConfigured } from "@/lib/henry-spotify";
import { SPOTIFY_STATE_COOKIE, isValidSpotifyState } from "@/lib/henry-spotify-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Volta da autorização do Spotify (docs/BUSINESS_RULES.md HENRY-1): só o dono; confere o `state` do cookie, troca o código
// pelos tokens (refresh token só no servidor) e volta para a tela Alexa e Henry com ?spotify=conectado|erro|negado.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    assertHenrySpotifyOwner(auth);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  const url = new URL(request.url);
  const back = (result) => {
    const response = NextResponse.redirect(new URL(`/admin/alexa?spotify=${result}`, url.origin));
    response.cookies.set(SPOTIFY_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/admin/henry/spotify", maxAge: 0 });
    return response;
  };
  if (!isValidSpotifyState(url.searchParams.get("state"), request.cookies.get(SPOTIFY_STATE_COOKIE)?.value)) {
    return NextResponse.json({ error: "Pedido de conexão inválido ou expirado. Tente conectar de novo." }, { status: 400 });
  }
  if (url.searchParams.get("error")) return back("negado");
  const code = url.searchParams.get("code");
  if (!code || !isSpotifyConfigured()) return back("erro");
  try {
    await connectSpotify(auth, code);
    return back("conectado");
  } catch (error) {
    console.warn(`[henry] spotify: conexão falhou: ${error?.status || error?.message || "erro"}.`);
    return back("erro");
  }
}
