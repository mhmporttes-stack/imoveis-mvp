// Cache no servidor (velocidade, etapa 3 — dono, 2026-10-22). Parte pura (lib/server-cache-core.mjs) + o código REAL de
// lib/admin-auth.js com Supabase/perfis/2FA falsos: o cache da sessão evita getUser/perfil repetidos, mas 2FA, "Alterar
// conta", usuário desativado e recusas continuam idênticos. Dados 100% fictícios; nada de rede nem banco real.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { CACHE_TAGS, MAX_TTL_MS, createServerCache, serverCache, tokenCacheTtlMs } from "../lib/server-cache-core.mjs";

register("./helpers/route-test-loader.mjs", { parentURL: import.meta.url });

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function clock(start = 1_000_000) {
  let value = start;
  return { now: () => value, advance: (ms) => { value += ms; } };
}

test("core: guarda dentro do prazo, relê depois do prazo (prazo rígido, nunca valor velho)", async () => {
  const time = clock();
  const cache = createServerCache({ now: time.now });
  let loads = 0;
  const load = () => cache.memo("t", "k", 10_000, async () => ++loads);
  assert.equal(await load(), 1);
  assert.equal(await load(), 1);
  time.advance(9_999);
  assert.equal(await load(), 1);
  time.advance(1);
  assert.equal(await load(), 2);
});

test("core: prazo nunca passa de 30 s e prazo 0 não guarda", async () => {
  const time = clock();
  const cache = createServerCache({ now: time.now });
  let loads = 0;
  await cache.memo("t", "k", 10 * 60_000, async () => ++loads);
  time.advance(MAX_TTL_MS);
  assert.equal(await cache.memo("t", "k", 10 * 60_000, async () => ++loads), 2);
  assert.equal(await cache.memo("t", "z", 0, async () => ++loads), 3);
  assert.equal(await cache.memo("t", "z", 0, async () => ++loads), 4);
});

test("core: invalidar a etiqueta relê na hora; outras etiquetas não são afetadas", async () => {
  const cache = createServerCache();
  let a = 0;
  let b = 0;
  await cache.memo("a", "k", 30_000, async () => ++a);
  await cache.memo("b", "k", 30_000, async () => ++b);
  cache.invalidate("a");
  assert.equal(await cache.memo("a", "k", 30_000, async () => ++a), 2);
  assert.equal(await cache.memo("b", "k", 30_000, async () => ++b), 1);
});

test("core: erro e resultado recusado por keep() nunca ficam guardados", async () => {
  const cache = createServerCache();
  let calls = 0;
  await assert.rejects(cache.memo("t", "k", 30_000, async () => { calls += 1; throw new Error("falhou"); }));
  assert.equal(await cache.memo("t", "k", 30_000, async () => ++calls), 2);
  const keep = (value) => value.ok === true;
  let denied = 0;
  assert.deepEqual(await cache.memo("t", "deny", 30_000, async () => ({ ok: false, n: ++denied }), { keep }), { ok: false, n: 1 });
  assert.deepEqual(await cache.memo("t", "deny", 30_000, async () => ({ ok: false, n: ++denied }), { keep }), { ok: false, n: 2 });
});

test("core: quem lê recebe cópia (Map incluído) — mexer no resultado não altera o guardado", async () => {
  const cache = createServerCache();
  const first = await cache.memo("t", "k", 30_000, async () => ({ list: [1, 2], map: new Map([["x", [1]]]) }));
  first.list.push(3);
  first.map.get("x").push(2);
  const second = await cache.memo("t", "k", 30_000, async () => null);
  assert.deepEqual(second.list, [1, 2]);
  assert.deepEqual(second.map.get("x"), [1]);
});

test("core: gravação durante uma leitura em andamento descarta o resultado antigo", async () => {
  const cache = createServerCache();
  let release;
  const slow = cache.memo("t", "k", 30_000, () => new Promise((resolve) => { release = resolve; }));
  await new Promise(setImmediate);
  cache.invalidate("t");
  release("antes da gravação");
  assert.equal(await slow, "antes da gravação");
  assert.equal(await cache.memo("t", "k", 30_000, async () => "depois da gravação"), "depois da gravação");
});

