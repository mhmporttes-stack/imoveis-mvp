// Verificação em duas etapas da conta do dono (regra do dono, 2026-10-08). Parte pura (TOTP RFC 6238, janela, reuso,
// cookies assinados, limite de tentativas) + testes de estrutura do guard (os arquivos do servidor importam "server-only").
// Dados 100% sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FAILED_WINDOW_MS,
  LOCK_DURATION_MS,
  base32Decode,
  base32Encode,
  buildDeviceProof,
  buildOtpauthUri,
  buildSessionProof,
  generateRecoveryCodes,
  hashRecoveryCode,
  hotp,
  isLocked,
  isSecondFactorMissing,
  isValidDeviceProof,
  isValidSessionProof,
  nextFailureState,
  readSessionIdFromAccessToken,
  readSignedToken,
  totpStep,
  verifyTotpCode
} from "../lib/admin-two-factor-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_SECRET_B32 = base32Encode(RFC_SECRET);

test("TOTP: vetores oficiais da RFC 6238 (SHA-1, 8 dígitos)", () => {
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"]
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(hotp(RFC_SECRET, totpStep(seconds * 1000), 8), expected, `T=${seconds}`);
  }
});

test("base32 ida e volta e chave inválida", () => {
  assert.equal(RFC_SECRET_B32, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Decode(RFC_SECRET_B32.toLowerCase()), RFC_SECRET);
  assert.throws(() => base32Decode("1!"));
});

test("TOTP: aceita o passo anterior/seguinte (±1) e recusa fora da janela", () => {
  const now = 1111111111 * 1000;
  const step = totpStep(now);
  const codeAt = (s) => hotp(RFC_SECRET, s, 6);
  assert.deepEqual(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: codeAt(step), nowMs: now }), { ok: true, step });
  assert.equal(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: codeAt(step - 1), nowMs: now }).ok, true);
  assert.equal(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: codeAt(step + 1), nowMs: now }).ok, true);
  assert.equal(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: codeAt(step - 2), nowMs: now }).ok, false);
  assert.equal(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: codeAt(step + 2), nowMs: now }).ok, false);
  assert.equal(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: "12345", nowMs: now }).ok, false);
  assert.equal(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: "abcdef", nowMs: now }).ok, false);
  assert.equal(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: ` ${codeAt(step).slice(0, 3)} ${codeAt(step).slice(3)} `, nowMs: now }).ok, true);
});

test("TOTP: o mesmo código (ou um passo antigo) não entra duas vezes", () => {
  const now = 1234567890 * 1000;
  const step = totpStep(now);
  const code = hotp(RFC_SECRET, step, 6);
  assert.deepEqual(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code, nowMs: now, lastUsedStep: step }), { ok: false, reason: "reused" });
  assert.equal(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: hotp(RFC_SECRET, step - 1, 6), nowMs: now, lastUsedStep: step }).ok, false);
  assert.deepEqual(verifyTotpCode({ secretBase32: RFC_SECRET_B32, code: hotp(RFC_SECRET, step + 1, 6), nowMs: now, lastUsedStep: String(step) }), { ok: true, step: step + 1 });
});

test("otpauth: URI para QR Code (Google Authenticator / Senhas do iPhone)", () => {
  const uri = buildOtpauthUri({ secretBase32: RFC_SECRET_B32, accountName: "dono@example.com" });
  assert.ok(uri.startsWith("otpauth://totp/"));
  const params = new URL(uri).searchParams;
  assert.equal(params.get("secret"), RFC_SECRET_B32);
  assert.equal(params.get("digits"), "6");
  assert.equal(params.get("period"), "30");
});

test("códigos de recuperação: 8, distintos, só o hash é guardado e o formato digitado não importa", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const code of codes) assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const hash = hashRecoveryCode("user-1", codes[0]);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashRecoveryCode("user-1", codes[0].toLowerCase().replace(/-/g, " ")), hash);
  assert.notEqual(hashRecoveryCode("user-2", codes[0]), hash);
});

