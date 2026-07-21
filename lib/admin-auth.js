import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabasePublicClient, hasSupabasePublicConfig } from "./supabase";

export const ADMIN_ACCESS_COOKIE = "mm_admin_access_token";
export const ADMIN_REFRESH_COOKIE = "mm_admin_refresh_token";

const ACCESS_COOKIE_MAX_AGE = 60 * 60;
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const DEFAULT_ADMIN_EMAIL = "mhmporttes@gmail.com";

export function getConfiguredAdminEmail() {
  return (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
}

export function isAuthorizedAdminEmail(email) {
  const adminEmail = getConfiguredAdminEmail();
  return Boolean(adminEmail && email && email.trim().toLowerCase() === adminEmail);
}

export function setAdminSessionCookies(response, request, session) {
  const secure = request.nextUrl?.protocol === "https:" || process.env.VERCEL === "1";
  const baseOptions = {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure
  };

  response.cookies.set(ADMIN_ACCESS_COOKIE, session.accessToken, {
    ...baseOptions,
    maxAge: ACCESS_COOKIE_MAX_AGE
  });

  if (session.refreshToken) {
    response.cookies.set(ADMIN_REFRESH_COOKIE, session.refreshToken, {
      ...baseOptions,
      maxAge: REFRESH_COOKIE_MAX_AGE
    });
  }
}

export function clearAdminSessionCookies(response, request) {
  const secure = request?.nextUrl?.protocol === "https:" || process.env.VERCEL === "1";
  const options = {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure
  };

  response.cookies.set(ADMIN_ACCESS_COOKIE, "", options);
  response.cookies.set(ADMIN_REFRESH_COOKIE, "", options);
}

export function getAccessTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  return request.cookies.get(ADMIN_ACCESS_COOKIE)?.value || "";
}

export async function verifyAdminAccessToken(accessToken) {
  if (!accessToken || !hasSupabasePublicConfig) {
    return { ok: false, status: 401, error: "Nao autenticado." };
  }

  const supabase = getSupabasePublicClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    return { ok: false, status: 401, error: "Nao autenticado." };
  }

  if (!isAuthorizedAdminEmail(data.user.email)) {
    return { ok: false, status: 403, error: "Acesso nao autorizado.", user: data.user };
  }

  return { ok: true, status: 200, user: data.user };
}

export async function refreshAdminSession(refreshToken) {
  if (!refreshToken || !hasSupabasePublicConfig) {
    return { ok: false, status: 401, error: "Nao autenticado." };
  }

  const supabase = getSupabasePublicClient();
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken
  });

  const session = data?.session;
  const user = data?.user;

  if (error || !session?.access_token || !user) {
    return { ok: false, status: 401, error: "Nao autenticado." };
  }

  if (!isAuthorizedAdminEmail(user.email)) {
    return { ok: false, status: 403, error: "Acesso nao autorizado.", user };
  }

  return {
    ok: true,
    status: 200,
    user,
    session: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token || refreshToken
    }
  };
}

export async function verifyAdminSessionTokens(accessToken, refreshToken = "") {
  const accessResult = await verifyAdminAccessToken(accessToken);
  if (accessResult.ok || accessResult.status === 403) return accessResult;
  return refreshAdminSession(refreshToken);
}

export async function requireAdminApi(request) {
  return verifyAdminSessionTokens(
    getAccessTokenFromRequest(request),
    request.cookies.get(ADMIN_REFRESH_COOKIE)?.value || ""
  );
}

export async function getAdminFromCookies() {
  const cookieStore = await cookies();
  return verifyAdminSessionTokens(
    cookieStore.get(ADMIN_ACCESS_COOKIE)?.value || "",
    cookieStore.get(ADMIN_REFRESH_COOKIE)?.value || ""
  );
}

export async function requireAdminPage() {
  const result = await getAdminFromCookies();
  if (result.ok) return result.user;

  const error = result.status === 403 ? "?error=unauthorized" : "";
  redirect(`/admin/login${error}`);
}
