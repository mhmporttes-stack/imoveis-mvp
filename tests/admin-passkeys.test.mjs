import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  PASSKEY_PRODUCTION_ORIGINS,
  PASSKEY_RP_ID,
  cleanPasskeyTransports,
  hashPasskeyChallenge,
  isPasskeyChallengeUsable,
  isPasskeyCounterAccepted,
  isPasskeyEligible,
  passkeyDeviceName,
  resolvePasskeyRp
} from "../lib/admin-passkey-core.mjs";
import {
  buildPasskeyRegistrationOptions,
  buildPasskeyUnlockOptions,
  finishPasskeyRegistration,
  verifyPasskeyUnlock
} from "../lib/admin-passkey-flow.mjs";

// Face ID / Windows Hello para desbloquear a tela do Henry (REGRA OFICIAL — dono, 2026-10-24; HENRY-LOCK "Face ID").
// Um "aparelho" de mentira (chave P-256 em memória) assina como o iPhone/Windows Hello assinaria.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-24T15:00:00Z");
const RP = resolvePasskeyRp({ hostname: "www.matheusmachadoimoveis.com.br" });
const USER = { id: "11111111-2222-3333-4444-555555555555", email: "dono@example.com", name: "Dono" };
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");

// ---------- CBOR mínimo (só o que o atestado "none" e a chave COSE usam) ----------
function cborHead(major, value) {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const out = Buffer.alloc(3);
  out[0] = (major << 5) | 25;
  out.writeUInt16BE(value, 1);
  return out;
}
function cbor(value) {
  if (Number.isInteger(value)) return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") return Buffer.concat([cborHead(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (value instanceof Map) return Buffer.concat([cborHead(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error("tipo CBOR não suportado no teste");
}

function fakeAuthenticator({ origin = PASSKEY_PRODUCTION_ORIGINS[0], rpId = PASSKEY_RP_ID, countsSignatures = true } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(16);
  const rpIdHash = createHash("sha256").update(rpId).digest();
  let counter = 0;
  const nextCounter = () => (countsSignatures ? ++counter : 0);
  const counterBytes = (value) => {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(value);
    return out;
  };
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    id: b64(credentialId),
    register(options, { flags = 0x45 } = {}) {
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), counterBytes(0), Buffer.alloc(16), idLen, credentialId, cose]);
      const attestationObject = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return {
        id: b64(credentialId),
        rawId: b64(credentialId),
        type: "public-key",
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
        response: { clientDataJSON: b64(clientData("webauthn.create", options.challenge)), attestationObject: b64(attestationObject), transports: ["internal", "inventado"] }
      };
    },
    assert(options, { flags = 0x05, counterOverride = null, tamper = false } = {}) {
      const value = counterOverride ?? nextCounter();
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), counterBytes(value)]);
      const cdj = clientData("webauthn.get", options.challenge);
      const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(cdj).digest()]), privateKey);
      if (tamper) signature[signature.length - 1] ^= 0xff;
      return {
        id: b64(credentialId),
        rawId: b64(credentialId),
        type: "public-key",
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
        response: { clientDataJSON: b64(cdj), authenticatorData: b64(authData), signature: b64(signature), userHandle: b64(Buffer.from(USER.id)) }
      };
    }
  };
}

// Banco em memória com as mesmas garantias do lib/admin-passkeys.js (troca condicional = atômica).
function memoryStore() {
  const credentials = [];
  const challenges = [];
  return {
    credentials,
    challenges,
    async listCredentials(userId) {
      return credentials.filter((item) => item.user_id === userId);
    },
    async findCredential(userId, credentialId) {
      return credentials.find((item) => item.user_id === userId && item.credential_id === credentialId) || null;
    },
    async insertCredential({ userId, credentialId, publicKey, counter, transports, deviceName }) {
      if (credentials.some((item) => item.credential_id === credentialId)) return { ok: false, status: 409, error: "Este aparelho já está cadastrado." };
      const row = { id: `pk-${credentials.length + 1}`, user_id: userId, credential_id: credentialId, public_key: publicKey, counter, transports, device_name: deviceName };
      credentials.push(row);
      return { ok: true, device: { id: row.id } };
    },
    async updateCounter({ id, userId, expectedCounter, newCounter }) {
      const row = credentials.find((item) => item.id === id && item.user_id === userId && item.counter === expectedCounter);
      if (!row) return false;
      row.counter = newCounter;
      return true;
    },
    async saveChallenge({ userId, purpose, challengeHash, expiresAt }) {
      challenges.push({ user_id: userId, purpose, challenge_hash: challengeHash, expires_at: expiresAt, used_at: null });
    },
    async consumeChallenge({ userId, purpose, challengeHash, nowMs }) {
      const row = challenges.find((item) => isPasskeyChallengeUsable(item, { userId, purpose, challengeHash, nowMs }));
      if (!row) return false;
      row.used_at = new Date(nowMs).toISOString();
      return true;
    }
  };
}

