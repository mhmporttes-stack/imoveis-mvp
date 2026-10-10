import { CHAT_DISABLED_CODE, CHAT_DISABLED_MESSAGE, isChatDisabled, isChatRestrictedProfile } from "./chat-control";
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabasePublicClient, hasSupabasePublicConfig } from "./supabase";
import {
  ADMIN_ROLE,
  ADMIN_USER_STATUS,
  getAdminProfileForAuthUser,
  getAdminProfileById,
  isActiveAdminProfile,
  isAssociateProfile,
  isGeneralAdminAuth,
  isGeneralAdminProfile,
  isManagerProfile
} from "./admin-profiles";
import { getAdminDisplayName } from "./admin-users";
import { TWO_FACTOR_DEVICE_COOKIE, TWO_FACTOR_SESSION_COOKIE, checkOwnerSecondFactor, clearTwoFactorCookies } from "./admin-two-factor";
import { TWO_FACTOR_REQUIRED_CODE, isSecondFactorMissing } from "./admin-two-factor-core.mjs";
import { WHATSAPP_ACCESS_BLOCKED_CODE, WHATSAPP_ACCESS_BLOCKED_MESSAGE, isEffectivelyBlocked, isWhatsappPathProtected } from "./whatsapp-access-core.mjs";

export const ADMIN_ACCESS_COOKIE = "mm_admin_access_token";
export const ADMIN_REFRESH_COOKIE = "mm_admin_refresh_token";
export const ADMIN_VIEW_AS_COOKIE = "mm_admin_view_as";

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
  return isGeneralAdminAuth(authOrProfile) || isGeneralAdminProfile(profile);
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
  response.cookies.set(ADMIN_VIEW_AS_COOKIE, "", options);
  // Prova do 2º fator é da sessão que está saindo; o "lembrar este aparelho" continua (regra do dono, 2026-10-08).
  clearTwoFactorCookies(response, request);
}

export function clearAdminViewAsCookie(response, request) {
  const secure = request?.nextUrl?.protocol === "https:" || process.env.VERCEL === "1";
  response.cookies.set(ADMIN_VIEW_AS_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure
  });
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
  const accessToken = getAccessTokenFromRequest(request);
  const result = await applyTwoFactorGuard(
    await verifyAdminSessionTokens(accessToken, request.cookies.get(ADMIN_REFRESH_COOKIE)?.value || ""),
    accessToken,
    (name) => request.cookies.get(name)?.value || ""
  );
  const effectiveResult = await applyViewAsProfile(
    result,
    request.cookies.get(ADMIN_VIEW_AS_COOKIE)?.value || ""
  );

  const guarded = applyWhatsappAccessGuard(request, effectiveResult);
  const final = guarded.ok ? await applyChatDisabledGuard(request, guarded) : guarded;
  return final.ok ? { ...final, requestContext: buildRequestContext(request, final) } : final;
}

// Quem está de fato no teclado (2026-10-08): o remetente de uma mensagem do Chat é sempre a CONTA logada; para não perder
// o rastro quando a conta é emprestada ou usada em "Alterar conta", cada requisição carrega a sessão de login (claim
// session_id do token já validado), o IP, o navegador e se é uma conta emulada. Só é lido por quem grava auditoria.
function buildRequestContext(request, result) {
  let sessionId = "";
  try {
    const token = getAccessTokenFromRequest(request) || "";
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
    sessionId = String(payload?.session_id || "").slice(0, 64);
  } catch {
    sessionId = "";
  }
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return {
    sessionId,
    ip: forwarded.split(",")[0].trim().slice(0, 64),
    ua: (request.headers.get("user-agent") || "").slice(0, 160),
    viaAccountSwitch: Boolean(result.accountSwitchMode),
    realUserId: result.realProfile?.id || "",
    realName: result.realProfile?.name || ""
  };
}

