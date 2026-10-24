// Face ID / Windows Hello do Henry (REGRA OFICIAL — dono, 2026-10-24; docs/BUSINESS_RULES.md HENRY-LOCK "Face ID").
// Cadastro e conferência da chave de acesso (WebAuthn) com @simplewebauthn/server. O banco entra por um "store"
// (lib/admin-passkeys.js no servidor; em memória nos testes). Retorna { ok:false, status, error } em recusa — nunca
// libera nada sem a assinatura conferida aqui. Regras puras em admin-passkey-core.mjs.
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";
import {
  PASSKEY_ALGORITHMS,
  PASSKEY_MAX_DEVICES,
  PASSKEY_PURPOSE,
  PASSKEY_RP_NAME,
  PASSKEY_TIMEOUT_MS,
  cleanPasskeyTransports,
  hashPasskeyChallenge,
  isPasskeyCounterAccepted,
  passkeyChallengeExpiresAt
} from "./admin-passkey-core.mjs";

const EXPIRED = "O pedido do Face ID expirou ou já foi usado. Tente de novo.";
const FAILED = "Não consegui confirmar o Face ID. Tente de novo ou use a senha.";

function fail(status, error) {
  return { ok: false, status, error };
}

const toBase64Url = (bytes) => Buffer.from(bytes).toString("base64url");
const fromBase64Url = (text) => new Uint8Array(Buffer.from(String(text || ""), "base64url"));

// O desafio volta dentro da resposta assinada; a biblioteca chama isto com ele e só segue se o servidor o "gastar"
// (uso único, prazo, mesma conta e finalidade — a troca é atômica no banco).
function challengeConsumer(store, { userId, purpose, nowMs }) {
  const state = { consumed: false };
  const check = async (challenge) => {
    state.consumed = await store.consumeChallenge({ userId, purpose, challengeHash: hashPasskeyChallenge(challenge), nowMs });
    return state.consumed;
  };
  return { state, check };
}

async function saveChallenge(store, { userId, purpose, challenge, nowMs }) {
  await store.saveChallenge({ userId, purpose, challengeHash: hashPasskeyChallenge(challenge), expiresAt: passkeyChallengeExpiresAt(purpose, nowMs), nowMs });
}

// 1) Cadastro — opções para o navegador (a confirmação do código do app autenticador é feita ANTES, por quem chama).
export async function buildPasskeyRegistrationOptions({ store, rp, user, nowMs = Date.now() }) {
  if (!user?.id) return fail(409, "Conta sem perfil no CRM: não dá para cadastrar o Face ID.");
  const existing = await store.listCredentials(user.id);
  if (existing.length >= PASSKEY_MAX_DEVICES) return fail(409, `Limite de ${PASSKEY_MAX_DEVICES} aparelhos. Remova um antes de cadastrar outro.`);
  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME,
    rpID: rp.rpID,
    userName: user.email || user.id,
    userDisplayName: user.name || user.email || "",
    userID: new Uint8Array(Buffer.from(String(user.id), "utf8")),
    challenge: new Uint8Array(randomBytes(32)),
    timeout: PASSKEY_TIMEOUT_MS.register,
    attestationType: "none",
    excludeCredentials: existing.map((item) => ({ id: item.credential_id, transports: item.transports || undefined })),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
    supportedAlgorithmIDs: [...PASSKEY_ALGORITHMS]
  });
  await saveChallenge(store, { userId: user.id, purpose: PASSKEY_PURPOSE.REGISTER, challenge: options.challenge, nowMs });
  return { ok: true, options };
}

// 2) Cadastro — confere a resposta do aparelho e guarda SÓ a chave pública.
export async function finishPasskeyRegistration({ store, rp, userId, response, deviceName, nowMs = Date.now() }) {
  if (!userId || !response || typeof response !== "object") return fail(400, "Resposta do aparelho inválida.");
  const consumer = challengeConsumer(store, { userId, purpose: PASSKEY_PURPOSE.REGISTER, nowMs });
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: consumer.check,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [...PASSKEY_ALGORITHMS]
    });
  } catch (error) {
    console.warn(`[passkey] cadastro recusado (${error?.name || "erro"}).`);
    return fail(400, consumer.state.consumed ? FAILED : EXPIRED);
  }
  if (!verification?.verified || !verification.registrationInfo?.userVerified) return fail(400, FAILED);
  const { credential } = verification.registrationInfo;
  const saved = await store.insertCredential({
    userId,
    credentialId: credential.id,
    publicKey: toBase64Url(credential.publicKey),
    counter: Number(credential.counter) || 0,
    transports: cleanPasskeyTransports(response.response?.transports || credential.transports),
    deviceName,
    nowMs
  });
  if (!saved?.ok) return saved?.status ? saved : fail(409, "Este aparelho já está cadastrado.");
  return { ok: true, device: saved.device };
}

// 3) Desbloqueio — opções (só os aparelhos desta conta).
export async function buildPasskeyUnlockOptions({ store, rp, userId, nowMs = Date.now() }) {
  if (!userId) return fail(409, "Conta sem perfil no CRM.");
  const existing = await store.listCredentials(userId);
  if (!existing.length) return fail(409, "Nenhum aparelho com Face ID cadastrado. Use a senha.");
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: existing.map((item) => ({ id: item.credential_id, transports: item.transports || undefined })),
    userVerification: "required",
    timeout: PASSKEY_TIMEOUT_MS.henry_unlock,
    challenge: new Uint8Array(randomBytes(32))
  });
  await saveChallenge(store, { userId, purpose: PASSKEY_PURPOSE.HENRY_UNLOCK, challenge: options.challenge, nowMs });
  return { ok: true, options };
}

// 4) Desbloqueio — confere a assinatura, o desafio de uso único e o contador (gravado só se ainda for o lido).
export async function verifyPasskeyUnlock({ store, rp, userId, response, nowMs = Date.now() }) {
  const credentialId = typeof response?.id === "string" ? response.id : "";
  if (!userId || !credentialId) return fail(400, "Resposta do aparelho inválida.");
  const stored = await store.findCredential(userId, credentialId);
  if (!stored) return fail(401, "Este aparelho não está cadastrado para o Face ID. Use a senha.");
  const consumer = challengeConsumer(store, { userId, purpose: PASSKEY_PURPOSE.HENRY_UNLOCK, nowMs });
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: consumer.check,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: { id: stored.credential_id, publicKey: fromBase64Url(stored.public_key), counter: Number(stored.counter) || 0, transports: stored.transports || undefined }
    });
  } catch (error) {
    console.warn(`[passkey] desbloqueio recusado (${error?.name || "erro"}).`);
    return fail(401, consumer.state.consumed ? FAILED : EXPIRED);
  }
  const info = verification?.authenticationInfo;
  if (!verification?.verified || !info?.userVerified) return fail(401, FAILED);
  if (!isPasskeyCounterAccepted(stored.counter, info.newCounter)) return fail(401, FAILED);
  const updated = await store.updateCounter({ id: stored.id, userId, expectedCounter: Number(stored.counter) || 0, newCounter: Number(info.newCounter) || 0, nowMs });
  if (!updated) return fail(409, EXPIRED);
  return { ok: true, credentialId: stored.id };
}