async function enrolled(options = {}) {
  const store = memoryStore();
  const device = fakeAuthenticator(options);
  const reg = await buildPasskeyRegistrationOptions({ store, rp: RP, user: USER, nowMs: NOW });
  assert.equal(reg.ok, true);
  const done = await finishPasskeyRegistration({ store, rp: RP, userId: USER.id, response: device.register(reg.options), deviceName: "iPhone", nowMs: NOW + 1000 });
  assert.equal(done.ok, true, done.error);
  return { store, device };
}

test("RP ID: www e sem www usam o domínio de produção; localhost só fora de produção; outros endereços não", () => {
  for (const hostname of ["www.matheusmachadoimoveis.com.br", "matheusmachadoimoveis.com.br", "WWW.matheusmachadoimoveis.com.br"]) {
    assert.deepEqual(resolvePasskeyRp({ hostname }), { rpID: PASSKEY_RP_ID, origins: ["https://www.matheusmachadoimoveis.com.br", "https://matheusmachadoimoveis.com.br"] });
  }
  assert.deepEqual(resolvePasskeyRp({ hostname: "localhost", origin: "http://localhost:3020", production: false }), { rpID: "localhost", origins: ["http://localhost:3020"] });
  assert.equal(resolvePasskeyRp({ hostname: "localhost", origin: "http://localhost:3020", production: true }), null);
  assert.equal(resolvePasskeyRp({ hostname: "127.0.0.1", origin: "http://127.0.0.1:3020", production: false }), null);
  assert.equal(resolvePasskeyRp({ hostname: "imoveis-mvp.vercel.app" }), null);
  assert.equal(resolvePasskeyRp({ hostname: "matheusmachadoimoveis.com.br.evil.com" }), null);
});

test("só o dono, na conta real: gestor, corretor, associado e 'Alterar conta' ficam de fora", () => {
  assert.equal(isPasskeyEligible({ isOwner: true }), true);
  assert.equal(isPasskeyEligible({ isOwner: true, accountSwitchMode: true }), false);
  assert.equal(isPasskeyEligible({ isOwner: false }), false);
  assert.equal(isPasskeyEligible({ ok: false, isOwner: true }), false);
});

test("cadastro: aparelho com verificação biométrica guarda só a chave pública; sem biometria (UV) é recusado", async () => {
  const { store } = await enrolled();
  assert.equal(store.credentials.length, 1);
  const saved = store.credentials[0];
  assert.match(saved.public_key, /^[\w-]+$/);
  assert.deepEqual(saved.transports, ["internal"], "transportes desconhecidos descartados");
  assert.equal(saved.counter, 0);

  const other = memoryStore();
  const device = fakeAuthenticator();
  const reg = await buildPasskeyRegistrationOptions({ store: other, rp: RP, user: USER, nowMs: NOW });
  assert.equal(reg.options.authenticatorSelection.userVerification, "required");
  assert.equal(reg.options.authenticatorSelection.authenticatorAttachment, "platform");
  assert.equal(reg.options.rp.id, PASSKEY_RP_ID);
  const noUv = await finishPasskeyRegistration({ store: other, rp: RP, userId: USER.id, response: device.register(reg.options, { flags: 0x41 }), nowMs: NOW });
  assert.equal(noUv.ok, false);
  assert.equal(other.credentials.length, 0);
});

test("cadastro: desafio expirado, de outra conta ou de outro site é recusado", async () => {
  const store = memoryStore();
  const device = fakeAuthenticator();
  const reg = await buildPasskeyRegistrationOptions({ store, rp: RP, user: USER, nowMs: NOW });
  const late = await finishPasskeyRegistration({ store, rp: RP, userId: USER.id, response: device.register(reg.options), nowMs: NOW + 3 * 60 * 1000 + 1 });
  assert.equal(late.ok, false);
  assert.match(late.error, /expirou/);
  const reg2 = await buildPasskeyRegistrationOptions({ store, rp: RP, user: USER, nowMs: NOW });
  const wrongUser = await finishPasskeyRegistration({ store, rp: RP, userId: "outra-conta", response: device.register(reg2.options), nowMs: NOW });
  assert.equal(wrongUser.ok, false);
  const phishing = fakeAuthenticator({ origin: "https://matheusmachadoimoveis.com.br.evil.com" });
  const reg3 = await buildPasskeyRegistrationOptions({ store, rp: RP, user: USER, nowMs: NOW });
  assert.equal((await finishPasskeyRegistration({ store, rp: RP, userId: USER.id, response: phishing.register(reg3.options), nowMs: NOW })).ok, false);
  assert.equal(store.credentials.length, 0);
});

