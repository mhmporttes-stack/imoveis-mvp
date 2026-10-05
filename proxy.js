import { NextResponse } from "next/server";

const ADMIN_ACCESS_COOKIE = "mm_admin_access_token";
const ADMIN_REFRESH_COOKIE = "mm_admin_refresh_token";
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/reset-password"];
// Link da apresentação interativa da simulação: /s/<token> (24 caracteres base62 com maiúscula, minúscula e dígito;
// lib/simulation-presentation-core.mjs). O ref curto de corretor (/s/mhm, /s/1) é sempre minúsculo e continua na
// rota de redirecionamento de sempre; só o formato do token é reescrito para a página pública. Os dois subcaminhos
// (/imagem, /documentos e /og) são as imagens PNG da apresentação (resumo, lista de documentos e prévia de compartilhamento), do mesmo token.
const PRESENTATION_TOKEN_PATH = /^\/s\/(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[0-9])([A-Za-z0-9]{24})(?:\/(imagem|documentos|og))?\/?$/;

export function proxy(request) {
  const { pathname } = request.nextUrl;

  const presentationMatch = PRESENTATION_TOKEN_PATH.exec(pathname);
  if (presentationMatch) {
    const target = request.nextUrl.clone();
    target.pathname = `/apresentacao/${presentationMatch[1]}${presentationMatch[2] ? `/${presentationMatch[2]}` : ""}`;
    // a página não usa query; as imagens usam só ?baixar=1 (anexo)
    if (!presentationMatch[2]) target.search = "";
    return privatePresentationResponse(NextResponse.rewrite(target));
  }
  if (pathname.startsWith("/apresentacao/")) return privatePresentationResponse(NextResponse.next());
  if (pathname.startsWith("/s/")) return NextResponse.next(); // ref curto de corretor: comportamento de sempre
  const isAdminPath = pathname.startsWith("/admin");
  const isApiPath = pathname.startsWith("/api");
  const isAcademyPath = pathname.startsWith("/academia");

  if (isAdminPath && !isPublicAdminPath(pathname)) {
    const hasSessionCookie =
      request.cookies.has(ADMIN_ACCESS_COOKIE) || request.cookies.has(ADMIN_REFRESH_COOKIE);

    if (!hasSessionCookie) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/admin/login";
      loginUrl.search = "";
      return noStoreResponse(NextResponse.redirect(loginUrl));
    }
  }

  // Academia: mesma proteção de /admin (sem cookie de sessão => login).
  if (isAcademyPath) {
    const hasSessionCookie =
      request.cookies.has(ADMIN_ACCESS_COOKIE) || request.cookies.has(ADMIN_REFRESH_COOKIE);

    if (!hasSessionCookie) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/admin/login";
      loginUrl.search = "";
      return noStoreResponse(NextResponse.redirect(loginUrl));
    }

    return noStoreResponse(NextResponse.next());
  }

  if (isAdminPath || isApiPath) {
    return noStoreResponse(NextResponse.next());
  }

  return NextResponse.next();
}

function isPublicAdminPath(pathname) {
  return PUBLIC_ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// Página pública por link: nunca em cache, nunca indexada, sem Referer.
function privatePresentationResponse(response) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function noStoreResponse(response) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/academia/:path*", "/s/:path*", "/apresentacao/:path*"]
};
