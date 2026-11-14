// P-23 (2026-11-14): duas renovações de sessão simultâneas no servidor NUNCA podem trocar de conta. Roda o código REAL de
// lib/admin-auth.js + lib/supabase.js + @supabase/supabase-js (auth-js de verdade) com um fetch falso que faz de Supabase
// Auth: cada refresh token pertence a um usuário e a resposta demora (renovações se sobrepõem). Sem rede, sem banco.
// No código antigo (cliente público único por processo) o segundo login recebia a sessão do primeiro.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-falso.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-chave-falsa";

register("./helpers/route-test-loader.mjs", { parentURL: import.meta.url, data: { real: ["supabase", "supabase-url"] } });

const ROOT = path.resolve(import.meta.dirname, "..");

const USERS = {
  "rt-usuario-a": { id: "user-a-fake", email: "usuario-a@teste.invalid" },
  "rt-usuario-b": { id: "user-b-fake", email: "usuario-b@teste.invalid" }
};
const profiles = {
  "user-a-fake": { id: "p-a", authUserId: "user-a-fake", email: "usuario-a@teste.invalid", role: "broker", status: "active" },
  "user-b-fake": { id: "p-b", authUserId: "user-b-fake", email: "usuario-b@teste.invalid", role: "broker", status: "active" }
};

function fakeJwt(sub) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `h.${Buffer.from(JSON.stringify({ exp, sub, session_id: `s-${sub}` })).toString("base64url")}.sig`;
}

let tokenRequests = 0;
let responseDelayMs = 40;
let wrongUserForToken = null; // simula o Supabase devolvendo outro usuário (só para a defesa em profundidade)

globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === "string" ? input : input?.url || input);
  if (url.includes("/auth/v1/token") && url.includes("grant_type=refresh_token")) {
    tokenRequests += 1;
    const { refresh_token: refreshToken } = JSON.parse(init.body);
    await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    const user = USERS[refreshToken];
    if (!user) return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token" }), { status: 400, headers: { "content-type": "application/json" } });
    const returned = wrongUserForToken?.[refreshToken] || user;
    return new Response(JSON.stringify({
      access_token: fakeJwt(returned.id),
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: `${refreshToken}-novo`,
      user: { id: returned.id, email: returned.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ message: "invalid JWT" }), { status: 401, headers: { "content-type": "application/json" } });
};

globalThis.__stubs = {
  "admin-profiles": {
    getAdminProfileForAuthUser: async (user) => (profiles[user.id] ? structuredClone(profiles[user.id]) : null),
    getAdminProfileByIdCached: async () => null,
    isActiveAdminProfile: (profile) => profile?.status === "active",
    isAssociateProfile: (profile) => profile?.role === "associate",
    isGeneralAdminAuth: (auth) => auth?.profile?.role === "admin",
    isGeneralAdminProfile: (profile) => profile?.role === "admin",
    isManagerProfile: (profile) => profile?.role === "manager"
  },
  "admin-two-factor": {
    TWO_FACTOR_SESSION_COOKIE: () => "mm_admin_2fa",
    TWO_FACTOR_DEVICE_COOKIE: () => "mm_admin_2fa_device",
    checkOwnerSecondFactor: async () => ({ enabled: false, sessionProofValid: false, deviceProofValid: false }),
    clearTwoFactorCookies: () => {}
  },
  "chat-control": { isChatRestrictedProfile: () => false, isChatDisabled: async () => false },
  "whatsapp-manual-disconnect": { isPrintedListModeAuth: async () => false },
  "admin-users": { getAdminDisplayName: (email) => email }
};

const auth = await import("../lib/admin-auth.js");
const supabaseLib = await import("../lib/supabase.js");

function subjectOf(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;
}

test("renovações simultâneas com refresh tokens diferentes: cada uma recebe o SEU usuário e a SUA sessão", async () => {
  tokenRequests = 0;
  const [a, b] = await Promise.all([auth.refreshAdminSession("rt-usuario-a"), auth.refreshAdminSession("rt-usuario-b")]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.user.id, "user-a-fake");
  assert.equal(b.user.id, "user-b-fake");
  assert.equal(subjectOf(a.session.accessToken), "user-a-fake");
  assert.equal(subjectOf(b.session.accessToken), "user-b-fake");
  assert.equal(a.session.refreshToken, "rt-usuario-a-novo");
  assert.equal(b.session.refreshToken, "rt-usuario-b-novo");
  assert.equal(tokenRequests, 2, "cada login faz a sua própria chamada ao Supabase Auth (sem reaproveitar a do outro)");
});

test("muitas renovações em rajada, intercaladas: nenhuma troca de conta", async () => {
  const keys = ["rt-usuario-a", "rt-usuario-b"];
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => auth.refreshAdminSession(keys[i % 2])));
  results.forEach((result, i) => {
    assert.equal(result.ok, true);
    assert.equal(result.user.id, i % 2 === 0 ? "user-a-fake" : "user-b-fake");
  });
});

