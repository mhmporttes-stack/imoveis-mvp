import { NextResponse } from "next/server";

const ADMIN_ACCESS_COOKIE = "mm_admin_access_token";
const ADMIN_REFRESH_COOKIE = "mm_admin_refresh_token";
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/reset-password"];

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const isAdminPath = pathname.startsWith("/admin");
  const isApiPath = pathname.startsWith("/api");

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

  if (isAdminPath || isApiPath) {
    return noStoreResponse(NextResponse.next());
  }

  return NextResponse.next();
}

function isPublicAdminPath(pathname) {
  return PUBLIC_ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function noStoreResponse(response) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*"]
};