test("desbloqueio: asserção válida passa; assinatura adulterada, sem biometria ou aparelho desconhecido não", async () => {
  const { store, device } = await enrolled();
  const opts = await buildPasskeyUnlockOptions({ store, rp: RP, userId: USER.id, nowMs: NOW });
  assert.equal(opts.options.userVerification, "required");
  assert.deepEqual(opts.options.allowCredentials.map((item) => item.id), [device.id]);
  const ok = await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response: device.assert(opts.options), nowMs: NOW + 1000 });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(store.credentials[0].counter, 1);

  const o2 = await buildPasskeyUnlockOptions({ store, rp: RP, userId: USER.id, nowMs: NOW });
  assert.equal((await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response: device.assert(o2.options, { tamper: true }), nowMs: NOW })).ok, false);
  const o3 = await buildPasskeyUnlockOptions({ store, rp: RP, userId: USER.id, nowMs: NOW });
  assert.equal((await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response: device.assert(o3.options, { flags: 0x01 }), nowMs: NOW })).ok, false, "sem UV");
  const stranger = fakeAuthenticator();
  const o4 = await buildPasskeyUnlockOptions({ store, rp: RP, userId: USER.id, nowMs: NOW });
  const unknown = await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response: stranger.assert(o4.options), nowMs: NOW });
  assert.equal(unknown.status, 401);
  assert.equal((await verifyPasskeyUnlock({ store, rp: RP, userId: "outra-conta", response: device.assert(o4.options), nowMs: NOW })).ok, false, "aparelho de outra conta");
});

test("replay: a mesma asserção não entra duas vezes; contador que volta é recusado", async () => {
  const { store, device } = await enrolled();
  const opts = await buildPasskeyUnlockOptions({ store, rp: RP, userId: USER.id, nowMs: NOW });
  const response = device.assert(opts.options);
  assert.equal((await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response, nowMs: NOW })).ok, true);
  const again = await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response, nowMs: NOW });
  assert.equal(again.ok, false, "desafio de uso único");

  const o2 = await buildPasskeyUnlockOptions({ store, rp: RP, userId: USER.id, nowMs: NOW });
  const cloned = await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response: device.assert(o2.options, { counterOverride: 1 }), nowMs: NOW });
  assert.equal(cloned.ok, false, "contador igual ao guardado = assinatura repetida/clonada");
  assert.equal(store.credentials[0].counter, 1);

  assert.equal(isPasskeyCounterAccepted(0, 0), true, "iCloud manda 0 sempre: vale o desafio de uso único");
  assert.equal(isPasskeyCounterAccepted(5, 6), true);
  assert.equal(isPasskeyCounterAccepted(5, 5), false);
  assert.equal(isPasskeyCounterAccepted(5, 0), false);
});

test("desbloqueio: desafio expirado e desafio do cadastro não servem para desbloquear", async () => {
  const { store, device } = await enrolled();
  const opts = await buildPasskeyUnlockOptions({ store, rp: RP, userId: USER.id, nowMs: NOW });
  const late = await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response: device.assert(opts.options), nowMs: NOW + 2 * 60 * 1000 + 1 });
  assert.equal(late.ok, false);
  assert.match(late.error, /expirou/);
  const reg = await buildPasskeyRegistrationOptions({ store, rp: RP, user: USER, nowMs: NOW });
  assert.equal((await verifyPasskeyUnlock({ store, rp: RP, userId: USER.id, response: device.assert({ challenge: reg.options.challenge }), nowMs: NOW })).ok, false);
});

test("sem aparelho cadastrado não há opção de Face ID (a senha continua)", async () => {
  const result = await buildPasskeyUnlockOptions({ store: memoryStore(), rp: RP, userId: USER.id, nowMs: NOW });
  assert.equal(result.ok, false);
  assert.match(result.error, /Use a senha/);
});