// BARREIRA CENTRAL do controle de acesso aos recursos WhatsApp (2026-10-04, lib/whatsapp-access-core.mjs): toda API
// protegida passa por requireAdminApi, então o corretor BLOQUEADO recebe 403 mesmo chamando a URL direto. A lista de
// rotas protegidas fica num só lugar (PROTECTED_API_RULES). O perfil efetivo vale também em "Alterar conta".
function applyWhatsappAccessGuard(request, result) {
  if (!result.ok || !isEffectivelyBlocked(result.profile)) return result;
  let pathname = "";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return result;
  }
  if (!isWhatsappPathProtected(pathname, request.method, result.profile?.role)) return result;
  return { ...result, ok: false, status: 403, error: WHATSAPP_ACCESS_BLOCKED_MESSAGE, code: WHATSAPP_ACCESS_BLOCKED_CODE };
}

// CHAT DESATIVADO (2026-10-05, lib/chat-control.js): corretor/associado não chamam a API do Chat (403) enquanto a chave
// do dono estiver ligada; administrador e gestor continuam lendo.
async function applyChatDisabledGuard(request, result) {
  if (!isChatRestrictedProfile(result.profile)) return result;
  let pathname = "";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return result;
  }
  if (!/^\/api\/admin\/whatsapp-chat(\/|$)/.test(pathname)) return result;
  if (!(await isChatDisabled())) return result;
  return { ...result, ok: false, status: 403, error: CHAT_DISABLED_MESSAGE, code: CHAT_DISABLED_CODE };
}

// Páginas do WhatsApp (Chat): o corretor bloqueado volta para o painel de clientes (a tela nem abre).
export async function requireWhatsappAccessPage(fallbackPath = "/admin/simulacoes") {
  const result = await requireAdminPage();
  if (isEffectivelyBlocked(result.profile)) redirect(fallbackPath);
  return result;
}

// Quem REALMENTE clicou, mesmo durante "Alterar conta" — nunca o e-mail do
// perfil emulado (auth.user.email, que applyViewAsProfile troca pelo
// emulado). Use isto (não auth.user?.email) sempre que o e-mail vira
// `changed_by`/`adminEmail`/autor de alguma ação que alimenta
// client_status_history — e por consequência a pontuação/ranking
// (lib/performance-overview.js casa e-mail -> corretor). Bug real corrigido
// 2026-09-29: uma mudança de status feita pelo admin durante "Alterar conta"
// pontuava para o corretor emulado, como se ele mesmo tivesse feito a ação —
// mesmo padrão que já era usado corretamente em lib/client-journey.js
// (actor da timeline), agora centralizado aqui pra reaproveitar.
export function getActingAdminEmail(auth) {
  return auth?.realUser?.email || auth?.user?.email || "";
}

export async function requireRealGeneralAdminApi(request) {
  const accessToken = getAccessTokenFromRequest(request);
  const result = await applyTwoFactorGuard(
    await verifyAdminSessionTokens(accessToken, request.cookies.get(ADMIN_REFRESH_COOKIE)?.value || ""),
    accessToken,
    (name) => request.cookies.get(name)?.value || ""
  );
  if (!result.ok) return result;
  if (!isGeneralAdmin(result)) {
    return { ok: false, status: 403, error: "Apenas o administrador geral pode usar esta função." };
  }
  return result;
}

// Configuração da verificação em duas etapas: a conta REAL (nunca "Alterar conta") do dono ou de um gestor. Quando já está
// ativada, o guard acima já exige o 2º fator desta sessão.
export async function requireRealTwoFactorApi(request) {
  const accessToken = getAccessTokenFromRequest(request);
  const result = await applyTwoFactorGuard(
    await verifyAdminSessionTokens(accessToken, request.cookies.get(ADMIN_REFRESH_COOKIE)?.value || ""),
    accessToken,
    (name) => request.cookies.get(name)?.value || ""
  );
  if (!result.ok) return result;
  if (!isTwoFactorEligibleResult(result)) {
    return { ok: false, status: 403, error: "Verificação em duas etapas disponível só para o dono e os gestores." };
  }
  return result;
}