test("fluxo dos guards (access token vencido + refresh cookie): cada aparelho continua na própria conta", async () => {
  const [a, b] = await Promise.all([
    auth.verifyAdminSessionTokens(fakeJwt("user-a-fake").replace(/\.sig$/, ".vencido"), "rt-usuario-a"),
    auth.verifyAdminSessionTokens(fakeJwt("user-b-fake").replace(/\.sig$/, ".vencido"), "rt-usuario-b")
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.user.id, "user-a-fake");
  assert.equal(b.user.id, "user-b-fake");
  assert.equal(subjectOf(a.session.accessToken), "user-a-fake");
  assert.equal(subjectOf(b.session.accessToken), "user-b-fake");
});

test("defesa em profundidade: usuário renovado diferente do dono do access token do aparelho é recusado (401)", async () => {
  const mismatch = await auth.refreshAdminSession("rt-usuario-a", fakeJwt("user-b-fake"));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, 401);
  assert.equal(mismatch.session, undefined);

  // Simula o bug original: o refresh token B devolve a sessão do usuário A, e o aparelho de B tem o access token de B.
  wrongUserForToken = { "rt-usuario-b": USERS["rt-usuario-a"] };
  try {
    const swapped = await auth.verifyAdminSessionTokens(fakeJwt("user-b-fake").replace(/\.sig$/, ".vencido"), "rt-usuario-b");
    assert.equal(swapped.ok, false);
    assert.equal(swapped.status, 401);
    assert.equal(swapped.session, undefined);
  } finally {
    wrongUserForToken = null;
  }

  // Coerente: token do aparelho e usuário renovado do mesmo dono seguem normalmente.
  const coherent = await auth.refreshAdminSession("rt-usuario-b", fakeJwt("user-b-fake"));
  assert.equal(coherent.ok, true);

  // Sem access token anterior legível (cookie expirou), a renovação legítima continua funcionando.
  const withoutPrevious = await auth.refreshAdminSession("rt-usuario-a", "");
  assert.equal(withoutPrevious.ok, true);
  const garbage = await auth.refreshAdminSession("rt-usuario-a", "lixo");
  assert.equal(garbage.ok, true);
});

test("refresh token desconhecido continua 401", async () => {
  const result = await auth.refreshAdminSession("rt-inexistente");
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("createIsolatedSupabaseAuthClient: uma instância nova (e sem sessão compartilhada) por chamada", async () => {
  const first = supabaseLib.createIsolatedSupabaseAuthClient();
  const second = supabaseLib.createIsolatedSupabaseAuthClient();
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.notEqual(first.auth, second.auth);
  assert.notEqual(first, supabaseLib.getSupabasePublicClient());

  // Sessão guardada numa instância não aparece na outra (sem storage compartilhado).
  await first.auth.setSession({ access_token: fakeJwt("user-a-fake"), refresh_token: "rt-usuario-a" }).catch(() => {});
  const seen = await second.auth.getSession();
  assert.equal(seen.data.session, null);
});

test("regra: lib/admin-auth.js nunca usa o cliente público compartilhado para sessão de usuário", () => {
  const source = fs.readFileSync(path.join(ROOT, "lib/admin-auth.js"), "utf8");
  assert.equal(/getSupabasePublicClient/.test(source), false);
  assert.ok(source.includes("createIsolatedSupabaseAuthClient()"));
});