test("cookie de aparelho e de sessão: assinatura, usuário, época e validade", () => {
  const key = "chave-sintetica";
  const now = Date.UTC(2026, 9, 8, 12);
  const device = buildDeviceProof({ userId: "u1", deviceId: "d1", epoch: 3, nowMs: now }, key);
  assert.equal(isValidDeviceProof(device, { userId: "u1", epoch: 3, nowMs: now }, key), true);
  assert.equal(isValidDeviceProof(device, { userId: "u1", epoch: 3, nowMs: now + 29 * 86400000 }, key), true);
  assert.equal(isValidDeviceProof(device, { userId: "u1", epoch: 3, nowMs: now + 31 * 86400000 }, key), false, "expira em 30 dias");
  assert.equal(isValidDeviceProof(device, { userId: "u2", epoch: 3, nowMs: now }, key), false, "outro usuário");
  assert.equal(isValidDeviceProof(device, { userId: "u1", epoch: 4, nowMs: now }, key), false, "desativar/gerar códigos troca a época");
  assert.equal(isValidDeviceProof(device, { userId: "u1", epoch: 3, nowMs: now }, "outra-chave"), false);
  const [body, signature] = device.split(".");
  const forged = Buffer.from(JSON.stringify({ ...readSignedToken(device, key), u: "u2" })).toString("base64url");
  assert.equal(readSignedToken(`${forged}.${signature}`, key), null, "payload alterado invalida a assinatura");
  assert.equal(readSignedToken(`${body}.${signature}x`, key), null);

  const session = buildSessionProof({ userId: "u1", sessionId: "s1", epoch: 3, nowMs: now }, key);
  assert.equal(isValidSessionProof(session, { userId: "u1", sessionId: "s1", epoch: 3, nowMs: now }, key), true);
  assert.equal(isValidSessionProof(session, { userId: "u1", sessionId: "s2", epoch: 3, nowMs: now }, key), false, "outra sessão de login");
  assert.equal(isValidSessionProof(session, { userId: "u1", sessionId: "", epoch: 3, nowMs: now }, key), false);
  assert.equal(isValidDeviceProof(session, { userId: "u1", epoch: 3, nowMs: now }, key), false, "prova de sessão não vale como aparelho");
  assert.equal(isValidSessionProof(device, { userId: "u1", sessionId: "s1", epoch: 3, nowMs: now }, key), false);
  assert.equal(isValidDeviceProof(device, { userId: "u1", epoch: 3, nowMs: now }, ""), false, "sem chave nada vale");
});

test("session_id lido do access token (já validado pelo Supabase)", () => {
  const token = ["x", Buffer.from(JSON.stringify({ session_id: "abc-123" })).toString("base64url"), "y"].join(".");
  assert.equal(readSessionIdFromAccessToken(token), "abc-123");
  assert.equal(readSessionIdFromAccessToken("lixo"), "");
});

test("só o dono, e só com o 2FA ativado, precisa do 2º fator", () => {
  assert.equal(isSecondFactorMissing({ isOwner: false, enabled: true }), false, "outros perfis nunca são afetados");
  assert.equal(isSecondFactorMissing({ isOwner: true, enabled: false }), false, "opt-in: antes de ativar nada muda");
  assert.equal(isSecondFactorMissing({ isOwner: true, enabled: true }), true);
  assert.equal(isSecondFactorMissing({ isOwner: true, enabled: true, sessionProofValid: true }), false);
  assert.equal(isSecondFactorMissing({ isOwner: true, enabled: true, deviceProofValid: true }), false);
});

test("limite de tentativas: 5 erradas em 10 min bloqueiam por 10 min", () => {
  const start = Date.UTC(2026, 9, 8, 12);
  let state = {};
  for (let i = 1; i <= 4; i += 1) {
    state = nextFailureState(state, start + i * 1000);
    assert.equal(state.failed_attempts, i);
    assert.equal(isLocked(state, start + i * 1000), false);
  }
  state = nextFailureState(state, start + 5000);
  assert.equal(isLocked(state, start + 5000), true);
  assert.equal(isLocked(state, start + 5000 + LOCK_DURATION_MS + 1), false);
  const old = nextFailureState({ failed_attempts: 4, failed_window_started_at: new Date(start).toISOString() }, start + FAILED_WINDOW_MS + 1);
  assert.equal(old.failed_attempts, 1, "janela de 10 min vencida recomeça a contagem");
});