export async function requirePrimaryAdminApi(request) {
  return requireGeneralAdminApi(request, "Acesso financeiro nao autorizado.");
}

export async function requirePerformanceApi(request) {
  const result = await requireAdminApi(request);
  if (!result.ok) return result;
  if (isAssociateProfile(result.profile)) {
    return { ok: false, status: 403, error: "Acesso ao desempenho nao autorizado.", user: result.user, profile: result.profile };
  }
  return result;
}

export async function requireFinancialManagerApi(request) {
  const result = await requirePerformanceApi(request);
  if (!result.ok) return result;
  if (!isGeneralAdmin(result) && !isManagerProfile(result.profile)) {
    return { ok: false, status: 403, error: "Apenas gestor ou administrador pode alterar este conteúdo.", user: result.user, profile: result.profile };
  }
  return result;
}

// Financeiro (receita/comissoes da imobiliaria) fica fora do "acesso quase
// igual ao meu" liberado para gestores: só o administrador geral e o próprio
// corretor/associado (vendo a propria comissao) acessam.
export async function requireFinancialAccessApi(request) {
  const result = await requireAdminApi(request);
  if (!result.ok) return result;
  if (isManagerProfile(result.profile)) {
    return { ok: false, status: 403, error: "Gestores não têm acesso ao financeiro da imobiliária.", user: result.user, profile: result.profile };
  }
  return result;
}

export async function requireBrokerManagementApi(request) {
  const result = await requirePerformanceApi(request);
  if (!result.ok) return result;
  if (!isGeneralAdmin(result) && !isManagerProfile(result.profile)) {
    return { ok: false, status: 403, error: "Apenas gestor ou administrador pode gerenciar corretores.", user: result.user, profile: result.profile };
  }
  return result;
}

export async function requireGeneralAdminApi(request, errorMessage = "Apenas o administrador geral pode acessar esta área.") {
  const result = await requireAdminApi(request);
  if (!result.ok) return result;

  if (!isGeneralAdmin(result)) {
    return { ok: false, status: 403, error: errorMessage, user: result.user, profile: result.profile };
  }

  return result;
}

// cache(): memoiza por request — layout.jsx e cada page.jsx (via
// requireAdminPage/requireGeneralAdminPage/etc.) chamavam isso de forma
// independente a cada navegação, duplicando 1 round-trip ao Supabase Auth +
// 1 consulta a admin_users por página (achado da auditoria de performance
// 2026-10-01). Seguro: React garante um cache novo por request no App
// Router, nunca compartilhado entre usuários/requests diferentes.
export const getAdminFromCookies = cache(async function getAdminFromCookies() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ADMIN_ACCESS_COOKIE)?.value || "";
  const result = await applyTwoFactorGuard(
    await verifyAdminSessionTokens(accessToken, cookieStore.get(ADMIN_REFRESH_COOKIE)?.value || ""),
    accessToken,
    (name) => cookieStore.get(name)?.value || ""
  );
  return applyViewAsProfile(result, cookieStore.get(ADMIN_VIEW_AS_COOKIE)?.value || "");
});

export async function requireAdminPage() {
  const result = await getAdminFromCookies();
  if (result.ok) return result;
  if (result.code === TWO_FACTOR_REQUIRED_CODE) redirect("/admin/login");

  const error = result.status === 403 ? "?error=unauthorized" : "";
  redirect(`/admin/login${error}`);
}

export async function requirePrimaryAdminPage() {
  return requireGeneralAdminPage("/admin");
}

export async function requirePerformancePage(fallbackPath = "/admin/simulacoes") {
  const result = await requireAdminPage();
  if (isAssociateProfile(result.profile)) redirect(fallbackPath);
  return result;
}