test("core: leituras simultâneas compartilham uma única ida ao banco", async () => {
  const cache = createServerCache();
  let loads = 0;
  const results = await Promise.all([1, 2, 3].map(() => cache.memo("t", "k", 30_000, async () => ++loads)));
  assert.deepEqual(results, [1, 1, 1]);
});

test("tokenCacheTtlMs: nunca além do vencimento do token; token ilegível ou vencido não é guardado", () => {
  const nowMs = 1_700_000_000_000;
  const token = (exp) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
  assert.equal(tokenCacheTtlMs(token(nowMs / 1000 + 3600), nowMs), 30_000);
  assert.equal(tokenCacheTtlMs(token(nowMs / 1000 + 10), nowMs), 10_000);
  assert.equal(tokenCacheTtlMs(token(nowMs / 1000 - 1), nowMs), 0);
  assert.equal(tokenCacheTtlMs("lixo", nowMs), 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// lib/admin-auth.js de verdade
// ---------------------------------------------------------------------------------------------------------------------
const OWNER = { id: "u-owner", email: "mhmporttes@gmail.com" };
const BROKER = { id: "u-broker", email: "corretor@teste.local" };
const MANAGER = { id: "u-manager", email: "gestora@teste.local" };
const profiles = {
  [OWNER.id]: { id: "p-owner", authUserId: OWNER.id, email: OWNER.email, role: "admin", status: "active" },
  [BROKER.id]: { id: "p-broker", authUserId: BROKER.id, email: BROKER.email, role: "broker", status: "active" },
  [MANAGER.id]: { id: "p-manager", authUserId: MANAGER.id, email: MANAGER.email, role: "manager", status: "active", managedUserIds: ["p-manager", "p-broker"] }
};
const usersByToken = new Map();
const calls = { getUser: 0, profile: 0, byId: 0, twoFactor: 0 };
let twoFactorState = { enabled: false, sessionProofValid: false, deviceProofValid: false };
let profileReadError = null;

function makeToken(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `h.${Buffer.from(JSON.stringify({ exp, sub: user.id, session_id: `s-${user.id}` })).toString("base64url")}.${Math.random()}`;
  usersByToken.set(token, user);
  return token;
}

globalThis.__stubs = {
  supabase: {
    hasSupabasePublicConfig: () => true,
    getSupabasePublicClient: () => ({
      auth: {
        getUser: async (token) => {
          calls.getUser += 1;
          const user = usersByToken.get(token);
          return user ? { data: { user }, error: null } : { data: null, error: { message: "invalid" } };
        }
      }
    })
  },
  "admin-profiles": {
    getAdminProfileForAuthUser: async (user) => {
      calls.profile += 1;
      if (profileReadError) throw profileReadError;
      return profiles[user.id] ? structuredClone(profiles[user.id]) : null;
    },
    getAdminProfileByIdCached: async (id) => {
      calls.byId += 1;
      return structuredClone(Object.values(profiles).find((profile) => profile.id === id) || null);
    },
    isActiveAdminProfile: (profile) => profile?.status === "active",
    isAssociateProfile: (profile) => profile?.role === "associate",
    isGeneralAdminAuth: (auth) => auth?.profile?.role === "admin",
    isGeneralAdminProfile: (profile) => profile?.role === "admin",
    isManagerProfile: (profile) => profile?.role === "manager"
  },
  "admin-two-factor": {
    TWO_FACTOR_SESSION_COOKIE: () => "mm_admin_2fa",
    TWO_FACTOR_DEVICE_COOKIE: () => "mm_admin_2fa_device",
    checkOwnerSecondFactor: async () => {
      calls.twoFactor += 1;
      return { ...twoFactorState };
    },
    clearTwoFactorCookies: () => {}
  },
  "chat-control": { isChatRestrictedProfile: () => false, isChatDisabled: async () => false },
  "whatsapp-manual-disconnect": { isPrintedListModeAuth: async () => false },
  "admin-users": { getAdminDisplayName: (email) => email }
};

const auth = await import("../lib/admin-auth.js");

function request(token, cookies = {}) {
  const jar = { mm_admin_access_token: token, ...cookies };
  return {
    url: "https://teste.local/api/admin/qualquer",
    method: "GET",
    headers: { get: () => "" },
    cookies: { get: (name) => {
      const key = typeof name === "function" ? name() : name;
      return jar[key] === undefined ? undefined : { value: jar[key] };
    } }
  };
}

function reset() {
  serverCache.clear();
  for (const key of Object.keys(calls)) calls[key] = 0;
  twoFactorState = { enabled: false, sessionProofValid: false, deviceProofValid: false };
  profileReadError = null;
  profiles[BROKER.id].status = "active";
  profiles[BROKER.id].role = "broker";
}

test("sessão: 2ª requisição com o mesmo token não chama getUser nem relê o perfil", async () => {
  reset();
  const token = makeToken(BROKER);
  const first = await auth.requireAdminApi(request(token));
  const second = await auth.requireAdminApi(request(token));
  assert.equal(first.ok, true);
  assert.deepEqual(second.profile, first.profile);
  assert.equal(calls.getUser, 1);
  assert.equal(calls.profile, 1);
});

test("sessão: token inválido nunca fica guardado (cada tentativa volta ao Supabase Auth)", async () => {
  reset();
  const bad = await auth.requireAdminApi(request("h.e30.invalido"));
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
  // sem `exp` legível o token nem entra no cache; com exp, a recusa também não é guardada:
  const user = { id: "u-ghost", email: "ghost@teste.local" };
  const token = makeToken(user);
  usersByToken.delete(token);
  await auth.requireAdminApi(request(token));
  await auth.requireAdminApi(request(token));
  assert.equal(calls.getUser, 3);
});

test("desativado perde o acesso na hora quando admin_users muda neste processo", async () => {
  reset();
  const token = makeToken(BROKER);
  assert.equal((await auth.requireAdminApi(request(token))).ok, true);
  profiles[BROKER.id].status = "inactive";
  serverCache.invalidate(CACHE_TAGS.ADMIN_USERS); // o que invalidateAdminUsersCache() faz ao gravar
  const after = await auth.requireAdminApi(request(token));
  assert.equal(after.ok, false);
  assert.equal(after.status, 403);
  // e a recusa não é guardada: reativado, volta sem esperar o prazo
  profiles[BROKER.id].status = "active";
  assert.equal((await auth.requireAdminApi(request(token))).ok, true);
});

test("troca de papel vale na hora (gestor passa a ter equipe) após invalidar admin_users", async () => {
  reset();
  const token = makeToken(BROKER);
  assert.equal((await auth.requireBrokerManagementApi(request(token))).status, 403);
  profiles[BROKER.id].role = "manager";
  serverCache.invalidate(CACHE_TAGS.ADMIN_USERS);
  assert.equal((await auth.requireBrokerManagementApi(request(token))).ok, true);
});

test("logout esquece o token nesta instância", async () => {
  reset();
  const token = makeToken(BROKER);
  await auth.requireAdminApi(request(token));
  auth.forgetAdminAccessToken(token);
  await auth.requireAdminApi(request(token));
  assert.equal(calls.getUser, 2);
});

test("2FA ativado sem o código: bloqueia SEMPRE (recusa não é guardada) e consulta a cada requisição", async () => {
  reset();
  twoFactorState = { enabled: true, sessionProofValid: false, deviceProofValid: false };
  const token = makeToken(MANAGER);
  for (let i = 0; i < 3; i += 1) {
    const result = await auth.requireAdminApi(request(token));
    assert.equal(result.ok, false);
    assert.equal(result.code, "TWO_FACTOR_REQUIRED");
  }
  assert.equal(calls.twoFactor, 3);
});

test("2FA não ativado: nada é guardado (ativar em outra instância vale na próxima requisição)", async () => {
  reset();
  const token = makeToken(MANAGER);
  assert.equal((await auth.requireAdminApi(request(token))).ok, true);
  twoFactorState = { enabled: true, sessionProofValid: false, deviceProofValid: false };
  const after = await auth.requireAdminApi(request(token));
  assert.equal(after.code, "TWO_FACTOR_REQUIRED");
  assert.equal(calls.twoFactor, 2);
});

test("2FA aprovado fica guardado só para os mesmos cookies; outro cookie refaz a conferência; gravar no 2FA invalida", async () => {
  reset();
  twoFactorState = { enabled: true, sessionProofValid: true, deviceProofValid: false };
  const token = makeToken(OWNER);
  const cookies = { mm_admin_2fa: "prova-a" };
  assert.equal((await auth.requireAdminApi(request(token, cookies))).ok, true);
  assert.equal((await auth.requireAdminApi(request(token, cookies))).ok, true);
  assert.equal(calls.twoFactor, 1);
  twoFactorState = { enabled: true, sessionProofValid: false, deviceProofValid: false };
  assert.equal((await auth.requireAdminApi(request(token, { mm_admin_2fa: "prova-b" }))).code, "TWO_FACTOR_REQUIRED");
  serverCache.invalidate(CACHE_TAGS.TWO_FACTOR); // época dos aparelhos trocada / 2FA reconfigurado neste processo
  assert.equal((await auth.requireAdminApi(request(token, cookies))).code, "TWO_FACTOR_REQUIRED");
});

test("2FA roda antes de 'Alterar conta' e o view-as é aplicado a cada requisição sobre a conta real", async () => {
  reset();
  const token = makeToken(OWNER);
  const viewAs = { mm_admin_view_as: "p-broker" };
  const emulated = await auth.requireAdminApi(request(token, viewAs));
  assert.equal(emulated.accountSwitchMode, true);
  assert.equal(emulated.profile.id, "p-broker");
  assert.equal(emulated.realProfile.id, "p-owner");
  assert.equal(emulated.user.email, BROKER.email);
  assert.equal(emulated.realUser.email, OWNER.email);
  const plain = await auth.requireAdminApi(request(token));
  assert.equal(plain.accountSwitchMode, undefined);
  assert.equal(plain.profile.id, "p-owner");
  assert.equal(plain.user.email, OWNER.email);
  // view-as não vaza para a sessão guardada: a conta real em cache continua a do dono
  const again = await auth.requireAdminApi(request(token, viewAs));
  assert.equal(again.profile.id, "p-broker");
  assert.equal(calls.getUser, 1);
  // conta real com 2FA pendente: nem o view-as funciona
  twoFactorState = { enabled: true, sessionProofValid: false, deviceProofValid: false };
  const blocked = await auth.requireAdminApi(request(token, viewAs));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "TWO_FACTOR_REQUIRED");
  // "Alterar conta" continua exigindo o admin REAL
  const brokerToken = makeToken(BROKER);
  const brokerTrying = await auth.requireAdminApi(request(brokerToken, viewAs));
  assert.equal(brokerTrying.accountSwitchMode, undefined);
  assert.equal((await auth.requireRealGeneralAdminApi(request(brokerToken))).status, 403);
});

test("escritas de admin_users/tags/properties/2FA/regras/crm_settings em cache invalidam a etiqueta", () => {
  assert.match(read("lib/admin-profiles.js"), /\.insert\(\{ \.\.\.record[\s\S]{0,120}invalidateAdminUsersCache\(\)/);
  assert.match(read("lib/admin-profiles.js"), /\.update\(updates\)[\s\S]{0,120}invalidateAdminUsersCache\(\)/);
  assert.match(read("lib/admin-profiles.js"), /update\(\{ auth_user_id: authUserId \}\)[\s\S]{0,80}invalidateAdminUsersCache\(\)/);
  assert.match(read("lib/admin-profiles.js"), /remove_broker_reassigning_clients[\s\S]{0,900}invalidateAdminUsersCache\(\)/);
  assert.match(read("lib/whatsapp-access.js"), /whatsapp_access_blocked: blocked[\s\S]{0,200}invalidateAdminUsersCache\(\)/);
  assert.match(read("lib/lead-distribution.js"), /lead_distribution_position: index \+ 1[\s\S]{0,120}invalidateAdminUsersCache\(\)/);
  const tags = read("lib/client-tags.js");
  assert.equal((tags.match(/invalidateTagsCache\(\);/g) || []).length, 3);
  const properties = read("lib/properties.js");
  assert.equal((properties.match(/invalidatePropertiesCache\(\);/g) || []).length, 3);
  assert.match(read("lib/captacoes.js"), /update\(\{ captacao_id: id \}\)[\s\S]{0,60}invalidatePropertiesCache\(\)/);
  assert.match(properties, /export async function updateProperty\(id, property\) \{\n  const existing = await loadProperty\(id\);/);
  assert.equal((read("lib/admin-two-factor.js").match(/serverCache\.invalidate\(CACHE_TAGS\.TWO_FACTOR\)/g) || []).length, 2);
  assert.match(read("lib/scoring-rules.js"), /set_scoring_rule_version[\s\S]{0,200}serverCache\.invalidate\(CACHE_TAGS\.SCORING_RULES\)/);
  assert.match(read("lib/client-journey.js"), /const current = await loadJourneySettings\(\);/);
  assert.match(read("lib/daily-message.js"), /const current = await loadDailyMessageSettings\(\);/);
  assert.match(read("lib/daily-goal.js"), /id: MESSAGES_SETTINGS_ID,[\s\S]{0,200}serverCache\.invalidate\(DAILY_GOAL_MESSAGES_CACHE_TAG\)/);
  assert.match(read("app/api/admin/session/route.js"), /forgetAdminAccessToken\(getAccessTokenFromRequest\(request\)\)/);
});

test("nada de tabela gravada só por fora (tags/properties) — toda escrita do app passa pelos arquivos que invalidam", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(js|mjs)$/.test(entry.name)) files.push(rel);
    }
  };
  walk("lib");
  walk("app/api");
  const writers = (table) => files.filter((file) => new RegExp(`from\\("${table}"\\)[^;]{0,200}\\.(insert|update|upsert|delete)\\(`).test(read(file).replace(/\n\s*/g, "")));
  assert.deepEqual(writers("tags"), ["lib/client-tags.js"]);
  assert.deepEqual(writers("properties").sort(), ["lib/captacoes.js", "lib/properties.js"]);
  assert.deepEqual(writers("admin_users").sort(), ["lib/admin-profiles.js", "lib/lead-distribution.js", "lib/whatsapp-access.js"]);
});

// Falha fechada (2026-10-24, agravante do P-10): erro ao ler o perfil recusa com 503, nunca cai no perfil de reserva ATIVO.
test("erro ao ler o perfil: 503 para qualquer e-mail (inclusive o dono), sem perfil de reserva e sem guardar no cache", async () => {
  reset();
  profileReadError = new Error("banco fora do ar");
  for (const user of [OWNER, BROKER, { id: "u-ex", email: "forbencke@gmail.com" }]) {
    const token = makeToken(user);
    const result = await auth.requireAdminApi(request(token));
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.profile, undefined);
  }
  profileReadError = null;
  const token = makeToken(OWNER);
  profileReadError = new Error("blip");
  assert.equal((await auth.requireAdminApi(request(token))).status, 503);
  profileReadError = null;
  const ok = await auth.requireAdminApi(request(token));
  assert.equal(ok.ok, true, "o 503 não ficou guardado: banco de volta = acesso de volta na hora");
  assert.equal(ok.profile.role, "admin");
});

test("dono sem linha em admin_users (banco respondeu): continua entrando como admin; e-mail antigo fixo não autoriza mais", async () => {
  reset();
  // (o perfil de reserva em si usa constantes de admin-profiles, que aqui são stubs: confere-se a autorização do e-mail)
  assert.equal(auth.isAuthorizedAdminEmail("mhmporttes@icloud.com"), true);
  assert.equal(auth.isAuthorizedAdminEmail("MHMPORTTES@gmail.com"), true);
  const ex = await auth.requireAdminApi(request(makeToken({ id: "u-ex2", email: "forbencke@gmail.com" })));
  assert.equal(ex.ok, false);
  assert.equal(ex.status, 403);
  assert.equal(auth.isAuthorizedAdminEmail("forbencke@gmail.com"), false);
});

test("fonte: nenhum e-mail além do dono fixo nas listas de acesso", () => {
  for (const file of ["lib/admin-auth.js", "lib/admin-profiles.js"]) {
    assert.doesNotMatch(read(file), /forbencke@gmail\.com/, file);
  }
});