test("guard no servidor: as quatro portas de entrada passam pelo 2º fator (dono e gestores), antes de 'Alterar conta'", () => {
  const auth = read("lib/admin-auth.js");
  const guardCalls = auth.match(/await applyTwoFactorGuard\(\n\s+await verifyAdminSessionTokens\(/g) || [];
  assert.equal(guardCalls.length, 4, "requireAdminApi, requireRealGeneralAdminApi, requireRealTwoFactorApi e getAdminFromCookies");
  for (const name of ["export async function requireAdminApi", "export async function requireRealGeneralAdminApi", "export async function requireRealTwoFactorApi", "getAdminFromCookies = cache("]) {
    const body = auth.slice(auth.indexOf(name), auth.indexOf(name) + 600);
    assert.ok(body.includes("applyTwoFactorGuard("), name);
  }
  const requireAdminApi = auth.slice(auth.indexOf("export async function requireAdminApi"), auth.indexOf("export async function requireAdminApi") + 600);
  assert.ok(requireAdminApi.indexOf("applyTwoFactorGuard(") < requireAdminApi.indexOf("applyViewAsProfile("), "2º fator antes do view-as");
  const guard = auth.slice(auth.indexOf("async function applyTwoFactorGuard"), auth.indexOf("export async function requireOwnerPendingSecondFactorApi"));
  assert.ok(guard.includes("if (!isTwoFactorEligibleResult(result)) return result;"), "só o dono e os gestores são consultados");
  assert.ok(auth.includes("isOwnerAdminEmail(result.user?.email) || isManagerProfile(result.profile)"), "elegível = dono ou gestor");
  assert.ok(guard.includes("TWO_FACTOR_REQUIRED_CODE"));
  // verifyAdminSessionTokens sozinho só pode aparecer nas portas acima e na etapa do código.
  assert.equal((auth.match(/await verifyAdminSessionTokens\(/g) || []).length, 5);
});

test("etapa do código e configuração: rotas com guard, sem log de segredo", () => {
  const verify = read("app/api/admin/two-factor/verify/route.js");
  assert.ok(verify.indexOf("requireOwnerPendingSecondFactorApi(request)") < verify.indexOf("verifySecondFactor("));
  const settings = read("app/api/admin/two-factor/route.js");
  assert.ok(settings.includes("requireRealTwoFactorApi(request)"), "configuração: conta REAL do dono ou de gestor");
  assert.ok(!settings.includes("requireRealGeneralAdminApi"));
  const lib = read("lib/admin-two-factor.js");
  assert.ok(!/console\.(log|info|warn|error)/.test(lib), "a lib não loga nada (nem segredo nem código)");
  const session = read("app/api/admin/session/route.js");
  assert.ok(session.includes("twoFactorRequired"));
  const migration = read("supabase/migrations/20261008200000_admin_two_factor.sql");
  assert.ok(migration.includes("enable row level security") && !/create policy/i.test(migration));
});

test("gestores (Carol) também podem ativar: elegibilidade única, página/menu e login conferem o perfil gestor da conta REAL", () => {
  const auth = read("lib/admin-auth.js");
  assert.ok(auth.includes("export function isTwoFactorEligibleResult(result)"));
  assert.ok(read("app/api/admin/session/route.js").includes("if (isTwoFactorEligibleResult(result)) {"));
  const page = read("app/admin/seguranca/page.jsx");
  assert.ok(page.includes("!isOwnerAdminEmail(realUser?.email) && !isManagerProfile(auth.realProfile || auth.profile)"));
  assert.ok(read("app/admin/layout.jsx").includes("isOwnerAdminEmail((auth.realUser || auth.user)?.email) || isManagerProfile(auth.realProfile || auth.profile)"));
  const verify = auth.slice(auth.indexOf("export async function requireOwnerPendingSecondFactorApi"), auth.indexOf("async function buildAuthorizedAdminResult"));
  assert.ok(verify.includes("!isTwoFactorEligibleResult(result)"));
});
