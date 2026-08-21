import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabasePublicClient, hasSupabasePublicConfig } from "./supabase";
import {
  ADMIN_ROLE,
  ADMIN_USER_STATUS,
  getAdminProfileForAuthUser,
  isActiveAdminProfile,
  isGeneralAdminProfile
} from "./admin-profiles";
import { getAdminDisplayName } from "./admin-users";

export const ADMIN_ACCESS_COOKIE = "mm_admin_access_token";
export const ADMIN_REFRESH_COOKIE = "mm_admin_refresh_token";

const ACCESS_COOKIE_MAX_AGE = 60 * 60;
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const OWNER_ADMIN_EMAILS = ["mhmporttes@gmail.com", "mhmporttes@icloud.com"];
const DEFAULT_ADMIN_EMAILS = [...OWNER_ADMIN_EMAILS, "forbencke@gmail.com"];

export function getConfiguredAdminEmail() {
  return getConfiguredAdminEmails()[0] || "";
}

export function getConfiguredAdminEmails() {
  const configuredEmails = [
    process.env.ADMIN_EMAIL,
    process.env.ADMIN_EMAILS
  ]
    .filter(Boolean)
    .flatMap((value) => value.split(/[,\n;]/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set([...configuredEmails, ...DEFAULT_ADMIN_EMAILS]));
}

export function isAuthorizedAdminEmail(email) {
  const normalizedEmail = email?.trim().toLowerCase();
  return Boolean(normalizedEmail && getConfiguredAdminEmails().includes(normalizedEmail));
}

export function isPrimaryAdminEmail(email) {
  return isOwnerAdminEmail(email);
}

export function isOwnerAdminEmail(email) {
  const normalizedEmail = email?.trim().toLowerCase();
  const configuredOwnerEmails = [
    process.env.ADMIN_EMAIL,
    process.env.ADMIN_OWNER_EMAILS
  ]
    .filter(Boolean)
    .flatMap((value) => value.split(/[,\n;]/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return Boolean(
    normalizedEmail &&
      new Set([...configuredOwnerEmails, ...OWNER_ADMIN_EMAILS]).has(normalizedEmail)
  );
}

export function isGeneralAdmin(authOrProfile) {
  const profile = authOrProfile?.profile || authOrProfile;
  return isGeneralAdminProfile(profile);
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

  return buildAuthorizedAdminResult(data.user);
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

  const authResult = await buildAuthorizedAdminResult(user);
  if (!authResult.ok) return authResult;

  return {
    ...authResult,
    ok: true,
    status: 200,
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

export async function requirePrimaryAdminApi(request) {
  return requireGeneralAdminApi(request, "Acesso financeiro nao autorizado.");
}

export async function requireGeneralAdminApi(request, errorMessage = "Apenas o administrador geral pode acessar esta área.") {
  const result = await requireAdminApi(request);
  if (!result.ok) return result;

  if (!isGeneralAdminProfile(result.profile)) {
    return { ok: false, status: 403, error: errorMessage, user: result.user, profile: result.profile };
  }

  return result;
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
  if (result.ok) return result;

  const error = result.status === 403 ? "?error=unauthorized" : "";
  redirect(`/admin/login${error}`);
}

export async function requirePrimaryAdminPage() {
  return requireGeneralAdminPage("/admin");
}

export async function requireGeneralAdminPage(fallbackPath = "/admin") {
  const result = await getAdminFromCookies();
  if (!result.ok) {
    const error = result.status === 403 ? "?error=unauthorized" : "";
    redirect(`/admin/login${error}`);
  }

  if (!isGeneralAdminProfile(result.profile)) {
    redirect(fallbackPath);
  }

  return result;
}

async function buildAuthorizedAdminResult(user) {
  if (!user?.email) {
    return { ok: false, status: 401, error: "Nao autenticado.", user };
  }

  let profile = null;
  try {
    profile = await getAdminProfileForAuthUser(user);
  } catch (error) {
    console.error("Nao foi possivel carregar perfil administrativo.", error);
  }

  if (!profile) {
    if (!isAuthorizedAdminEmail(user.email)) {
      return { ok: false, status: 403, error: "Acesso nao autorizado.", user };
    }

    profile = buildLegacyAdminProfile(user);
  }

  if (isOwnerAdminEmail(user.email) && !isGeneralAdminProfile(profile)) {
    profile = {
      ...profile,
      role: ADMIN_ROLE.ADMIN
    };
  }

  if (!isActiveAdminProfile(profile)) {
    return { ok: false, status: 403, error: "Usuário administrativo inativo.", user, profile };
  }

  return { ok: true, status: 200, user, profile };
}

function buildLegacyAdminProfile(user) {
  const email = user?.email?.trim().toLowerCase() || "";
  return {
    id: "",
    authUserId: user?.id || "",
    name: getAdminDisplayName(email),
    email,
    phone: "",
    role: isPrimaryAdminEmail(email) ? ADMIN_ROLE.ADMIN : ADMIN_ROLE.BROKER,
    status: ADMIN_USER_STATUS.ACTIVE,
    simulationRef: email === "forbencke@gmail.com" ? "benck" : "matheus",
    captacaoRef: email === "forbencke@gmail.com" ? "benck-captacao" : "matheus-captacao",
    isFallback: true
  };
}