test("aparelho repetido e limite de aparelhos", async () => {
  const { store, device } = await enrolled();
  const reg = await buildPasskeyRegistrationOptions({ store, rp: RP, user: USER, nowMs: NOW });
  assert.deepEqual(reg.options.excludeCredentials.map((item) => item.id), [device.id], "o aparelho já cadastrado é avisado ao navegador");
  const again = await finishPasskeyRegistration({ store, rp: RP, userId: USER.id, response: device.register(reg.options), nowMs: NOW });
  assert.equal(again.status, 409);
});

test("desafio: no banco só o hash; nome do aparelho; transportes", () => {
  assert.match(hashPasskeyChallenge("abc"), /^[0-9a-f]{64}$/);
  assert.notEqual(hashPasskeyChallenge("abc"), "abc");
  assert.match(passkeyDeviceName({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", nowMs: NOW }), /^iPhone — 24\/10\/2026$/);
  assert.match(passkeyDeviceName({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140 Electron/44.9.3", nowMs: NOW }), /^Windows \(app do CRM\)/);
  assert.equal(passkeyDeviceName({ name: "  PC   do escritório ", nowMs: NOW }), "PC do escritório");
  assert.deepEqual(cleanPasskeyTransports(["internal", "hybrid", "x", "internal"]), ["internal", "hybrid"]);
});

test("rota e servidor: só o dono do Henry, TOTP recente para cadastrar, desbloqueio igual à senha certa", () => {
  const route = read("../app/api/admin/henry/passkey/route.js");
  assert.match(route, /import \{ requireHenryOwner \} from "@\/lib\/henry-auth";/);
  assert.ok(route.indexOf("requireHenryOwner(request)") < route.indexOf("request.json()"), "guard antes de ler o corpo");
  assert.match(route, /HENRY_LOCK_COOKIE, token, henryLockCookieOptions\(\)/, "mesmo cookie do desbloqueio por senha");
  assert.match(route, /checkPublicRateLimit/);

  const server = read("../lib/admin-passkeys.js");
  assert.match(server, /confirmFreshTotp\(auth\.user, code\)/, "cadastro exige o código do app autenticador agora");
  assert.ok(server.indexOf("confirmFreshTotp(auth.user, code)") < server.indexOf("buildPasskeyRegistrationOptions("), "código conferido antes de gerar o desafio");
  assert.match(server, /isPasskeyEligible\(/);
  assert.match(server, /unlockHenryLockWithPasskey\(auth\)/);
  assert.ok(server.indexOf("verifyPasskeyUnlock(") < server.indexOf("unlockHenryLockWithPasskey(auth)"), "só desbloqueia depois da assinatura conferida");

  const lock = read("../lib/henry-lock.js");
  assert.match(lock, /export async function unlockHenryLockWithPasskey\(auth\)/);
  const grant = lock.slice(lock.indexOf("async function grantHenryUnlock"));
  assert.match(grant, /locked_at: null/);
  assert.match(grant, /failed_attempts: 0, locked_until: null/, "zera os erros e a espera, como a senha certa");
  assert.match(lock.slice(lock.indexOf("export async function unlockHenryLock(")), /checkPin\(userId, row, pin\);[\s\S]*?grantHenryUnlock\(userId, row\)/);

  const twoFactor = read("../lib/admin-two-factor.js");
  const fresh = twoFactor.slice(twoFactor.indexOf("export async function confirmFreshTotp"));
  assert.match(fresh.slice(0, 900), /checkCode\(user\.id, loaded\.row, code, "totp"\)/, "só o código do app, nunca o de recuperação");
});

test("login do CRM não muda: nenhum portão novo nos guards nem no proxy", () => {
  const auth = read("../lib/admin-auth.js");
  const proxy = read("../proxy.js");
  for (const source of [auth, proxy]) {
    assert.doesNotMatch(source, /passkey|mm_app_unlock/i);
  }
});

test("migration: tabelas com RLS, sem acesso de anon/authenticated, credencial única", () => {
  const sql = read("../supabase/migrations/20261024120000_admin_passkeys.sql");
  assert.match(sql, /create table if not exists public\.admin_passkeys/);
  assert.match(sql, /credential_id text not null unique/);
  assert.match(sql, /create table if not exists public\.admin_passkey_challenges/);
  assert.match(sql, /alter table public\.admin_passkeys enable row level security/);
  assert.match(sql, /alter table public\.admin_passkey_challenges enable row level security/);
  assert.match(sql, /revoke all on table public\.admin_passkeys from anon, authenticated/);
  assert.match(sql, /revoke all on table public\.admin_passkey_challenges from anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i);
});