export async function requireGeneralAdminPage(fallbackPath = "/admin") {
  const result = await getAdminFromCookies();
  if (!result.ok) {
    if (result.code === TWO_FACTOR_REQUIRED_CODE) redirect("/admin/login");
    const error = result.status === 403 ? "?error=unauthorized" : "";
    redirect(`/admin/login${error}`);
  }

  if (!isGeneralAdmin(result)) {
    redirect(fallbackPath);
  }

  return result;
}

export async function requireFinancialAccessPage(fallbackPath = "/admin") {
  const result = await requireAdminPage();
  if (isManagerProfile(result.profile)) {
    redirect(fallbackPath);
  }
  return result;
}

export async function requireBrokerManagementPage(fallbackPath = "/admin") {
  const result = await requireAdminPage();
  if (!isGeneralAdmin(result) && !isManagerProfile(result.profile)) {
    redirect(fallbackPath);
  }
  return result;
}

// Quem pode usar a verificação em duas etapas: o dono (isOwnerAdminEmail) e os GESTORES (pedido do dono, 2026-10-09, para a
// gestora). Opt-in: só vale depois que a própria pessoa ativa. Corretor/associado/administrador sem ser o dono nunca são
// consultados.
export function isTwoFactorEligibleResult(result) {
  return Boolean(result?.ok && (isOwnerAdminEmail(result.user?.email) || isManagerProfile(result.profile)));
}

// VERIFICAÇÃO EM DUAS ETAPAS (regra do dono, 2026-10-08, estendida aos gestores em 2026-10-09; lib/admin-two-factor.js).
// Roda sobre a conta REAL, antes de "Alterar conta": sem o 2º fator, nenhuma página/API do painel (nem o view-as)
// funciona para a conta. Só afeta o dono e os gestores, e só depois de ativado; os demais perfis não passam por consulta nenhuma.
async function applyTwoFactorGuard(result, accessToken, readCookie) {
  if (!isTwoFactorEligibleResult(result)) return result;
  const check = await checkOwnerSecondFactor({
    userId: result.user.id,
    // Se o access token venceu e foi renovado agora, o session_id vem do token novo (é o mesmo da sessão de login).
    accessToken: result.session?.accessToken || accessToken,
    sessionProof: readCookie(TWO_FACTOR_SESSION_COOKIE),
    deviceProof: readCookie(TWO_FACTOR_DEVICE_COOKIE)
  });
  if (check.error) return { ok: false, status: 503, error: check.error, user: result.user };
  if (!isSecondFactorMissing({ isOwner: true, ...check })) return result;
  return {
    ok: false,
    status: 401,
    code: TWO_FACTOR_REQUIRED_CODE,
    error: "Digite o código de verificação em duas etapas.",
    user: result.user,
    profile: result.profile,
    session: result.session
  };
}

// Só para a etapa do código (/api/admin/two-factor/verify): senha já conferida, 2º fator ainda pendente. Exige a
// conta REAL do dono (sem "Alterar conta") e não libera nenhum dado do painel.
export async function requireOwnerPendingSecondFactorApi(request) {
  const result = await verifyAdminSessionTokens(
    getAccessTokenFromRequest(request),
    request.cookies.get(ADMIN_REFRESH_COOKIE)?.value || ""
  );
  if (!result.ok) return result;
  if (!isTwoFactorEligibleResult(result)) {
    return { ok: false, status: 403, error: "Verificação em duas etapas disponível só para o dono e os gestores." };
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

async function applyViewAsProfile(result, profileId) {
  if (!result.ok || !profileId || !isGeneralAdmin(result)) return result;

  try {
    const profile = await getAdminProfileById(profileId);
    if (!profile || !isActiveAdminProfile(profile)) return result;

    return {
      ...result,
      accountSwitchMode: true,
      realProfile: result.profile,
      realUser: result.user,
      profile,
      user: {
        ...result.user,
        id: profile.authUserId || profile.id,
        email: profile.email
      }
    };
  } catch (error) {
    console.error("Nao foi possivel iniciar a visualizacao de auditoria.", error);
    return result;
  }
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
